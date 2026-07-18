let board = null;
let game = new Chess();
let playingAs = 'w';
let currentElo = 1500;
let lastEval = 0;
let currentBestMove = '';
let latestEvalCp = 0;
let stockfish = null;
let isSearching = false;
let opponentErrorSum = 0;
let opponentMoveCount = 0;
let isAiPaused = false;

// Initialize Chessboard
const config = {
    draggable: true,
    dropOffBoard: 'trash',
    sparePieces: true,
    position: 'start',
    moveSpeed: 1,
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
    onDrop: function(source, target, piece, newPos, oldPos, orientation) {
        let move = game.move({
            from: source,
            to: target,
            promotion: 'q'
        });
        
        if (move === null) {
            // Illegal move (Sandbox adjustment)
            // Force chess.js to adopt the arbitrary position, setting turn to playingAs to trigger AI
            const newFen = Chessboard.objToFen(newPos);
            game.load(newFen + ` ${playingAs} - - 0 1`);
        }
    },
    onSnapEnd: function() {
        board.position(game.fen(), false);
        onBoardChange();
    }
};
board = Chessboard('board', config);

// Setup Buttons
$('#btn-white').on('click', () => {
    playingAs = 'w';
    $('#btn-white').addClass('active');
    $('#btn-black').removeClass('active');
    board.orientation('white');
    onBoardChange();
});

$('#btn-black').on('click', () => {
    playingAs = 'b';
    $('#btn-black').addClass('active');
    $('#btn-white').removeClass('active');
    board.orientation('black');
    onBoardChange();
});

$('#btn-pause-ai').on('click', () => {
    isAiPaused = !isAiPaused;
    if (isAiPaused) {
        $('#btn-pause-ai').text('Resume AI');
        $('#btn-pause-ai').addClass('active');
        $('#best-move').text('AI Paused (Sandbox Mode)');
        if (stockfish) stockfish.postMessage('stop');
        isSearching = false;
    } else {
        $('#btn-pause-ai').text('Pause AI');
        $('#btn-pause-ai').removeClass('active');
        onBoardChange(); // Trigger AI again
    }
});

$('#btn-reset').on('click', () => {
    game.reset();
    board.position('start');
    currentElo = 1500;
    lastEval = 0;
    latestEvalCp = 0;
    opponentErrorSum = 0;
    opponentMoveCount = 0;
    isAiPaused = false;
    $('#btn-pause-ai').text('Pause AI').removeClass('active');
    updateEloDisplay();
    $('#best-move').text('Waiting for opponent...');
    $('#board-analysis').text('Analyzing position...');
    $('#opponent-hint').text('Waiting for move...');
    $('.highlight-best-move').removeClass('highlight-best-move');
    $('#dynamic-highlight').remove();
    onBoardChange();
});

// Setup Stockfish Worker
fetch('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js')
    .then(response => response.text())
    .then(code => {
        const blob = new Blob([code], { type: 'application/javascript' });
        stockfish = new Worker(URL.createObjectURL(blob));
        
        stockfish.onmessage = function(event) {
            const line = event.data;
            
            // Parse Eval
            if (line.includes('info depth') && line.includes('score cp')) {
                const match = line.match(/score cp (-?\d+)/);
                if (match) {
                    let evalCp = parseInt(match[1]) / 100;
                    $('#eval-display').text(`Eval: ${evalCp > 0 ? '+' : ''}${evalCp.toFixed(2)}`);
                    
                    latestEvalCp = evalCp;
                }
            } else if (line.includes('score mate')) {
                const match = line.match(/score mate (-?\d+)/);
                if (match) {
                    $('#eval-display').text(`Eval: M${match[1]}`);
                    latestEvalCp = parseInt(match[1]) > 0 ? 99 : -99;
                }
            }
            
            // Parse Best Move
            if (line.startsWith('bestmove')) {
                if (!isSearching) return; // Ignore aborted searches
                
                // Run adaptive logic exactly once per turn using the final stabilized evaluation
                // Adaptive ACPL Algorithm: Guess opponent's Elo and play slightly stronger (+150)
                if (lastEval !== 0 && latestEvalCp !== 0) {
                    let moveError = latestEvalCp - lastEval;
                    moveError = Math.max(0, moveError); // Clamp horizon effects
                    
                    opponentErrorSum += moveError;
                    opponentMoveCount++;
                    
                    let acpl = (opponentErrorSum / opponentMoveCount) * 100;
                    
                    // Estimate enemy Elo based on their average blunder rate
                    let estimatedEnemyElo = Math.floor(3000 - (acpl * 15));
                    
                    // Set our AI to be slightly stronger than the enemy so the user can win a close game
                    let targetElo = estimatedEnemyElo + 150;
                    targetElo = Math.max(1350, Math.min(3190, targetElo));
                    
                    // Smoothly adapt current Elo towards the target
                    currentElo = Math.floor((currentElo + targetElo) / 2);
                    
                    updateEloDisplay();
                    setEngineStrength();
                }
                lastEval = latestEvalCp;

                const bestMove = line.split(' ')[1];
                if (bestMove && bestMove !== '(none)') {
                    currentBestMove = bestMove;
                    $('#best-move').text(formatMove(bestMove));
                    
                    const texts = generateAnalysis(bestMove, latestEvalCp);
                    $('#board-analysis').text(texts.analysis);
                    $('#opponent-hint').text(texts.hint);
                    
                    // Add visual highlights (path) using persistent CSS injection
                    const from = bestMove.substring(0, 2);
                    const to = bestMove.substring(2, 4);
                    $('#dynamic-highlight').remove();
                    $('head').append(`<style id="dynamic-highlight">.square-${from}, .square-${to} { background-color: rgba(200, 200, 50, 0.5) !important; }</style>`);
                    
                    executeMove(bestMove); // Instant Autoplay move with ZERO delay
                } else {
                    $('#best-move').text('Game Over');
                    $('#board-analysis').text('Game Over');
                    $('#opponent-hint').text('Game Over');
                }
                isSearching = false;
            }
        };
        
        stockfish.postMessage('uci');
        setEngineStrength();
        onBoardChange();
    });

