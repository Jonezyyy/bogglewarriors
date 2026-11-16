// Warrior Mode — client-side game logic.
// Plain script (no ES modules) so it works when opened as file:// locally.
// Scoring helpers come from window.GameUtils (game-utils.browser.js, loaded before this).
const { calculateScore, isSuperseded } = window.GameUtils;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const API           = "https://bogglewarriors-production.up.railway.app";
const GAME_DURATION = 60; // starting seconds

// Special tile spawn sequence — cycles infinitely: 2x, 2x, 3x, 2x, 2x, 3x, ...
const SPAWN_SEQUENCE = [2, 2, 3];

const FINNISH_DICE = [
    "AISPUJ", "AEENEA", "ÄIÖNST", "ANPRSK", "APHSKO",
    "DESRIL", "EIENUS", "HIKNMU", "AKAÄLÄ", "SIOTMU",
    "AJTOTO", "EITOSS", "ELYTTR", "AKITMV", "AILKVY", "ALRNNU"
];

function randomDiceFace() {
    const dice = [...FINNISH_DICE];
    for (let i = dice.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [dice[i], dice[j]] = [dice[j], dice[i]];
    }
    return dice.map(d => d[Math.floor(Math.random() * d.length)]);
}

// ---------------------------------------------------------------------------
// Identity helpers
// ---------------------------------------------------------------------------
function getOrCreateUuid() {
    let id = localStorage.getItem('bw_uuid');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('bw_uuid', id); }
    return id;
}

function getNickname()        { return localStorage.getItem('bw_nickname') || ''; }
function saveNickname(name)   { localStorage.setItem('bw_nickname', name.trim().slice(0, 20)); }

function todayHelsinki() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' });
}

function todayKey()    { return 'bw_warrior_' + todayHelsinki(); }
function progressKey() { return 'bw_warrior_progress_' + todayHelsinki(); }

function getStoredResult()   { try { const r = localStorage.getItem(todayKey()); return r ? JSON.parse(r) : null; } catch { return null; } }
function storeResult(data)   { localStorage.setItem(todayKey(), JSON.stringify(data)); }

function getStoredProgress() {
    try { const r = localStorage.getItem(progressKey()); return r ? JSON.parse(r) : null; } catch { return null; }
}

function saveProgress() {
    if (isGameOver) return;
    const today = todayHelsinki();
    if (!boardLetters || boardLetters.length !== 16) return;
    try {
        localStorage.setItem(progressKey(), JSON.stringify({
            date: today,
            boardLetters,
            foundWords: Array.from(foundWords.entries()),
            timeLeft,
            elapsedSeconds,
            correctWordCount,
            spawnCount,
            currentRound,
            specialTileSlots: Array.from(specialTileSlots.entries()),
        }));
    } catch (_) { /* quota exceeded — ignore */ }
}

function clearProgress() { localStorage.removeItem(progressKey()); }

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const boardEl          = document.getElementById('board');
const selectedWordEl   = document.getElementById('selected-word');
const timeBonusEl      = document.getElementById('time-bonus');
const submitWordBtn    = document.getElementById('submitWord');
const totalScoreEl     = document.getElementById('totalScore');
const foundWordsHeadEl = document.getElementById('foundWordsHeading');
const timerEl          = document.getElementById('timer');
const roundEl          = document.getElementById('round-counter');
const gameEl           = document.getElementById('game');
const resultsOverlay   = document.getElementById('resultsOverlay');
const playersList      = document.getElementById('players-list');
const resultsSummaryEl = document.getElementById('results-summary');
const resultsDateEl    = document.getElementById('results-date');
const playingAsLabel   = document.getElementById('playing-as-label');

const nicknameOverlay  = document.getElementById('nicknameOverlay');
const nicknameInput    = document.getElementById('nicknameInput');
const nicknameSubmit   = document.getElementById('nicknameSubmit');
const nicknameError    = document.getElementById('nicknameError');

const welcomeOverlay   = document.getElementById('welcomeOverlay');
const welcomeName      = document.getElementById('welcomeName');
const welcomeStart     = document.getElementById('welcomeStart');
const changeNameBtn    = document.getElementById('changeNameBtn');

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
let boardLetters   = [];
let foundWords     = new Map();  // word → { nominativePlural, isNominativePlural }
let timeLeft       = GAME_DURATION;
let elapsedSeconds = 0;
let timerInterval  = null;
let isGameOver     = false;
let isCountdown    = false;
let challengeDate  = null;
let pollInterval   = null;

