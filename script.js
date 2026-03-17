document.addEventListener("DOMContentLoaded", () => {
    class BoggleGame {
        constructor() {
            this.initialLetters = ["B", "O", "G", "G", "L", "E", " ", " ", "W", "A", "R", "R", "I", "O", "R", "S"];
            this.finnishDice = [
                "AISPUJ", "AEENEA", "ÄIÖNST", "ANPRSK", "APHSKO",
                "DESRIL", "EIENUS", "HIKNMU", "AKAÄLÄ", "SIOTMU",
                "AJTOTO", "EITOSS", "ELYTTR", "AKITMV", "AILKVY", "ALRNNU"
            ];
            this.englishDice = [
                "AAEEGN", "ABBJOO", "ACHOPS", "AFFKPS", "AOOTTW",
                "CIMOTU", "DEILRX", "DELRUY", "DISTTY", "EEGHNW",
                "EEINSU", "EHRTVW", "EIOSST", "ELRTTY", "HIMNUQ", "HLNNRZ"
            ];

            // DOM elements
            this.boardElement = document.getElementById("board");
            this.timerElement = document.getElementById("timer");
            this.sidebarElement = document.getElementById("sidebar");
            this.selectedWordElement = document.getElementById("selected-word");
            this.newGameButton = document.getElementById("newGame");
            this.timeUpSound = new Audio("sounds/time_up.mp3");
            this.correctAnswerSound = new Audio("sounds/correct_answer.mp3");
            this.incorrectAnswerSound = new Audio("sounds/incorrect_answer.mp3");
            this.tapSound = new Audio("sounds/tap.m4a");
            this.tapSound.volume = 0.5;

            // Game state
            this.timeLeft = 90;
            this.foundWords = new Map(); // word -> { nominativePlural, isInflection, isNominativePlural }
            this.isPaused = false;
            this.currentWord = [];
            this.selectedTiles = [];
            this.timerInterval = null;
            this.countdownInterval = null;
            this.shuffleInterval = null;
            this.isGameOver = false;
            this.invalidWordSubmitted = false;
            this.messageTimeout = null;
            this.isSubmitting = false; // Prevent double submissions
            this.isDragging = false;
            this.dragMoved = false;
            this.touchMoved = false;
            this.swipeCanvas = null;
            this.swipeCtx = null;
            this.pointerX = 0;
            this.pointerY = 0;
            this.pointerActive = false;
            this.boardLetters = [];
            this.validBoardWords = new Set();
            this.totalBoardWords = 0;
            this.maxBoardScore = 0;
            this.boardStatsLoaded = false;
            this.boardStatsError = null;
            this.hasActiveGame = false;

            // Initialize
            this.bindEvents();
            this.initializeBoard();
            this.setInitialBackground();
            this.setBoardLetters(this.initialLetters);
            this.updateModeUI();
            this.updateSidebar();

            document.addEventListener("click", (event) => this.handleOutsideClick(event));
        }

        bindEvents() {
            document.getElementById("newGame").addEventListener("click", () => { 
                this.tapSound.currentTime = 0; 
                this.tapSound.play();
                const isEndMode = this.newGameButton.classList.contains("end-mode");
                if (isEndMode) {
                    this.endGame("manual");
                } else {
                    this.startNewGame();
                }
            });
            document.getElementById("submitWord").addEventListener("click", () => { this.tapSound.currentTime = 0; this.tapSound.play(); this.submitWord(); });

            // Swipe / drag selection
            this.boardElement.addEventListener("mousedown", (e) => this.onMouseDown(e));
            document.addEventListener("mousemove", (e) => this.onMouseMove(e));
            document.addEventListener("mouseup", (e) => this.onMouseUp(e));
            this.boardElement.addEventListener("touchstart", (e) => this.onTouchStart(e), { passive: false });
            this.boardElement.addEventListener("touchmove",  (e) => this.onTouchMove(e),  { passive: false });
            this.boardElement.addEventListener("touchend",   (e) => this.onTouchEnd(e));
            document.addEventListener("touchstart", (e) => this.onOutsideTouchStart(e), { passive: true });
        }

        handleOutsideClick(event) {
            if (this.isGameOver) return;
            const isClickInsideGame = this.boardElement.contains(event.target) ||
                                      event.target.closest("#newGame") ||
                                      event.target.closest("#submitWord") ||
                                      event.target.closest("#endRunBtn") ||
                                      event.target.closest("#leaderboardBtn") ||
                                      event.target.closest("#hamburgerBtn") ||
                                      event.target.closest(".modal-overlay") ||
                                      event.target.closest(".drawer-overlay");
            if (isClickInsideGame) {
                this.resetSelectedTiles();
                this.currentWord = [];
                this.selectedTiles = [];
                this.selectedWordElement.textContent = "";
            }
        }

        initializeBoard() {
            this.boardElement.innerHTML = "";
            for (let row = 0; row < 4; row++) {
                for (let col = 0; col < 4; col++) {
                    const tile = this.createTile(this.initialLetters[row * 4 + col], row, col);
                    this.boardElement.appendChild(tile);
                }
            }
            this.setupSwipeCanvas();
            this.setInitialBackground();
        }

        // ── New game & server check ────────────────────────────────────────

        async startNewGame() {
            this.clearIntervals();
            this.resetBackground();
            this.resetGameState();
            if (currentPlayMode === "zen") {
                await this.startZenGame();
                return;
            }
            this.startCountdown();
        }

        resetGameState() {
            this.timeLeft = 90;
            this.isPaused = false;
            this.isGameOver = false;
            this.isCountdown = false;
            this.invalidWordSubmitted = false;
            this.foundWords = new Map();
            this.currentWord = [];
            this.resetSelectedTiles();
            this.selectedTiles = [];
            this.isSubmitting = false; // Reset submission flag
            this.isDragging = false;
            this.dragMoved = false;
            this.touchMoved = false;
            this.validBoardWords = new Set();
            this.totalBoardWords = 0;
            this.maxBoardScore = 0;
            this.boardStatsLoaded = false;
            this.boardStatsError = null;
            this.hasActiveGame = false;
            this.timerElement.style.color = "";
            this.clearMessage();
            this.boardElement.querySelectorAll(".tile span").forEach(span => {
                span.style.transform = "";
                delete span.dataset.rotation;
            });
            this.updateModeUI();
            this.updateSidebar();
        }

        // ── Countdown & timer ─────────────────────────────────────────────

        startCountdown() {
            this.hasActiveGame = true;
            this.updateModeUI();
            this.isCountdown = true;
            this.boardElement.querySelectorAll(".tile").forEach(t => {
                t.style.animationDelay = `${(Math.random() * 0.35).toFixed(2)}s`;
                t.classList.add("shuffle-shake");
            });
            let countdown = 3;
            this.timerElement.textContent = countdown;
            this.shuffleInterval = setInterval(() => this.shuffleBoard(), 100);
            this.countdownInterval = setInterval(() => {
                countdown--;
                if (countdown <= 0) {
                    this.timerElement.textContent = "Go!";
                    this.endCountdown();
                } else {
                    this.timerElement.textContent = countdown;
                }
            }, 1000);
        }

        async startZenGame() {
            this.hasActiveGame = true;
            this.timerElement.textContent = "Zen";
            this.timerElement.style.color = "";
            this.shuffleBoard();
            this.updateModeUI();
            await this.loadBoardAnalysis();
        }

        async loadBoardAnalysis() {
            if (currentPlayMode !== "zen" || currentLanguage !== "fi") return;

            this.validBoardWords = new Set();
            this.totalBoardWords = 0;
            this.maxBoardScore = 0;
            this.boardStatsLoaded = false;
            this.boardStatsError = null;
            this.updateSidebar();

            try {
                const response = await fetch(`${API}/board-analysis`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ letters: this.boardLetters, lang: currentLanguage })
                });

                if (!response.ok) {
                    throw new Error(`Server error: ${response.status}`);
                }

                const data = await response.json();
                this.validBoardWords = new Set(data.words.map(entry => entry.word));
                this.totalBoardWords = data.totalWords || data.words.length;
                this.maxBoardScore = data.maxScore || 0;
                this.boardStatsLoaded = true;
                console.log(`[Zen] ${this.totalBoardWords} possible words:`, Array.from(this.validBoardWords).sort());
            } catch (error) {
                console.error("Error analyzing board:", error);
                this.boardStatsError = "Unavailable";
            } finally {
                this.updateSidebar();
            }
        }

        endCountdown() {
            this.isCountdown = false;
            this.boardElement.querySelectorAll(".tile").forEach(t => {
                t.classList.remove("shuffle-shake");
                t.style.animationDelay = "";
            });
            clearInterval(this.countdownInterval);
            clearInterval(this.shuffleInterval);
            this.timerElement.textContent = "1:30";
            this.shuffleBoard();
            this.startTimer();
            this.updateModeUI();
        }

        startTimer() {
            this.clearIntervals("timer");
            this.timerInterval = setInterval(() => {
                if (this.timeLeft <= 0) {
                    this.endGame();
                } else {
                    this.updateTimer();
                }
            }, 1000);
        }

        updateTimer() {
            this.timeLeft -= 1;
            const minutes = Math.floor(this.timeLeft / 60);
            const seconds = this.timeLeft % 60;
            this.timerElement.textContent = `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
        }

        endGame(reason = "timeout") {
            if (this.isGameOver) return;

            this.clearIntervals();
            this.hasActiveGame = false;
            this.isGameOver = true;
            this.resetSelectedTiles();
            this.currentWord = [];
            this.selectedTiles = [];

            if (reason === "timeout") {
                this.timerElement.textContent = "Time's up!";
                this.timerElement.style.color = "red";
                this.timeUpSound.play();
                this.setTimeUpBackground();
            } else {
                this.timerElement.textContent = "Finished";
                this.timerElement.style.color = "";
                this.showMessage("Run finished", "#00dd00", 2000);
            }

            this.updateModeUI();
            checkAndPromptScore(this.calculateTotalScore(), this.foundWords.size, currentPlayMode);
        }


        // ── Message helpers ───────────────────────────────────────────────

        showMessage(text, color = "white", autoClearMs = null) {
            if (this.messageTimeout) {
                clearTimeout(this.messageTimeout);
                this.messageTimeout = null;
            }
            this.selectedWordElement.textContent = text;
            this.selectedWordElement.style.color = color;
            if (autoClearMs) {
                this.messageTimeout = setTimeout(() => this.clearMessage(), autoClearMs);
            }
        }

        clearMessage() {
            if (this.messageTimeout) {
                clearTimeout(this.messageTimeout);
                this.messageTimeout = null;
            }
            this.selectedWordElement.textContent = "";
            this.selectedWordElement.style.color = "white";
        }

        updateSelectedWordDisplay() {
            this.selectedWordElement.style.color = "white";
            this.selectedWordElement.textContent = this.currentWord.join("");
            this.drawSelectionPath();
        }

        // ── Tile selection ────────────────────────────────────────────────

        createTile(letter, row, col) {
            const tile = document.createElement("div");
            tile.classList.add("tile");
            const span = document.createElement("span");
            span.textContent = letter;
            tile.appendChild(span);
            tile.dataset.row = row;
            tile.dataset.col = col;
            return tile;
        }

        selectTile(tile) {
            if (this.isGameOver || this.isCountdown) return;

            if (this.invalidWordSubmitted) {
                this.clearMessage();
                this.invalidWordSubmitted = false;
            }

            if (this.selectedTiles.includes(tile)) {
                // Find the index of the clicked tile
                const idx = this.selectedTiles.indexOf(tile);
                // Remove it and everything after it
                const removed = this.selectedTiles.splice(idx);
                this.currentWord.splice(idx);
                removed.forEach(t => t.classList.remove("selected"));
                this.updateSelectedWordDisplay();
                return;
            }

            if (this.selectedTiles.length > 0 && !this.isAdjacent(tile)) return;

            tile.classList.add("selected");
            this.currentWord.push(tile.textContent);
            this.selectedTiles.push(tile);
            this.tapSound.currentTime = 0;
            this.tapSound.play();
            this.updateSelectedWordDisplay();
        }

        isAdjacent(tile) {
            if (this.selectedTiles.length === 0) return true;
            const last = this.selectedTiles[this.selectedTiles.length - 1];
            return (
                Math.abs(parseInt(last.dataset.row) - parseInt(tile.dataset.row)) <= 1 &&
                Math.abs(parseInt(last.dataset.col) - parseInt(tile.dataset.col)) <= 1
            );
        }

        // ── Swipe / drag handlers ─────────────────────────────────────────

        // Returns the tile under (x, y) only if the point is inside its inner
        // 75% hit area, ignoring edge pixels to prevent accidental mis-selections.
        tileAtPoint(x, y) {
            const el = document.elementFromPoint(x, y);
            const tile = el ? el.closest('.tile') : null;
            if (!tile) return null;
            const r = tile.getBoundingClientRect();
            const margin = 0.125; // 12.5% inset on each side = 75% inner area
            const inX = x >= r.left + r.width  * margin && x <= r.right  - r.width  * margin;
            const inY = y >= r.top  + r.height * margin && y <= r.bottom - r.height * margin;
            return (inX && inY) ? tile : null;
        }

        onMouseDown(e) {
            const tile = e.target.closest(".tile");
            if (!tile) return;
            this.isDragging = true;
            this.dragMoved = false;
            this.pointerX = e.clientX;
            this.pointerY = e.clientY;
            this.pointerActive = true;
            this.startSwipe(tile);
        }

        onMouseMove(e) {
            this.pointerX = e.clientX;
            this.pointerY = e.clientY;
            if (!this.isDragging) return;
            this.drawSelectionPath();
            const tile = this.tileAtPoint(e.clientX, e.clientY);
            if (!tile) return;
            const last = this.selectedTiles[this.selectedTiles.length - 1];
            if (tile !== last) {
                this.dragMoved = true;
                this.swipeToTile(tile);
            }
        }

        onMouseUp(e) {
            if (!this.isDragging) return;
            this.isDragging = false;
            this.pointerActive = false;
            if (this.dragMoved) {
                this.submitWord();
            }
        }

        onTouchStart(e) {
            e.preventDefault();
            this.touchMoved = false;
            const touch = e.touches[0];
            this.pointerX = touch.clientX;
            this.pointerY = touch.clientY;
            this.pointerActive = true;
            const el = document.elementFromPoint(touch.clientX, touch.clientY);
            const tile = el ? el.closest(".tile") : null;
            this.startSwipe(tile);
        }

        onTouchMove(e) {
            e.preventDefault();
            const touch = e.touches[0];
            this.pointerX = touch.clientX;
            this.pointerY = touch.clientY;
            this.drawSelectionPath();
            const tile = this.tileAtPoint(touch.clientX, touch.clientY);
            const lenBefore = this.selectedTiles.length;
            this.swipeToTile(tile);
            if (this.selectedTiles.length !== lenBefore) this.touchMoved = true;
        }

        onTouchEnd(e) {
            if (this.isGameOver || this.isCountdown) return;
            this.pointerActive = false;
            // Only auto-submit when the finger swiped across tiles.
            // Single taps just select a tile; the user presses Submit to submit.
            if (!this.touchMoved) return;
            this.touchMoved = false;
            this.submitWord();
        }

        startSwipe(tile) {
            if (!tile) return;
            this.selectTile(tile);
        }

        onOutsideTouchStart(e) {
            if (this.isGameOver) return;
            if (this.selectedTiles.length === 0) return;
            const touch = e.touches[0];
            const el = document.elementFromPoint(touch.clientX, touch.clientY);
            const isInsideBoard = el && this.boardElement.contains(el);
            const isButton = el && (el.closest('#submitWord') || el.closest('#newGame'));
            if (!isInsideBoard && !isButton) {
                this.resetSelectedTiles();
                this.currentWord = [];
                this.selectedTiles = [];
                this.selectedWordElement.textContent = "";
            }
        }

        swipeToTile(tile) {
            if (this.isGameOver || this.isCountdown) return;
            if (!tile) return;
            const last = this.selectedTiles[this.selectedTiles.length - 1];
            if (tile === last) return; // still hovering over the same tile

            // Rubber-band: swiping back to second-to-last deselects the last tile
            const secondToLast = this.selectedTiles[this.selectedTiles.length - 2];
            if (tile === secondToLast) {
                const removed = this.selectedTiles.pop();
                this.currentWord.pop();
                removed.classList.remove("selected");
                this.updateSelectedWordDisplay();
                return;
            }

            // Can't loop back to an already-selected tile
            if (this.selectedTiles.includes(tile)) return;

            // Must be adjacent to the last selected tile
            if (!this.isAdjacent(tile)) return;

            tile.classList.add("selected");
            this.currentWord.push(tile.textContent);
            this.selectedTiles.push(tile);
            this.tapSound.currentTime = 0;
            this.tapSound.play();
            this.updateSelectedWordDisplay();
        }

        // ── Word submission ───────────────────────────────────────────────

        async submitWord() {
            // Prevent double submissions
            if (this.isSubmitting) return;
            this.isSubmitting = true;

            const word = this.currentWord.join("");

            if (word.length < 3) {
                this.animateInvalidWord();
                this.showMessage("Too short — at least 3 letters", "#ff9900", 2000);
                this.incorrectAnswerSound.play();
                setTimeout(() => {
                    this.resetSelectedTiles();
                    this.currentWord = [];
                    this.selectedTiles = [];
                    this.isSubmitting = false;
                }, 300);
                return;
            }

            if (this.foundWords.has(word.toLowerCase())) {
                this.animateInvalidWord();
                this.showMessage("Word already found!", "#ff9900", 2000);
                this.incorrectAnswerSound.play();
                setTimeout(() => {
                    this.resetSelectedTiles();
                    this.currentWord = [];
                    this.selectedTiles = [];
                    this.isSubmitting = false;
                }, 300);
                return;
            }

            this.showMessage("Validating...", "#aaaaaa");

            const result = await this.validateWord(word);

            if (this.isGameOver) {
                this.isSubmitting = false;
                return;
            }

            if (result.error) {
                this.animateInvalidWord();
                this.showMessage("Server is not responding", "#ff4444", 3000);
                this.incorrectAnswerSound.play();
                this.invalidWordSubmitted = true;
                setTimeout(() => {
                    this.resetSelectedTiles();
                    this.currentWord = [];
                    this.selectedTiles = [];
                    this.isSubmitting = false;
                }, 300);
            } else if (result.exists) {
                // Reject base word if its plural is already found
                if (result.nominativePlural && this.foundWords.has(result.nominativePlural)) {
                    this.animateInvalidWord();
                    this.showMessage("Plural already found!", "#ff9900", 2000);
                    this.incorrectAnswerSound.play();
                    this.invalidWordSubmitted = true;
                    setTimeout(() => {
                        this.resetSelectedTiles();
                        this.currentWord = [];
                        this.selectedTiles = [];
                        this.isSubmitting = false;
                    }, 300);
                    return;
                }

                // Play animation on correct word
                this.animateCorrectWord();
                this.correctAnswerSound.play();
                const wordLower = word.toLowerCase();
                this.foundWords.set(wordLower, {
                    nominativePlural: result.nominativePlural,
                    isInflection: result.isInflection,
                    isNominativePlural: result.isNominativePlural
                });
                const points = this.calculateScore(word);
                // Check if this word is the plural of an already-found base word
                const baseEntry = Array.from(this.foundWords.entries())
                    .find(([w, m]) => w !== wordLower && m.nominativePlural === wordLower);
                if (baseEntry) {
                    const extraPoints = points - this.calculateScore(baseEntry[0]);
                    this.showMessage(`Plural +${extraPoints} points`, "#00dd00", 2000);
                } else {
                    this.showMessage(`+${points} points`, "#00dd00", 2000);
                }
                this.selectedWordElement.classList.add('points-popup');
                this.updateSidebar();
                this.invalidWordSubmitted = false;

                // Reset tiles after animation completes
                setTimeout(() => {
                    this.resetSelectedTiles();
                    this.currentWord = [];
                    this.selectedTiles = [];
                    this.isSubmitting = false;
                    this.selectedWordElement.classList.remove('points-popup');
                }, 150);
            } else {
                this.animateInvalidWord();
                this.showMessage(`"${word}" is not a word`, "#ff4444", 2000);
                this.incorrectAnswerSound.play();
                this.invalidWordSubmitted = true;
                setTimeout(() => {
                    this.resetSelectedTiles();
                    this.currentWord = [];
                    this.selectedTiles = [];
                    this.isSubmitting = false;
                }, 300);
            }
        }

        animateCorrectWord() {
            // Apply animation to each tile in the word
            this.selectedTiles.forEach(tile => {
                tile.classList.add('correct-word');
            });
            // Remove animation after it completes (300ms)
            setTimeout(() => {
                this.selectedTiles.forEach(tile => {
                    tile.classList.remove('correct-word');
                });
            }, 150);
        }

        animateInvalidWord() {
            // Apply combined shake + red flash animation to each selected tile
            this.selectedTiles.forEach(tile => {
                tile.classList.add('invalid-word');
            });
            // Remove animation after it completes
            setTimeout(() => {
                this.selectedTiles.forEach(tile => {
                    tile.classList.remove('invalid-word');
                });
            }, 300);
        }

        // Returns { exists, isInflection, nominativePlural, isNominativePlural } or { error: true, message }
        async validateWord(word) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            try {
                const response = await fetch(
                    `https://bogglewarriors-production.up.railway.app/validate-word/${word}?lang=${currentLanguage}`,
                    { signal: controller.signal }
                );
                if (!response.ok) return { error: true, message: `Server error: ${response.status}` };
                const data = await response.json();
                return {
                    exists: data.exists,
                    isInflection: data.isInflection || false,
                    nominativePlural: data.nominativePlural || null,
                    isNominativePlural: data.isNominativePlural || false
                };
            } catch (error) {
                console.error("Error validating word:", error);
                return { error: true, message: error.message };
            } finally {
                clearTimeout(timeout);
            }
        }

        // ── Sidebar & scoring ─────────────────────────────────────────────

        isSuperseded(word) {
            const meta = this.foundWords.get(word);
            if (!meta || meta.isNominativePlural) return false;
            return meta.nominativePlural !== null && this.foundWords.has(meta.nominativePlural);
        }

        getFoundProgressText() {
            if (this.boardStatsError) return this.boardStatsError;
            if (!this.boardStatsLoaded) return "Calculating...";

            const foundCount = Array.from(this.foundWords.keys())
                .filter(word => this.validBoardWords.has(word))
                .length;
            const percentage = this.totalBoardWords === 0
                ? 0
                : Math.round((foundCount / this.totalBoardWords) * 100);

            return `${percentage}% (${foundCount} / ${this.totalBoardWords} words)`;
        }

        updateModeUI() {
            const isZenGameActive = currentPlayMode === "zen" && this.hasActiveGame && !this.isGameOver;
            
            if (isZenGameActive) {
                this.newGameButton.textContent = "End";
                this.newGameButton.classList.add("end-mode");
            } else {
                this.newGameButton.textContent = "New";
                this.newGameButton.classList.remove("end-mode");
            }

            if (!this.hasActiveGame && !this.isGameOver) {
                this.timerElement.textContent = currentPlayMode === "zen" ? "Zen" : "1:30";
            }
        }

        updateSidebar() {
            document.getElementById("totalScore").textContent = this.calculateTotalScore();
            const boardStatsElement = document.getElementById("boardStats");
            const maxBoardScoreElement = document.getElementById("maxBoardScore");
            const foundProgressElement = document.getElementById("foundProgress");
            const foundWordsHeadingElement = document.getElementById("foundWordsHeading");
            const foundWordsCount = this.foundWords.size;

            if (currentPlayMode === "zen") {
                boardStatsElement.classList.remove("hidden");
                maxBoardScoreElement.textContent = this.boardStatsLoaded ? this.maxBoardScore : "...";
                foundProgressElement.classList.add("hidden");
                foundWordsHeadingElement.textContent = "Found Words";
            } else {
                boardStatsElement.classList.add("hidden");
                foundWordsHeadingElement.textContent = `Found Words: ${foundWordsCount}`;
            }

            // Organize found words by letter count
            const words34 = [];
            const words5 = [];
            const words6 = [];
            const words7plus = [];

            Array.from(this.foundWords.keys()).reverse().forEach(word => {
                const wordLen = word.length;
                const score = this.calculateScore(word);
                const displayText = this.isSuperseded(word) 
                    ? `<li><s>${word} - 0</s></li>` 
                    : `<li>${word} - ${score}</li>`;

                if (wordLen === 3 || wordLen === 4) {
                    words34.push(displayText);
                } else if (wordLen === 5) {
                    words5.push(displayText);
                } else if (wordLen === 6) {
                    words6.push(displayText);
                } else if (wordLen >= 7) {
                    words7plus.push(displayText);
                }
            });

            document.getElementById("foundWords-34").innerHTML = words34.join('');
            document.getElementById("foundWords-5").innerHTML = words5.join('');
            document.getElementById("foundWords-6").innerHTML = words6.join('');
            document.getElementById("foundWords-7plus").innerHTML = words7plus.join('');
        }

        calculateScore(word) {
            const l = word.length;
            return l >= 8 ? 11 : l === 7 ? 5 : l === 6 ? 3 : l === 5 ? 2 : l >= 3 ? 1 : 0;
        }

        calculateTotalScore() {
            return Array.from(this.foundWords.keys())
                .filter(w => !this.isSuperseded(w))
                .reduce((t, w) => t + this.calculateScore(w), 0);
        }

        // ── Board ─────────────────────────────────────────────────────────

        setBoardLetters(letters) {
            this.boardLetters = [...letters];
        }

        resetSelectedTiles() {
            this.boardElement.querySelectorAll(".selected").forEach(t => t.classList.remove("selected"));
            if (this.swipeCanvas) this.swipeCanvas.width = this.swipeCanvas.width; // clears canvas
        }

        setupSwipeCanvas() {
            const old = this.boardElement.querySelector('.swipe-canvas');
            if (old) old.remove();
            const canvas = document.createElement('canvas');
            canvas.classList.add('swipe-canvas');
            this.boardElement.appendChild(canvas);
            this.swipeCanvas = canvas;
            this.swipeCtx = canvas.getContext('2d');
        }

        drawSelectionPath() {
            if (!this.swipeCanvas || this.selectedTiles.length === 0) {
                if (this.swipeCanvas) this.swipeCanvas.width = this.swipeCanvas.width;
                return;
            }
            const canvas = this.swipeCanvas;
            const ctx = this.swipeCtx;
            const boardRect = this.boardElement.getBoundingClientRect();
            canvas.width  = boardRect.width;
            canvas.height = boardRect.height;

            const centers = this.selectedTiles.map(tile => {
                const r = tile.getBoundingClientRect();
                return {
                    x: r.left - boardRect.left + r.width  / 2,
                    y: r.top  - boardRect.top  + r.height / 2
                };
            });

            // Connecting line between committed tiles
            if (centers.length >= 2) {
                ctx.beginPath();
                ctx.moveTo(centers[0].x, centers[0].y);
                for (let i = 1; i < centers.length; i++) {
                    ctx.lineTo(centers[i].x, centers[i].y);
                }
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
                ctx.lineWidth   = 40;
                ctx.lineCap     = 'round';
                ctx.lineJoin    = 'round';
                ctx.stroke();
            }

        }

        shuffleBoard() {
            const letters = this.randomizeDice();
            this.setBoardLetters(letters);
            const rotations = [0, 90, 180, 270];
            const tiles = this.boardElement.querySelectorAll(".tile");
            tiles.forEach((tile, i) => {
                const span = tile.querySelector("span");
                span.textContent = letters[i];
                if (groupMode) {
                    const deg = rotations[Math.floor(Math.random() * 4)];
                    span.dataset.rotation = String(deg);
                    span.style.transform = `rotate(${deg}deg)`;
                } else {
                    span.style.transform = "";
                    delete span.dataset.rotation;
                }
            });
        }

        randomizeDice() {
            const diceSet = currentLanguage === 'en' ? this.englishDice : this.finnishDice;
            const dice = [...diceSet];
            for (let i = dice.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [dice[i], dice[j]] = [dice[j], dice[i]];
            }
            return dice.map(die => die[Math.floor(Math.random() * die.length)]);
        }

        // ── Background ────────────────────────────────────────────────────

        setInitialBackground() {
            document.body.classList.add("background");
        }

        setTimeUpBackground() {
            document.body.style.backgroundImage = "url('images/time_up_background.png')";
            document.body.classList.add("time-up-background");
        }

        resetBackground() {
            document.body.style.backgroundImage = "";
            document.body.classList.remove("time-up-background");
            document.body.classList.add("background");
        }

        // ── Intervals ─────────────────────────────────────────────────────

        clearIntervals(type = "all") {
            if (type === "all" || type === "timer") clearInterval(this.timerInterval);
            if (type === "all" || type === "countdown") clearInterval(this.countdownInterval);
            if (type === "all" || type === "shuffle") clearInterval(this.shuffleInterval);
        }
    }

    // ── Overlay logic ──────────────────────────────────────────────────────

    const API = "https://bogglewarriors-production.up.railway.app";

    function openOverlay(id) {
        document.getElementById(id).classList.add("active");
    }
    function closeOverlay(id) {
        document.getElementById(id).classList.remove("active");
    }

    // ── Leaderboard ────────────────────────────────────────────────────────

    let currentLbType = "daily";
    let currentLanguage = "fi";
    let currentPlayMode = "timed";
    let currentVisualMode = "solo";
    let groupMode = false;

    function formatLbDate(unixSeconds) {
        const d = new Date(unixSeconds * 1000);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today - 86400000);
        const entry = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        if (entry.getTime() === today.getTime()) return "Today";
        if (entry.getTime() === yesterday.getTime()) return "Yesterday";
        return d.toLocaleDateString("fi-FI");
    }

    async function fetchLeaderboard(type = "alltime") {
        const list = document.getElementById("leaderboardList");
        list.innerHTML = `<li class="lb-loading">Loading...</li>`;
        try {
            const res = await fetch(`${API}/leaderboard?type=${type}&lang=${currentLanguage}&mode=timed`);
            if (!res.ok) throw new Error("Server error");
            const rows = await res.json();
            if (rows.length === 0) {
                list.innerHTML = `<li class="lb-empty">No scores yet!</li>`;
                return;
            }
            list.innerHTML = rows.map((row, i) => {
            const date = type === 'daily' ? '' : new Date(row.created_at * 1000).toLocaleDateString("fi-FI");
                return `<li class="lb-row">
                    <span class="lb-rank">${i + 1}</span>
                    <span class="lb-name">${escapeHtml(row.nickname)}</span>
                    <span class="lb-score">${row.score}p</span>
                    <span class="lb-words">${row.word_count} words</span>
                    ${date ? `<span class="lb-date">${date}</span>` : ''}
                </li>`;
            }).join("");
        } catch (e) {
            list.innerHTML = `<li class="lb-error">Could not load leaderboard</li>`;
        }
    }

    function escapeHtml(str) {
        return str.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
    }

    function syncGameModeButtons() {
        document.querySelectorAll("[data-game-mode]").forEach(btn => {
            const gameMode = btn.dataset.gameMode;
            const isActive = (gameMode === "zen" && currentPlayMode === "zen") ||
                            (gameMode === "solo" && currentPlayMode === "timed" && currentVisualMode === "solo") ||
                            (gameMode === "group" && currentPlayMode === "timed" && currentVisualMode === "group");
            btn.classList.toggle("active", isActive);
        });
    }

    function syncLanguageButtons() {
        document.querySelectorAll("[data-lang]").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.lang === currentLanguage);
        });
    }



    function updateUnlimitedAvailability() {
        const zenButton = document.getElementById("zenModeBtn");
        const playModeHint = document.getElementById("playModeHint");
        const zenAvailable = currentLanguage === "fi";

        zenButton.disabled = !zenAvailable;
        playModeHint.classList.toggle("hidden", zenAvailable);

        if (!zenAvailable && currentPlayMode === "zen") {
            currentPlayMode = "timed";
            syncPlayModeButtons();
        }
    }

    document.getElementById("leaderboardBtn").addEventListener("click", (e) => {
        e.stopPropagation();
        openOverlay("leaderboardOverlay");
        fetchLeaderboard(currentLbType);
    });
    document.getElementById("leaderboardClose").addEventListener("click", () => {
        closeOverlay("leaderboardOverlay");
    });
    document.getElementById("leaderboardOverlay").addEventListener("click", (e) => {
        if (e.target === e.currentTarget) closeOverlay("leaderboardOverlay");
    });

    // Tab switching
    document.querySelectorAll(".lb-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".lb-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            currentLbType = tab.dataset.type;
            fetchLeaderboard(currentLbType);
        });
    });



    // ── Settings ───────────────────────────────────────────────────────────

    document.getElementById("hamburgerBtn").addEventListener("click", (e) => {
        e.stopPropagation();
        openOverlay("settingsOverlay");
    });
    document.getElementById("settingsClose").addEventListener("click", () => {
        closeOverlay("settingsOverlay");
    });
    document.getElementById("settingsOverlay").addEventListener("click", (e) => {
        if (e.target === e.currentTarget) closeOverlay("settingsOverlay");
    });

    document.querySelectorAll(".settings-option").forEach(btn => {
        btn.addEventListener("click", () => {
            if (btn.dataset.lang) {
                currentLanguage = btn.dataset.lang;
                document.getElementById("language-indicator").textContent = currentLanguage.toUpperCase();
                syncLanguageButtons();
                updateUnlimitedAvailability();

                if (game.hasActiveGame) {
                    closeOverlay("settingsOverlay");
                    game.startNewGame();
                    return;
                }

                game.updateModeUI();
                game.updateSidebar();
                return;
            }

            if (btn.dataset.gameMode) {
                const gameMode = btn.dataset.gameMode;
                if (gameMode === "zen") {
                    currentPlayMode = "zen";
                } else if (gameMode === "solo") {
                    currentPlayMode = "timed";
                    currentVisualMode = "solo";
                } else if (gameMode === "group") {
                    currentPlayMode = "timed";
                    currentVisualMode = "group";
                }
                groupMode = currentVisualMode === "group";
                syncGameModeButtons();

                if (game.hasActiveGame) {
                    closeOverlay("settingsOverlay");
                    game.startNewGame();
                    return;
                }

                game.updateModeUI();
                game.updateSidebar();
                return;
            }
        });
    });

    // ── Nickname / score submit ────────────────────────────────────────────

    let pendingScore = null;

    async function checkAndPromptScore(score, wordCount, mode = currentPlayMode) {
        if (score <= 0 || mode === "zen") return;
        try {
            const [resAll, resDay] = await Promise.all([
                fetch(`${API}/leaderboard/qualifies?score=${score}&type=alltime&lang=${currentLanguage}&mode=timed`),
                fetch(`${API}/leaderboard/qualifies?score=${score}&type=daily&lang=${currentLanguage}&mode=timed`)
            ]);
            const all = await resAll.json();
            const day = await resDay.json();
            if (all.qualifies || day.qualifies) {
                pendingScore = { score, wordCount, mode };
                document.getElementById("nicknameInput").value = "";
                document.getElementById("nicknameError").textContent = "";
                openOverlay("nicknameOverlay");
            }
        } catch (e) {
            console.error("Could not check leaderboard qualification:", e);
        }
    }

    async function submitScore(nickname) {
        if (!pendingScore) return;
        const { score, wordCount, mode } = pendingScore;
        try {
            const res = await fetch(`${API}/scores`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ nickname, score, word_count: wordCount, language: currentLanguage, mode })
            });
            if (!res.ok) throw new Error("Server error");
            pendingScore = null;
            closeOverlay("nicknameOverlay");
        } catch (e) {
            document.getElementById("nicknameError").textContent = "Could not save score, try again.";
        }
    }

    document.getElementById("nicknameSubmit").addEventListener("click", () => {
        const nickname = document.getElementById("nicknameInput").value.trim();
        if (!nickname) {
            document.getElementById("nicknameError").textContent = "Please enter a nickname.";
            return;
        }
        submitScore(nickname);
    });

    document.getElementById("nicknameInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter") document.getElementById("nicknameSubmit").click();
    });

    document.getElementById("nicknameInput").addEventListener("input", (e) => {
        // Enable Save button only if nickname has text
        document.getElementById("nicknameSubmit").disabled = e.target.value.trim() === "";
    });

    document.getElementById("nicknameClose").addEventListener("click", () => {
        pendingScore = null;
        closeOverlay("nicknameOverlay");
    });

    // Don't allow closing nickname overlay by clicking backdrop - user must explicitly Save or close with X button
    // This prevents accidental loss of score

    const game = new BoggleGame();

    syncGameModeButtons();
    syncLanguageButtons();
    updateUnlimitedAvailability();
});