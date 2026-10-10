// End-to-end check in headless Chrome against a local mock of Supabase's REST API.
// No dependencies (Node 22+). Usage:
//   node tests/e2e.mjs [--games 2] [--offline] [--headed] [--chrome "path\to\chrome.exe"]
// Serves the game on http://localhost:8123 with config.js pointed at the mock, runs ?sim=1&debug=1,
// then checks the stored rows against the acceptance checklist (Section 15.2).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const GAMES = parseInt(opt('--games', '2'), 10);
const OFFLINE = args.includes('--offline');
const HEADED = args.includes('--headed');
const CHROME = opt('--chrome', ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p)));
const PORT = 8123, CDP_PORT = 9333;
const KEY = 'test-anon-key';

// ---------------- mock PostgREST ----------------
const db = { sessions: [], trials: [], game_results: [] };
const log = { requests: 0, conflicts: 0, fkErrors: 0, badRequests: [], headerErrors: 0 };
let down = false;

const COLS = {
  sessions: ['session_id', 'device_id', 'email_hash', 'nickname', 'age_band', 'colour_vision', 'game_number_device', 'is_first_game', 'is_test', 'app_version', 'user_agent', 'input_type', 'viewport_w', 'viewport_h', 'screen_w', 'screen_h', 'device_pixel_ratio', 'refresh_hz_est', 'frame_ms_est', 'storage_ok', 'client_started_at', 'tz_offset_min'],
  trials: ['session_id', 'trial_index', 'is_practice', 'set_size', 'item_colors_deg', 'item_slots', 'item_positions_deg', 'array_rotation_deg', 'probe_index', 'target_color_deg', 'response_color_deg', 'error_deg', 'rt_ms', 'wheel_rotation_deg', 'fixation_frames', 'array_frames', 'delay_frames', 'fixation_ms_measured', 'array_ms_measured', 'delay_ms_measured', 'timing_ok', 'hidden_during_trial', 'input_type', 'points', 'client_ts'],
  game_results: ['session_id', 'score', 'n_trials_completed', 'client_ended_at'],
};
const NOT_NULL = {
  sessions: ['session_id', 'device_id', 'game_number_device', 'is_first_game', 'app_version', 'client_started_at'],
  trials: ['session_id', 'trial_index', 'is_practice', 'set_size', 'item_colors_deg', 'item_slots', 'item_positions_deg', 'array_rotation_deg', 'probe_index', 'target_color_deg', 'response_color_deg', 'error_deg', 'rt_ms', 'wheel_rotation_deg', 'timing_ok', 'hidden_during_trial', 'points', 'client_ts'],
  game_results: ['session_id', 'score', 'n_trials_completed', 'client_ended_at'],
};
const inSet = (v, s) => v === null || v === undefined || s.includes(v);
const between = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;

function checkRow(table, r) {
  for (const k of Object.keys(r)) if (!COLS[table].includes(k)) return `unknown column ${k}`;
  for (const k of NOT_NULL[table]) if (r[k] === null || r[k] === undefined) return `null ${k}`;
  if (table === 'sessions') {
    if (r.email_hash != null && !/^[0-9a-f]{64}$/.test(r.email_hash)) return 'email_hash';
    if (r.nickname != null && !/^[A-Za-z0-9_]{2,16}$/.test(r.nickname)) return 'nickname';
    if (!inSet(r.age_band, ['18_21', '22_25', '26_35', '36_plus', 'na'])) return 'age_band';
    if (!inSet(r.colour_vision, ['normal', 'deficient', 'unsure', 'na'])) return 'colour_vision';
    if (!inSet(r.input_type, ['mouse', 'touch', 'pen', 'unknown'])) return 'input_type';
    if (!(r.game_number_device >= 1)) return 'game_number_device';
  }
  if (table === 'trials') {
    if (!between(r.trial_index, 0, 63) || !Number.isInteger(r.trial_index)) return 'trial_index';
    if (![1, 2, 3, 4, 6, 8].includes(r.set_size)) return 'set_size';
    for (const a of ['item_colors_deg', 'item_slots', 'item_positions_deg']) if (!Array.isArray(r[a]) || r[a].length !== r.set_size) return a;
    if (!(r.probe_index >= 0 && r.probe_index < r.set_size)) return 'probe_index';
    if (r.item_colors_deg[r.probe_index] !== r.target_color_deg) return 'target mismatch';
    if (!between(r.target_color_deg, 0, 359) || !between(r.response_color_deg, 0, 359)) return 'colour range';
    if (!between(r.error_deg, -179, 180) || !Number.isInteger(r.error_deg)) return 'error_deg';
    if (!(r.rt_ms >= 0)) return 'rt_ms';
    if (!between(r.wheel_rotation_deg, 0, 359)) return 'wheel_rotation_deg';
    if (!between(r.points, 0, 800)) return 'points';
    if (!inSet(r.input_type, ['mouse', 'touch', 'pen', 'unknown'])) return 'input_type';
  }
  if (table === 'game_results') {
    if (!between(r.score, 0, 9600)) return 'score';
    if (!between(r.n_trials_completed, 0, 24)) return 'n_trials_completed';
  }
  return null;
}

