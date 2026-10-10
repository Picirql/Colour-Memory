// All numeric constants and settings for the Colour Memory Game (spec Section 14).
// Change values here only. Bump APP_VERSION on any code change after launch.

export const CONFIG = {
  APP_VERSION: '1.0.1',
  SUPABASE_URL: 'https://xhxlnpnzwmurimqvmegf.supabase.co',
  SUPABASE_KEY: 'sb_publishable_qsQR6T8fX2bYO2BTmJRxHw_Yr4pVdPo',   // public key only (insert-only)
  EMAIL_SALT: 'cmg-75a8217d3f205736',

  // design
  SET_SIZES: [1, 2, 3, 4, 6, 8],
  REPS_PER_SET_SIZE: 4,                 // 24 main trials
  PRACTICE_SET_SIZES: [1, 2, 3],

  // timing (ms; converted to frames at run time)
  FIXATION_MS: 500, ARRAY_MS: 100, DELAY_MS: 900, FEEDBACK_MS: 1000,
  REFRESH_SAMPLE_FRAMES: 120,
  TIMING_TOLERANCE_FRAMES: 1.5,
  HIDDEN_ABORT_MS: 60000,

  // geometry (fractions of S = min(viewport width, height))
  N_SLOTS: 8, SLOT_RADIUS: 0.25, ITEM_SIDE: 0.09,
  FIXATION_SIZE: 0.03,
  WHEEL_INNER: 0.40, WHEEL_OUTER: 0.46,
  DEAD_ZONE_RADIUS: 0.15,
  MIN_VIEWPORT_PX: 320,

  // colour
  BACKGROUND: '#808080', DARK: '#1a1a1a',
  LAB_L: 60, LAB_A0: 15, LAB_B0: 12, LAB_RADIUS: 50, N_HUES: 360,
  MIN_COLOR_SEP_DEG: 30,
  COLOR_CANDIDATES: 200,               // candidates per hue before restarting the trial's draw
  COLOR_MAX_RESTARTS: 1000,

  // scoring
  ZERO_POINT_ERROR_DEG: 60,            // base = max(0, 100 - |e|*100/60)

  // uploads
  UPLOAD_BATCH: 4, RETRY_DELAYS_MS: [1000, 3000, 9000],
  LEADERBOARD_SIZE: 10,

  // drawing details (CSS px unless noted)
  STROKE_PX: 2,                         // fixation lines, probe outline, preview tick
  WEDGE_OVERLAP_DEG: 0.3,               // each 1 deg wedge is widened by this to avoid hairline gaps
  FEEDBACK_LINE_PX: 5,                  // thick dark line at the true colour
  FEEDBACK_LINE_LEN: 0.035,             // fraction of S, drawn just outside the wheel (stays on screen)
  FEEDBACK_FONT: 0.07,                  // fraction of S
  PROGRESS_BAR_PX: 4,
  PROGRESS_FONT_PX: 13,

  // ?sim=1 simulated player
  SIM_RT_MIN_MS: 600, SIM_RT_MAX_MS: 1200,
  SIM_GUESS_SLOPE: 0.3, SIM_CAPACITY: 3, SIM_GUESS_DIVISOR: 5,  // P(guess) = 0.3*max(0, N-3)/5
  SIM_SD_BASE_DEG: 10, SIM_SD_PER_ITEM_DEG: 2,                   // SD = 10 + 2*N
};
