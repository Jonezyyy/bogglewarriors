import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, dbReady } from '../../server.js';

// Today's Helsinki date — same logic the server uses
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' });

// Wait for all DB tables to be created before any test runs
beforeAll(async () => { await dbReady; });

// ---------------------------------------------------------------------------
// GET /daily/board
// ---------------------------------------------------------------------------
describe('GET /daily/board', () => {
    it('returns a board for today when no date given', async () => {
        const res = await request(app).get('/daily/board');
        expect(res.status).toBe(200);
        expect(res.body.date).toBe(today);
        expect(Array.isArray(res.body.letters)).toBe(true);
        expect(res.body.letters).toHaveLength(16);
        expect(typeof res.body.closesAt).toBe('string');
        expect(typeof res.body.totalBoardWords).toBe('number');
        expect(typeof res.body.maxScore).toBe('number');
    });

    it('returns a board for an explicit past date', async () => {
        const res = await request(app).get('/daily/board?date=2026-01-01');
        expect(res.status).toBe(200);
        expect(res.body.date).toBe('2026-01-01');
        expect(res.body.letters).toHaveLength(16);
    });

    it('returns 400 for an invalid date string', async () => {
        const res = await request(app).get('/daily/board?date=notadate');
        expect(res.status).toBe(400);
    });

    it('is deterministic — same date produces same board', async () => {
        const a = await request(app).get('/daily/board?date=2026-01-01');
        const b = await request(app).get('/daily/board?date=2026-01-01');
        expect(a.body.letters).toEqual(b.body.letters);
    });

    it('different dates produce different boards', async () => {
        const a = await request(app).get('/daily/board?date=2026-01-01');
        const b = await request(app).get('/daily/board?date=2026-01-02');
        expect(a.body.letters).not.toEqual(b.body.letters);
    });

    it('all letters are lowercase single Finnish chars', async () => {
        const res = await request(app).get('/daily/board');
        for (const l of res.body.letters) {
            expect(l).toMatch(/^[a-zäö]$/);
        }
    });
});

