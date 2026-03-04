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

// Connect to SQLite database
const dbPath = path.resolve(__dirname, 'words.db');
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
        // Words table
        db.run('CREATE TABLE IF NOT EXISTS words (word TEXT PRIMARY KEY)', (err) => {
            if (err) {
                console.error('Error creating words table:', err.message);
                return;
            }

            // Scores table
            db.run(`CREATE TABLE IF NOT EXISTS scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nickname TEXT NOT NULL,
                score INTEGER NOT NULL,
                word_count INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            )`, (err) => {
                if (err) {
                    console.error('Error creating scores table:', err.message);
                    return;
                }

                // Check if words table is already populated
                db.get('SELECT COUNT(*) as count FROM words', (err, row) => {
                    if (err) { console.error(err.message); return; }

                    if (row.count > 0) {
                        console.log(`Database already contains ${row.count} words.`);
                        startServer();
                        return;
                    }

                    // Load words from CSV
                    const csvPath = path.resolve(__dirname, 'finnish_words.csv');
                    if (!existsSync(csvPath)) {
                        console.error('finnish_words.csv not found!');
                        startServer();
                        return;
                    }

                    console.log('Loading words from CSV...');
                    const words = readFileSync(csvPath, 'utf8')
                        .split('\n')
                        .map(w => w.trim())
                        .filter(Boolean);

                    const stmt = db.prepare('INSERT OR IGNORE INTO words (word) VALUES (?)');
                    words.forEach(word => stmt.run(word));
                    stmt.finalize((err) => {
                        if (err) { console.error('Error inserting words:', err.message); }
                        else { console.log(`Loaded ${words.length} words into database.`); }
                        startServer();
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

// Validate a word
app.get('/validate-word/:word', (req, res) => {
    const word = req.params.word.toLowerCase();
    db.get('SELECT 1 FROM words WHERE word = ?', [word], (err, row) => {
        if (err) {
            console.error('Error querying database:', err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json({ exists: !!row });
    });
});

// Fetch all words (for testing)
app.get('/words', (req, res) => {
    db.all('SELECT word FROM words', [], (err, rows) => {
        if (err) {
            console.error('Error fetching words:', err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json(rows.map(row => row.word));
    });
});

// Get top 10 leaderboard
// Query param: ?type=alltime (default) or ?type=weekly
app.get('/leaderboard', (req, res) => {
    const type = req.query.type === 'weekly' ? 'weekly' : 'alltime';
    let whereClause = '';
    if (type === 'weekly') {
        const weekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
        whereClause = `WHERE created_at >= ${weekAgo}`;
    }
    const sql = `
        SELECT nickname, score, word_count, created_at
        FROM scores
        ${whereClause}
        ORDER BY score DESC
        LIMIT 10
    `;
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching leaderboard:', err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Check if a score qualifies for top 10
// Query param: ?score=N&type=alltime|weekly
app.get('/leaderboard/qualifies', (req, res) => {
    const score = parseInt(req.query.score, 10);
    const type = req.query.type === 'weekly' ? 'weekly' : 'alltime';

    if (isNaN(score)) return res.status(400).json({ error: 'Invalid score' });

    let whereClause = '';
    if (type === 'weekly') {
        const weekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
        whereClause = `WHERE created_at >= ${weekAgo}`;
    }

    // Count how many scores are strictly higher
    const sql = `SELECT COUNT(*) as count FROM scores ${whereClause} ${whereClause ? 'AND' : 'WHERE'} score > ?`;
    db.get(sql, [score], (err, row) => {
        if (err) {
            console.error('Error checking qualification:', err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json({ qualifies: row.count < 10 });
    });
});

// Submit a score
app.post('/scores', (req, res) => {
    const { nickname, score, word_count } = req.body;

    if (!nickname || typeof score !== 'number' || typeof word_count !== 'number') {
        return res.status(400).json({ error: 'Invalid payload' });
    }

    const cleanNickname = nickname.trim().slice(0, 20);
    if (!cleanNickname) return res.status(400).json({ error: 'Nickname cannot be empty' });

    const created_at = Math.floor(Date.now() / 1000);

    db.run(
        'INSERT INTO scores (nickname, score, word_count, created_at) VALUES (?, ?, ?, ?)',
        [cleanNickname, score, word_count, created_at],
        function (err) {
            if (err) {
                console.error('Error inserting score:', err.message);
                return res.status(500).json({ error: err.message });
            }
            res.json({ id: this.lastID });
        }
    );
});
