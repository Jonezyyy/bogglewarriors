// Verifies game-utils.browser.js stays in sync with game-utils.js (canonical).
// Loads the browser file's IIFE into a fake `window` and asserts identical
// outputs across a representative input matrix.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as canonical from '../../game-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const browserSrc = readFileSync(join(__dirname, '../../game-utils.browser.js'), 'utf8');

// Evaluate the IIFE with a fake window
const fakeWindow = {};
new Function('window', browserSrc)(fakeWindow);
const browser = fakeWindow.GameUtils;

describe('game-utils.browser mirror', () => {
    it('exposes the expected functions on window.GameUtils', () => {
        expect(typeof browser.calculateScore).toBe('function');
        expect(typeof browser.isSuperseded).toBe('function');
        expect(typeof browser.calculateTotalScore).toBe('function');
        expect(typeof browser.formatTimer).toBe('function');
        expect(typeof browser.buildFoundProgressText).toBe('function');
    });

    it('calculateScore matches canonical for word lengths 2..10', () => {
        for (let n = 2; n <= 10; n++) {
            const w = 'x'.repeat(n);
            expect(browser.calculateScore(w)).toBe(canonical.calculateScore(w));
        }
    });

    it('isSuperseded matches canonical (singular+plural pair)', () => {
        const fw = new Map([
            ['koira',  { nominativePlural: 'koirat', isNominativePlural: false }],
            ['koirat', { nominativePlural: null,     isNominativePlural: true  }],
        ]);
        expect(browser.isSuperseded('koira', fw)).toBe(canonical.isSuperseded('koira', fw));
        expect(browser.isSuperseded('koirat', fw)).toBe(canonical.isSuperseded('koirat', fw));
    });

    it('calculateTotalScore matches canonical', () => {
        const fw = new Map([
            ['koira',  { nominativePlural: 'koirat', isNominativePlural: false }],
            ['koirat', { nominativePlural: null,     isNominativePlural: true  }],
            ['talo',   { nominativePlural: null,     isNominativePlural: false }],
        ]);
        expect(browser.calculateTotalScore(fw)).toBe(canonical.calculateTotalScore(fw));
    });

    it('formatTimer matches canonical', () => {
        for (const s of [0, 9, 10, 59, 60, 90, 125]) {
            expect(browser.formatTimer(s)).toBe(canonical.formatTimer(s));
        }
    });

    it('buildFoundProgressText matches canonical', () => {
        const fw = new Map([['koira', {}], ['talo', {}]]);
        const valid = new Set(['koira', 'talo', 'kissa']);
        expect(browser.buildFoundProgressText(null, true, fw, valid, 3))
            .toBe(canonical.buildFoundProgressText(null, true, fw, valid, 3));
        expect(browser.buildFoundProgressText(null, false, fw, valid, 3))
            .toBe(canonical.buildFoundProgressText(null, false, fw, valid, 3));
        expect(browser.buildFoundProgressText('boom', true, fw, valid, 3))
            .toBe(canonical.buildFoundProgressText('boom', true, fw, valid, 3));
    });
});
