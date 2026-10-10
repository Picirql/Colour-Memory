// Screen flow, practice + 24 main trials, scoring and results (spec Sections 4, 8, 9, 12).
import { CONFIG } from './config.js';
import { checkHueTable, HUES } from './color.js';
import { mainSchedule, generateTrial, scoreResponse, MAX_SCORE } from './stimuli.js';
import { estimateFrameInterval } from './timing.js';
import { resizeCanvas, viewportTooSmall, setProgress, setScene, drawMessage, drawColourCheck, runTrial, cancelInput } from './trial.js';
import {
  isStorageOk, getDeviceId, isFirstGame, markPracticeDone, nextGameNumber,
  hasProfile, getProfile, saveProfile, getBestScore, saveBestScore, hashEmail, NICKNAME_RE, EMAIL_RE,
} from './identity.js';
import { enqueueRow, enqueueTrial, closeBatches, flush, flushOnPageHide, fetchLeaderboard, disableUploads, whenIdle } from './storage.js';
import { FLAGS, IS_TEST, initDebug, debugFrame, debugTrial } from './debug.js';

const ABOUT_TEXT = 'Your answers (which colours you picked and how long you took) are recorded anonymously. '
  + 'We store an anonymous code for your device and, only if you enter it, a scrambled (hashed) version of your email - never the email itself. '
  + 'Nickname and score may appear on the public leaderboard. No other personal data is collected. '
  + 'By playing you confirm you are 18 or older and agree to your anonymous data being used for this project.';

const $ = (sel) => document.querySelector(sel);
const canvas = $('#stage');
const smallScreen = $('#screen-small');
const simAuto = (fn, ms = 400) => { if (FLAGS.sim) setTimeout(fn, ms); };

let currentScreen = null;
let previousScreen = null;
let game = null;          // active game state, null between games
let simGamesPlayed = 0;
let lastResults = null;   // for redrawing results after "Edit profile"

// ---------- screens ----------
function show(name) {
  document.querySelectorAll('.screen:not(.overlay)').forEach((s) => { s.hidden = true; });
  if (name) {
    previousScreen = currentScreen;
    currentScreen = name;
    $(`#screen-${name}`).hidden = false;
    window.scrollTo(0, 0);
  }
}

function enterCanvas() {
  show(null);
  document.body.classList.add('in-game');
  canvas.hidden = false;
  resizeCanvas();
}

function leaveCanvas() {
  setProgress(null);
  setScene(null);
  canvas.hidden = true;
  document.body.classList.remove('in-game');
}

// Single-choice chip groups. allowDeselect for optional profile fields.
function chipGroup(name, allowDeselect, onChange) {
  const group = $(`.chips[data-name="${name}"]`);
  const chips = [...group.querySelectorAll('.chip')];
  const set = (value) => chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.value === value)));
  const get = () => (chips.find((c) => c.getAttribute('aria-pressed') === 'true') || {}).dataset?.value ?? null;
  group.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    set(allowDeselect && chip.getAttribute('aria-pressed') === 'true' ? null : chip.dataset.value);
    if (onChange) onChange(get());
  });
  set(null);
  return { set, get };
}

// ---------- viewport ----------
function updateSmallOverlay() {
  smallScreen.hidden = !(game && viewportTooSmall());
}

function ensureViewport() {
  if (!viewportTooSmall()) return Promise.resolve();
  smallScreen.hidden = false;
  return new Promise((resolve) => {
    const check = () => {
      if (!viewportTooSmall()) { window.removeEventListener('resize', check); smallScreen.hidden = true; resolve(); }
    };
    window.addEventListener('resize', check);
  });
}

// ---------- tab visibility ----------
let hiddenFlag = false;
let hiddenSince = null;
let hiddenTimer = null;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenFlag = true;
    hiddenSince = performance.now();
    flush();
    if (game && !game.trialsDone) {
      hiddenTimer = setTimeout(() => { if (document.hidden) abortGame(); }, CONFIG.HIDDEN_ABORT_MS);
    }
  } else {
    clearTimeout(hiddenTimer);
    if (game && !game.trialsDone && hiddenSince !== null && performance.now() - hiddenSince > CONFIG.HIDDEN_ABORT_MS) abortGame();
    hiddenSince = null;
  }
});

function abortGame() {
  const g = game;
  if (!g || g.aborted) return;
  g.aborted = true;
  game = null;
  cancelInput();
  g.abort(null);
  closeBatches();
  flush();
  smallScreen.hidden = true;
  leaveCanvas();
  show('ended');
}

// ---------- profile ----------
const ageChips = chipGroup('age_band', true);
const visionChips = chipGroup('colour_vision', true);
let afterProfile = null;

function showProfile(next) {
  afterProfile = next;
  const p = getProfile();
  $('#f-nickname').value = p.nickname || '';
  $('#f-email').value = '';
  // the email itself is never kept, so a saved one can only be hinted at, not shown
  $('#f-email').placeholder = p.email_hash ? 'Email saved - type a new one to change it' : '';
  $('#e-nickname').hidden = true;
  $('#e-email').hidden = true;
  ageChips.set(p.age_band);
  visionChips.set(p.colour_vision);
  show('profile');
}

