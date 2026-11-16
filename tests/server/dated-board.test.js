import { describe, it, expect, beforeEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { FINNISH_DICE } from '../../dice-sets.js';
import { createDatedBoards } from '../../dated-board.js';

// Tiny dictionary cache in the shape analyzeFinnishBoard expects.
function fakeCache(words) {
    const metadataByWord = new Map(words.map(w => [w, { nominativePlural: null, isNominativePlural: false }]));
    const prefixes = new Set();
    for (const w of words) for (let i = 1; i <= w.length; i++) prefixes.add(w.slice(0, i));
    return { metadataByWord, prefixes };
}

function openDb(table) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(':memory:', err => {
            if (err) return reject(err);
            db.run(`CREATE TABLE ${table} (
                date TEXT PRIMARY KEY, letters TEXT NOT NULL,
                analyzed_words TEXT NOT NULL, created_at INTEGER NOT NULL
            )`, e => e ? reject(e) : resolve(db));
        });
    });
}

describe('createDatedBoards', () => {
    let scoresDb;
    beforeEach(async () => { scoresDb = await openDb('daily_boards'); });

    const make = (opts = {}) => createDatedBoards({
        scoresDb,
        sanakirjaCache: fakeCache(['sana', 'ana']),
        table: 'daily_boards',
        diceSet: FINNISH_DICE,
        ...opts,
    });

    it('generates the known board for a date (seed offset 0)', async () => {
        const board = await make().boardFor('2026-01-01');
        expect(board.letters).toEqual(
            ['ä','s','k','u','l','s','t','u','u','a','n','v','y','s','a','p']
        );
        expect(board.date).toBe('2026-01-01');
    });

    it('applies the seed offset so the same date gives a different board', async () => {
        const board = await make({ seedOffset: 10_000_000 }).boardFor('2026-01-01');
        expect(board.letters).toEqual(
            ['k','e','ä','a','p','ä','p','i','k','r','u','u','i','o','i','l']
        );
    });

    it('persists the board once and returns the stored copy afterwards', async () => {
        const boards = make();
        const first = await boards.boardFor('2026-01-01');
        const second = await boards.boardFor('2026-01-01');
        expect(second).toEqual(first);
        const rows = await boards.db.all('SELECT date FROM daily_boards');
        expect(rows).toHaveLength(1);
    });

    it('returns the analysis alongside the letters', async () => {
        const board = await make().boardFor('2026-01-01');
        expect(typeof board.analyzedWords.totalWords).toBe('number');
        expect(typeof board.analyzedWords.maxScore).toBe('number');
        expect(Array.isArray(board.analyzedWords.words)).toBe(true);
    });

    it('rejects when the dictionary cache is unavailable', async () => {
        const boards = make({ sanakirjaCache: null });
        await expect(boards.boardFor('2026-01-01')).rejects.toThrow('Dictionary cache unavailable');
    });

    it('isValidDate accepts YYYY-MM-DD and rejects other shapes', () => {
        const { isValidDate } = make();
        expect(isValidDate('2026-01-01')).toBe(true);
        expect(isValidDate('2026-1-1')).toBe(false);
        expect(isValidDate('notadate')).toBe(false);
        expect(isValidDate('2026-13-45')).toBe(false);
    });

    it('closesAt is an ISO timestamp one day after the previous date closes', () => {
        const { closesAt } = make();
        const a = closesAt('2026-01-01');
        const b = closesAt('2026-01-02');
        expect(a).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(Date.parse(b) - Date.parse(a)).toBe(86400 * 1000);
    });

    it('db helpers resolve with lastID and changes on run', async () => {
        const { db } = make();
        const r = await db.run(
            'INSERT INTO daily_boards (date, letters, analyzed_words, created_at) VALUES (?, ?, ?, ?)',
            ['2026-02-01', '[]', '{}', 1]
        );
        expect(r.changes).toBe(1);
        expect((await db.get('SELECT date FROM daily_boards'))?.date).toBe('2026-02-01');
    });
});
