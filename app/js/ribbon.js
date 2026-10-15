import * as THREE from "three";
import { monotoneCubic } from "./util.js";

// The staff lives on a "ribbon": a 3D spine curve with a twist angle along it.
// A point on the staff at distance `s` along the spine and height `v` (staff
// spaces from the middle line) is  spine(s) + v * up(s).
//
// up(s) comes from one of two frame modes, then is rotated about the spine's
// tangent by the twist angle:
//   "world" (default): world-up projected perpendicular to the spine, so an
//            untwisted ribbon stays upright. Right for paths that travel mostly
//            sideways or into the distance.
//   "axis":  axis × tangent, for paths curling within a plane (loops, spirals):
//            the staff's top keeps pointing toward the inside of the curl.

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class Ribbon {
  // shape: { points: [{ p: [x, y, z], twist: degrees }], frame?: { mode, axis } }
  constructor(shape) {
    const controlPoints = shape.points;
    const axisMode = shape.frame?.mode === "axis";
    const axis = new THREE.Vector3(...(shape.frame?.axis ?? [0, 0, 1])).normalize();
    this.controlPoints = controlPoints;
    const pts = controlPoints.map(c => new THREE.Vector3(...c.p));
    this.curve = new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5);
    this.curve.arcLengthDivisions = Math.max(200, pts.length * 100);
    this.length = this.curve.getLength();

    // Arc length of each control point, to key the twist values.
    const per = 64;
    const lengths = this.curve.getLengths((pts.length - 1) * per);
    const keyS = controlPoints.map((_, j) => lengths[j * per]);
    const twist = monotoneCubic(keyS, controlPoints.map(c => THREE.MathUtils.degToRad(c.twist ?? 0)));

    const n = Math.max(512, Math.ceil(this.length * 6));
    this.samples = n;
    this.P = new Float32Array((n + 1) * 3);
    this.T = new Float32Array((n + 1) * 3);
    this.U = new Float32Array((n + 1) * 3);
    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    const u = new THREE.Vector3();
    const side = new THREE.Vector3();
    const prevU = new THREE.Vector3().copy(WORLD_UP);
    for (let i = 0; i <= n; i++) {
      const a = i / n;
      this.curve.getPointAt(a, p);
      this.curve.getTangentAt(a, t).normalize();
      if (axisMode) u.crossVectors(axis, t);
      else u.copy(WORLD_UP).addScaledVector(t, -t.dot(WORLD_UP));
      if (u.lengthSq() < 0.0025) {
        // Degenerate (spine parallel to the reference): carry the previous up vector along.
        u.copy(prevU).addScaledVector(t, -t.dot(prevU));
      }
      u.normalize();
      prevU.copy(u);
      const angle = twist(a * this.length);
      side.crossVectors(t, u);
      u.multiplyScalar(Math.cos(angle)).addScaledVector(side, Math.sin(angle));
      p.toArray(this.P, i * 3);
      t.toArray(this.T, i * 3);
      u.toArray(this.U, i * 3);
    }
  }

  // Fills out.P (spine point), out.T (tangent), out.U (staff up) at arc length s.
  // Beyond either end the ribbon continues straight.
  frameAt(s, out) {
    const n = this.samples;
    const f = THREE.MathUtils.clamp(s / this.length, 0, 1) * n;
    const i = Math.min(n - 1, Math.floor(f));
    const k = f - i;
    lerp3(this.P, i, k, out.P);
    lerp3(this.T, i, k, out.T).normalize();
    lerp3(this.U, i, k, out.U);
    out.U.addScaledVector(out.T, -out.T.dot(out.U)).normalize();
    if (s < 0) out.P.addScaledVector(out.T, s);
    else if (s > this.length) out.P.addScaledVector(out.T, s - this.length);
    return out;
  }

  pointAt(s, v, target = new THREE.Vector3()) {
    this.frameAt(s, _frame);
    return target.copy(_frame.P).addScaledVector(_frame.U, v);
  }

  // Bounding box of the ribbon between s0 and s1, for staff heights vRange = [low, high].
  bounds(s0, s1, [low, high]) {
    const box = new THREE.Box3();
    const steps = Math.max(32, Math.ceil((s1 - s0) * 2));
    const v = new THREE.Vector3();
    for (let i = 0; i <= steps; i++) {
      const s = s0 + ((s1 - s0) * i) / steps;
      for (const h of [low, high]) box.expandByPoint(this.pointAt(s, h, v));
    }
    return box;
  }
}

export function makeFrame() {
  return { P: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3() };
}
const _frame = makeFrame();

function lerp3(arr, i, k, out) {
  const a = i * 3;
  const b = a + 3;
  return out.set(
    arr[a] + (arr[b] - arr[a]) * k,
    arr[a + 1] + (arr[b + 1] - arr[a + 1]) * k,
    arr[a + 2] + (arr[b + 2] - arr[a + 2]) * k,
  );
}
