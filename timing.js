// Refresh-rate estimation and frame-locked phase runner (spec Section 6.1).
// Durations are counted in requestAnimationFrame callbacks, never setTimeout.
import { CONFIG } from './config.js';

// Records REFRESH_SAMPLE_FRAMES consecutive rAF timestamps and returns the median interval.
export function estimateFrameInterval() {
  return new Promise((resolve) => {
    const ts = [];
    const step = (t) => {
      ts.push(t);
      if (ts.length < CONFIG.REFRESH_SAMPLE_FRAMES) { requestAnimationFrame(step); return; }
      const diffs = ts.slice(1).map((v, i) => v - ts[i]).sort((a, b) => a - b);
      const m = diffs.length >> 1;
      const frameMs = diffs.length % 2 ? diffs[m] : (diffs[m - 1] + diffs[m]) / 2;
      resolve({ frameMs, hz: 1000 / frameMs });
    };
    requestAnimationFrame(step);
  });
}

export const msToFrames = (ms, frameMs) => Math.max(1, Math.round(ms / frameMs));

// Runs a sequence of phases. Each phase: { name, frames, draw }.
// The phase's draw() runs inside the rAF callback where the phase begins; after `frames`
// further callbacks the next phase is drawn in that same callback. The last phase has no
// frame count: its draw() runs and the promise resolves with the onset timestamp of every phase.
export function runPhases(phases) {
  return new Promise((resolve) => {
    const onsets = {};
    let i = -1;
    let count = 0;
    const begin = (t) => {
      i++;
      const p = phases[i];
      p.draw();
      onsets[p.name] = t;
      count = 0;
      if (i === phases.length - 1) resolve(onsets);
    };
    const step = (t) => {
      if (i < 0 || ++count >= phases[i].frames) begin(t);
      if (i < phases.length - 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// Waits for a number of frames (used for the feedback phase).
export function waitFrames(frames) {
  return new Promise((resolve) => {
    let n = 0;
    const step = () => { if (++n >= frames) resolve(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
