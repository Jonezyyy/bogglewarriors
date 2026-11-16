// Dice face definitions for the server and tests (ES module).
// The data lives in dice-sets.browser.js, a plain script the pages also load,
// so the server and the browser can never drift apart. Importing it for its
// side effect sets globalThis.DiceSets.
import './dice-sets.browser.js';

export const { FINNISH_DICE, ENGLISH_DICE } = globalThis.DiceSets;
