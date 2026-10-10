# Colour Memory Game

**Play:** https://picirql.github.io/Colour-Memory/

A two-minute browser game that measures visual working memory. Coloured squares flash on screen for a split second, and you then pick the colour of one of them from a colour wheel. Each game has 24 rounds with 1 to 8 squares, and harder rounds score more.

The game is a version of the *delayed estimation* (continuous report) task from visual working-memory research. The quantity of interest is how far your chosen colour is from the true one, measured in degrees around the wheel.

## How a round works

1. A cross appears in the middle. Keep your eyes on it.
2. Between 1 and 8 coloured squares flash for 100 ms.
3. The screen goes blank for 900 ms.
4. One square's position is outlined and a colour wheel appears. Move around the wheel to preview a colour, then click or tap to choose.
5. You see the true colour and your points, and the next round starts.

Squares are placed on a ring of 8 positions, colours are spaced at least 30° apart on the wheel, and the wheel is rotated randomly every round so its positions can't be memorised. The display is timed by counting screen refreshes, so the 100 ms flash is as accurate as the browser allows, and the measured durations are recorded with each round.

The colours lie on a circle in CIELAB colour space (L\* = 60, centre (15, 12), radius 50). This circle is chosen so that every one of the 360 hues can be shown on a standard sRGB screen.

## Data and privacy

- Each round records which colours were shown, where they were, which colour you picked and how long you took.
- Your browser gets a random anonymous ID so repeat games can be linked.
- If you enter an email, only a salted SHA-256 hash of it is stored, never the email itself. It's used to link games played on different devices.
- Nickname, age group and colour-vision answers are optional.
- Nickname and best score appear on the public leaderboard, and only if you choose a nickname.
- No names, locations, IP addresses, analytics, trackers or cookies.

Data goes to a Supabase (PostgreSQL) database. The public key in `config.js` can only **add** rows: it can't read, change or delete anything. The only public read access is the leaderboard (nickname and best score).

## Tech

Plain HTML, CSS and JavaScript (ES modules) on an HTML5 canvas. No framework, no build step, no third-party scripts. Hosted on GitHub Pages.

| File | Purpose |
|---|---|
| `index.html`, `style.css` | Screens and layout |
| `config.js` | All settings: timings, sizes, colours, scoring, database URL and public key |
| `color.js` | CIELAB → sRGB conversion and the 360-colour wheel |
| `stimuli.js` | Round generation, scoring, angle helpers |
| `timing.js` | Refresh-rate measurement and frame-counted timing |
| `trial.js` | Drawing and running a single round |
| `game.js` | Game flow, results and leaderboard |
| `identity.js` | Anonymous ID, profile and email hashing |
| `storage.js` | Upload queue with retries and offline persistence |
| `debug.js` | Debug overlay |
| `supabase/schema.sql` | Database tables, insert-only security rules and the leaderboard function |
| `tests/` | Unit and end-to-end tests |

## References

- Bays, P. M., Catalao, R. F. G., & Husain, M. (2009). The precision of visual working memory is set by allocation of a shared resource. *Journal of Vision*, 9(10):7.
- Wilken, P., & Ma, W. J. (2004). A detection theory account of change detection. *Journal of Vision*, 4(12):11.
- Zhang, W., & Luck, S. J. (2008). Discrete fixed-resolution representations in visual working memory. *Nature*, 453, 233–235.
