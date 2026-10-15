import { monotoneCubic } from "./util.js";

// Ribbon shapes. Each preset takes the staff length L (staff spaces) and returns
// { at(f) -> { x, y, z, twist }, frame? } for f from 0 (start of the music) to 1
// (end). +x is forward in time, +y up, +z toward the camera, twist in degrees.
// `frame` picks how the staff's "up" is defined (see ribbon.js); loops and
// spirals curl in the screen plane, so they use the "axis" mode.
//
// buildShape() samples a preset, layers the shape tweaks on top (scales, arch,
// waves, extra twists), and rescales so the ribbon's length matches the music.

const TAU = Math.PI * 2;
const keys = (fracs, values) => monotoneCubic(fracs, values);
const ramp = (f, at, over) => {
  const u = Math.min(1, Math.max(0, (f - (at - over / 2)) / Math.max(1e-6, over)));
  return u * u * (3 - 2 * u);
};
const straight = L => f => ({ x: f * L, y: 0, z: 0, twist: 0 });

function keyed(L, fracs, { y, z, twist }) {
  const fy = y ? keys(fracs, y) : () => 0;
  const fz = z ? keys(fracs, z) : () => 0;
  const ft = twist ? keys(fracs, twist) : () => 0;
  return { at: f => ({ x: f * L, y: fy(f), z: fz(f), twist: ft(f) }) };
}

export const RIBBON_PRESETS = {
  flat: L => ({ at: straight(L) }),

  // A bridge: rises through the middle and comes back down.
  arch: L => {
    const h = Math.min(0.14 * L, 30);
    return { at: f => ({ x: f * L, y: h * Math.sin(Math.PI * f), z: 0, twist: 0 }) };
  },

  // The opposite: dips down through the middle.
  valley: L => {
    const h = Math.min(0.14 * L, 30);
    return { at: f => ({ x: f * L, y: -h * Math.sin(Math.PI * f), z: 0, twist: 0 }) };
  },

  // Steep banked drop at the start, then flat to the end.
  waterslide: L => keyed(L, [0, 0.06, 0.16, 0.26, 0.36, 1], {
    y: [26, 22, 8, 1, 0, 0],
    z: [-18, -14, 4, 3, 0, 0],
    twist: [0, 0, 28, 10, 0, 0],
  }),

  // Starts far away, swoops close to the camera, then recedes again.
  approach: L => keyed(L, [0, 0.25, 0.5, 0.75, 1], {
    y: [4, 1.5, -1, 0, 2.5],
    z: [-60, -22, 22, 2, -40],
  }),

  // Flies in from far away, then settles in front of the camera.
  "fly-in": L => keyed(L, [0, 0.35, 1], { y: [18, 0, 0], z: [-140, 0, 0] }),

  // Stays put, then flies off into the distance at the end.
  "fly-away": L => keyed(L, [0, 0.6, 1], { y: [0, 0, 14], z: [0, 0, -160] }),

  // Two close passes by the camera.
  swoop: L => keyed(L, [0, 0.25, 0.5, 0.75, 1], {
    y: [3, -1, 2, -1, 3],
    z: [-40, 18, -30, 18, -40],
  }),

  // Weaves toward and away from the camera.
  slalom: L => ({ at: f => ({ x: f * L, y: 0, z: 16 * Math.sin(TAU * 3 * f), twist: 0 }) }),

  // Gradually twists upside down, holds, then twists the rest of the way round.
  twist: L => keyed(L, [0, 0.15, 0.28, 0.38, 0.48, 0.6, 0.72, 0.84, 1], {
    z: [0, -3, 0, 4, 6, 2, -2, 0, 0],
    twist: [0, 0, 0, 90, 180, 180, 270, 360, 360],
  }),

  // One quick full roll in the middle.
  "barrel-roll": L => keyed(L, [0, 0.44, 0.56, 1], { twist: [0, 0, 360, 360] }),

  // Continuous slow corkscrew.
  corkscrew: L => ({ at: f => ({ x: f * L, y: 0, z: 0, twist: 720 * f }) }),

  // Up/down and near/far waves with a gentle banking twist.
  rollercoaster: L => ({
    at: f => ({
      x: f * L,
      y: 5 * Math.sin(f * Math.PI * 6),
      z: 14 * Math.sin(f * Math.PI * 4 + 1),
      twist: 35 * Math.sin(f * Math.PI * 6 + 0.8),
    }),
  }),

  // Low, long, calm waves.
  "gentle-waves": L => ({
    at: f => ({ x: f * L, y: 2.5 * Math.sin(TAU * 2 * f), z: 8 * Math.sin(TAU * 1.5 * f), twist: 0 }),
  }),

  // Rollercoaster that flips upside down for the middle section.
  "coaster-flip": L => ({
    at: f => ({
      x: f * L,
      y: 5 * Math.sin(f * Math.PI * 6),
      z: 14 * Math.sin(f * Math.PI * 4 + 1),
      twist: 25 * Math.sin(f * Math.PI * 6 + 0.8) + 180 * (ramp(f, 0.33, 0.1) - ramp(f, 0.72, 0.1)),
    }),
  }),

  // Big hills, hard banking, and a full roll in the middle.
  "wild-coaster": L => ({
    at: f => ({
      x: f * L,
      y: 9 * Math.sin(TAU * 3 * f),
      z: 22 * Math.sin(TAU * 2 * f + 1),
      twist: 50 * Math.sin(TAU * 3 * f + 0.8) + 360 * ramp(f, 0.5, 0.1),
    }),
  }),

  // Spiral staircase: circles around a vertical axis while climbing.
  carousel: L => {
    const R = 18;
    const rise = 12; // per turn
    return {
      at: f => {
        const th = (f * L) / R;
        return { x: R * Math.sin(th), y: (rise * th) / TAU, z: R * Math.cos(th), twist: 0 };
      },
    };
  },

  // Flat, a full vertical loop-the-loop in the middle, then flat again.
  loop: L => {
    const R = Math.min(10, L / (TAU * 2));
    const loopLen = TAU * R;
    const s1 = (L - loopLen) / 2;
    const zShift = 7;
    return {
      frame: { mode: "axis", axis: [0, 0, 1] },
      at: f => {
        const s = f * L;
        if (s <= s1) return { x: s, y: 0, z: 0, twist: 0 };
        if (s >= s1 + loopLen) return { x: s - loopLen, y: 0, z: -zShift, twist: 0 };
        const phi = (s - s1) / R;
        return { x: s1 + R * Math.sin(phi), y: R - R * Math.cos(phi), z: (-zShift * phi) / TAU, twist: 0 };
      },
    };
  },

  // Spirals inward in the screen plane, ending in the middle.
  spiral: L => {
    const inner = 7;
    const gap = 12; // between neighbouring arms
    const turns = (-14 * Math.PI + Math.sqrt(196 * Math.PI ** 2 + 48 * Math.PI * L)) / (24 * Math.PI);
    const outer = inner + gap * turns;
    const total = TAU * turns;
    return {
      frame: { mode: "axis", axis: [0, 0, 1] },
      at: f => {
        const th = f * total;
        const r = outer - (outer - inner) * f;
        return { x: r * Math.sin(th), y: -r * Math.cos(th), z: 0, twist: 0 };
      },
    };
  },
};

