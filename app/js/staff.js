import * as THREE from "three";
import { METRICS, glyph } from "./glyphs.js";
import { makeFrame } from "./ribbon.js";
import { placeQuad, quadAxes } from "./facing.js";
import { CHANGE_PAD, changesAt, engrave, keySignatureGlyphs } from "./engrave.js";
import { layoutSpanners } from "./spanners.js";
import { layoutExpression } from "./expression.js";
import { layoutTab } from "./tab.js";
import { DEFAULT_LOUDNESS, isTab, staffHalf, stringV } from "./score.js";

// Draws everything on the ribbon. The notation itself is laid out flat by
// engrave.js / spanners.js; here it's mapped onto the ribbon:
//   glyphs  -> quads re-oriented every frame (see facing.js)
//   tubes   -> thin tubes (staff lines, stems, ledger lines): visible from any angle
//   bands   -> thin slabs following the ribbon (beams, ties, slurs)

export const STAFF_GAP = 10; // distance between staff centers (grand staff), in staff spaces
export const GLOW_LAYER = 1;  // glows render on their own layer, so they can be exported separately

// How light (glows, light-style sparks, tail light) is blended:
//   "normal":   a semi-transparent tint, like everything else
//   "additive": light added onto opaque black (the separate glow layer)
export function setLightBlending(material, mode) {
  material.blending = mode === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending;
}
const QUAD = new THREE.PlaneGeometry(1, 1);
const SLAB_DEPTH = 0.06;

// Reveal: notation fades in as the character's "front" (a little ahead of him)
// passes it. Lines and bands carry their distance along the staff per vertex
// (aS), so they grow ahead of him; glyphs fade in whole.
function revealFactor(s, front, fade) {
  return 1 - THREE.MathUtils.smoothstep(s, front - fade, front);
}

// Adds the reveal to a material's shader: alpha × (1 at front - fade … 0 at front).
// Declares aS / vS, which the tail materials use too.
function patchReveal(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute float aS;\nvarying float vS;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvS = aS;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying float vS;\nuniform float uFront;\nuniform float uFade;")
    .replace("#include <alphamap_fragment>", "#include <alphamap_fragment>\ndiffuseColor.a *= 1.0 - smoothstep(uFront - uFade, uFront, vS);");
}

