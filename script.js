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
            this.timeUpSound = new Audio("sounds/time_up.mp3");
            this.correctAnswerSound = new Audio("sounds/correct_answer.mp3");
            this.incorrectAnswerSound = new Audio("sounds/incorrect_answer.mp3");

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

            // Initialize
            this.bindEvents();
            this.initializeBoard();
            this.setInitialBackground();

            document.addEventListener("click", (event) => this.handleOutsideClick(event));
        }

        bindEvents() {
            document.getElementById("newGame").addEventListener("click", () => this.startNewGame());
            document.getElementById("submitWord").addEventListener("click", () => this.submitWord());
        }

        handleOutsideClick(event) {
            if (this.isGameOver) return;
            const isClickInsideGame = this.boardElement.contains(event.target) ||
                                      event.target.closest("#newGame") ||
                                      event.target.closest("#submitWord") ||
                                      event.target.closest("#leaderboardBtn") ||
                                      event.target.closest("#settingsBtn") ||
                                      event.target.closest(".modal-overlay");
            if (!isClickInsideGame) {
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
            this.setInitialBackground();
        }

        // ── New game & server check ────────────────────────────────────────

        async startNewGame() {
            this.clearIntervals();
            this.resetBackground();
            this.resetGameState();

            this.showMessage("Connecting...", "#aaaaaa");
            // Use a universal test word that exists in both languages
            const testWord = currentLanguage === 'en' ? 'cat' : 'kissa';
            const result = await this.validateWord(testWord);
            if (result.error) {
                this.showMessage("Server not responding", "#ff4444");
                return;
            }

            this.clearMessage();
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
            this.updateSidebar();
            this.timerElement.style.color = "";
            this.clearMessage();
        }

        // ── Countdown & timer ─────────────────────────────────────────────

        startCountdown() {
            this.isCountdown = true;
            let countdown = 3;
            this.shuffleInterval = setInterval(() => this.shuffleBoard(), 100);
            this.countdownInterval = setInterval(() => {
                this.timerElement.textContent = countdown > 0 ? countdown : "Go!";
                if (countdown-- <= 0) this.endCountdown();
            }, 1000);
        }

        endCountdown() {
            this.isCountdown = false;
            clearInterval(this.countdownInterval);
            clearInterval(this.shuffleInterval);
            this.timerElement.textContent = "1:30";
            this.shuffleBoard();
            this.startTimer();
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

        endGame() {
            clearInterval(this.timerInterval);
            this.timerElement.textContent = "Time's up!";
            this.timerElement.style.color = "red";
            this.isGameOver = true;
            this.timeUpSound.play();
            this.setTimeUpBackground();
            checkAndPromptScore(this.calculateTotalScore(), this.foundWords.size);
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
        }

        // ── Tile selection ────────────────────────────────────────────────

        createTile(letter, row, col) {
            const tile = document.createElement("div");
            tile.classList.add("tile");
            tile.textContent = letter;
            tile.dataset.row = row;
            tile.dataset.col = col;
            tile.addEventListener("click", () => this.selectTile(tile));
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

        updateSidebar() {
            document.getElementById("totalScore").textContent = this.calculateTotalScore();
            document.getElementById("foundWordsList").innerHTML =
                Array.from(this.foundWords.keys()).reverse()
                    .map(word => this.isSuperseded(word)
                        ? `<li><s>${word} - 0</s></li>`
                        : `<li>${word} - ${this.calculateScore(word)}</li>`)
                    .join('');
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

        resetSelectedTiles() {
            this.boardElement.querySelectorAll(".selected").forEach(t => t.classList.remove("selected"));
        }

        shuffleBoard() {
            const letters = this.randomizeDice();
            const tiles = this.boardElement.querySelectorAll(".tile");
            tiles.forEach((tile, i) => {
                tile.textContent = letters[i];
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
            const res = await fetch(`${API}/leaderboard?type=${type}&lang=${currentLanguage}`);
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

    document.getElementById("settingsBtn").addEventListener("click", (e) => {
        e.stopPropagation();
        openOverlay("settingsOverlay");
    });
    document.getElementById("settingsClose").addEventListener("click", () => {
        closeOverlay("settingsOverlay");
    });
    document.getElementById("settingsOverlay").addEventListener("click", (e) => {
        if (e.target === e.currentTarget) closeOverlay("settingsOverlay");
    });

    document.querySelectorAll(".settings-options").forEach(group => {
        group.querySelectorAll(".settings-option").forEach(btn => {
            btn.addEventListener("click", () => {
                group.querySelectorAll(".settings-option").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");

                // Update language if this is the language group
                if (btn.dataset.lang) {
                    currentLanguage = btn.dataset.lang;
                    // Update language indicator in top bar
                    document.getElementById("language-indicator").textContent = currentLanguage.toUpperCase();
                    // If a game is currently running, restart it with the new language
                    if (game.timerInterval !== null) {
                        closeOverlay("settingsOverlay");
                        game.startNewGame();
                    }
                }

                // Update game mode if this is the mode group
                if (btn.dataset.group) {
                    currentGameMode = btn.dataset.group;
                }
            });
        });
    });

    // ── Nickname / score submit ────────────────────────────────────────────

    let pendingScore = null;

    async function checkAndPromptScore(score, wordCount) {
        if (score <= 0) return;
        try {
            // Check both alltime and weekly in parallel
            const [resAll, resDay] = await Promise.all([
                fetch(`${API}/leaderboard/qualifies?score=${score}&type=alltime&lang=${currentLanguage}`),
                fetch(`${API}/leaderboard/qualifies?score=${score}&type=daily&lang=${currentLanguage}`)
            ]);
            const all = await resAll.json();
            const day = await resDay.json();
            if (all.qualifies || day.qualifies) {
                pendingScore = { score, wordCount };
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
        const { score, wordCount } = pendingScore;
        try {
            const res = await fetch(`${API}/scores`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ nickname, score, word_count: wordCount, language: currentLanguage })
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
});