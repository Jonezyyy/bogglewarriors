# Boggle Warriors — Copilot Instructions

## Project Overview

**Boggle Warriors** is a Finnish-language Boggle game at [bugglewarriors.com](https://bugglewarriors.com).  
Players find Finnish or English words on a 4×4 letter board within a 90-second time limit.

**Stack**
- Frontend: Vanilla JavaScript (ES2020+), no frameworks, no build step
- Backend: Node.js + Express (ESM), SQLite via `sqlite3`
- Dictionaries: ~148,000 Finnish words (kaikki.org, SQLite), Sanakirja.fi JSON, Free Dictionary API (English)
- Hosting: Raspberry Pi, Nginx reverse proxy, DuckDNS dynamic DNS

---

## File Structure

```
/
  index.html        — Single page app shell, all UI declared here
  script.js         — All frontend logic (BoggleGame class + module-level UI state)
  styles.css        — Main styles
  leaderboard.css   — Leaderboard-specific styles
  images/
    background.jpg
    fav_icon.svg
  sounds/
    tap.m4a
    correct_answer.mp3
    incorrect_answer.mp3
    time_up.mp3
/server/
  server.js                       — Express API (ESM)
  finnish_words.db                — SQLite: finnish_words, meta tables
  scores.db                       — SQLite: scores table
  sanakirja_boggle_plurals.json   — Sanakirja.fi word source
```

---

## Backend API (server.js)

Express app using ESM (`import`). Two separate SQLite databases:
- `db` — dictionary (`finnish_words`, `words`, `meta` tables)
- `scoresDb` — leaderboard (`scores` table)

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/validate-word/:word?lang=&dict=` | Validate a single word. Finnish: SQLite. English: Free Dictionary API. |
| `POST` | `/board-analysis` | DFS all valid words on a board. Finnish only. Body: `{ letters, lang, dict }` |
| `GET` | `/leaderboard?type=&lang=&mode=` | Top 10 scores. `type`: `daily`/`alltime`. |
| `GET` | `/leaderboard/qualifies?score=&type=&lang=&mode=` | Returns `{ qualifies: boolean }` |
| `POST` | `/scores` | Submit score. Body: `{ nickname, score, word_count, language, mode }` |
| `GET` | `/db-version` | Returns dictionary DB version from `meta` table |
| `POST` | `/words` | Admin: add word to English `words` table |
| `POST` | `/finnish-words` | Admin: add/replace Finnish word |

### Scoring (calculateWordScore)

```js
length >= 8 → 11 pts
length === 7 → 5 pts
length === 6 → 3 pts
length === 5 → 2 pts
length 3–4  → 1 pt
```

### Board Analysis

- `buildBoardNeighbors()` precomputes 8-directional adjacency for all 16 cells at startup — immutable, do not recompute per request.
- `analyzeFinnishBoard(letters, cache)` runs DFS with prefix pruning using the word cache's `prefixes` Set.
- Word cache is loaded lazily once and held in `finnishWordCache`. `sanakirjaCache` is built synchronously at startup from JSON.

### Finnish Word Metadata

Every word carries:
```js
{ nominativePlural: string | null, isNominativePlural: boolean }
```
`isSupersededWord(word, metadataByWord)` — returns true if a word's nominative plural form is also on the board (used to avoid double-counting).

### Admin Routes

Protected by `requireAdmin` middleware — requires `x-admin-key` header matching `process.env.ADMIN_KEY`.

---

## Frontend (script.js)

Single `BoggleGame` ES6 class, instantiated once as `const game = new BoggleGame()`.  
Module-level variables hold UI state that persists across games.

### Module-level State

```js
let currentPlayMode   // "timed" | "zen"
let currentLanguage   // "fi" | "en"
let currentDict       // "kaikki" | "sanakirja"
let currentVisualMode // "solo" | "group"
let groupMode         // boolean, mirrors currentVisualMode === "group"
let currentLbType     // "daily" | "alltime"
let pendingScore      // { score, wordCount, mode } | null
```

### BoggleGame Key Properties

| Property | Purpose |
|---|---|
| `foundWords` | `Map<string, { nominativePlural, isInflection, isNominativePlural }>` |
| `validBoardWords` | `Set<string>` — all valid words on current board (from `/board-analysis`) |
| `boardLetters` | `string[]` — current 16 letters |
| `selectedTiles` | `HTMLElement[]` — tiles selected during drag |
| `currentWord` | `string[]` — letters being built |
| `isSubmitting` | Guard against double-submissions |
| `isDragging` / `dragMoved` / `touchMoved` | Drag/swipe state |
| `_tileCenters` | Cached tile centers for hit-testing during drag |
| `_boardRect` | Cached board bounding rect, invalidated by ResizeObserver |
| `_rafPending` | RAF loop guard to prevent frame stacking |
| `swipeCanvas` / `swipeCtx` | `<canvas>` overlay for drawing swipe path |
| `hasActiveGame` | Controls whether settings changes restart the game |

### Play Modes

- **Timed** (`currentPlayMode = "timed"`): 90 second countdown, scores submittable.
- **Zen** (`currentPlayMode = "zen"`): unlimited time, Finnish only, scores never submitted.

### Dice

```js
this.finnishDice = [
    "AISPUJ", "AEENEA", "ÄIÖNST", "ANPRSK", "APHSKO",
    "DESRIL", "EIENUS", "HIKNMU", "AKAÄLÄ", "SIOTMU",
    "AJTOTO", "EITOSS", "ELYTTR", "AKITMV", "AILKVY", "ALRNNU"
];
```

These reflect **physical hardware** — do not modify or substitute with frequency-based generation.

### Input Handling

- Mouse: `mousedown` on board → `mousemove`/`mouseup` on document.
- Touch: `touchstart`/`touchmove`/`touchend` on board with `passive: false`.
- Audio context unlocked on first `touchstart` (iOS/Android requirement) via `{ once: true }` listener.
- Always `currentTime = 0` before `audio.play()` to allow rapid replaying.

### Word Submission Flow

1. Player swipes/clicks tiles → `currentWord` builds up
2. `submitWord()` → POST `/validate-word/:word?lang=&dict=`
3. On success: add to `foundWords`, play correct sound, update sidebar
4. On game over: POST `/board-analysis` to get `validBoardWords` + stats, check leaderboard qualification

---

## HTML Structure (index.html)

Key element IDs — do not rename without updating script.js:

```
#top-bar              — Fixed header (hamburger, language-indicator, timer, leaderboard btn)
#board                — 4×4 tile grid
#selected-word        — Live word display above board
#revealBtn            — Shown post-game to reveal missed words
#newGame / #submitWord — Action buttons
#sidebar              — Score + found words list (categorised by length)
  #foundWords-34      — 3–4 letter words
  #foundWords-5       — 5 letter words
  #foundWords-6       — 6 letter words
  #foundWords-7plus   — 7+ letter words
#leaderboardOverlay   — Right drawer
#settingsOverlay      — Left drawer (game mode, dictionary, language)
#nicknameOverlay      — Modal for score submission
```

---

## CSS (styles.css)

CSS custom properties defined in `:root`:

```css
--tile-size: 70px
--tile-font: 42px
--gap: 15px
--board-size: calc(4 * var(--tile-size) + 3 * var(--gap))
```

Section header convention already established — maintain it:
```css
/* ─── Section Name ───────────────────────────────────────────────────── */
```

Drawers use `transform: translateX(±100%)` → `translateX(0)` transitions.  
`backdrop-filter: blur(4px)` used on icon buttons and overlays — include `-webkit-` prefix.

---

## Coding Conventions

- **Language:** plain ES2020+ JavaScript — no TypeScript, no transpilation, no bundler.
- **Modules:** `server.js` uses ESM (`import`/`export`). Frontend is a single non-module script.
- **Naming:** camelCase functions/variables, PascalCase classes, `_` prefix for internal/cached properties.
- **Async:** `async/await` throughout — no raw `.then()` chains.
- **Error handling:** `try/catch` around all `fetch` calls; log with `console.error`; show user messages via `this.showMessage()`.
- **Section headers:** `// ── Section name ──────` in JS, `/* ─── Section name ───── */` in CSS.
- **Commit messages:** English, imperative mood (`Fix double submission guard on fast tap`).

---

## What Not to Do

- **Do not introduce TypeScript** — the project is intentionally plain JS.
- **Do not add a build step or bundler** — no Webpack, Vite, Rollup, etc.
- **Do not introduce UI frameworks** — no React, Vue, Svelte.
- **Do not add frontend npm dependencies** — the browser loads a single script with no imports.
- **Do not modify the dice arrays** — they reflect physical hardware.
- **Do not move word validation or board analysis to the client** — always server-side.
- **Do not rename HTML element IDs** without updating all references in script.js.
- **Do not store business logic in Express route handlers** — handlers validate input and delegate.
- **Do not submit Zen mode scores** — the server rejects them and the client should not try.

---

## Language

- **Code & comments:** English
- **UI strings:** Finnish
