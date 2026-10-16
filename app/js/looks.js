// "Looks": every visual setting (shape, tweaks, colors, motion, camera,
// character, music font…) saved as a small JSON file to reuse or share, plus
// the last-used look remembered in this browser (localStorage).
//
// Settings that belong to a particular score, the preview, or the export
// aren't part of a look.

const NOT_LOOK = new Set([
  "bpm", "follow", "repeats",                                        // the score
  "background", "sound",                                             // the preview
  "resolution", "fps", "format", "exportAudio", "glowLayer", "exportTrack", // the export
]);
const STORAGE_KEY = "sheetglider.look";

export function lookOf(params) {
  const look = {};
  for (const [k, v] of Object.entries(params)) if (!NOT_LOOK.has(k)) look[k] = v;
  return { sheetglider: "look", version: 1, params: look };
}

// Copies a look's settings into params. Only known settings of the right type
// are taken; `choices` lists the allowed values for settings that are picked
// from a list. Returns the names of settings that were ignored.
export function applyLook(params, defaults, look, choices) {
  if (look?.sheetglider !== "look" || typeof look.params !== "object" || !look.params) {
    throw new Error("this isn't a SheetGlider look file");
  }
  const ignored = [];
  for (const [k, v] of Object.entries(look.params)) {
    const ok = k in defaults && !NOT_LOOK.has(k) && typeof v === typeof defaults[k]
      && (typeof v !== "number" || Number.isFinite(v))
      && (!choices[k] || choices[k].includes(v));
    if (ok) params[k] = v; else ignored.push(k);
  }
  return ignored;
}

export function resetLook(params, defaults) {
  for (const [k, v] of Object.entries(defaults)) if (!NOT_LOOK.has(k)) params[k] = v;
}

export function rememberLook(params) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lookOf(params))); } catch { /* storage off */ }
}

export function recalledLook() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
}

export function downloadLook(params, name) {
  const blob = new Blob([JSON.stringify(lookOf(params), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name || "look"}.sheetglider-look.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function readLookFile(file) {
  if (file.size > 256 * 1024) throw new Error("that file is too big to be a look");
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error("that file isn't valid JSON");
  }
}