function setEngineStrength() {
    if (!stockfish) return;
    stockfish.postMessage('setoption name UCI_LimitStrength value true');
    stockfish.postMessage(`setoption name UCI_Elo value ${currentElo}`);
}

function updateEloDisplay() {
    $('#current-elo').text(currentElo);
}

function onBoardChange() {
    if (!stockfish) return;
    
    if (game.turn() !== playingAs) {
        $('#best-move').text('Waiting for opponent...');
        $('.highlight-best-move').removeClass('highlight-best-move');
        $('#btn-play-move').hide();
        currentBestMove = '';
        return;
    }
    
    if (isAiPaused) {
        $('#best-move').text('AI Paused (Sandbox Mode)');
        return;
    }

    isSearching = false; // Invalidate any incoming bestmove
    $('#btn-play-move').hide();
    currentBestMove = '';
    $('#best-move').text('Thinking...');
    $('.highlight-best-move').removeClass('highlight-best-move');
    
    stockfish.postMessage('stop');
    
    // Wait for the aborted search to flush before starting a new one
    setTimeout(() => {
        const fen = game.fen();
        stockfish.postMessage(`position fen ${fen}`);
        isSearching = true;
        stockfish.postMessage('go depth 15');
    }, 50);
}

function formatMove(move) {
    if (!move || move.length < 4) return move;
    const from = move.substring(0, 2);
    const to = move.substring(2, 4);
    const promo = move.length > 4 ? ` = ${move[4].toUpperCase()}` : '';
    return `${from} ➔ ${to}${promo}`;
}

function generateAnalysis(bestMove, evalCp) {
    if (!bestMove || bestMove === '(none)') return { analysis: "Game Over", hint: "" };
    
    const pos = board.position();
    const from = bestMove.substring(0, 2);
    const to = bestMove.substring(2, 4);
    const pieceMoved = pos[from];
    const targetPiece = pos[to];
    
    let analysis = "";
    let hint = "";
    
    const pieceNames = { 'P': 'pawn', 'N': 'knight', 'B': 'bishop', 'R': 'rook', 'Q': 'queen', 'K': 'king' };
    
    if (targetPiece) {
        const targetName = pieceNames[targetPiece[1].toUpperCase()];
        analysis = `Trying to get the ${targetName}!`;
    } else {
        if (evalCp > 2) {
            analysis = "We are putting on heavy pressure.";
        } else if (evalCp < -2) {
            analysis = "Our king is being pressed.";
        } else {
            analysis = "Maneuvering for a better position.";
        }
    }
    
    if (pieceMoved) {
        const myPieceName = pieceNames[pieceMoved[1].toUpperCase()];
        hint = `You should go for my ${myPieceName}.`;
    } else {
        hint = "Look for undefended pieces.";
    }
    
    return { analysis, hint };
}

function executeMove(move) {
    if (move && move.length >= 4) {
        const from = move.substring(0, 2);
        const to = move.substring(2, 4);
        const promo = move.length > 4 ? move[4].toLowerCase() : 'q';
        
        game.move({
            from: from,
            to: to,
            promotion: promo
        });
        
        board.position(game.fen(), false);
    }
}
