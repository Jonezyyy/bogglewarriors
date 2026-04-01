// Daily Challenge — client-side game logic.
// Plain script (no ES modules) so it works when opened as file:// locally.

function calculateScore(word) {
    const l = word.length;
    return l >= 8 ? 11 : l === 7 ? 5 : l === 6 ? 3 : l === 5 ? 2 : l >= 3 ? 1 : 0;
}

function isSuperseded(word, foundWords) {
    const meta = foundWords.get(word);
    if (!meta || meta.isNominativePlural) return false;
    return meta.nominativePlural !== null && foundWords.has(meta.nominativePlural);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const API = "https://bogglewarriors-production.up.railway.app";
const GAME_DURATION = 90; // seconds

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

function getStoredResult() {
    const raw = localStorage.getItem(todayKey());
    return raw ? JSON.parse(raw) : null;
}

function storeResult(data) {
    localStorage.setItem(todayKey(), JSON.stringify(data));
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
const playingAsLabel   = document.getElementById('playing-as-label');

// Nickname modal (pre-game)
const nicknameOverlay  = document.getElementById('nicknameOverlay');
const nicknameInput    = document.getElementById('nicknameInput');
const nicknameSubmit   = document.getElementById('nicknameSubmit');
const nicknameError    = document.getElementById('nicknameError');

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
let pollInterval   = null;
let tileCenters    = [];
let boardRect      = null;
let isDragging     = false;
let dragMoved      = false;
let touchMoved     = false;

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
    let total = 0;
    for (const [word, meta] of foundWords) {
        const metaMap = foundWords; // isSuperseded uses the same Map
        if (!isSuperseded(word, metaMap)) {
            total += calculateScore(word);
        }
    }
    return total;
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
        const span = document.createElement('span');
        span.textContent = letters[i].toUpperCase();
        tile.appendChild(span);
        tile._row = row;
        tile._col = col;
        tile.dataset.index = i;
        boardEl.appendChild(tile);
    }
    cacheTileCenters();
    bindTileEvents();
}

function cacheTileCenters() {
    boardRect = boardEl.getBoundingClientRect();
    tileCenters = Array.from(boardEl.querySelectorAll('.tile')).map(t => {
        const r = t.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
}

// ---------------------------------------------------------------------------
// Tile selection — mouse + touch
// ---------------------------------------------------------------------------
function bindTileEvents() {
    const tiles = boardEl.querySelectorAll('.tile');
    tiles.forEach(tile => {
        tile.addEventListener('mousedown', e => {
            e.preventDefault();
            isDragging = true;
            dragMoved = false;
            startSelection(tile);
        });
        tile.addEventListener('mouseover', e => {
            if (e.buttons === 1) extendSelection(tile);
        });
        tile.addEventListener('touchstart', e => {
            e.preventDefault();
            touchMoved = false;
            startSelection(tile);
        }, { passive: false });
        tile.addEventListener('touchmove', e => {
            e.preventDefault();
            const t = e.touches[0];
            const el = document.elementFromPoint(t.clientX, t.clientY);
            const over = el?.closest('.tile');
            if (over) extendSelection(over);
        }, { passive: false });
    });
    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        if (dragMoved) submitWord();
    });
    boardEl.addEventListener('touchend', () => {
        if (isGameOver || isCountdown) return;
        if (!touchMoved) return;
        touchMoved = false;
        submitWord();
    });
}

function tileIndex(tile) { return parseInt(tile.dataset.index, 10); }

function isAdjacent(tile) {
    if (selectedTiles.length === 0) return true;
    const last = selectedTiles[selectedTiles.length - 1];
    return Math.abs(last._row - tile._row) <= 1 && Math.abs(last._col - tile._col) <= 1;
}

function startSelection(tile) {
    if (isGameOver || isCountdown) return;
    clearSelection();
    addTile(tile);
    tapSound.currentTime = 0; tapSound.play();
}

function extendSelection(tile) {
    if (isGameOver || isCountdown) return;
    if (selectedTiles.includes(tile)) {
        // Backtrack to this tile
        const idx = selectedTiles.indexOf(tile);
        const removed = selectedTiles.splice(idx + 1);
        currentWord.splice(idx + 1);
        removed.forEach(t => t.classList.remove('selected'));
    } else {
        if (!isAdjacent(tile)) return;
        dragMoved = true;
        touchMoved = true;
        addTile(tile);
        tapSound.currentTime = 0; tapSound.play();
    }
    updateDisplay();
}

function addTile(tile) {
    tile.classList.add('selected');
    selectedTiles.push(tile);
    currentWord.push(boardLetters[tileIndex(tile)].toLowerCase());
    updateDisplay();
}

function clearSelection() {
    selectedTiles.forEach(t => t.classList.remove('selected'));
    selectedTiles = [];
    currentWord = [];
    selectedWordEl.textContent = '';
    selectedWordEl.style.color = 'white';
}