async function submitProfile() {
  const nickname = $('#f-nickname').value.trim();
  const emailInput = $('#f-email');
  const nickOk = nickname === '' || NICKNAME_RE.test(nickname);
  const emailOk = emailInput.value.trim() === '' || EMAIL_RE.test(emailInput.value.trim());
  $('#e-nickname').hidden = nickOk;
  $('#e-email').hidden = emailOk;
  if (!nickOk || !emailOk) return;

  const old = getProfile();
  let emailHash = old.email_hash;
  if (emailInput.value.trim() !== '') emailHash = await hashEmail(emailInput.value);
  emailInput.value = '';   // the raw email is never kept anywhere

  saveProfile({
    nickname: nickname || null,
    email_hash: emailHash,
    age_band: ageChips.get(),
    colour_vision: visionChips.get(),
  });
  const next = afterProfile;
  afterProfile = null;
  if (next) next();
}

// ---------- instructions ----------
let instructionsMode = 'first';   // 'first' (before first game) or 'view' (from start/results)
let instructionsReturn = 'welcome';

function showInstructions(mode) {
  instructionsMode = mode;
  instructionsReturn = currentScreen || 'welcome';
  $('[data-action="instructions-start"]').textContent = mode === 'first'
    ? (isFirstGame() ? 'Start with 3 practice rounds' : 'Start')
    : 'Back';
  const note = $('#practice-note');
  if (note) note.hidden = !(mode === 'view' && isFirstGame());
  show('instructions');
  if (mode === 'first') simAuto(() => playGame());
}

function startFromWelcome() {
  if (isFirstGame()) showInstructions('first');
  else playGame();
}

// ---------- the game ----------
function waitForClick(action, g) {
  return new Promise((resolve) => {
    const btn = $(`[data-action="${action}"]`);
    const handler = () => { btn.removeEventListener('click', handler); resolve(true); };
    btn.addEventListener('click', handler);
    g.abortP.then(() => { btn.removeEventListener('click', handler); resolve(false); });
    simAuto(() => btn.click(), 500);
  });
}

function sessionRow(g, firstGame, frame) {
  const p = getProfile();
  return {
    session_id: g.sessionId,
    device_id: getDeviceId(),
    email_hash: p.email_hash,
    nickname: p.nickname,
    age_band: p.age_band,
    colour_vision: p.colour_vision,
    game_number_device: nextGameNumber(),
    is_first_game: firstGame,
    is_test: IS_TEST,
    app_version: CONFIG.APP_VERSION,
    user_agent: navigator.userAgent.slice(0, 512),
    input_type: matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse',
    viewport_w: window.innerWidth,
    viewport_h: window.innerHeight,
    screen_w: screen.width,
    screen_h: screen.height,
    device_pixel_ratio: window.devicePixelRatio || 1,
    refresh_hz_est: frame.hz,
    frame_ms_est: frame.frameMs,
    storage_ok: isStorageOk(),
    client_started_at: g.startedAt,
    tz_offset_min: -new Date().getTimezoneOffset(),   // minutes east of UTC (IST = 330)
  };
}

async function playGame() {
  if (game) return;
  let abort;
  const g = {
    sessionId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    aborted: false,
    trialsDone: false,
    abortP: new Promise((r) => { abort = r; }),
  };
  g.abort = abort;
  game = g;

  enterCanvas();
  await ensureViewport();
  setProgress(null);
  drawMessage('Get ready…');
  const frame = await estimateFrameInterval();
  if (g.aborted) return;
  debugFrame(frame.frameMs);

  const firstGame = isFirstGame();
  enqueueRow('sessions', sessionRow(g, firstGame, frame));

  let trialIndex = 0;
  const runOne = async (setSize, isPractice, label) => {
    await Promise.race([ensureViewport(), g.abortP]);
    if (g.aborted) return null;
    setProgress(label);
    const record = await Promise.race([
      runTrial(generateTrial(setSize), {
        frameMs: frame.frameMs,
        isPractice,
        trialIndex,
        sessionId: g.sessionId,
        sim: FLAGS.sim,
        isHidden: () => hiddenFlag,
        resetHidden: () => { hiddenFlag = document.hidden; },
        isCancelled: () => g.aborted,
      }),
      g.abortP,
    ]);
    if (!record || g.aborted) return null;
    enqueueTrial(record);
    debugTrial(record);
    trialIndex++;
    return record;
  };

  // practice (first game on this device only)
  if (firstGame) {
    const ps = CONFIG.PRACTICE_SET_SIZES;
    for (let i = 0; i < ps.length; i++) {
      if (!(await runOne(ps[i], true, { text: `Practice ${i + 1} / ${ps.length}`, frac: (i + 1) / ps.length }))) return;
    }
    markPracticeDone();
    setProgress(null);
    drawMessage('');
    show('practice-done');
    if (!(await waitForClick('main-start', g))) return;
    show(null);
  }

  // 24 main trials
  const schedule = mainSchedule();
  const baseBySize = {};
  let score = 0;
  for (let i = 0; i < schedule.length; i++) {
    const r = await runOne(schedule[i], false, { text: `${i + 1} / ${schedule.length}`, frac: (i + 1) / schedule.length });
    if (!r) return;
    score += r.points;
    (baseBySize[r.set_size] ||= []).push(scoreResponse(r.response_color_deg, r.target_color_deg, r.set_size).base);
  }
  g.trialsDone = true;
  leaveCanvas();
  closeBatches();
  flush();

  enqueueRow('game_results', {
    session_id: g.sessionId,
    score,
    n_trials_completed: schedule.length,
    client_ended_at: new Date().toISOString(),
  });
  game = null;

  const prevBest = getBestScore();
  const newBest = prevBest === null || score > prevBest;
  if (newBest) saveBestScore(score);
  lastResults = { score, baseBySize, prevBest, newBest };
  showResults();
}