// Special tile state
let specialTileSlots  = new Map(); // boardIndex (number) → multiplier (2|3)
let correctWordCount  = 0;
let spawnCount        = 0;
let currentRound      = 1;

// Sounds
const correctSound   = new Audio('sounds/correct_answer.mp3');
const incorrectSound = new Audio('sounds/incorrect_answer.mp3');
const timesUpSound   = new Audio('sounds/time_up.mp3');
const tapSound       = new Audio('sounds/tap.m4a');
tapSound.volume = 0.5;

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
function calculateTotalScore() {
    return window.GameUtils.calculateTotalScore(foundWords);
}

// ---------------------------------------------------------------------------
// Special tile helpers
// ---------------------------------------------------------------------------

/** Returns the product of multipliers for any special tile used in the word path. */
function computeMultiplier(usedIndices) {
    let m = 1;
    for (const idx of usedIndices) {
        if (specialTileSlots.has(idx)) m *= specialTileSlots.get(idx);
    }
    return m;
}

/** Spawn the next special tile on a random plain board position. */
function maybeSpawnSpecialTile() {
    if (correctWordCount === 0 || correctWordCount % 3 !== 0) return;

    const multiplier = SPAWN_SEQUENCE[spawnCount % SPAWN_SEQUENCE.length];

    const available = [];
    for (let i = 0; i < 16; i++) {
        if (!specialTileSlots.has(i)) available.push(i);
    }
    if (available.length === 0) return; // board fully covered (extremely rare)

    const idx = available[Math.floor(Math.random() * available.length)];
    specialTileSlots.set(idx, multiplier);
    spawnCount++;
    applySpecialTileClass(idx, multiplier, true);
}

function applySpecialTileClass(idx, multiplier, animate) {
    const tile = boardEl.querySelector(`[data-index="${idx}"]`);
    if (!tile) return;
    tile.classList.add(`multiplier-${multiplier}x`);
    if (animate) {
        tile.classList.add('special-spawn');
        setTimeout(() => tile.classList.remove('special-spawn'), 600);
    }
}

function clearSpecialTileClass(idx) {
    const tile = boardEl.querySelector(`[data-index="${idx}"]`);
    if (!tile) return;
    tile.classList.remove('multiplier-2x', 'multiplier-3x');
}

// Replace a tile's letter with a fresh random face from its fixed die.
// Plays a two-phase coin-flip: tile rotates edge-on, letter swaps, rotates back.
function refreshTileLetter(idx) {
    const die       = FINNISH_DICE[idx];
    const newLetter = die[Math.floor(Math.random() * die.length)];
    boardLetters[idx] = newLetter;

    const tile = boardEl.querySelector(`[data-index="${idx}"]`);
    if (!tile) return;
    const span = tile.querySelector('span');

    tile.classList.add('tile-flip-out');
    setTimeout(() => {
        tile.classList.remove('tile-flip-out');
        span.textContent = newLetter.toUpperCase();
        tile.setAttribute('aria-label', newLetter.toUpperCase());
        tile.classList.add('tile-flip-in');
        setTimeout(() => tile.classList.remove('tile-flip-in'), 200);
    }, 180);
}

// ---------------------------------------------------------------------------
// Vowel enforcement — keep at least MIN_VOWELS vowels on the board at all times
// ---------------------------------------------------------------------------
const MIN_VOWELS     = 5;
const FINNISH_VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'ä', 'ö', 'y']);
const isVowel = c => FINNISH_VOWELS.has(c.toLowerCase());

function vowelFacesOf(dieStr) {
    return dieStr.split('').filter(isVowel);
}

// Mutate a letters array in-place to guarantee ≥ minCount vowels (no DOM change).
function fixVowelCount(letters, minCount = MIN_VOWELS) {
    const vowels = letters.filter(isVowel).length;
    if (vowels >= minCount) return;
    const toFix = minCount - vowels;
    const consonants = letters.map((l, i) => isVowel(l) ? null : i).filter(i => i !== null);
    for (let k = consonants.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [consonants[k], consonants[j]] = [consonants[j], consonants[k]];
    }
    for (let n = 0; n < toFix && n < consonants.length; n++) {
        const idx = consonants[n];
        const faces = vowelFacesOf(FINNISH_DICE[idx]);
        if (faces.length === 0) continue; // die has no vowel faces, skip
        letters[idx] = faces[Math.floor(Math.random() * faces.length)].toLowerCase();
    }
}

