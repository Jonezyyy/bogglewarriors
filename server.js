import express from 'express';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

const ADMIN_KEY = process.env.ADMIN_KEY;

function requireAdmin(req, res, next) {
    if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
}

// Words DB — always the bundled repo file (read-only at runtime)
const wordsDbPath = path.join(__dirname, 'words.db');
console.log(`Words DB path: ${wordsDbPath}`);
const db = new sqlite3.Database(wordsDbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error('Error connecting to words database:', err.message);
        process.exit(1);
    }
    console.log('Connected to words SQLite database');
});

// Scores DB — persistent volume via SCORES_DB_PATH, falls back to local file
const scoresDbPath = path.resolve(process.env.SCORES_DB_PATH || __dirname, 'scores.db');
console.log(`Scores DB path: ${scoresDbPath}`);
const scoresDb = new sqlite3.Database(scoresDbPath, (err) => {
    if (err) {
        console.error('Error connecting to scores database:', err.message);
        process.exit(1);
    }
    console.log('Connected to scores SQLite database');
    initializeScoresDb();
});

function initializeScoresDb() {
    scoresDb.serialize(() => {
        scoresDb.run(`CREATE TABLE IF NOT EXISTS scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nickname TEXT NOT NULL,
            score INTEGER NOT NULL,
            word_count INTEGER NOT NULL,
            language TEXT NOT NULL DEFAULT 'fi',
            created_at INTEGER NOT NULL
        )`, (err) => {
            if (err) { console.error('Error creating scores table:', err.message); return; }

            // Ensure language column exists (for backward compatibility)
            scoresDb.all("PRAGMA table_info(scores)", [], (err, columns) => {
                if (err) { console.error('Error checking scores schema:', err.message); return; }
                const hasLanguageColumn = columns.some(col => col.name === 'language');
                if (!hasLanguageColumn) {
                    scoresDb.run("ALTER TABLE scores ADD COLUMN language TEXT DEFAULT 'fi'", (err) => {
                        if (err) console.error('Error adding language column:', err.message);
                        migrateScoresFromLegacyDb();
                    });
                } else {
                    migrateScoresFromLegacyDb();
                }
            });
        });
    });
}

// One-time migration: if scores.db is empty and the old volume words.db has scores, copy them over
function migrateScoresFromLegacyDb() {
    scoresDb.get('SELECT COUNT(*) as count FROM scores', (err, row) => {
        if (err || (row && row.count > 0)) {
            if (row) console.log(`scores already has ${row.count} entries`);
            return startServer();
        }

        const legacyDbPath = process.env.DB_PATH
            ? path.resolve(process.env.DB_PATH, 'words.db')
            : null;

        if (!legacyDbPath) {
            console.log('No DB_PATH set, skipping legacy score migration');
            return startServer();
        }

        console.log(`Migrating scores from legacy DB: ${legacyDbPath}`);
        const legacyDb = new sqlite3.Database(legacyDbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                console.error('Cannot open legacy DB for migration:', err.message);
                return startServer();
            }

            legacyDb.all('SELECT nickname, score, word_count, language, created_at FROM scores', (err, rows) => {
                if (err || !rows || rows.length === 0) {
                    console.log('No scores to migrate from legacy DB');
                    legacyDb.close();
                    return startServer();
                }

                console.log(`Migrating ${rows.length} scores...`);
                scoresDb.run('BEGIN TRANSACTION', () => {
                    const stmt = scoresDb.prepare(
                        'INSERT INTO scores (nickname, score, word_count, language, created_at) VALUES (?, ?, ?, ?, ?)'
                    );
                    for (const r of rows) {
                        stmt.run(r.nickname, r.score, r.word_count, r.language || 'fi', r.created_at);
                    }
                    stmt.finalize(() => {
                        scoresDb.run('COMMIT', () => {
                            console.log(`Migrated ${rows.length} scores from legacy DB`);
                            legacyDb.close();
                            startServer();
                        });
                    });
                });
            });
        });
    });
}

function startServer() {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server is running on http://0.0.0.0:${PORT}`);
    });
}

