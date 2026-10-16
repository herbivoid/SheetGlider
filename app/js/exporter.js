// Renders frames one by one at exact times and streams the raw pixels to the
// local Python server, which pipes them into ffmpeg (one file per layer, e.g.
// the main video and a separate glow layer).
//
// The main thread only renders and reads pixels back; compressing and
// uploading happen in a pool of workers, in parallel. Frames are mostly
// transparent, so deflate shrinks them ~50x. The pixel buffer is premultiplied
// alpha, which the server tells ffmpeg to undo.

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

class UploadPool {
  constructor(size) {
    this.workers = Array.from({ length: size },
      () => new Worker(new URL("./export-worker.js", import.meta.url), { type: "module" }));
    this.spare = [];       // pixel buffers handed back by the workers
    this.inflight = 0;
    this.waiting = null;
    this.error = null;
    this.next = 0;
    for (const w of this.workers) {
      w.onmessage = ({ data }) => {
        if (data.type === "buffer") { this.spare.push(data.pixels); return; }
        this.inflight--;
        if (data.error && !this.error) this.error = new Error(data.error);
        const wake = this.waiting;
        this.waiting = null;
        wake?.();
      };
    }
  }

  async waitBelow(limit) {
    while (this.inflight >= limit && !this.error) await new Promise(r => { this.waiting = r; });
    if (this.error) throw this.error;
  }

  buffer(bytes) { return this.spare.pop() ?? new Uint8Array(bytes); }

  send(url, pixels, width, background) {
    this.inflight++;
    // Absolute URL: workers resolve relative ones against their own script.
    const abs = new URL(url, location.href).href;
    this.workers[this.next++ % this.workers.length].postMessage({ url: abs, pixels, width, background }, [pixels.buffer]);
  }

  close() { this.workers.forEach(w => w.terminate()); }
}

// layers: [{ suffix, render(t), opaque }] — each becomes its own file.
export async function exportVideo({ renderer, width, height, layers, t0, t1, fps, format, name, onProgress, cancelled }) {
  const frames = Math.max(1, Math.round((t1 - t0) * fps));
  const jobs = [];
  for (const layer of layers) jobs.push(await post("/api/export/start", { format, fps, name: name + layer.suffix, width, height }));
  const gl = renderer.getContext();
  const workers = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  const pool = new UploadPool(workers);
  const bytes = width * height * 4;
  try {
    for (let i = 0; i < frames; i++) {
      for (let l = 0; l < layers.length; l++) {
        if (cancelled()) throw new Error("cancelled");
        await pool.waitBelow(workers * 2);
        layers[l].render(t0 + i / fps);
        const pixels = pool.buffer(bytes);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        // Opaque layers (the glow) have black rows where others are transparent.
        const background = layers[l].opaque ? 0xff000000 : 0;
        pool.send(`/api/export/frame?id=${jobs[l].id}&i=${i}&z=1&bg=${layers[l].opaque ? 1 : 0}`, pixels, width, background);
      }
      onProgress(i + 1, frames);
    }
    await pool.waitBelow(1);
    const results = [];
    for (const job of jobs) results.push(await post(`/api/export/finish?id=${job.id}`, {}));
    return results;
  } catch (err) {
    for (const job of jobs) await post(`/api/export/cancel?id=${job.id}`, {}).catch(() => {});
    throw err;
  } finally {
    pool.close();
  }
}
