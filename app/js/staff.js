import * as THREE from "three";
import { METRICS, glyph } from "./glyphs.js";
import { makeFrame } from "./ribbon.js";
import { placeQuad, quadAxes } from "./facing.js";

// Builds everything drawn on the ribbon: staff lines, barlines, clefs, key and
// time signatures, notes (+ stems, flags, accidentals, dots, ledger lines),
// rests and hit glows. Lines are thin tubes (visible from any angle, even
// edge-on); glyphs are quads re-oriented every frame (see facing.js).

export const STAFF_GAP = 10; // distance between staff centers (grand staff), in staff spaces
const QUAD = new THREE.PlaneGeometry(1, 1);
const HEAD_HALF = METRICS.noteHead / 2;

// Key signature positions (half-spaces from the middle line) in treble clef.
const KEY_SHARPS = [4, 1, 5, 2, -1, 3, 0];
const KEY_FLATS = [0, 3, -1, 2, -2, 1, -3];
const CLEF_KEY_SHIFT = { treble: 0, bass: -2, alto: -1, tenor: 1 };

// Horizontal layout of the start of the staff (clef, key signature, time signature).
export function headerLayout(score) {
  const clefX = 0.8;
  const keyX = clefX + METRICS.clef + 0.5;
  const nKey = Math.abs(score.keyFifths);
  const timeX = keyX + nKey * METRICS.keyAccidental + (nKey ? 0.6 : 0) + METRICS.timeSig / 2;
  return { clefX, keyX, timeX, width: timeX + METRICS.timeSig / 2 + 2.2 };
}

class StaffCurve extends THREE.Curve {
  constructor(ribbon, s0, s1, v0, v1 = v0) {
    super();
    Object.assign(this, { ribbon, s0, s1, v0, v1 });
  }
  getPoint(t, target = new THREE.Vector3()) {
    return this.ribbon.pointAt(this.s0 + (this.s1 - this.s0) * t, this.v0 + (this.v1 - this.v0) * t, target);
  }
}

export class StaffView {
  constructor({ score, spacing, ribbon, params }) {
    Object.assign(this, { score, spacing, ribbon, params });
    this.group = new THREE.Group();
    this.quads = [];       // { mesh, s, v, g, colorFrom }
    this.noteVisuals = []; // { onset, material, glow }
    this.lineMaterial = new THREE.MeshBasicMaterial({ color: params.staffColor });
    this.header = headerLayout(score);
    this.sEnd = this.sOf(score.endBeat) + 3;
    this.frame = makeFrame();
    this.build();
  }

  sOf(beat) { return this.header.width + this.spacing.x(beat); }
  staffCenter(staff) { return -staff * STAFF_GAP; }

  build() {
    const { score, params, header } = this;
    const lw = params.lineThickness / 2;
    const n = score.staves.length;
    const top = 2;
    const bottom = this.staffCenter(n - 1) - 2;
    const color = params.noteColor;

    score.staves.forEach((staffDef, staff) => {
      const c = this.staffCenter(staff);
      for (let l = -2; l <= 2; l++) this.tube(0, this.sEnd, c + l, c + l, lw);
      this.addGlyph(`clef:${staffDef.clef}`, header.clefX, c, color);
      const order = score.keyFifths >= 0 ? KEY_SHARPS : KEY_FLATS;
      const name = score.keyFifths >= 0 ? "sharp" : "flat";
      const shift = CLEF_KEY_SHIFT[staffDef.clef] ?? 0;
      for (let i = 0; i < Math.abs(score.keyFifths); i++) {
        const s = header.keyX + (i + 1) * METRICS.keyAccidental - 0.15;
        this.addGlyph(`acc:${name}`, s, c + (order[i] + shift) / 2, color);
      }
      this.addGlyph(`time:${score.timeSig[0]}`, header.timeX, c + 1, color);
      this.addGlyph(`time:${score.timeSig[1]}`, header.timeX, c - 1, color);
    });

    // System start line (+ brace for several staves) and barlines through all staves.
    this.tube(0, 0, bottom, top, lw);
    if (n > 1) this.addGlyph(`brace:${top - bottom}`, 0, (top + bottom) / 2, color);
    for (const bar of score.bars) {
      if (Math.abs(bar - score.endBeat) < 1e-6) {
        this.tube(this.sEnd - 0.75, this.sEnd - 0.75, bottom, top, lw * 1.2);
        this.tube(this.sEnd - 0.2, this.sEnd - 0.2, bottom, top, 0.25);
      } else {
        const s = this.sOf(bar) - params.barGap * 0.55;
        this.tube(s, s, bottom, top, lw * 1.2);
      }
    }

    // Chords (same staff, start and note type) share one stem direction, set by
    // the note farthest from the middle line; only the note at the stem's end gets the flag.
    const chords = new Map();
    for (const note of score.notes) {
      const key = `${note.staff}|${note.start}|${note.type}`;
      if (!chords.has(key)) chords.set(key, []);
      chords.get(key).push(note);
    }
    for (const chord of chords.values()) {
      const high = Math.max(...chord.map(n => n.pos));
      const low = Math.min(...chord.map(n => n.pos));
      const stem = high + low >= 0 ? "down" : "up";
      const flagged = stem === "up" ? high : low;
      for (const note of chord) this.addNote(note, stem, note.pos === flagged);
    }
    for (const rest of score.rests) {
      let s = this.sOf(rest.start);
      if (rest.measureRest) s = (this.sOf(rest.start) + this.sOf(rest.start + rest.dur) - params.barGap) / 2;
      this.addGlyph(`rest:${rest.type}`, s, this.staffCenter(rest.staff), color);
    }
  }

