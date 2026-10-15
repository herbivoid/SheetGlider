import * as THREE from "three";

// Music glyphs drawn on canvases (white on transparent; tinted by material color).
// Sizes are in staff spaces. Each glyph: { texture, w, h, ax, ay } where (ax, ay)
// is the anchor as a 0..1 fraction from the bottom-left of the quad.
//
// Phase 0 draws shapes procedurally and uses the system's music symbols for
// clefs/rests. Phase 1 swaps in SMuFL fonts (Bravura / Leland / Petaluma).

const PX = 96; // canvas pixels per staff space
const SYMBOL_FONTS = '"Segoe UI Symbol", "Noto Music", "Bravura", "Apple Symbols", serif';
const cache = new Map();

export function glyph(kind) {
  if (!cache.has(kind)) cache.set(kind, build(kind));
  return cache.get(kind);
}

// Box: x from -left..right, y from -down..up, in staff spaces, origin = anchor.
function canvasGlyph(left, right, down, up, draw) {
  const w = left + right;
  const h = down + up;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * PX);
  canvas.height = Math.ceil(h * PX);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(PX, 0, 0, -PX, left * PX, up * PX); // y up, origin at anchor
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return { texture, w, h, ax: left / w, ay: down / h };
}

function build(kind) {
  const [group, a, b] = kind.split(":");
  switch (group) {
    case "note": return noteGlyph(a, b);
    case "acc": return canvasGlyph(0.7, 0.7, 2, 2, ctx => ACCIDENTALS[a](ctx));
    case "dot": return canvasGlyph(0.3, 0.3, 0.3, 0.3, ctx => circle(ctx, 0, 0, 0.2));
    case "clef": return clefGlyph(a);
    case "digit": return canvasGlyph(0.9, 0.9, 1, 1, ctx => textGlyph(ctx, a, 'bold 1px Georgia, "Times New Roman", serif', 2.05, 0));
    case "rest": return restGlyph(a);
    case "glow": return glowGlyph();
    default: throw new Error(`unknown glyph ${kind}`);
  }
}

const HEAD_RX = 0.59;
const HEAD_RY = 0.41;
const HEAD_TILT = 0.35;
const STEM_W = 0.12;
const STEM_LEN = 3.4;
const HEAD_EDGE = 0.572; // x extent of the tilted notehead
const HEAD_EDGE_Y = 0.1;

function noteGlyph(type, stem) {
  const up = stem === "up";
  return canvasGlyph(1.0, 2.0, 3.9, 3.9, ctx => {
    if (type === "whole") {
      ellipse(ctx, 0, 0, 0.78, 0.47, 0);
      ellipse(ctx, 0, 0, 0.36, 0.26, -0.9, true);
      ctx.fill("evenodd");
      return;
    }
    ellipse(ctx, 0, 0, HEAD_RX, HEAD_RY, HEAD_TILT);
    if (type === "half") ellipse(ctx, 0, 0, 0.47, 0.2, 0.62, true);
    ctx.fill("evenodd");
    const stemX = up ? HEAD_EDGE - STEM_W : -HEAD_EDGE;
    const y0 = up ? HEAD_EDGE_Y : -HEAD_EDGE_Y;
    const tip = up ? STEM_LEN : -STEM_LEN;
    ctx.fillRect(stemX, Math.min(y0, tip), STEM_W, Math.abs(tip - y0));
    const flags = { eighth: 1, "16th": 2 }[type] ?? 0;
    for (let i = 0; i < flags; i++) {
      flag(ctx, stemX + (up ? STEM_W : 0) - 0.01, tip + (up ? -0.75 : 0.75) * i, up ? -1 : 1);
    }
  });
}

function flag(ctx, x, y, dir) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x + 0.1, y + dir * 0.8, x + 1.15, y + dir * 1.1, x + 0.8, y + dir * 2.5);
  ctx.bezierCurveTo(x + 0.95, y + dir * 1.55, x + 0.3, y + dir * 1.3, x, y + dir * 1.05);
  ctx.closePath();
  ctx.fill();
}

