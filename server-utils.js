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
