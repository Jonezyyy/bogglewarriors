// Warrior Mode route handlers.
// Mounted in server.js via: import { registerWarriorRoutes } from './server-warrior.js'
// This module is pure Express — no DB setup, no app startup logic.
//
// Warrior Mode: survival Boggle where found words add seconds to the clock.
// Special tiles (2x, 3x) spawn client-side every 5 correct words.
// Leaderboard is ranked by survival_time DESC.

import {
    getTodayHelsinki,
    analyzeFinnishBoard,
    calculateWordScore,
} from './server-utils.js';

const FINNISH_DICE = [
    "AISPUJ", "AEENEA", "ÄIÖNST", "ANPRSK", "APHSKO",
    "DESRIL", "EIENUS", "HIKNMU", "AKAÄLÄ", "SIOTMU",
    "AJTOTO", "EITOSS", "ELYTTR", "AKITMV", "AILKVY", "ALRNNU"
];

// ---------------------------------------------------------------------------
// Warrior board generation — uses a different seed from the daily board
// so the same date produces a different layout.
// Mulberry32 PRNG is copied locally to keep this module self-contained.
// ---------------------------------------------------------------------------

function mulberry32(seed) {
    return () => {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function generateWarriorBoard(dateStr) {
    // Add a large offset so the PRNG stream is completely different from the daily board
    const seed = parseInt(dateStr.replace(/-/g, ''), 10) + 10_000_000;
    const rand = mulberry32(seed);
    const dice = [...FINNISH_DICE];
    for (let i = dice.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [dice[i], dice[j]] = [dice[j], dice[i]];
    }
    return dice.map(die => die[Math.floor(rand() * die.length)].toLowerCase());
}

// ---------------------------------------------------------------------------
// registerWarriorRoutes(app, scoresDb, sanakirjaCache)
// ---------------------------------------------------------------------------

export function registerWarriorRoutes(app, scoresDb, sanakirjaCache) {

    // ------------------------------------------------------------------
    // DB table creation (self-contained, runs once at startup)
    // ------------------------------------------------------------------
    scoresDb.run(`CREATE TABLE IF NOT EXISTS warrior_boards (
        date           TEXT    PRIMARY KEY,
        letters        TEXT    NOT NULL,
        analyzed_words TEXT    NOT NULL,
        created_at     INTEGER NOT NULL
    )`);

    // warrior_submissions — no UNIQUE(date, uuid), multiple plays per day are allowed.
    // If the table was previously created with that unique constraint, migrate it away.
    scoresDb.run(`CREATE TABLE IF NOT EXISTS warrior_submissions (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        date           TEXT    NOT NULL,
        uuid           TEXT    NOT NULL,
        nickname       TEXT    NOT NULL,
        survival_time  INTEGER NOT NULL,
        word_count     INTEGER NOT NULL DEFAULT 0,
        score          INTEGER NOT NULL DEFAULT 0,
        found_words    TEXT    NOT NULL,
        submitted_at   INTEGER NOT NULL
    )`, (err) => {
        if (err) return console.error('[warrior] Error creating warrior_submissions:', err.message);

        // Check whether the old UNIQUE(date, uuid) autoindex still exists on the table.
        scoresDb.get(
            `SELECT COUNT(*) AS cnt FROM sqlite_master
             WHERE type='index' AND tbl_name='warrior_submissions'
             AND name LIKE 'sqlite_autoindex%'`,
            (err, row) => {
                if (err || !row || row.cnt === 0) {
                    // Fresh table or already migrated — just ensure the index exists.
                    scoresDb.run('CREATE INDEX IF NOT EXISTS idx_ws_date ON warrior_submissions(date)');
                    return;
                }

                // Old schema found: recreate without the unique constraint.
                console.log('[warrior] Migrating warrior_submissions: removing UNIQUE(date, uuid)...');
                scoresDb.run(`CREATE TABLE warrior_submissions_mig (
                    id             INTEGER PRIMARY KEY AUTOINCREMENT,
                    date           TEXT    NOT NULL,
                    uuid           TEXT    NOT NULL,
                    nickname       TEXT    NOT NULL,
                    survival_time  INTEGER NOT NULL,
                    word_count     INTEGER NOT NULL DEFAULT 0,
                    score          INTEGER NOT NULL DEFAULT 0,
                    found_words    TEXT    NOT NULL,
                    submitted_at   INTEGER NOT NULL
                )`, (err) => {
                    if (err) return console.error('[warrior] Migration error (create):', err.message);
                    scoresDb.run(
                        `INSERT INTO warrior_submissions_mig
                         SELECT id,date,uuid,nickname,survival_time,word_count,score,found_words,submitted_at
                         FROM warrior_submissions`,
                        (err) => {
                            if (err) return console.error('[warrior] Migration error (copy):', err.message);
                            scoresDb.run('DROP TABLE warrior_submissions', (err) => {
                                if (err) return console.error('[warrior] Migration error (drop):', err.message);
                                scoresDb.run(
                                    'ALTER TABLE warrior_submissions_mig RENAME TO warrior_submissions',
                                    (err) => {
                                        if (err) return console.error('[warrior] Migration error (rename):', err.message);
                                        scoresDb.run('CREATE INDEX IF NOT EXISTS idx_ws_date ON warrior_submissions(date)');
                                        console.log('[warrior] Migration complete.');
                                    }
                                );
                            });
                        }
                    );
                });
            }
        );
    });

    // ------------------------------------------------------------------
    // Promise helpers
    // ------------------------------------------------------------------

    function dbGet(sql, params = []) {
        return new Promise((resolve, reject) => {
            scoresDb.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
        });
    }

    function dbAll(sql, params = []) {
        return new Promise((resolve, reject) => {
            scoresDb.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
        });
    }

    function dbRun(sql, params = []) {
        return new Promise((resolve, reject) => {
            scoresDb.run(sql, params, function (err) {
                err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }

    // ------------------------------------------------------------------
    // Board helpers
    // ------------------------------------------------------------------

    async function getOrCreateBoard(date) {
        const existing = await dbGet(
            'SELECT date, letters, analyzed_words FROM warrior_boards WHERE date = ?', [date]
        );
        if (existing) {
            return {
                date: existing.date,
                letters: JSON.parse(existing.letters),
                analyzedWords: JSON.parse(existing.analyzed_words),
            };
        }

        const letters = generateWarriorBoard(date);

        if (!sanakirjaCache) throw new Error('Dictionary cache unavailable');
        const analysis = analyzeFinnishBoard(letters, sanakirjaCache);

        await dbRun(
            'INSERT OR IGNORE INTO warrior_boards (date, letters, analyzed_words, created_at) VALUES (?, ?, ?, ?)',
            [date, JSON.stringify(letters), JSON.stringify(analysis), Math.floor(Date.now() / 1000)]
        );

        return { date, letters, analyzedWords: analysis };
    }

    function isValidDate(str) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
        const d = new Date(str + 'T00:00:00');
        return !isNaN(d.getTime());
    }

    function helsinkiStartOfDay(dateStr) {
        const d = new Date(
            new Date(dateStr + 'T00:00:00').toLocaleString('en-US', { timeZone: 'Europe/Helsinki' })
        );
        return Math.floor(d.getTime() / 1000);
    }

    function challengeClosesAt(dateStr) {
        const start = helsinkiStartOfDay(dateStr);
        return new Date((start + 86400) * 1000).toISOString();
    }

    /** Compute raw score from an array of word strings (no supersede logic in warrior mode). */
    function computeScore(words) {
        return words.reduce((sum, w) => sum + calculateWordScore(w), 0);
    }

    // ------------------------------------------------------------------
    // GET /warrior/board?date=YYYY-MM-DD
    // ------------------------------------------------------------------
    app.get('/warrior/board', async (req, res) => {
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
            console.error('GET /warrior/board error:', err.message);
            res.status(500).json({ error: 'Could not load warrior board' });
        }
    });

    // ------------------------------------------------------------------
    // POST /warrior/submit
    // Body: { uuid, nickname, foundWords: string[], survivalTime: number, date }
    // ------------------------------------------------------------------
    app.post('/warrior/submit', async (req, res) => {
        const { uuid, nickname, foundWords, survivalTime, date } = req.body;

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

        if (typeof survivalTime !== 'number' || survivalTime < 0 || survivalTime > 86400) {
            return res.status(400).json({ error: 'survivalTime must be a non-negative number (seconds)' });
        }

        const submittedDate = typeof date === 'string' ? date.trim() : getTodayHelsinki();
        if (!isValidDate(submittedDate)) {
            return res.status(400).json({ error: 'Invalid date format' });
        }

        const today = getTodayHelsinki();
        if (submittedDate > today) {
            return res.status(400).json({ error: 'Cannot submit for a future date' });
        }
        if (submittedDate < today) {
            return res.status(400).json({ error: 'The challenge for this date is closed' });
        }

        const cleanWords = [...new Set(
            foundWords
                .map(w => w.trim().toLowerCase())
                .filter(w => w.length >= 3 && w.length <= 16 && /^[a-zäö]+$/.test(w))
        )];

        const score = computeScore(cleanWords);
        const submittedAt = Math.floor(Date.now() / 1000);

        try {
            const result = await dbRun(
                `INSERT INTO warrior_submissions
                 (date, uuid, nickname, survival_time, word_count, score, found_words, submitted_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [submittedDate, cleanUuid, cleanNickname, Math.round(survivalTime),
                 cleanWords.length, score, JSON.stringify(cleanWords), submittedAt]
            );

            res.json({
                submissionId: result.lastID,
                date: submittedDate,
                wordCount: cleanWords.length,
                score,
                survivalTime: Math.round(survivalTime),
            });
        } catch (err) {
            console.error('POST /warrior/submit error:', err.message);
            res.status(500).json({ error: 'Could not save submission' });
        }
    });

    // ------------------------------------------------------------------
    // GET /warrior/leaderboard?date=YYYY-MM-DD
    // ------------------------------------------------------------------
    app.get('/warrior/leaderboard', async (req, res) => {
        const date = req.query.date || getTodayHelsinki();

        if (!isValidDate(date)) {
            return res.status(400).json({ error: 'Invalid date format' });
        }

        const today = getTodayHelsinki();

        try {
            // For each player show only their best run (highest survival_time).
            const rows = await dbAll(
                `SELECT ws.uuid, ws.nickname, ws.survival_time, ws.word_count, ws.score, ws.found_words
                 FROM warrior_submissions ws
                 INNER JOIN (
                     SELECT uuid, MAX(survival_time) AS best_time
                     FROM warrior_submissions
                     WHERE date = ?
                     GROUP BY uuid
                 ) best ON ws.uuid = best.uuid AND ws.survival_time = best.best_time AND ws.date = ?
                 ORDER BY ws.survival_time DESC, ws.score DESC
                 LIMIT 50`,
                [date, date]
            );

            const entries = rows.map((row, i) => ({
                rank: i + 1,
                nickname: row.nickname,
                survivalTime: row.survival_time,
                score: row.score,
                wordCount: row.word_count,
                words: JSON.parse(row.found_words),
            }));

            res.json({
                date,
                isClosed: date < today,
                playerCount: rows.length,
                entries,
            });
        } catch (err) {
            console.error('GET /warrior/leaderboard error:', err.message);
            res.status(500).json({ error: 'Could not load leaderboard' });
        }
    });

    // ------------------------------------------------------------------
    // GET /warrior/result?date=YYYY-MM-DD&uuid=...
    // ------------------------------------------------------------------
    app.get('/warrior/result', async (req, res) => {
        const date = req.query.date || getTodayHelsinki();
        const uuid = req.query.uuid;

        if (!isValidDate(date)) {
            return res.status(400).json({ error: 'Invalid date format' });
        }
        if (!uuid || typeof uuid !== 'string' || uuid.trim().length === 0) {
            return res.status(400).json({ error: 'uuid is required' });
        }

        try {
            const row = await dbGet(
                `SELECT nickname, survival_time, word_count, score, found_words, submitted_at
                 FROM warrior_submissions WHERE date = ? AND uuid = ?`,
                [date, uuid.trim()]
            );

            if (!row) {
                return res.json({ found: false });
            }

            res.json({
                found: true,
                nickname: row.nickname,
                survivalTime: row.survival_time,
                score: row.score,
                wordCount: row.word_count,
                words: JSON.parse(row.found_words),
                submittedAt: row.submitted_at,
            });
        } catch (err) {
            console.error('GET /warrior/result error:', err.message);
            res.status(500).json({ error: 'Could not load result' });
        }
    });
}
