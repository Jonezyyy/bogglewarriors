// Pure game-logic utilities — no DOM, no browser APIs.
// Shared by script.js (browser) and the test suite (Node/Vitest).

/**
 * Score for a single word.
 * @param {string} word
 * @returns {number}
 */
export function calculateScore(word) {
    const l = word.length;
    return l >= 8 ? 11 : l === 7 ? 5 : l === 6 ? 3 : l === 5 ? 2 : l >= 3 ? 1 : 0;
}

/**
 * Whether a word in the found-words map is superseded by its nominative plural.
 * A base word is superseded when:
 *  - it is NOT itself a nominative plural, AND
 *  - it has a known nominativePlural, AND
 *  - that plural has also been found.
 *
 * @param {string} word
 * @param {Map<string, {nominativePlural: string|null, isNominativePlural: boolean}>} foundWords
 * @returns {boolean}
 */
export function isSuperseded(word, foundWords) {
    const meta = foundWords.get(word);
    if (!meta || meta.isNominativePlural) return false;
    return meta.nominativePlural !== null && foundWords.has(meta.nominativePlural);
}

/**
 * Sum of scores for all non-superseded found words.
 * @param {Map<string, {nominativePlural: string|null, isNominativePlural: boolean}>} foundWords
 * @returns {number}
 */
export function calculateTotalScore(foundWords) {
    return Array.from(foundWords.keys())
        .filter(w => !isSuperseded(w, foundWords))
        .reduce((t, w) => t + calculateScore(w), 0);
}

/**
 * Validate a word using the local board-analysis metadata (fast path).
 * Returns null when board analysis is not yet loaded — caller should fall
 * back to the server endpoint in that case.
 *
 * @param {string} word  Raw word as typed (will be lowercased internally)
 * @param {boolean} boardStatsLoaded
 * @param {Map<string, {nominativePlural: string|null, isNominativePlural: boolean}>} validBoardWordsMetadata
 * @returns {{ exists: boolean, nominativePlural: string|null, isNominativePlural: boolean }|null}
 */
export function validateWordLocal(word, boardStatsLoaded, validBoardWordsMetadata) {
    if (!boardStatsLoaded) return null;
    const wordLower = word.toLowerCase();
    const meta = validBoardWordsMetadata.get(wordLower);
    if (meta) {
        return { exists: true, isInflection: false, nominativePlural: meta.nominativePlural, isNominativePlural: meta.isNominativePlural };
    }
    return { exists: false };
}

/**
 * Format a total-seconds value into "M:SS" display string.
 * @param {number} totalSeconds
 * @returns {string}  e.g. 90 → "1:30", 9 → "0:09", 0 → "0:00"
 */
export function formatTimer(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

/**
 * Build the board progress string shown in the Zen mode sidebar.
 *
 * @param {string|null} boardStatsError
 * @param {boolean} boardStatsLoaded
 * @param {Map<string, unknown>} foundWords
 * @param {Set<string>} validBoardWords
 * @param {number} totalBoardWords
 * @returns {string}
 */
export function buildFoundProgressText(boardStatsError, boardStatsLoaded, foundWords, validBoardWords, totalBoardWords) {
    if (boardStatsError) return boardStatsError;
    if (!boardStatsLoaded) return "Calculating...";
    const foundCount = Array.from(foundWords.keys())
        .filter(word => validBoardWords.has(word))
        .length;
    const percentage = totalBoardWords === 0
        ? 0
        : Math.round((foundCount / totalBoardWords) * 100);
    return `${percentage}% (${foundCount} / ${totalBoardWords} words)`;
}

/**
 * Shuffle a dice set (Fisher-Yates) and pick one random face from each die.
 *
 * @param {string[]} diceSet  16 strings, each containing the faces of one die
 * @returns {string[]}  16 single-character strings
 */
export function rollDice(diceSet) {
    const dice = [...diceSet];
    for (let i = dice.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [dice[i], dice[j]] = [dice[j], dice[i]];
    }
    return dice.map(die => die[Math.floor(Math.random() * die.length)]);
}
