// Canvas drawing and the run of one trial (spec Sections 5, 6, 7, 8.2).
import { CONFIG } from './config.js';
import { HUES } from './color.js';
import { polar, screenAngle, hueToWheelAngle, wheelAngleToHue, scoreResponse, simulatedResponse, random } from './stimuli.js';
import { runPhases, waitFrames, msToFrames } from './timing.js';

// ---------- canvas setup ----------
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const view = { W: 0, H: 0, S: 0, cx: 0, cy: 0, dpr: 1 };
let scene = null;          // function that redraws the current screen (used after a resize)
let progress = null;       // { text, frac } drawn identically in every phase

export function resizeCanvas() {
  view.dpr = window.devicePixelRatio || 1;
  view.W = window.innerWidth;
  view.H = window.innerHeight;
  view.S = Math.min(view.W, view.H);
  view.cx = view.W / 2;
  view.cy = view.H / 2;
  canvas.width = Math.round(view.W * view.dpr);
  canvas.height = Math.round(view.H * view.dpr);
  canvas.style.width = view.W + 'px';
  canvas.style.height = view.H + 'px';
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  wheelCache = null;
  if (scene) scene();
}
export const getView = () => view;
export const viewportTooSmall = () => Math.min(window.innerWidth, window.innerHeight) < CONFIG.MIN_VIEWPORT_PX;
export const setProgress = (p) => { progress = p; };
export function setScene(fn) { scene = fn; if (fn) fn(); }

// ---------- primitives ----------
function background() {
  ctx.fillStyle = CONFIG.BACKGROUND;
  ctx.fillRect(0, 0, view.W, view.H);
  if (!progress) return;
  ctx.fillStyle = CONFIG.DARK;
  ctx.globalAlpha = 0.25;
  ctx.fillRect(0, 0, view.W, CONFIG.PROGRESS_BAR_PX);
  ctx.globalAlpha = 1;
  ctx.fillRect(0, 0, view.W * progress.frac, CONFIG.PROGRESS_BAR_PX);
  ctx.font = `${CONFIG.PROGRESS_FONT_PX}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(progress.text, 8, CONFIG.PROGRESS_BAR_PX + 4);
}

function fixation() {
  const h = (CONFIG.FIXATION_SIZE * view.S) / 2;
  ctx.strokeStyle = CONFIG.DARK;
  ctx.lineWidth = CONFIG.STROKE_PX;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(view.cx - h, view.cy); ctx.lineTo(view.cx + h, view.cy);
  ctx.moveTo(view.cx, view.cy - h); ctx.lineTo(view.cx, view.cy + h);
  ctx.stroke();
}

function squareRect(posDeg) {
  const side = CONFIG.ITEM_SIDE * view.S;
  const [x, y] = polar(view.cx, view.cy, CONFIG.SLOT_RADIUS * view.S, posDeg);
  return [x - side / 2, y - side / 2, side, side];
}

function fillSquare(posDeg, hue) {
  ctx.fillStyle = HUES[hue];
  ctx.fillRect(...squareRect(posDeg));
}

function outlineSquare(posDeg) {
  ctx.strokeStyle = CONFIG.DARK;
  ctx.lineWidth = CONFIG.STROKE_PX;
  ctx.strokeRect(...squareRect(posDeg));
}

// Wheel pre-rendered offscreen per rotation, then blitted.
let wheelCache = null;
function wheelCanvas(omega) {
  if (wheelCache && wheelCache.omega === omega) return wheelCache.canvas;
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const g = c.getContext('2d');
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  const ri = CONFIG.WHEEL_INNER * view.S, ro = CONFIG.WHEEL_OUTER * view.S;
  const half = 0.5 + CONFIG.WEDGE_OVERLAP_DEG / 2;
  const rad = Math.PI / 180;
  for (let h = 0; h < CONFIG.N_HUES; h++) {
    const a = hueToWheelAngle(h, omega);
    // canvas angles grow clockwise, screen angles counter-clockwise: negate
    const a0 = -(a + half) * rad, a1 = -(a - half) * rad;
    g.beginPath();
    g.arc(view.cx, view.cy, ro, a0, a1);
    g.arc(view.cx, view.cy, ri, a1, a0, true);
    g.closePath();
    g.fillStyle = HUES[h];
    g.fill();
  }
  wheelCache = { omega, canvas: c };
  return c;
}

function wheel(omega) {
  ctx.drawImage(wheelCanvas(omega), 0, 0, view.W, view.H);
}

function radialLine(angleDeg, r0, r1, color, width) {
  const [x0, y0] = polar(view.cx, view.cy, r0, angleDeg);
  const [x1, y1] = polar(view.cx, view.cy, r1, angleDeg);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}

// ?colors=1 check screen: full wheel at rotation 0 with labels every 30 deg.
export function drawColourCheck() {
  progress = null;
  setScene(() => {
    background();
    wheel(0);
    ctx.fillStyle = CONFIG.DARK;
    ctx.font = `${Math.max(11, view.S * 0.03)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let h = 0; h < 360; h += 30) {
      const [x, y] = polar(view.cx, view.cy, view.S * 0.34, h);
      ctx.fillText(`${h}°`, x, y);
      radialLine(h, CONFIG.WHEEL_INNER * view.S - 6, CONFIG.WHEEL_INNER * view.S, CONFIG.DARK, 1);
    }
  });
}

