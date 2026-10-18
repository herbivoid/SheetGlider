import * as THREE from "three";
import { placeQuad, quadAxes } from "./facing.js";
import { makeFrame } from "./ribbon.js";
import { monotoneCubic } from "./util.js";
import { STATES } from "./characters.js";
import { DEFAULT_LOUDNESS } from "./score.js";

// A character has up to 6 sprites (see characters.js for where they come from):
//   glide  in the air between notes, and standing on short notes
//   crouch just before a jump, and absorbing a landing
//   hit    landing on a long note (a little celebration)
//   ride   holding a long note
//   rest   floating during rests
//   surf   gliding through a fast run
// Missing sprites fall back (surf -> ride -> glide, others -> glide), so even a
// single image works; most of the life comes from the procedural motion below.

const FALLBACK = { surf: "ride", crouch: "glide", hit: "glide", ride: "glide", rest: "glide" };

// pack: { def, urls: { state: url } } from characters.js. Returns { def, textures, dispose }.
export async function loadCharacter(pack) {
  const loader = new THREE.TextureLoader();
  const textures = {};
  for (const state of STATES) {
    if (!pack.urls[state]) continue;
    const tex = await loader.loadAsync(pack.urls[state]);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (pack.def.pixelArt) {
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
    }
    textures[state] = tex;
  }
  const unique = new Set(Object.values(textures));
  textures.glide ??= Object.values(textures)[0];
  const resolve = s => textures[s] ?? resolve(FALLBACK[s] ?? "glide");
  for (const state of STATES) textures[state] = resolve(state);
  return { def: pack.def, textures, dispose: () => unique.forEach(t => t.dispose()) };
}

const smooth01 = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
const easeInOut = u => 0.5 - 0.5 * Math.cos(Math.PI * u);

