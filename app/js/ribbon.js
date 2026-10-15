import * as THREE from "three";

// The staff lives on a "ribbon": a 3D spine curve with a twist angle along it.
// A point on the staff at distance `s` along the spine and height `v` (staff
// spaces from the middle line) is  spine(s) + v * up(s).
//
// up(s) is world-up projected perpendicular to the spine, then rotated about the
// spine's tangent by the twist angle, so an untwisted ribbon stays upright.

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class Ribbon {
  // controlPoints: [{ p: [x, y, z], twist: degrees }]
  constructor(controlPoints) {
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
      u.copy(WORLD_UP).addScaledVector(t, -t.dot(WORLD_UP));
      if (u.lengthSq() < 0.0025) {
        // Spine is (nearly) vertical: carry the previous up vector along instead.
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

  bounds(s0, s1, margin = 0) {
    const box = new THREE.Box3();
    const steps = Math.max(32, Math.ceil((s1 - s0) * 2));
    const v = new THREE.Vector3();
    for (let i = 0; i <= steps; i++) {
      const s = s0 + ((s1 - s0) * i) / steps;
      for (const h of [-margin, margin]) box.expandByPoint(this.pointAt(s, h, v));
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

// Monotone cubic (Fritsch–Carlson) interpolation: smooth, and never overshoots
// the given values, so a twist from 0° to 180° doesn't wobble past 180°.
function monotoneCubic(xs, ys) {
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-9, xs[i + 1] - xs[i]));
  const m = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const tau = 3 / Math.sqrt(h);
      m[i] = tau * a * d[i];
      m[i + 1] = tau * b * d[i];
    }
  }
  return x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i]
      + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