app.get('/validate-word/:word', (req, res) => {
    const word = req.params.word.toLowerCase();
    const lang = req.query.lang || 'fi';

    if (lang === 'en') {
        // Use Free Dictionary API for English
        fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`)
            .then(response => {
                console.log(`Dictionary API [${word}]: status ${response.status}`);
                // 404 = word not found, 200 = valid word
                if (!response.ok) {
                    res.json({ exists: false });
                    return null;
                }
                return response.json();
            })
            .then(data => {
                if (data === null) return; // Already sent 404 response
                // Valid entries have array of definitions with "meanings" field
                const hasDefinitions = Array.isArray(data) && data.length > 0 && data[0].meanings;
                console.log(`Dictionary API [${word}]: has definitions = ${!!hasDefinitions}`);
                res.json({ exists: !!hasDefinitions });
            })
            .catch(error => {
                console.error(`Dictionary API error [${word}]:`, error.message);
                res.json({ exists: false });
            });
    } else {
        // Local SQLite lookup for Finnish (built from kaikki.org dictionary)
        if (word.length < 3 || word.length > 16 || !/^[a-zäö]+$/.test(word)) {
            return res.json({ exists: false });
        }

        db.get('SELECT * FROM finnish_words WHERE word = ?', [word], (err, row) => {
            if (err) {
                console.error(`Finnish DB error [${word}]:`, err.message);
                return res.json({ exists: false });
            }
            if (!row) {
                console.log(`Finnish DB [${word}]: not found`);
                return res.json({ exists: false });
            }

            const isInflection = row.is_inflection === 1;
            const nominativePlural = row.nominative_plural || null;
            const isNominativePlural = row.is_nominative_plural === 1;

            console.log(`Finnish DB [${word}]: exists=true isInflection=${isInflection} nominativePlural=${nominativePlural} isNominativePlural=${isNominativePlural}`);
            res.json({ exists: true, isInflection, nominativePlural, isNominativePlural });
        });
    }
});

app.get('/words', (req, res) => {
    db.all('SELECT word FROM words', [], (err, rows) => {
        if (err) { return res.status(500).json({ error: err.message }); }
        res.json(rows.map(row => row.word));
    });
});

app.post('/words', requireAdmin, (req, res) => {
    const { word } = req.body;
    if (!word || typeof word !== 'string') { return res.status(400).json({ error: 'Invalid payload' }); }
    const cleanWord = word.trim().toLowerCase();
    if (!cleanWord) { return res.status(400).json({ error: 'Word cannot be empty' }); }
    db.run('INSERT OR IGNORE INTO words (word) VALUES (?)', [cleanWord], function (err) {
        if (err) { return res.status(500).json({ error: err.message }); }
        if (this.changes === 0) { return res.json({ added: false, message: 'Word already exists' }); }
        res.json({ added: true, word: cleanWord });
    });
});

app.post('/finnish-words', requireAdmin, (req, res) => {
    const { word, is_inflection, nominative_plural, is_nominative_plural } = req.body;
    if (!word || typeof word !== 'string') { return res.status(400).json({ error: 'Invalid payload' }); }
    const cleanWord = word.trim().toLowerCase();
    if (!cleanWord || cleanWord.length < 3 || cleanWord.length > 16 || !/^[a-zäö]+$/.test(cleanWord)) {
        return res.status(400).json({ error: 'Invalid word (3-16 chars, Finnish letters only)' });
    }
    db.run(
        'INSERT OR REPLACE INTO finnish_words (word, is_inflection, nominative_plural, is_nominative_plural) VALUES (?, ?, ?, ?)',
        [cleanWord, is_inflection ? 1 : 0, nominative_plural || null, is_nominative_plural ? 1 : 0],
        function (err) {
            if (err) { return res.status(500).json({ error: err.message }); }
            console.log(`Finnish word added: ${cleanWord}`);
            res.json({ added: true, word: cleanWord });
        }
    );
});

app.get('/leaderboard', (req, res) => {
    const type = req.query.type === 'daily' ? 'daily' : 'alltime';
    const lang = req.query.lang || 'fi';

    let sql, params;

    if (type === 'daily') {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
        sql = `SELECT id, nickname, score, word_count, created_at FROM scores WHERE language = ? AND created_at >= ? ORDER BY score DESC LIMIT 10`;
        params = [lang, startOfDay];
    } else {
        sql = `SELECT id, nickname, score, word_count, created_at FROM scores WHERE language = ? ORDER BY score DESC LIMIT 10`;
        params = [lang];
    }

    console.log(`Leaderboard query [${type}, ${lang}]:`, sql, params);
    scoresDb.all(sql, params, (err, rows) => {
        if (err) { 
            console.error(`Leaderboard error [${type}, ${lang}]:`, err);
            return res.status(500).json({ error: err.message }); 
        }
        console.log(`Leaderboard result [${type}, ${lang}]: ${rows?.length || 0} rows`);
        res.json(rows || []);
    });
});

app.get('/leaderboard/qualifies', (req, res) => {
    const score = parseInt(req.query.score, 10);
    const type = req.query.type === 'daily' ? 'daily' : 'alltime';
    const lang = req.query.lang || 'fi';

    if (isNaN(score)) { return res.status(400).json({ error: 'Invalid score' }); }

    let sql, params;

    if (type === 'daily') {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
        sql = `SELECT COUNT(*) as count FROM scores WHERE language = ? AND created_at >= ? AND score > ?`;
        params = [lang, startOfDay, score];
    } else {
        sql = `SELECT COUNT(*) as count FROM scores WHERE language = ? AND score > ?`;
        params = [lang, score];
    }

    scoresDb.get(sql, params, (err, row) => {
        if (err) { return res.status(500).json({ error: err.message }); }
        res.json({ qualifies: row.count < 10 });
    });
});

app.post('/scores', (req, res) => {
    const { nickname, score, word_count, language } = req.body;
    const lang = language || 'fi';

    if (!nickname || typeof score !== 'number' || typeof word_count !== 'number') {
        return res.status(400).json({ error: 'Invalid payload' });
    }
    const cleanNickname = nickname.trim().slice(0, 20);
    if (!cleanNickname) { return res.status(400).json({ error: 'Nickname cannot be empty' }); }
    const created_at = Math.floor(Date.now() / 1000);

    scoresDb.run(
        'INSERT INTO scores (nickname, score, word_count, language, created_at) VALUES (?, ?, ?, ?, ?)',
        [cleanNickname, score, word_count, lang, created_at],
        function (err) {
            if (err) { return res.status(500).json({ error: err.message }); }
            res.json({ id: this.lastID });
        }
    );
});