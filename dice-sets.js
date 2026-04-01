// Dice face definitions shared between the browser game and the server.
// Each string represents the 6 faces of one die.
// script.js keeps its own inline copy (cannot use ES imports over file://).
// server-utils.js and daily.js import from here.

export const FINNISH_DICE = [
    "AISPUJ", "AEENEA", "ÄIÖNST", "ANPRSK", "APHSKO",
    "DESRIL", "EIENUS", "HIKNMU", "AKAÄLÄ", "SIOTMU",
    "AJTOTO", "EITOSS", "ELYTTR", "AKITMV", "AILKVY", "ALRNNU"
];

export const ENGLISH_DICE = [
    "AAEEGN", "ABBJOO", "ACHOPS", "AFFKPS", "AOOTTW",
    "CIMOTU", "DEILRX", "DELRUY", "DISTTY", "EEGHNW",
    "EEINSU", "EHRTVW", "EIOSST", "ELRTTY", "HIMNUQ", "HLNNRZ"
];