// After individual tile refreshes: if boardLetters dropped below MIN_VOWELS,
// coin-flip the required number of consonant tiles to vowels.
function enforceMinVowels(minCount = MIN_VOWELS) {
    const vowels = boardLetters.filter(isVowel).length;
    if (vowels >= minCount) return;
    const toFix = minCount - vowels;
    const consonants = boardLetters.map((l, i) => isVowel(l) ? null : i).filter(i => i !== null);
    for (let k = consonants.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [consonants[k], consonants[j]] = [consonants[j], consonants[k]];
    }
    for (let n = 0; n < toFix && n < consonants.length; n++) {
        const idx = consonants[n];
        const faces = vowelFacesOf(FINNISH_DICE[idx]);
        if (faces.length === 0) continue;
        const newLetter = faces[Math.floor(Math.random() * faces.length)];
        boardLetters[idx] = newLetter.toLowerCase();
        const tile = boardEl.querySelector(`[data-index="${idx}"]`);
        if (!tile) continue;
        const span = tile.querySelector('span');
        tile.classList.add('tile-flip-out');
        ((_tile, _span, _letter) => {
            setTimeout(() => {
                _tile.classList.remove('tile-flip-out');
                _span.textContent = _letter.toUpperCase();
                _tile.setAttribute('aria-label', _letter.toUpperCase());
                _tile.classList.add('tile-flip-in');
                setTimeout(() => _tile.classList.remove('tile-flip-in'), 200);
            }, 180);
        })(tile, span, newLetter);
    }
}

// Full board reshuffle triggered by finding a word that includes a 3× tile.
function triggerNewRound() {
    currentRound++;
    roundEl.textContent = `Round ${currentRound}`;
    // Animate the round counter
    roundEl.classList.remove('round-bump');
    void roundEl.offsetWidth; // force reflow to restart
    roundEl.classList.add('round-bump');
    setTimeout(() => roundEl.classList.remove('round-bump'), 600);

    // Full board reshuffle
    boardLetters = randomDiceFace();
    fixVowelCount(boardLetters); // guarantee ≥ MIN_VOWELS vowels before rendering
    renderBoard(boardLetters);

    // Re-apply surviving special tiles to the new DOM elements
    for (const [idx, mult] of specialTileSlots) {
        applySpecialTileClass(idx, mult, false);
    }

    flash(`⚔ Round ${currentRound}!`, '#ffdd00', 2000);
    saveProgress();
}

/** Show the "+Ns" bonus pop-up over the board. */
function showTimeBonus(seconds, multiplier) {
    const label = multiplier > 1 ? `+${seconds}s ×${multiplier}` : `+${seconds}s`;
    timeBonusEl.textContent = label;
    timeBonusEl.classList.remove('show');
    void timeBonusEl.offsetWidth; // force reflow to restart animation
    timeBonusEl.classList.add('show');
}

// ---------------------------------------------------------------------------
// Board input (selection, swipe/touch, path canvas) — see board-input.js
// ---------------------------------------------------------------------------
const boardInput = window.BoardInput.mount({
    boardEl,
    selectedWordEl,
    getLetters: () => boardLetters,
    isLocked: () => isGameOver || isCountdown,
    isOver: () => isGameOver,
    onSwipeEnd: () => submitWord(),
    onTileAdded: () => { tapSound.currentTime = 0; tapSound.play().catch(() => {}); },
    keepSelectionOn: '#submitWord',
});

function renderBoard(letters) {
    boardLetters = letters;
    boardInput.render();
}

