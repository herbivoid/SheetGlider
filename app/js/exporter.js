// Renders frames one by one at exact times and streams the raw pixels to the
// local Python server, which pipes them into ffmpeg. Raw pixels skip slow
// in-browser PNG encoding; the buffer is premultiplied alpha, which the server
// tells ffmpeg to undo. Frames are deflate-compressed first: they're mostly
// transparent, so they shrink ~50x and upload far faster than 8 MB of raw pixels.

async function deflate(blob) {
  const stream = blob.stream().pipeThrough(new CompressionStream("deflate"));
  return new Response(stream).arrayBuffer();
}

async function post(url, body, json = true) {
  const res = await fetch(url, {
    method: "POST",
    body: json ? JSON.stringify(body) : body,
    headers: json ? { "Content-Type": "application/json" } : { "Content-Type": "application/octet-stream" },
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function exportVideo({ renderer, width, height, renderAt, t0, t1, fps, format, name, onProgress, cancelled }) {
  const frames = Math.max(1, Math.round((t1 - t0) * fps));
  const { id, path } = await post("/api/export/start", { format, fps, name, width, height });
  const gl = renderer.getContext();
  const pixels = new Uint8Array(width * height * 4);
  try {
    let pending = null; // compress + upload of the previous frame overlaps rendering of this one
    for (let i = 0; i < frames; i++) {
      if (cancelled()) throw new Error("cancelled");
      renderAt(t0 + i / fps);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const frame = new Blob([pixels]); // copies, so `pixels` can be reused right away
      await pending;
      pending = deflate(frame).then(z => post(`/api/export/frame?id=${id}&i=${i}&z=1`, z, false));
      onProgress(i + 1, frames, path);
    }
    await pending;
    return await post(`/api/export/finish?id=${id}`, {});
  } catch (err) {
    await post(`/api/export/cancel?id=${id}`, {}).catch(() => {});
    throw err;
  }
}
