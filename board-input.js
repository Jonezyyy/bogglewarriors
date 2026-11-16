// Board-input module: tile selection, swipe/drag/touch handling and the selection
// path canvas for a 4x4 Boggle board. Shared by daily.js and warrior.js.
// Loaded as a plain script (no ES modules), exposes window.BoardInput.
//
// Interface
//   BoardInput.isAdjacent(a, b)             -> boolean   (tile indices 0..15, row-major)
//   BoardInput.createSelection(getLetters)  -> DOM-free selection state:
//       select(i) / swipe(i) / clear() each return { added: number[], removed: number[] }
//       indices() -> number[]   word() -> string (letters captured when selected)
//   BoardInput.mount({ boardEl, selectedWordEl, getLetters, isLocked, isOver,
//                      onSwipeEnd, onTileAdded, keepSelectionOn })
//       -> { render(), clear(), word(), indices() }
//
// Invariants: tile elements carry data-index (0..15) and class "tile"; "selected"
// and aria-pressed track the selection. Listeners are bound once, at mount().
// Side effects: mutates boardEl's children, draws on a canvas inside boardEl,
// writes selectedWordEl's text/colour.
(function (root) {
    const SIZE = 4;

    function isAdjacent(a, b) {
        const ar = Math.floor(a / SIZE), ac = a % SIZE;
        const br = Math.floor(b / SIZE), bc = b % SIZE;
        return Math.abs(ar - br) <= 1 && Math.abs(ac - bc) <= 1;
    }

    const NOTHING = () => ({ added: [], removed: [] });

    function createSelection(getLetters) {
        let picked = [];   // tile indices
        let letters = [];  // letter captured at selection time

        function push(i) {
            picked.push(i);
            letters.push(getLetters()[i].toLowerCase());
            return { added: [i], removed: [] };
        }

        function dropFrom(position) {
            const removed = picked.splice(position);
            letters.splice(position);
            return { added: [], removed };
        }

        return {
            indices: () => picked.slice(),
            word: () => letters.join(''),

            /** Tap/click: toggles back to an already selected tile, otherwise extends. */
            select(i) {
                const at = picked.indexOf(i);
                if (at !== -1) return dropFrom(at);
                if (picked.length > 0 && !isAdjacent(picked[picked.length - 1], i)) return NOTHING();
                return push(i);
            },

            /** Drag/swipe over a tile: extends, or rubber-bands back one tile. */
            swipe(i) {
                if (picked.length > 0) {
                    if (i === picked[picked.length - 1]) return NOTHING();
                    if (i === picked[picked.length - 2]) return dropFrom(picked.length - 1);
                    if (picked.includes(i)) return NOTHING();
                    if (!isAdjacent(picked[picked.length - 1], i)) return NOTHING();
                }
                return push(i);
            },

            clear() {
                return dropFrom(0);
            },
        };
    }

    function mount(opts) {
        const { boardEl, selectedWordEl, getLetters } = opts;
        const isLocked = opts.isLocked || (() => false);
        const isOver = opts.isOver || (() => false);
        const onSwipeEnd = opts.onSwipeEnd || (() => {});
        const onTileAdded = opts.onTileAdded || (() => {});
        const keepSelectionOn = opts.keepSelectionOn || null;

        const selection = createSelection(getLetters);
        let tiles = [];
        let canvas = null;
        let ctx = null;
        let boardRect = null;
        let isDragging = false;
        let dragMoved = false;
        let touchMoved = false;
        let rafPending = false;

        const indexOf = tile => parseInt(tile.dataset.index, 10);

        function centerOf(tile) {
            const r = tile.getBoundingClientRect();
            const b = boardRect;
            return { x: r.left - b.left + r.width * 0.5, y: r.top - b.top + r.height * 0.5 };
        }

        function clearCanvas() {
            if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        function drawSelectionPath() {
            const picked = selection.indices();
            if (!canvas || picked.length === 0) { clearCanvas(); return; }
            const boardR = boardRect || boardEl.getBoundingClientRect();
            if (canvas.width !== boardR.width || canvas.height !== boardR.height) {
                canvas.width = boardR.width;
                canvas.height = boardR.height;
            } else {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
            if (picked.length < 2) return;
            const centers = picked.map(i => centerOf(tiles[i]));
            ctx.beginPath();
            ctx.moveTo(centers[0].x, centers[0].y);
            for (let i = 1; i < centers.length; i++) ctx.lineTo(centers[i].x, centers[i].y);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
            ctx.lineWidth = 40;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();
        }

        function updateDisplay() {
            selectedWordEl.style.color = 'white';
            selectedWordEl.textContent = selection.word().toUpperCase();
            drawSelectionPath();
        }

        function applyChange(change) {
            change.removed.forEach(i => {
                tiles[i].classList.remove('selected');
                tiles[i].setAttribute('aria-pressed', 'false');
            });
            change.added.forEach(i => {
                tiles[i].classList.add('selected');
                tiles[i].setAttribute('aria-pressed', 'true');
                onTileAdded(i);
            });
            if (change.added.length || change.removed.length) updateDisplay();
        }

        // Returns the tile under (x, y) only if inside its inner 75% hit area.
        function tileAtPoint(x, y) {
            const el = document.elementFromPoint(x, y);
            const tile = el ? el.closest('.tile') : null;
            if (!tile) return null;
            const r = tile.getBoundingClientRect();
            const margin = 0.125;
            const inX = x >= r.left + r.width * margin && x <= r.right - r.width * margin;
            const inY = y >= r.top + r.height * margin && y <= r.bottom - r.height * margin;
            return (inX && inY) ? tile : null;
        }

        function selectTile(tile) {
            if (isLocked()) return;
            applyChange(selection.select(indexOf(tile)));
        }

        function swipeToTile(tile) {
            if (isLocked() || !tile) return;
            applyChange(selection.swipe(indexOf(tile)));
        }

        function clear() {
            applyChange(selection.clear());
            clearCanvas();
            selectedWordEl.textContent = '';
            selectedWordEl.style.color = 'white';
        }

        function bindEvents() {
            boardEl.addEventListener('mousedown', e => {
                const tile = e.target.closest('.tile');
                if (!tile) return;
                isDragging = true;
                dragMoved = false;
                selectTile(tile);
            });
            boardEl.addEventListener('mousemove', e => {
                if (!isDragging) return;
                drawSelectionPath();
                const tile = tileAtPoint(e.clientX, e.clientY);
                if (!tile) return;
                const picked = selection.indices();
                if (indexOf(tile) !== picked[picked.length - 1]) {
                    dragMoved = true;
                    swipeToTile(tile);
                }
            });
            document.addEventListener('mouseup', () => {
                if (!isDragging) return;
                isDragging = false;
                if (dragMoved) onSwipeEnd();
            });
            boardEl.addEventListener('touchstart', e => {
                e.preventDefault();
                touchMoved = false;
                const touch = e.touches[0];
                const el = document.elementFromPoint(touch.clientX, touch.clientY);
                const tile = el ? el.closest('.tile') : null;
                if (tile) selectTile(tile);
            }, { passive: false });
            boardEl.addEventListener('touchmove', e => {
                e.preventDefault();
                const touch = e.touches[0];
                const tile = tileAtPoint(touch.clientX, touch.clientY);
                const before = selection.indices().length;
                swipeToTile(tile);
                if (selection.indices().length !== before) touchMoved = true;
                if (!rafPending) {
                    rafPending = true;
                    requestAnimationFrame(() => { drawSelectionPath(); rafPending = false; });
                }
            }, { passive: false });
            boardEl.addEventListener('touchend', () => {
                if (isLocked()) return;
                if (!touchMoved) return;
                touchMoved = false;
                onSwipeEnd();
            });
            // Tapping outside the board (and the submit button) drops the selection.
            document.addEventListener('touchstart', e => {
                if (isOver()) return;
                if (selection.indices().length === 0) return;
                const touch = e.touches[0];
                const el = document.elementFromPoint(touch.clientX, touch.clientY);
                const insideBoard = el && boardEl.contains(el);
                const onKeeper = keepSelectionOn && el && el.closest(keepSelectionOn);
                if (!insideBoard && !onKeeper) clear();
            }, { passive: true });

            new ResizeObserver(() => { boardRect = boardEl.getBoundingClientRect(); }).observe(boardEl);
        }

        function render() {
            const letters = getLetters();
            boardEl.innerHTML = '';
            tiles = [];
            for (let i = 0; i < SIZE * SIZE; i++) {
                const tile = document.createElement('div');
                tile.classList.add('tile');
                tile.setAttribute('role', 'gridcell');
                tile.setAttribute('aria-pressed', 'false');
                tile.setAttribute('aria-label', letters[i].toUpperCase());
                const span = document.createElement('span');
                span.textContent = letters[i].toUpperCase();
                tile.appendChild(span);
                tile.dataset.index = i;
                boardEl.appendChild(tile);
                tiles.push(tile);
            }
            canvas = document.createElement('canvas');
            canvas.classList.add('swipe-canvas');
            boardEl.insertBefore(canvas, boardEl.firstChild);
            ctx = canvas.getContext('2d');
            boardRect = boardEl.getBoundingClientRect();
            selection.clear();
        }

        bindEvents();

        return { render, clear, word: selection.word, indices: selection.indices };
    }

    root.BoardInput = { isAdjacent, createSelection, mount };
})(typeof window !== 'undefined' ? window : globalThis);
