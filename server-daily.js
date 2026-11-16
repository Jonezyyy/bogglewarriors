// Daily Challenge route handlers.
// Mounted in server.js via: import { registerDailyRoutes } from './server-daily.js'
// This module is pure Express — no DB setup, no app startup logic.

import { FINNISH_DICE } from './dice-sets.js';
import { createDatedBoards } from './dated-board.js';
import {
    getTodayHelsinki,
    normalizeBoardLetters,
    normalizeWordForDedup,
    computeDailyScores,
    buildSingularByPlural,
    calculateWordScore,
} from './server-utils.js';


// ---------------------------------------------------------------------------
// registerDailyRoutes(app, scoresDb, sanakirjaCache)
// ---------------------------------------------------------------------------

export function registerDailyRoutes(app, scoresDb, sanakirjaCache) {
    // Build plural→base reverse map once at registration time
    const singularByPlural = sanakirjaCache
        ? buildSingularByPlural(sanakirjaCache.metadataByWord)
        : new Map();

    const boards = createDatedBoards({
        scoresDb,
        sanakirjaCache,
        table: 'daily_boards',
        diceSet: FINNISH_DICE,
    });
    const { get: dbGet, all: dbAll, run: dbRun } = boards.db;
    const { boardFor: getOrCreateBoard, isValidDate, closesAt: challengeClosesAt } = boards;

    // ------------------------------------------------------------------
    // GET /daily/board?date=YYYY-MM-DD
    // ------------------------------------------------------------------
    app.get('/daily/board', async (req, res) => {
        const date = req.query.date || getTodayHelsinki();

        if (!isValidDate(date)) {
            return res.status(400).json({ error: 'Invalid date format (expected YYYY-MM-DD)' });
        }

        try {
            const board = await getOrCreateBoard(date);
            res.json({
                date: board.date,
                letters: board.letters,
                closesAt: challengeClosesAt(board.date),
                totalBoardWords: board.analyzedWords.totalWords,
                maxScore: board.analyzedWords.maxScore,
            });
        } catch (err) {
            console.error('GET /daily/board error:', err.message);
            res.status(500).json({ error: 'Could not load daily board' });
        }
    });

    // ------------------------------------------------------------------
    // POST /daily/submit
    // Body: { uuid, nickname, foundWords: string[], date }
    // ------------------------------------------------------------------
    app.post('/daily/submit', async (req, res) => {
        const { uuid, nickname, foundWords, date } = req.body;

        // --- Input validation ------------------------------------------
        if (!uuid || typeof uuid !== 'string' || uuid.trim().length === 0) {
            return res.status(400).json({ error: 'uuid is required' });
        }
        const cleanUuid = uuid.trim().slice(0, 64);

        if (!nickname || typeof nickname !== 'string' || nickname.trim().length === 0) {
            return res.status(400).json({ error: 'nickname is required' });
        }
        const cleanNickname = nickname.trim().slice(0, 20);

        if (!Array.isArray(foundWords) || foundWords.some(w => typeof w !== 'string')) {
            return res.status(400).json({ error: 'foundWords must be an array of strings' });
        }

        const submittedDate = typeof date === 'string' ? date.trim() : getTodayHelsinki();
        if (!isValidDate(submittedDate)) {
            return res.status(400).json({ error: 'Invalid date format' });
        }

        // Reject past dates (allow today only)
        const today = getTodayHelsinki();
        if (submittedDate > today) {
            return res.status(400).json({ error: 'Cannot submit for a future date' });
        }
        // Allow same-day submissions only (not yesterday; past dates are read-only)
        if (submittedDate < today) {
            return res.status(400).json({ error: 'The challenge for this date is closed' });
        }

        // Clean + deduplicate found words (lowercase, only Finnish letters, 3-16 chars)
        const cleanWords = [...new Set(
            foundWords
                .map(w => w.trim().toLowerCase())
                .filter(w => w.length >= 3 && w.length <= 16 && /^[a-zäö]+$/.test(w))
        )];

        // Reject words that are not actually findable on this date's board.
        // Without this check, clients could POST arbitrary words and win the
        // "unique words" scoring trivially.
        let validWords;
        try {
            const board = await getOrCreateBoard(submittedDate);
            const boardWordSet = new Set(board.analyzedWords.words.map(w => w.word));
            validWords = cleanWords.filter(w => boardWordSet.has(w));
        } catch (err) {
            console.error('POST /daily/submit board lookup error:', err.message);
            return res.status(500).json({ error: 'Could not validate submission' });
        }

        const foundWordsJson = JSON.stringify(validWords);
        const submittedAt = Math.floor(Date.now() / 1000);

        try {
            // Insert — UNIQUE(date, uuid) constraint fires on duplicate
            let result;
            try {
                result = await dbRun(
                    'INSERT INTO daily_submissions (date, uuid, nickname, found_words, submitted_at) VALUES (?, ?, ?, ?, ?)',
                    [submittedDate, cleanUuid, cleanNickname, foundWordsJson, submittedAt]
                );
            } catch (err) {
                if (err.message && err.message.includes('UNIQUE constraint failed')) {
                    return res.status(409).json({ error: 'Already submitted for this date' });
                }
                throw err;
            }

            // Update daily_word_index atomically for each normalized word
            for (const w of validWords) {
                const norm = normalizeWordForDedup(w, singularByPlural);
                await dbRun(
                    `INSERT INTO daily_word_index (date, normalized_word, submission_count)
                     VALUES (?, ?, 1)
                     ON CONFLICT(date, normalized_word) DO UPDATE SET submission_count = submission_count + 1`,
                    [submittedDate, norm]
                );
            }

            res.json({
                submissionId: result.lastID,
                date: submittedDate,
                wordCount: validWords.length,
            });
        } catch (err) {
            console.error('POST /daily/submit error:', err.message);
            res.status(500).json({ error: 'Could not save submission' });
        }
    });

    // ------------------------------------------------------------------
    // GET /daily/leaderboard?date=YYYY-MM-DD[&includeWords=true]
    // ------------------------------------------------------------------
    app.get('/daily/leaderboard', async (req, res) => {
        const date = req.query.date || getTodayHelsinki();

        if (!isValidDate(date)) {
            return res.status(400).json({ error: 'Invalid date format' });
        }

        const includeWords = req.query.includeWords === 'true';
        const today = getTodayHelsinki();

        try {
            const submissions = await dbAll(
                'SELECT uuid, nickname, found_words FROM daily_submissions WHERE date = ?', [date]
            );

            const scored = computeDailyScores(submissions, singularByPlural);
            const top = scored.slice(0, 50);

            // Build normalized word → count map from index table for word annotations
            let wordIndex = null;
            if (includeWords) {
                const indexRows = await dbAll(
                    'SELECT normalized_word, submission_count FROM daily_word_index WHERE date = ?', [date]
                );
                wordIndex = new Map(indexRows.map(r => [r.normalized_word, r.submission_count]));
            }

            const entries = top.map((entry, i) => {
                const base = {
                    rank: i + 1,
                    nickname: entry.nickname,
                    score: entry.score,
                    uniqueWordCount: entry.uniqueWordCount,
                };
                if (includeWords) {
                    const sub = submissions.find(s => s.uuid === entry.uuid);
                    const words = sub ? JSON.parse(sub.found_words) : [];
                    // Pre-compute best (highest-scoring) form per normalized key so
                    // the plural is shown as accepted and the singular as superseded.
                    const bestFormByNorm = new Map();
                    for (const w of words) {
                        const norm = normalizeWordForDedup(w, singularByPlural);
                        const s = calculateWordScore(w);
                        if (!bestFormByNorm.has(norm) || s > bestFormByNorm.get(norm).score) {
                            bestFormByNorm.set(norm, { word: w, score: s });
                        }
                    }
                    base.words = words.map(w => {
                        const norm = normalizeWordForDedup(w, singularByPlural);
                        const count = wordIndex.get(norm) ?? 1;
                        const isBestForm = bestFormByNorm.get(norm)?.word === w;
                        const isUnique = count === 1 && isBestForm;
                        const isSuperseded = !isBestForm; // lower form of a singular/plural pair
                        return { word: w, isUnique, isSuperseded };
                    });
                    // mark isCurrentPlayer server-side? No — client handles that via uuid in localStorage
                }
                return base;
            });

            res.json({
                date,
                isClosed: date < today,
                playerCount: submissions.length,
                entries,
            });
        } catch (err) {
            console.error('GET /daily/leaderboard error:', err.message);
            res.status(500).json({ error: 'Could not load leaderboard' });
        }
    });

    // ------------------------------------------------------------------
    // GET /daily/result?date=YYYY-MM-DD&uuid=...
    // ------------------------------------------------------------------
    app.get('/daily/result', async (req, res) => {
        const date = req.query.date || getTodayHelsinki();
        const uuid = req.query.uuid;

        if (!isValidDate(date)) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        if (!uuid || typeof uuid !== 'string' || uuid.trim().length === 0) {
            return res.status(400).json({ error: 'uuid is required' });
        }

        try {
            const submission = await dbGet(
                'SELECT uuid, nickname, found_words, submitted_at FROM daily_submissions WHERE date = ? AND uuid = ?',
                [date, uuid.trim()]
            );

            if (!submission) {
                return res.json({ found: false });
            }

            const indexRows = await dbAll(
                'SELECT normalized_word, submission_count FROM daily_word_index WHERE date = ?', [date]
            );
            const wordIndex = new Map(indexRows.map(r => [r.normalized_word, r.submission_count]));

            const foundWords = JSON.parse(submission.found_words);
            const counted = new Set();
            let score = 0;
            let uniqueWordCount = 0;

            const words = foundWords.map(w => {
                const norm = normalizeWordForDedup(w, singularByPlural);
                const stolenByCount = wordIndex.get(norm) ?? 1;
                const isUnique = stolenByCount === 1 && !counted.has(norm);
                counted.add(norm);
                if (isUnique) {
                    score += calculateWordScore(w);
                    uniqueWordCount++;
                }
                return { word: w, normalized: norm, isUnique, stolenByCount };
            });

            res.json({
                found: true,
                nickname: submission.nickname,
                score,
                uniqueWordCount,
                submittedAt: submission.submitted_at,
                words,
            });
        } catch (err) {
            console.error('GET /daily/result error:', err.message);
            res.status(500).json({ error: 'Could not load result' });
        }
    });
}