function insert(table, rows) {
  // all-or-nothing like a single SQL statement
  for (const r of rows) {
    const bad = checkRow(table, r);
    if (bad) return [400, { code: '23514', message: bad }];
    if (table !== 'sessions' && !db.sessions.some((s) => s.session_id === r.session_id)) { log.fkErrors++; return [409, { code: '23503', message: 'fk' }]; }
    const dup = table === 'trials'
      ? db.trials.some((t) => t.session_id === r.session_id && t.trial_index === r.trial_index)
      : db[table].some((t) => t.session_id === r.session_id);
    if (dup) { log.conflicts++; return [409, { code: '23505', message: 'duplicate key' }]; }
  }
  const keys = new Set(rows.map((r) => table === 'trials' ? `${r.session_id}/${r.trial_index}` : r.session_id));
  if (keys.size !== rows.length) return [409, { code: '23505', message: 'duplicate in batch' }];
  db[table].push(...rows.map((r) => ({ ...r, created_at: new Date().toISOString() })));
  return [201, null];
}

function leaderboard(limit) {
  const complete = db.game_results.map((g) => ({ g, s: db.sessions.find((s) => s.session_id === g.session_id) }))
    .filter(({ g, s }) => s.nickname && !s.is_test && g.n_trials_completed === 24
      && db.trials.filter((t) => t.session_id === g.session_id && !t.is_practice).length === 24);
  const best = new Map();
  for (const { g, s } of complete) {
    const k = s.email_hash || s.device_id;
    if (!best.has(k) || best.get(k).best_score < g.score) best.set(k, { nickname: s.nickname, best_score: g.score });
  }
  return [...best.values()].sort((a, b) => b.best_score - a.best_score).slice(0, Math.min(Math.max(limit, 1), 50));
}

function handleRest(req, res, body) {
  log.requests++;
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (down) { req.socket.destroy(); return; }
  const send = (code, obj) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(obj ? JSON.stringify(obj) : ''); };
  if (req.headers.apikey !== KEY || req.headers.authorization !== `Bearer ${KEY}`) { log.headerErrors++; return send(401, { message: 'no key' }); }
  const m = req.url.match(/^\/rest\/v1\/(rpc\/)?(\w+)/);
  if (!m) return send(404, null);
  const [, rpc, name] = m;
  if (rpc && name === 'get_leaderboard' && req.method === 'POST') return send(200, leaderboard(JSON.parse(body || '{}').limit_n ?? 10));
  if (!(name in db)) return send(404, null);
  if (req.method !== 'POST') return send(401, { code: '42501', message: 'permission denied' });   // insert-only
  if (req.headers.prefer !== 'return=minimal') { log.headerErrors++; return send(401, { code: '42501', message: 'select not allowed (missing Prefer: return=minimal)' }); }
  let parsed;
  try { parsed = JSON.parse(body); } catch { return send(400, { message: 'bad json' }); }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const [code, err] = insert(name, rows);
  if (code === 400) log.badRequests.push(err.message);
  send(code, err);
}

