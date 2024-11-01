import express from 'express';
import cors from 'cors';
import fs from 'fs';
import csv from 'csv-parser';

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS to allow requests from your frontend
app.use(cors());

// Initialize a Set to store valid words
let wordSet = new Set();

// Load words from the CSV file into the Set
fs.createReadStream('finnish_words.csv')
    .pipe(csv({ separator: '\t' })) // Adjust separator if your CSV uses tabs
    .on('data', (row) => {
        const word = row['Hakusana']?.trim().toUpperCase(); // Adjust the column name as per your CSV
        if (word) wordSet.add(word);
    })
    .on('end', () => {
        console.log(`Loaded ${wordSet.size} words from CSV file`);
    });

// Endpoint to validate if a word exists in the Set
app.get('/validate-word/:word', (req, res) => {
    const word = req.params.word.toUpperCase();
    const isValid = wordSet.has(word);
    console.log(`Validation request for word "${word}": ${isValid ? 'Valid' : 'Invalid'}`);
    res.json({ exists: isValid });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
