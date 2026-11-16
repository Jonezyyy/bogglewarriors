# Boggle Warriors Blueprint

## System Overview
A Finnish/English Boggle web game. A single Express server (`server.js`) serves
the static front-end, validates words against SQLite dictionaries, stores
scores, and mounts two date-seeded competitive modes:

- **Timed / Zen** (`index.html`, `script.js`, `styles.css`): classic play, scores in `scores`.
- **Daily Challenge** (`daily.html`, `daily.js`, `daily.css`, `server-daily.js`): one shared board per Helsinki date, one submission per `uuid` per day, ranked by unique-word scoring.
- **Warrior Mode** (`warrior.html`, `warrior.js`, `warrior.css`, `server-warrior.js`): date-seeded board with multiplier tiles and time bonuses; multiple plays per day, ranked by score and survival time.

Front-end is plain browser JS (no bundler). `leaderboard.css` is shared styling.

## Local Interface & Invariants

### Server
- `server.js`: Express app. Routes: `GET /validate-word/:word`, `GET /words`, `POST /words` (admin), `POST /finnish-words` (admin), `POST /board-analysis`, `GET /leaderboard`, `GET /leaderboard/qualifies`, `POST /scores`, `GET /db-version`, `GET /daily`, `GET /daily/:date`, `GET /warrior`, `GET /warrior/:date`. Exports `app`, `sanakirjaCache`, `dbReady` (Promise). Also serves the whole project directory via `express.static`.
- `server-daily.js`: `registerDailyRoutes(app, scoresDb, sanakirjaCache)` → `GET /daily/board`, `POST /daily/submit`, `GET /daily/leaderboard`, `GET /daily/result`.
- `server-warrior.js`: `registerWarriorRoutes(app, scoresDb, sanakirjaCache)` → `GET /warrior/board`, `POST /warrior/submit`, `GET /warrior/leaderboard`, `GET /warrior/result`; internal `generateWarriorBoard`, `mulberry32`.
- `server-utils.js`: `BOARD_SIZE`, `BOARD_CELLS`, `MAX_WORD_LENGTH`, `getScoreMode`, `normalizeBoardLetters`, `buildBoardNeighbors`, `BOARD_NEIGHBORS`, `analyzeFinnishBoard`, `getTodayHelsinki`, `generateDailyBoard`, `normalizeWordForDedup`, `computeDailyScores`, `buildSingularByPlural`.
- `build-word-db.js`: offline script that reads `kaikki.org-dictionary-Finnish.jsonl` and writes `words.db` (`finnish_words`, `meta` with `version` and `word_count`).
- `check-db.js`: ad-hoc DB inspection script.

### Shared / client
- `game-utils.js`: `calculateScore`, `isSuperseded`, `calculateTotalScore`, `validateWordLocal`, `formatTimer`, `buildFoundProgressText`, `rollDice`. `game-utils.browser.js` is its browser-global mirror (guarded by `tests/client/game-utils-browser-mirror.test.js`).
- `dice-sets.js`: `FINNISH_DICE`, `ENGLISH_DICE`.
- `script.js`: timed/zen game; calls `/board-analysis`, `/leaderboard`, `/leaderboard/qualifies`, `/scores`, `/validate-word`.
- `daily.js`: daily client; uses `localStorage` keys `bw_uuid`, `bw_nickname`, `bw_daily_<date>` (result), `bw_daily_progress_<date>`; calls `/daily/board`, `/daily/submit`, `/daily/leaderboard`.
- `warrior.js`: warrior client; keys `bw_warrior_<date>` and `bw_warrior_progress_<date>`; calls `/warrior/board`, `/warrior/submit`, `/warrior/leaderboard`.
- `.htaccess`: rewrites non-file `daily(/...)` requests to `/daily.html`.

### Invariants
- `[server.js:requireAdmin]` Admin routes return 403 unless `ADMIN_KEY` is set and matches header `x-admin-key`.
- `[server.js:POST /scores]` Zen scores are rejected (400); nickname trimmed to 20 chars; mode normalised via `getScoreMode`.
- `[server.js:/validate-word]` Finnish words must be 3–16 chars of `[a-zäö]`.
- `[server-daily.js:/daily/submit, server-warrior.js:/warrior/submit]` Only today's Helsinki date is accepted (future → 400, past → "closed"); words deduplicated, lowercased, 3–16 chars `[a-zäö]`.
- `[server-daily.js]` Submitted words must exist in the day's analysed board; `UNIQUE(date, uuid)` gives 409 on repeat.
- `[server-warrior.js]` `survivalTime` must be a number in 0–86400; no per-day uniqueness; score is computed server-side.
- `[server-warrior.js:generateWarriorBoard]` Seed is date number + 10,000,000, so the board differs from the daily board.
- `[server.js]` `BOARD_SIZE` is 4.

## Subdirectories & System Boundaries
- `tests/`: test-only (`tests/client`, `tests/server`), run by Vitest; no contract file.
- `images/`, `sounds/`: static assets (textures, icons, `correct_answer.mp3`, `incorrect_answer.mp3`, `tap.m4a`, `time_up.mp3`); no code.

## Global Invariants
- Dictionary data (`words.db`, opened `OPEN_READONLY`) and scores (`scores.db`) are separate databases.
- Daily and warrior submission paths share the same word filter (3–16 chars, `[a-zäö]`).

## Global Side Effects
- `scores.db` (path from `SCORES_DB_PATH`, `:memory:` under tests) tables: `scores`, `daily_boards`, `daily_submissions`, `daily_word_index`, `warrior_boards`, `warrior_submissions`. Schema is created/migrated at startup, including a one-time copy from a legacy `words.db` (`DB_PATH`).
- `words.db` tables: `finnish_words`, `meta` (created by `build-word-db.js`); the `words` table read/written by `GET/POST /words` has no CREATE statement in this repo; `server.js` opens it `OPEN_READONLY`, so the admin `POST /words` and `POST /finnish-words` inserts depend on the file being writable in practice (unverified).
- Outbound HTTP to `api.dictionaryapi.dev` for English validation.
- Listens on `PORT` (default 3000) unless `VITEST` is set.
- Env vars: `PORT`, `ADMIN_KEY`, `SCORES_DB_PATH`, `DB_PATH`, `VITEST`.

## System Verification
- Run: `npm test`
