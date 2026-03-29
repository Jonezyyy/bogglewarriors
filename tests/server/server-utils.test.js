import { describe, it, expect } from 'vitest';
import {
    calculateWordScore, isSupersededWord,
    getScoreMode,
    normalizeBoardLetters,
    buildBoardNeighbors, BOARD_NEIGHBORS,
    analyzeFinnishBoard,
    BOARD_CELLS
} from '../../server-utils.js';

// ---------------------------------------------------------------------------
// calculateWordScore  (re-export from game-utils)
// ---------------------------------------------------------------------------
describe('calculateWordScore', () => {
    it('returns 0 for a 1-letter word', () => expect(calculateWordScore('a')).toBe(0));
    it('returns 0 for a 2-letter word', () => expect(calculateWordScore('ab')).toBe(0));
    it('returns 1 for a 3-letter word', () => expect(calculateWordScore('abc')).toBe(1));
    it('returns 1 for a 4-letter word', () => expect(calculateWordScore('abcd')).toBe(1));
    it('returns 2 for a 5-letter word', () => expect(calculateWordScore('abcde')).toBe(2));
    it('returns 3 for a 6-letter word', () => expect(calculateWordScore('abcdef')).toBe(3));
    it('returns 5 for a 7-letter word', () => expect(calculateWordScore('abcdefg')).toBe(5));
    it('returns 11 for an 8-letter word', () => expect(calculateWordScore('abcdefgh')).toBe(11));
});

