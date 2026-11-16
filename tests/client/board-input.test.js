// Tests the DOM-free selection state of board-input.js (loaded as a plain script,
// so we evaluate it against a fake window like game-utils-browser-mirror does).
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../../board-input.js'), 'utf8');
const fakeWindow = {};
new Function('window', src)(fakeWindow);
const { createSelection, isAdjacent } = fakeWindow.BoardInput;

// Board layout (row-major, 4x4):
//  0 1 2 3      a b c d
//  4 5 6 7      e f g h
//  8 9 10 11    i j k l
// 12 13 14 15   m n o p
const LETTERS = 'abcdefghijklmnop'.split('');

describe('isAdjacent', () => {
    it('is true for horizontal, vertical and diagonal neighbours', () => {
        expect(isAdjacent(0, 1)).toBe(true);
        expect(isAdjacent(0, 4)).toBe(true);
        expect(isAdjacent(0, 5)).toBe(true);
        expect(isAdjacent(10, 5)).toBe(true);
    });

    it('is false for tiles two apart', () => {
        expect(isAdjacent(0, 2)).toBe(false);
        expect(isAdjacent(0, 8)).toBe(false);
        expect(isAdjacent(0, 10)).toBe(false);
    });

    it('does not wrap from the end of one row to the start of the next', () => {
        expect(isAdjacent(3, 4)).toBe(false);
        expect(isAdjacent(7, 8)).toBe(false);
    });
});

describe('createSelection', () => {
    let sel;
    beforeEach(() => { sel = createSelection(() => LETTERS); });

    it('starts empty', () => {
        expect(sel.indices()).toEqual([]);
        expect(sel.word()).toBe('');
    });

    it('select adds the first tile anywhere and reports it', () => {
        expect(sel.select(5)).toEqual({ added: [5], removed: [] });
        expect(sel.word()).toBe('f');
    });

    it('select extends to an adjacent tile and builds the word', () => {
        sel.select(0);
        sel.select(1);
        sel.select(6);
        expect(sel.indices()).toEqual([0, 1, 6]);
        expect(sel.word()).toBe('abg');
    });

    it('select ignores a non-adjacent tile', () => {
        sel.select(0);
        expect(sel.select(10)).toEqual({ added: [], removed: [] });
        expect(sel.indices()).toEqual([0]);
    });

    it('select on an already selected tile truncates from that tile onwards', () => {
        sel.select(0); sel.select(1); sel.select(2); sel.select(3);
        expect(sel.select(1)).toEqual({ added: [], removed: [1, 2, 3] });
        expect(sel.indices()).toEqual([0]);
        expect(sel.word()).toBe('a');
    });

    it('swipe adds an adjacent unselected tile', () => {
        sel.select(0);
        expect(sel.swipe(1)).toEqual({ added: [1], removed: [] });
    });

    it('swipe onto the current last tile does nothing', () => {
        sel.select(0); sel.swipe(1);
        expect(sel.swipe(1)).toEqual({ added: [], removed: [] });
        expect(sel.indices()).toEqual([0, 1]);
    });

    it('swipe back onto the second-to-last tile removes only the last tile', () => {
        sel.select(0); sel.swipe(1); sel.swipe(2);
        expect(sel.swipe(1)).toEqual({ added: [], removed: [2] });
        expect(sel.indices()).toEqual([0, 1]);
    });

    it('swipe onto an earlier selected tile does nothing', () => {
        sel.select(0); sel.swipe(1); sel.swipe(2);
        expect(sel.swipe(0)).toEqual({ added: [], removed: [] });
        expect(sel.indices()).toEqual([0, 1, 2]);
    });

    it('swipe onto a non-adjacent tile does nothing', () => {
        sel.select(0);
        expect(sel.swipe(15)).toEqual({ added: [], removed: [] });
    });

    it('clear removes everything and reports what was removed', () => {
        sel.select(0); sel.swipe(1);
        expect(sel.clear()).toEqual({ added: [], removed: [0, 1] });
        expect(sel.indices()).toEqual([]);
        expect(sel.word()).toBe('');
    });

    it('captures a tile letter when selected, so later letter changes do not alter the word', () => {
        const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p'];
        const s = createSelection(() => letters);
        s.select(0); s.swipe(1);
        letters[1] = 'z';
        expect(s.word()).toBe('ab');
    });
});
