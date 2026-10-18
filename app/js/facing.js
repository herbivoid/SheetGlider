import * as THREE from "three";

// Orientation of flat things (note glyphs, the character) placed on the ribbon.
//
// "Printed" axes are the ribbon's own (T along the staff, U up the staff): fully
// physical, so a glyph thins to a sliver when the ribbon is seen edge-on.
// "Billboard" axes face the camera instead: x follows the staff's direction on
// screen, y follows the staff's up direction on screen. When the ribbon turns
// edge-on, y can't keep pointing "up the staff", so it does a quick card-flip:
// full height until the ribbon is within `flipWidth` of edge-on, then it squashes
// through zero and comes back upside down. That flip is continuous, so nothing
// pops.
//
// `k` blends the two: 0 = printed, 1 = billboard. Glyphs use a user setting
// ("edge-on readability"); the character uses 1.
//
// `upright` (text, numbers): never mirrored or upside down. Instead of
// flipping with the staff, the glyph stays the right way up on screen, reading
// left to right, and only tilts with the staff's direction.

const _p0 = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const s0 = new THREE.Vector2();
const sT = new THREE.Vector2();
const sU = new THREE.Vector2();
const sR = new THREE.Vector2();
const STEP = 0.05;

function toScreen(camera, p, out) {
  _tmp.copy(p).project(camera);
  return out.set(_tmp.x * camera.aspect, _tmp.y);
}

function screenDelta(camera, P, dir, out) {
  _p0.copy(P).addScaledVector(dir, STEP);
  return toScreen(camera, _p0, out).sub(s0);
}

// Writes the quad's x/y axes (world-space vectors) into outX/outY.
// tilt (radians) rotates the billboard within the screen, in its own frame.
// Returns the signed facing of the staff's up direction (-1..1) for callers that care.
export function quadAxes(camera, P, T, U, k, flipWidth, outX, outY, tilt = 0, upright = false) {
  _right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  _up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();

  toScreen(camera, P, s0);
  screenDelta(camera, P, T, sT);
  screenDelta(camera, P, U, sU);
  const unit = screenDelta(camera, P, _right, sR).length() || 1;

  // Screen direction of travel (fallback: perpendicular to the staff's up).
  let xx, xy;
  if (sT.length() / unit > 1e-3) {
    const l = sT.length();
    xx = sT.x / l; xy = sT.y / l;
  } else if (sU.length() / unit > 1e-3) {
    const l = sU.length();
    xx = sU.y / l; xy = -sU.x / l;
  } else {
    xx = 1; xy = 0;
  }
  // Upright text reads left to right even where the staff runs leftward on screen.
  const along = upright && xx < 0 ? -1 : 1;
  xx *= along;
  xy *= along;
  // Screen normal to the staff direction, and how much of "up the staff" shows along it.
  const nx = -xy;
  const ny = xx;
  const c = (sU.x * nx + sU.y * ny) / unit;
  const sign = c < 0 ? -1 : 1;
  if (upright) {
    // Always the screen normal (no card-flip); the printed part turns to agree with it.
    outX.copy(_right).multiplyScalar(xx).addScaledVector(_up, xy);
    outY.copy(_right).multiplyScalar(nx).addScaledVector(_up, ny);
    if (k < 1) {
      outX.multiplyScalar(k).addScaledVector(T, (1 - k) * along);
      outY.multiplyScalar(k).addScaledVector(U, (1 - k) * sign);
    }
    return c;
  }
  const f = THREE.MathUtils.smoothstep(Math.abs(c), 0, Math.max(1e-4, flipWidth));

  // Billboard frame in screen space, tilted in its own (possibly flipped) frame.
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const bxX = xx * cos + nx * sign * sin;
  const bxY = xy * cos + ny * sign * sin;
  const byX = (-xx * sin + nx * sign * cos) * f;
  const byY = (-xy * sin + ny * sign * cos) * f;

  outX.copy(_right).multiplyScalar(bxX).addScaledVector(_up, bxY);
  outY.copy(_right).multiplyScalar(byX).addScaledVector(_up, byY);
  if (k < 1) {
    outX.multiplyScalar(k).addScaledVector(T, 1 - k);
    outY.multiplyScalar(k).addScaledVector(U, 1 - k);
  }
  return c;
}

// Places a unit quad (PlaneGeometry(1, 1)) with the given axes and size so that
// its anchor (ax, ay in 0..1 from bottom-left) sits at `at`.
const _z = new THREE.Vector3();
const _pos = new THREE.Vector3();
export function placeQuad(mesh, at, X, Y, w, h, ax, ay, camera) {
  _z.setFromMatrixColumn(camera.matrixWorld, 2).normalize();
  _pos.copy(at).addScaledVector(X, -w * (ax - 0.5)).addScaledVector(Y, -h * (ay - 0.5));
  const e = mesh.matrix.elements;
  e[0] = X.x * w; e[1] = X.y * w; e[2] = X.z * w; e[3] = 0;
  e[4] = Y.x * h; e[5] = Y.y * h; e[6] = Y.z * h; e[7] = 0;
  e[8] = _z.x; e[9] = _z.y; e[10] = _z.z; e[11] = 0;
  e[12] = _pos.x; e[13] = _pos.y; e[14] = _pos.z; e[15] = 1;
  mesh.matrixWorldNeedsUpdate = true;
}