// ---------------------------------------------------------------------------
// Word submission
// ---------------------------------------------------------------------------
async function submitWord() {
    const word = boardInput.word();
    // Capture tile indices BEFORE boardInput.clear() removes them
    const usedTileIndices = boardInput.indices();
    boardInput.clear();

    if (word.length < 3) { flash('Too short — at least 3 letters', '#ff9900', 2000); return; }
    if (foundWords.has(word)) { flash('Word already found!', '#ff9900', 2000); return; }

    let result;
    try {
        const r = await fetch(
            `${API}/validate-word/${encodeURIComponent(word)}?lang=fi&dict=sanakirja`,
            { signal: AbortSignal.timeout(5000) }
        );
        result = await r.json();
    } catch {
        flash('Server is not responding', '#ff4444', 3000);
        return;
    }

    if (!result.exists) {
        flash('Not a word', '#ff4444');
        incorrectSound.currentTime = 0; incorrectSound.play().catch(() => {});
        return;
    }

    if (result.nominativePlural && !result.isNominativePlural && foundWords.has(result.nominativePlural)) {
        flash('Plural already found!', '#ff9900', 2000);
        incorrectSound.currentTime = 0; incorrectSound.play().catch(() => {});
        return;
    }

    // --- Word accepted ---

    // Detect 3× tile usage BEFORE consuming (consume loop deletes from specialTileSlots)
    const triggered3x = usedTileIndices.some(idx => specialTileSlots.get(idx) === 3);

    // Compute time bonus using special tiles before we remove them
    const multiplier   = computeMultiplier(usedTileIndices);
    const wordScore    = calculateScore(word);
    const bonusSeconds = wordScore * multiplier;

    // Add time to the clock
    timeLeft += bonusSeconds;
    timerEl.textContent = formatTime(timeLeft);
    if (timeLeft > 10) timerEl.classList.remove('warning');

    // Consume any special tiles used in this word
    for (const idx of usedTileIndices) {
        if (specialTileSlots.has(idx)) {
            specialTileSlots.delete(idx);
            clearSpecialTileClass(idx);
        }
    }

    // Refresh letters or trigger new round based on tile type used
    if (triggered3x) {
        triggerNewRound();
    } else {
        usedTileIndices.forEach(idx => refreshTileLetter(idx));
        enforceMinVowels(); // top-up if refreshed tiles brought vowels below MIN_VOWELS
    }

    // Record word
    foundWords.set(word, {
        nominativePlural: result.nominativePlural,
        isNominativePlural: result.isNominativePlural,
    });

    totalScoreEl.textContent = calculateTotalScore();
    updateFoundWordsList();

    // Show feedback
    const baseEntry = Array.from(foundWords.entries())
        .find(([w, m]) => w !== word && m.nominativePlural === word);
    if (baseEntry) {
        const extra = wordScore - calculateScore(baseEntry[0]);
        flash(`Plural +${extra} ${word.toUpperCase()}`, '#00dd00', 1500);
    } else {
        flash(`+${wordScore} ${word.toUpperCase()}`, '#00dd00', 1500);
    }
    showTimeBonus(bonusSeconds, multiplier);

    correctSound.currentTime = 0; correctSound.play().catch(() => {});

    // Increment count and maybe spawn a new special tile
    correctWordCount++;
    maybeSpawnSpecialTile();

    saveProgress();
}

function flash(text, color = 'white', ms = 1800) {
    selectedWordEl.textContent = text;
    selectedWordEl.style.color = color;
    setTimeout(() => { selectedWordEl.textContent = ''; selectedWordEl.style.color = 'white'; }, ms);
}

