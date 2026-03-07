import express from 'express';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

const dbPath = path.resolve(process.env.DB_PATH || __dirname, 'words.db');
console.log(`Database path: ${dbPath}`);
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
        process.exit(1);
    }
    console.log('Connected to SQLite database');
    initializeDatabase();
});

function initializeDatabase() {
    db.serialize(() => {
        db.run('CREATE TABLE IF NOT EXISTS words (word TEXT PRIMARY KEY)', (err) => {
            if (err) { console.error('Error creating words table:', err.message); return; }

            db.run(`CREATE TABLE IF NOT EXISTS scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nickname TEXT NOT NULL,
                score INTEGER NOT NULL,
                word_count INTEGER NOT NULL,
                language TEXT NOT NULL DEFAULT 'fi',
                created_at INTEGER NOT NULL
            )`, (err) => {
                if (err) { console.error('Error creating scores table:', err.message); return; }

                // Ensure language column exists (for backward compatibility)
                db.all("PRAGMA table_info(scores)", [], (err, columns) => {
                    if (err) { console.error('Error checking scores schema:', err.message); return; }
                    const hasLanguageColumn = columns.some(col => col.name === 'language');
                    if (!hasLanguageColumn) {
                        console.log('Adding language column to scores table...');
                        db.run("ALTER TABLE scores ADD COLUMN language TEXT DEFAULT 'fi'", (err) => {
                            if (err) { console.error('Error adding language column:', err.message); }
                            else { console.log('Language column added successfully'); }
                            checkAndLoadWords();
                        });
                    } else {
                        checkAndLoadWords();
                    }
                });
            });
        });
    });
}

function checkAndLoadWords() {
    db.get('SELECT COUNT(*) as count FROM words', (err, row) => {
        if (err) { console.error(err.message); return; }

        if (row.count > 0) {
            console.log(`Database already contains ${row.count} words.`);
            startServer();
            return;
        }

        const csvPath = path.resolve(__dirname, 'finnish_words.csv');
        if (!existsSync(csvPath)) {
            console.error('finnish_words.csv not found!');
            startServer();
            return;
        }

        console.log('Loading words from CSV...');
        const words = readFileSync(csvPath, 'utf8')
            .split('\n')
            .slice(1)
            .map(line => line.split('\t')[0].trim())
            .filter(w => w && !w.includes(' '))
            .map(w => w.toLowerCase());

        const stmt = db.prepare('INSERT OR IGNORE INTO words (word) VALUES (?)');
        words.forEach(word => stmt.run(word));
        stmt.finalize((err) => {
            if (err) { console.error('Error inserting words:', err.message); }
            else { console.log(`Loaded ${words.length} words into database.`); }
            startServer();
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
        // Use database for Finnish
        db.get('SELECT 1 FROM words WHERE word = ?', [word], (err, row) => {
            if (err) { return res.status(500).json({ error: err.message }); }
            res.json({ exists: !!row });
        });
    }
});

app.get('/words', (req, res) => {
    db.all('SELECT word FROM words', [], (err, rows) => {
        if (err) { return res.status(500).json({ error: err.message }); }
        res.json(rows.map(row => row.word));
    });
});

app.post('/words', (req, res) => {
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
    db.all(sql, params, (err, rows) => {
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

    db.get(sql, params, (err, row) => {
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

    db.run(
        'INSERT INTO scores (nickname, score, word_count, language, created_at) VALUES (?, ?, ?, ?, ?)',
        [cleanNickname, score, word_count, lang, created_at],
        function (err) {
            if (err) { return res.status(500).json({ error: err.message }); }
            res.json({ id: this.lastID });
        }
    );
});