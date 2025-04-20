import { WebSocketServer } from 'ws';
import http from 'http';

const PORT = process.env.PORT || 3000;
const server = http.createServer();
const wss = new WebSocketServer({ server });

let waitingPlayer = null;
const games = new Map(); // Store active games { gameId: { blue: ws, red: ws } }

console.log(`WebSocket server starting on port ${PORT}`);

wss.on('connection', (ws) => {
    console.log('Client connected');
    ws.gameId = null; // Assign a game ID later

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
            // console.log('Received:', data); // Debugging
        } catch (e) {
            console.error('Failed to parse message or invalid message format:', message);
            return;
        }

        // --- Message Handling ---
        if (data.type === 'join') {
            if (waitingPlayer === null) {
                // This is the first player, make them wait
                waitingPlayer = ws;
                console.log('Player waiting');
                ws.send(JSON.stringify({ type: 'status', message: 'Waiting for opponent...' }));
            } else {
                // Second player found, start a game
                console.log('Pairing players');
                const playerBlue = waitingPlayer;
                const playerRed = ws;
                waitingPlayer = null; // Reset waiting player

                const gameId = Date.now().toString(); // Simple unique ID
                playerBlue.gameId = gameId;
                playerRed.gameId = gameId;
                games.set(gameId, { blue: playerBlue, red: playerRed });

                // Assign paddles and notify players
                playerBlue.send(JSON.stringify({ type: 'assign_paddle', side: 'blue' }));
                playerRed.send(JSON.stringify({ type: 'assign_paddle', side: 'red' }));

                // Tell both players to start
                const startGamePayload = {
                     type: 'start_game',
                     paddleWidth: 1.0, // Default or get from blue player's settings? Keep simple for now.
                     setsToPlay: 3,     // Default or get from blue player's settings? Keep simple for now.
                     difficulty: 'normal' // Not really used in MP, but keep structure
                };
                playerBlue.send(JSON.stringify(startGamePayload));
                playerRed.send(JSON.stringify(startGamePayload));

                console.log(`Game ${gameId} started between two players.`);
            }
        } else if (ws.gameId && games.has(ws.gameId)) {
            // --- Handle messages only for players in a game ---
            const game = games.get(ws.gameId);
            const opponent = game.blue === ws ? game.red : game.blue;

            if (opponent && opponent.readyState === ws.OPEN) {
                 // Relay specific messages (paddle, ball, score etc.)
                 // Avoid relaying 'join' or sensitive internal messages
                 if (['paddle_update', 'ball_update', 'score_update', 'volley_update', 'pause_request', 'resume_request', 'restart_request', 'game_won', 'set_won', 'match_won'].includes(data.type)) {
                    opponent.send(message); // Forward the raw message string
                 }
            } else if (opponent && opponent.readyState !== ws.OPEN) {
                 // Opponent likely disconnected during message send attempt
                 console.log(`Opponent for game ${ws.gameId} is not open, notifying client.`);
                 ws.send(JSON.stringify({ type: 'opponent_disconnect' }));
                 // Clean up game if opponent is gone
                 games.delete(ws.gameId);
                 ws.gameId = null;
                 // Should we also close ws connection or let client decide? Let client handle 'opponent_disconnect'
            }
        } else {
             console.log("Received message from client not in a game or game doesn't exist:", data.type);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        if (ws === waitingPlayer) {
            waitingPlayer = null;
            console.log('Waiting player disconnected');
        } else if (ws.gameId && games.has(ws.gameId)) {
            const game = games.get(ws.gameId);
            const opponent = game.blue === ws ? game.red : game.blue;
            console.log(`Player from game ${ws.gameId} disconnected.`);

            if (opponent && opponent.readyState === ws.OPEN) {
                // Notify the remaining player
                opponent.send(JSON.stringify({ type: 'opponent_disconnect' }));
                opponent.gameId = null; // Clear game ID for the remaining player
            }
             // Clean up the game
             games.delete(ws.gameId);
             console.log(`Game ${ws.gameId} removed.`);
        }
    });

     ws.on('error', (error) => {
        console.error('WebSocket error:', error);
         // Add similar cleanup logic as in 'close'
         if (ws === waitingPlayer) waitingPlayer = null;
         if (ws.gameId && games.has(ws.gameId)) {
            const game = games.get(ws.gameId);
            const opponent = game.blue === ws ? game.red : game.blue;
             if (opponent && opponent.readyState === ws.OPEN) {
                opponent.send(JSON.stringify({ type: 'opponent_disconnect' }));
                opponent.gameId = null;
             }
             games.delete(ws.gameId);
         }
     });
});

server.listen(PORT, () => {
    console.log(`WebSocket server is listening on port ${PORT}`);
});
