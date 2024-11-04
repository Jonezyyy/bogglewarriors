import express from 'express';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enable CORS to allow cross-origin requests (useful if frontend is hosted separately)
app.use(cors());

// Middleware to parse JSON requests
app.use(express.json());

// Connect to SQLite database
const db = new sqlite3.Database(path.resolve(__dirname, 'words.db'), (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log('Connected to SQLite database');
    }
});

// Endpoint to validate if a word exists
app.get('/validate-word/:word', (req, res) => {
    const word = req.params.word.toLowerCase();
    console.log(`Received request to validate word: ${word}`);  // Log the word being validated

    const query = 'SELECT * FROM words WHERE word = ?';
    db.get(query, [word], (err, row) => {
        if (err) {
            console.error('Error querying database:', err.message);
            res.status(500).json({ error: err.message });
            return;
        }

        if (row) {
            console.log(`Word "${word}" exists in the database.`);  // Log if the word is found
            res.json({ exists: true });
        } else {
            console.log(`Word "${word}" does not exist in the database.`);  // Log if the word is not found
            res.json({ exists: false });
        }
    });
});

// Endpoint to fetch all words (optional, useful for testing)
app.get('/words', (req, res) => {
    const query = 'SELECT word FROM words';

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Error fetching words:', err.message);
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows.map(row => row.word));
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
