document.addEventListener("DOMContentLoaded", () => {
    const API_BASE = "https://bogglewarriors-production.up.railway.app";

    class BoggleGame {
        constructor() {
            this.initialLetters = ["B", "O", "G", "G", "L", "E", " ", " ", "W", "A", "R", "R", "I", "O", "R", "S"];
            this.finnishDice = [
                "AISPUJ", "AEENEA", "ÄIÖNST", "ANPRSK", "APHSKO",
                "DESRIL", "EIENUS", "HIKNMU", "AKAÄLÄ", "SIOTMU",
                "AJTOTO", "EITOSS", "ELYTTR", "AKITMV", "AILKVY", "ALRNNU"
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
            this.foundWords = new Set();
            this.isPaused = false;
            this.currentWord = [];
            this.selectedTiles = [];
            this.timerInterval = null;
            this.countdownInterval = null;
            this.shuffleInterval = null;
            this.isGameOver = false;
            this.invalidWordSubmitted = false;
            this.messageTimeout = null;

            // Leaderboard state
            this.lastSubmittedId = null;

            // Initialize
            this.bindEvents();
            this.initializeBoard();
            this.setInitialBackground();

            document.addEventListener("click", (event) => this.handleOutsideClick(event));
        }

        bindEvents() {
            document.getElementById("newGame").addEventListener("click", () => this.startNewGame());
            document.getElementById("pauseLeaderboard").addEventListener("click", () => this.handlePauseLeaderboard());
            document.getElementById("submitWord").addEventListener("click", () => this.submitWord());

            // Leaderboard modal
            document.getElementById("leaderboardClose").addEventListener("click", () => this.closeLeaderboard());
            document.getElementById("leaderboardOverlay").addEventListener("click", (e) => {
                if (e.target === document.getElementById("leaderboardOverlay")) this.closeLeaderboard();
            });
            document.querySelectorAll(".lb-tab").forEach(tab => {
                tab.addEventListener("click", () => {
                    document.querySelectorAll(".lb-tab").forEach(t => t.classList.remove("active"));
                    tab.classList.add("active");
                    this.loadLeaderboard(tab.dataset.type);
                });
            });

            // Nickname modal
            document.getElementById("nicknameSubmit").addEventListener("click", () => this.submitNickname());
            document.getElementById("nicknameInput").addEventListener("keydown", (e) => {
                if (e.key === "Enter") this.submitNickname();
            });
            document.getElementById("nicknameSkip").addEventListener("click", () => this.closeNicknameModal());
        }

        handleOutsideClick(event) {
            const isClickInsideGame = this.boardElement.contains(event.target) ||
                                      event.target.closest("#newGame") ||
                                      event.target.closest("#pauseLeaderboard") ||
                                      event.target.closest("#submitWord") ||
                                      event.target.closest("#leaderboardOverlay") ||
                                      event.target.closest("#nicknameOverlay");
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

            this.showMessage("Yhdistetään...", "#aaaaaa");
            const result = await this.validateWord("testi");
            if (result.error) {
                this.showMessage("Servu ei vastaa", "#ff4444");
                return;
            }

            this.clearMessage();
            this.startCountdown();
        }

        resetGameState() {
            const btn = document.getElementById("pauseLeaderboard");
            btn.textContent = "🏆";
            btn.disabled = true;
            this.timeLeft = 90;
            this.isPaused = false;
            this.isGameOver = false;
            this.isGameRunning = false;
            this.invalidWordSubmitted = false;
            this.foundWords.clear();
            this.currentWord = [];
            this.selectedTiles = [];
            this.lastSubmittedId = null;
            this.updateSidebar();
            this.timerElement.style.color = "";
            this.clearMessage();
        }

        // ── Countdown & timer ─────────────────────────────────────────────

        startCountdown() {
            let countdown = 3;
            this.shuffleInterval = setInterval(() => this.shuffleBoard(), 100);
            this.countdownInterval = setInterval(() => {
                this.timerElement.textContent = countdown > 0 ? countdown : "Go!";
                if (countdown-- <= 0) this.endCountdown();
            }, 1000);
        }

        endCountdown() {
            clearInterval(this.countdownInterval);
            clearInterval(this.shuffleInterval);
            const btn = document.getElementById("pauseLeaderboard");
            btn.disabled = false;
            btn.textContent = "Pause";
            this.timerElement.textContent = "1:30";
            this.isGameRunning = true;
            this.shuffleBoard();
            this.startTimer();
        }

        startTimer() {
            this.clearIntervals("timer");
            this.timerInterval = setInterval(() => {
                if (this.timeLeft <= 0) {
                    this.endGame();
                } else if (!this.isPaused) {
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

        async endGame() {
            clearInterval(this.timerInterval);
            this.timerElement.textContent = "Time's up!";
            this.timerElement.style.color = "red";
            this.isGameOver = true;
            const btn = document.getElementById("pauseLeaderboard");
            btn.textContent = "🏆";
            btn.disabled = false;
            this.timeUpSound.play();
            this.setTimeUpBackground();
            await this.checkAndPromptHighscore();
        }

        handlePauseLeaderboard() {
            if (this.isGameOver || !this.isGameRunning) {
                this.openLeaderboard();
            } else {
                this.togglePause();
            }
        }

        togglePause() {
            if (this.isGameOver) return;
            this.isPaused = !this.isPaused;
            const btn = document.getElementById("pauseLeaderboard");
            btn.textContent = this.isPaused ? "Resume" : "Pause";
            this.boardElement.querySelectorAll(".tile").forEach(tile => {
                tile.style.visibility = this.isPaused ? "hidden" : "visible";
            });
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
            if (this.isGameOver) return;

            if (this.invalidWordSubmitted) {
                this.clearMessage();
                this.invalidWordSubmitted = false;
            }

            if (this.selectedTiles.includes(tile)) {
                tile.classList.remove("selected");
                for (let i = this.selectedTiles.length - 1; i >= 0; i--) {
                    if (this.selectedTiles[i] === tile) {
                        this.selectedTiles.splice(i, 1);
                        this.currentWord.splice(i, 1);
                        break;
                    }
                }
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
            const word = this.currentWord.join("");

            if (word.length < 3) {
                this.showMessage("Liian lyhyt — vähintään 3 kirjainta", "#ff9900", 2000);
                this.incorrectAnswerSound.play();
                this.resetSelectedTiles();
                this.currentWord = [];
                this.selectedTiles = [];
                return;
            }

            if (this.foundWords.has(word)) {
                this.showMessage("Sana jo löydetty!", "#ff9900", 2000);
                this.incorrectAnswerSound.play();
                this.resetSelectedTiles();
                this.currentWord = [];
                this.selectedTiles = [];
                return;
            }

            this.showMessage("Tarkistetaan...", "#aaaaaa");

            const result = await this.validateWord(word);

            if (result.error) {
                this.showMessage("Servu ei vastaa", "#ff4444", 3000);
                this.incorrectAnswerSound.play();
                this.invalidWordSubmitted = true;
            } else if (result.exists) {
                this.correctAnswerSound.play();
                this.foundWords.add(word);
                this.updateSidebar();
                this.clearMessage();
                this.invalidWordSubmitted = false;
            } else {
                this.showMessage(`"${word}" ei ole kelvollinen sana`, "#ff4444", 2000);
                this.incorrectAnswerSound.play();
                this.invalidWordSubmitted = true;
            }

            this.resetSelectedTiles();
            this.currentWord = [];
            this.selectedTiles = [];
        }

        // Returns { exists: bool } or { error: true, message: string }
        async validateWord(word) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            try {
                const response = await fetch(
                    `${API_BASE}/validate-word/${word}`,
                    { signal: controller.signal }
                );
                if (!response.ok) return { error: true, message: `Server error: ${response.status}` };
                const data = await response.json();
                return { exists: data.exists };
            } catch (error) {
                console.error("Error validating word:", error);
                return { error: true, message: error.message };
            } finally {
                clearTimeout(timeout);
            }
        }

        // ── Sidebar & scoring ─────────────────────────────────────────────

        updateSidebar() {
            document.getElementById("totalScore").textContent = this.calculateTotalScore();
            document.getElementById("foundWordsList").innerHTML =
                Array.from(this.foundWords).reverse()
                    .map(word => `<li>${word} - ${this.calculateScore(word)}</li>`)
                    .join('');
        }

        calculateScore(word) {
            const l = word.length;
            return l >= 8 ? 11 : l === 7 ? 5 : l === 6 ? 3 : l === 5 ? 2 : l >= 3 ? 1 : 0;
        }

        calculateTotalScore() {
            return Array.from(this.foundWords).reduce((t, w) => t + this.calculateScore(w), 0);
        }

        // ── Board ─────────────────────────────────────────────────────────

        resetSelectedTiles() {
            this.boardElement.querySelectorAll(".selected").forEach(t => t.classList.remove("selected"));
        }

        shuffleBoard() {
            const letters = this.randomizeDice();
            this.boardElement.innerHTML = "";
            for (let row = 0; row < 4; row++) {
                for (let col = 0; col < 4; col++) {
                    this.boardElement.appendChild(this.createTile(letters[row * 4 + col], row, col));
                }
            }
        }

        randomizeDice() {
            const dice = [...this.finnishDice];
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

        // ── Highscore & leaderboard ───────────────────────────────────────

        async checkAndPromptHighscore() {
            const score = this.calculateTotalScore();
            if (score === 0) return;

            // Check both alltime and weekly qualification in parallel
            const [alltime, weekly] = await Promise.all([
                this.checkQualifies(score, 'alltime'),
                this.checkQualifies(score, 'weekly')
            ]);

            if (alltime || weekly) {
                this.openNicknameModal(score);
            }
        }

        async checkQualifies(score, type) {
            try {
                const res = await fetch(`${API_BASE}/leaderboard/qualifies?score=${score}&type=${type}`);
                if (!res.ok) return false;
                const data = await res.json();
                return data.qualifies;
            } catch {
                return false;
            }
        }

        openNicknameModal(score) {
            this._pendingScore = score;
            document.getElementById("nicknameInput").value = "";
            document.getElementById("nicknameError").textContent = "";
            document.getElementById("nicknameOverlay").classList.add("active");
            setTimeout(() => document.getElementById("nicknameInput").focus(), 100);
        }

        closeNicknameModal() {
            document.getElementById("nicknameOverlay").classList.remove("active");
            this._pendingScore = null;
        }

        async submitNickname() {
            const nickname = document.getElementById("nicknameInput").value.trim();
            if (!nickname) {
                document.getElementById("nicknameError").textContent = "Kirjoita nimimerkki";
                return;
            }

            const score = this._pendingScore;
            const word_count = this.foundWords.size;

            document.getElementById("nicknameSubmit").disabled = true;
            document.getElementById("nicknameError").textContent = "";

            try {
                const res = await fetch(`${API_BASE}/scores`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ nickname, score, word_count })
                });
                if (!res.ok) throw new Error("Server error");
                const data = await res.json();
                this.lastSubmittedId = data.id;
                this.closeNicknameModal();
                this.openLeaderboard();
            } catch {
                document.getElementById("nicknameError").textContent = "Virhe tallennuksessa, yritä uudelleen";
            } finally {
                document.getElementById("nicknameSubmit").disabled = false;
            }
        }

        async openLeaderboard() {
            document.getElementById("leaderboardOverlay").classList.add("active");
            // Default to alltime tab
            document.querySelectorAll(".lb-tab").forEach(t => t.classList.remove("active"));
            document.querySelector('.lb-tab[data-type="alltime"]').classList.add("active");
            await this.loadLeaderboard("alltime");
        }

        closeLeaderboard() {
            document.getElementById("leaderboardOverlay").classList.remove("active");
            this.lastSubmittedId = null;
        }

        async loadLeaderboard(type) {
            const listEl = document.getElementById("leaderboardList");
            listEl.innerHTML = '<li class="lb-loading">Ladataan...</li>';

            try {
                const res = await fetch(`${API_BASE}/leaderboard?type=${type}`);
                if (!res.ok) throw new Error("Server error");
                const rows = await res.json();

                if (rows.length === 0) {
                    listEl.innerHTML = '<li class="lb-empty">Ei tuloksia vielä</li>';
                    return;
                }

                const now = Math.floor(Date.now() / 1000);
                listEl.innerHTML = rows.map((row, i) => {
                    const daysAgo = Math.floor((now - row.created_at) / 86400);
                    const whenText = daysAgo === 0 ? "tänään" : daysAgo === 1 ? "eilen" : `${daysAgo} pv sitten`;
                    const isNew = this.lastSubmittedId !== null && row.id === this.lastSubmittedId;
                    return `
                        <li class="lb-row${isNew ? " lb-highlight" : ""}">
                            <span class="lb-rank">${i + 1}.</span>
                            <span class="lb-name">${this.escapeHtml(row.nickname)}</span>
                            <span class="lb-score">${row.score} pts</span>
                            <span class="lb-words">${row.word_count} sanaa</span>
                            <span class="lb-date">${whenText}</span>
                        </li>`;
                }).join('');
            } catch {
                listEl.innerHTML = '<li class="lb-error">Virhe ladattaessa tuloksia</li>';
            }
        }

        escapeHtml(str) {
            return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        }
    }

    new BoggleGame();
});