// ---------- results ----------
async function showResults() {
  const { score, baseBySize, prevBest, newBest } = lastResults;
  $('#r-score').textContent = score.toLocaleString('en-US');
  const pb = $('#r-pb');
  if (newBest && prevBest !== null) { pb.textContent = 'New personal best!'; pb.className = 'center pb new'; }
  else { pb.textContent = `Your best: ${Math.max(score, prevBest ?? 0).toLocaleString('en-US')} / ${MAX_SCORE.toLocaleString('en-US')}`; pb.className = 'center pb'; }

  const bd = $('#r-breakdown');
  bd.replaceChildren();
  for (const n of CONFIG.SET_SIZES) {
    const vals = baseBySize[n] || [];
    const pct = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = `${n} square${n === 1 ? '' : 's'}`;
    const bar = document.createElement('span');
    bar.className = 'bar';
    const fill = document.createElement('span');
    fill.style.width = `${pct}%`;
    bar.append(fill);
    const val = document.createElement('span');
    val.className = 'pct';
    val.textContent = `${pct}%`;
    bd.append(lbl, bar, val);
  }
  show('results');

  // leaderboard: give the result row a moment to arrive first
  $('#r-leaderboard-wrap').hidden = true;
  await whenIdle(6000);
  const rows = await fetchLeaderboard();
  if (rows && rows.length) {
    fillLeaderboard($('#r-leaderboard'), rows);
    $('#r-leaderboard-wrap').hidden = false;
  }

  if (FLAGS.sim && ++simGamesPlayed < FLAGS.simGames) setTimeout(() => playGame(), 1500);
}

function fillLeaderboard(ol, rows) {
  const me = getProfile().nickname;
  ol.replaceChildren(...rows.map((r) => {
    const li = document.createElement('li');
    if (me && r.nickname === me) li.className = 'me';
    const name = document.createElement('span');
    name.textContent = r.nickname;
    const s = document.createElement('span');
    s.className = 's';
    s.textContent = Number(r.best_score).toLocaleString('en-US');
    li.append(name, s);
    return li;
  }));
}

// Leaderboard screen opened from the start screen.
async function showLeaderboardScreen() {
  const status = $('#lb-status'), ol = $('#lb-list');
  if (!status || !ol) return;   // page HTML from an older cached version
  ol.replaceChildren();
  status.textContent = 'Loading…';
  status.hidden = false;
  show('leaderboard');
  const rows = await fetchLeaderboard();
  if (rows === null) status.textContent = "Couldn't load the leaderboard right now. Please try again later.";
  else if (!rows.length) status.textContent = 'No scores yet – be the first!';
  else { status.hidden = true; fillLeaderboard(ol, rows); }
}

// ---------- wiring ----------
const actions = {
  play: () => {
    if (!hasProfile() && !FLAGS.sim) showProfile(startFromWelcome);
    else startFromWelcome();
  },
  'profile-continue': submitProfile,
  'instructions-start': () => { if (instructionsMode === 'first') playGame(); else show(instructionsReturn); },
  'main-start': () => {},            // handled by waitForClick
  leaderboard: showLeaderboardScreen,
  'play-again': () => playGame(),
  'edit-profile': () => showProfile(() => showResults()),
  'how-to-play': () => showInstructions('view'),
  about: () => show('about'),
  back: () => show(previousScreen || 'welcome'),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action](e);
});

document.querySelectorAll('.about-text').forEach((p) => { p.textContent = ABOUT_TEXT; });
// the small colour wheels in "How to play" use the game's real hues
const wheelCss = `conic-gradient(${[...Array(37).keys()].map((i) => HUES[(i * 10) % 360]).join(', ')})`;
document.querySelectorAll('.demo .ring').forEach((r) => { r.style.background = wheelCss; });

window.addEventListener('resize', () => { if (!canvas.hidden) resizeCanvas(); updateSmallOverlay(); });
window.addEventListener('pagehide', flushOnPageHide);

// ---------- start ----------
initDebug();
const hueCheck = checkHueTable();
if (!hueCheck.ok) console.error('Colour table check failed', hueCheck);

if (FLAGS.colors) {
  disableUploads();
  enterCanvas();
  drawColourCheck();
} else {
  closeBatches();   // a partial trial batch left by a previous page load
  flush();
  show('welcome');
  simAuto(() => actions.play(), 300);
}
