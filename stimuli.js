// Trial generation, angle conventions and scoring (spec Sections 4, 5, 8).
// Pure functions only (no DOM), so they can be unit-tested in Node.
import { CONFIG } from './config.js';

// ---------- random numbers (crypto.getRandomValues) ----------
const buf = new Uint32Array(64);
let bufPos = buf.length;
function randU32() {
  if (bufPos >= buf.length) { crypto.getRandomValues(buf); bufPos = 0; }
  return buf[bufPos++];
}
// Uniform in [0, 1) with 53 bits of resolution.
export function random() {
  return (randU32() * 2 ** 21 + (randU32() >>> 11)) / 2 ** 53;
}
// Uniform integer in [0, n).
export function randInt(n) {
  // rejection sampling to avoid modulo bias
  const limit = Math.floor(2 ** 32 / n) * n;
  let x;
  do { x = randU32(); } while (x >= limit);
  return x % n;
}
export function randNormal() {
  let u = 0;
  while (u === 0) u = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- angles ----------
export const mod360 = (x) => ((x % 360) + 360) % 360;
export const circDist = (x, y) => { const d = Math.abs(x - y) % 360; return Math.min(d, 360 - d); };

// Signed circular difference, integer in (-180, 180].
export function wrap(d) {
  let w = mod360(d);
  if (w > 180) w -= 360;
  return w;
}

// Screen angle of point (x, y) around (cx, cy): 0 = right, counter-clockwise, in [0, 360).
export function screenAngle(x, y, cx, cy) {
  return mod360((Math.atan2(-(y - cy), x - cx) * 180) / Math.PI);
}
// Canvas position of screen angle phi (deg) at radius r.
export function polar(cx, cy, r, phiDeg) {
  const p = (phiDeg * Math.PI) / 180;
  return [cx + r * Math.cos(p), cy - r * Math.sin(p)];
}

// Wheel: hue h is drawn at screen angle (h + omega) mod 360.
export const hueToWheelAngle = (h, omega) => mod360(h + omega);
export const wheelAngleToHue = (phi, omega) => mod360(Math.round(phi - omega));

// ---------- trial generation ----------
export function mainSchedule() {
  const s = [];
  for (const n of CONFIG.SET_SIZES) for (let r = 0; r < CONFIG.REPS_PER_SET_SIZE; r++) s.push(n);
  return shuffle(s);
}

// N integer hues in 0..359, pairwise circular distance >= MIN_COLOR_SEP_DEG.
export function drawHues(n) {
  for (let restart = 0; restart <= CONFIG.COLOR_MAX_RESTARTS; restart++) {
    const hues = [];
    let failed = false;
    for (let i = 0; i < n && !failed; i++) {
      let accepted = false;
      for (let c = 0; c < CONFIG.COLOR_CANDIDATES; c++) {
        const h = randInt(CONFIG.N_HUES);
        if (hues.every((x) => circDist(x, h) >= CONFIG.MIN_COLOR_SEP_DEG)) { hues.push(h); accepted = true; break; }
      }
      if (!accepted) failed = true;
    }
    if (!failed) return hues;
  }
  throw new Error(`Could not draw ${n} separated hues`);
}

export function generateTrial(setSize) {
  const rho = random() * (360 / CONFIG.N_SLOTS);
  const slots = shuffle([...Array(CONFIG.N_SLOTS).keys()]).slice(0, setSize);
  const positions = slots.map((k) => mod360(rho + (360 / CONFIG.N_SLOTS) * k));
  const colors = drawHues(setSize);
  const probeIndex = randInt(setSize);
  return {
    set_size: setSize,
    item_colors_deg: colors,
    item_slots: slots,
    item_positions_deg: positions,
    array_rotation_deg: rho,
    probe_index: probeIndex,
    target_color_deg: colors[probeIndex],
    wheel_rotation_deg: randInt(360),
  };
}

// ---------- scoring ----------
export function scoreResponse(responseHue, targetHue, setSize) {
  const error = wrap(responseHue - targetHue);
  const base = Math.max(0, 100 - (Math.abs(error) * 100) / CONFIG.ZERO_POINT_ERROR_DEG);
  return { error, base, points: Math.round(base * setSize) };
}

export const MAX_SCORE = CONFIG.REPS_PER_SET_SIZE * 100 * CONFIG.SET_SIZES.reduce((a, b) => a + b, 0);

// ?sim=1 simulated response hue for a trial.
export function simulatedResponse(trial) {
  const n = trial.set_size;
  const pGuess = (CONFIG.SIM_GUESS_SLOPE * Math.max(0, n - CONFIG.SIM_CAPACITY)) / CONFIG.SIM_GUESS_DIVISOR;
  if (random() < pGuess) return randInt(360);
  const sd = CONFIG.SIM_SD_BASE_DEG + CONFIG.SIM_SD_PER_ITEM_DEG * n;
  return mod360(Math.round(trial.target_color_deg + sd * randNormal()));
}
