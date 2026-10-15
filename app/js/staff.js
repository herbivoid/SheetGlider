import * as THREE from "three";
import { glyph } from "./glyphs.js";
import { makeFrame } from "./ribbon.js";
import { placeQuad, quadAxes } from "./facing.js";

// Builds everything drawn on the ribbon: staff lines, barlines, clef, time
// signature, notes (+ stems, flags, accidentals, dots, ledger lines), rests and
// hit glows. Lines are thin tubes (visible from any angle, even edge-on);
// glyphs are quads re-oriented every frame (see facing.js).

export const HEADER_WIDTH = 7.5; // room for clef + time signature before the music
const STAFF_GAP = 10;           // distance between staff centers (grand staff)
const QUAD = new THREE.PlaneGeometry(1, 1);

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
    this.quads = [];      // { mesh, s, v, g, k }
    this.noteVisuals = []; // { note, onset, material, glow }
    this.lineMaterial = new THREE.MeshBasicMaterial({ color: params.staffColor });
    this.sEnd = HEADER_WIDTH + spacing.x(score.endBeat) + 3;
    this.frame = makeFrame();
    this.build();
  }

  sOf(beat) { return HEADER_WIDTH + this.spacing.x(beat); }
  staffCenter(staff) { return -staff * STAFF_GAP; }

  build() {
    const { score, params } = this;
    const lw = params.lineThickness / 2;

    score.staves.forEach((staffDef, staff) => {
      const c = this.staffCenter(staff);
      for (let l = -2; l <= 2; l++) this.tube(0, this.sEnd, c + l, c + l, lw);
      this.tube(0, 0, c - 2, c + 2, lw); // system start line
      for (const bar of score.bars) {
        const s = this.sOf(bar) - params.barGap * 0.55;
        const last = Math.abs(bar - score.endBeat) < 1e-6;
        if (last) {
          this.tube(this.sEnd - 0.75, this.sEnd - 0.75, c - 2, c + 2, lw * 1.2);
          this.tube(this.sEnd - 0.2, this.sEnd - 0.2, c - 2, c + 2, 0.25);
        } else {
          this.tube(s, s, c - 2, c + 2, lw * 1.2);
        }
      }
      this.addGlyph(`clef:${staffDef.clef}`, 2.0, c, params.noteColor);
      this.addGlyph(`digit:${score.beatsPerBar}`, 5.2, c + 1, params.noteColor);
      this.addGlyph(`digit:${score.beatUnit}`, 5.2, c - 1, params.noteColor);
    });

    for (const note of score.notes) this.addNote(note);
    for (const rest of score.rests) {
      const s = this.sOf(rest.start);
      this.addGlyph(`rest:${rest.type}`, s, this.staffCenter(rest.staff), params.noteColor);
    }
  }

  addNote(note) {
    const { params } = this;
    const c = this.staffCenter(note.staff);
    const s = this.sOf(note.start);
    const v = c + note.pos / 2;
    const stem = note.pos >= 0 ? "down" : "up";
    const material = this.addGlyph(`note:${note.type}:${stem}`, s, v, params.noteColor).material;
    if (note.accidental !== null) {
      const name = { 1: "sharp", "-1": "flat", 0: "natural" }[note.accidental] ?? "natural";
      this.addGlyph(`acc:${name}`, s - 1.45, v, params.noteColor, material);
    }
    for (let d = 0; d < note.dots; d++) {
      const dv = note.pos % 2 === 0 ? 0.5 : 0; // dots sit in spaces
      this.addGlyph("dot", s + 1.05 + d * 0.5, v + dv, params.noteColor, material);
    }
    // Ledger lines
    const lw = params.lineThickness * 0.6;
    for (let p = 6; p <= note.pos; p += 2) this.tube(s - 0.95, s + 0.95, c + p / 2, c + p / 2, lw);
    for (let p = -6; p >= note.pos; p -= 2) this.tube(s - 0.95, s + 0.95, c + p / 2, c + p / 2, lw);

    const glowMat = new THREE.SpriteMaterial({
      map: glyph("glow").texture, color: params.glowColor, transparent: true,
      depthWrite: false, opacity: 0,
    });
    const glow = new THREE.Sprite(glowMat);
    this.ribbon.pointAt(s, v, glow.position);
    glow.renderOrder = 2;
    this.group.add(glow);
    this.noteVisuals.push({ note, onset: note.start * this.score.secondsPerBeat, material, glow });
  }

  // Adds a glyph quad at (s, v). Pass `sharedMaterial` to tint it with another glyph (e.g. a note's accidental).
  addGlyph(kind, s, v, color, sharedMaterial) {
    const g = glyph(kind);
    const material = new THREE.MeshBasicMaterial({
      map: g.texture, color, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(QUAD, material);
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 1;
    this.group.add(mesh);
    const quad = { mesh, s, v, g, colorFrom: sharedMaterial };
    this.quads.push(quad);
    return { mesh, material };
  }

  tube(s0, s1, v0, v1, radius) {
    const curve = new StaffCurve(this.ribbon, s0, s1, v0, v1);
    const len = Math.abs(s1 - s0) + Math.abs(v1 - v0);
    const segments = Math.max(2, Math.ceil(len * 3));
    curve.arcLengthDivisions = segments * 2;
    const geo = new THREE.TubeGeometry(curve, segments, radius, 6, false);
    const mesh = new THREE.Mesh(geo, this.lineMaterial);
    this.group.add(mesh);
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
        nv.glow.material.opacity = 0;
        nv.glow.visible = false;
        continue;
      }
      const e = Math.exp(-dt / params.glowDecay) * Math.min(1, dt / 0.02 + 0.3);
      nv.material.color.copy(played).lerp(hot, Math.min(1, e * 1.2));
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
