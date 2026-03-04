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
        db.run('CREATE TABLE IF NOT EXISTS words (word TEXT PRIMARY KEY)', (err) => {
            if (err) {
                console.error('Error creating table:', err.message);
                return;
            }

            // Check if table is already populated
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