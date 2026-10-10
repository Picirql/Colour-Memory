// Unit tests for the pure modules. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUES, TEST_VECTORS, HUE_TABLE_CLAMPED } from '../color.js';
import {
  wrap, circDist, screenAngle, polar, hueToWheelAngle, wheelAngleToHue,
  mainSchedule, drawHues, generateTrial, scoreResponse, MAX_SCORE, randInt,
} from '../stimuli.js';
import { CONFIG } from '../config.js';
import { msToFrames } from '../timing.js';

test('colour table matches spec test vectors, no clamping (checklist 1)', () => {
  for (const [h, hex] of Object.entries(TEST_VECTORS)) assert.equal(HUES[h], hex, `hue ${h}`);
  assert.equal(HUES.length, 360);
  assert.equal(HUE_TABLE_CLAMPED, 0);
});

test('error wrap at the boundary (checklist 6)', () => {
  assert.equal(scoreResponse(10, 350, 1).error, 20);
  assert.equal(scoreResponse(350, 10, 1).error, -20);
  assert.equal(wrap(180), 180);
  assert.equal(wrap(-180), 180);
  assert.equal(wrap(181), -179);
  assert.equal(wrap(0), 0);
  for (let i = 0; i < 2000; i++) {
    const e = scoreResponse(randInt(360), randInt(360), 1).error;
    assert.ok(Number.isInteger(e) && e > -180 && e <= 180);
  }
});

test('points', () => {
  assert.deepEqual(scoreResponse(100, 100, 8), { error: 0, base: 100, points: 800 });
  assert.equal(scoreResponse(130, 100, 2).points, 100);   // base 50 * 2
  assert.equal(scoreResponse(160, 100, 8).points, 0);
  assert.equal(scoreResponse(100, 200, 4).points, 0);
  assert.equal(MAX_SCORE, 9600);
});

test('no two items closer than 30 deg over 1000+ trials incl. N=8 (checklist 3)', () => {
  for (const n of CONFIG.SET_SIZES) {
    for (let t = 0; t < 1000; t++) {
      const hues = drawHues(n);
      assert.equal(hues.length, n);
      for (let i = 0; i < n; i++) {
        assert.ok(Number.isInteger(hues[i]) && hues[i] >= 0 && hues[i] < 360);
        for (let j = i + 1; j < n; j++) assert.ok(circDist(hues[i], hues[j]) >= 30, `${hues}`);
      }
    }
  }
});

test('each game has 4 trials of each set size, varied order (checklist 4)', () => {
  const orders = new Set();
  for (let g = 0; g < 200; g++) {
    const s = mainSchedule();
    assert.equal(s.length, 24);
    for (const n of CONFIG.SET_SIZES) assert.equal(s.filter((x) => x === n).length, 4);
    orders.add(s.join(','));
  }
  assert.ok(orders.size > 190);
});

test('trial generation fields are consistent with the DB constraints', () => {
  const wheelRots = new Set();
  for (let t = 0; t < 3000; t++) {
    const n = CONFIG.SET_SIZES[t % 6];
    const tr = generateTrial(n);
    assert.equal(tr.item_colors_deg.length, n);
    assert.equal(tr.item_slots.length, n);
    assert.equal(new Set(tr.item_slots).size, n);
    assert.ok(tr.array_rotation_deg >= 0 && tr.array_rotation_deg < 45);
    tr.item_slots.forEach((k, i) => {
      assert.ok(k >= 0 && k < 8);
      const expected = (tr.array_rotation_deg + 45 * k) % 360;
      assert.ok(Math.abs(tr.item_positions_deg[i] - expected) < 1e-9);
    });
    assert.ok(tr.probe_index >= 0 && tr.probe_index < n);
    assert.equal(tr.target_color_deg, tr.item_colors_deg[tr.probe_index]);
    assert.ok(Number.isInteger(tr.wheel_rotation_deg) && tr.wheel_rotation_deg >= 0 && tr.wheel_rotation_deg < 360);
    wheelRots.add(tr.wheel_rotation_deg);
  }
  assert.ok(wheelRots.size > 300, 'wheel rotation varies across trials (checklist 5)');
});

test('clicking the true colour on the rotated wheel gives error 0 (checklist 5)', () => {
  const cx = 400, cy = 300, S = 600;
  const rMid = ((CONFIG.WHEEL_INNER + CONFIG.WHEEL_OUTER) / 2) * S;
  for (let t = 0; t < 5000; t++) {
    const tr = generateTrial(CONFIG.SET_SIZES[t % 6]);
    const phi = hueToWheelAngle(tr.target_color_deg, tr.wheel_rotation_deg);
    const [x, y] = polar(cx, cy, rMid, phi);
    const hue = wheelAngleToHue(screenAngle(x, y, cx, cy), tr.wheel_rotation_deg);
    assert.equal(hue, tr.target_color_deg);
    assert.equal(scoreResponse(hue, tr.target_color_deg, tr.set_size).error, 0);
  }
});

test('screen angle convention: 0 right, counter-clockwise', () => {
  assert.equal(screenAngle(10, 0, 0, 0), 0);
  assert.equal(screenAngle(0, -10, 0, 0), 90);   // up (canvas y grows downward)
  assert.equal(screenAngle(-10, 0, 0, 0), 180);
  assert.equal(screenAngle(0, 10, 0, 0), 270);
  assert.equal(wheelAngleToHue(359.6, 0), 0);
});

test('frame conversion matches the spec examples', () => {
  const at = (hz) => [500, 100, 900].map((ms) => msToFrames(ms, 1000 / hz));
  assert.deepEqual(at(60), [30, 6, 54]);
  assert.deepEqual(at(120), [60, 12, 108]);
  assert.equal(msToFrames(1, 16.7), 1);
});