// ---------------------------------------------------------------------------
// POST /daily/submit
// ---------------------------------------------------------------------------
describe('POST /daily/submit', () => {
    const uuid = `test-${crypto.randomUUID()}`;

    it('accepts a valid submission and returns submissionId', async () => {
        const res = await request(app).post('/daily/submit').send({
            uuid,
            nickname: 'Tester',
            foundWords: ['koira', 'talo', 'sana'],
            date: today,
        });
        expect(res.status).toBe(200);
        expect(typeof res.body.submissionId).toBe('number');
        expect(res.body.date).toBe(today);
        expect(res.body.wordCount).toBe(3);
    });

    it('rejects a duplicate submission with 409', async () => {
        const res = await request(app).post('/daily/submit').send({
            uuid,
            nickname: 'Tester',
            foundWords: ['koira'],
            date: today,
        });
        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/already submitted/i);
    });

    it('rejects missing uuid with 400', async () => {
        const res = await request(app).post('/daily/submit').send({
            nickname: 'X', foundWords: [], date: today,
        });
        expect(res.status).toBe(400);
    });

    it('rejects missing nickname with 400', async () => {
        const res = await request(app).post('/daily/submit').send({
            uuid: crypto.randomUUID(), foundWords: [], date: today,
        });
        expect(res.status).toBe(400);
    });

    it('rejects a future date with 400', async () => {
        const res = await request(app).post('/daily/submit').send({
            uuid: crypto.randomUUID(), nickname: 'X', foundWords: [], date: '2099-01-01',
        });
        expect(res.status).toBe(400);
    });

    it('rejects past date (not today) with 400', async () => {
        const res = await request(app).post('/daily/submit').send({
            uuid: crypto.randomUUID(), nickname: 'X', foundWords: [], date: '2000-01-01',
        });
        expect(res.status).toBe(400);
    });

    it('silently strips words with invalid characters', async () => {
        const res = await request(app).post('/daily/submit').send({
            uuid: crypto.randomUUID(), nickname: 'X',
            foundWords: ['val1d', '123', 'ok!', 'koira'],
            date: today,
        });
        expect(res.status).toBe(200);
        // Only 'koira' (valid Finnish) passes the filter
        expect(res.body.wordCount).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// GET /daily/leaderboard
// Uses today's date — POST /daily/submit only accepts today.
// ---------------------------------------------------------------------------
describe('GET /daily/leaderboard', () => {
    const uuidA = `lb-a-${crypto.randomUUID()}`;
    const uuidB = `lb-b-${crypto.randomUUID()}`;

    beforeAll(async () => {
        // Alice: 'talo' is shared; 'piste' is unique to her
        await request(app).post('/daily/submit').send({
            uuid: uuidA, nickname: 'Alice',
            foundWords: ['talo', 'piste'],
            date: today,
        });
        // Bob: 'talo' is shared; 'meri' is unique to Bob
        await request(app).post('/daily/submit').send({
            uuid: uuidB, nickname: 'Bob',
            foundWords: ['talo', 'meri'],
            date: today,
        });
    });

    it('returns leaderboard entries', async () => {
        const res = await request(app).get(`/daily/leaderboard?date=${today}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.entries)).toBe(true);
        expect(res.body.entries.length).toBeGreaterThanOrEqual(2);
    });

    it('isClosed is false for today', async () => {
        const res = await request(app).get(`/daily/leaderboard?date=${today}`);
        expect(res.body.isClosed).toBe(false);
    });

    it('isClosed is true for a past date', async () => {
        const res = await request(app).get('/daily/leaderboard?date=2024-01-01');
        expect(res.status).toBe(200);
        expect(res.body.isClosed).toBe(true);
    });

    it('entries have expected fields', async () => {
        const res = await request(app).get(`/daily/leaderboard?date=${today}`);
        const alice = res.body.entries.find(e => e.nickname === 'Alice');
        expect(alice).toBeDefined();
        expect(typeof alice.rank).toBe('number');
        expect(typeof alice.score).toBe('number');
        expect(typeof alice.uniqueWordCount).toBe('number');
    });

    it('uniqueWordCount reflects only unshared words', async () => {
        const res = await request(app).get(`/daily/leaderboard?date=${today}`);
        const alice = res.body.entries.find(e => e.nickname === 'Alice');
        // 'piste' is Alice-only; 'talo' is shared with Bob
        expect(alice.uniqueWordCount).toBe(1);
    });

    it('includeWords=true adds words array to each entry', async () => {
        const res = await request(app).get(`/daily/leaderboard?date=${today}&includeWords=true`);
        const alice = res.body.entries.find(e => e.nickname === 'Alice');
        expect(Array.isArray(alice.words)).toBe(true);
        expect(alice.words.length).toBeGreaterThan(0);
        expect(alice.words[0]).toHaveProperty('word');
        expect(alice.words[0]).toHaveProperty('isUnique');
    });

    it('unique word (piste) is marked isUnique:true for Alice', async () => {
        const res = await request(app).get(`/daily/leaderboard?date=${today}&includeWords=true`);
        const alice = res.body.entries.find(e => e.nickname === 'Alice');
        const piste = alice.words.find(w => w.word === 'piste');
        expect(piste?.isUnique).toBe(true);
    });

    it('shared word (talo) is marked isUnique:false', async () => {
        const res = await request(app).get(`/daily/leaderboard?date=${today}&includeWords=true`);
        const alice = res.body.entries.find(e => e.nickname === 'Alice');
        const talo = alice.words.find(w => w.word === 'talo');
        expect(talo?.isUnique).toBe(false);
    });

    it('returns 400 for invalid date', async () => {
        const res = await request(app).get('/daily/leaderboard?date=bad');
        expect(res.status).toBe(400);
    });
});

// ---------------------------------------------------------------------------
// GET /daily/result
// ---------------------------------------------------------------------------
describe('GET /daily/result', () => {
    const uuid = `result-${crypto.randomUUID()}`;

    beforeAll(async () => {
        await request(app).post('/daily/submit').send({
            uuid, nickname: 'Charlie',
            foundWords: ['kissa', 'auto'],   // unique words not used by other tests
            date: today,
        });
    });

    it('returns found:false for unknown uuid', async () => {
        const res = await request(app).get(`/daily/result?date=${today}&uuid=nobody`);
        expect(res.status).toBe(200);
        expect(res.body.found).toBe(false);
    });

    it('returns full result for known uuid', async () => {
        const res = await request(app).get(`/daily/result?date=${today}&uuid=${uuid}`);
        expect(res.status).toBe(200);
        expect(res.body.found).toBe(true);
        expect(res.body.nickname).toBe('Charlie');
        expect(Array.isArray(res.body.words)).toBe(true);
        expect(typeof res.body.score).toBe('number');
        expect(typeof res.body.uniqueWordCount).toBe('number');
    });

    it('each word has word, normalized, isUnique, stolenByCount', async () => {
        const res = await request(app).get(`/daily/result?date=${today}&uuid=${uuid}`);
        for (const w of res.body.words) {
            expect(w).toHaveProperty('word');
            expect(w).toHaveProperty('normalized');
            expect(w).toHaveProperty('isUnique');
            expect(w).toHaveProperty('stolenByCount');
        }
    });

    it('sole submitter of these words — both are unique', async () => {
        const res = await request(app).get(`/daily/result?date=${today}&uuid=${uuid}`);
        // 'kissa' and 'auto' are only submitted by Charlie in this test suite
        for (const w of res.body.words) {
            expect(w.isUnique).toBe(true);
        }
    });

    it('returns 400 when uuid is missing', async () => {
        const res = await request(app).get(`/daily/result?date=${today}`);
        expect(res.status).toBe(400);
    });

    it('returns 400 for invalid date format', async () => {
        const res = await request(app).get(`/daily/result?date=bad&uuid=${uuid}`);
        expect(res.status).toBe(400);
    });
});