// Plain grey screen with centred text (Get ready...).
export function drawMessage(text) {
  setScene(() => {
    background();
    ctx.fillStyle = CONFIG.DARK;
    ctx.font = `${Math.max(16, view.S * 0.045)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, view.cx, view.cy);
  });
}

// ---------- response input ----------
let pointerHandler = null;
const routes = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave'];
for (const type of routes) canvas.addEventListener(type, (e) => { if (pointerHandler) pointerHandler(e); });

function pointerPos(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

export const cancelInput = () => { pointerHandler = null; };

const normPointerType =(t) => (['mouse', 'touch', 'pen'].includes(t) ? t : 'unknown');

// ---------- one trial ----------
// spec: output of generateTrial(); opts: { frameMs, isPractice, trialIndex, sessionId, sim,
//   isHidden(): bool, resetHidden(), isCancelled(): bool }. Resolves with the trial record, or null if cancelled.
export async function runTrial(spec, opts) {
  const frames = {
    fixation: msToFrames(CONFIG.FIXATION_MS, opts.frameMs),
    array: msToFrames(CONFIG.ARRAY_MS, opts.frameMs),
    delay: msToFrames(CONFIG.DELAY_MS, opts.frameMs),
    feedback: msToFrames(CONFIG.FEEDBACK_MS, opts.frameMs),
  };
  const probePos = spec.item_positions_deg[spec.probe_index];
  const omega = spec.wheel_rotation_deg;
  let preview = null;   // hue under the pointer, or null

  const drawFixation = () => { background(); fixation(); };
  const drawArray = () => {
    background();
    spec.item_positions_deg.forEach((p, i) => fillSquare(p, spec.item_colors_deg[i]));
  };
  const drawDelay = () => { background(); };
  const drawProbe = () => {
    background();
    wheel(omega);
    if (preview !== null) {
      fillSquare(probePos, preview);
      radialLine(hueToWheelAngle(preview, omega), CONFIG.WHEEL_INNER * view.S, CONFIG.WHEEL_OUTER * view.S, CONFIG.DARK, CONFIG.STROKE_PX);
    }
    outlineSquare(probePos);
  };

  // a cancelled (aborted) trial must never draw over whatever comes next
  const show = (fn) => () => { if (!opts.isCancelled()) setScene(fn); };

  wheelCanvas(omega);   // pre-render now so the probe frame is cheap
  opts.resetHidden();
  const onsets = await runPhases([
    { name: 'fixation', frames: frames.fixation, draw: show(drawFixation) },
    { name: 'array', frames: frames.array, draw: show(drawArray) },
    { name: 'delay', frames: frames.delay, draw: show(drawDelay) },
    { name: 'probe', draw: show(drawProbe) },
  ]);
  if (opts.isCancelled()) return null;

  // ---- wait for the response ----
  const response = await new Promise((resolve) => {
    const hueAt = (e) => {
      const [x, y] = pointerPos(e);
      const dist = Math.hypot(x - view.cx, y - view.cy);
      if (dist < CONFIG.DEAD_ZONE_RADIUS * view.S) return null;
      return wheelAngleToHue(screenAngle(x, y, view.cx, view.cy), omega);
    };
    const setPreview = (h) => { if (h !== preview) { preview = h; drawProbe(); } };

    if (opts.sim) {
      const rt = CONFIG.SIM_RT_MIN_MS + random() * (CONFIG.SIM_RT_MAX_MS - CONFIG.SIM_RT_MIN_MS);
      setTimeout(() => resolve({ hue: simulatedResponse(spec), t: performance.now(), pointerType: 'unknown' }), rt);
      return;
    }
    pointerHandler = (e) => {
      if (e.type === 'pointercancel' || e.type === 'pointerleave') { setPreview(null); return; }
      const h = hueAt(e);
      if (e.type === 'pointerup') {
        if (h === null) { setPreview(null); return; }
        pointerHandler = null;
        resolve({ hue: h, t: e.timeStamp || performance.now(), pointerType: normPointerType(e.pointerType) });
        return;
      }
      // pointerdown / pointermove: mouse previews on hover, touch/pen while down
      setPreview(h);
    };
  });
  if (opts.isCancelled()) return null;
  const hiddenDuringTrial = opts.isHidden();
  const clientTs = new Date().toISOString();

  // ---- record ----
  const { error, points } = scoreResponse(response.hue, spec.target_color_deg, spec.set_size);
  const m = {
    fixation: onsets.array - onsets.fixation,
    array: onsets.delay - onsets.array,
    delay: onsets.probe - onsets.delay,
  };
  const tol = CONFIG.TIMING_TOLERANCE_FRAMES * opts.frameMs;
  const timingOk = Math.abs(m.array - frames.array * opts.frameMs) <= tol && Math.abs(m.delay - frames.delay * opts.frameMs) <= tol;

  const record = {
    session_id: opts.sessionId,
    trial_index: opts.trialIndex,
    is_practice: opts.isPractice,
    ...spec,
    response_color_deg: response.hue,
    error_deg: error,
    rt_ms: Math.max(0, response.t - onsets.probe),
    fixation_frames: frames.fixation,
    array_frames: frames.array,
    delay_frames: frames.delay,
    fixation_ms_measured: m.fixation,
    array_ms_measured: m.array,
    delay_ms_measured: m.delay,
    timing_ok: timingOk,
    hidden_during_trial: hiddenDuringTrial,
    input_type: response.pointerType,
    points: opts.isPractice ? 0 : points,
    client_ts: clientTs,
  };

  // ---- feedback ----
  const respAngle = hueToWheelAngle(response.hue, omega);
  const trueAngle = hueToWheelAngle(spec.target_color_deg, omega);
  const drawFeedback = () => {
    background();
    wheel(omega);
    radialLine(respAngle, CONFIG.WHEEL_INNER * view.S, CONFIG.WHEEL_OUTER * view.S, '#ffffff', CONFIG.STROKE_PX + 1);
    const ro = CONFIG.WHEEL_OUTER * view.S;
    radialLine(trueAngle, ro + 2, ro + 2 + CONFIG.FEEDBACK_LINE_LEN * view.S, CONFIG.DARK, CONFIG.FEEDBACK_LINE_PX);
    fillSquare(probePos, spec.target_color_deg);
    outlineSquare(probePos);
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.max(18, CONFIG.FEEDBACK_FONT * view.S)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.isPractice ? `+${points} (practice)` : `+${points}`, view.cx, view.cy);
  };
  await new Promise((r) => requestAnimationFrame(() => { show(drawFeedback)(); r(); }));
  await waitFrames(frames.feedback);

  return record;
}