export const SHAPE_TWEAK_DEFAULTS = {
  heightScale: 1,
  depthScale: 1,
  twistScale: 1,
  arch: 0,
  waveHeight: 0,
  waveDepth: 0,
  waveCount: 2,
  twist1: 0, twist1At: 0.5, twist1Over: 0.1,
  twist2: 0, twist2At: 0.8, twist2Over: 0.1,
};

export function buildShape(name, L, tw) {
  const preset = (RIBBON_PRESETS[name] ?? RIBBON_PRESETS.flat)(L);
  const n = 160;
  const raw = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const b = preset.at(f);
    const wave = TAU * tw.waveCount * f;
    raw.push({
      x: b.x,
      y: b.y * tw.heightScale + tw.arch * Math.sin(Math.PI * f) + tw.waveHeight * Math.sin(wave),
      z: b.z * tw.depthScale + tw.waveDepth * Math.sin(wave + Math.PI / 2),
      twist: b.twist * tw.twistScale
        + tw.twist1 * ramp(f, tw.twist1At, tw.twist1Over)
        + tw.twist2 * ramp(f, tw.twist2At, tw.twist2Over),
    });
  }
  // Rescale so the path is exactly as long as the music.
  let len = 0;
  for (let i = 1; i <= n; i++) {
    len += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y, raw[i].z - raw[i - 1].z);
  }
  const k = len > 0 ? L / len : 1;
  return {
    frame: preset.frame,
    points: raw.map(r => ({ p: [r.x * k, r.y * k, r.z * k], twist: r.twist })),
  };
}
