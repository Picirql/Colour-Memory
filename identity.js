// Device id, profile, counters and email hashing (spec Section 10).
// The raw email is never stored, logged or sent: only its salted SHA-256 hash.
import { CONFIG } from './config.js';

const PREFIX = 'cmg_';
let storageOk = true;
const memory = {};   // fallback when localStorage is unavailable

try {
  const k = PREFIX + 'probe';
  localStorage.setItem(k, '1');
  localStorage.removeItem(k);
} catch { storageOk = false; }

export const isStorageOk = () => storageOk;

export function load(key, fallback = null) {
  if (!storageOk) return key in memory ? memory[key] : fallback;
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}

export function save(key, value) {
  if (!storageOk) { memory[key] = value; return; }
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* quota or blocked */ }
}

export function getDeviceId() {
  let id = load('device_id');
  if (!id) { id = crypto.randomUUID(); save('device_id', id); }
  return id;
}

// Without storage every game is a first game (spec Section 10).
export const isFirstGame = () => !storageOk || !load('practice_done', false);
export const markPracticeDone = () => save('practice_done', true);

export function nextGameNumber() {
  const n = (load('game_count', 0) || 0) + 1;
  save('game_count', n);
  return n;
}

// Profile: { nickname, email_hash, age_band, colour_vision } (all nullable).
export const hasProfile = () => load('profile') !== null;
export const getProfile = () => load('profile', { nickname: null, email_hash: null, age_band: null, colour_vision: null });
export const saveProfile = (p) => save('profile', p);

export const getBestScore = () => load('best_score', null);
export const saveBestScore = (s) => save('best_score', s);

export async function hashEmail(raw) {
  const normalised = raw.trim().toLowerCase();
  const bytes = new TextEncoder().encode(CONFIG.EMAIL_SALT + normalised);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const NICKNAME_RE = /^[A-Za-z0-9_]{2,16}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