  addNote(note, stem, withFlag) {
    const { params } = this;
    const c = this.staffCenter(note.staff);
    const s = this.sOf(note.start);
    const v = c + note.pos / 2;
    const kind = `note:${note.type}:${stem}${withFlag ? "" : ":noflag"}`;
    const material = this.addGlyph(kind, s, v, params.noteColor).material;
    const half = note.type === "whole" ? 0.85 : HEAD_HALF;
    if (note.accidental !== null) {
      const name = { 1: "sharp", "-1": "flat", 0: "natural", 2: "doubleSharp", "-2": "doubleFlat" }[note.accidental];
      this.addGlyph(`acc:${name ?? "natural"}`, s - half - 0.2, v, params.noteColor, material);
    }
    for (let d = 0; d < note.dots; d++) {
      const dv = note.pos % 2 === 0 ? 0.5 : 0; // dots sit in spaces
      this.addGlyph("dot", s + half + 0.25 + d * 0.5, v + dv, params.noteColor, material);
    }
    // Ledger lines
    const lw = params.lineThickness * 0.6;
    const ext = half + 0.4;
    for (let p = 6; p <= note.pos; p += 2) this.tube(s - ext, s + ext, c + p / 2, c + p / 2, lw);
    for (let p = -6; p >= note.pos; p -= 2) this.tube(s - ext, s + ext, c + p / 2, c + p / 2, lw);

    let glow = null;
    if (!note.tieFromPrev) {
      glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glyph("glow").texture, color: params.glowColor, transparent: true,
        depthWrite: false, opacity: 0,
      }));
      this.ribbon.pointAt(s, v, glow.position);
      glow.renderOrder = 2;
      this.group.add(glow);
    }
    this.noteVisuals.push({ onset: this.score.timeOf(note.start), material, glow });
  }

  // Adds a glyph quad at (s, v). `colorFrom` tints it like another glyph (e.g. a note's accidental).
  addGlyph(kind, s, v, color, colorFrom) {
    const g = glyph(kind);
    const material = new THREE.MeshBasicMaterial({
      map: g.texture, color, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(QUAD, material);
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 1;
    this.group.add(mesh);
    this.quads.push({ mesh, s, v, g, colorFrom });
    return { mesh, material };
  }

  tube(s0, s1, v0, v1, radius) {
    const curve = new StaffCurve(this.ribbon, s0, s1, v0, v1);
    const len = Math.abs(s1 - s0) + Math.abs(v1 - v0);
    const segments = Math.max(2, Math.ceil(len * 3));
    curve.arcLengthDivisions = segments * 2;
    const geo = new THREE.TubeGeometry(curve, segments, radius, 6, false);
    this.group.add(new THREE.Mesh(geo, this.lineMaterial));
  }

  update(t, camera) {
    const { params, frame } = this;
    const X = new THREE.Vector3();
    const Y = new THREE.Vector3();
    const at = new THREE.Vector3();
    for (const q of this.quads) {
      this.ribbon.frameAt(q.s, frame);
      at.copy(frame.P).addScaledVector(frame.U, q.v);
      quadAxes(camera, at, frame.T, frame.U, params.readability, params.flipSharpness, X, Y);
      placeQuad(q.mesh, at, X, Y, q.g.w, q.g.h, q.g.ax, q.g.ay, camera);
    }

    // Hit glow + note color: flash to the glow color, settle to the played color.
    const base = new THREE.Color(params.noteColor);
    const played = new THREE.Color(params.playedColor);
    const hot = new THREE.Color(params.glowColor);
    for (const nv of this.noteVisuals) {
      const dt = t - nv.onset;
      if (dt < 0) {
        nv.material.color.copy(base);
        if (nv.glow) nv.glow.visible = false;
        continue;
      }
      const e = Math.exp(-dt / params.glowDecay) * Math.min(1, dt / 0.02 + 0.3);
      nv.material.color.copy(played).lerp(hot, Math.min(1, e * 1.2));
      if (!nv.glow) continue;
      nv.glow.visible = e > 0.01;
      nv.glow.material.opacity = e * params.glowStrength;
      const size = params.glowSize * (0.7 + 0.5 * (1 - e));
      nv.glow.scale.set(size, size, 1);
    }
    // Accidentals and dots follow their note's color.
    for (const q of this.quads) if (q.colorFrom) q.mesh.material.color.copy(q.colorFrom.color);
  }

  dispose() {
    this.group.traverse(o => {
      if (o.geometry && o.geometry !== QUAD) o.geometry.dispose();
      if (o.material && o.material !== this.lineMaterial) o.material.dispose();
    });
    this.lineMaterial.dispose();
  }
}
