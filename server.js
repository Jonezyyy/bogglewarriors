import express from 'express';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

const ADMIN_KEY = process.env.ADMIN_KEY;
const BOARD_SIZE = 4;
const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
const MAX_WORD_LENGTH = 16;

let finnishWordCache = null;
let finnishWordCachePromise = null;

function requireAdmin(req, res, next) {
    if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
}

function ensureScoreColumns(columns, callback) {
    const pendingColumns = [];

    if (!columns.some(col => col.name === 'language')) {
        pendingColumns.push({
            name: 'language',
            sql: "ALTER TABLE scores ADD COLUMN language TEXT DEFAULT 'fi'"
        });
    }

    if (!columns.some(col => col.name === 'mode')) {
        pendingColumns.push({
            name: 'mode',
            sql: "ALTER TABLE scores ADD COLUMN mode TEXT DEFAULT 'timed'"
        });
    }

    const addNextColumn = () => {
        if (pendingColumns.length === 0) {
            callback();
            return;
        }

        const nextColumn = pendingColumns.shift();
        scoresDb.run(nextColumn.sql, (err) => {
            if (err) {
                console.error(`Error adding ${nextColumn.name} column:`, err.message);
            }
            addNextColumn();
        });
    };

    addNextColumn();
}

function calculateWordScore(word) {
    const length = word.length;
    return length >= 8 ? 11 : length === 7 ? 5 : length === 6 ? 3 : length === 5 ? 2 : length >= 3 ? 1 : 0;
}

function isSupersededWord(word, metadataByWord) {
    const meta = metadataByWord.get(word);
    if (!meta || meta.isNominativePlural) return false;
    return meta.nominativePlural !== null && metadataByWord.has(meta.nominativePlural);
}

function getScoreMode(value) {
    return value === 'unlimited' ? 'unlimited' : 'timed';
}

function buildSanakirjaCache() {
    try {
        const raw = JSON.parse(readFileSync(path.join(__dirname, 'sanakirja_boggle_plurals.json'), 'utf8'));
        const metadataByWord = new Map();
        const prefixes = new Set();
        const VALID = /^[a-zäö]+$/;

        const addWord = (word, meta) => {
            metadataByWord.set(word, meta);
            for (let i = 1; i <= word.length; i++) prefixes.add(word.slice(0, i));
        };

        for (const [baseWord, data] of Object.entries(raw)) {
            const lword = baseWord.toLowerCase();
            // Skip proper nouns (capitalized), wrong length, or non-Finnish chars
            if (baseWord[0] !== baseWord[0].toLowerCase()) continue;
            if (lword.length < 3 || lword.length > 16) continue;
            if (!VALID.test(lword)) continue;

            const plural = data.plural ? data.plural.toLowerCase() : '';
            const validPlural = plural && plural.length >= 3 && plural.length <= 16 && VALID.test(plural) ? plural : null;

            addWord(lword, { nominativePlural: validPlural, isNominativePlural: false });
            if (validPlural) addWord(validPlural, { nominativePlural: null, isNominativePlural: true });
        }

        console.log(`Sanakirja.fi cache loaded: ${metadataByWord.size} words`);
        return { metadataByWord, prefixes };
    } catch (err) {
        console.warn(`Could not load sanakirja_boggle_plurals.json: ${err.message}`);
        return null;
    }
}

const sanakirjaCache = buildSanakirjaCache();

function normalizeBoardLetters(letters) {
    if (!Array.isArray(letters) || letters.length !== BOARD_CELLS) return null;

    const normalized = letters.map(letter => {
        if (typeof letter !== 'string') return null;
        const trimmed = letter.trim().toLowerCase();
        if (!/^[a-zäö]$/.test(trimmed)) return null;
        return trimmed;
    });

    return normalized.every(Boolean) ? normalized : null;
}

