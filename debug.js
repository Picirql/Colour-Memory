// ?debug=1 overlay (spec Section 15.1). ?sim=1 lives in stimuli.js (simulatedResponse) and game.js (auto-advance).
import { queueStatus, onQueueChange } from './storage.js';

const params = new URLSearchParams(location.search);
export const FLAGS = {
  debug: params.get('debug') === '1',
  sim: params.get('sim') === '1',
  colors: params.get('colors') === '1',
  simGames: Math.max(1, parseInt(params.get('games') || '1', 10) || 1),
  localhost: ['localhost', '127.0.0.1'].includes(location.hostname),
};
export const IS_TEST = FLAGS.debug || FLAGS.sim || FLAGS.localhost;

const el = document.getElementById('debug');
const state = { frameMs: null, last: null };

const f1 = (x) => (x == null ? '-' : Number(x).toFixed(1));

function render() {
  if (!FLAGS.debug) return;
  const q = queueStatus();
  const t = state.last;
  const lines = [
    `frame_ms_est ${f1(state.frameMs)}  (${state.frameMs ? (1000 / state.frameMs).toFixed(1) : '-'} Hz)`,
  ];
  if (t) {
    lines.push(
      `trial ${t.trial_index}${t.is_practice ? ' (practice)' : ''}  N=${t.set_size}`,
      `fix   ${t.fixation_frames}f plan ${f1(t.fixation_frames * state.frameMs)}  meas ${f1(t.fixation_ms_measured)}`,
      `array ${t.array_frames}f plan ${f1(t.array_frames * state.frameMs)}  meas ${f1(t.array_ms_measured)}`,
      `delay ${t.delay_frames}f plan ${f1(t.delay_frames * state.frameMs)}  meas ${f1(t.delay_ms_measured)}`,
      `timing_ok ${t.timing_ok}  hidden ${t.hidden_during_trial}`,
      `target ${t.target_color_deg}  resp ${t.response_color_deg}  err ${t.error_deg}`,
      `rt ${f1(t.rt_ms)}  pts ${t.points}  input ${t.input_type}`,
    );
  }
  lines.push(`queue ${q.pending} pending${q.inFlight ? ', in flight' : ''}, ${q.sent} sent${q.configured ? '' : ' (NOT CONFIGURED)'}`);
  if (q.lastError) lines.push(`last error: ${q.lastError}`);
  el.textContent = lines.join('\n');
}

export function initDebug() {
  if (!FLAGS.debug) return;
  el.hidden = false;
  onQueueChange(render);
  render();
}
export function debugFrame(frameMs) { state.frameMs = frameMs; render(); }
export function debugTrial(record) { state.last = record; render(); }
