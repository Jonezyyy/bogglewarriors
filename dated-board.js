// Dated-board module: one board per Helsinki date, generated deterministically,
// analysed once and persisted. Shared by Daily Challenge and Warrior Mode, which
// differ only in table name and seed offset.
//
// Interface:
//   createDatedBoards({ scoresDb, sanakirjaCache, table, diceSet, seedOffset? })
//     -> { boardFor(date), isValidDate(str), closesAt(date), db: { get, all, run } }
//
// Invariants: `table` must already exist with columns
//   date (PK), letters, analyzed_words, created_at.
// Side effects: boardFor() inserts a row on first request for a date.

import { generateDailyBoard, analyzeFinnishBoard } from './server-utils.js';

export function createDatedBoards({ scoresDb, sanakirjaCache, table, diceSet, seedOffset = 0 }) {
    const db = {
        get: (sql, params = []) => new Promise((resolve, reject) => {
            scoresDb.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
        }),
        all: (sql, params = []) => new Promise((resolve, reject) => {
            scoresDb.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
        }),
        /** Resolves with { lastID, changes }. */
        run: (sql, params = []) => new Promise((resolve, reject) => {
            scoresDb.run(sql, params, function (err) {
                err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes });
            });
        }),
    };

    /** Get the stored board for a date, generating and persisting it if missing. */
    async function boardFor(date) {
        const existing = await db.get(
            `SELECT date, letters, analyzed_words FROM ${table} WHERE date = ?`, [date]
        );
        if (existing) {
            return {
                date: existing.date,
                letters: JSON.parse(existing.letters),
                analyzedWords: JSON.parse(existing.analyzed_words),
            };
        }

        const letters = generateDailyBoard(date, diceSet, seedOffset);

        if (!sanakirjaCache) throw new Error('Dictionary cache unavailable');
        const analysis = analyzeFinnishBoard(letters, sanakirjaCache);

        await db.run(
            `INSERT OR IGNORE INTO ${table} (date, letters, analyzed_words, created_at) VALUES (?, ?, ?, ?)`,
            [date, JSON.stringify(letters), JSON.stringify(analysis), Math.floor(Date.now() / 1000)]
        );

        return { date, letters, analyzedWords: analysis };
    }

    /** Valid when the string is YYYY-MM-DD and parses as a date. */
    function isValidDate(str) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
        const d = new Date(str + 'T00:00:00');
        return !isNaN(d.getTime());
    }

    function helsinkiStartOfDay(dateStr) {
        const d = new Date(
            new Date(dateStr + 'T00:00:00').toLocaleString('en-US', { timeZone: 'Europe/Helsinki' })
        );
        return Math.floor(d.getTime() / 1000);
    }

    /** ISO timestamp for when the date's challenge closes (Helsinki midnight). */
    function closesAt(dateStr) {
        return new Date((helsinkiStartOfDay(dateStr) + 86400) * 1000).toISOString();
    }

    return { boardFor, isValidDate, closesAt, db };
}
