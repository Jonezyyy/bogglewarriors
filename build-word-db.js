// build-word-db.js
// One-time script to build Finnish word database from kaikki.org JSONL dump
//
// Usage:
//   1. Download the Finnish dictionary JSONL from:
//      https://kaikki.org/dictionary/Finnish/kaikki.org-dictionary-Finnish.jsonl
//   2. Place the file in this directory
//   3. Run: node build-word-db.js
//
// If the Finnish-specific file is removed, use the raw data instead:
//   https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz
//   (gunzip it, the script will filter by lang_code === "fi")

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import sqlite3pkg from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const sqlite3 = sqlite3pkg.verbose();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Finnish Boggle dice constraints ────────────────────────────────────
// Dice: AISPUJ, AEENEA, ÄIÖNST, ANPRSK, APHSKO,
//       DESRIL, EIENUS, HIKNMU, AKAÄLÄ, SIOTMU,
//       AJTOTO, EITOSS, ELYTTR, AKITMV, AILKVY, ALRNNU

const VALID_LETTERS = new Set('adehijklmnoprstuvyäö');

// Max occurrences = number of dice containing that letter
const MAX_LETTER_COUNT = {
    'a': 9, 'd': 1, 'e': 5, 'h': 2, 'i': 9,
    'j': 2, 'k': 6, 'l': 5, 'm': 3, 'n': 6,
    'o': 4, 'p': 3, 'r': 4, 's': 8, 't': 6,
    'u': 5, 'v': 2, 'y': 2, 'ä': 2, 'ö': 1
};

function isValidForBoggle(word) {
    if (word.length < 3 || word.length > 16) return false;
    const counts = {};
    for (const ch of word) {
        if (!VALID_LETTERS.has(ch)) return false;
        counts[ch] = (counts[ch] || 0) + 1;
        if (counts[ch] > MAX_LETTER_COUNT[ch]) return false;
    }
    return true;
}

// ── Data accumulator ───────────────────────────────────────────────────
// Merges multiple JSONL entries for the same word (different POS)
const wordData = new Map();

// Parts of speech to exclude entirely
const EXCLUDED_POS = new Set(['name', 'abbrev', 'character', 'symbol', 'punct']);

function processEntry(entry) {
    // Support both Finnish-only dump and raw all-languages dump
    if (entry.lang_code && entry.lang_code !== 'fi') return;

    // Skip proper nouns, abbreviations, letter names, symbols
    if (EXCLUDED_POS.has(entry.pos)) return;

    // Skip if the original word starts with a capital letter (proper noun / name)
    if (entry.word && /^[A-ZÄÖÅ]/.test(entry.word)) return;

    // Skip if top-level tags mark this as an abbreviation
    if (entry.tags && (entry.tags.includes('abbreviation') || entry.tags.includes('initialism'))) return;

    const word = (entry.word || '').toLowerCase();
    if (!isValidForBoggle(word)) return;

    const senses = entry.senses || [];
    if (senses.length === 0) return;

    // Skip if all senses are marked as abbreviations or proper nouns
    const hasUsableSense = senses.some(s =>
        !s.tags || (!s.tags.includes('abbreviation') && !s.tags.includes('initialism') && !s.tags.includes('proper-noun'))
    );
    if (!hasUsableSense) return;

    // A sense is "base" if it doesn't have form_of
    const hasBaseSense = senses.some(s => !s.form_of || s.form_of.length === 0);

    // Check if any sense is a nominative plural inflection
    const isNomPlural = senses.some(s =>
        s.form_of && s.form_of.length > 0 &&
        s.tags && s.tags.includes('nominative') && s.tags.includes('plural')
    );

    // For base words: find nominative plural from the forms list
    let nomPluralForm = null;
    if (hasBaseSense && entry.forms) {
        const form = entry.forms.find(f =>
            f.tags && f.tags.includes('nominative') && f.tags.includes('plural') &&
            !f.tags.includes('accusative') && !f.tags.includes('genitive') &&
            f.form && f.form !== '-'
        );
        if (form) {
            const plural = form.form.toLowerCase();
            // Only store if the plural itself is valid for Boggle
            if (isValidForBoggle(plural)) {
                nomPluralForm = plural;
            }
        }
    }

    // Merge with existing data for this word
    const existing = wordData.get(word);
    if (existing) {
        if (hasBaseSense) existing.isBase = true;
        if (nomPluralForm && !existing.nominativePlural) {
            existing.nominativePlural = nomPluralForm;
        }
        if (isNomPlural) existing.isNominativePlural = true;
    } else {
        wordData.set(word, {
            isBase: hasBaseSense,
            nominativePlural: nomPluralForm,
            isNominativePlural: isNomPlural
        });
    }
}

