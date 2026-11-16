// dice-sets.js (ESM, used by the server and tests) and dice-sets.browser.js
// (plain script, used by the pages) must expose one and the same definition.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esm from '../../dice-sets.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const browserSrc = readFileSync(join(__dirname, '../../dice-sets.browser.js'), 'utf8');
const fakeWindow = {};
new Function('window', browserSrc)(fakeWindow);
const browser = fakeWindow.DiceSets;

describe('dice sets', () => {
    for (const [name, firstDie] of [['FINNISH_DICE', 'AISPUJ'], ['ENGLISH_DICE', 'AAEEGN']]) {
        it(`${name} has 16 dice of 6 faces, starting with ${firstDie}`, () => {
            expect(esm[name]).toHaveLength(16);
            expect(esm[name].every(die => die.length === 6)).toBe(true);
            expect(esm[name][0]).toBe(firstDie);
        });

        it(`${name} is identical from the ESM and the browser entry points`, () => {
            expect(browser[name]).toEqual(esm[name]);
        });
    }

    it('Finnish dice keep the letters Ä and Ö', () => {
        expect(browser.FINNISH_DICE.join('')).toMatch(/Ä/);
        expect(browser.FINNISH_DICE.join('')).toMatch(/Ö/);
    });
});
