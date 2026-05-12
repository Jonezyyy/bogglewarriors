// Browser-loadable mirror of game-utils.js — exposes window.GameUtils so that
// script.js and daily.js (loaded as plain scripts, NOT modules) can share a
// single implementation of scoring + plural-supersede logic.
//
// IMPORTANT: keep this file in sync with game-utils.js (the ESM canonical
// version used by the server and tests). The body below is intentionally
// identical to game-utils.js. The vitest suite has tests that exercise the
// canonical version.
(function (root) {
    function calculateScore(word) {
        const l = word.length;
        return l >= 8 ? 11 : l === 7 ? 5 : l === 6 ? 3 : l === 5 ? 2 : l >= 3 ? 1 : 0;
    }

    function isSuperseded(word, foundWords) {
        const meta = foundWords.get(word);
        if (!meta || meta.isNominativePlural) return false;
        return meta.nominativePlural !== null && foundWords.has(meta.nominativePlural);
    }

    function calculateTotalScore(foundWords) {
        return Array.from(foundWords.keys())
            .filter(w => !isSuperseded(w, foundWords))
            .reduce((t, w) => t + calculateScore(w), 0);
    }

    function formatTimer(totalSeconds) {
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
    }

    function buildFoundProgressText(boardStatsError, boardStatsLoaded, foundWords, validBoardWords, totalBoardWords) {
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

    root.GameUtils = {
        calculateScore,
        isSuperseded,
        calculateTotalScore,
        formatTimer,
        buildFoundProgressText,
    };
})(typeof window !== 'undefined' ? window : globalThis);