// ── Main ───────────────────────────────────────────────────────────────

const INPUT = path.join(__dirname, 'kaikki.org-dictionary-Finnish.jsonl');
const DB_PATH = path.join(__dirname, 'words.db');

async function readJsonl() {
    console.log(`Reading: ${INPUT}`);
    const rl = createInterface({
        input: createReadStream(INPUT, { encoding: 'utf8' }),
        crlfDelay: Infinity
    });

    let lineCount = 0;
    let parseErrors = 0;

    for await (const line of rl) {
        lineCount++;
        if (lineCount % 50000 === 0) {
            process.stdout.write(`\r  ${lineCount} lines read, ${wordData.size} valid words...`);
        }
        try {
            processEntry(JSON.parse(line));
        } catch {
            parseErrors++;
        }
    }

    console.log(`\r  ${lineCount} lines read, ${wordData.size} valid words.`);
    if (parseErrors > 0) console.log(`  (${parseErrors} lines skipped due to parse errors)`);
    return lineCount;
}

function writeToDb() {
    return new Promise((resolve, reject) => {
        console.log(`Writing to: ${DB_PATH}`);
        const db = new sqlite3.Database(DB_PATH, (err) => {
            if (err) return reject(err);

            db.serialize(() => {
                db.run(`CREATE TABLE IF NOT EXISTS finnish_words (
                    word TEXT PRIMARY KEY,
                    is_inflection INTEGER DEFAULT 0,
                    nominative_plural TEXT,
                    is_nominative_plural INTEGER DEFAULT 0
                )`);
                db.run('DELETE FROM finnish_words');
                db.run('BEGIN TRANSACTION');

                const stmt = db.prepare(
                    `INSERT INTO finnish_words (word, is_inflection, nominative_plural, is_nominative_plural)
                     VALUES (?, ?, ?, ?)`
                );

                let inserted = 0;
                for (const [word, data] of wordData) {
                    stmt.run(
                        word,
                        data.isBase ? 0 : 1,
                        data.nominativePlural || null,
                        data.isNominativePlural ? 1 : 0
                    );
                    inserted++;
                    if (inserted % 25000 === 0) {
                        process.stdout.write(`\r  Inserted ${inserted}/${wordData.size}...`);
                    }
                }

                // Insert nominative plurals that never appeared as their own JSONL entry
                let pluralsAdded = 0;
                const addedPlurals = new Set();
                for (const [, data] of wordData) {
                    if (data.nominativePlural && !wordData.has(data.nominativePlural) && !addedPlurals.has(data.nominativePlural)) {
                        stmt.run(data.nominativePlural, 1, null, 1);
                        addedPlurals.add(data.nominativePlural);
                        pluralsAdded++;
                    }
                }

                stmt.finalize(() => {
                    inserted += pluralsAdded;
                    console.log(`  (${pluralsAdded} nominative plurals added as standalone entries)`);
                    db.run('COMMIT', () => {
                        console.log(`\r  Inserted ${inserted} words.`);

                        // Print stats
                        db.get('SELECT COUNT(*) as total FROM finnish_words', (err, row) => {
                            console.log(`\nStats:`);
                            console.log(`  Total words: ${row?.total || 0}`);

                            db.get('SELECT COUNT(*) as n FROM finnish_words WHERE is_inflection = 0', (err, row) => {
                                console.log(`  Base words: ${row?.n || 0}`);

                                db.get('SELECT COUNT(*) as n FROM finnish_words WHERE is_inflection = 1', (err, row) => {
                                    console.log(`  Inflections: ${row?.n || 0}`);

                                    db.get('SELECT COUNT(*) as n FROM finnish_words WHERE nominative_plural IS NOT NULL', (err, row) => {
                                        console.log(`  With nominative plural: ${row?.n || 0}`);
                                        console.log('\nDone!');
                                        db.close(() => resolve());
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

async function main() {
    console.log('=== Boggle Warriors: Finnish Word Database Builder ===\n');
    await readJsonl();
    console.log('');
    await writeToDb();
}

main().catch(err => {
    console.error('\nError:', err.message);
    if (err.message.includes('ENOENT')) {
        console.error('\nJSONL file not found. Please download it from:');
        console.error('https://kaikki.org/dictionary/Finnish/kaikki.org-dictionary-Finnish.jsonl');
        console.error(`and place it at: ${INPUT}`);
    }
    process.exit(1);
});
