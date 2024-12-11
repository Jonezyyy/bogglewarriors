document.addEventListener("DOMContentLoaded", () => {
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
            this.timeUpSound = new Audio("sounds/time_up.mp3");
            this.correctAnswerSound = new Audio("sounds/correct_answer.mp3");
            this.incorrectAnswerSound = new Audio("sounds/incorrect_answer.mp3");
			this.invalidWordSubmitted = false; // New flag for invalid word submission

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

            // Initialize game
            this.bindEvents();
            this.initializeBoard();
            this.setInitialBackground();

            // Add global click listener for outside clicks
            document.addEventListener("click", (event) => this.handleOutsideClick(event));
        }

        bindEvents() {
            document.getElementById("newGame").addEventListener("click", () => this.startNewGame());
            document.getElementById("pause").addEventListener("click", () => this.togglePause());
            document.getElementById("submitWord").addEventListener("click", () => this.submitWord());
        }

		handleOutsideClick(event) {
			const isClickInsideGame = this.boardElement.contains(event.target) || 
									  event.target.closest("#newGame") || 
									  event.target.closest("#pause") || 
									  event.target.closest("#submitWord");

			if (!isClickInsideGame) {
				this.resetSelectedTiles();
				this.currentWord = [];
				this.selectedTiles = [];
				document.getElementById("selected-word").textContent = ""; // Clear selected word display
			}
		}

        initializeBoard() {
            this.boardElement.innerHTML = '';
            for (let row = 0; row < 4; row++) {
                for (let col = 0; col < 4; col++) {
                    const letter = this.initialLetters[row * 4 + col];
                    const tile = this.createTile(letter, row, col);
                    this.boardElement.appendChild(tile);
                }
            }
            this.setInitialBackground();
        }

        startNewGame() {
            this.clearIntervals();
            this.resetBackground();
            this.resetGameState();
            this.startCountdown();
        }

        resetGameState() {
            document.getElementById("pause").disabled = true;
            this.timeLeft = 90;
            this.isPaused = false;
            this.isGameOver = false;
            this.foundWords.clear();
            this.currentWord = [];
            this.selectedTiles = [];
            this.updateSidebar();
            this.timerElement.style.color = ""; // Reset any styling for "Time’s up" message
        }

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
            document.getElementById("pause").disabled = false;
            this.timerElement.textContent = "1:30";
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
		
		updateSelectedWordDisplay() {
			document.getElementById("selected-word").textContent = this.currentWord.join('');
		}

        setInitialBackground() {
            document.body.classList.add("background");
        }

        endGame() {
            clearInterval(this.timerInterval);
            this.timerElement.textContent = "Time’s up!";
            this.timerElement.style.color = "red"; // Set text color to red to indicate end of game
            this.isGameOver = true;
            this.timeUpSound.play();
            this.setTimeUpBackground();
        }

        updateTimer() {
            this.timeLeft -= 1;
            const minutes = Math.floor(this.timeLeft / 60);
            const seconds = this.timeLeft % 60;
            this.timerElement.textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
        }

        togglePause() {
            if (this.isGameOver) return;
            this.isPaused = !this.isPaused;
            document.getElementById("pause").textContent = this.isPaused ? "Resume" : "Pause";
            this.boardElement.querySelectorAll('.tile').forEach(tile => {
                tile.style.visibility = this.isPaused ? "hidden" : "visible";
            });
        }

        createTile(letter, row, col) {
			const tile = document.createElement("div");
			tile.classList.add("tile");
			tile.textContent = letter;
			tile.dataset.row = row;
			tile.dataset.col = col;
			tile.addEventListener("click", () => this.selectTile(tile)); // Arrow function to preserve `this` context
				return tile;
		}
		
		selectTile(tile) {
			if (this.isGameOver) return;

			// Clear "selected word" field if previous word was invalid
			if (this.invalidWordSubmitted) {
				document.getElementById("selected-word").textContent = ""; // Clear message
				this.invalidWordSubmitted = false; // Reset the flag
			}

			// If the tile is already selected, deselect it
			if (this.selectedTiles.includes(tile)) {
				tile.classList.remove("selected");
				
				// Find the last occurrence of the tile's letter in `currentWord`
				for (let i = this.selectedTiles.length - 1; i >= 0; i--) {
					if (this.selectedTiles[i] === tile) {
						this.selectedTiles.splice(i, 1);  // Remove the specific tile
						this.currentWord.splice(i, 1);    // Remove the corresponding letter
						break;
					}
				}

				this.updateSelectedWordDisplay(); // Update displayed word after deselection
				return;
			}

			// Check if the tile is adjacent to the last selected tile
			if (this.selectedTiles.length > 0 && !this.isAdjacent(tile)) {
				console.log("Tile is not adjacent to the previous one");
				return;
			}

			// Select the tile and add it to the current word
			tile.classList.add("selected");
			this.currentWord.push(tile.textContent);
			this.selectedTiles.push(tile);
			this.updateSelectedWordDisplay(); // Update displayed letters
		}


		
		isAdjacent(tile) {
			if (this.selectedTiles.length === 0) return true;

			const lastTile = this.selectedTiles[this.selectedTiles.length - 1];
			const lastRow = parseInt(lastTile.dataset.row);
			const lastCol = parseInt(lastTile.dataset.col);
			const newRow = parseInt(tile.dataset.row);
			const newCol = parseInt(tile.dataset.col);

			return (
				Math.abs(lastRow - newRow) <= 1 &&
				Math.abs(lastCol - newCol) <= 1
			);
		}



		async submitWord() {
			const word = this.currentWord.join('');

			if (word.length < 3) {
				console.log("Word must be at least 3 letters long");
				this.incorrectAnswerSound.play();
				this.resetSelectedTiles();
				this.currentWord = [];
				this.selectedTiles = [];
				this.updateSelectedWordDisplay();
				return;
			}

			// Check if word has already been found
			if (this.foundWords.has(word)) {
				console.log("Word has already been found");
				document.getElementById("selected-word").textContent = "Word already used"; // Show message in selected-word
				this.incorrectAnswerSound.play();
				this.resetSelectedTiles();
				this.currentWord = [];
				this.selectedTiles = [];
				
				setTimeout(() => {
					document.getElementById("selected-word").textContent = ""; // Clear the message after a delay
				}, 2000);
				
				return;
			}

			const isValid = await this.validateWord(word);
			if (isValid) {
				this.correctAnswerSound.play();
				this.foundWords.add(word);
				this.updateSidebar();
				this.invalidWordSubmitted = false;
			} else {
				document.getElementById("selected-word").textContent = `${word} is not a valid word`;
				this.incorrectAnswerSound.play();
				this.invalidWordSubmitted = true;
			}

			this.resetSelectedTiles();
			this.currentWord = [];
			this.selectedTiles = [];
		}



        async validateWord(word) {
            try {
                const response = await fetch(`http://192.168.0.73:3000/validate-word/${word}`);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const data = await response.json();
                return data.exists;
            } catch (error) {
                console.error("Error validating word:", error);
                return false;
            }
        }

        updateSidebar() {
            this.sidebarElement.innerHTML = `<h3>Found Words</h3><ul>` +
                Array.from(this.foundWords).map(word => `<li>${word} - ${this.calculateScore(word)}</li>`).join('') +
                `</ul><h4>Total Score: ${this.calculateTotalScore()}</h4>`;
        }

        calculateScore(word) {
            const length = word.length;
            return length >= 8 ? 11 : length === 7 ? 5 : length === 6 ? 3 : length === 5 ? 2 : length >= 3 ? 1 : 0;
        }

        calculateTotalScore() {
            return Array.from(this.foundWords).reduce((total, word) => total + this.calculateScore(word), 0);
        }

        resetSelectedTiles() {
            this.boardElement.querySelectorAll('.selected').forEach(tile => tile.classList.remove('selected'));
        }

        shuffleBoard() {
            const randomizedLetters = this.randomizeDice();
            this.boardElement.innerHTML = '';
            for (let row = 0; row < 4; row++) {
                for (let col = 0; col < 4; col++) {
                    const letter = randomizedLetters[row * 4 + col];
                    const tile = this.createTile(letter, row, col);
                    this.boardElement.appendChild(tile);
                }
            }
        }

        randomizeDice() {
            const shuffledDice = [...this.finnishDice];
            for (let i = shuffledDice.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffledDice[i], shuffledDice[j]] = [shuffledDice[j], shuffledDice[i]];
            }
            return shuffledDice.map(die => die[Math.floor(Math.random() * die.length)]);
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

        clearIntervals(type = "all") {
            if (type === "all" || type === "timer") clearInterval(this.timerInterval);
            if (type === "all" || type === "countdown") clearInterval(this.countdownInterval);
            if (type === "all" || type === "shuffle") clearInterval(this.shuffleInterval);
        }
    }

    new BoggleGame();
});
