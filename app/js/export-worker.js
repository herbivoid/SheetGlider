// Export helper running off the main thread: trims empty rows off one frame,
// converts it to straight alpha, compresses the rest and uploads it, then
// hands the pixel buffer back for reuse.
//
// "Empty" means every pixel equals `background` (0 = transparent, or opaque
// black for the glow layer); the server puts those rows back.

self.onmessage = async ({ data: { url, pixels, width, background, straight } }) => {
  try {
    const words = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength / 4);
    const rows = words.length / width;
    const rowEmpty = y => {
      for (let i = y * width, end = i + width; i < end; i++) if (words[i] !== background) return false;
      return true;
    };
    let y0 = 0;
    while (y0 < rows && rowEmpty(y0)) y0++;
    let y1 = rows;
    while (y1 > y0 && rowEmpty(y1 - 1)) y1--;

    const band = pixels.subarray(y0 * width * 4, y1 * width * 4);
    if (straight) unpremultiply(band); // a premultiplied export keeps the colors as they are
    const blob = new Blob([band]); // copies the rows
    self.postMessage({ type: "buffer", pixels }, [pixels.buffer]);
    const stream = blob.stream().pipeThrough(new CompressionStream("deflate"));
    const body = await new Response(stream).arrayBuffer();
    const res = await fetch(`${url}&y0=${y0}&y1=${y1}`, {
      method: "POST", body, headers: { "Content-Type": "application/octet-stream" },
    });
    const json = await res.json();
    self.postMessage({ type: "done", error: res.ok && !json.error ? null : json.error || `HTTP ${res.status}` });
  } catch (err) {
    self.postMessage({ type: "done", error: String(err.message || err) });
  }
};

// WebGL hands back premultiplied colors (already scaled down by their alpha);
// video files and editors expect straight alpha. Without this, everything
// semi-transparent (soft edges, glows, fog, fades) looks too dark over footage.
function unpremultiply(p) {
  const out = new Uint8ClampedArray(p.buffer, p.byteOffset, p.byteLength);
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3];
    if (a === 0 || a === 255) continue;
    const k = 255 / a;
    out[i] = out[i] * k + 0.5;
    out[i + 1] = out[i + 1] * k + 0.5;
    out[i + 2] = out[i + 2] * k + 0.5;
  }
}
