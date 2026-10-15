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

  bake({ t0, t1, aspect, ribbon, sEnd, positionAt }) {
    const P = this.params;
    const box = ribbon.bounds(0, sEnd, 3);
    this.z0 = (box.min.z + box.max.z) / 2;
    const width = this.frameWidth(aspect);
    const margin = 2;
    const xMin = box.min.x - margin;
    const xMax = box.max.x + margin;
    const fits = xMax - xMin <= width * 0.95;
    this.static = fits;
    const baseY = (box.min.y + box.max.y) / 2;

    const n = Math.max(2, Math.ceil((t1 - t0) * RATE) + 1);
    this.t0 = t0;
    this.xs = new Float32Array(n);
    this.ys = new Float32Array(n);
    const pos = new THREE.Vector3();
    const target = t => {
      positionAt(t, pos);
      let x = fits ? (xMin + xMax) / 2 : pos.x + P.lead * width;
      if (!fits) x = THREE.MathUtils.clamp(x, xMin + width / 2, xMax - width / 2);
      const y = baseY + (pos.y - baseY) * P.followY;
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
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }
}
