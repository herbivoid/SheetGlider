import * as THREE from "three";

// Music glyphs rendered from a SMuFL music font (Bravura by default) onto
// canvases: white on transparent, tinted by material color. SMuFL fonts share
// one layout: 1 em = 4 staff spaces, and each glyph's origin sits at a defined
// point (noteheads: left edge, vertically centered on their staff position).
//
// Sizes are in staff spaces. Each glyph: { texture, w, h, ax, ay } where
// (ax, ay) is the anchor as a 0..1 fraction from the bottom-left of the quad.

const PX = 96; // canvas pixels per staff space
const FONT = "Bravura";
const cache = new Map();

export async function loadMusicFont() {
  const face = new FontFace(FONT, "url(fonts/Bravura.woff2)");
  await face.load();
  document.fonts.add(face);
}

export function glyph(kind) {
  if (!cache.has(kind)) cache.set(kind, build(kind));
  return cache.get(kind);
}

// SMuFL code points
const G = {
  noteheadWhole: "", noteheadHalf: "", noteheadBlack: "",
  flag8thUp: "", flag8thDown: "", flag16thUp: "", flag16thDown: "",
  flag32ndUp: "", flag32ndDown: "",
  flat: "", natural: "", sharp: "", doubleSharp: "", doubleFlat: "",
  gClef: "", fClef: "", cClef: "",
  restWhole: "", restHalf: "", restQuarter: "", rest8th: "",
  rest16th: "", rest32nd: "",
  dot: "", brace: "",
};
const timeSigDigit = d => String.fromCharCode(0xE080 + d);

const HEAD_W = 1.18;      // black/half notehead width
const WHOLE_W = 1.69;

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
  draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return { texture, w, h, ax: left / w, ay: down / h };
}

// Draws a font glyph with its SMuFL origin at (x, y) staff spaces (y up).
function music(ctx, char, x, y, scaleY = 1, scaleX = 1) {
  ctx.save();
  const m = ctx.getTransform();
  ctx.setTransform(scaleX, 0, 0, scaleY, m.e + x * PX, m.f - y * PX); // pixels, y down
  ctx.font = `${4 * PX}px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(char, 0, 0);
  ctx.restore();
}

function textWidth(ctx, text) {
  ctx.save();
  ctx.font = `${4 * PX}px ${FONT}`;
  const w = ctx.measureText(text).width / PX;
  ctx.restore();
  return w;
}

function build(kind) {
  const [group, a, b] = kind.split(":");
  switch (group) {
    // Noteheads, anchored at their center.
    case "head": return canvasGlyph(1.0, 1.0, 0.75, 0.75, ctx => {
      const ch = { whole: G.noteheadWhole, half: G.noteheadHalf }[a] ?? G.noteheadBlack;
      music(ctx, ch, -(a === "whole" ? WHOLE_W : HEAD_W) / 2, 0);
    });
    // Flags, anchored where they join the stem: its left edge, at the stem's end.
    case "flag": {
      const up = b === "up";
      const ch = G[`flag${flagName(a)}${up ? "Up" : "Down"}`];
      return up
        ? canvasGlyph(0.2, 1.6, 4.0, 0.4, ctx => music(ctx, ch, 0, 0))
        : canvasGlyph(0.2, 1.6, 0.4, 4.0, ctx => music(ctx, ch, 0, 0));
    }
    // Tuplet number, centered.
    case "tuplet": return canvasGlyph(1.2, 1.2, 0.9, 0.9, ctx => {
      const text = [...a].map(d => String.fromCharCode(0xE880 + Number(d))).join("");
      centered(ctx, text);
    });
    // Accidentals are anchored at their right edge, on their staff position.
    case "acc": return canvasGlyph(2.0, 0, 2.2, 2.6, ctx => {
      const ch = G[a] ?? G.natural;
      music(ctx, ch, -textWidth(ctx, ch), 0);
    });
    // Augmentation dot, anchored at its left edge.
    case "dot": return canvasGlyph(0, 0.5, 0.4, 0.4, ctx => music(ctx, G.dot, 0, 0));
    // Clefs are anchored at their left edge on the middle line.
    case "clef": return canvasGlyph(0, 3, 4.6, 4.6, ctx => {
      if (a === "bass") music(ctx, G.fClef, 0, 1);
      else if (a === "alto") music(ctx, G.cClef, 0, 0);
      else if (a === "tenor") music(ctx, G.cClef, 0, 1);
      else music(ctx, G.gClef, 0, -1);
    });
    // A time signature number (one or more digits), centered.
    case "time": return canvasGlyph(2.2, 2.2, 1.2, 1.2, ctx => {
      const text = [...a].map(d => timeSigDigit(Number(d))).join("");
      music(ctx, text, -textWidth(ctx, text) / 2, 0);
    });
    case "rest": return restGlyph(a);
    // Brace spanning `a` staff spaces, anchored at its right edge, vertically centered.
    // It's designed one staff tall; stretched taller it also needs some extra width.
    case "brace": {
      const span = Number(a);
      const sy = span / 4;
      const sx = Math.max(1, sy * 0.7);
      return canvasGlyph(2.0, 0, span / 2, span / 2, ctx => {
        const w = textWidth(ctx, G.brace) * sx;
        music(ctx, G.brace, -w - 0.2, -span / 2, sy, sx);
      });
    }
    case "glow": return glowGlyph();
    default: throw new Error(`unknown glyph ${kind}`);
  }
}

// Draws text with its ink centered on the anchor.
function centered(ctx, text) {
  ctx.save();
  const m = ctx.getTransform();
  ctx.setTransform(1, 0, 0, 1, m.e, m.f);
  ctx.font = `${4 * PX}px ${FONT}`;
  const t = ctx.measureText(text);
  const x = (t.actualBoundingBoxLeft - t.actualBoundingBoxRight) / 2;
  const y = (t.actualBoundingBoxAscent - t.actualBoundingBoxDescent) / 2;
  ctx.fillText(text, x, y);
  ctx.restore();
}

const flagName = type => ({ eighth: "8th", "16th": "16th", "32nd": "32nd" }[type]);

// Rests are anchored on the middle line, horizontally centered.
function restGlyph(type) {
  const ch = { whole: G.restWhole, half: G.restHalf, quarter: G.restQuarter,
    eighth: G.rest8th, "16th": G.rest16th, "32nd": G.rest32nd }[type] ?? G.restQuarter;
  // Whole rests hang from the 4th line; the others sit on the middle line.
  const y = type === "whole" ? 1 : 0;
  return canvasGlyph(1.2, 1.2, 2.4, 2.4, ctx => music(ctx, ch, -textWidth(ctx, ch) / 2, y));
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

// Width (staff spaces) a few header items need, for laying out the start of the staff.
export const METRICS = { clef: 2.8, keyAccidental: 1.0, timeSig: 2.0, noteHead: HEAD_W };