const ACCIDENTALS = {
  sharp(ctx) {
    ctx.fillRect(-0.24, -1.25, 0.09, 2.35);
    ctx.fillRect(0.15, -1.1, 0.09, 2.35);
    slab(ctx, -0.45, -0.55, 0.45, -0.25, 0.2);
    slab(ctx, -0.45, 0.25, 0.45, 0.55, 0.2);
  },
  flat(ctx) {
    ctx.fillRect(-0.32, -0.5, 0.1, 2.3);
    ctx.lineWidth = 0.16;
    ctx.beginPath();
    ctx.moveTo(-0.27, 0.1);
    ctx.bezierCurveTo(0.2, 0.75, 0.75, 0.25, -0.27, -0.45);
    ctx.stroke();
  },
  natural(ctx) {
    ctx.fillRect(-0.3, -0.6, 0.09, 2.0);
    ctx.fillRect(0.21, -1.4, 0.09, 2.0);
    slab(ctx, -0.3, -0.62, 0.3, -0.38, 0.2);
    slab(ctx, -0.3, 0.38, 0.3, 0.62, 0.2);
  },
};

function clefGlyph(clef) {
  if (clef === "bass") return canvasGlyph(1.8, 1.8, 3, 3, ctx => textGlyph(ctx, "\u{1D122}", `1px ${SYMBOL_FONTS}`, 3.5, 0.3));
  return canvasGlyph(1.8, 1.8, 4.2, 4.2, ctx => textGlyph(ctx, "\u{1D11E}", `1px ${SYMBOL_FONTS}`, 7.2, 0.3));
}

function restGlyph(type) {
  if (type === "whole") return canvasGlyph(0.8, 0.8, 1.5, 1.5, ctx => ctx.fillRect(-0.6, 0.5, 1.2, 0.5));
  if (type === "half") return canvasGlyph(0.8, 0.8, 1.5, 1.5, ctx => ctx.fillRect(-0.6, 0, 1.2, 0.5));
  const char = { quarter: "\u{1D13D}", eighth: "\u{1D13E}", "16th": "\u{1D13F}" }[type];
  const height = { quarter: 2.9, eighth: 2.0, "16th": 2.9 }[type];
  return canvasGlyph(1, 1, 2, 2, ctx => textGlyph(ctx, char, `1px ${SYMBOL_FONTS}`, height, 0));
}

function glowGlyph() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.55)");
  g.addColorStop(0.6, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, w: 1, h: 1, ax: 0.5, ay: 0.5 };
}

// Draws text scaled to `height` staff spaces, centered horizontally, with its
// ink centered at y = centerY.
function textGlyph(ctx, text, font, height, centerY) {
  ctx.save();
  ctx.scale(1, -1); // text wants y down
  const family = font.replace(/^(bold )?1px /, "");
  const weight = font.startsWith("bold") ? "bold " : "";
  ctx.font = `${weight}100px ${family}`;
  let m = ctx.measureText(text);
  const inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent || 100;
  ctx.font = `${weight}${(100 * height) / inkH}px ${family}`;
  m = ctx.measureText(text);
  const x = (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2;
  const y = -centerY - (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function ellipse(ctx, x, y, rx, ry, rot, sub = false) {
  if (!sub) ctx.beginPath();
  else ctx.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot));
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Thick slanted bar from (x0, y0) to (x1, y1) with vertical thickness t.
function slab(ctx, x0, y0, x1, y1, t) {
  ctx.beginPath();
  ctx.moveTo(x0, y0 - t / 2);
  ctx.lineTo(x1, y1 - t / 2);
  ctx.lineTo(x1, y1 + t / 2);
  ctx.lineTo(x0, y0 + t / 2);
  ctx.closePath();
  ctx.fill();
}
