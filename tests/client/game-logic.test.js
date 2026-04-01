import { describe, it, expect, vi } from 'vitest';
import { calculateScore, calculateTotalScore, isSuperseded, validateWordLocal,
         formatTimer, buildFoundProgressText, rollDice } from '../../game-utils.js';

// ── calculateScore ─────────────────────────────────────────────────────────

describe('calculateScore', () => {
    it('returns 0 for a 2-letter word', () => {
        expect(calculateScore('ab')).toBe(0);
    });

    it('returns 1 for a 3-letter word', () => {
        expect(calculateScore('koi')).toBe(1);
    });

    it('returns 1 for a 4-letter word', () => {
        expect(calculateScore('talo')).toBe(1);
    });

    it('returns 2 for a 5-letter word', () => {
        expect(calculateScore('koira')).toBe(2);
    });

    it('returns 3 for a 6-letter word', () => {
        expect(calculateScore('taloni')).toBe(3);
    });

    it('returns 5 for a 7-letter word', () => {
        expect(calculateScore('koirasi')).toBe(5);
    });

    it('returns 11 for an 8-letter word', () => {
        expect(calculateScore('koirasid')).toBe(11);
    });

    it('returns 11 for a 9-letter word', () => {
        expect(calculateScore('koirasidx')).toBe(11);
    });
});

// ── isSuperseded ───────────────────────────────────────────────────────────

describe('isSuperseded', () => {
    it('returns false when word is not in foundWords', () => {
        const foundWords = new Map();
        expect(isSuperseded('koira', foundWords)).toBe(false);
    });

    it('returns false when base word has no nominativePlural', () => {
        const foundWords = new Map([
            ['koira', { nominativePlural: null, isNominativePlural: false }]
        ]);
        expect(isSuperseded('koira', foundWords)).toBe(false);
    });

    it('returns false when base word has a plural but plural is not yet found', () => {
        const foundWords = new Map([
            ['koira', { nominativePlural: 'koirat', isNominativePlural: false }]
        ]);
        expect(isSuperseded('koira', foundWords)).toBe(false);
    });

    it('returns true when base word has a plural and that plural is also found', () => {
        const foundWords = new Map([
            ['koira', { nominativePlural: 'koirat', isNominativePlural: false }],
            ['koirat', { nominativePlural: null, isNominativePlural: true }]
        ]);
        expect(isSuperseded('koira', foundWords)).toBe(true);
    });

    it('returns false for the plural word itself (isNominativePlural = true)', () => {
        const foundWords = new Map([
            ['koira', { nominativePlural: 'koirat', isNominativePlural: false }],
            ['koirat', { nominativePlural: null, isNominativePlural: true }]
        ]);
        expect(isSuperseded('koirat', foundWords)).toBe(false);
    });
});

// ── calculateTotalScore ────────────────────────────────────────────────────

describe('calculateTotalScore', () => {
    it('returns 0 for empty foundWords', () => {
        expect(calculateTotalScore(new Map())).toBe(0);
    });

    it('sums scores for all words when none are superseded', () => {
        const foundWords = new Map([
            ['koi', { nominativePlural: 'koit', isNominativePlural: false }],    // 1
            ['talo', { nominativePlural: 'talot', isNominativePlural: false }],  // 1
        ]);
        expect(calculateTotalScore(foundWords)).toBe(2);
    });

    it('excludes superseded base words from the total', () => {
        const foundWords = new Map([
            ['koira', { nominativePlural: 'koirat', isNominativePlural: false }],  // 2 → superseded → 0
            ['koirat', { nominativePlural: null, isNominativePlural: true }],       // 2
        ]);
        // only koirat (6 letters = 3 pts) counts; koira is superseded
        expect(calculateTotalScore(foundWords)).toBe(3);
    });

    it('counts the base word when plural is NOT yet found', () => {
        const foundWords = new Map([
            ['koira', { nominativePlural: 'koirat', isNominativePlural: false }],  // 2
        ]);
        expect(calculateTotalScore(foundWords)).toBe(2);
    });
});

// ── validateWordLocal ──────────────────────────────────────────────────────

describe('validateWordLocal', () => {
    const meta = new Map([
        ['koira', { nominativePlural: 'koirat', isNominativePlural: false }],
        ['koirat', { nominativePlural: null, isNominativePlural: true }],
    ]);

    it('returns null when boardStatsLoaded is false', () => {
        expect(validateWordLocal('koira', false, meta)).toBeNull();
    });

    it('returns exists: true with metadata for a word on the board', () => {
        const result = validateWordLocal('koira', true, meta);
        expect(result).toEqual({
            exists: true,
            isInflection: false,
            nominativePlural: 'koirat',
            isNominativePlural: false,
        });
    });

    it('lowercases the word before lookup', () => {
        const result = validateWordLocal('KOIRA', true, meta);
        expect(result?.exists).toBe(true);
    });

    it('returns exists: false for a word not on the board', () => {
        const result = validateWordLocal('auto', true, meta);
        expect(result).toEqual({ exists: false });
    });

    it('returns correct metadata for a nominative plural', () => {
        const result = validateWordLocal('koirat', true, meta);
        expect(result).toEqual({
            exists: true,
            isInflection: false,
            nominativePlural: null,
            isNominativePlural: true,
        });
    });
});