// ---------------- static server ----------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url.startsWith('/rest/v1/')) return handleRest(req, res, body);
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    let data = fs.readFileSync(file);
    if (urlPath === '/config.js') {
      data = data.toString()
        .replace(/SUPABASE_URL: '[^']*'/, `SUPABASE_URL: 'http://localhost:${PORT}'`)
        .replace(/SUPABASE_KEY: '[^']*'/, `SUPABASE_KEY: '${KEY}'`);
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(PORT, r));

// ---------------- Chrome via CDP ----------------
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmg-chrome-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--window-size=1000,800', ...(HEADED ? [] : ['--headless=new']), 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch { /* starting */ }
  await sleep(200);
}
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let msgId = 0;
const pending = new Map();
const consoleLines = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') consoleLines.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  if (m.method === 'Runtime.exceptionThrown') consoleLines.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
});
const cdp = (method, params = {}) => new Promise((r) => { const id = ++msgId; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
await cdp('Runtime.enable');
await cdp('Page.enable');

const fail = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail.push(msg); };

async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { if (await fn()) return true; await sleep(500); }
  console.log(`timeout waiting for ${label}`);
  return false;
}

console.log(`Chrome: ${CHROME}${HEADED ? ' (headed)' : ' (headless)'}; games: ${GAMES}${OFFLINE ? '; offline test' : ''}`);
await cdp('Page.navigate', { url: `http://localhost:${PORT}/?sim=1&debug=1&games=${GAMES}` });

// checklist 11: fake a tab switch during the 2nd trial (headless Chrome never hides the page itself)
await waitFor(async () => db.trials.length >= 1 || (await evaluate('document.querySelector("#debug").textContent.includes("trial 0")')), 60000, 'first trial');
await evaluate(`(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  setTimeout(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }, 300);
})()`);

if (OFFLINE) {
  // checklist 9: network goes down mid-game, game continues; reload afterwards delivers everything once
  await waitFor(() => db.trials.length >= 8, 120000, '8 trials stored');
  down = true;
  const before = db.trials.length;
  console.log(`network DOWN after ${before} trials`);
  await waitFor(async () => (await evaluate('!document.querySelector("#screen-results").hidden')), 240000, 'results screen while offline');
  check(db.trials.length === before, `no uploads while offline (stored ${db.trials.length})`);
  const pendingLocal = await evaluate('JSON.parse(localStorage.getItem("cmg_pending") || "[]").length');
  check(pendingLocal > 0, `unsent items persisted in localStorage cmg_pending (${pendingLocal} items)`);
  down = false;
  console.log('network UP, reloading page');
  await cdp('Page.navigate', { url: `http://localhost:${PORT}/?debug=1` });
  await waitFor(async () => (await evaluate('JSON.parse(localStorage.getItem("cmg_pending") || "[]").length')) === 0, 60000, 'queue drained');
} else {
  const done = await waitFor(() => db.game_results.length >= GAMES, GAMES * 200000, `${GAMES} game_results rows`);
  if (!done) console.log('page state:', await evaluate(`JSON.stringify({ visibility: document.visibilityState,
    screen: [...document.querySelectorAll('.screen')].filter((s) => !s.hidden).map((s) => s.id),
    debug: document.querySelector('#debug').textContent.split('\\n')[1] })`));
  await sleep(1500);
}

