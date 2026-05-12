// Daily Challenge — client-side game logic.
// Plain script (no ES modules) so it works when opened as file:// locally.
// Scoring + supersede helpers come from window.GameUtils (game-utils.browser.js,
// loaded before this script).
const { calculateScore, isSuperseded } = window.GameUtils;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const API = "https://bogglewarriors-production.up.railway.app";
const GAME_DURATION = 90; // seconds

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

function getNickname()              { return localStorage.getItem('bw_nickname') || ''; }
function saveNickname(name)         { localStorage.setItem('bw_nickname', name.trim().slice(0, 20)); }

function todayKey() {
    // Helsinki date matches server
    return 'bw_daily_' + new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' });
}

function progressKey() {
    return 'bw_daily_progress_' + new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' });
}

function getStoredResult() {
    const raw = localStorage.getItem(todayKey());
    return raw ? JSON.parse(raw) : null;
}

function storeResult(data) {
    localStorage.setItem(todayKey(), JSON.stringify(data));
}

function getStoredProgress() {
    try {
        const raw = localStorage.getItem(progressKey());
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function saveProgress() {
    if (isGameOver) return;
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' });
    if (challengeDate && challengeDate !== today) return; // only save active today's challenge
    if (!boardLetters || boardLetters.length !== 16) return;
    try {
        localStorage.setItem(progressKey(), JSON.stringify({
            date: today,
            boardLetters,
            foundWords: Array.from(foundWords.entries()),
            timeLeft,
        }));
    } catch (_) { /* quota exceeded — ignore */ }
}

function clearProgress() {
    localStorage.removeItem(progressKey());
}

// ---------------------------------------------------------------------------
// Date from URL  (/daily/2026-04-01  OR  ?date=2026-04-01)
// ---------------------------------------------------------------------------
function getDateFromUrl() {
    const parts = window.location.pathname.split('/');
    const last = parts[parts.length - 1];
    if (/^\d{4}-\d{2}-\d{2}$/.test(last)) return last;
    const param = new URLSearchParams(window.location.search).get('date');
    if (param && /^\d{4}-\d{2}-\d{2}$/.test(param)) return param;
    return null; // server defaults to today
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const boardEl          = document.getElementById('board');
const selectedWordEl   = document.getElementById('selected-word');
const submitWordBtn    = document.getElementById('submitWord');
const totalScoreEl     = document.getElementById('totalScore');
const foundWordsHeadEl = document.getElementById('foundWordsHeading');
const timerEl          = document.getElementById('timer');
const gameEl           = document.getElementById('game');
const resultsOverlay   = document.getElementById('resultsOverlay');
const playersList      = document.getElementById('players-list');
const resultsSummaryEl = document.getElementById('results-summary');
const resultsDateEl    = document.getElementById('results-date');
const prevDayBtn       = document.getElementById('prevDayBtn');
const nextDayBtn       = document.getElementById('nextDayBtn');
const playingAsLabel   = document.getElementById('playing-as-label');

// Nickname modal (pre-game)
const nicknameOverlay  = document.getElementById('nicknameOverlay');
const nicknameInput    = document.getElementById('nicknameInput');
const nicknameSubmit   = document.getElementById('nicknameSubmit');
const nicknameError    = document.getElementById('nicknameError');

// Welcome back modal
const welcomeOverlay   = document.getElementById('welcomeOverlay');
const welcomeName      = document.getElementById('welcomeName');
const welcomeStart     = document.getElementById('welcomeStart');
const changeNameBtn    = document.getElementById('changeNameBtn');

const shareBtnEl       = document.getElementById('shareBtn');

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
let boardLetters   = [];
let foundWords     = new Map();  // word → { nominativePlural, isNominativePlural }
let selectedTiles  = [];
let currentWord    = [];
let timeLeft       = GAME_DURATION;
let timerInterval  = null;
let isGameOver     = false;
let isCountdown    = false;
let challengeDate  = null;  // will be set from server response
let viewingDate    = null;  // date currently shown in the results drawer
let pollInterval   = null;
let isDragging     = false;
let dragMoved      = false;
let touchMoved     = false;
let pointerActive  = false;
let _rafPending    = false;
let _tileCenters   = [];
let _boardRect     = null;
let swipeCanvas    = null;
let swipeCtx       = null;

// Sounds (reuse existing assets)
const correctSound  = new Audio('sounds/correct_answer.mp3');
const incorrectSound = new Audio('sounds/incorrect_answer.mp3');
const timesUpSound  = new Audio('sounds/time_up.mp3');
const tapSound      = new Audio('sounds/tap.m4a');
tapSound.volume = 0.5;

// ---------------------------------------------------------------------------
// Scoring helpers (thin wrappers around game-utils)
// ---------------------------------------------------------------------------
function calculateTotalScore() {
    return window.GameUtils.calculateTotalScore(foundWords);
}

// ---------------------------------------------------------------------------
// Board rendering
// ---------------------------------------------------------------------------
function renderBoard(letters) {
    boardEl.innerHTML = '';
    boardLetters = letters;
    for (let i = 0; i < 16; i++) {
        const row = Math.floor(i / 4);
        const col = i % 4;
        const tile = document.createElement('div');
        tile.classList.add('tile');
        tile.setAttribute('role', 'gridcell');
        tile.setAttribute('aria-pressed', 'false');
        tile.setAttribute('aria-label', letters[i].toUpperCase());
        const span = document.createElement('span');
        span.textContent = letters[i].toUpperCase();
        tile.appendChild(span);
        tile._row = row;
        tile._col = col;
        tile.dataset.index = i;
        boardEl.appendChild(tile);
    }
    cacheTileCenters();
    setupSwipeCanvas();
    bindTileEvents();
}

function cacheTileCenters() {
    _boardRect = boardEl.getBoundingClientRect();
}

function setupSwipeCanvas() {
    const old = boardEl.querySelector('.swipe-canvas');
    if (old) old.remove();
    const canvas = document.createElement('canvas');
    canvas.classList.add('swipe-canvas');
    boardEl.insertBefore(canvas, boardEl.firstChild);
    swipeCanvas = canvas;
    swipeCtx = canvas.getContext('2d');
    _boardRect = boardEl.getBoundingClientRect();
    const observer = new ResizeObserver(() => {
        _boardRect = boardEl.getBoundingClientRect();
        if (selectedTiles.length > 0) {
            _tileCenters = selectedTiles.map(t => centerOf(t));
        }
    });
    observer.observe(boardEl);
}

function centerOf(tile) {
    const r = tile.getBoundingClientRect();
    const b = _boardRect;
    return { x: r.left - b.left + r.width * 0.5, y: r.top - b.top + r.height * 0.5 };
}

function drawSelectionPath() {
    if (!swipeCanvas || selectedTiles.length === 0) {
        if (swipeCanvas && swipeCtx) swipeCtx.clearRect(0, 0, swipeCanvas.width, swipeCanvas.height);
        return;
    }
    const boardR = _boardRect || boardEl.getBoundingClientRect();
    if (swipeCanvas.width !== boardR.width || swipeCanvas.height !== boardR.height) {
        swipeCanvas.width  = boardR.width;
        swipeCanvas.height = boardR.height;
    } else {
        swipeCtx.clearRect(0, 0, swipeCanvas.width, swipeCanvas.height);
    }
    if (_tileCenters.length < 2) return;
    swipeCtx.beginPath();
    swipeCtx.moveTo(_tileCenters[0].x, _tileCenters[0].y);
    for (let i = 1; i < _tileCenters.length; i++) {
        swipeCtx.lineTo(_tileCenters[i].x, _tileCenters[i].y);
    }
    swipeCtx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    swipeCtx.lineWidth   = 40;
    swipeCtx.lineCap     = 'round';
    swipeCtx.lineJoin    = 'round';
    swipeCtx.stroke();
}

// Returns the tile under (x, y) only if inside its inner 75% hit area
function tileAtPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    const tile = el ? el.closest('.tile') : null;
    if (!tile) return null;
    const r = tile.getBoundingClientRect();
    const margin = 0.125;
    const inX = x >= r.left + r.width  * margin && x <= r.right  - r.width  * margin;
    const inY = y >= r.top  + r.height * margin && y <= r.bottom - r.height * margin;
    return (inX && inY) ? tile : null;
}

// ---------------------------------------------------------------------------
// Tile selection — mouse + touch (matches solo game logic)
// ---------------------------------------------------------------------------
function bindTileEvents() {
    boardEl.addEventListener('mousedown', e => {
        const tile = e.target.closest('.tile');
        if (!tile) return;
        isDragging = true;
        dragMoved = false;
        pointerActive = true;
        selectTile(tile);
    });
    boardEl.addEventListener('mousemove', e => {
        if (!isDragging) return;
        drawSelectionPath();
        const tile = tileAtPoint(e.clientX, e.clientY);
        if (!tile) return;
        const last = selectedTiles[selectedTiles.length - 1];
        if (tile !== last) {
            dragMoved = true;
            swipeToTile(tile);
        }
    });
    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        pointerActive = false;
        if (dragMoved) submitWord();
    });
    boardEl.addEventListener('touchstart', e => {
        e.preventDefault();
        touchMoved = false;
        pointerActive = true;
        const touch = e.touches[0];
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        const tile = el ? el.closest('.tile') : null;
        if (tile) selectTile(tile);
    }, { passive: false });
    boardEl.addEventListener('touchmove', e => {
        e.preventDefault();
        const touch = e.touches[0];
        const tile = tileAtPoint(touch.clientX, touch.clientY);
        const lenBefore = selectedTiles.length;
        swipeToTile(tile);
        if (selectedTiles.length !== lenBefore) touchMoved = true;
        if (!_rafPending) {
            _rafPending = true;
            requestAnimationFrame(() => { drawSelectionPath(); _rafPending = false; });
        }
    }, { passive: false });
    boardEl.addEventListener('touchend', () => {
        if (isGameOver || isCountdown) return;
        pointerActive = false;
        if (!touchMoved) return;
        touchMoved = false;
        submitWord();
    });
    document.addEventListener('touchstart', e => {
        if (isGameOver) return;
        if (selectedTiles.length === 0) return;
        const touch = e.touches[0];
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        const isInsideBoard = el && boardEl.contains(el);
        const isButton = el && el.closest('#submitWord');
        if (!isInsideBoard && !isButton) {
            clearSelection();
        }
    }, { passive: true });
}