// ---------------------------------------------------------------------------
// Found words sidebar
// ---------------------------------------------------------------------------
function updateFoundWordsList() {
    ['foundWords-34', 'foundWords-5', 'foundWords-6', 'foundWords-7plus'].forEach(id => {
        document.getElementById(id).innerHTML = '';
    });
    let count = 0;
    for (const [word] of foundWords) {
        const len = word.length;
        const listId = len <= 4 ? 'foundWords-34' : len === 5 ? 'foundWords-5' : len === 6 ? 'foundWords-6' : 'foundWords-7plus';
        const li = document.createElement('li');
        li.textContent = word;
        if (isSuperseded(word, foundWords)) li.style.textDecoration = 'line-through';
        document.getElementById(listId).appendChild(li);
        count++;
    }
    foundWordsHeadEl.textContent = `Found Words: ${count}`;
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------
function startTimer() {
    timerEl.textContent = formatTime(timeLeft);
    timerInterval = setInterval(() => {
        timeLeft--;
        elapsedSeconds++;
        timerEl.textContent = formatTime(timeLeft);
        if (timeLeft <= 10) timerEl.classList.add('warning');
        if (elapsedSeconds % 5 === 0) saveProgress();
        if (timeLeft <= 0) endGame();
    }, 1000);
}

function formatTime(s) {
    const clamped = Math.max(0, s);
    return `${Math.floor(clamped / 60)}:${String(clamped % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Countdown (3-2-1-Go)
// ---------------------------------------------------------------------------
function startCountdown(onDone) {
    isCountdown = true;
    let n = 3;
    timerEl.textContent = n;
    const tiles = boardEl.querySelectorAll('.tile');
    tiles.forEach(t => {
        t.style.animationDelay = `${(Math.random() * 0.35).toFixed(2)}s`;
        t.classList.add('shuffle-shake');
    });
    const shuffleId = setInterval(() => {
        const fake = randomDiceFace();
        tiles.forEach((t, i) => t.querySelector('span').textContent = fake[i].toUpperCase());
    }, 300);
    const id = setInterval(() => {
        n--;
        if (n <= 0) {
            clearInterval(id);
            clearInterval(shuffleId);
            timerEl.textContent = 'Go!';
            timerEl.classList.remove('warning');
            tiles.forEach((t, i) => t.querySelector('span').textContent = boardLetters[i].toUpperCase());
            tiles.forEach(t => { t.classList.remove('shuffle-shake'); t.style.animationDelay = ''; });
            setTimeout(() => {
                isCountdown = false;
                timerEl.textContent = formatTime(GAME_DURATION);
                onDone();
            }, 600);
        } else {
            timerEl.textContent = n;
        }
    }, 1000);
}

// ---------------------------------------------------------------------------
// End game + submit to server
// ---------------------------------------------------------------------------
async function endGame() {
    if (isGameOver) return;
    clearInterval(timerInterval);
    isGameOver = true;
    boardInput.clear();
    gameEl.classList.add('game-over');
    timerEl.textContent = "Time's up!";
    timerEl.classList.add('warning');
    timesUpSound.play().catch(() => {});

    const wordList      = Array.from(foundWords.keys());
    const survivalTime  = elapsedSeconds;
    const finalScore    = calculateTotalScore();

    try {
        const uuid     = getOrCreateUuid();
        const nickname = getNickname();
        const resp = await fetch(`${API}/warrior/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uuid, nickname,
                foundWords: wordList,
                survivalTime,
                date: challengeDate,
            }),
        });
        if (!resp.ok && resp.status !== 409) {
            console.error('Warrior submit failed:', await resp.text());
        }
    } catch (err) {
        console.error('Warrior submit error:', err);
    }

    storeResult({
        foundWords: wordList,
        score: finalScore,
        survivalTime,
        date: challengeDate,
        completedAt: Date.now(),
    });
    clearProgress();

    await showResults();
}

// ---------------------------------------------------------------------------
// Overlay a11y helpers
// ---------------------------------------------------------------------------
const FOCUSABLE_SEL = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const _overlayFocusReturn = new Map();

function showOverlay(el) {
    if (!el) return;
    _overlayFocusReturn.set(el.id, document.activeElement);
    if (el.classList.contains('drawer-overlay')) el.classList.add('active');
    el.classList.remove('hidden');
    el.setAttribute('aria-hidden', 'false');
    const first = el.querySelector(FOCUSABLE_SEL);
    if (first) setTimeout(() => first.focus(), 0);
}

function hideOverlay(el) {
    if (!el) return;
    if (el.classList.contains('drawer-overlay')) el.classList.remove('active');
    if (el.classList.contains('modal-overlay')) el.classList.add('hidden');
    el.setAttribute('aria-hidden', 'true');
    const prev = _overlayFocusReturn.get(el.id);
    _overlayFocusReturn.delete(el.id);
    if (prev && typeof prev.focus === 'function') { try { prev.focus(); } catch (_) {} }
}

document.addEventListener('keydown', (e) => {
    const open = document.querySelector('.drawer-overlay.active, .modal-overlay:not(.hidden)');
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); hideOverlay(open); return; }
    if (e.key === 'Tab') {
        const focusables = Array.from(open.querySelectorAll(FOCUSABLE_SEL)).filter(el => el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last  = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
});

// ---------------------------------------------------------------------------
// Results screen
// ---------------------------------------------------------------------------
function openResultsDrawer() { showOverlay(resultsOverlay); }

