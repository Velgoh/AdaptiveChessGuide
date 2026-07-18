let board = null;
let playingAs = 'w';
let currentElo = 1500;
let lastEval = 0;
let currentBestMove = '';
let latestEvalCp = 0;
let stockfish = null;
let isSearching = false;

// Initialize Chessboard
const config = {
    draggable: true,
    dropOffBoard: 'trash',
    sparePieces: true,
    position: 'start',
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
    onChange: onBoardChange
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

$('#btn-reset').on('click', () => {
    board.start();
    lastEval = 0;
    currentElo = 1500;
    updateEloDisplay();
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
                }
            }
            
            // Parse Best Move
            if (line.startsWith('bestmove')) {
                if (!isSearching) return; // Ignore aborted searches
                
                // Run adaptive logic exactly once per turn using the final stabilized evaluation
                if (lastEval !== 0 && latestEvalCp !== 0) {
                    const delta = latestEvalCp - lastEval;
                    if (delta > 0.5) {
                        currentElo = Math.max(1350, currentElo - 200);
                    } else if (delta < -0.2) {
                        currentElo = Math.min(3190, currentElo + 150);
                    }
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
                    
                    // Add visual highlights (path)
                    const from = bestMove.substring(0, 2);
                    const to = bestMove.substring(2, 4);
                    $('.highlight-best-move').removeClass('highlight-best-move');
                    $('.square-' + from).addClass('highlight-best-move');
                    $('.square-' + to).addClass('highlight-best-move');
                    
                    setTimeout(() => { executeMove(bestMove); }, 10); // Instant Autoplay move but path persists
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

function onBoardChange(oldPos, newPos) {
    if (!stockfish) return;
    
    if (oldPos && newPos) {
        let movedColor = null;
        for (const square in newPos) {
            if (newPos[square] !== oldPos[square] && newPos[square]) {
                movedColor = newPos[square][0];
                break;
            }
        }
        if (movedColor === playingAs) {
            $('#best-move').text('Waiting for opponent...');
            $('.highlight-best-move').removeClass('highlight-best-move');
            $('#btn-play-move').hide();
            currentBestMove = '';
            return;
        }
    }

    isSearching = false; // Invalidate any incoming bestmove
    $('#btn-play-move').hide();
    currentBestMove = '';
    $('#best-move').text('Thinking...');
    $('.highlight-best-move').removeClass('highlight-best-move');
    
    stockfish.postMessage('stop');
    
    // Wait for the aborted search to flush before starting a new one
    setTimeout(() => {
        const fen = board.fen() + ` ${playingAs} - - 0 1`;
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
        if (move.length > 4) {
            const pos = board.position();
            const piece = pos[from];
            delete pos[from];
            pos[to] = piece[0] + move[4].toUpperCase();
            board.position(pos);
        } else {
            board.move(from + '-' + to);
        }
        
        // Re-apply the highlights since updating the board DOM removes them
        setTimeout(() => {
            $('.square-' + from).addClass('highlight-best-move');
            $('.square-' + to).addClass('highlight-best-move');
        }, 50);
    }
}