function buildBoardNeighbors() {
    const neighbors = Array.from({ length: BOARD_CELLS }, () => []);

    for (let row = 0; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            const index = row * BOARD_SIZE + col;
            for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
                for (let colOffset = -1; colOffset <= 1; colOffset++) {
                    if (rowOffset === 0 && colOffset === 0) continue;
                    const nextRow = row + rowOffset;
                    const nextCol = col + colOffset;
                    if (nextRow < 0 || nextRow >= BOARD_SIZE || nextCol < 0 || nextCol >= BOARD_SIZE) continue;
                    neighbors[index].push(nextRow * BOARD_SIZE + nextCol);
                }
            }
        }
    }

    return neighbors;
}

const boardNeighbors = buildBoardNeighbors();

function loadFinnishWordCache() {
    if (finnishWordCache) {
        return Promise.resolve(finnishWordCache);
    }

    if (finnishWordCachePromise) {
        return finnishWordCachePromise;
    }

    finnishWordCachePromise = new Promise((resolve, reject) => {
        db.all(
            `SELECT word, nominative_plural, is_nominative_plural
             FROM finnish_words
             WHERE LENGTH(word) BETWEEN 3 AND 16`,
            [],
            (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }

                const metadataByWord = new Map();
                const prefixes = new Set();

                for (const row of rows) {
                    metadataByWord.set(row.word, {
                        nominativePlural: row.nominative_plural || null,
                        isNominativePlural: row.is_nominative_plural === 1
                    });

                    for (let index = 1; index <= row.word.length; index++) {
                        prefixes.add(row.word.slice(0, index));
                    }
                }

                finnishWordCache = { metadataByWord, prefixes };
                resolve(finnishWordCache);
            }
        );
    }).catch((error) => {
        finnishWordCachePromise = null;
        throw error;
    });

    return finnishWordCachePromise;
}

