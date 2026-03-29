import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../server.js';

// ---------------------------------------------------------------------------
// GET /db-version
// ---------------------------------------------------------------------------
describe('GET /db-version', () => {
    it('returns an object with a version property', async () => {
        const res = await request(app).get('/db-version');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('version');
    });
});

// ---------------------------------------------------------------------------
// GET /validate-word/:word  (Finnish / sanakirja)
// ---------------------------------------------------------------------------
describe('GET /validate-word/:word', () => {
    it('returns exists:true with metadata for a known Finnish word', async () => {
        const res = await request(app).get('/validate-word/koira?lang=fi&dict=sanakirja');
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(true);
        expect(res.body).toHaveProperty('nominativePlural');
        expect(res.body).toHaveProperty('isNominativePlural');
    });

    it('returns exists:false for an unknown word', async () => {
        const res = await request(app).get('/validate-word/xyzabc?lang=fi&dict=sanakirja');
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(false);
    });

    it('returns exists:false for a word shorter than 3 chars', async () => {
        const res = await request(app).get('/validate-word/ab?lang=fi');
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(false);
    });

    it('returns exists:false for a word with digits', async () => {
        const res = await request(app).get('/validate-word/koir4?lang=fi');
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(false);
    });

    it('returns exists:true for a word that is a nominative plural', async () => {
        const res = await request(app).get('/validate-word/koirat?lang=fi&dict=sanakirja');
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(true);
        expect(res.body.isNominativePlural).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// POST /board-analysis
// ---------------------------------------------------------------------------
describe('POST /board-analysis', () => {
    const validLetters = ['k', 'o', 'i', 'r', 'a', 't', 'e', 's', 'n', 'l', 'u', 'm', 'p', 'v', 'd', 'i'];

    it('analyzes a valid board and returns words + scores', async () => {
        const res = await request(app)
            .post('/board-analysis')
            .send({ letters: validLetters, dict: 'sanakirja' });
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.words)).toBe(true);
        expect(typeof res.body.totalWords).toBe('number');
        expect(typeof res.body.maxScore).toBe('number');
        expect(res.body.totalWords).toBeGreaterThan(0);
    });

    it('each word entry has word, nominativePlural, isNominativePlural', async () => {
        const res = await request(app)
            .post('/board-analysis')
            .send({ letters: validLetters, dict: 'sanakirja' });
        expect(res.status).toBe(200);
        const first = res.body.words[0];
        expect(first).toHaveProperty('word');
        expect(first).toHaveProperty('nominativePlural');
        expect(first).toHaveProperty('isNominativePlural');
    });

    it('totalWords matches words array length', async () => {
        const res = await request(app)
            .post('/board-analysis')
            .send({ letters: validLetters, dict: 'sanakirja' });
        expect(res.status).toBe(200);
        expect(res.body.totalWords).toBe(res.body.words.length);
    });

    it('returns 400 for a board with wrong number of letters', async () => {
        const res = await request(app)
            .post('/board-analysis')
            .send({ letters: ['a', 'b', 'c'] });
        expect(res.status).toBe(400);
    });

    it('returns 400 for a board with a digit character', async () => {
        const letters = Array(16).fill('a');
        letters[0] = '1';
        const res = await request(app).post('/board-analysis').send({ letters });
        expect(res.status).toBe(400);
    });

    it('returns 400 for a non-Finnish language', async () => {
        const res = await request(app)
            .post('/board-analysis')
            .send({ letters: validLetters, lang: 'en' });
        expect(res.status).toBe(400);
    });
});

// ---------------------------------------------------------------------------
// GET /leaderboard
// ---------------------------------------------------------------------------
describe('GET /leaderboard', () => {
    it('returns an array for alltime leaderboard', async () => {
        const res = await request(app).get('/leaderboard?lang=fi&mode=timed');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it('returns an array for daily leaderboard', async () => {
        const res = await request(app).get('/leaderboard?type=daily&lang=fi&mode=timed');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it('defaults to alltime when type is omitted', async () => {
        const res = await request(app).get('/leaderboard?lang=fi&mode=timed');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// GET /leaderboard/qualifies
// ---------------------------------------------------------------------------
describe('GET /leaderboard/qualifies', () => {
    it('returns { qualifies: boolean }', async () => {
        const res = await request(app).get('/leaderboard/qualifies?score=100&lang=fi&mode=timed');
        expect(res.status).toBe(200);
        expect(typeof res.body.qualifies).toBe('boolean');
    });

    it('qualifies is true when in-memory DB has fewer than 10 entries', async () => {
        const res = await request(app).get('/leaderboard/qualifies?score=0&lang=fi&mode=timed');
        expect(res.status).toBe(200);
        expect(res.body.qualifies).toBe(true);
    });

    it('returns 400 when score param is missing', async () => {
        const res = await request(app).get('/leaderboard/qualifies?lang=fi&mode=timed');
        expect(res.status).toBe(400);
    });

    it('returns 400 when score param is not a number', async () => {
        const res = await request(app).get('/leaderboard/qualifies?score=abc&lang=fi&mode=timed');
        expect(res.status).toBe(400);
    });
});

// ---------------------------------------------------------------------------
// POST /scores
// ---------------------------------------------------------------------------
describe('POST /scores', () => {
    it('saves a valid score and returns an id', async () => {
        const res = await request(app).post('/scores').send({
            nickname: 'Tester',
            score: 42,
            word_count: 10,
            language: 'fi',
            mode: 'timed',
        });
        expect(res.status).toBe(200);
        expect(typeof res.body.id).toBe('number');
    });

    it('saved score appears on the leaderboard', async () => {
        const nick = `test_${Date.now()}`;
        await request(app).post('/scores').send({
            nickname: nick, score: 999, word_count: 5, language: 'fi', mode: 'timed',
        });
        const lb = await request(app).get('/leaderboard?type=alltime&lang=fi&mode=timed');
        const found = lb.body.some(entry => entry.nickname === nick);
        expect(found).toBe(true);
    });

    it('rejects zen mode', async () => {
        const res = await request(app).post('/scores').send({
            nickname: 'Tester', score: 42, word_count: 10, language: 'fi', mode: 'zen',
        });
        expect(res.status).toBe(400);
    });

    it('rejects missing nickname', async () => {
        const res = await request(app).post('/scores').send({
            score: 42, word_count: 10, language: 'fi', mode: 'timed',
        });
        expect(res.status).toBe(400);
    });

    it('rejects empty nickname after trimming', async () => {
        const res = await request(app).post('/scores').send({
            nickname: '   ', score: 42, word_count: 10, language: 'fi', mode: 'timed',
        });
        expect(res.status).toBe(400);
    });

    it('rejects non-number score', async () => {
        const res = await request(app).post('/scores').send({
            nickname: 'Tester', score: 'lots', word_count: 10, language: 'fi', mode: 'timed',
        });
        expect(res.status).toBe(400);
    });

    it('rejects non-number word_count', async () => {
        const res = await request(app).post('/scores').send({
            nickname: 'Tester', score: 42, word_count: 'many', language: 'fi', mode: 'timed',
        });
        expect(res.status).toBe(400);
    });

    it('unlimed mode is stored and appears in alltime leaderboard with mode=unlimited', async () => {
        const nick = `zen_${Date.now()}`;
        await request(app).post('/scores').send({
            nickname: nick, score: 500, word_count: 20, language: 'fi', mode: 'unlimited',
        });
        const lb = await request(app).get('/leaderboard?type=alltime&lang=fi&mode=unlimited');
        const found = lb.body.some(entry => entry.nickname === nick);
        expect(found).toBe(true);
    });
});
