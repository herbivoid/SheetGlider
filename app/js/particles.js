import * as THREE from "three";
import { makeFrame } from "./ribbon.js";
import { GLOW_LAYER, setLightBlending } from "./staff.js";
import { rand } from "./util.js";

// Pixel sparks: a small burst on each landing, and a steady trail while
// surfing a fast run.
//
// Nothing is simulated step by step: each particle's birth time, start point
// and velocity come from a seeded random generator, so its position at any
// time t is a formula. Scrubbing, preview and export all show the same sparks.
//
// Two styles:
//   light: on the glow layer, so in a separate-glow export they go with the
//          glow as additive light. Glows nicely, but over very bright footage
//          added light can only turn white.
//   paint: solid pixels in the main video that blink out instead of fading,
//          so they stay their own color over any footage.

const MAX = 4000;

export class Particles {
  constructor({ hero, ribbon, score, params, sOf }) {
    Object.assign(this, { hero, ribbon, score, params, sOf });
    this.positions = new Float32Array(MAX * 3);
    this.colors = new Float32Array(MAX * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.colors, 4));
    this.material = new THREE.PointsMaterial({
      size: params.particleSize, sizeAttenuation: true, vertexColors: true,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.frame = makeFrame();
    this.landings = hero.landings();
    this.runs = hero.runs;
  }

  // See setLightBlending in staff.js.
  setLightBlending(mode) {
    setLightBlending(this.material, mode);
  }

  update(t) {
    const P = this.params;
    const paint = P.sparkStyle === "paint";
    this.points.layers.set(paint ? 0 : GLOW_LAYER);
    this.material.size = P.particleSize;
    const glow = new THREE.Color(P.glowColor);
    const white = new THREE.Color(1, 1, 1);
    const tmpColor = new THREE.Color();
    const p0 = new THREE.Vector3();
    const v = new THREE.Vector3();
    let count = 0;

    const emit = (seed, birth, life, origin, frame, speed, spreadBack) => {
      if (count >= MAX) return;
      const age = t - birth;
      if (age < 0 || age > life) return;
      const r1 = rand(seed) * 2 - 1;
      const r2 = rand(seed + 1) * 2 - 1;
      const r3 = rand(seed + 2) * 2 - 1;
      // Velocity in the ribbon's own frame: backward (-T), up/down the staff (U), and in/out (N).
      const N = new THREE.Vector3().crossVectors(frame.T, frame.U);
      v.copy(frame.T).multiplyScalar(-spreadBack * (0.4 + 0.6 * rand(seed + 3)) + r1 * (1 - spreadBack))
        .addScaledVector(frame.U, r2 * 0.9 + 0.35)
        .addScaledVector(N, r3 * 0.5)
        .multiplyScalar(speed);
      const k = count * 3;
      // Gentle "gravity" toward the staff's own down, so sparks fall correctly on flipped sections too.
      const fall = -1.5 * age * age;
      this.positions[k] = origin.x + v.x * age + frame.U.x * fall;
      this.positions[k + 1] = origin.y + v.y * age + frame.U.y * fall;
      this.positions[k + 2] = origin.z + v.z * age + frame.U.z * fall;
      tmpColor.copy(glow).lerp(white, rand(seed + 4) * P.sparkWhiteness);
      // Light: brightness goes in alpha (the amount of light added). Paint: always solid.
      const fade = paint ? 1 : Math.pow(1 - age / life, 1.4) * P.sparkBrightness;
      const c = count * 4;
      this.colors[c] = tmpColor.r;
      this.colors[c + 1] = tmpColor.g;
      this.colors[c + 2] = tmpColor.b;
      this.colors[c + 3] = fade;
      count++;
    };

    // Landing bursts
    if (P.burstCount > 0) {
      const life = 0.45;
      for (let i = 0; i < this.landings.length; i++) {
        const n = this.landings[i];
        if (t < n.on || t > n.on + life) continue;
        const s = this.sOf(this.score.beatAt(n.on));
        this.ribbon.frameAt(s, this.frame);
        p0.copy(this.frame.P).addScaledVector(this.frame.U, n.p / 2);
        const count = Math.round(P.burstCount * Math.max(0, this.hero.gain(n))); // louder: more sparks
        for (let j = 0; j < count; j++) {
          emit(i * 977 + j * 13, n.on, life * (0.6 + 0.4 * rand(i * 31 + j)), p0, this.frame, 5, 0);
        }
      }
    }

    // Run trails
    if (P.trailRate > 0) {
      const life = 0.7;
      for (let r = 0; r < this.runs.length; r++) {
        const run = this.runs[r];
        const from = Math.max(run.t0, t - life);
        const to = Math.min(run.t1, t);
        if (to < from) continue;
        const first = Math.ceil((from - run.t0) * P.trailRate);
        const last = Math.floor((to - run.t0) * P.trailRate);
        for (let j = first; j <= last; j++) {
          const birth = run.t0 + j / P.trailRate;
          const s = this.sOf(this.score.beatAt(birth));
          this.ribbon.frameAt(s, this.frame);
          this.hero.positionAt(birth, p0);
          emit(100003 + r * 7919 + j * 17, birth, life * (0.5 + 0.5 * rand(r * 131 + j)), p0, this.frame, 4, 0.8);
        }
      }
    }

    const geo = this.points.geometry;
    geo.setDrawRange(0, count);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
