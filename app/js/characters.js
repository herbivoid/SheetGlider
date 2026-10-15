// Character packs: the built-in ones in characters/, and custom ones the user
// picks from their own computer. Custom characters never leave the browser:
// they're read from disk, checked, and remembered in the browser's own
// storage (IndexedDB) on this device.

export const STATES = ["glide", "crouch", "hit", "ride", "rest", "surf"];
const ALIASES = { anticipate: "crouch" }; // older packs

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SIDE = 2048;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// ---- Built-in characters (folders in characters/, listed by the server) ----

export async function listBuiltin() {
  try {
    const res = await fetch("/api/characters");
    if (res.ok) return await res.json();
  } catch { /* fall through */ }
  return [{ id: "clawd", name: "Clawd" }];
}

// { def, urls: { state: url } } for a built-in character folder.
export async function builtinPack(id) {
  const base = `../characters/${encodeURIComponent(id)}`;
  const def = await (await fetch(`${base}/character.json`)).json();
  const urls = {};
  for (const [state, file] of Object.entries(def.sprites ?? {})) {
    urls[ALIASES[state] ?? state] = `${base}/${file}`;
  }
  return { def, urls, revoke() {} };
}

// ---- Custom characters (IndexedDB) ----

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("sheetglider", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("characters", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("characters", mode);
    const req = action(tx.objectStore("characters"));
    tx.oncomplete = () => { db.close(); resolve(req?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function listCustom() {
  try {
    const all = await store("readonly", s => s.getAll());
    return all.map(c => ({ id: c.id, name: c.def.name }));
  } catch {
    return []; // storage unavailable (e.g. private window)
  }
}

export async function customPack(id) {
  const c = await store("readonly", s => s.get(id));
  if (!c) throw new Error("that custom character isn't stored in this browser");
  const urls = {};
  for (const [state, blob] of Object.entries(c.sprites)) urls[state] = URL.createObjectURL(blob);
  return { def: c.def, urls, revoke: () => Object.values(urls).forEach(u => URL.revokeObjectURL(u)) };
}

export function deleteCustom(id) {
  return store("readwrite", s => s.delete(id));
}

// ---- Importing ----

// Reads, checks and stores a character from files the user picked: PNG
// sprites named after their state (glide.png, hit.png, …), plus an optional
// character.json. Returns { id, name }.
export async function importCharacter(files) {
  const list = [...files];
  const pngs = list.filter(f => /\.png$/i.test(f.name));
  if (!pngs.length) throw new Error("pick at least one PNG image");
  for (const f of list) {
    if (!/\.(png|json)$/i.test(f.name)) throw new Error(`${f.name}: only PNG images and character.json are allowed`);
    if (f.size > MAX_FILE_BYTES) throw new Error(`${f.name} is larger than 4 MB`);
  }

  // Optional settings file: only known fields are kept.
  let meta = {};
  const jsonFile = list.find(f => /\.json$/i.test(f.name));
  if (jsonFile) {
    try { meta = JSON.parse(await jsonFile.text()); } catch { throw new Error(`${jsonFile.name} isn't valid JSON`); }
  }

  // Check every image's real size from its header before the browser decodes it.
  let largest = 0;
  for (const f of pngs) {
    const [w, h] = await pngSize(f);
    if (w > MAX_SIDE || h > MAX_SIDE) throw new Error(`${f.name} is ${w}×${h}; the limit is ${MAX_SIDE}×${MAX_SIDE}`);
    largest = Math.max(largest, w, h);
  }

  // Which image is which state: character.json's mapping, else the file names.
  const byName = new Map(pngs.map(f => [f.name.toLowerCase(), f]));
  const sprites = {};
  for (const [state, file] of Object.entries(meta.sprites ?? {})) {
    const s = ALIASES[state] ?? state;
    const f = typeof file === "string" && byName.get(file.toLowerCase());
    if (STATES.includes(s) && f) sprites[s] = f;
  }
  for (const f of pngs) {
    const stem = f.name.replace(/\.png$/i, "").toLowerCase();
    const s = ALIASES[stem] ?? stem;
    if (STATES.includes(s) && !sprites[s]) sprites[s] = f;
  }
  if (!sprites.glide) sprites.glide = pngs.find(f => !Object.values(sprites).includes(f)) ?? pngs[0];

  const folder = pngs[0].webkitRelativePath?.split("/")[0];
  const name = (typeof meta.name === "string" && meta.name.trim()) || folder || pngs[0].name.replace(/\.png$/i, "");
  const anchor = Array.isArray(meta.anchor) && meta.anchor.length === 2
    && meta.anchor.every(x => typeof x === "number" && x >= 0 && x <= 1) ? meta.anchor : [0.5, 0];
  const def = {
    name: name.slice(0, 40),
    pixelArt: typeof meta.pixelArt === "boolean" ? meta.pixelArt : largest <= 256,
    anchor,
  };
  const id = `custom-${Date.now()}`;
  const blobs = {};
  for (const [state, f] of Object.entries(sprites)) blobs[state] = new Blob([await f.arrayBuffer()], { type: "image/png" });
  await store("readwrite", s => s.put({ id, def, sprites: blobs }));
  return { id, name: def.name };
}

async function pngSize(file) {
  const head = new Uint8Array(await file.slice(0, 24).arrayBuffer());
  if (head.length < 24 || PNG_SIGNATURE.some((b, i) => head[i] !== b)) throw new Error(`${file.name} isn't a valid PNG`);
  const view = new DataView(head.buffer);
  return [view.getUint32(16), view.getUint32(20)];
}
