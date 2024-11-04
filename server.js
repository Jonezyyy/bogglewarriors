import express from 'express';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 3000;

// Get the directory path for the ES module environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Connect to SQLite database
const db = new sqlite3.Database(path.resolve(__dirname, 'words.db'), (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log('Connected to SQLite database');
    }
});

// Middleware to parse JSON requests
app.use(express.json());

// Endpoint to validate if a word exists
app.get('/validate-word/:word', (req, res) => {
    const word = req.params.word.toLowerCase();
    const query = 'SELECT * FROM words WHERE word = ?';

    db.get(query, [word], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json({ exists: !!row });
        }
    });
});

// Endpoint to fetch all words
app.get('/words', (req, res) => {
    const query = 'SELECT word FROM words';

    db.all(query, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json(rows.map(row => row.word));
        }
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