function tileIndex(tile) { return parseInt(tile.dataset.index, 10); }

function isAdjacent(tile) {
    if (selectedTiles.length === 0) return true;
    const last = selectedTiles[selectedTiles.length - 1];
    return Math.abs(last._row - tile._row) <= 1 && Math.abs(last._col - tile._col) <= 1;
}

function selectTile(tile) {
    if (isGameOver || isCountdown) return;
    if (selectedTiles.includes(tile)) {
        const idx = selectedTiles.indexOf(tile);
        const removed = selectedTiles.splice(idx);
        currentWord.splice(idx);
        _tileCenters.splice(idx);
        removed.forEach(t => { t.classList.remove('selected'); t.setAttribute('aria-pressed', 'false'); });
        updateDisplay();
        return;
    }
    if (selectedTiles.length > 0 && !isAdjacent(tile)) return;
    tile.classList.add('selected');
    tile.setAttribute('aria-pressed', 'true');
    currentWord.push(boardLetters[tileIndex(tile)].toLowerCase());
    selectedTiles.push(tile);
    _tileCenters.push(centerOf(tile));
    tapSound.currentTime = 0; tapSound.play().catch(() => {});
    updateDisplay();
}

function swipeToTile(tile) {
    if (isGameOver || isCountdown) return;
    if (!tile) return;
    const last = selectedTiles[selectedTiles.length - 1];
    if (tile === last) return;
    // Rubber-band: swiping back to second-to-last deselects the last tile
    const secondToLast = selectedTiles[selectedTiles.length - 2];
    if (tile === secondToLast) {
        const removed = selectedTiles.pop();
        currentWord.pop();
        _tileCenters.pop();
        removed.classList.remove('selected');
        removed.setAttribute('aria-pressed', 'false');
        updateDisplay();
        return;
    }
    if (selectedTiles.includes(tile)) return;
    if (!isAdjacent(tile)) return;
    tile.classList.add('selected');
    tile.setAttribute('aria-pressed', 'true');
    currentWord.push(boardLetters[tileIndex(tile)].toLowerCase());
    selectedTiles.push(tile);
    _tileCenters.push(centerOf(tile));
    tapSound.currentTime = 0; tapSound.play().catch(() => {});
    updateDisplay();
}