export class CharacterView {
  constructor({ character, score, ribbon, params, sOf, follow }) {
    Object.assign(this, { character, score, ribbon, params, sOf });
    this.targets = pickTargets(score, follow ?? params.follow);
    this.runs = findRuns(this.targets, params.fastNote, params.minRunNotes);
    for (const run of this.runs) {
      const pts = this.targets.slice(run.a, run.b + 1);
      run.t0 = pts[0].on;
      run.t1 = pts[pts.length - 1].on;
      run.curve = monotoneCubic(pts.map(n => n.on), pts.map(n => n.p));
      for (let k = run.a; k < run.b; k++) this.targets[k].run = run;
    }

    this.chords = chordEvents(score, this.targets, params);

    // The character, plus a few semi-transparent clones for chords.
    this.group = new THREE.Group();
    this.geometry = new THREE.PlaneGeometry(1, 1);
    const sprite = renderOrder => {
      const material = new THREE.MeshBasicMaterial({
        map: character.textures.glide, transparent: true, side: THREE.DoubleSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = renderOrder;
      this.group.add(mesh);
      return mesh;
    };
    this.ghosts = Array.from({ length: GHOST_POOL }, () => sprite(3));
    this.mesh = sprite(5);
    this.material = this.mesh.material;
    this.frame = makeFrame();
  }

  // Landings that get a particle burst: not the notes surfed through mid-run,
  // but including the chord notes the clones land on.
  landings() {
    const ghostLandings = this.chords.flatMap(c => c.ghosts.map(g => ({ on: c.on, p: g.p })));
    return [...this.targets.filter(n => !n.run), ...ghostLandings];
  }

  // Vertical position (half-spaces from the middle line) and sprite state at time t.
  motion(t) {
    const P = this.params;
    const T = this.targets;
    if (!T.length) return { p: 0, state: "rest", landed: -1 };

    // Index of the last note that has started.
    let lo = -1;
    let hi = T.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (T[mid].on <= t) lo = mid; else hi = mid - 1;
    }

    if (lo < 0) {
      // Before the first note: drift in from above.
      const first = T[0];
      const hop = P.hopMax;
      const from = first.p + P.restLift * 2;
      if (t < first.on - hop) return { p: from + this.bob(t), state: "rest", landed: -1 };
      const u = (t - (first.on - hop)) / hop;
      return { p: from + (first.p - from) * easeInOut(u), state: "glide", landed: -1 };
    }

    const cur = T[lo];
    if (cur.run) {
      // Surfing a fast run: one smooth curve through all its notes, no hops.
      return { p: cur.run.curve(t), state: "surf", landed: -1, surfing: true };
    }

    const next = T[lo + 1];
    const landed = cur.on;
    const gap = next ? next.on - cur.on : Infinity;
    const hop = next ? THREE.MathUtils.clamp(gap * P.hopFraction, P.hopMin, P.hopMax) : 0;
    const takeoff = next ? next.on - hop : Infinity;
    const restStart = cur.end + 0.05;
    const resting = takeoff - restStart > P.restThreshold;
    const lift = tt => (resting ? P.restLift * smooth01(restStart, restStart + 0.35, tt) : 0);

    if (t < takeoff) {
      const stand = takeoff - cur.on;
      // Long notes (and fermatas) get the celebration; staccato notes just a quick touch.
      const long = (cur.end - cur.on >= P.cheerMin || cur.fermata) && !cur.staccato;
      const hitHold = long ? Math.min(0.4, stand * 0.5) : Math.min(cur.staccato ? 0.07 : 0.12, stand * 0.4);
      // Skip the crouch sprites when there's barely time to stand: squash does the job.
      const crouchOk = stand > 0.16;
      let state = long ? "ride" : "glide";
      if (t < cur.on + hitHold) state = long ? "hit" : crouchOk ? "crouch" : "glide";
      else if (resting && t > restStart) state = "rest";
      const antic = crouchOk && next ? Math.min(0.1, gap * 0.25) : 0;
      if (t > takeoff - antic && state !== "hit") state = "crouch";
      const l = lift(t);
      return {
        p: cur.p + l + (l > 0 ? this.bob(t) * (l / P.restLift) : 0),
        state, landed, takeoff, crouching: state === "crouch" && t > takeoff - antic, impact: this.gain(cur),
      };
    }

    // In the air between cur and next; louder notes get higher hops.
    const u = (t - takeoff) / hop;
    const from = cur.p + lift(takeoff) + (resting ? this.bob(takeoff) : 0);
    const arc = P.hopHeight * this.gain(next) * Math.pow(hop / P.hopMax, 0.7) * smooth01(0.06, 0.2, hop);
    const p = from + (next.p - from) * easeInOut(u) + arc * 4 * u * (1 - u);
    return { p, state: "glide", landed, takeoff, impact: this.gain(cur) };
  }

  bob(t) { return 0.35 * Math.sin(t * Math.PI * 1.6); }

  // How strongly to play a note: louder and accented notes get more (1 = normal).
  gain(target) {
    if (target?.loud === undefined) return 1;
    return 1 + this.params.dynamicsEffect * (target.loud - DEFAULT_LOUDNESS) * 1.6 + (target.accent ? 0.25 : 0);
  }

  update(t, camera) {
    const P = this.params;
    const m = this.motion(t);
    const dt = 1 / 240;
    const vel = (this.motion(t + dt).p - this.motion(t - dt).p) / (2 * dt); // half-spaces per second

    // Squash & stretch
    let sx = 1;
    let sy = 1;
    if (m.landed >= 0 && t >= m.landed) {
      const e = Math.exp(-(t - m.landed) / 0.07) * Math.min(1.6, m.impact ?? 1);
      sy *= 1 - 0.28 * P.squash * e;
      sx *= 1 + 0.22 * P.squash * e;
    }
    if (m.state === "glide" && m.takeoff !== undefined && t >= m.takeoff) {
      const stretch = 1 + Math.min(0.2, Math.abs(vel) * 0.006) * P.squash;
      sy *= stretch;
      sx /= Math.sqrt(stretch);
    }
    if (m.crouching) {
      const w = smooth01(m.takeoff - 0.1, m.takeoff, t);
      sy *= 1 - 0.15 * w * P.squash;
      sx *= 1 + 0.1 * w * P.squash;
    }
    let tilt = THREE.MathUtils.clamp(vel * 0.012 * P.lean, -0.4, 0.4);
    if (m.surfing) tilt = THREE.MathUtils.clamp(vel * 0.02 * P.lean, -0.5, 0.5) - P.surfLean;

    const s = this.sOf(this.score.beatAt(t));
    this.place(this.mesh, s, m.p, m.state, P.characterSize * sx, P.characterSize * sy, tilt, camera);
    this.updateGhosts(t, s, m.p, camera);
  }

  // Positions a character sprite standing at height p (half-spaces) at distance s along the staff.
  place(mesh, s, p, state, width, height, tilt, camera) {
    const P = this.params;
    mesh.material.map = this.character.textures[state];
    this.ribbon.frameAt(s, this.frame);
    const at = new THREE.Vector3().copy(this.frame.P).addScaledVector(this.frame.U, p / 2);
    const X = new THREE.Vector3();
    const Y = new THREE.Vector3();
    quadAxes(camera, at, this.frame.T, this.frame.U, 1, P.flipSharpness, X, Y, tilt);

    // Stand on top of the notehead, nudged toward the camera so lines don't cut through.
    at.addScaledVector(Y, 0.45);
    const toCam = new THREE.Vector3().subVectors(camera.position, at).normalize();
    at.addScaledVector(toCam, 0.4);

    const tex = mesh.material.map.image;
    const aspect = tex ? tex.width / tex.height : 1;
    const [ax, ay] = this.character.def.anchor ?? [0.5, 0];
    placeQuad(mesh, at, X, Y, width * aspect, height, ax, ay, camera);
  }

  // Chord clones: split off from the character on the way to a chord, each
  // lands on one of the other chord notes, then they merge back into him.
  updateGhosts(t, s, charP, camera) {
    const P = this.params;
    let used = 0;
    if (P.ghosts !== "off") {
      const size = P.characterSize * 0.75;
      for (const c of this.chords) {
        if (t < c.on - c.split || t > c.on + c.hold + GHOST_MERGE) continue;
        c.ghosts.forEach((g, k) => {
          if (used >= this.ghosts.length) return;
          let p;
          let fade;
          let spread; // 0 = inside the character, 1 = fanned out beside its note
          let state = "glide";
          let squash = 1;
          if (t < c.on) {
            const u = (t - (c.on - c.split)) / c.split;
            p = charP + (g.p - charP) * easeInOut(u);
            fade = smooth01(0, 0.5, u);
            spread = easeInOut(u);
          } else if (t < c.on + c.hold) {
            p = g.p;
            fade = 1;
            spread = 1;
            state = g.long ? "hit" : "crouch";
            squash = 1 - 0.25 * P.squash * Math.exp(-(t - c.on) / 0.07);
          } else {
            const u = (t - c.on - c.hold) / GHOST_MERGE;
            p = g.p + (charP - g.p) * easeInOut(u);
            fade = 1 - smooth01(0.3, 1, u);
            spread = 1 - easeInOut(u);
          }
          // Chord notes are close together, so clones fan out alternately right and left.
          const side = (k % 2 ? -1 : 1) * (0.55 + 0.45 * Math.floor(k / 2)) * size * 1.4;
          const mesh = this.ghosts[used++];
          this.place(mesh, s + side * spread, p, state, size * (2 - squash), size * squash, 0, camera);
          mesh.material.opacity = P.ghostOpacity * fade;
          mesh.visible = fade > 0.01;
        });
      }
    }
    for (let i = used; i < this.ghosts.length; i++) this.ghosts[i].visible = false;
  }

  // Where the character was drawn in the last rendered frame, in pixels from the
  // top-left (for the position-track export).
  screenInfo(camera, width, height) {
    const toPx = (x, y) => {
      const v = new THREE.Vector3(x, y, 0).applyMatrix4(this.mesh.matrixWorld).project(camera);
      return [((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height, v.z];
    };
    const [ax, ay] = this.character.def.anchor ?? [0.5, 0];
    const center = toPx(0, 0);
    const feet = toPx(ax - 0.5, ay - 0.5);
    const top = toPx(ax - 0.5, 0.5);
    return {
      x: center[0], y: center[1], feetX: feet[0], feetY: feet[1],
      height: Math.hypot(top[0] - feet[0], top[1] - feet[1]),
      rotation: (Math.atan2(top[0] - feet[0], feet[1] - top[1]) * 180) / Math.PI, // 0 = upright, clockwise +
      visible: center[2] < 1,
    };
  }

  // World position of the character's feet at time t (for the camera and particles).
  positionAt(t, target = new THREE.Vector3()) {
    const s = this.sOf(this.score.beatAt(t));
    return this.ribbon.pointAt(s, this.motion(t).p / 2, target);
  }

  dispose() {
    this.geometry.dispose();
    this.mesh.material.dispose();
    for (const g of this.ghosts) g.material.dispose();
  }
}

const GHOST_POOL = 8;
const GHOST_MERGE = 0.25; // seconds to fly back into the character

// For every note the character lands on, the other notes of its chord that a
// clone should land on (same staff, or every staff), nearest first.
function chordEvents(score, targets, params) {
  if (params.ghosts === "off") return [];
  const byStart = new Map();
  for (const n of score.notes) {
    if (n.tieFromPrev) continue;
    if (!byStart.has(n.start)) byStart.set(n.start, []);
    byStart.get(n.start).push(n);
  }
  const events = [];
  targets.forEach((tg, i) => {
    const mates = (byStart.get(tg.note.start) ?? [])
      .filter(n => n !== tg.note && (params.ghosts === "all staves" || n.staff === tg.note.staff))
      .map(n => ({ p: n.land - n.staff * 20, long: score.timeOf(n.start + n.soundingDur) - tg.on >= params.cheerMin }))
      .filter(g => g.p !== tg.p)
      .sort((a, b) => Math.abs(a.p - tg.p) - Math.abs(b.p - tg.p))
      .slice(0, params.maxGhosts);
    if (!mates.length) return;
    const prevGap = i > 0 ? tg.on - targets[i - 1].on : 0.4;
    events.push({
      on: tg.on,
      split: THREE.MathUtils.clamp(prevGap * 0.6, 0.06, 0.3),
      hold: THREE.MathUtils.clamp((tg.end - tg.on) * 0.5, 0.1, 0.35),
      ghosts: mates,
    });
  });
  return events;
}

// The notes the character lands on: one per onset, from the followed staff
// (or the highest note overall). Tied continuations aren't re-landed.
function pickTargets(score, follow) {
  const byOnset = new Map();
  for (const n of score.notes) {
    if (n.tieFromPrev) continue;
    if (follow !== "top" && n.staff !== follow) continue;
    const prev = byOnset.get(n.start);
    if (!prev || n.land + n.staff * -20 > prev.land + prev.staff * -20) byOnset.set(n.start, n);
  }
  return [...byOnset.values()]
    .sort((a, b) => a.start - b.start)
    .map(n => ({
      note: n,
      on: score.timeOf(n.start),
      end: score.timeOf(n.start + n.soundingDur),
      p: n.land - n.staff * 20, // staff 1 sits 10 spaces (20 half-spaces) below staff 0; land: on top of fret numbers
      loud: score.loudness(n.staff, n.start),
      accent: n.artic.includes("accent") || n.artic.includes("marcato"),
      staccato: n.artic.includes("staccato") || n.artic.includes("staccatissimo"),
      fermata: n.fermata,
    }));
}

// Runs: at least `minNotes` notes in a row, each starting less than `fast` seconds after the previous.
function findRuns(targets, fast, minNotes) {
  const runs = [];
  let a = 0;
  for (let i = 1; i <= targets.length; i++) {
    const isFast = i < targets.length && targets[i].on - targets[i - 1].on < fast;
    if (!isFast) {
      if (i - a >= minNotes) runs.push({ a, b: i - 1 });
      a = i;
    }
  }
  return runs;
}

