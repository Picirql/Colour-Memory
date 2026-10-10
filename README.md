# Colour Memory Game

Browser-based delayed-estimation (continuous report) experiment for the Statistical Methods III group project (B.Stat., ISI Kolkata). Players see N coloured squares for 100 ms, wait 900 ms, then pick the colour of one cued square on a colour wheel. Every trial is stored in Supabase for finite-mixture (EM) analysis. The full specification (`colour_memory_game_spec.pdf`) is kept outside this repository.

Static site: plain HTML/CSS/JS, no framework, no build step, no third-party scripts.

## Files

| File | Purpose |
|---|---|
| `index.html`, `style.css` | All non-canvas screens + the trial canvas |
| `config.js` | **Every constant**, plus the Supabase URL and public key |
| `color.js` | CIELAB → sRGB, the 360-hue table (checked against the spec's test vectors at load) |
| `stimuli.js` | Set-size schedule, colours, positions, angle conventions, scoring, simulated player |
| `timing.js` | Refresh-rate estimate and frame-locked (rAF-counting) phase runner |
| `trial.js` | Canvas drawing and one trial (fixation → array → delay → probe → feedback) |
| `game.js` | Screen flow, practice + 24 trials, results, leaderboard |
| `identity.js` | device_id, profile, counters, salted SHA-256 email hash (raw email is never stored) |
| `storage.js` | FIFO upload queue to Supabase, retries, `cmg_pending` persistence, leaderboard fetch |
| `debug.js` | `?debug=1` overlay and URL flags |
| `supabase/schema.sql` | Tables, constraints, insert-only RLS, `get_leaderboard` function |
| `tests/unit.test.mjs` | Unit tests (Node) |
| `tests/e2e.mjs` | End-to-end test in headless Chrome against a local mock of Supabase's REST API |

## Deployment (spec Section 17)

1. **Supabase project.** Create a free project (or use an existing one). Free projects pause after 1 week of inactivity, so open the dashboard shortly before sharing the link.
2. **Schema.** SQL Editor → paste `supabase/schema.sql` → Run. If tables named `sessions`, `trials` or `game_results` already exist, stop and check first.
3. **Keys.** Project Settings → API: copy the **Project URL** and the **public anon / publishable key** into `SUPABASE_URL` and `SUPABASE_KEY` in `config.js`. **Never** put the service-role / secret key anywhere in this repository.
4. **GitHub Pages.** Create a public repository, push these files, then Settings → Pages → "Deploy from a branch" (main, root). The game is served at `https://<user>.github.io/<repo>/`.
5. **Pilot.** Run the acceptance checklist below, then have 3–5 friends play on different devices and inspect the rows in Supabase's Table Editor.
6. **Clean pilot data.** Delete the pilot rows, or keep them and filter by `is_test` / `created_at`.
7. **Share the link.** Bump `APP_VERSION` on any later code change so data from different versions can be separated.

Until the URL/key are filled in, the game runs normally but uploads nothing (a console warning says so) and the leaderboard is hidden.

## URL flags

- `?debug=1`: overlay showing frame interval, planned vs measured durations of the last trial, target/response/error and upload queue status.
- `?sim=1`: simulated player (responds 600–1200 ms after probe onset; guesses with probability 0.3·max(0, N−3)/5, otherwise target + Gaussian noise with SD 10° + 2°·N). Clicks through all screens automatically. Add `&games=3` to play several games in a row.
- `?colors=1`: full colour wheel with hue labels every 30° for visual checking. Uploads nothing.
- Games played with `debug`, `sim`, or on `localhost` / `127.0.0.1` are stored with `is_test = true`.

## Testing

```
node --test tests/unit.test.mjs          # colour table, wrap, scoring, separation, schedule, wheel mapping
node tests/e2e.mjs --games 2             # 2 simulated games in headless Chrome against a mock Supabase
node tests/e2e.mjs --games 1 --offline   # network drops mid-game; reload delivers everything exactly once
node tests/e2e.mjs --games 1 --headed    # visible window: real vsync timing (keep the window uncovered)
```

To play locally: `python -m http.server 8000`, then open http://localhost:8000 (crypto.subtle needs localhost or HTTPS, so opening `index.html` as a file won't work).

### Acceptance checklist (Section 15.2)

| # | Check | How verified |
|---|---|---|
| 1 | Colour table matches test vectors, no clamping | unit test + console assertion at load |
| 2 | array_ms_measured is 100 ± 17 ms (60 Hz) / 100 ± 9 ms (120 Hz) on ≥ 95% of 50 trials | e2e (prints the numbers); repeat on a 60 Hz phone/laptop with `?debug=1` |
| 3 | No two items closer than 30° in hue | unit test (1,000 trials per set size, including N = 8) |
| 4 | Exactly 4 trials per set size, varied order | unit test + e2e |
| 5 | Wheel rotation varies; clicking the true colour gives error 0 | unit test (scripted click) |
| 6 | Wrap boundary (350 → 10 = +20, 10 → 350 = −20) | unit test |
| 7 | Sim game creates 1 session, 27 or 24 trials, 1 game_results row | e2e against mock; **repeat against the real Supabase** |
| 8 | Public key cannot GET / PATCH / DELETE trials | **check against the real Supabase** (see below) |
| 9 | Network off mid-game → game continues; after reload, no loss and no duplicates | e2e `--offline` |
| 10 | Phone portrait + landscape: nothing cut off, no scroll/zoom during trials, touch works | **manual, on a real phone** |
| 11 | Switching tabs mid-trial sets hidden_during_trial | e2e (simulated) + manual |
| 12 | Raw email appears nowhere | code review + e2e console check; also check DevTools → Network/Application |

Check 8 against the real project (should return an error or `[]`, never rows):

```
curl "https://YOUR-PROJECT-REF.supabase.co/rest/v1/trials?select=*" -H "apikey: KEY" -H "Authorization: Bearer KEY"
curl -X PATCH "https://YOUR-PROJECT-REF.supabase.co/rest/v1/trials?id=eq.1" -H "apikey: KEY" -H "Authorization: Bearer KEY" -H "Content-Type: application/json" -d "{\"points\":0}"
```

## Implementation notes (choices where the spec left room)

- `tz_offset_min` is minutes **east** of UTC (`-getTimezoneOffset()`), so IST = 330.
- Practice feedback shows what the response would have scored, labelled "(practice)"; the stored `points` is 0.
- "New personal best!" appears only when there was an earlier best on this device (not on the very first game).
- The 60 s hidden-tab abort applies until trial 24 finishes.
- **Deviation from the spec:** the end-of-game strategy questions (Section 9.5), the "the-the-the" suggestion in the instructions, and the `verbal_naming` / `did_suppression` columns of `game_results` were removed at the group's request. Drop `g.verbal_naming, g.did_suppression` from the Section 18 export query.
- **Deviation from the spec:** the About text was shortened (no project/ISI description).
- **Deviation from the spec:** feedback after each pick lasts 1000 ms (spec: 600 ms).
- Without localStorage every game is a first game (spec Section 10), so practice is shown again even after "Play again".
- Trials upload in fixed batches of 4 that never change once formed. A retry is therefore identical to the original, and a 409 always means "already stored". On `pagehide` the queue is also sent with `fetch(..., {keepalive: true})`; anything that arrived that way gets a harmless 409 on the next page load.
- Simulated responses are stored with `input_type = 'unknown'`.
