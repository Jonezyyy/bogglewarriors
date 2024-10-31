document.addEventListener("DOMContentLoaded", () => {
    // Initial letters for display on page load
    const initialLetters = ["B", "O", "G", "G", "L", "E", "W", "A", "R", "R", "I", "O", "R", "S"];
    const boardElement = document.getElementById("board");
    const timerElement = document.getElementById("timer");
    const timeUpElement = document.getElementById("time-up");
    const timeUpSound = document.getElementById("timeUpSound");

    let timeLeft = 90;
    let timerInterval;
    let countdownInterval;
    let shuffleInterval;
    let isPaused = false;

    // Function to initialize the board with initial letters on page load
    function initializeBoard() {
        boardElement.innerHTML = ''; // Clear existing tiles
        initialLetters.forEach(letter => {
            const tile = document.createElement("div");
            tile.classList.add("tile");
            tile.textContent = letter;
            boardElement.appendChild(tile);
        });

        // Set the initial background to the default
        document.body.classList.add("background");
    }

    // Function to shuffle and place dice randomly on the grid (used when New Game is pressed)
    function shuffleBoard() {
        const finnishDice = [
            "AISPUJ", "AEENEA", "ÄIÖNST", "ANPRSK", "APHSKO", 
            "DESRIL", "EIENUS", "HIKNMU", "AKAÄLÄ", "SIOTMU", 
            "AJTOTO", "EITOSS", "ELYTTR", "AKITMV", "AILKVY", "ALRNNU"
        ];

        // Clear the board
        boardElement.innerHTML = '';

        // Shuffle the dice array to randomize which die goes to which position
        const shuffledDice = [...finnishDice];
        for (let i = shuffledDice.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledDice[i], shuffledDice[j]] = [shuffledDice[j], shuffledDice[i]];
        }

        // Assign a random letter from each shuffled die to a tile
        shuffledDice.forEach(die => {
            const letter = die[Math.floor(Math.random() * die.length)]; // Random letter from the die
            const tile = document.createElement("div");
            tile.classList.add("tile");
            tile.textContent = letter;
            boardElement.appendChild(tile);
        });
    }

    // Function to start the main game timer
    function startTimer() {
        clearInterval(timerInterval);
        
        timerInterval = setInterval(() => {
            if (timeLeft <= 0) {
                clearInterval(timerInterval); // Stop the timer when time is up
                if (timeUpElement) timeUpElement.style.display = "block";
                timerElement.textContent = "0:00";
                if (timeUpSound) timeUpSound.play();

                // Change background to time-up image
                document.body.classList.remove("background");
                document.body.classList.add("time-up-background");
            } else if (!isPaused) {
                timeLeft -= 1;
                let minutes = Math.floor(timeLeft / 60);
                let seconds = timeLeft % 60;
                timerElement.textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
            }
        }, 1000);
    }

    // New Game button functionality
    document.getElementById("newGame").addEventListener("click", () => {
        // Clear any active intervals (countdown, shuffle, or game timer) to prevent conflicts
        clearInterval(countdownInterval);
        clearInterval(timerInterval);
        clearInterval(shuffleInterval);

        // Reset background to original when starting a new game
        document.body.classList.remove("time-up-background");
        document.body.classList.add("background");

        // Disable Pause button during countdown and reset necessary variables
        document.getElementById("pause").disabled = true;
        document.getElementById("pause").textContent = "Pause";
        timeLeft = 90;
        isPaused = false;
        timeUpElement.style.display = "none";

        // Set initial countdown state in the timerElement
        let countdown = 3;
        timerElement.textContent = countdown;

        // Start the 100ms shuffle interval for faster shuffling
        shuffleInterval = setInterval(() => {
            shuffleBoard();
        }, 100);

        // Start 3-second countdown with "Go" at the end
        countdownInterval = setInterval(() => {
            countdown -= 1;

            if (countdown > 0) {
                timerElement.textContent = countdown;
            } else if (countdown === 0) {
                timerElement.textContent = "Go!";
            } else {
                // End countdown, stop shuffling, enable Pause, and start game timer
                clearInterval(countdownInterval);
                clearInterval(shuffleInterval);
                document.getElementById("pause").disabled = false;

                // Reset timer display to 1:30 and start main game timer
                timerElement.textContent = "1:30";
                shuffleBoard(); // Final board setup with randomized letters
                startTimer();   // Start main game timer
            }
        }, 1000); // Countdown runs at 1-second intervals
    });

    // Pause button functionality
    document.getElementById("pause").addEventListener("click", () => {
        isPaused = !isPaused;
        document.getElementById("pause").textContent = isPaused ? "Resume" : "Pause";
        
        // Toggle tile visibility when paused
        document.querySelectorAll('.tile').forEach(tile => {
            tile.style.visibility = isPaused ? "hidden" : "visible";
        });
    });

    // Initialize board on page load with fixed letters
    initializeBoard();
});
