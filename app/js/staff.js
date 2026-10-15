import * as THREE from "three";
import { METRICS, glyph } from "./glyphs.js";
import { makeFrame } from "./ribbon.js";
import { placeQuad, quadAxes } from "./facing.js";
import { CHANGE_PAD, changesAt, engrave, keySignatureGlyphs } from "./engrave.js";
import { layoutSpanners } from "./spanners.js";

// Draws everything on the ribbon. The notation itself is laid out flat by
// engrave.js / spanners.js; here it's mapped onto the ribbon:
//   glyphs  -> quads re-oriented every frame (see facing.js)
//   tubes   -> thin tubes (staff lines, stems, ledger lines): visible from any angle
//   bands   -> thin slabs following the ribbon (beams, ties, slurs)

export const STAFF_GAP = 10; // distance between staff centers (grand staff), in staff spaces
export const GLOW_LAYER = 1;  // glows render on their own layer, so they can be exported separately
const QUAD = new THREE.PlaneGeometry(1, 1);
const SLAB_DEPTH = 0.06;

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
  constructor({ score, spacing, ribbon, params, extras }) {
    Object.assign(this, { score, spacing, ribbon, params, extras });
    this.group = new THREE.Group();
    this.quads = [];             // { mesh, s, v, g, scale, tint }
    this.visuals = new Map();    // key -> { onset, color, glow, glowScale }
    this.tubeMaterials = new Map();
    this.lineMaterial = new THREE.MeshBasicMaterial({ color: params.staffColor });
    this.inkMaterial = new THREE.MeshBasicMaterial({ color: params.noteColor, side: THREE.DoubleSide });
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

    // Staff lines and the opening clef / key / time signature.
    score.staves.forEach((staffDef, staff) => {
      const c = this.staffCenter(staff);
      for (let l = -2; l <= 2; l++) this.tube(0, this.sEnd, c + l, c + l, lw, this.lineMaterial);
      this.addGlyph(`clef:${staffDef.clef}`, header.clefX, c);
      keySignatureGlyphs(score.keyFifths, staffDef.clef).forEach(([name, pos], i) => {
        this.addGlyph(`acc:${name}`, header.keyX + (i + 1) * METRICS.keyAccidental - 0.15, c + pos / 2);
      });
      this.addGlyph(`time:${score.timeSig[0]}`, header.timeX, c + 1);
      this.addGlyph(`time:${score.timeSig[1]}`, header.timeX, c - 1);
    });

    // System start line (+ brace for several staves).
    this.tube(0, 0, bottom, top, lw, this.lineMaterial);
    if (n > 1) this.addGlyph(`brace:${top - bottom}`, 0, (top + bottom) / 2);

    // Barlines, with any clef/key/time changes drawn just after them.
    const changes = new Map(changesAt(score).map(c => [Math.round(c.beat * 960), c]));
    const barSet = new Set(score.bars.map(b => Math.round(b * 960)));
    for (const bar of score.bars) {
      if (Math.abs(bar - score.endBeat) < 1e-6) {
        this.tube(this.sEnd - 0.75, this.sEnd - 0.75, bottom, top, lw * 1.2, this.lineMaterial);
        this.tube(this.sEnd - 0.2, this.sEnd - 0.2, bottom, top, 0.25, this.lineMaterial);
        continue;
      }
      const change = changes.get(Math.round(bar * 960));
      const s = this.sOf(bar) - this.extras.before(bar) - (change?.width ?? 0) - params.barGap * 0.55;
      this.tube(s, s, bottom, top, lw * 1.2, this.lineMaterial);
      if (change) this.drawChange(change, s + CHANGE_PAD / 2);
    }
    // Changes in the middle of a bar (usually a clef) go right before their notes.
    for (const change of changes.values()) {
      if (barSet.has(Math.round(change.beat * 960))) continue;
      this.drawChange(change, this.sOf(change.beat) - this.extras.before(change.beat) - change.width + CHANGE_PAD / 2);
    }

    // Notes, rests, beams, ties, slurs, tuplets.
    const sOf = b => this.sOf(b);
    const layout = engrave(score, { sOf, staffCenter: st => this.staffCenter(st), lineThickness: params.lineThickness });
    layoutSpanners(layout, score);
    for (const vis of layout.visuals) this.addVisual(vis);
    for (const g of layout.glyphs) this.addGlyph(g.kind, g.s, g.v, g.scale, g.tint);
    for (const t of layout.tubes) {
      const material = t.tint ? this.tubeMaterial(t.tint) : t.ledger ? this.lineMaterial : this.inkMaterial;
      this.tube(t.s0, t.s1, t.v0, t.v1, t.r, material);
    }
    for (const b of layout.bands) this.slab(b);

    for (const rest of score.rests) {
      let s = sOf(rest.start);
      if (rest.measureRest) s = (sOf(rest.start) + sOf(rest.start + rest.dur) - params.barGap) / 2;
      this.addGlyph(`rest:${rest.type}`, s, this.staffCenter(rest.staff));
    }
  }

  // Clef / key / time signature change, starting at s.
  drawChange(change, s) {
    let x = s;
    for (const c of change.clefs) this.addGlyph(`clef:${c.clef}`, x, this.staffCenter(c.staff), 0.75);
    if (change.clefs.length) x += 2.6;
    if (change.key) {
      this.score.staves.forEach((_, staff) => {
        const clef = this.score.clefAt(staff, change.beat);
        const items = keySignatureGlyphs(change.key.to, clef, change.key.cancel, change.key.from > 0);
        items.forEach(([name, pos], i) => this.addGlyph(`acc:${name}`, x + 0.5 + (i + 1) * 1.0 - 0.15, this.staffCenter(staff) + pos / 2));
      });
      x += (change.key.cancel.length + Math.abs(change.key.to)) * 1.0 + 0.8;
    }
    if (change.time) {
      this.score.staves.forEach((_, staff) => {
        const c = this.staffCenter(staff);
        this.addGlyph(`time:${change.time[0]}`, x + 1.3, c + 1);
        this.addGlyph(`time:${change.time[1]}`, x + 1.3, c - 1);
      });
    }
  }

  addVisual(vis) {
    const visual = { onset: this.score.timeOf(vis.beat) + vis.offset, color: new THREE.Color(this.params.noteColor), glow: null, scale: vis.scale };
    if (vis.glow) {
      visual.glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glyph("glow").texture, color: this.params.glowColor, transparent: true, depthWrite: false, opacity: 0,
      }));
      this.ribbon.pointAt(vis.s, vis.v, visual.glow.position);
      visual.glow.renderOrder = 2;
      visual.glow.layers.set(GLOW_LAYER);
      this.group.add(visual.glow);
    }
    this.visuals.set(vis.key, visual);
  }

  // Normal blending inside the main picture; additive (light on black) for the separate glow layer.
  setGlowAdditive(additive) {
    for (const vis of this.visuals.values()) {
      if (vis.glow) vis.glow.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    }
  }

  // Adds a glyph quad at (s, v). `tint` makes it follow a note's color (flash when played).
  addGlyph(kind, s, v, scale = 1, tint = null) {
    const g = glyph(kind);
    const material = new THREE.MeshBasicMaterial({
      map: g.texture, color: this.params.noteColor, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(QUAD, material);
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 1;
    this.group.add(mesh);
    this.quads.push({ mesh, s, v, g, scale, tint });
  }

  tubeMaterial(tint) {
    if (!this.tubeMaterials.has(tint)) this.tubeMaterials.set(tint, new THREE.MeshBasicMaterial({ color: this.params.noteColor }));
    return this.tubeMaterials.get(tint);
  }

  tube(s0, s1, v0, v1, radius, material) {
    const curve = new StaffCurve(this.ribbon, s0, s1, v0, v1);
    const len = Math.abs(s1 - s0) + Math.abs(v1 - v0);
    const segments = Math.max(2, Math.ceil(len * 3));
    curve.arcLengthDivisions = segments * 2;
    const geo = new THREE.TubeGeometry(curve, segments, radius, 6, false);
    this.group.add(new THREE.Mesh(geo, material));
  }

  // A band between two edges (va, vb) along the staff, as a thin slab on the ribbon.
  slab(points) {
    // Resample so the slab bends with the ribbon.
    const pts = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const steps = Math.max(1, Math.ceil(Math.abs(b.s - a.s) * 3));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        pts.push({ s: a.s + (b.s - a.s) * t, va: a.va + (b.va - a.va) * t, vb: a.vb + (b.vb - a.vb) * t });
      }
    }
    pts.push(points[points.length - 1]);

    const pos = [];
    const f = this.frame;
    const n = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (const q of pts) {
      this.ribbon.frameAt(q.s, f);
      n.crossVectors(f.T, f.U).multiplyScalar(SLAB_DEPTH / 2);
      for (const v of [q.va, q.vb]) {
        for (const side of [1, -1]) {
          p.copy(f.P).addScaledVector(f.U, v).addScaledVector(n, side);
          pos.push(p.x, p.y, p.z);
        }
      }
    }
    // Per sample: 0 = edge a front, 1 = a back, 2 = b front, 3 = b back.
    const index = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const o = i * 4;
      const q = o + 4;
      for (const [x, y] of [[0, 2], [1, 3], [0, 1], [2, 3]]) index.push(o + x, o + y, q + x, o + y, q + y, q + x);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(index);
    this.group.add(new THREE.Mesh(geo, this.inkMaterial));
  }

  update(t, camera) {
    const { params, frame } = this;
    const X = new THREE.Vector3();
    const Y = new THREE.Vector3();
    const at = new THREE.Vector3();

    // Note colors: flash to the glow color when played, settle to the played color.
    const base = new THREE.Color(params.noteColor);
    const played = new THREE.Color(params.playedColor);
    const hot = new THREE.Color(params.glowColor);
    for (const vis of this.visuals.values()) {
      const dt = t - vis.onset;
      if (dt < 0) {
        vis.color.copy(base);
        if (vis.glow) vis.glow.visible = false;
        continue;
      }
      const e = Math.exp(-dt / params.glowDecay) * Math.min(1, dt / 0.02 + 0.3);
      vis.color.copy(played).lerp(hot, Math.min(1, e * 1.2));
      if (!vis.glow) continue;
      vis.glow.visible = e > 0.01;
      vis.glow.material.opacity = e * params.glowStrength;
      const size = params.glowSize * vis.scale * (0.7 + 0.5 * (1 - e));
      vis.glow.scale.set(size, size, 1);
    }
    for (const [tint, material] of this.tubeMaterials) {
      const vis = this.visuals.get(tint);
      if (vis) material.color.copy(vis.color);
    }

    for (const q of this.quads) {
      this.ribbon.frameAt(q.s, frame);
      at.copy(frame.P).addScaledVector(frame.U, q.v);
      quadAxes(camera, at, frame.T, frame.U, params.readability, params.flipSharpness, X, Y);
      placeQuad(q.mesh, at, X, Y, q.g.w * q.scale, q.g.h * q.scale, q.g.ax, q.g.ay, camera);
      if (q.tint) {
        const vis = this.visuals.get(q.tint);
        if (vis) q.mesh.material.color.copy(vis.color);
      }
    }
  }

  dispose() {
    this.group.traverse(o => {
      if (o.geometry && o.geometry !== QUAD) o.geometry.dispose();
      if (o.material && o.material !== this.lineMaterial && o.material !== this.inkMaterial) o.material.dispose();
    });
    for (const m of this.tubeMaterials.values()) m.dispose();
    this.lineMaterial.dispose();
    this.inkMaterial.dispose();
  }
}