async function showResults() {
    openResultsDrawer();

    const stored   = getStoredResult();
    const score    = stored?.score ?? calculateTotalScore();
    const words    = stored?.foundWords?.length ?? foundWords.size;
    const survival = stored?.survivalTime ?? elapsedSeconds;

    resultsDateEl.textContent   = `Warrior date: ${challengeDate}`;
    resultsSummaryEl.textContent = `You survived ${formatTime(survival)} — found ${words} words (${score} pts)`;
    playingAsLabel.textContent  = `Playing as: ${getNickname()}`;

    await refreshLeaderboard();
    pollInterval = setInterval(refreshLeaderboard, 30_000);
}

async function refreshLeaderboard() {
    const date = challengeDate || todayHelsinki();
    try {
        const r    = await fetch(`${API}/warrior/leaderboard?date=${date}`);
        const data = await r.json();
        renderPlayers(data.entries || []);
    } catch (err) {
        console.error('Warrior leaderboard poll error:', err);
    }
}

document.getElementById('leaderboardBtn').addEventListener('click', () => openResultsDrawer());
document.getElementById('resultsClose').addEventListener('click', () => hideOverlay(resultsOverlay));

// Play Again — reset all state and start a fresh game without reloading the page
document.getElementById('playAgainBtn').addEventListener('click', () => {
    hideOverlay(resultsOverlay);
    clearInterval(timerInterval);
    clearInterval(pollInterval);
    timerInterval    = null;
    pollInterval     = null;
    boardLetters     = [];
    foundWords       = new Map();
    boardInput.clear();
    timeLeft         = GAME_DURATION;
    elapsedSeconds   = 0;
    isGameOver       = false;
    isCountdown      = false;
    specialTileSlots = new Map();
    correctWordCount = 0;
    spawnCount       = 0;
    currentRound     = 1;
    roundEl.textContent = 'Round 1';
    totalScoreEl.textContent = '0';
    foundWordsHeadEl.textContent = 'Found Words: 0';
    ['foundWords-34', 'foundWords-5', 'foundWords-6', 'foundWords-7plus']
        .forEach(id => { document.getElementById(id).innerHTML = ''; });
    timerEl.textContent = formatTime(GAME_DURATION);
    timerEl.classList.remove('warning');
    gameEl.classList.remove('game-over');
    clearProgress();
    gameEl.classList.remove('hidden');
    startGame(); // fetches and renders the real server board
});

let _resultsMouseDownOnBackdrop = false;
resultsOverlay.addEventListener('mousedown', e => { _resultsMouseDownOnBackdrop = (e.target === resultsOverlay); });
resultsOverlay.addEventListener('click', e => {
    if (e.target === resultsOverlay && _resultsMouseDownOnBackdrop) hideOverlay(resultsOverlay);
    _resultsMouseDownOnBackdrop = false;
});

// ---------------------------------------------------------------------------
// Back button
// ---------------------------------------------------------------------------
const backBtnEl = document.getElementById('backBtn');
function isGameInProgress() {
    return !isGameOver && Array.isArray(boardLetters) && boardLetters.length === 16
        && typeof timeLeft === 'number' && timeLeft > 0 && elapsedSeconds > 0;
}
if (backBtnEl) {
    backBtnEl.addEventListener('click', () => {
        if (isGameInProgress()) {
            const ok = confirm('Quit Warrior Mode? Your progress is saved and you can resume later today.');
            if (!ok) return;
        }
        window.location.href = 'index.html';
    });
}
window.addEventListener('beforeunload', e => {
    if (isGameInProgress()) { e.preventDefault(); e.returnValue = ''; return ''; }
});

// ---------------------------------------------------------------------------
// Leaderboard rendering
// ---------------------------------------------------------------------------
function renderPlayers(entries) {
    const myNickname = getNickname();
    playersList.innerHTML = '';

    const sorted = [...entries].sort((a, b) => {
        const aMe = a.nickname === myNickname;
        const bMe = b.nickname === myNickname;
        if (aMe && !bMe) return -1;
        if (bMe && !aMe) return 1;
        return a.rank - b.rank;
    });

    for (const entry of sorted) {
        const isMe = entry.nickname === myNickname;
        const card = document.createElement('div');
        card.className = 'player-card' + (isMe ? ' is-self' : '');

        const survivalFormatted = formatTime(entry.survivalTime);
        const header = `
            <div class="player-card-header">
                <span class="player-nickname">${escHtml(entry.nickname)}${isMe ? ' (you)' : ''}</span>
                <span class="player-score">${survivalFormatted} survived</span>
                <span class="player-unique-count">${entry.score} pts</span>
            </div>`;

        const chips = (entry.words ?? []).map(w =>
            `<span class="word-chip">${escHtml(w)}</span>`
        ).join('');

        card.innerHTML = header + `<div class="player-words">${chips}</div>`;
        playersList.appendChild(card);
    }
}

