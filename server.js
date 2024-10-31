import express from 'express';
import cors from 'cors';
import fs from 'fs';
import csv from 'csv-parser';

const app = express();
const PORT = 3000;
app.use(cors());

let wordSet = new Set();

// Load Finnish words from the first column of the CSV file into a Set for quick lookups
fs.createReadStream('finnish_words.csv')
    .pipe(csv({ separator: '\t' })) // Use '\t' for tab-separated files
    .on('data', (row) => {
        const word = row['Hakusana']?.trim().toUpperCase(); // Normalize words to uppercase
        if (word) wordSet.add(word);
    })
    .on('end', () => {
        console.log(`Loaded ${wordSet.size} words from CSV file`);
    });

// Endpoint to validate words
app.get('/validate-word/:word', (req, res) => {
    const word = req.params.word.toUpperCase(); // Normalize to uppercase for comparison
    const isValid = wordSet.has(word);
    console.log(`Validation request for word "${word}": ${isValid ? 'Valid' : 'Invalid'}`);
    res.json({ exists: isValid });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
