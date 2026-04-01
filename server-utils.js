// Pure server-side utilities — no DB, no Express, no file I/O.
// Shared by server.js and the test suite.
//
// Scoring and supersede logic are re-exported from game-utils.js to keep a
// single source of truth across client and server.

export { calculateScore as calculateWordScore, isSuperseded as isSupersededWord } from './game-utils.js';
import { calculateScore as calculateWordScore, isSuperseded as isSupersededWord } from './game-utils.js';

export const BOARD_SIZE = 4;
export const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
export const MAX_WORD_LENGTH = 16;

/**
 * Normalize raw mode value to stored mode string.
 * @param {string} value
 * @returns {'unlimited'|'timed'}
 */
export function getScoreMode(value) {
    return value === 'unlimited' ? 'unlimited' : 'timed';
}

/**
 * Validate and normalize a board letters array.
 * Returns null if invalid, or a 16-element lowercase string array if valid.
 * @param {unknown} letters
 * @returns {string[]|null}
 */
export function normalizeBoardLetters(letters) {
    if (!Array.isArray(letters) || letters.length !== BOARD_CELLS) return null;

    const normalized = letters.map(letter => {
        if (typeof letter !== 'string') return null;
        const trimmed = letter.trim().toLowerCase();
        if (!/^[a-zäö]$/.test(trimmed)) return null;
        return trimmed;
    });

    return normalized.every(Boolean) ? normalized : null;
}

/**
 * Build the adjacency list for a 4×4 Boggle board.
 * @returns {number[][]}  16 arrays of neighbour indices
 */
export function buildBoardNeighbors() {
    const neighbors = Array.from({ length: BOARD_CELLS }, () => []);

    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const index = row * BOARD_SIZE + col;
            for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
                for (let colOffset = -1; colOffset <= 1; colOffset++) {
                    if (rowOffset === 0 && colOffset === 0) continue;
                    const nextRow = row + rowOffset;
                    const nextCol = col + colOffset;
                    if (nextRow < 0 || nextRow >= BOARD_SIZE || nextCol < 0 || nextCol >= BOARD_SIZE) continue;
                    neighbors[index].push(nextRow * BOARD_SIZE + nextCol);
                }
            }
        }
    }

    return neighbors;
}

export const BOARD_NEIGHBORS = buildBoardNeighbors();

/**
 * Find all valid words on a board using DFS, then compute max possible score.
 * Pure — depends only on the supplied neighbor list and cache.
 *
 * @param {string[]} letters  16 lowercase letter strings (pre-validated)
 * @param {{ metadataByWord: Map, prefixes: Set }} cache
 * @param {number[][]} [neighbors]  defaults to BOARD_NEIGHBORS
 * @returns {{ words: object[], totalWords: number, maxScore: number }}
 */
export function analyzeFinnishBoard(letters, cache, neighbors = BOARD_NEIGHBORS) {
    const foundWords = new Set();
    const visited = new Array(BOARD_CELLS).fill(false);

    function dfs(index, currentWord) {
        const nextWord = currentWord + letters[index];
        if (!cache.prefixes.has(nextWord)) return;
        if (cache.metadataByWord.has(nextWord)) foundWords.add(nextWord);
        if (nextWord.length >= MAX_WORD_LENGTH) return;

        visited[index] = true;
        for (const neighbor of neighbors[index]) {
            if (!visited[neighbor]) dfs(neighbor, nextWord);
        }
        visited[index] = false;
    }

    for (let index = 0; index < BOARD_CELLS; index++) dfs(index, '');

    const foundMetadata = new Map();
    const words = Array.from(foundWords).sort().map(word => {
        const meta = cache.metadataByWord.get(word);
        foundMetadata.set(word, meta);
        return { word, nominativePlural: meta.nominativePlural, isNominativePlural: meta.isNominativePlural };
    });

    const maxScore = words.reduce((total, entry) =>
        total + (isSupersededWord(entry.word, foundMetadata) ? 0 : calculateWordScore(entry.word)), 0);

    return { words, totalWords: words.length, maxScore };
}