// ── formatTimer ────────────────────────────────────────────────────────────

describe('formatTimer', () => {
    it('formats 90 seconds as 1:30', () => {
        expect(formatTimer(90)).toBe('1:30');
    });

    it('formats 0 seconds as 0:00', () => {
        expect(formatTimer(0)).toBe('0:00');
    });

    it('pads single-digit seconds', () => {
        expect(formatTimer(9)).toBe('0:09');
    });

    it('formats 60 seconds as 1:00', () => {
        expect(formatTimer(60)).toBe('1:00');
    });

    it('does not pad double-digit seconds', () => {
        expect(formatTimer(75)).toBe('1:15');
    });
});

// ── buildFoundProgressText ─────────────────────────────────────────────────

describe('buildFoundProgressText', () => {
    it('returns "Calculating..." when not yet loaded', () => {
        expect(buildFoundProgressText(null, false, new Map(), new Set(), 0))
            .toBe('Calculating...');
    });

    it('returns the error string when there is an error', () => {
        expect(buildFoundProgressText('Unavailable', true, new Map(), new Set(), 0))
            .toBe('Unavailable');
    });

    it('returns 0% when no words found', () => {
        expect(buildFoundProgressText(null, true, new Map(), new Set(['koira', 'auto']), 2))
            .toBe('0% (0 / 2 words)');
    });

    it('counts only words that are also in validBoardWords', () => {
        const foundWords = new Map([['koira', {}], ['xyz', {}]]);
        const validBoardWords = new Set(['koira', 'auto']);
        expect(buildFoundProgressText(null, true, foundWords, validBoardWords, 2))
            .toBe('50% (1 / 2 words)');
    });

    it('returns 100% when all board words are found', () => {
        const foundWords = new Map([['koira', {}], ['auto', {}]]);
        const validBoardWords = new Set(['koira', 'auto']);
        expect(buildFoundProgressText(null, true, foundWords, validBoardWords, 2))
            .toBe('100% (2 / 2 words)');
    });

    it('returns 0% (not NaN) when totalBoardWords is 0', () => {
        expect(buildFoundProgressText(null, true, new Map(), new Set(), 0))
            .toBe('0% (0 / 0 words)');
    });
});

// ── rollDice ───────────────────────────────────────────────────────────────

const FINNISH_DICE = [
    "AISPUJ", "AEENEA", "ÄIÖNST", "ANPRSK", "APHSKO",
    "DESRIL", "EIENUS", "HIKNMU", "AKAÄLÄ", "SIOTMU",
    "AJTOTO", "EITOSS", "ELYTTR", "AKITMV", "AILKVY", "ALRNNU"
];
const ENGLISH_DICE = [
    "AAEEGN", "ABBJOO", "ACHOPS", "AFFKPS", "AOOTTW",
    "CIMOTU", "DEILRX", "DELRUY", "DISTTY", "EEGHNW",
    "EEINSU", "EHRTVW", "EIOSST", "ELRTTY", "HIMNUQ", "HLNNRZ"
];

describe('rollDice', () => {
    it('returns exactly 16 letters', () => {
        expect(rollDice(FINNISH_DICE)).toHaveLength(16);
    });

    it('each result is a single character', () => {
        rollDice(FINNISH_DICE).forEach(l => expect(l).toHaveLength(1));
    });

    it('deterministic with seeded Math.random — identity shuffle, first face each die', () => {
        // Shuffle phase: make j always equal i (no swaps) by returning values >= (i+1)/n
        // Face phase: always return 0 → picks face index 0
        let call = 0;
        const n = FINNISH_DICE.length; // 16
        // For i=15 down to 1: Math.floor(random * (i+1)) === i  →  random must be in [i/(i+1), 1)
        // Easiest: return 1 - epsilon so floor gives i in all cases
        const shuffleReturns = Array.from({ length: n - 1 }, () => 1 - Number.EPSILON);
        const faceReturns = Array(n).fill(0);
        const sequence = [...shuffleReturns, ...faceReturns];
        vi.spyOn(Math, 'random').mockImplementation(() => sequence[call++] ?? 0);

        const result = rollDice(FINNISH_DICE);
        const expected = FINNISH_DICE.map(d => d[0]);
        expect(result).toEqual(expected);

        vi.restoreAllMocks();
    });

    it('produces varied results across multiple calls', () => {
        const results = new Set(
            Array.from({ length: 30 }, () => rollDice(FINNISH_DICE).join(''))
        );
        expect(results.size).toBeGreaterThan(1);
    });

    it('every letter is a valid face of some die in the Finnish set', () => {
        const allFaces = FINNISH_DICE.flatMap(d => d.split(''));
        rollDice(FINNISH_DICE).forEach(l => {
            expect(allFaces).toContain(l);
        });
    });

    it('works correctly with the English dice set', () => {
        const result = rollDice(ENGLISH_DICE);
        expect(result).toHaveLength(16);
        const allFaces = ENGLISH_DICE.flatMap(d => d.split(''));
        result.forEach(l => expect(allFaces).toContain(l));
    });
});