function clearSelection() {
    selectedTiles.forEach(t => { t.classList.remove('selected'); t.setAttribute('aria-pressed', 'false'); });
    selectedTiles = [];
    currentWord = [];
    _tileCenters = [];
    if (swipeCanvas && swipeCtx) swipeCtx.clearRect(0, 0, swipeCanvas.width, swipeCanvas.height);
    selectedWordEl.textContent = '';
    selectedWordEl.style.color = 'white';
}

function updateDisplay() {
    selectedWordEl.style.color = 'white';
    selectedWordEl.textContent = currentWord.join('').toUpperCase();
    drawSelectionPath();
}

// ---------------------------------------------------------------------------
// Word submission
// ---------------------------------------------------------------------------
async function submitWord() {
    const word = currentWord.join('').toLowerCase();
    clearSelection();

    if (word.length < 3) { flash('Too short — at least 3 letters', '#ff9900', 2000); return; }
    if (foundWords.has(word)) { flash('Word already found!', '#ff9900', 2000); return; }

    // Validate via server
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

    // Reject base word if its plural is already found (matches solo game behavior)
    if (result.nominativePlural && !result.isNominativePlural && foundWords.has(result.nominativePlural)) {
        flash('Plural already found!', '#ff9900', 2000);
        incorrectSound.currentTime = 0; incorrectSound.play().catch(() => {});
        return;
    }

    foundWords.set(word, {
        nominativePlural: result.nominativePlural,
        isNominativePlural: result.isNominativePlural,
    });

    const score = calculateScore(word);
    const total = calculateTotalScore();
    totalScoreEl.textContent = total;
    updateFoundWordsList();

    // If this word is the plural of an already-found base word, show the delta
    const baseEntry = Array.from(foundWords.entries())
        .find(([w, m]) => w !== word && m.nominativePlural === word);
    if (baseEntry) {
        const extraPoints = score - calculateScore(baseEntry[0]);
        flash(`Plural +${extraPoints} ${word.toUpperCase()}`, '#00dd00', 1500);
    } else {
        flash(`+${score} ${word.toUpperCase()}`, '#00dd00', 1500);
    }

    correctSound.currentTime = 0; correctSound.play().catch(() => {});
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
    for (const [word, meta] of foundWords) {
        const len = word.length;
        const listId = len <= 4 ? 'foundWords-34' : len === 5 ? 'foundWords-5' : len === 6 ? 'foundWords-6' : 'foundWords-7plus';
        const li = document.createElement('li');
        li.textContent = word;
        if (isSuperseded(word, foundWords)) li.style.textDecoration = 'line-through';
        document.getElementById(listId).appendChild(li);
        count++;
    }
    foundWordsHeadEl.textContent = `Found Words: ${count}`;
    const hint = document.getElementById('emptyFoundHint');
    if (hint) hint.classList.toggle('hidden', count > 0);
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------
function startTimer() {
    timerEl.textContent = formatTime(timeLeft);
    timerInterval = setInterval(() => {
        timeLeft--;
        timerEl.textContent = formatTime(timeLeft);
        if (timeLeft <= 10) timerEl.classList.add('warning');
        if (timeLeft % 5 === 0) saveProgress(); // throttled progress save
        if (timeLeft <= 0) endGame();
    }, 1000);
}

function formatTime(s) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Countdown (3-2-1-Go)
// ---------------------------------------------------------------------------
function startCountdown(onDone) {
    isCountdown = true;
    let n = 3;
    timerEl.textContent = n;
    const tiles = boardEl.querySelectorAll('.tile');
    // Shake + randomise letters during countdown, like solo mode
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
            // Restore real board letters
            tiles.forEach((t, i) => t.querySelector('span').textContent = boardLetters[i].toUpperCase());
            tiles.forEach(t => {
                t.classList.remove('shuffle-shake');
                t.style.animationDelay = '';
            });
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
    clearSelection();
    gameEl.classList.add('game-over');
    timerEl.textContent = "Time's up!";
    timerEl.classList.add('warning');
    timesUpSound.play().catch(() => {});

    const wordList = Array.from(foundWords.keys());

    try {
        const uuid = getOrCreateUuid();
        const nickname = getNickname();
        const resp = await fetch(`${API}/daily/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uuid, nickname, foundWords: wordList, date: challengeDate }),
        });

        if (resp.status === 409) {
            // Already submitted (e.g. tab was open in two tabs)
        } else if (!resp.ok) {
            console.error('Submit failed:', await resp.text());
        }
    } catch (err) {
        console.error('Submit error:', err);
    }

    // Cache result in localStorage
    storeResult({
        foundWords: wordList,
        score: calculateTotalScore(),
        date: challengeDate,
        completedAt: Date.now(),
    });
    clearProgress();

    // Transition to results
    await showResults();
}

// ---------------------------------------------------------------------------
// Overlay a11y helpers (Escape, focus trap, focus restore)
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
    if (prev && typeof prev.focus === 'function') {
        try { prev.focus(); } catch (_) { /* ignore */ }
    }
}

document.addEventListener('keydown', (e) => {
    const open = document.querySelector('.drawer-overlay.active, .modal-overlay:not(.hidden)');
    if (!open) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        hideOverlay(open);
        return;
    }
    if (e.key === 'Tab') {
        const focusables = Array.from(open.querySelectorAll(FOCUSABLE_SEL))
            .filter(el => el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault(); first.focus();
        }
    }
});

// ---------------------------------------------------------------------------
// Results screen
// ---------------------------------------------------------------------------
function openResultsDrawer() {
    showOverlay(resultsOverlay);
}

async function showResults() {
    openResultsDrawer();

    const stored = getStoredResult();
    const score = stored?.score ?? calculateTotalScore();
    const wordCount = stored?.foundWords?.length ?? foundWords.size;

    resultsDateEl.textContent = `Challenge date: ${challengeDate}`;
    resultsSummaryEl.textContent = `You found ${wordCount} words — score: ${score} pts`;

    playingAsLabel.textContent = `Playing as: ${getNickname()}`;

    await refreshLeaderboard();
    // Poll every 30s
    pollInterval = setInterval(refreshLeaderboard, 30_000);
}

// date helpers
function dateAddDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString('sv-SE');
}

function today() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' });
}

async function refreshLeaderboard() {
    const date = viewingDate || challengeDate || new URLSearchParams(window.location.search).get('date') || '';
    try {
        const r = await fetch(`${API}/daily/leaderboard?date=${date}&includeWords=true`);
        const data = await r.json();
        renderPlayers(data.entries || []);
    } catch (err) {
        console.error('Leaderboard poll error:', err);
    }
    updateDateNav();
}

function updateDateNav() {
    const d = viewingDate || challengeDate || today();
    resultsDateEl.textContent = `Challenge date: ${d}`;
    nextDayBtn.disabled = d >= today();
    nextDayBtn.style.opacity = nextDayBtn.disabled ? '0.3' : '';
}

// Results drawer date navigation
prevDayBtn.addEventListener('click', async () => {
    const base = viewingDate || challengeDate || today();
    viewingDate = dateAddDays(base, -1);
    resultsSummaryEl.textContent = '';
    playingAsLabel.textContent = '';
    playersList.innerHTML = '';
    await refreshLeaderboard();
});

nextDayBtn.addEventListener('click', async () => {
    const base = viewingDate || challengeDate || today();
    const next = dateAddDays(base, 1);
    if (next > today()) return;
    viewingDate = next;
    // If navigated back to today, restore player's own results
    if (viewingDate === (challengeDate || today())) {
        viewingDate = null;
        const stored = getStoredResult();
        if (stored && stored.date === (challengeDate || today())) {
            resultsSummaryEl.textContent = `You found ${stored.foundWords.length} words — score: ${stored.score} pts`;
            playingAsLabel.textContent = `Playing as: ${getNickname()}`;
        } else {
            resultsSummaryEl.textContent = '';
            playingAsLabel.textContent = '';
        }
    } else {
        resultsSummaryEl.textContent = '';
        playingAsLabel.textContent = '';
    }
    playersList.innerHTML = '';
    await refreshLeaderboard();
});

// Results drawer open/close
document.getElementById('leaderboardBtn').addEventListener('click', () => {
    viewingDate = null;
    openResultsDrawer();
});
document.getElementById('resultsClose').addEventListener('click', () => {
    hideOverlay(resultsOverlay);
});
// #19 — only close on a click that *both* started and ended on the overlay backdrop.
// Without this, a drag that starts inside the drawer and releases on the backdrop
// (e.g. flicking text selection) was closing the drawer.
let _resultsMouseDownOnBackdrop = false;
resultsOverlay.addEventListener('mousedown', e => {
    _resultsMouseDownOnBackdrop = (e.target === resultsOverlay);
});
resultsOverlay.addEventListener('click', e => {
    if (e.target === resultsOverlay && _resultsMouseDownOnBackdrop) hideOverlay(resultsOverlay);
    _resultsMouseDownOnBackdrop = false;
});

// #7 + #28 — Back button: warn if a game is in progress, otherwise navigate.
const backBtnEl = document.getElementById('backBtn');
function isGameInProgress() {
    return !isGameOver && Array.isArray(boardLetters) && boardLetters.length === 16
        && typeof timeLeft === 'number' && timeLeft > 0 && timeLeft < GAME_DURATION;
}
if (backBtnEl) {
    backBtnEl.addEventListener('click', () => {
        if (isGameInProgress()) {
            const ok = confirm('Quit the daily challenge? Your progress is saved and you can resume later today.');
            if (!ok) return;
        }
        window.location.href = 'index.html';
    });
}
window.addEventListener('beforeunload', e => {
    if (isGameInProgress()) {
        e.preventDefault();
        e.returnValue = '';
        return '';
    }
});

function renderPlayers(entries) {
    const myUuid = getOrCreateUuid();
    // We don't have other players' UUIDs from the leaderboard — identify self by nickname match
    const myNickname = getNickname();

    playersList.innerHTML = '';

    // Sort: self first, then by rank
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

        const words = entry.words ?? [];
        const header = `
            <div class="player-card-header">
                <span class="player-nickname">${escHtml(entry.nickname)}${isMe ? ' (you)' : ''}</span>
                <span class="player-score">${entry.score} pts</span>
                <span class="player-unique-count">${entry.uniqueWordCount} unique</span>
            </div>`;

        const chips = words.map(w => {
            const cls = w.isSuperseded ? ' superseded' : w.isUnique ? '' : ' stolen';
            return `<span class="word-chip${cls}">${escHtml(w.word)}</span>`;
        }).join('');

        card.innerHTML = header + `<div class="player-words">${chips}</div>`;
        playersList.appendChild(card);
    }
}

function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------
shareBtnEl.addEventListener('click', async () => {
    const url = `${window.location.origin}/daily/${challengeDate}`;
    const showCopied = () => {
        shareBtnEl.textContent = 'Copied!';
        setTimeout(() => { shareBtnEl.textContent = '🔗 Copy link'; }, 2000);
    };
    // Try the modern clipboard API (requires HTTPS + user gesture, may be undefined on iOS Safari < 13.4)
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(url);
            showCopied();
            return;
        }
    } catch (_) { /* fall through to legacy */ }
    // Legacy fallback: hidden textarea + execCommand('copy')
    try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) { showCopied(); return; }
    } catch (_) { /* fall through */ }
    // Last resort: show the URL so the user can copy manually
    prompt('Copy this link:', url);
});

// ---------------------------------------------------------------------------
// Nickname modal (pre-game)
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
// Welcome back modal (returning user, hasn't played today)
// ---------------------------------------------------------------------------
welcomeStart.addEventListener('click', () => {
    hideOverlay(welcomeOverlay);
    startGame();
});

changeNameBtn.addEventListener('click', () => {
    hideOverlay(welcomeOverlay);
    nicknameInput.value = '';
    nicknameError.textContent = '';
    nicknameSubmit.disabled = true;
    showOverlay(nicknameOverlay);
    nicknameInput.focus();
});

// ---------------------------------------------------------------------------
// Submit word button
// ---------------------------------------------------------------------------
submitWordBtn.addEventListener('click', () => {
    tapSound.currentTime = 0; tapSound.play().catch(() => {});
    submitWord();
});

// ---------------------------------------------------------------------------
// Game start
// ---------------------------------------------------------------------------
async function startGame() {
    // Fetch board from server
    const dateParam = challengeDate ? `?date=${challengeDate}` : '';
    let boardData;
    try {
        const r = await fetch(`${API}/daily/board${dateParam}`);
        boardData = await r.json();
    } catch (err) {
        alert('Could not load today\'s board. Please check your connection.');
        return;
    }

    challengeDate = boardData.date;
    resultsDateEl.textContent = `Challenge date: ${challengeDate}`;

    // Board is already rendered + visible behind the modal; just load real letters
    boardLetters = boardData.letters;
    startCountdown(() => {
        timeLeft = GAME_DURATION;
        startTimer();
        saveProgress();
    });
}

// Save progress when the user backgrounds / closes the tab
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveProgress();
});
window.addEventListener('pagehide', saveProgress);

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function init() {
    const urlDate = getDateFromUrl();
    if (urlDate) {
        challengeDate = urlDate;
    }

    const isPastDate = urlDate && urlDate < new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' });

    // Past date: show leaderboard only (view-only mode)
    if (isPastDate) {
        challengeDate = urlDate;
        resultsDateEl.textContent = `Challenge date: ${challengeDate}`;
        resultsSummaryEl.textContent = 'This challenge is closed.';
        playingAsLabel.textContent = '';
        openResultsDrawer();
        await refreshLeaderboard();
        return;
    }

    // Check if already played today
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' });
    const stored = getStoredResult();
    if (stored && stored.date === today) {
        challengeDate = today;
        const completedSuffix = stored.completedAt
            ? ` · finished ${new Date(stored.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : '';
        resultsSummaryEl.textContent =
            `You found ${stored.foundWords.length} words — score: ${stored.score} pts${completedSuffix}`;
        resultsDateEl.textContent = `Challenge date: ${challengeDate}`;
        playingAsLabel.textContent = `Playing as: ${getNickname()}`;
        // Load the board in the background (disabled)
        try {
            const r = await fetch(`${API}/daily/board?date=${challengeDate}`);
            const boardData = await r.json();
            renderBoard(boardData.letters);
            isGameOver = true;
            selectedWordEl.textContent = 'Already played';
            selectedWordEl.style.color = 'white';
            gameEl.classList.remove('hidden');
            gameEl.classList.add('game-over');
        } catch (_) { /* board fetch failed — just show results without background */ }
        openResultsDrawer();
        await refreshLeaderboard();
        pollInterval = setInterval(refreshLeaderboard, 30_000);
        return;
    }

    // Check for an in-progress game (tab closed / reload mid-game)
    const progress = getStoredProgress();
    if (progress && progress.date === today
        && Array.isArray(progress.boardLetters) && progress.boardLetters.length === 16
        && typeof progress.timeLeft === 'number' && progress.timeLeft > 0) {
        challengeDate = today;
        resultsDateEl.textContent = `Challenge date: ${challengeDate}`;
        boardLetters = progress.boardLetters;
        renderBoard(boardLetters);
        gameEl.classList.remove('hidden');
        // Restore found words
        foundWords = new Map(progress.foundWords || []);
        timeLeft = progress.timeLeft;
        totalScoreEl.textContent = calculateTotalScore();
        updateFoundWordsList();
        // Resume directly into the timer (skip welcome modal + countdown)
        startTimer();
        return;
    }

    // First time today — show the board behind the modal immediately
    renderBoard(randomDiceFace());
    gameEl.classList.remove('hidden');

    if (!getNickname()) {
        showOverlay(nicknameOverlay);
        // startGame() is called from nickname submit handler
    } else {
        welcomeName.textContent = getNickname();
        showOverlay(welcomeOverlay);
        // startGame() is called from welcomeStart handler
    }
}

document.addEventListener('DOMContentLoaded', init);