function analyzeFinnishBoard(letters, cache) {
    const foundWords = new Set();
    const visited = new Array(BOARD_CELLS).fill(false);

    function dfs(index, currentWord) {
        const nextWord = currentWord + letters[index];
        if (!cache.prefixes.has(nextWord)) return;

        if (cache.metadataByWord.has(nextWord)) {
            foundWords.add(nextWord);
        }

        if (nextWord.length >= MAX_WORD_LENGTH) return;

        visited[index] = true;
        for (const neighbor of boardNeighbors[index]) {
            if (!visited[neighbor]) {
                dfs(neighbor, nextWord);
            }
        }
        visited[index] = false;
    }

    for (let index = 0; index < BOARD_CELLS; index++) {
        dfs(index, '');
    }

    const foundMetadata = new Map();
    const words = Array.from(foundWords).sort().map((word) => {
        const meta = cache.metadataByWord.get(word);
        foundMetadata.set(word, meta);
        return {
            word,
            nominativePlural: meta.nominativePlural,
            isNominativePlural: meta.isNominativePlural
        };
    });

    const maxScore = words.reduce((total, entry) => {
        return total + (isSupersededWord(entry.word, foundMetadata) ? 0 : calculateWordScore(entry.word));
    }, 0);

    return {
        words,
        totalWords: words.length,
        maxScore
    };
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
    db.get("SELECT value FROM meta WHERE key = 'version'", (err, row) => {
        console.log(`Words DB version: ${row?.value ?? 'unknown'}`);
    });
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
            mode TEXT NOT NULL DEFAULT 'timed',
            created_at INTEGER NOT NULL
        )`, (err) => {
            if (err) { console.error('Error creating scores table:', err.message); return; }

            scoresDb.all("PRAGMA table_info(scores)", [], (err, columns) => {
                if (err) { console.error('Error checking scores schema:', err.message); return; }
                ensureScoreColumns(columns, migrateScoresFromLegacyDb);
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

app.get('/db-version', (req, res) => {
    db.get("SELECT value FROM meta WHERE key = 'version'", (err, row) => {
        if (err || !row) return res.json({ version: 'unknown' });
        res.json({ version: row.value });
    });
});

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

        if (req.query.dict === 'sanakirja' && sanakirjaCache) {
            const meta = sanakirjaCache.metadataByWord.get(word);
            if (!meta) return res.json({ exists: false });
            return res.json({ exists: true, isInflection: false, nominativePlural: meta.nominativePlural, isNominativePlural: meta.isNominativePlural });
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

app.post('/board-analysis', async (req, res) => {
    const lang = req.body.lang || 'fi';
    const letters = normalizeBoardLetters(req.body.letters);

    if (lang !== 'fi') {
        return res.status(400).json({ error: 'Board analysis is currently available in Finnish only' });
    }

    if (!letters) {
        return res.status(400).json({ error: 'Invalid board letters' });
    }

    try {
        const dict = req.body.dict || 'kaikki';
        const cache = (dict === 'sanakirja' && sanakirjaCache) ? sanakirjaCache : await loadFinnishWordCache();
        res.json(analyzeFinnishBoard(letters, cache));
    } catch (error) {
        console.error('Board analysis error:', error.message);
        res.status(500).json({ error: 'Could not analyze board' });
    }
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
    const mode = getScoreMode(req.query.mode);

    let sql, params;

    if (type === 'daily') {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
        sql = `SELECT id, nickname, score, word_count, created_at FROM scores WHERE language = ? AND mode = ? AND created_at >= ? ORDER BY score DESC LIMIT 10`;
        params = [lang, mode, startOfDay];
    } else {
        sql = `SELECT id, nickname, MAX(score) as score, word_count, created_at FROM scores WHERE language = ? AND mode = ? GROUP BY LOWER(nickname) ORDER BY score DESC LIMIT 10`;
        params = [lang, mode];
    }

    console.log(`Leaderboard query [${type}, ${lang}, ${mode}]:`, sql, params);
    scoresDb.all(sql, params, (err, rows) => {
        if (err) { 
            console.error(`Leaderboard error [${type}, ${lang}, ${mode}]:`, err);
            return res.status(500).json({ error: err.message }); 
        }
        console.log(`Leaderboard result [${type}, ${lang}, ${mode}]: ${rows?.length || 0} rows`);
        res.json(rows || []);
    });
});

app.get('/leaderboard/qualifies', (req, res) => {
    const score = parseInt(req.query.score, 10);
    const type = req.query.type === 'daily' ? 'daily' : 'alltime';
    const lang = req.query.lang || 'fi';
    const mode = getScoreMode(req.query.mode);

    if (isNaN(score)) { return res.status(400).json({ error: 'Invalid score' }); }

    let sql, params;

    if (type === 'daily') {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
        sql = `SELECT COUNT(*) as count FROM scores WHERE language = ? AND mode = ? AND created_at >= ? AND score > ?`;
        params = [lang, mode, startOfDay, score];
    } else {
        sql = `SELECT COUNT(*) as count FROM scores WHERE language = ? AND mode = ? AND score > ?`;
        params = [lang, mode, score];
    }

    scoresDb.get(sql, params, (err, row) => {
        if (err) { return res.status(500).json({ error: err.message }); }
        res.json({ qualifies: row.count < 10 });
    });
});

app.post('/scores', (req, res) => {
    const { nickname, score, word_count, language, mode } = req.body;
    const lang = language || 'fi';
    
    if (mode === 'zen') {
        return res.status(400).json({ error: 'Zen mode scores cannot be saved' });
    }
    const safeMode = getScoreMode(mode);

    if (!nickname || typeof score !== 'number' || typeof word_count !== 'number') {
        return res.status(400).json({ error: 'Invalid payload' });
    }
    const cleanNickname = nickname.trim().slice(0, 20);
    if (!cleanNickname) { return res.status(400).json({ error: 'Nickname cannot be empty' }); }
    const created_at = Math.floor(Date.now() / 1000);

    scoresDb.run(
        'INSERT INTO scores (nickname, score, word_count, language, mode, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [cleanNickname, score, word_count, lang, safeMode, created_at],
        function (err) {
            if (err) { return res.status(500).json({ error: err.message }); }
            res.json({ id: this.lastID });
        }
    );
});