function updateDisplay() {
    selectedWordEl.textContent = currentWord.join('').toUpperCase();
}

// ---------------------------------------------------------------------------
// Word submission
// ---------------------------------------------------------------------------
async function submitWord() {
    const word = currentWord.join('').toLowerCase();
    clearSelection();

    if (word.length < 3) { flash('Too short', 'orange'); return; }
    if (foundWords.has(word)) { flash('Already found', 'orange'); return; }

    // Validate via server
    let result;
    try {
        const r = await fetch(
            `${API}/validate-word/${encodeURIComponent(word)}?lang=fi&dict=sanakirja`,
            { signal: AbortSignal.timeout(5000) }
        );
        result = await r.json();
    } catch {
        flash('Error checking word', 'orange');
        return;
    }

    if (!result.exists) {
        flash('Not a word', '#ff6b6b');
        incorrectSound.currentTime = 0; incorrectSound.play();
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

    const msg = result.isNominativePlural && result.nominativePlural && foundWords.has(result.nominativePlural)
        ? null  // base word already shown; plural supersedes it
        : `+${score} ${word.toUpperCase()}`;
    if (msg) flash(msg, '#00dd00', 1500);

    correctSound.currentTime = 0; correctSound.play();
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
    const id = setInterval(() => {
        n--;
        if (n <= 0) {
            clearInterval(id);
            timerEl.textContent = 'Go!';
            timerEl.classList.remove('warning');
            setTimeout(() => {
                isCountdown = false;
                timerEl.textContent = formatTime(GAME_DURATION);
                onDone();
            }, 600);
        } else {
            timerEl.textContent = n;
        }
    }, 700);
}

// ---------------------------------------------------------------------------
// End game + submit to server
// ---------------------------------------------------------------------------
async function endGame() {
    if (isGameOver) return;
    clearInterval(timerInterval);
    isGameOver = true;
    timerEl.textContent = "Time's up!";
    timerEl.classList.add('warning');
    timesUpSound.play();

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
    storeResult({ foundWords: wordList, score: calculateTotalScore(), date: challengeDate });

    // Transition to results
    await showResults();
}

// ---------------------------------------------------------------------------
// Results screen
// ---------------------------------------------------------------------------
function openResultsDrawer() {
    resultsOverlay.classList.add('active');
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

async function refreshLeaderboard() {
    const date = challengeDate || new URLSearchParams(window.location.search).get('date') || '';
    try {
        const r = await fetch(`${API}/daily/leaderboard?date=${date}&includeWords=true`);
        const data = await r.json();
        renderPlayers(data.entries || []);
    } catch (err) {
        console.error('Leaderboard poll error:', err);
    }
}

// Results drawer open/close
document.getElementById('leaderboardBtn').addEventListener('click', openResultsDrawer);
document.getElementById('resultsClose').addEventListener('click', () => {
    resultsOverlay.classList.remove('active');
});
resultsOverlay.addEventListener('click', e => {
    if (e.target === resultsOverlay) resultsOverlay.classList.remove('active');
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

        const chips = words.map(w =>
            `<span class="word-chip${w.isUnique ? '' : ' stolen'}">${escHtml(w.word)}</span>`
        ).join('');

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
shareBtnEl.addEventListener('click', () => {
    const url = `${window.location.origin}/daily/${challengeDate}`;
    navigator.clipboard.writeText(url).then(() => {
        shareBtnEl.textContent = 'Copied!';
        setTimeout(() => { shareBtnEl.textContent = '🔗 Copy link'; }, 2000);
    }).catch(() => {
        prompt('Copy this link:', url);
    });
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
    nicknameOverlay.classList.add('hidden');
    startGame();
});

nicknameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !nicknameSubmit.disabled) nicknameSubmit.click();
});

// ---------------------------------------------------------------------------
// Submit word button
// ---------------------------------------------------------------------------
submitWordBtn.addEventListener('click', () => {
    tapSound.currentTime = 0; tapSound.play();
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

    renderBoard(boardData.letters);
    gameEl.classList.remove('hidden');

    startCountdown(() => {
        timeLeft = GAME_DURATION;
        startTimer();
    });
}

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
    const stored = getStoredResult();
    if (stored) {
        challengeDate = stored.date || urlDate || new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' });
        resultsSummaryEl.textContent = `You found ${stored.foundWords.length} words — score: ${stored.score} pts`;
        resultsDateEl.textContent = `Challenge date: ${challengeDate}`;
        playingAsLabel.textContent = `Playing as: ${getNickname()}`;
        openResultsDrawer();
        await refreshLeaderboard();
        pollInterval = setInterval(refreshLeaderboard, 30_000);
        return;
    }

    // First time today — check nickname
    if (!getNickname()) {
        nicknameOverlay.classList.remove('hidden');
        // startGame() is called from nickname submit handler
    } else {
        startGame();
    }
}

document.addEventListener('DOMContentLoaded', init);
