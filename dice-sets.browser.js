// Single source of truth for the dice faces.
// Plain script (no ES modules) so the pages can load it with <script src>;
// it sets window.DiceSets in browsers and globalThis.DiceSets in Node.
// dice-sets.js imports this file and re-exports the same arrays for the server.
//
// Each string holds the 6 faces of one die.
(function (root) {
    const FINNISH_DICE = [
        "AISPUJ", "AEENEA", "ÄIÖNST", "ANPRSK", "APHSKO",
        "DESRIL", "EIENUS", "HIKNMU", "AKAÄLÄ", "SIOTMU",
        "AJTOTO", "EITOSS", "ELYTTR", "AKITMV", "AILKVY", "ALRNNU"
    ];

    const ENGLISH_DICE = [
        "AAEEGN", "ABBJOO", "ACHOPS", "AFFKPS", "AOOTTW",
        "CIMOTU", "DEILRX", "DELRUY", "DISTTY", "EEGHNW",
        "EEINSU", "EHRTVW", "EIOSST", "ELRTTY", "HIMNUQ", "HLNNRZ"
    ];

    root.DiceSets = { FINNISH_DICE, ENGLISH_DICE };
})(typeof window !== 'undefined' ? window : globalThis);
