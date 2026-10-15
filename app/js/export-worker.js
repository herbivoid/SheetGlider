// Export helper running off the main thread: trims empty rows off one frame,
// compresses the rest and uploads it, then hands the pixel buffer back for reuse.
//
// "Empty" means every pixel equals `background` (0 = transparent, or opaque
// black for the glow layer); the server puts those rows back.

self.onmessage = async ({ data: { url, pixels, width, background } }) => {
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

    const blob = new Blob([pixels.subarray(y0 * width * 4, y1 * width * 4)]); // copies the rows
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