function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Nickname modal
// ---------------------------------------------------------------------------
nicknameInput.addEventListener('input', () => {
    nicknameError.textContent = '';
    nicknameSubmit.disabled = nicknameInput.value.trim().length === 0;
});
nicknameSubmit.addEventListener('click', () => {
    const name = nicknameInput.value.trim();
    if (!name) return;
    saveNickname(name);
    hideOverlay(nicknameOverlay);
    startGame();
});
nicknameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !nicknameSubmit.disabled) nicknameSubmit.click();
});

// ---------------------------------------------------------------------------
// Welcome back modal
// ---------------------------------------------------------------------------
welcomeStart.addEventListener('click', () => { hideOverlay(welcomeOverlay); startGame(); });
changeNameBtn.addEventListener('click', () => {
    hideOverlay(welcomeOverlay);
    nicknameInput.value = '';
    nicknameError.textContent = '';
    nicknameSubmit.disabled = true;
    showOverlay(nicknameOverlay);
    nicknameInput.focus();
});

// ---------------------------------------------------------------------------
// Submit button
// ---------------------------------------------------------------------------
submitWordBtn.addEventListener('click', () => {
    tapSound.currentTime = 0; tapSound.play().catch(() => {});
    submitWord();
});

// ---------------------------------------------------------------------------
// Game start
// ---------------------------------------------------------------------------
async function startGame() {
    // If boardLetters was already pre-fetched by init(), skip the network round-trip.
    if (!boardLetters || boardLetters.length !== 16) {
        let boardData;
        try {
            const r = await fetch(`${API}/warrior/board`);
            boardData = await r.json();
        } catch {
            alert("Could not load today's Warrior board. Please check your connection.");
            return;
        }
        challengeDate = boardData.date;
        boardLetters  = boardData.letters;
        renderBoard(boardLetters);
    }

    startCountdown(() => {
        timeLeft       = GAME_DURATION;
        elapsedSeconds = 0;
        startTimer();
        saveProgress();
    });
}

// Save progress on tab hide / close
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveProgress(); });
window.addEventListener('pagehide', saveProgress);

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function init() {
    const today  = todayHelsinki();
    challengeDate = today;

    // Resume in-progress game?
    const progress = getStoredProgress();
    if (progress && progress.date === today
        && Array.isArray(progress.boardLetters) && progress.boardLetters.length === 16
        && typeof progress.timeLeft === 'number' && progress.timeLeft > 0) {

        boardLetters      = progress.boardLetters;
        foundWords        = new Map(progress.foundWords || []);
        timeLeft          = progress.timeLeft;
        elapsedSeconds    = progress.elapsedSeconds || 0;
        correctWordCount  = progress.correctWordCount || 0;
        spawnCount        = progress.spawnCount || 0;
        currentRound      = progress.currentRound || 1;
        specialTileSlots  = new Map((progress.specialTileSlots || []).map(([k, v]) => [Number(k), v]));

        renderBoard(boardLetters);

        // Re-apply special tile classes (no spawn animation for restored tiles)
        for (const [idx, mult] of specialTileSlots) applySpecialTileClass(idx, mult, false);

        roundEl.textContent = `Round ${currentRound}`;
        totalScoreEl.textContent = calculateTotalScore();
        updateFoundWordsList();
        gameEl.classList.remove('hidden');
        startTimer();
        return;
    }

    // First time today — pre-fetch the real board so the correct letters are visible
    // behind the welcome/nickname modal, not a random placeholder.
    gameEl.classList.remove('hidden');
    try {
        const r = await fetch(`${API}/warrior/board`);
        const boardData = await r.json();
        challengeDate = boardData.date;
        boardLetters  = boardData.letters;
        renderBoard(boardLetters);
    } catch {
        renderBoard(randomDiceFace()); // offline fallback
    }

    if (!getNickname()) {
        showOverlay(nicknameOverlay);
    } else {
        welcomeName.textContent = getNickname();
        showOverlay(welcomeOverlay);
    }
}

document.addEventListener('DOMContentLoaded', init);
