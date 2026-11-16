// Regression tests for how the daily leaderboard and result mark words as
// unique / shared / superseded. Uses the real daily routes on an in-memory
// database with a hand-planted board, so singular/plural pairs are guaranteed.
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import sqlite3 from 'sqlite3';
import { sanakirjaCache } from '../../server.js';
import { registerDailyRoutes } from '../../server-daily.js';
import { getTodayHelsinki, calculateWordScore } from '../../server-utils.js';

const run = (db, sql, params = []) =>
    new Promise((resolve, reject) => db.run(sql, params, e => e ? reject(e) : resolve()));

// Real dictionary pairs: luti/lutit, puu/puut. "tuli" has its own plural "tulet".
const BOARD_WORDS = ['luti', 'lutit', 'puu', 'puut', 'tuli', 'tunti', 'kuu', 'kuut'];

let app;
const today = getTodayHelsinki();

async function freshApp() {
    const db = new sqlite3.Database(':memory:');
    await run(db, 'CREATE TABLE daily_boards (date TEXT PRIMARY KEY, letters TEXT, analyzed_words TEXT, created_at INTEGER)');
    await run(db, 'CREATE TABLE daily_submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, uuid TEXT, nickname TEXT, found_words TEXT, submitted_at INTEGER, UNIQUE(date, uuid))');
    await run(db, 'CREATE TABLE daily_word_index (date TEXT, normalized_word TEXT, submission_count INTEGER DEFAULT 1, PRIMARY KEY (date, normalized_word))');
    await run(db, 'INSERT INTO daily_boards VALUES (?, ?, ?, ?)', [
        today,
        JSON.stringify('abcdefghijklmnop'.split('')),
        JSON.stringify({ words: BOARD_WORDS.map(word => ({ word })), totalWords: BOARD_WORDS.length, maxScore: 0 }),
        1,
    ]);
    const a = express();
    a.use(express.json());
    registerDailyRoutes(a, db, sanakirjaCache);
    return a;
}

const submit = (uuid, nickname, foundWords) =>
    request(app).post('/daily/submit').send({ uuid, nickname, date: today, foundWords });

async function leaderboard() {
    const res = await request(app).get(`/daily/leaderboard?date=${today}&includeWords=true`);
    expect(res.status).toBe(200);
    return Object.fromEntries(res.body.entries.map(e => [e.nickname, e]));
}

const chip = (entry, word) => entry.words.find(w => w.word === word);

beforeEach(async () => { app = await freshApp(); });

describe('leaderboard word marks', () => {
    it('a player who found singular and plural alone: singular superseded, plural unique', async () => {
        await submit('u1', 'Solo', ['luti', 'lutit']);
        const { Solo } = await leaderboard();
        expect(chip(Solo, 'luti')).toMatchObject({ isSuperseded: true, isUnique: false });
        expect(chip(Solo, 'lutit')).toMatchObject({ isSuperseded: false, isUnique: true });
        expect(Solo.score).toBe(calculateWordScore('lutit'));
    });

    it('plural-first submission order gives the same marks', async () => {
        await submit('u1', 'Solo', ['lutit', 'luti']);
        const { Solo } = await leaderboard();
        expect(chip(Solo, 'luti').isSuperseded).toBe(true);
        expect(chip(Solo, 'lutit').isUnique).toBe(true);
    });

    it('a word both players found is shared (not unique) for both', async () => {
        await submit('u1', 'A', ['tuli', 'tunti']);
        await submit('u2', 'B', ['tuli']);
        const { A, B } = await leaderboard();
        expect(chip(A, 'tuli').isUnique).toBe(false);
        expect(chip(B, 'tuli').isUnique).toBe(false);
        expect(chip(A, 'tunti').isUnique).toBe(true);
    });

    it("a singular and the other player's plural count as the same word (shared)", async () => {
        await submit('u1', 'A', ['puu']);
        await submit('u2', 'B', ['puut']);
        const { A, B } = await leaderboard();
        expect(chip(A, 'puu')).toMatchObject({ isUnique: false, isSuperseded: false });
        expect(chip(B, 'puut')).toMatchObject({ isUnique: false, isSuperseded: false });
        expect(A.score).toBe(0);
        expect(B.score).toBe(0);
    });

    it('shared pair does not leak onto a different pair the same player has', async () => {
        await submit('u1', 'A', ['puu', 'puut', 'luti', 'lutit']);
        await submit('u2', 'B', ['puut']);
        const { A } = await leaderboard();
        expect(chip(A, 'puut').isUnique).toBe(false);   // B also found puu/puut
        expect(chip(A, 'lutit').isUnique).toBe(true);   // only A found luti/lutit
    });

    it("each entry's unique chips match its uniqueWordCount and score", async () => {
        await submit('u1', 'A', ['luti', 'lutit', 'tuli', 'puu', 'puut', 'tunti']);
        await submit('u2', 'B', ['tuli', 'kuu', 'kuut', 'puu']);
        const board = await leaderboard();
        for (const entry of Object.values(board)) {
            const uniques = entry.words.filter(w => w.isUnique);
            expect(uniques.length).toBe(entry.uniqueWordCount);
            expect(uniques.reduce((s, w) => s + calculateWordScore(w.word), 0)).toBe(entry.score);
        }
    });
});

describe('result endpoint agrees with the leaderboard', () => {
    it('credits the plural (higher score), not the first-found singular', async () => {
        await submit('u1', 'Solo', ['luti', 'lutit']);
        const res = await request(app).get(`/daily/result?date=${today}&uuid=u1`);
        const lutit = res.body.words.find(w => w.word === 'lutit');
        const luti = res.body.words.find(w => w.word === 'luti');
        expect(lutit.isUnique).toBe(true);
        expect(luti.isUnique).toBe(false);
        expect(res.body.score).toBe(calculateWordScore('lutit'));
    });

    it('score and unique count equal the leaderboard entry for the same player', async () => {
        await submit('u1', 'A', ['luti', 'lutit', 'tuli', 'puu']);
        await submit('u2', 'B', ['tuli', 'puut']);
        const board = await leaderboard();
        for (const [uuid, nick] of [['u1', 'A'], ['u2', 'B']]) {
            const res = await request(app).get(`/daily/result?date=${today}&uuid=${uuid}`);
            expect(res.body.score).toBe(board[nick].score);
            expect(res.body.uniqueWordCount).toBe(board[nick].uniqueWordCount);
        }
    });
});
