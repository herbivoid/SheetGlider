import * as THREE from "three";

// Side-scroller style follow camera.
//
// The camera keeps a fixed viewing angle and slides along with the character,
// but never past the ends of the ribbon. So if the whole ribbon fits in the
// frame, the camera simply never moves; whether it moves depends on the
// ribbon's size versus the frame, not on the length of the piece.
//
// Its path is "baked" once (a critically damped spring simulated at a fixed
// step), so any frame can be rendered in any order and always looks the same,
// which keeps preview scrubbing and export identical.

const RATE = 120; // bake samples per second

export class FollowCamera {
  constructor(params) {
    this.params = params;
  }

  frameWidth(aspect) {
    const P = this.params;
    return 2 * P.camDistance * Math.tan(THREE.MathUtils.degToRad(P.fov) / 2) * aspect;
  }

  // vRange: [lowest, highest] staff height (staff spaces) that must stay in view.
  bake({ t0, t1, aspect, ribbon, sEnd, vRange, positionAt }) {
    const P = this.params;
    const box = ribbon.bounds(0, sEnd, vRange);
    this.z0 = (box.min.z + box.max.z) / 2;
    const width = this.frameWidth(aspect);
    const margin = 3;
    const xMin = box.min.x - margin;
    const xMax = box.max.x + margin;
    // How wide the ribbon looks from this yaw: at 0° its x extent faces the
    // camera; at ±90° we look along x and its depth extent faces us instead.
    const yaw = THREE.MathUtils.degToRad(P.yaw);
    const across = Math.abs(Math.cos(yaw));
    const seen = (xMax - xMin) * across + (box.max.z - box.min.z) * Math.abs(Math.sin(yaw));
    const fits = seen <= width * 0.95;
    this.static = fits;
    const halfView = (width / 2) * across; // how much x the frame covers either side of center
    const baseY = (box.min.y + box.max.y) / 2;
    // If the ribbon is taller than the frame, never let the character leave the middle of it.
    const height = width / aspect;
    const fitsY = box.max.y - box.min.y <= height * 0.9;
    const band = height * 0.26;

    const n = Math.max(2, Math.ceil((t1 - t0) * RATE) + 1);
    this.t0 = t0;
    this.xs = new Float32Array(n);
    this.ys = new Float32Array(n);
    const pos = new THREE.Vector3();
    const target = t => {
      positionAt(t, pos);
      let x = fits ? (xMin + xMax) / 2 : pos.x + P.lead * width * Math.cos(yaw);
      if (!fits && xMax - xMin > 2 * halfView) x = THREE.MathUtils.clamp(x, xMin + halfView, xMax - halfView);
      let y = baseY + (pos.y - baseY) * P.followY;
      if (!fitsY) {
        const body = pos.y + P.characterSize * 0.6; // middle of the character, not its feet
        y = THREE.MathUtils.clamp(y, body - band, body + band);
      }
      return [x, y];
    };
    const w = Math.PI * 2 * P.camSmooth; // spring frequency (rad/s)
    let [x, y] = target(t0);
    let vx = 0;
    let vy = 0;
    const dt = 1 / RATE;
    for (let i = 0; i < n; i++) {
      const [tx, ty] = target(t0 + i * dt);
      vx += (w * w * (tx - x) - 2 * w * vx) * dt;
      vy += (w * w * (ty - y) - 2 * w * vy) * dt;
      x += vx * dt;
      y += vy * dt;
      this.xs[i] = x;
      this.ys[i] = y;
    }
  }

  apply(camera, t) {
    const P = this.params;
    const f = THREE.MathUtils.clamp((t - this.t0) * RATE, 0, this.xs.length - 1);
    const i = Math.min(this.xs.length - 2, Math.floor(f));
    const k = f - i;
    const x = this.xs[i] + (this.xs[i + 1] - this.xs[i]) * k;
    const y = this.ys[i] + (this.ys[i + 1] - this.ys[i]) * k;
    const yaw = THREE.MathUtils.degToRad(P.yaw);
    const pitch = THREE.MathUtils.degToRad(P.pitch);
    const look = new THREE.Vector3(x, y, this.z0);
    camera.fov = P.fov;
    camera.near = 0.5;
    camera.far = 2000;
    camera.position.set(
      x + P.camDistance * Math.sin(yaw) * Math.cos(pitch),
      y + P.camDistance * Math.sin(pitch),
      this.z0 + P.camDistance * Math.cos(yaw) * Math.cos(pitch),
    );
    camera.lookAt(look);
    camera.rotateZ(THREE.MathUtils.degToRad(P.roll));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }
}
