// Ribbon shape presets. Each takes the staff length L (staff spaces) and returns
// control points [{ p: [x, y, z], twist: degrees }]. +x is "forward in time",
// +z is toward the camera. The curve editor (Phase 2) will replace these with
// user-designed shapes saved as the same JSON.

const along = (L, fracs, fn) => fracs.map((f, i) => fn(f * L, i, f));

export const RIBBON_PRESETS = {
  flat: L => along(L, [0, 1 / 3, 2 / 3, 1], x => ({ p: [x, 0, 0], twist: 0 })),

  // Starts far away, swoops close to the camera, then recedes again.
  approach: L => {
    const ys = [4, 1.5, -1, 0, 2.5];
    const zs = [-60, -22, 22, 2, -40];
    return along(L, [0, 0.25, 0.5, 0.75, 1], (x, i) => ({ p: [x, ys[i], zs[i]], twist: 0 }));
  },

  // Gradually twists to upside down, holds, then twists the rest of the way round.
  twist: L => {
    const tw = [0, 0, 0, 90, 180, 180, 270, 360, 360];
    const zs = [0, -3, 0, 4, 6, 2, -2, 0, 0];
    return along(L, [0, 0.15, 0.28, 0.38, 0.48, 0.6, 0.72, 0.84, 1],
      (x, i) => ({ p: [x, 0, zs[i]], twist: tw[i] }));
  },

  // Continuous slow corkscrew.
  corkscrew: L => along(L, [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1],
    (x, i) => ({ p: [x, 0, 0], twist: i * 90 })),

  // Up/down and near/far waves with a gentle banking twist.
  rollercoaster: L => along(L, [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
    (x, i, f) => ({
      p: [x, 5 * Math.sin(f * Math.PI * 6), 14 * Math.sin(f * Math.PI * 4 + 1)],
      twist: 35 * Math.sin(f * Math.PI * 6 + 0.8),
    })),
};
