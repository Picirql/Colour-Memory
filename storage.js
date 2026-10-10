// Upload queue to Supabase (PostgREST) with retries and persistence (spec Section 12).
// Strict FIFO, one request in flight. Trials are grouped into fixed batches of UPLOAD_BATCH
// so a retried request is always byte-identical to the original (a 409 then means "already stored").
import { CONFIG } from './config.js';
import { load, save } from './identity.js';

const PLACEHOLDER = /YOUR-/;
export const isConfigured = () => !PLACEHOLDER.test(CONFIG.SUPABASE_URL) && !PLACEHOLDER.test(CONFIG.SUPABASE_KEY);

// Item: { table, body (object or array of rows), open (trials batch still filling), session_id }
let queue = load('pending', []) || [];
let inFlight = false;
let lastError = null;
let sentRequests = 0;
let enabled = true;
const listeners = new Set();
let warned = false;

export const onQueueChange = (fn) => listeners.add(fn);
export const queueStatus = () => ({ pending: queue.length, inFlight, lastError, sent: sentRequests, configured: isConfigured() });
export const disableUploads = () => { enabled = false; };

function persist() {
  save('pending', queue);
  listeners.forEach((fn) => fn(queueStatus()));
}

function canUpload() {
  if (!enabled) return false;
  if (!isConfigured()) {
    if (!warned) { console.warn('[upload] Supabase URL/key not set in config.js; nothing will be uploaded.'); warned = true; }
    return false;
  }
  return true;
}

function headers() {
  return {
    apikey: CONFIG.SUPABASE_KEY,
    Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };
}

const endpoint = (table) => `${CONFIG.SUPABASE_URL}/rest/v1/${table}`;

export function enqueueRow(table, row) {
  if (!canUpload()) return;
  queue.push({ table, body: row, open: false });
  persist();
  flush();
}

export function enqueueTrial(row) {
  if (!canUpload()) return;
  const last = queue[queue.length - 1];
  if (last && last.open && last.table === 'trials' && last.session_id === row.session_id) {
    last.body.push(row);
    if (last.body.length >= CONFIG.UPLOAD_BATCH) last.open = false;
  } else {
    queue.push({ table: 'trials', body: [row], open: CONFIG.UPLOAD_BATCH > 1, session_id: row.session_id });
  }
  persist();
  if (!queue[queue.length - 1].open) flush();
}

// Closes any partially filled trial batch (end of game, abort, page load, pagehide).
export function closeBatches() {
  let changed = false;
  for (const it of queue) if (it.open) { it.open = false; changed = true; }
  if (changed) persist();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Returns 'done' (stored, or a 409 duplicate), 'drop' (other 4xx: a bug), or 'later' (gave up for now).
async function send(item) {
  const delays = CONFIG.RETRY_DELAYS_MS;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    let res;
    try {
      res = await fetch(endpoint(item.table), { method: 'POST', headers: headers(), body: JSON.stringify(item.body) });
    } catch (e) {
      lastError = `network: ${e.message}`;
      persist();
      continue;
    }
    sentRequests++;
    if (res.ok || res.status === 409) {
      if (res.status === 409) console.info(`[upload] ${item.table}: 409 (already stored), dropping item`);
      lastError = null;
      return 'done';
    }
    const text = await res.text().catch(() => '');
    lastError = `${item.table}: HTTP ${res.status} ${text.slice(0, 200)}`;
    if (res.status === 429 || res.status >= 500) { persist(); continue; }
    console.error('[upload] rejected, dropping item:', lastError);
    return 'drop';
  }
  return 'later';
}

export async function flush() {
  if (inFlight || !canUpload()) return;
  inFlight = true;
  persist();
  try {
    while (queue.length && !queue[0].open) {
      const item = queue[0];
      const result = await send(item);
      if (result === 'later') break;
      queue.shift();
      persist();
    }
  } finally {
    inFlight = false;
    persist();
  }
}

// Resolves once every queued item is stored (or timeoutMs passes), e.g. so the
// leaderboard includes the game that just ended.
export async function whenIdle(timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  flush();
  while ((queue.length || inFlight) && performance.now() < deadline) await sleep(200);
}

// Best-effort send of everything on pagehide. Items stay queued; if they did arrive, the
// retry on the next page load gets a 409 and is dropped.
export function flushOnPageHide() {
  if (!canUpload()) return;
  closeBatches();
  for (const item of queue) {
    try {
      fetch(endpoint(item.table), { method: 'POST', headers: headers(), body: JSON.stringify(item.body), keepalive: true }).catch(() => {});
    } catch { /* ignore */ }
  }
}

export async function fetchLeaderboard() {
  if (!isConfigured()) return null;
  try {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/get_leaderboard`, {
      method: 'POST',
      headers: { apikey: CONFIG.SUPABASE_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit_n: CONFIG.LEADERBOARD_SIZE }),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? rows : null;
  } catch { return null; }
}