// ---------------------------------------------------------------------------
// isSupersededWord  (re-export from game-utils)
// ---------------------------------------------------------------------------
describe('isSupersededWord', () => {
    function makeCache(entries) {
        return new Map(entries);
    }

    it('returns false when word has no metadata', () => {
        const m = makeCache([]);
        expect(isSupersededWord('koira', m)).toBe(false);
    });

    it('returns false when nominativePlural is null', () => {
        const m = makeCache([['koira', { nominativePlural: null, isNominativePlural: false }]]);
        expect(isSupersededWord('koira', m)).toBe(false);
    });

    it('returns false when isNominativePlural is true', () => {
        const m = makeCache([
            ['koirat', { nominativePlural: null, isNominativePlural: true }]
        ]);
        expect(isSupersededWord('koirat', m)).toBe(false);
    });

    it('returns false when plural form not in cache', () => {
        const m = makeCache([['koira', { nominativePlural: 'koirat', isNominativePlural: false }]]);
        expect(isSupersededWord('koira', m)).toBe(false);
    });

    it('returns true when plural form is also in cache', () => {
        const m = makeCache([
            ['koira', { nominativePlural: 'koirat', isNominativePlural: false }],
            ['koirat', { nominativePlural: null, isNominativePlural: true }]
        ]);
        expect(isSupersededWord('koira', m)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// getScoreMode
// ---------------------------------------------------------------------------
describe('getScoreMode', () => {
    it('returns "unlimited" for "unlimited"', () => expect(getScoreMode('unlimited')).toBe('unlimited'));
    it('returns "timed" for "timed"', () => expect(getScoreMode('timed')).toBe('timed'));
    it('returns "timed" for an empty string', () => expect(getScoreMode('')).toBe('timed'));
    it('returns "timed" for undefined', () => expect(getScoreMode(undefined)).toBe('timed'));
    it('returns "timed" for an unknown value', () => expect(getScoreMode('marathon')).toBe('timed'));
});

// ---------------------------------------------------------------------------
// normalizeBoardLetters
// ---------------------------------------------------------------------------
describe('normalizeBoardLetters', () => {
    function makeBoard(override = {}) {
        const base = Array(16).fill('a');
        Object.entries(override).forEach(([i, v]) => { base[i] = v; });
        return base;
    }

    it('accepts a valid 16-letter lowercase array', () => {
        const board = makeBoard();
        expect(normalizeBoardLetters(board)).toEqual(board);
    });

    it('uppercases letters to lowercase', () => {
        const board = makeBoard({ 0: 'A', 1: 'B', 2: 'C' });
        const result = normalizeBoardLetters(board);
        expect(result[0]).toBe('a');
        expect(result[1]).toBe('b');
        expect(result[2]).toBe('c');
    });

    it('accepts Finnish characters ä and ö', () => {
        const board = makeBoard({ 0: 'ä', 1: 'ö' });
        const result = normalizeBoardLetters(board);
        expect(result).not.toBeNull();
        expect(result[0]).toBe('ä');
        expect(result[1]).toBe('ö');
    });

    it('returns null for non-array input', () => {
        expect(normalizeBoardLetters('aaaaaaaaaaaaaaaa')).toBeNull();
    });

    it('returns null for array with wrong length', () => {
        expect(normalizeBoardLetters(Array(15).fill('a'))).toBeNull();
        expect(normalizeBoardLetters(Array(17).fill('a'))).toBeNull();
    });

    it('returns null when a cell is a number', () => {
        expect(normalizeBoardLetters(makeBoard({ 3: 1 }))).toBeNull();
    });

    it('returns null when a cell is a multi-char string', () => {
        expect(normalizeBoardLetters(makeBoard({ 0: 'ab' }))).toBeNull();
    });

    it('returns null when a cell is a digit character', () => {
        expect(normalizeBoardLetters(makeBoard({ 5: '3' }))).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// buildBoardNeighbors / BOARD_NEIGHBORS
// ---------------------------------------------------------------------------
describe('buildBoardNeighbors', () => {
    const neighbors = buildBoardNeighbors();

    it('returns an array of 16 entries', () => {
        expect(neighbors).toHaveLength(BOARD_CELLS);
    });

    it('corner cell (index 0) has exactly 3 neighbours', () => {
        expect(neighbors[0]).toHaveLength(3);
    });

    it('edge cell (index 1) has exactly 5 neighbours', () => {
        expect(neighbors[1]).toHaveLength(5);
    });

    it('center cell (index 5) has exactly 8 neighbours', () => {
        expect(neighbors[5]).toHaveLength(8);
    });

    it('no cell lists itself as a neighbour', () => {
        for (let i = 0; i < BOARD_CELLS; i++) {
            expect(neighbors[i]).not.toContain(i);
        }
    });

    it('adjacency is symmetric', () => {
        for (let i = 0; i < BOARD_CELLS; i++) {
            for (const j of neighbors[i]) {
                expect(neighbors[j]).toContain(i);
            }
        }
    });

    it('BOARD_NEIGHBORS equals the output of buildBoardNeighbors()', () => {
        expect(BOARD_NEIGHBORS).toEqual(neighbors);
    });
});

// ---------------------------------------------------------------------------
// analyzeFinnishBoard
// ---------------------------------------------------------------------------

/** Build a minimal cache from a word list */
function makeCache(wordList) {
    const metadataByWord = new Map();
    const prefixes = new Set();

    for (const word of wordList) {
        metadataByWord.set(word, { nominativePlural: null, isNominativePlural: false });
        for (let i = 1; i <= word.length; i++) {
            prefixes.add(word.slice(0, i));
        }
    }

    return { metadataByWord, prefixes };
}

/** Build a neighbour graph for a tiny linear chain: 0-1-2-3-…  */
function linearNeighbors(n) {
    return Array.from({ length: n }, (_, i) => {
        const nb = [];
        if (i > 0) nb.push(i - 1);
        if (i < n - 1) nb.push(i + 1);
        return nb;
    });
}

describe('analyzeFinnishBoard', () => {
    it('finds a word formed by adjacent cells', () => {
        // board: k-o-i-r-a + 11 filler cells
        const letters = ['k', 'o', 'i', 'r', 'a', ...Array(11).fill('x')];
        const cache = makeCache(['koira']);
        // linear chain so cells 0-4 are all adjacent
        const neighbors = linearNeighbors(16);

        const result = analyzeFinnishBoard(letters, cache, neighbors);
        expect(result.words.map(w => w.word)).toContain('koira');
    });

    it('does not find a word whose letters are not adjacent', () => {
        // 'koira' letters are at positions 0,5,10,15,3 — not a connected path
        const letters = Array(16).fill('x');
        letters[0] = 'k'; letters[5] = 'o'; letters[10] = 'i'; letters[15] = 'r'; letters[3] = 'a';
        const cache = makeCache(['koira']);

        const result = analyzeFinnishBoard(letters, cache, BOARD_NEIGHBORS);
        expect(result.words.map(w => w.word)).not.toContain('koira');
    });

    it('returns correct totalWords count', () => {
        const letters = ['k', 'o', 'i', 'r', 'a', ...Array(11).fill('x')];
        const cache = makeCache(['koira', 'koi', 'oir']);
        const neighbors = linearNeighbors(16);

        const result = analyzeFinnishBoard(letters, cache, neighbors);
        expect(result.totalWords).toBe(result.words.length);
        expect(result.totalWords).toBeGreaterThan(0);
    });

    it('maxScore excludes superseded words', () => {
        // 'koira' is superseded by 'koirat' — only 'koirat' should count
        const letters = ['k', 'o', 'i', 'r', 'a', 't', ...Array(10).fill('x')];
        const cache = makeCache(['koira', 'koirat']);
        // Patch metadata so koira is superseded
        cache.metadataByWord.set('koira', { nominativePlural: 'koirat', isNominativePlural: false });
        cache.metadataByWord.set('koirat', { nominativePlural: null, isNominativePlural: true });

        const neighbors = linearNeighbors(16);
        const result = analyzeFinnishBoard(letters, cache, neighbors);

        const expectedScore = calculateWordScore('koirat'); // 3 (6 letters)
        expect(result.maxScore).toBe(expectedScore);
    });

    it('returns empty result for an all-filler board with no matching words', () => {
        const letters = Array(16).fill('x');
        const cache = makeCache(['koira']);

        const result = analyzeFinnishBoard(letters, cache, BOARD_NEIGHBORS);
        expect(result.totalWords).toBe(0);
        expect(result.maxScore).toBe(0);
        expect(result.words).toEqual([]);
    });
});
