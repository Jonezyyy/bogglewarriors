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

const VALID_LETTERS = new Set('abcdefghijklmnoprstuvyzäö');

// Max occurrences = number of dice containing that letter
const MAX_LETTER_COUNT = {
    'a': 9, 'd': 1, 'e': 5, 'h': 2, 'i': 9,
    'j': 2, 'k': 6, 'l': 5, 'm': 3, 'n': 6,
    'o': 4, 'p': 3, 'r': 4, 's': 8, 't': 6,
    'u': 5, 'v': 2, 'y': 2, 'ä': 2, 'ö': 1
};

const FINNISH_VOWELS = new Set('aeiouäöy');

function isValidForBoggle(word) {
    if (word.length < 3 || word.length > 16) return false;
    let hasVowel = false;
    const counts = {};
    for (const ch of word) {
        if (!VALID_LETTERS.has(ch)) return false;
        if (FINNISH_VOWELS.has(ch)) hasVowel = true;
        counts[ch] = (counts[ch] || 0) + 1;
        const max = MAX_LETTER_COUNT[ch];
        if (max !== undefined && counts[ch] > max) return false;
    }
    return hasVowel;
}

// ── Data accumulator ───────────────────────────────────────────────────
// Merges multiple JSONL entries for the same word (different POS)
const wordData = new Map();

// Parts of speech accepted for gameplay
const ALLOWED_POS = new Set(['noun', 'verb', 'adj', 'adv', 'pron', 'num']);

// Reject entries/forms marked with these tags
const REJECT_TAGS = new Set([
    'proper-noun',
    'given-name',
    'surname',
    'place-name',
    'archaic',
    'obsolete',
    'historical',
    'dated',
    'dialectal',
    'regional',
    'onomatopoeia',
    'abbreviation',
    'acronym',
    'initialism',
    'alt-of',
    'alternative',
    'colloquial',
    'informal',
    'slang'
]);

function hasRejectedTag(tags) {
    if (!Array.isArray(tags)) return false;
    return tags.some(tag => REJECT_TAGS.has(String(tag).toLowerCase()));
}

function hasRejectedSenseTag(senses) {
    if (!Array.isArray(senses)) return false;
    return senses.some(sense => hasRejectedTag(sense?.tags));
}


function normalizeWord(raw) {
    if (typeof raw !== 'string') return null;
    const word = raw.trim().toLowerCase();
    return isValidForBoggle(word) ? word : null;
}

function upsertWord(word, updates = {}) {
    if (!word) return;
    const existing = wordData.get(word);
    if (existing) {
        if (updates.isBase) existing.isBase = true;
        if (updates.isNominativePlural) existing.isNominativePlural = true;
        if (updates.nominativePlural && !existing.nominativePlural) {
            existing.nominativePlural = updates.nominativePlural;
        }
        return;
    }

    wordData.set(word, {
        isBase: !!updates.isBase,
        nominativePlural: updates.nominativePlural || null,
        isNominativePlural: !!updates.isNominativePlural
    });
}

function processEntry(entry) {
    // Support both Finnish-only dump and raw all-languages dump
    if (entry.lang_code && entry.lang_code !== 'fi') return;

    // Rule 2: accept only configured POS values
    const pos = String(entry.pos || '').toLowerCase();
    if (!ALLOWED_POS.has(pos)) return;

    // Rule 3: reject if any sense-level tags match rejection tags
    if (hasRejectedSenseTag(entry.senses)) return;

    // Accept lemma/base word from entry.word
    const baseWord = normalizeWord(entry.word || '');
    if (!baseWord) return;

    let nominativePlural = null;

    const extractForms = pos === 'noun' || pos === 'adj';
    if (extractForms && Array.isArray(entry.forms)) {
        for (const form of entry.forms) {
            if (!form) continue;

            const tags = Array.isArray(form.tags)
                ? form.tags.map(tag => String(tag).toLowerCase())
                : [];
            const isNomPluralForm = tags.includes('nominative') && tags.includes('plural');
            const isCompSuper = tags.includes('comparative') || tags.includes('superlative');

            // noun: nominative plural only; adj: nominative plural + comparative/superlative
            if (!isNomPluralForm && !(pos === 'adj' && isCompSuper)) continue;

            const normalizedForm = normalizeWord(form.form || '');
            if (!normalizedForm) continue;

            if (isNomPluralForm) {
                if (!nominativePlural) nominativePlural = normalizedForm;
                upsertWord(normalizedForm, { isNominativePlural: true });
            } else {
                upsertWord(normalizedForm);
            }
        }
    }

    upsertWord(baseWord, { isBase: true, nominativePlural });
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
