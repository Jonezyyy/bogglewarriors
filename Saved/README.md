# Saved

## Overview
Archived snapshot of an early, standalone Boggle prototype (static page plus a
single script). It has no dedicated `server.js` route and is not imported by
the live game; it is kept only for reference. Note that `server.js` calls
`express.static(__dirname)`, so these files are still publicly reachable under
`/Saved/`.

## Interface
- `script.js`: one `DOMContentLoaded` handler. It builds a board from a hard-coded `initialLetters` array and runs a 90-second timer (`timeLeft`, `timerInterval`, `countdownInterval`, `shuffleInterval`, `isPaused`).
- `index.html`, `styles.css`: markup and styling for the prototype.
- `Skills/skills.md`: notes file, not code.

## Invariants
- `[script.js:DOMContentLoaded]` All state lives inside the handler closure; nothing is exported.
- No server calls are made in `script.js`.

## Side Effects
- `[script.js]` Touches the DOM and plays the audio element `timeUpSound`; no network or disk access.

## Verification
- None. Not covered by `npm test` (`vitest run` targets `tests/`).