// ---------------- checks ----------------
const sessions = db.sessions;
check(sessions.length === GAMES || (OFFLINE && sessions.length === 1), `${sessions.length} session rows`);
sessions.forEach((s, i) => {
  const trials = db.trials.filter((t) => t.session_id === s.session_id);
  const expected = s.is_first_game ? 27 : 24;
  check(trials.length === expected, `session ${i + 1} (is_first_game=${s.is_first_game}, game ${s.game_number_device}): ${trials.length} trials (expected ${expected})`);
  const idx = trials.map((t) => t.trial_index).sort((a, b) => a - b);
  check(idx.every((v, j) => v === j), `session ${i + 1}: trial_index 0..${expected - 1} contiguous, no duplicates`);
  const main = trials.filter((t) => !t.is_practice);
  check(main.length === 24 && [1, 2, 3, 4, 6, 8].every((n) => main.filter((t) => t.set_size === n).length === 4), `session ${i + 1}: 24 main trials, 4 per set size`);
  if (s.is_first_game) check(trials.filter((t) => t.is_practice).map((t) => t.set_size).join() === '1,2,3' && trials.filter((t) => t.is_practice).every((t) => t.trial_index < 3 && t.points === 0), `session ${i + 1}: practice N=1,2,3 at indices 0-2 with 0 points`);
  const gr = db.game_results.filter((g) => g.session_id === s.session_id);
  check(gr.length === 1, `session ${i + 1}: 1 game_results row`);
  if (gr[0]) check(gr[0].score === main.reduce((a, t) => a + t.points, 0), `session ${i + 1}: score ${gr[0].score} = sum of main-trial points`);
  check(s.is_test === true, `session ${i + 1}: is_test = true (sim/localhost)`);
});
check(sessions.length < 2 || sessions[1].is_first_game === false, 'second game has no practice');
check(db.trials.some((t) => t.hidden_during_trial), `hidden_during_trial set after simulated tab switch (${db.trials.filter((t) => t.hidden_during_trial).map((t) => t.trial_index).join(',')})`);
check(log.badRequests.length === 0, `no rows rejected by constraints ${log.badRequests.join('; ')}`);
check(log.fkErrors === 0, `no foreign-key errors (session always before its trials)`);
check(log.headerErrors === 0, 'all requests sent apikey, Bearer token and Prefer: return=minimal');

// checklist 2: timing
const frame = sessions[0]?.frame_ms_est;
const arr = db.trials.map((t) => t.array_ms_measured);
const tol = frame > 12 ? 17 : 9;
const within = arr.filter((v) => Math.abs(v - 100) <= tol).length;
const pct = (within / arr.length) * 100;
const q = (p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
console.log(`\nTiming: refresh ${(1000 / frame).toFixed(1)} Hz (frame ${frame?.toFixed(2)} ms), array frames ${db.trials[0]?.array_frames}`);
console.log(`  array_ms_measured over ${arr.length} trials: min ${Math.min(...arr).toFixed(1)}, median ${q(0.5).toFixed(1)}, max ${Math.max(...arr).toFixed(1)}; within 100±${tol} ms: ${pct.toFixed(1)}%`);
const del = db.trials.map((t) => t.delay_ms_measured);
console.log(`  delay_ms_measured: min ${Math.min(...del).toFixed(1)}, max ${Math.max(...del).toFixed(1)}; timing_ok false on ${db.trials.filter((t) => !t.timing_ok).length} trials`);
check(pct >= 95, `array duration within 100±${tol} ms on >= 95% of trials`);

// checklist 8: public key cannot read/update/delete
const h = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const g = await fetch(`http://localhost:${PORT}/rest/v1/trials`, { headers: h });
const p = await fetch(`http://localhost:${PORT}/rest/v1/trials`, { method: 'PATCH', headers: h, body: '{}' });
check(g.status >= 400 && p.status >= 400, `mock refuses GET/PATCH (${g.status}/${p.status}) - verify this on the real Supabase too`);

const errs = consoleLines.filter((l) => /^\[(error|exception|assert)\]/.test(l));
check(errs.length === 0, `no console errors${errs.length ? ':\n  ' + errs.join('\n  ') : ''}`);
const emailLeak = consoleLines.some((l) => l.includes('@'));
check(!emailLeak, 'nothing email-like in console');

console.log(`\n${fail.length ? `${fail.length} check(s) FAILED` : 'All checks passed'}. Requests: ${log.requests}, 409 duplicates: ${log.conflicts}`);
ws.close();
chrome.kill();
server.close();
setTimeout(() => { try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* chrome may hold files */ } process.exit(fail.length ? 1 : 0); }, 1000);
