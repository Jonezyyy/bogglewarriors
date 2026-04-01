// Daily Challenge route handlers.
// Mounted in server.js via: import { registerDailyRoutes } from './server-daily.js'
// This module is pure Express — no DB setup, no app startup logic.

import {
    getTodayHelsinki,
    generateDailyBoard,
    normalizeBoardLetters,
    analyzeFinnishBoard,
    normalizeWordForDedup,
    computeDailyScores,
    buildSingularByPlural,
    calculateWordScore,
} from './server-utils.js';
const FINNISH_DICE = [
    "AISPUJ", "AEENEA", "ÄIÖNST", "ANPRSK", "APHSKO",
    "DESRIL", "EIENUS", "HIKNMU", "AKAÄLÄ", "SIOTMU",
    "AJTOTO", "EITOSS", "ELYTTR", "AKITMV", "AILKVY", "ALRNNU"
];

// ---------------------------------------------------------------------------
// registerDailyRoutes(app, scoresDb, sanakirjaCache)
// ---------------------------------------------------------------------------

export function registerDailyRoutes(app, scoresDb, sanakirjaCache) {
    // Build plural→base reverse map once at registration time
    const singularByPlural = sanakirjaCache
        ? buildSingularByPlural(sanakirjaCache.metadataByWord)
        : new Map();

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /** Promisified scoresDb.get */
    function dbGet(sql, params = []) {
        return new Promise((resolve, reject) => {
            scoresDb.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
        });
    }

    /** Promisified scoresDb.all */
    function dbAll(sql, params = []) {
        return new Promise((resolve, reject) => {
            scoresDb.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
        });
    }

    /** Promisified scoresDb.run — resolves with { lastID, changes } */
    function dbRun(sql, params = []) {
        return new Promise((resolve, reject) => {
            scoresDb.run(sql, params, function (err) {
                err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }

    /**
     * Get or generate the board for a given date.
     * Side-effect: inserts into daily_boards if missing.
     */
    async function getOrCreateBoard(date) {
        const existing = await dbGet(
            'SELECT date, letters, analyzed_words FROM daily_boards WHERE date = ?', [date]
        );
        if (existing) {
            return {
                date: existing.date,
                letters: JSON.parse(existing.letters),
                analyzedWords: JSON.parse(existing.analyzed_words),
            };
        }

        // Generate deterministically from date seed
        const letters = generateDailyBoard(date, FINNISH_DICE);

        // Analyze board (needs sanakirjaCache)
        if (!sanakirjaCache) throw new Error('Dictionary cache unavailable');
        const analysis = analyzeFinnishBoard(letters, sanakirjaCache);

        await dbRun(
            'INSERT OR IGNORE INTO daily_boards (date, letters, analyzed_words, created_at) VALUES (?, ?, ?, ?)',
            [date, JSON.stringify(letters), JSON.stringify(analysis), Math.floor(Date.now() / 1000)]
        );

        return { date, letters, analyzedWords: analysis };
    }

    /** Validate a date string: must be YYYY-MM-DD and not in the future. */
    function isValidDate(str) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
        const d = new Date(str + 'T00:00:00');
        return !isNaN(d.getTime());
    }

    /** Compute the Helsinki midnight (seconds since epoch) for the start of a date. */
    function helsinkiStartOfDay(dateStr) {
        // Parse as midnight Helsinki time
        const d = new Date(
            new Date(dateStr + 'T00:00:00').toLocaleString('en-US', { timeZone: 'Europe/Helsinki' })
        );
        return Math.floor(d.getTime() / 1000);
    }

    /** Return ISO timestamp string for when today's challenge closes (Helsinki midnight). */
    function challengeClosesAt(dateStr) {
        const start = helsinkiStartOfDay(dateStr);
        return new Date((start + 86400) * 1000).toISOString();
    }

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

        const foundWordsJson = JSON.stringify(cleanWords);
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
            for (const w of cleanWords) {
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
                wordCount: cleanWords.length,
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
                    const counted = new Set();
                    base.words = words.map(w => {
                        const norm = normalizeWordForDedup(w, singularByPlural);
                        const count = wordIndex.get(norm) ?? 1;
                        const isUnique = count === 1 && !counted.has(norm);
                        counted.add(norm);
                        return { word: w, isUnique };
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