// Horizontal layout of the start of the staff (clef, key signature, time signature).
export function headerLayout(score) {
  const clefX = 0.8;
  const keyX = clefX + METRICS.clef + 0.5;
  const nKey = score.staves.some(st => !isTab(st)) ? Math.abs(score.keyFifths) : 0; // tab shows no key
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
    // Shared by every line and band material (see patchReveal). No reveal: front at infinity.
    this.revealUniforms = { uFront: { value: 1e6 }, uFade: { value: 1 } };
    // Everything is "transparent" so depth fog can fade it out (see fog.js).
    this.lineMaterial = this.revealing(new THREE.MeshBasicMaterial({ color: params.staffColor, transparent: true }));
    this.inkMaterial = this.revealing(new THREE.MeshBasicMaterial({ color: params.noteColor, side: THREE.DoubleSide, transparent: true }));
    this.header = headerLayout(score);
    this.sEnd = this.sOf(score.endBeat) + 3;
    // Tab rhythm (stems below the tab): "auto" shows it unless a standard staff already does.
    this.tabRhythm = params.tabRhythm === "show" || (params.tabRhythm === "auto" && score.staves.every(isTab));
    this.frame = makeFrame();
    this.build();
  }

  sOf(beat) { return this.header.width + this.spacing.x(beat); }
  staffCenter(staff) { return -staff * STAFF_GAP; }
  staffTop(staff) { return this.staffCenter(staff) + staffHalf(this.score.staves[staff]); }
  staffBottom(staff) { return this.staffCenter(staff) - staffHalf(this.score.staves[staff]); }

  // [lowest, highest] height (staff spaces) that should stay in view.
  vRange() {
    const staves = this.score.staves;
    const last = staves.length - 1;
    const below = isTab(staves[last]) && this.tabRhythm ? 4.5 : 1;
    const above = isTab(staves[0]) ? 2.5 : 1; // room for bend arrows
    return [this.staffBottom(last) - below, this.staffTop(0) + above];
  }

  revealing(material) {
    material.customProgramCacheKey = () => "sheetglider-reveal";
    material.onBeforeCompile = shader => patchReveal(shader, this.revealUniforms);
    return material;
  }

  build() {
    const { score, params, header } = this;
    const lw = params.lineThickness / 2;
    const n = score.staves.length;
    const top = this.staffTop(0);
    const bottom = this.staffBottom(n - 1);

    // Staff lines (tab lines come later, with gaps behind the fret numbers) and
    // the opening clef / key / time signature.
    score.staves.forEach((staffDef, staff) => {
      const c = this.staffCenter(staff);
      if (isTab(staffDef)) {
        this.addGlyph(`clef:tab:${staffDef.lines ?? 6}`, header.clefX, c);
      } else {
        for (let l = -2; l <= 2; l++) this.tube(0, this.sEnd, c + l, c + l, lw, this.lineMaterial);
        this.addGlyph(`clef:${staffDef.clef}`, header.clefX, c);
        keySignatureGlyphs(score.keyFifths, staffDef.clef).forEach(([name, pos], i) => {
          this.addGlyph(`acc:${name}`, header.keyX + (i + 1) * METRICS.keyAccidental - 0.15, c + pos / 2);
        });
      }
      this.timeSignature(score.timeSig, header.timeX, staff);
    });

    // System start line (+ brace for a piano's staves).
    this.tube(0, 0, bottom, top, lw, this.lineMaterial);
    if (n > 1 && !score.staves.some(isTab)) this.addGlyph(`brace:${top - bottom}`, 0, (top + bottom) / 2);

    // Barlines (plain, final, or repeat signs), with any clef/key/time changes just after them.
    const key = b => Math.round(b * 960);
    const changes = new Map(changesAt(score).map(c => [key(c.beat), c]));
    const repeats = new Map();
    for (const r of score.repeats) repeats.set(key(r.beat), { ...repeats.get(key(r.beat)), [r.dir]: true });
    const barSet = new Set(score.bars.map(key));
    const line = (s, thick) => this.tube(s, s, bottom, top, thick ? 0.25 : lw * 1.2, this.lineMaterial);
    const dots = s => score.staves.forEach((def, st) => {
      const dv = isTab(def) ? 1.5 : 0.5; // in the spaces either side of the middle
      for (const d of [-dv, dv]) this.addGlyph("dot", s, this.staffCenter(st) + d);
    });
    for (const bar of [0, ...score.bars]) {
      const rep = repeats.get(key(bar));
      const final = Math.abs(bar - score.endBeat) < 1e-6;
      if (bar === 0 && !rep) continue; // the system line already starts the staff
      const s = final ? this.sEnd - 0.2 : this.barlineS(bar) - (rep ? 0.6 : 0);
      if (final) {
        line(s - 0.55);
        line(s, true);
        if (rep?.end) dots(s - 1.2);
      } else if (rep?.end && rep?.start) {
        line(s - 0.45); line(s, true); line(s + 0.45);
        dots(s - 0.95); dots(s + 0.75);
      } else if (rep?.end) {
        line(s - 0.45); line(s + 0.05, true);
        dots(s - 0.95);
      } else if (rep?.start) {
        line(s, true); line(s + 0.45);
        dots(s + 0.75);
      } else {
        line(s);
      }
      const change = changes.get(key(bar));
      if (change && !final) this.drawChange(change, this.barlineS(bar) + CHANGE_PAD / 2);
    }
    // Changes in the middle of a bar (usually a clef) go right before their notes.
    for (const change of changes.values()) {
      if (barSet.has(key(change.beat))) continue;
      this.drawChange(change, this.sOf(change.beat) - this.extras.before(change.beat) - change.width + CHANGE_PAD / 2);
    }
    this.drawVoltas();

    // Notes, rests, beams, ties, slurs, tuplets, dynamics, articulations, lyrics, tails.
    const sOf = b => this.sOf(b);
    const staffCenter = st => this.staffCenter(st);
    const layout = engrave(score, { sOf, staffCenter, lineThickness: params.lineThickness, tabRhythm: this.tabRhythm });
    layoutSpanners(layout, score);
    layoutTab(layout, score, { sOf, staffCenter });
    layoutExpression(layout, score, { sOf, staffCenter, params });
    score.staves.forEach((def, staff) => { if (isTab(def)) this.tabLines(staff, def, layout.lineGaps, lw); });
    for (const vis of layout.visuals) this.addVisual(vis);
    for (const g of layout.glyphs) this.addGlyph(g.kind, g.s, g.v, g.scale, g.tint);
    for (const t of layout.tubes) {
      const material = t.tint ? this.tubeMaterial(t.tint) : t.ledger ? this.lineMaterial : this.inkMaterial;
      this.tube(t.s0, t.s1, t.v0, t.v1, t.r, material);
    }
    for (const b of layout.bands) this.slab(b);
    this.litTails = [];
    for (const t of layout.tails) {
      this.slab(t, this.tailMaterial("base"));
      this.litTails.push(this.slab(t, this.tailMaterial("lit")));
    }

    for (const rest of score.rests) {
      let s = sOf(rest.start);
      if (rest.measureRest) s = (sOf(rest.start) + sOf(rest.start + rest.dur) - params.barGap) / 2;
      this.addGlyph(`rest:${rest.type}`, s, this.staffCenter(rest.staff));
    }
  }

  // A tab staff's lines, broken where fret numbers sit on them.
  tabLines(staff, def, gaps, lw) {
    const lines = def.lines ?? 6;
    for (let string = 1; string <= lines; string++) {
      const v = this.staffCenter(staff) + stringV(string, lines);
      const here = gaps.filter(g => g.staff === staff && Math.abs(g.v - v) < 1e-3).sort((a, b) => a.s0 - b.s0);
      let s = 0;
      for (const g of here) {
        if (g.s0 > s + 0.35) this.tube(s, g.s0, v, v, lw, this.lineMaterial); // (scraps would look like dots)
        s = Math.max(s, g.s1);
      }
      if (this.sEnd > s + 0.35) this.tube(s, this.sEnd, v, v, lw, this.lineMaterial);
    }
  }

  // A time signature; a little larger on tab, whose lines are further apart.
  timeSignature([num, den], s, staff) {
    const k = isTab(this.score.staves[staff]) ? 1.25 : 1;
    const c = this.staffCenter(staff);
    this.addGlyph(`time:${num}`, s, c + k, k);
    this.addGlyph(`time:${den}`, s, c - k, k);
  }

  // Where the barline before `bar` (a beat) sits: before the room taken by
  // changes, accidentals and grace notes in front of the bar's first notes.
  barlineS(bar) {
    const change = changesAt(this.score).find(c => Math.abs(c.beat - bar) < 1e-6);
    return this.sOf(bar) - this.extras.before(bar) - (change?.width ?? 0) - this.params.barGap * 0.55;
  }

  // 1st/2nd endings: a bracket over their bars with the number, open at the end of the last one.
  drawVoltas() {
    const voltas = [...this.score.voltas].sort((a, b) => a.start - b.start);
    const top = this.staffTop(0) + (isTab(this.score.staves[0]) ? 1.8 : 0); // tab: above bend arrows
    const staffHigh = Math.max(top, ...this.score.notes.filter(nt => nt.staff === 0).map(nt => nt.pos / 2));
    // With lyrics under the staff, dynamics move above it (expression.js): go above those too.
    const P = this.params;
    const dynamicsAbove = P.showDynamics && P.showLyrics && this.score.dynamics.length
      && this.score.elements.some(e => e.staff === 0 && e.lyrics?.length);
    voltas.forEach((vo, i) => {
      let high = top;
      for (const nt of this.score.notes) {
        if (nt.staff === 0 && nt.start >= vo.start - 1e-6 && nt.start < vo.end - 1e-6) high = Math.max(high, nt.pos / 2);
      }
      const v = Math.max(high + 3, dynamicsAbove ? Math.max(this.staffCenter(0) + 4.5, staffHigh + 2.2) + 2.6 : 0);
      const x0 = (vo.start === 0 ? this.sOf(0) - 1 : this.barlineS(vo.start)) + 0.3;
      const x1 = (Math.abs(vo.end - this.score.endBeat) < 1e-6 ? this.sEnd - 0.8 : this.barlineS(vo.end)) - 0.3;
      this.tube(x0, x1, v, v, 0.05, this.inkMaterial);
      this.tube(x0, x0, v - 1.5, v, 0.05, this.inkMaterial);
      const closed = voltas[i + 1] && Math.abs(voltas[i + 1].start - vo.end) < 1e-6;
      if (closed) this.tube(x1, x1, v - 1.5, v, 0.05, this.inkMaterial);
      this.addGlyph(`text:label:${vo.label}`, x0 + 0.9, v - 1.25);
    });
  }

  // Duration tails are drawn twice, sharing their uniforms:
  //   "base": the bar itself (note color, played color once passed), at the tail
  //           opacity (0 by default, so invisible). Main picture.
  //   "lit":  the glow behind the character, fading out over ~8 spaces. On the
  //           glow layer or in the main picture, following the spark style.
  tailMaterial(mode) {
    this.tailMats ??= {};
    if (this.tailMats[mode]) return this.tailMats[mode];
    const P = this.params;
    this.tailUniforms ??= {
      uNow: { value: -1e9 },
      uLit: { value: new THREE.Color(P.glowColor) },
      uPlayed: { value: new THREE.Color(P.playedColor) },
      uAlpha: { value: P.tailOpacity },
    };
    const look = mode === "lit"
      ? "vec4 diffuseColor = vec4(uLit, past > 0.0 ? 0.9 * clamp(1.0 - past / 8.0, 0.0, 1.0) : 0.0);"
      : "vec4 diffuseColor = vec4(past > 0.0 ? uPlayed : diffuse, uAlpha);";
    const m = new THREE.MeshBasicMaterial({ color: P.noteColor, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    m.customProgramCacheKey = () => `sheetglider-tail-${mode}`;
    m.onBeforeCompile = shader => {
      patchReveal(shader, this.revealUniforms);
      Object.assign(shader.uniforms, this.tailUniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uNow;\nuniform vec3 uLit;\nuniform vec3 uPlayed;\nuniform float uAlpha;")
        .replace("vec4 diffuseColor = vec4( diffuse, opacity );", `float past = uNow - vS; // > 0: the character has passed here\n${look}`);
    };
    this.tailMats[mode] = m;
    return m;
  }

  // Clef / key / time signature change, starting at s.
  drawChange(change, s) {
    let x = s;
    for (const c of change.clefs) {
      if (!isTab(this.score.staves[c.staff]) && c.clef !== "tab") this.addGlyph(`clef:${c.clef}`, x, this.staffCenter(c.staff), 0.75);
    }
    if (change.clefs.length) x += 2.6;
    if (change.key) {
      this.score.staves.forEach((def, staff) => {
        if (isTab(def)) return;
        const clef = this.score.clefAt(staff, change.beat);
        const items = keySignatureGlyphs(change.key.to, clef, change.key.cancel, change.key.from > 0);
        items.forEach(([name, pos], i) => this.addGlyph(`acc:${name}`, x + 0.5 + (i + 1) * 1.0 - 0.15, this.staffCenter(staff) + pos / 2));
      });
      x += (change.key.cancel.length + Math.abs(change.key.to)) * 1.0 + 0.8;
    }
    if (change.time) this.score.staves.forEach((_, staff) => this.timeSignature(change.time, x + 1.3, staff));
  }

  addVisual(vis) {
    const visual = {
      onset: this.score.timeOf(vis.beat) + vis.offset, color: new THREE.Color(this.params.noteColor),
      glow: null, scale: vis.scale,
      loud: this.score.loudness(vis.note.staff, vis.note.start),
      accent: vis.note.artic?.some(a => a === "accent" || a === "marcato"),
    };
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

  // See setLightBlending: "normal" in the preview, other modes while exporting light.
  setLightBlending(mode) {
    for (const vis of this.visuals.values()) if (vis.glow) setLightBlending(vis.glow.material, mode);
    if (this.tailMats?.lit) setLightBlending(this.tailMats.lit, mode);
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
    // Numbers and words stay readable where the staff turns upside down (see facing.js).
    const upright = /^(fret|text|dyn|tuplet):/.test(kind);
    this.quads.push({ mesh, s, v, g, scale, tint, upright });
  }

  tubeMaterial(tint) {
    if (!this.tubeMaterials.has(tint)) {
      this.tubeMaterials.set(tint, this.revealing(new THREE.MeshBasicMaterial({ color: this.params.noteColor, transparent: true })));
    }
    return this.tubeMaterials.get(tint);
  }

  tube(s0, s1, v0, v1, radius, material) {
    const curve = new StaffCurve(this.ribbon, s0, s1, v0, v1);
    const len = Math.abs(s1 - s0) + Math.abs(v1 - v0);
    const segments = Math.max(2, Math.ceil(len * 3));
    curve.arcLengthDivisions = segments * 2;
    const geo = new THREE.TubeGeometry(curve, segments, radius, 6, false);
    // Distance along the staff per vertex, for the reveal. The tube's uv.x runs
    // along its arc length; map that back to the curve parameter.
    const uv = geo.attributes.uv;
    const along = new Float32Array(uv.count);
    for (let i = 0; i < uv.count; i++) along[i] = s0 + (s1 - s0) * curve.getUtoTmapping(uv.getX(i));
    geo.setAttribute("aS", new THREE.BufferAttribute(along, 1));
    this.group.add(new THREE.Mesh(geo, material));
  }

  // A band between two edges (va, vb) along the staff, as a thin slab on the ribbon.
  // Each vertex also carries its distance along the staff (aS), for the tail effect and the reveal.
  slab(points, material = this.inkMaterial) {
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
    const along = [];
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
          along.push(q.s);
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
    geo.setAttribute("aS", new THREE.Float32BufferAttribute(along, 1));
    geo.setIndex(index);
    const mesh = new THREE.Mesh(geo, material);
    this.group.add(mesh);
    return mesh;
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
      // Louder (and accented) notes glow bigger and brighter.
      const gain = 1 + params.dynamicsEffect * (vis.loud - DEFAULT_LOUDNESS) * 1.6 + (vis.accent ? 0.3 : 0);
      vis.glow.visible = e > 0.01;
      vis.glow.material.opacity = Math.min(1, e * params.glowStrength * gain);
      const size = params.glowSize * vis.scale * gain * (0.7 + 0.5 * (1 - e));
      vis.glow.scale.set(size, size, 1);
    }
    for (const [tint, material] of this.tubeMaterials) {
      const vis = this.visuals.get(tint);
      if (vis) material.color.copy(vis.color);
    }
    // Duration tails light up up to where the character is now. Their light follows
    // the spark style: glow layer ("light"), or solid in the main picture ("paint").
    const tailLayer = params.sparkStyle === "paint" ? 0 : GLOW_LAYER;
    for (const mesh of this.litTails) mesh.layers.set(tailLayer);
    const sNow = this.sOf(this.score.beatAt(t)); // where the character is along the staff
    if (this.tailUniforms) {
      this.tailUniforms.uNow.value = sNow;
      this.tailUniforms.uLit.value.set(params.glowColor);
      this.tailUniforms.uPlayed.value.set(params.playedColor);
      this.tailUniforms.uAlpha.value = params.tailOpacity;
    }
    const front = params.reveal ? sNow + params.revealAhead : 1e6;
    const fade = Math.max(0.05, params.revealFade);
    this.revealUniforms.uFront.value = front;
    this.revealUniforms.uFade.value = fade;

    for (const q of this.quads) {
      const shown = revealFactor(q.s, front, fade);
      q.mesh.visible = shown > 0;
      if (!shown) continue;
      q.mesh.material.opacity = shown;
      this.ribbon.frameAt(q.s, frame);
      at.copy(frame.P).addScaledVector(frame.U, q.v);
      quadAxes(camera, at, frame.T, frame.U, params.readability, params.flipSharpness, X, Y, 0, q.upright);
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