// ---------------------------------------------------------------------------
// Daily Challenge utilities
// ---------------------------------------------------------------------------

/**
 * Return today's date string in YYYY-MM-DD format, using the Europe/Helsinki timezone.
 * @returns {string}
 */
export function getTodayHelsinki() {
    // 'sv-SE' locale produces ISO-format dates (YYYY-MM-DD)
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' });
}

/**
 * Mulberry32 — simple seedable PRNG, no dependencies.
 * @param {number} seed
 * @returns {() => number}  returns values in [0, 1)
 */
function mulberry32(seed) {
    return () => {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Deterministically generate a 16-letter board seeded by date string.
 * Each element of diceSet is a string of letter-faces (e.g. "AISPUJ").
 * @param {string} dateStr  'YYYY-MM-DD'
 * @param {string[]} diceSet  array of 16 dice strings
 * @returns {string[]}  16 lowercase letter strings
 */
export function generateDailyBoard(dateStr, diceSet) {
    const seed = parseInt(dateStr.replace(/-/g, ''), 10); // e.g. 20260401
    const rand = mulberry32(seed);
    const dice = [...diceSet];
    // Fisher-Yates shuffle
    for (let i = dice.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [dice[i], dice[j]] = [dice[j], dice[i]];
    }
    return dice.map(die => die[Math.floor(rand() * die.length)].toLowerCase());
}

/**
 * Normalize a word to its base (singular) form using a plural→singular reverse map.
 * Falls back to the word itself if not found.
 * @param {string} word
 * @param {Map<string,string>} singularByPlural
 * @returns {string}
 */
export function normalizeWordForDedup(word, singularByPlural) {
    return singularByPlural.get(word) ?? word;
}

/**
 * Compute daily challenge scores across all submissions for a single day.
 * A word scores points only if exactly one player found it (by normalized form).
 * Singular and plural forms of the same root count as the same word.
 *
 * @param {Array<{uuid: string, nickname: string, found_words: string}>} submissions  rows from daily_submissions
 * @param {Map<string,string>} singularByPlural  plural→base reverse map
 * @returns {Array<{uuid, nickname, score, uniqueWordCount}>}  sorted by score desc
 */
export function computeDailyScores(submissions, singularByPlural) {
    // Step 1: map each normalized word → set of UUIDs that found it
    const wordOwners = new Map();
    for (const sub of submissions) {
        const words = typeof sub.found_words === 'string'
            ? JSON.parse(sub.found_words)
            : sub.found_words;
        const seen = new Set();
        for (const w of words) {
            const norm = normalizeWordForDedup(w, singularByPlural);
            if (seen.has(norm)) continue;
            seen.add(norm);
            if (!wordOwners.has(norm)) wordOwners.set(norm, new Set());
            wordOwners.get(norm).add(sub.uuid);
        }
    }

    // Step 2: score each submission — only words with exactly 1 unique owner count
    return submissions.map(sub => {
        const words = typeof sub.found_words === 'string'
            ? JSON.parse(sub.found_words)
            : sub.found_words;
        const counted = new Set();
        let score = 0;
        let uniqueWordCount = 0;
        for (const w of words) {
            const norm = normalizeWordForDedup(w, singularByPlural);
            if (counted.has(norm)) continue;
            counted.add(norm);
            if (wordOwners.get(norm)?.size === 1) {
                score += calculateWordScore(w);
                uniqueWordCount++;
            }
        }
        return { uuid: sub.uuid, nickname: sub.nickname, score, uniqueWordCount };
    }).sort((a, b) => b.score - a.score);
}

/**
 * Build a plural→singular reverse map from the sanakirja cache metadata.
 * @param {Map<string, {nominativePlural: string|null, isNominativePlural: boolean}>} metadataByWord
 * @returns {Map<string,string>}
 */
export function buildSingularByPlural(metadataByWord) {
    const map = new Map();
    for (const [base, meta] of metadataByWord) {
        if (meta.nominativePlural) {
            map.set(meta.nominativePlural, base);
        }
    }
    return map;
}
