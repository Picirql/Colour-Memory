// CIELAB (D65) -> sRGB conversion and the 360-hue colour table (spec Section 5.4).
import { CONFIG } from './config.js';

const finv = (t) => (t > 6 / 29 ? t * t * t : 3 * (6 / 29) ** 2 * (t - 4 / 29));
const gamma = (u) => (u <= 0.0031308 ? 12.92 * u : 1.055 * u ** (1 / 2.4) - 0.055);

// Returns { rgb: [r, g, b], clamped: boolean }.
export function labToSrgb(L, a, b) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const X = 0.95047 * finv(fx);
  const Y = 1.00000 * finv(fy);
  const Z = 1.08883 * finv(fz);
  const lin = [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.2040 * Y + 1.0570 * Z,
  ];
  let clamped = false;
  const rgb = lin.map((u) => {
    if (u < 0 || u > 1) clamped = true;
    return Math.round(255 * gamma(Math.min(1, Math.max(0, u))));
  });
  return { rgb, clamped };
}

const hex2 = (n) => n.toString(16).padStart(2, '0');

export function buildHueTable() {
  const hex = [];
  let clampedCount = 0;
  for (let h = 0; h < CONFIG.N_HUES; h++) {
    const rad = (h * Math.PI) / 180;
    const { rgb, clamped } = labToSrgb(
      CONFIG.LAB_L,
      CONFIG.LAB_A0 + CONFIG.LAB_RADIUS * Math.cos(rad),
      CONFIG.LAB_B0 + CONFIG.LAB_RADIUS * Math.sin(rad),
    );
    if (clamped) clampedCount++;
    hex.push('#' + rgb.map(hex2).join(''));
  }
  return { hex, clampedCount };
}

export const TEST_VECTORS = { 0: '#f9557f', 60: '#e2712d', 120: '#9b9425', 180: '#4ba07a', 240: '#4998c7', 300: '#bc77c8' };

const table = buildHueTable();
export const HUES = table.hex;
export const HUE_TABLE_CLAMPED = table.clampedCount;

export function checkHueTable() {
  const mismatches = Object.entries(TEST_VECTORS).filter(([h, v]) => HUES[h] !== v);
  return { ok: mismatches.length === 0 && HUE_TABLE_CLAMPED === 0, mismatches, clamped: HUE_TABLE_CLAMPED };
}

const check = checkHueTable();
console.assert(check.clamped === 0, `Colour table: ${check.clamped} hues needed clamping`);
console.assert(check.mismatches.length === 0, 'Colour table does not match test vectors', check.mismatches);
