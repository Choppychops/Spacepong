import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { CubeTextureLoader } from 'three';

// --- Game Modes ---
let gameMode = 'none'; // 'none', 'single', 'multi'

// --- WebSocket Networking ---
let ws = null;
const WS_URL = `ws://${window.location.hostname}:3000`; // Use hostname, assumes server on same host, port 3000
let myPaddleSide = null; // 'blue' or 'red'
let opponentPaddle = null; // Reference to the opponent's paddle mesh
let lastSentPaddlePos = { y: 0, z: 0 };
let networkUpdateBuffer = []; // Buffer for incoming network updates
const PADDLE_SEND_THRESHOLD = 0.01; // How much paddle must move to send update
const BALL_SEND_INTERVAL = 1 / 30; // Send ball updates roughly 30 times/sec (if host)
let lastBallSendTime = 0;
let remotePaused = false; // Is the game paused by the remote player?

// --- Global State ---
let gameStarted = false;
let isPaused = false;
let isMatchOver = false;
let selectedPaddleWidth = 1.0;
let PADDLE_VISUAL_WIDTH = 1.0; // This will be set by game start message in MP
const PADDLE_THICKNESS = 0.4;
let selectedDifficulty = 'normal';
let aiSpeedModifier = 1.0;
let aiLagModifier = 1.0;
let aiErrorChance = 0;
let aiErrorMagnitude = 0;
let paddlesTransparent = true;
let totalSetsToPlay = 3; // Will be set by game start message in MP
let gamesNeededToWinSet = 2;

// --- DOM Elements ---
const startMenu = document.getElementById('start-menu');
const pauseMenu = document.getElementById('pause-menu');
const matchWinnerOverlay = document.getElementById('match-winner-overlay');
const gameUi = document.getElementById('game-ui');
const gameScoreElement = document.getElementById('game-score');
const setScoreElement = document.getElementById('set-score');
const volleyCountElement = document.getElementById('volley-count');
const viewInfoElement = document.getElementById('view-info');
// Start Menu Buttons
const onePlayerButton = document.getElementById('one-player-button');
const twoPlayerButton = document.getElementById('two-player-button');
const connectionStatusElement = document.getElementById('connection-status');
// Pause Menu Elements
const pauseTitle = document.getElementById('pause-title');
const pauseMessage = document.getElementById('pause-message');
const resumeButton = document.getElementById('resume-button');
const restartGameButton = document.getElementById('restart-game-button');
const mainMenuButton = document.getElementById('main-menu-button');
const winnerMainMenuButton = document.getElementById('winner-main-menu-button');
// Option Buttons
const paddleOptionButtons = document.querySelectorAll('.paddle-option');
const difficultyOptionButtons = document.querySelectorAll('.difficulty-option');
const setsOptionButtons = document.querySelectorAll('.sets-option');
const transparencyButton = document.getElementById('transparency-button');
const touchPauseButton = document.getElementById('touch-pause-button');

// --- Scene Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('gameCanvas') }); // Use canvas ID
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x050515);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.style.visibility = 'hidden'; // Start hidden
// document.body.appendChild(renderer.domElement); // Canvas is now in HTML
const canvas = renderer.domElement; // Cache canvas element

// --- Space Background ---
const cubeLoader = new CubeTextureLoader();
const spaceTexture = cubeLoader.load([
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPgvAQADPgGHRg9GLwAAAABJRU5ErkJggg==', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mOor6/nDwAFsQJQ91z78gAAAABJRU5ErkJggg==',
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mPkYPgPEwAD5gHlS/jZzwAAAABJRU5ErkJggg==', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkOPwvAQADBQGhMAXTeAAAAABJRU5ErkJggg==',
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkGAY/wQAAAZ8Anvg0pxYAAAAASUVORK5CYII=', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A+/DAAKPQGpBs976wAAAABJRU5ErkJggg=='
], () => { scene.background = spaceTexture; console.log("BG loaded."); }, undefined, (err) => { console.error("BG load error:", err); });

// --- Game Constants ---
const ARENA_WIDTH = 22; const ARENA_HEIGHT = 12; const ARENA_DEPTH = 16;
const arenaHalfW = ARENA_WIDTH / 2; const arenaHalfH = ARENA_HEIGHT / 2; const arenaHalfD = ARENA_DEPTH / 2;
const BALL_RADIUS = 0.3; const PADDLE_HEIGHT = 3;
let PLAYER_PADDLE_X = 0; // Assigned based on side
let AI_PADDLE_X = 0;     // Assigned based on side
const PADDLE_SPEED = 0.18; const BALL_SPEED_INITIAL = 0.11; const BALL_SPEED_INCREASE = 0.006; const AI_PADDLE_LAG_BASE = 0.07;

// --- Game State Variables ---
let ballSpeed = BALL_SPEED_INITIAL; let keysPressed = {}; let volleyCount = 0;
let gameScores = { blue: 0, red: 0 }; let setScores = { blue: 0, red: 0 }; let matchScore = { blue: 0, red: 0 };
let ballVelocity = new THREE.Vector3(0, 0, 0);

// --- Camera Views --- (Keep existing)
const centerLookAt = new THREE.Vector3(0, 0, 0);
const views = [ /* ... same views as before ... */
    { name: "Standard Overview", type: "static", pos: new THREE.Vector3(0, arenaHalfH * 1.8, arenaHalfD * 1.4), lookAt: new THREE.Vector3(0, -arenaHalfH * 0.3, 0) },
    { name: "Behind Blue Start (Fixed)", type: "static", pos: new THREE.Vector3(0,0,0), lookAt: new THREE.Vector3(0,0,0) },
    { name: "Dynamic Corner (Blue Side)", type: "dynamic_corner", cornerPosStart: new THREE.Vector3(), cornerPosEnd:   new THREE.Vector3(), lookAtMode: "ball" },
    { name: "Dynamic Corner Inverted (Blue Side)", type: "dynamic_corner", cornerPosStart: new THREE.Vector3(), cornerPosEnd:   new THREE.Vector3(), lookAtMode: "ball" },
    { name: "Top Down", type: "static", pos: new THREE.Vector3(0, arenaHalfH * 3.5, 0), lookAt: centerLookAt },
    { name: "Side View (Left)", type: "static", pos: new THREE.Vector3(0, 0, arenaHalfD * 1.8), lookAt: centerLookAt },
    { name: "Side View (Right)", type: "static", pos: new THREE.Vector3(0, 0, -arenaHalfD * 1.8), lookAt: centerLookAt }
];
let currentViewIndex = 2;

// --- Field Texture Function --- (Keep existing)
function createFieldTexture() { /* ... same function as before ... */ const c=document.createElement('canvas'); c.width=512; c.height=512; const x=c.getContext('2d'); x.fillStyle='#183818'; x.fillRect(0,0,512,512); for(let i=0;i<8000;i++){ const a=Math.random()*512,b=Math.random()*512,s=Math.random()*0.1+0.95; x.fillStyle=`rgb(${Math.floor(24*s)},${Math.floor(56*s)},${Math.floor(24*s)})`; x.fillRect(a,b,1,1);} const nl=11,ls=512/(nl-1); x.strokeStyle='rgba(200,200,220,0.7)'; x.lineWidth=3; x.beginPath(); for(let i=0;i<nl;i++){const a=i*ls; x.moveTo(a,0);x.lineTo(a,512);} x.stroke(); const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(ARENA_WIDTH/15, ARENA_DEPTH/15); t.anisotropy=renderer.capabilities.getMaxAnisotropy();t.needsUpdate=true;return t;}

// --- Lighting, Ground, Arena, Mirrors Setup --- (Keep existing)
const ambientLight = new THREE.AmbientLight(0xAAAAAA); scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0); directionalLight.position.set(0, arenaHalfH * 2.5, 0); directionalLight.target.position.set(0, 0, 0); scene.add(directionalLight.target); directionalLight.castShadow = true; directionalLight.shadow.mapSize.width = 1024; directionalLight.shadow.mapSize.height = 1024; directionalLight.shadow.camera.near = 1; directionalLight.shadow.camera.far = arenaHalfH * 4; directionalLight.shadow.camera.left = -arenaHalfW - 2; directionalLight.shadow.camera.right = arenaHalfW + 2; directionalLight.shadow.camera.top = arenaHalfD + 2; directionalLight.shadow.camera.bottom = -arenaHalfD - 2; directionalLight.shadow.bias = -0.003; scene.add(directionalLight);
const groundTexture = createFieldTexture(); const groundGeometry = new THREE.PlaneGeometry(ARENA_WIDTH, ARENA_DEPTH); const groundMaterial = new THREE.MeshStandardMaterial({ map: groundTexture, roughness: 0.8, metalness: 0.05 }); const groundPlane = new THREE.Mesh(groundGeometry, groundMaterial); groundPlane.rotation.x = -Math.PI / 2; groundPlane.position.y = -arenaHalfH - 0.01; groundPlane.receiveShadow = true; scene.add(groundPlane);
const arenaGeometry = new THREE.BoxGeometry(ARENA_WIDTH, ARENA_HEIGHT, ARENA_DEPTH); const arenaEdges = new THREE.EdgesGeometry(arenaGeometry); const arenaMaterial = new THREE.LineBasicMaterial({ color: 0x60a0ff, linewidth: 1.5, transparent: true, opacity: 0.4 }); const arenaWireframe = new THREE.LineSegments(arenaEdges, arenaMaterial); scene.add(arenaWireframe);
const mirrorGeometry = new THREE.PlaneGeometry(ARENA_WIDTH, ARENA_HEIGHT); const mirrorOptions = { clipBias: 0.003, textureWidth: window.innerWidth * window.devicePixelRatio * 0.8, textureHeight: window.innerHeight * window.devicePixelRatio * 0.8, color: 0x778899 }; const mirrorBack = new Reflector(mirrorGeometry, mirrorOptions); mirrorBack.position.set(0, 0, arenaHalfD - 0.02); mirrorBack.rotation.y = Math.PI; scene.add(mirrorBack); const mirrorFront = new Reflector(mirrorGeometry, mirrorOptions); mirrorFront.position.set(0, 0, -arenaHalfD + 0.02); scene.add(mirrorFront); const mirrorGlassMat = new THREE.MeshPhysicalMaterial({ color: 0x557799, transparent: true, opacity: 0.1, metalness: 0.2, roughness: 0.1 }); const glassBack = new THREE.Mesh(mirrorGeometry, mirrorGlassMat); glassBack.position.copy(mirrorBack.position); glassBack.rotation.copy(mirrorBack.rotation); scene.add(glassBack); const glassFront = new THREE.Mesh(mirrorGeometry, mirrorGlassMat); glassFront.position.copy(mirrorFront.position); scene.add(glassFront);

// --- Paddles ---
const blueMaterial = new THREE.MeshStandardMaterial({ color: 0x66aaff, metalness: 0.4, roughness: 0.3, transparent: true });
const bluePaddle = new THREE.Mesh(undefined, blueMaterial); // Geometry set later
bluePaddle.castShadow = true;
scene.add(bluePaddle);

const redMaterial = new THREE.MeshStandardMaterial({ color: 0xff6666, metalness: 0.4, roughness: 0.3, transparent: true });
const redPaddle = new THREE.Mesh(undefined, redMaterial); // Geometry set later
redPaddle.castShadow = true;
scene.add(redPaddle);

// Define playerPaddle reference dynamically based on assignment
let playerPaddle = null; // Will be bluePaddle or redPaddle

// --- Ball --- (Keep existing)
const ballGeometry = new THREE.SphereGeometry(BALL_RADIUS, 24, 24); const ballMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.1, transmission: 0.5, thickness: 0.1 }); const ball = new THREE.Mesh(ballGeometry, ballMaterial); ball.castShadow = true; scene.add(ball);

// --- Ball Position Indicators --- (Keep existing)
const indicatorSize = BALL_RADIUS * 0.6; const indicatorGeometry = new THREE.SphereGeometry(indicatorSize, 8, 8); const indicatorMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 }); const indicators = []; for (let i = 0; i < 12; i++) { const indicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial); indicators.push(indicator); scene.add(indicator); }

// --- Helper Functions ---

// Send message via WebSocket
function sendMessage(type, payload = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, ...payload }));
    } else if (gameMode === 'multi') {
        console.warn("Attempted to send message but WebSocket is not open:", type);
        // Maybe trigger disconnect logic here if needed
    }
}

// Update paddle geometry and appearance
function updatePaddleVisuals(visualWidth) {
    PADDLE_VISUAL_WIDTH = visualWidth;
    const newPaddleGeom = new THREE.BoxGeometry(PADDLE_THICKNESS, PADDLE_HEIGHT, PADDLE_VISUAL_WIDTH);

    // Dispose old geometries if they exist
    if (bluePaddle.geometry) bluePaddle.geometry.dispose();
    if (redPaddle.geometry) redPaddle.geometry.dispose();

    bluePaddle.geometry = newPaddleGeom.clone();
    redPaddle.geometry = newPaddleGeom.clone();

    // Set X positions (Blue on right (+X), Red on left (-X))
    const blueX = arenaHalfW - PADDLE_THICKNESS / 2;
    const redX = -arenaHalfW + PADDLE_THICKNESS / 2;
    bluePaddle.position.set(blueX, 0, 0);
    redPaddle.position.set(redX, 0, 0);

    // Assign correct X constant based on side for later use
    if (myPaddleSide === 'blue') {
        PLAYER_PADDLE_X = blueX;
        AI_PADDLE_X = redX; // Still useful for view calculations etc.
    } else if (myPaddleSide === 'red') {
        PLAYER_PADDLE_X = redX;
        AI_PADDLE_X = blueX;
    } else { // Single player
        PLAYER_PADDLE_X = blueX;
        AI_PADDLE_X = redX;
    }

    // Update transparency
    const isTransparent = paddlesTransparent;
    blueMaterial.transparent = isTransparent;
    redMaterial.transparent = isTransparent;
    blueMaterial.opacity = isTransparent ? 0.65 : 1.0;
    redMaterial.opacity = isTransparent ? 0.65 : 1.0;
    blueMaterial.needsUpdate = true;
    redMaterial.needsUpdate = true;

    // Also update fixed view positions which depend on paddle X
    updateFixedViewPositions();
}

// Update fixed camera positions (dependent on paddle X)
function updateFixedViewPositions() {
    // Ensure initial X positions are calculated if not already
    const blueX = arenaHalfW - PADDLE_THICKNESS / 2;
    const redX = -arenaHalfW + PADDLE_THICKNESS / 2;

    const playerViewX = (myPaddleSide === 'red') ? redX : blueX; // Base view from player's side X
    const opponentViewX = (myPaddleSide === 'red') ? blueX : redX;

    const baseCornerX = playerViewX + (playerViewX > 0 ? 10 : -10); // Offset from player paddle X
    const baseCornerY = arenaHalfH * 0.8;
    const cornerZExtent = arenaHalfD * 0.7;
    const cornerRight = new THREE.Vector3(baseCornerX, baseCornerY, -cornerZExtent);
    const cornerLeft = new THREE.Vector3(baseCornerX, baseCornerY, cornerZExtent);

    views.forEach(view => {
        if (view.name === "Behind Blue Start (Fixed)") { // Rename maybe? "Behind Player Start"
             view.pos.set(playerViewX + (playerViewX > 0 ? 12 : -12), arenaHalfH * 0.6, 0);
             view.lookAt.set(opponentViewX * 0.8, 0, 0);
        } else if (view.type === "dynamic_corner") {
             view.cornerPosStart.copy(cornerRight); // These are relative to player's side
             view.cornerPosEnd.copy(cornerLeft);
        }
    });
     updateViewInfo(); // Update display in case view name changes meaning
}

// UI Update Functions (mostly unchanged, but use gameMode where needed)
function formatGameScore() { const pS = gameScores.blue; const aS = gameScores.red; const pN=["0","15","30","40"]; if(pS>=3 && aS>=3){if(pS===aS)return "Deuce";if(pS===aS+1)return "Ad Blue";if(aS===pS+1)return "Ad Red";} return `${pN[Math.min(pS,3)]} - ${pN[Math.min(aS,3)]}`; }
function updateScoreDisplay() { gameScoreElement.textContent = formatGameScore(); setScoreElement.textContent = `Set: B ${setScores.blue} - ${setScores.red} R | Match: B ${matchScore.blue} - ${matchScore.red} R of ${totalSetsToPlay}`; }
function updateViewInfo() {
    let viewName = views[currentViewIndex].name;
    if (viewName.includes("Blue Side")) {
        viewName = viewName.replace("Blue Side", myPaddleSide === 'blue' ? "Your Side" : "Opponent Side");
    }
    viewInfoElement.textContent = `View: ${viewName}`;
}
function updateVolleyDisplay() { volleyCountElement.textContent = `Volleys: ${volleyCount}`; }

// Game State Change Functions (add networking)
function matchWon(winner) {
    console.log(`Match: ${winner}`);
    isMatchOver = true;
    updateScoreDisplay();
    document.getElementById('match-winner-text').textContent = `${winner.toUpperCase()} WINS THE MATCH!`;
    matchWinnerOverlay.classList.add('visible');
    ballVelocity.set(0, 0, 0);
    touchPauseButton.style.visibility = 'hidden';
    if (gameMode === 'multi' && myPaddleSide === 'blue') { // Host notifies
        sendMessage('match_won', { winner });
    }
}

function setWon(winner) {
    console.log(`Set: ${winner}`);
    matchScore[winner]++;
    setScores = { blue: 0, red: 0 };
    const setsNeeded = Math.ceil(totalSetsToPlay / 2);

    if (gameMode === 'multi' && myPaddleSide === 'blue') { // Host notifies
        sendMessage('set_won', { winner, matchScore });
    }

    if (matchScore[winner] >= setsNeeded) {
        matchWon(winner); // Will notify if host
    } else {
        updateScoreDisplay();
        resetBall(winner === 'blue' ? 1 : -1); // Host (blue) will send ball update
    }
}

function gameWon(winner) {
    console.log(`Game: ${winner}`);
    setScores[winner]++;
    gameScores = { blue: 0, red: 0 };

    if (gameMode === 'multi' && myPaddleSide === 'blue') { // Host notifies
        sendMessage('game_won', { winner, setScores });
    }

    if (setScores[winner] >= gamesNeededToWinSet) {
        setWon(winner); // Will notify if host
    } else {
        updateScoreDisplay();
        resetBall(winner === 'blue' ? 1 : -1); // Host (blue) will send ball update
    }
}

function pointScored(winner) {
    // Only the host (blue) should call this directly in multiplayer
    if (gameMode === 'multi' && myPaddleSide !== 'blue') {
         console.warn("Non-host received scoring trigger. Ignoring.");
         return;
    }

    console.log(`Point: ${winner}`);
    gameScores[winner]++;
    volleyCount = 0;
    updateVolleyDisplay(); // Update locally first

    // Host notifies opponent
    if (gameMode === 'multi') {
        sendMessage('score_update', { gameScores, setScores, matchScore, volleyCount });
    }

    const p = gameScores.blue;
    const a = gameScores.red;
    let gameOver = false;
    if (p >= 3 && a >= 3) { if (p === a + 2 || a === p + 2) gameOver = true; }
    else if (p >= 4 || a >= 4) { gameOver = true; }

    if (gameOver) {
        gameWon(winner); // Will notify if host
    } else {
        updateScoreDisplay(); // Update score display locally
        resetBall(winner === 'blue' ? 1 : -1); // Host (blue) will send ball update
    }
}

function resetBall(direction) {
     // Only the host (blue) should initiate ball reset sequence in multiplayer
    if (gameMode === 'multi' && myPaddleSide !== 'blue') return;

    ball.position.set(0, 0, 0);
    ballSpeed = BALL_SPEED_INITIAL;
    ballVelocity.set(0, 0, 0);
    if (gameMode === 'multi') { // Send immediate position reset
        sendMessage('ball_update', {
            px: ball.position.x, py: ball.position.y, pz: ball.position.z,
            vx: 0, vy: 0, vz: 0, speed: ballSpeed
        });
    }

    // Delay the actual movement start
    setTimeout(() => {
        if (isPaused || !gameStarted || isMatchOver) return;
        // Check again if host (state might change during timeout)
        if (gameMode === 'multi' && myPaddleSide !== 'blue') return;

        ballVelocity.set(
            direction * ballSpeed,
            (Math.random() * 2 - 1) * ballSpeed * 0.6,
            (Math.random() * 2 - 1) * ballSpeed * 0.6
        );
        ballVelocity.normalize().multiplyScalar(ballSpeed);

        // Send initial velocity
        if (gameMode === 'multi') {
            sendMessage('ball_update', {
                 px: ball.position.x, py: ball.position.y, pz: ball.position.z,
                 vx: ballVelocity.x, vy: ballVelocity.y, vz: ballVelocity.z,
                 speed: ballSpeed
            });
        }
    }, 900);
}

function resetMatchState() {
    gameScores = { blue: 0, red: 0 };
    setScores = { blue: 0, red: 0 };
    matchScore = { blue: 0, red: 0 };
    volleyCount = 0;
    isMatchOver = false;
    updateScoreDisplay();
    updateVolleyDisplay();
}

function initializeGameScene(startData) {
     console.log("Initializing game scene with data:", startData);
     selectedPaddleWidth = startData.paddleWidth;
     totalSetsToPlay = startData.setsToPlay;
     selectedDifficulty = startData.difficulty; // Mostly for SP

     gamesNeededToWinSet = Math.ceil(totalSetsToPlay / 2); // Calculate needed wins

     updatePaddleVisuals(selectedPaddleWidth); // Create/update paddles
     resetMatchState(); // Reset scores

     // Assign paddle references based on side
     if (gameMode === 'multi') {
          if (myPaddleSide === 'blue') {
               playerPaddle = bluePaddle;
               opponentPaddle = redPaddle;
          } else {
               playerPaddle = redPaddle;
               opponentPaddle = bluePaddle;
          }
     } else { // Single Player
          playerPaddle = bluePaddle;
          opponentPaddle = redPaddle; // AI controls red
     }

     // Set initial paddle positions (already done in updatePaddleVisuals)
     // playerPaddle.position.set(PLAYER_PADDLE_X, 0, 0);
     // opponentPaddle.position.set(AI_PADDLE_X, 0, 0); // AI/Opponent X

     // Set AI parameters only for single player
     if (gameMode === 'single') {
        if (selectedDifficulty === 'easy') { aiSpeedModifier = 0.60; aiLagModifier = 2.2; aiErrorChance = 0.025; aiErrorMagnitude = PADDLE_HEIGHT * 0.35; }
        else if (selectedDifficulty === 'normal') { aiSpeedModifier = 0.90; aiLagModifier = 1.0; aiErrorChance = 0.004; aiErrorMagnitude = PADDLE_HEIGHT * 0.1; }
        else { aiSpeedModifier = 1.15; aiLagModifier = 0.6; aiErrorChance = 0; aiErrorMagnitude = 0; }
     }

     resetBall(Math.random() > 0.5 ? 1 : -1); // Host (blue) will handle this and send update in MP

     gameStarted = true;
     isPaused = false; // Ensure not paused
     remotePaused = false; // Ensure remote not paused
     isMatchOver = false;
     startMenu.classList.remove('visible');
     pauseMenu.classList.remove('visible');
     matchWinnerOverlay.classList.remove('visible');
     gameUi.style.visibility = 'visible';
     renderer.domElement.style.visibility = 'visible';
     touchPauseButton.style.visibility = 'visible';
     touchPauseButton.classList.remove('paused'); // Ensure correct icon
     updateViewInfo(); // Update view label
     clock.start(); // Start the animation clock
     animate(); // Start the game loop
}

function startGame(isSinglePlayer) {
    if (gameStarted) return;
    gameMode = isSinglePlayer ? 'single' : 'multi'; // Set mode early

    if (isSinglePlayer) {
        myPaddleSide = 'blue'; // Player is always blue in single player
         const startData = {
            paddleWidth: selectedPaddleWidth,
            setsToPlay: totalSetsToPlay,
            difficulty: selectedDifficulty
         };
        initializeGameScene(startData);
    } else {
        // Multiplayer start is triggered by 'start_game' message from server
        connectWebSocket();
    }
}

function connectWebSocket() {
     if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
          console.log("WebSocket already open or connecting.");
          return;
     }

     console.log(`Attempting to connect to ${WS_URL}...`);
     connectionStatusElement.textContent = 'Connecting...';
     startMenu.classList.add('connecting'); // Maybe add styling for this state

     try {
          ws = new WebSocket(WS_URL);

          ws.onopen = () => {
               console.log("WebSocket connection established.");
               connectionStatusElement.textContent = 'Connected! Joining game...';
               sendMessage('join'); // Tell server we want to play
               // Waiting message will be set by server response or timeout
          };

          ws.onmessage = (event) => {
               try {
                    const message = JSON.parse(event.data);
                    // console.log("Message received:", message); // Debugging
                    networkUpdateBuffer.push(message); // Add to buffer for processing in game loop
               } catch (e) {
                    console.error("Error parsing message:", event.data, e);
               }
          };

          ws.onerror = (error) => {
               console.error("WebSocket Error:", error);
               connectionStatusElement.textContent = 'Connection Error!';
               startMenu.classList.remove('connecting');
               // Maybe attempt reconnect or guide user
               ws = null; // Reset ws state
          };

          ws.onclose = (event) => {
               console.log("WebSocket connection closed.", event.code, event.reason);
               connectionStatusElement.textContent = 'Disconnected.';
               startMenu.classList.remove('connecting');
               if (gameStarted) {
                    // If game was running, handle disconnection
                    handleDisconnection("Connection closed");
               }
               ws = null; // Reset ws state
               myPaddleSide = null;
               opponentPaddle = null;
               playerPaddle = null;
          };

     } catch (error) {
          console.error("Failed to create WebSocket:", error);
          connectionStatusElement.textContent = 'Failed to initialize connection.';
          startMenu.classList.remove('connecting');
          ws = null;
     }
}

function processNetworkUpdates() {
     if (networkUpdateBuffer.length === 0) return;

     // Process all messages in the buffer
     const messagesToProcess = networkUpdateBuffer.slice(); // Copy buffer
     networkUpdateBuffer = []; // Clear original buffer immediately

     messagesToProcess.forEach(message => {
         // console.log("Processing:", message.type); // Debug
         switch (message.type) {
             case 'status':
                 connectionStatusElement.textContent = message.message;
                 break;
             case 'assign_paddle':
                 myPaddleSide = message.side;
                 console.log(`Assigned paddle: ${myPaddleSide}`);
                 connectionStatusElement.textContent = `You are ${myPaddleSide.toUpperCase()}. Waiting for game start...`;
                 // Paddle object assignment happens in initializeGameScene
                 break;
             case 'start_game':
                 // Server tells us to start, provides settings
                 if (!gameStarted) {
                     initializeGameScene({
                         paddleWidth: message.paddleWidth,
                         setsToPlay: message.setsToPlay,
                         difficulty: message.difficulty // Maybe irrelevant in MP
                     });
                 } else {
                     console.warn("Received start_game but game already started.");
                 }
                 break;
             case 'paddle_update':
                 // Update opponent's paddle position
                 if (opponentPaddle && gameStarted) {
                     opponentPaddle.position.y = message.y;
                     opponentPaddle.position.z = message.z;
                 }
                 break;
             case 'ball_update':
                 // Update ball state if NOT the host
                 if (gameStarted && myPaddleSide !== 'blue') {
                     ball.position.set(message.px, message.py, message.pz);
                     ballVelocity.set(message.vx, message.vy, message.vz);
                     ballSpeed = message.speed; // Keep speed in sync
                 }
                 break;
             case 'score_update': // Generic score/state sync
                 if (gameStarted && myPaddleSide !== 'blue') { // Only non-host applies score updates directly
                     gameScores = message.gameScores;
                     setScores = message.setScores;
                     matchScore = message.matchScore;
                     volleyCount = message.volleyCount;
                     updateScoreDisplay();
                     updateVolleyDisplay();
                 }
                 break;
              case 'volley_update': // Could be separate if needed
                 if (gameStarted && myPaddleSide !== 'blue') {
                     volleyCount = message.count;
                     updateVolleyDisplay();
                 }
                 break;
             case 'game_won': // Received from host
                  if (gameStarted && myPaddleSide !== 'blue') {
                     setScores[message.winner]++; // Update local set score
                     gameScores = { blue: 0, red: 0 }; // Reset game score
                     updateScoreDisplay();
                     // Reset ball locally based on winner (mirror host logic but without delay/send)
                     ball.position.set(0, 0, 0);
                     ballVelocity.set(0, 0, 0); // Host controls actual launch
                     ballSpeed = BALL_SPEED_INITIAL;
                 }
                 break;
             case 'set_won': // Received from host
                  if (gameStarted && myPaddleSide !== 'blue') {
                     matchScore[message.winner]++; // Update local match score
                     setScores = { blue: 0, red: 0 }; // Reset set score
                     updateScoreDisplay();
                     // Reset ball locally
                     ball.position.set(0, 0, 0);
                     ballVelocity.set(0, 0, 0);
                     ballSpeed = BALL_SPEED_INITIAL;
                 }
                 break;
             case 'match_won': // Received from host
                 if (gameStarted && myPaddleSide !== 'blue') {
                     matchWon(message.winner); // Trigger local match won display
                 }
                 break;
             case 'pause_request':
                 if (gameStarted && !isPaused && !isMatchOver) {
                     isPaused = true;
                     remotePaused = true; // Mark as remotely initiated
                     pauseTitle.textContent = "Paused by Opponent";
                     pauseMessage.textContent = "Waiting for opponent to resume...";
                     resumeButton.disabled = true; // Can't resume if opponent paused
                     pauseMenu.classList.add('visible');
                     touchPauseButton.classList.add('paused'); // Show play icon
                     clock.stop();
                 }
                 break;
             case 'resume_request':
                 if (gameStarted && isPaused && remotePaused) { // Can only resume if opponent paused it
                     isPaused = false;
                     remotePaused = false;
                     pauseMenu.classList.remove('visible');
                     resumeButton.disabled = false; // Re-enable button
                     touchPauseButton.classList.remove('paused'); // Show pause icon
                     clock.start();
                 }
                 break;
             case 'restart_request': // Received from host
                  if(gameStarted && myPaddleSide !== 'blue') {
                     console.log("Restart requested by host, resetting game.");
                     resetGame(); // Reset local state
                  }
                 break;
             case 'opponent_disconnect':
                 handleDisconnection("Opponent disconnected.");
                 break;
             default:
                 console.warn("Unknown message type:", message.type);
         }
     });
}

function handleDisconnection(reason) {
    if (!gameStarted) {
         // If disconnected before game start (e.g., waiting room)
         connectionStatusElement.textContent = reason + " Returning to menu.";
         setTimeout(returnToMainMenu, 2500); // Give time to read message
         return;
    }

    // If game was in progress
    console.log("Handling disconnection:", reason);
    isMatchOver = true; // Stop game logic
    ballVelocity.set(0, 0, 0);
    clock.stop();

    // Show a message on the pause menu or a dedicated overlay
    pauseTitle.textContent = "Disconnected";
    pauseMessage.textContent = reason + " Returning to main menu.";
    resumeButton.disabled = true;
    restartGameButton.disabled = true; // Can't restart alone
    pauseMenu.classList.add('visible');
    touchPauseButton.style.visibility = 'hidden'; // Hide pause button

    // Force back to main menu after a delay
    setTimeout(returnToMainMenu, 3000);
}

function pauseGame() {
    if (!gameStarted || isPaused || isMatchOver) return;
    isPaused = true;
    clock.stop();
    pauseTitle.textContent = "Paused";
    pauseMessage.textContent = ""; // Clear any previous message
    resumeButton.disabled = false; // Local pause can be resumed locally
    pauseMenu.classList.add('visible');
    touchPauseButton.classList.add('paused'); // Show play icon
    if (gameMode === 'multi') {
        sendMessage('pause_request'); // Notify opponent
    }
}

function resumeGame() {
    if (!gameStarted || !isPaused || isMatchOver || remotePaused) return; // Cannot resume if opponent paused
    isPaused = false;
    clock.start();
    pauseMenu.classList.remove('visible');
     touchPauseButton.classList.remove('paused'); // Show pause icon
    if (gameMode === 'multi') {
        sendMessage('resume_request'); // Notify opponent
    }
}

function togglePause() {
    if (isPaused) {
        if (!remotePaused) { // Only resume if locally paused
             resumeGame();
        } else {
             console.log("Cannot resume, paused by opponent.");
        }
    } else {
        pauseGame();
    }
}

// Reset the game (can be called locally or triggered by host)
function resetGame() {
    if (!gameStarted) return;

    if (gameMode === 'multi' && myPaddleSide === 'blue') {
         // Host initiates reset for both
         console.log("Host resetting game, notifying opponent.");
         sendMessage('restart_request'); // Tell opponent to reset too
         // Then reset locally
         resetMatchState();
         playerPaddle.position.set(PLAYER_PADDLE_X, 0, 0);
         opponentPaddle.position.set(AI_PADDLE_X, 0, 0);
         resetBall(Math.random() > 0.5 ? 1 : -1); // Host resets ball
    } else if (gameMode === 'multi' && myPaddleSide === 'red') {
        // Non-host just resets local state upon receiving message or if restarting locally (which shouldn't happen alone)
         console.log("Non-host resetting local game state.");
         resetMatchState();
         playerPaddle.position.set(PLAYER_PADDLE_X, 0, 0);
         opponentPaddle.position.set(AI_PADDLE_X, 0, 0);
         // Ball state will be overwritten by host's update
         ball.position.set(0,0,0);
         ballVelocity.set(0,0,0);
         ballSpeed = BALL_SPEED_INITIAL;
    } else { // Single Player
         resetMatchState();
         playerPaddle.position.set(PLAYER_PADDLE_X, 0, 0);
         opponentPaddle.position.set(AI_PADDLE_X, 0, 0);
         resetBall(Math.random() > 0.5 ? 1 : -1);
    }

     isMatchOver = false; // Ensure match isn't over
     if (isPaused) resumeGame(); // Resume if paused
     matchWinnerOverlay.classList.remove('visible'); // Hide winner screen if shown
     touchPauseButton.style.visibility = 'visible'; // Ensure pause button is visible
}

function returnToMainMenu() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(); // Close connection cleanly
    }
    ws = null; // Nullify reference

    gameStarted = false;
    isPaused = false;
    isMatchOver = false;
    gameMode = 'none';
    myPaddleSide = null;
    playerPaddle = null;
    opponentPaddle = null;
    networkUpdateBuffer = []; // Clear any pending updates

    pauseMenu.classList.remove('visible');
    matchWinnerOverlay.classList.remove('visible');
    gameUi.style.visibility = 'hidden';
    renderer.domElement.style.visibility = 'hidden';
    touchPauseButton.style.visibility = 'hidden';
    connectionStatusElement.textContent = ''; // Clear connection status
    startMenu.classList.remove('connecting'); // Reset start menu state
    startMenu.classList.add('visible');
    clock.stop();
}

// --- Menu Event Listeners ---
paddleOptionButtons.forEach(button => { button.addEventListener('click', () => { paddleOptionButtons.forEach(btn => btn.classList.remove('selected')); button.classList.add('selected'); selectedPaddleWidth = parseFloat(button.dataset.width); }); });
difficultyOptionButtons.forEach(button => { button.addEventListener('click', () => { difficultyOptionButtons.forEach(btn => btn.classList.remove('selected')); button.classList.add('selected'); selectedDifficulty = button.dataset.difficulty; }); });
setsOptionButtons.forEach(button => { button.addEventListener('click', () => { setsOptionButtons.forEach(btn => btn.classList.remove('selected')); button.classList.add('selected'); totalSetsToPlay = parseInt(button.dataset.sets); gamesNeededToWinSet = Math.ceil(totalSetsToPlay / 2); /*updateScoreDisplay(); Don't update score display here, only when game starts*/ }); });
transparencyButton.addEventListener('click', () => { paddlesTransparent = !paddlesTransparent; transparencyButton.textContent = `Transparency: ${paddlesTransparent ? 'ON' : 'OFF'}`; if (gameStarted) updatePaddleVisuals(PADDLE_VISUAL_WIDTH); }); // Update visuals if game running

onePlayerButton.addEventListener('click', () => startGame(true));
twoPlayerButton.addEventListener('click', () => startGame(false)); // Will trigger connectWebSocket

resumeButton.addEventListener('click', resumeGame); // Will only work if locally paused
restartGameButton.addEventListener('click', () => {
    if (gameMode === 'multi') {
        if (myPaddleSide === 'blue') { // Only host can initiate restart
            console.log("Host initiating restart...");
            resetGame(); // Host calls reset, which notifies opponent
        } else {
            console.log("Only the host (Blue) can restart the game.");
            // Optionally show a message?
        }
    } else { // Single player
         if(isPaused) resumeGame(); // Resume first if paused
         resetGame();
    }
});
mainMenuButton.addEventListener('click', returnToMainMenu);
winnerMainMenuButton.addEventListener('click', returnToMainMenu);
touchPauseButton.addEventListener('click', togglePause);

// --- Keyboard Input Handling ---
document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (!gameStarted || isMatchOver) return;
    if (isPaused) {
        // Allow resuming via key ONLY if locally paused
        if (!remotePaused && (key === 'p' || key === 'escape')) {
            resumeGame();
        }
        return; // Ignore other keys when paused
    }
    keysPressed[key] = true;
    if (key === 'v') { currentViewIndex = (currentViewIndex + 1) % views.length; updateViewInfo(); }
    if (key === 'p' || key === 'escape') {
        pauseGame(); // Request pause
    }
    // Prevent default only for keys used by the game
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "s", "a", "d", "v", "p", "escape"].includes(key)) {
        event.preventDefault();
    }
});
document.addEventListener('keyup', (event) => {
    if (!gameStarted || isPaused || isMatchOver) return;
    keysPressed[event.key.toLowerCase()] = false;
});

// --- Touch Input Handling (Revised for Multiplayer) ---
function processTouch(event) {
    if (!gameStarted || isPaused || isMatchOver || !playerPaddle || event.touches.length === 0) return; // Check if playerPaddle assigned
    event.preventDefault(); // Prevent scroll/zoom on active game area

    const touch = event.touches[0];
    const rect = canvas.getBoundingClientRect();
    const touchX = touch.clientX - rect.left;
    const touchY = touch.clientY - rect.top;

    const playerHalfVisW = PADDLE_VISUAL_WIDTH / 2;
    const paddleZExtent = arenaHalfD - playerHalfVisW;
    const targetPaddleZ = THREE.MathUtils.mapLinear(touchX, 0, canvas.clientWidth, paddleZExtent, -paddleZExtent);

    const playerHalfH = PADDLE_HEIGHT / 2;
    const paddleYExtent = arenaHalfH - playerHalfH;
    const targetPaddleY = THREE.MathUtils.mapLinear(touchY, 0, canvas.clientHeight, paddleYExtent, -paddleYExtent);

    // Apply directly to the assigned player paddle
    playerPaddle.position.z = THREE.MathUtils.clamp(targetPaddleZ, -paddleZExtent, paddleZExtent);
    playerPaddle.position.y = THREE.MathUtils.clamp(targetPaddleY, -paddleYExtent, paddleYExtent);
}

canvas.addEventListener('touchstart', processTouch, { passive: false });
canvas.addEventListener('touchmove', processTouch, { passive: false });

// --- Game Loop ---
const clock = new THREE.Clock(false); // Don't start automatically
const tempTargetCamPos = new THREE.Vector3(); const tempTargetLookAt = new THREE.Vector3(); const tempCurrentLookAt = new THREE.Vector3(); const ballTrackLookAt = new THREE.Vector3();
const aiTargetMod = new THREE.Vector2(); // Used only in single player

function animate() {
    // Check if game should stop entirely (e.g., returned to menu)
    if (!gameStarted && gameMode === 'none') {
         console.log("Animation loop stopping.");
         return;
    }

    const animationFrameId = requestAnimationFrame(animate); // Request next frame first

    // Process any incoming network messages
    if (gameMode === 'multi') {
         processNetworkUpdates();
    }

    // Check game state *after* processing network updates
    if (!gameStarted || isPaused || isMatchOver) {
        // Still render the scene even when paused to show the current state
        renderer.render(scene, camera);
        return;
    }

    const deltaTime = clock.getDelta();
    const time = clock.elapsedTime;

    // --- Player Paddle Movement (Keyboard/Touch) ---
    if (playerPaddle) { // Ensure paddle is assigned
        const playerHalfH = PADDLE_HEIGHT / 2;
        const playerHalfVisW = PADDLE_VISUAL_WIDTH / 2;
        const yExtent = arenaHalfH - playerHalfH;
        const zExtent = arenaHalfD - playerHalfVisW;

        let moved = false;

        // Keyboard Input (applies if no touch active - basic check)
        if (navigator.maxTouchPoints === 0 || document.pointerLockElement || !canvas.ontouchstart) {
            if ((keysPressed['w'] || keysPressed['arrowup']) && playerPaddle.position.y < yExtent) { playerPaddle.position.y += PADDLE_SPEED; moved = true; }
            if ((keysPressed['s'] || keysPressed['arrowdown']) && playerPaddle.position.y > -yExtent) { playerPaddle.position.y -= PADDLE_SPEED; moved = true; }
            if ((keysPressed['a'] || keysPressed['arrowleft']) && playerPaddle.position.z < zExtent) { playerPaddle.position.z += PADDLE_SPEED; moved = true; } // Note: A/D move Z-axis
            if ((keysPressed['d'] || keysPressed['arrowright']) && playerPaddle.position.z > -zExtent) { playerPaddle.position.z -= PADDLE_SPEED; moved = true; } // Note: A/D move Z-axis
        }
        // Touch input is handled by event listeners directly modifying playerPaddle.position

        // Clamp position after all inputs
        playerPaddle.position.y = THREE.MathUtils.clamp(playerPaddle.position.y, -yExtent, yExtent);
        playerPaddle.position.z = THREE.MathUtils.clamp(playerPaddle.position.z, -zExtent, zExtent);

        // --- Send Paddle Update (Multiplayer) ---
        if (gameMode === 'multi') {
            const dy = Math.abs(playerPaddle.position.y - lastSentPaddlePos.y);
            const dz = Math.abs(playerPaddle.position.z - lastSentPaddlePos.z);
            if (dy > PADDLE_SEND_THRESHOLD || dz > PADDLE_SEND_THRESHOLD) {
                 sendMessage('paddle_update', { y: playerPaddle.position.y, z: playerPaddle.position.z });
                 lastSentPaddlePos.y = playerPaddle.position.y;
                 lastSentPaddlePos.z = playerPaddle.position.z;
            }
        }
    }

    // --- AI Paddle Movement (Single Player Only) ---
    if (gameMode === 'single' && opponentPaddle) { // opponentPaddle is AI in SP
        let targetY = ball.position.y;
        let targetZ = ball.position.z;
        aiTargetMod.set(0, 0);
        if (aiErrorChance > 0 && Math.random() < aiErrorChance * deltaTime * 60) { // Scale chance by framerate approx
            aiTargetMod.y = (Math.random() - 0.5) * 2 * aiErrorMagnitude;
            aiTargetMod.z = (Math.random() - 0.5) * 2 * aiErrorMagnitude;
            targetY += aiTargetMod.y;
            targetZ += aiTargetMod.z;
        }
        const aiHalfH = PADDLE_HEIGHT / 2;
        const aiHalfVisW = PADDLE_VISUAL_WIDTH / 2;
        const dy = targetY - opponentPaddle.position.y;
        const dz = targetZ - opponentPaddle.position.z;
        const aiSpd = PADDLE_SPEED * 0.85 * aiSpeedModifier;
        const aiLag = AI_PADDLE_LAG_BASE * aiLagModifier;
        if (Math.abs(dy) > 0.1) { opponentPaddle.position.y += Math.sign(dy) * Math.min(aiSpd, Math.abs(dy) * aiLag); }
        if (Math.abs(dz) > 0.1) { opponentPaddle.position.z += Math.sign(dz) * Math.min(aiSpd, Math.abs(dz) * aiLag); }
        opponentPaddle.position.y = THREE.MathUtils.clamp(opponentPaddle.position.y, -arenaHalfH + aiHalfH, arenaHalfH - aiHalfH);
        opponentPaddle.position.z = THREE.MathUtils.clamp(opponentPaddle.position.z, -arenaHalfD + aiHalfVisW, arenaHalfD + aiHalfVisW);
    }
    // In multiplayer, opponentPaddle position is set by network updates

    // --- Ball Movement & Collisions (HOST ONLY in Multiplayer) ---
    if (gameMode === 'single' || (gameMode === 'multi' && myPaddleSide === 'blue')) {
         // Store previous position for collision interpolation if needed (optional)
         // const prevBallPos = ball.position.clone();

         ball.position.addScaledVector(ballVelocity, 1); // Apply velocity (adjust scaling if using deltaTime)

         // Arena Collisions (Top/Bottom/Sides)
         if (ball.position.y + BALL_RADIUS > arenaHalfH || ball.position.y - BALL_RADIUS < -arenaHalfH) {
             ballVelocity.y *= -1;
             ball.position.y = Math.sign(ball.position.y) * (arenaHalfH - BALL_RADIUS);
             ballVelocity.y *= 0.99; // Slight dampening
         }
         if (ball.position.z + BALL_RADIUS > arenaHalfD || ball.position.z - BALL_RADIUS < -arenaHalfD) {
             ballVelocity.z *= -1;
             ball.position.z = Math.sign(ball.position.z) * (arenaHalfD - BALL_RADIUS);
             ballVelocity.z *= 0.99; // Slight dampening
         }

         // Paddle Collisions
         const ballBox = new THREE.Box3().setFromObject(ball);
         const bluePaddleBox = new THREE.Box3().setFromObject(bluePaddle);
         const redPaddleBox = new THREE.Box3().setFromObject(redPaddle);
         let paddleHit = false;

         // Blue Paddle Hit (Right side)
         if (ballVelocity.x > 0 && ball.position.x + BALL_RADIUS >= bluePaddle.position.x - PADDLE_THICKNESS / 2 && ballBox.intersectsBox(bluePaddleBox)) {
             ballVelocity.x *= -1;
             ballSpeed += BALL_SPEED_INCREASE;
             let hitY = THREE.MathUtils.clamp((ball.position.y - bluePaddle.position.y) / (PADDLE_HEIGHT / 2), -1, 1);
             let hitZ = THREE.MathUtils.clamp((ball.position.z - bluePaddle.position.z) / (PADDLE_VISUAL_WIDTH / 2), -1, 1); // Divide by HALF width
             ballVelocity.y += hitY * ballSpeed * 0.5;
             ballVelocity.z += hitZ * ballSpeed * 0.5;
             ballVelocity.normalize().multiplyScalar(ballSpeed);
             ball.position.x = bluePaddle.position.x - PADDLE_THICKNESS / 2 - BALL_RADIUS - 0.01; // Move outside paddle
             paddleHit = true;
         }
         // Red Paddle Hit (Left side)
         else if (ballVelocity.x < 0 && ball.position.x - BALL_RADIUS <= redPaddle.position.x + PADDLE_THICKNESS / 2 && ballBox.intersectsBox(redPaddleBox)) {
             ballVelocity.x *= -1;
             ballSpeed += BALL_SPEED_INCREASE;
             let hitY = THREE.MathUtils.clamp((ball.position.y - redPaddle.position.y) / (PADDLE_HEIGHT / 2), -1, 1);
             let hitZ = THREE.MathUtils.clamp((ball.position.z - redPaddle.position.z) / (PADDLE_VISUAL_WIDTH / 2), -1, 1); // Divide by HALF width
             // Slightly different AI spin/randomness (can apply in MP too if host)
             const randomSpinY = (gameMode === 'single' || myPaddleSide === 'blue') ? (Math.random() - 0.5) * ballSpeed * 0.15 : 0;
             const randomSpinZ = (gameMode === 'single' || myPaddleSide === 'blue') ? (Math.random() - 0.5) * ballSpeed * 0.15 : 0;
             ballVelocity.y += hitY * ballSpeed * 0.4 + randomSpinY;
             ballVelocity.z += hitZ * ballSpeed * 0.4 + randomSpinZ;
             ballVelocity.normalize().multiplyScalar(ballSpeed);
             ball.position.x = redPaddle.position.x + PADDLE_THICKNESS / 2 + BALL_RADIUS + 0.01; // Move outside paddle
             paddleHit = true;
         }

         if (paddleHit) {
             volleyCount++;
             updateVolleyDisplay();
             if (gameMode === 'multi') { // Host sends volley update
                 sendMessage('volley_update', { count: volleyCount });
             }
         }

         // --- Scoring ---
         if (ball.position.x > arenaHalfW + BALL_RADIUS * 2) {
             pointScored('red'); // Red player scores
         } else if (ball.position.x < -arenaHalfW - BALL_RADIUS * 2) {
             pointScored('blue'); // Blue player scores
         }

         // --- Send Ball Update (Multiplayer Host) ---
         if (gameMode === 'multi' && myPaddleSide === 'blue' && time > lastBallSendTime + BALL_SEND_INTERVAL) {
             sendMessage('ball_update', {
                 px: ball.position.x, py: ball.position.y, pz: ball.position.z,
                 vx: ballVelocity.x, vy: ballVelocity.y, vz: ballVelocity.z,
                 speed: ballSpeed
             });
             lastBallSendTime = time;
         }
     }
     // Non-host ball position is updated via network messages

    // --- Update Ball Position Indicators (Always done locally) ---
    const clX=THREE.MathUtils.clamp(ball.position.x,-arenaHalfW,arenaHalfW); const clY=THREE.MathUtils.clamp(ball.position.y,-arenaHalfH,arenaHalfH); const clZ=THREE.MathUtils.clamp(ball.position.z,-arenaHalfD,arenaHalfD); indicators[0].position.set(-arenaHalfW,clY,-arenaHalfD); indicators[1].position.set(arenaHalfW,clY,-arenaHalfD); indicators[2].position.set(-arenaHalfW,clY,arenaHalfD); indicators[3].position.set(arenaHalfW,clY,arenaHalfD); indicators[4].position.set(clX,-arenaHalfH,-arenaHalfD); indicators[5].position.set(clX,-arenaHalfH,arenaHalfD); indicators[6].position.set(clX,arenaHalfH,-arenaHalfD); indicators[7].position.set(clX,arenaHalfH,arenaHalfD); indicators[8].position.set(-arenaHalfW,-arenaHalfH,clZ); indicators[9].position.set(arenaHalfW,-arenaHalfH,clZ); indicators[10].position.set(-arenaHalfW,arenaHalfH,clZ); indicators[11].position.set(arenaHalfW,arenaHalfH,clZ);

    // --- Update Camera ---
    const currentView = views[currentViewIndex];
    const lerpFactor = 0.08; // Camera smoothness

    if (currentView.type === "dynamic_corner") {
        let t_raw = (ball.position.z + arenaHalfD) / ARENA_DEPTH;
        let interp = THREE.MathUtils.clamp(t_raw, 0, 1);
        if (currentView.name.includes("Inverted")) { interp = 1.0 - interp; }
        tempTargetCamPos.lerpVectors(currentView.cornerPosStart, currentView.cornerPosEnd, interp);
        ballTrackLookAt.copy(ball.position);
        ballTrackLookAt.y -= BALL_RADIUS * 0.2; // Look slightly below center
        tempTargetLookAt.copy(ballTrackLookAt);
    } else { // Static views
        tempTargetCamPos.copy(currentView.pos);
        tempTargetLookAt.copy(currentView.lookAt);
    }

    camera.position.lerp(tempTargetCamPos, lerpFactor);

    // Smooth lookAt transition
    camera.getWorldDirection(tempCurrentLookAt).multiplyScalar(15).add(camera.position); // Get current lookAt point
    tempCurrentLookAt.lerp(tempTargetLookAt, lerpFactor);
    camera.lookAt(tempCurrentLookAt);

    // --- Render Scene ---
    renderer.render(scene, camera);
}

// --- Handle Window Resize ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Update mirror texture sizes maybe? (Optional performance consideration)
}, false);

// --- Initial Setup ---
transparencyButton.textContent = `Transparency: ${paddlesTransparent ? 'ON' : 'OFF'}`;
// updatePaddleVisuals(selectedPaddleWidth); // Paddles created on game start now
resetMatchState(); // Initial score setup
updateFixedViewPositions(); // Set up camera views initially
// Don't start animate() here, it starts when game begins

            // --- Ball Movement & Collisions ---
            ball.position.addScaledVector(ballVelocity,1); if(ball.position.y+BALL_RADIUS>arenaHalfH||ball.position.y-BALL_RADIUS<-arenaHalfH){ballVelocity.y*=-1; ball.position.y=Math.sign(ball.position.y)*(arenaHalfH-BALL_RADIUS); ballVelocity.y*=0.99;} if(ball.position.z+BALL_RADIUS>arenaHalfD||ball.position.z-BALL_RADIUS<-arenaHalfD){ballVelocity.z*=-1; ball.position.z=Math.sign(ball.position.z)*(arenaHalfD-BALL_RADIUS); ballVelocity.z*=0.99;} const ballBox=new THREE.Box3().setFromObject(ball); const playerBox=new THREE.Box3().setFromObject(playerPaddle); const aiBox=new THREE.Box3().setFromObject(aiPaddle); let paddleHit=false; if(ballVelocity.x>0&&ball.position.x+BALL_RADIUS>=PLAYER_PADDLE_X-PADDLE_THICKNESS/2&&ballBox.intersectsBox(playerBox)){ballVelocity.x*=-1; ballSpeed+=BALL_SPEED_INCREASE; let hitY=THREE.MathUtils.clamp((ball.position.y-playerPaddle.position.y)/(PADDLE_HEIGHT/2),-1,1); let hitZ=THREE.MathUtils.clamp((ball.position.z-playerPaddle.position.z)/PADDLE_VISUAL_WIDTH,-1,1); ballVelocity.y+=hitY*ballSpeed*0.5; ballVelocity.z+=hitZ*ballSpeed*0.5; ballVelocity.normalize().multiplyScalar(ballSpeed); ball.position.x=PLAYER_PADDLE_X-PADDLE_THICKNESS/2-BALL_RADIUS-0.01; paddleHit=true;} else if(ballVelocity.x<0&&ball.position.x-BALL_RADIUS<=AI_PADDLE_X+PADDLE_THICKNESS/2&&ballBox.intersectsBox(aiBox)){ballVelocity.x*=-1; ballSpeed+=BALL_SPEED_INCREASE; let hitY=THREE.MathUtils.clamp((ball.position.y-aiPaddle.position.y)/(PADDLE_HEIGHT/2),-1,1); let hitZ=THREE.MathUtils.clamp((ball.position.z-aiPaddle.position.z)/PADDLE_VISUAL_WIDTH,-1,1); ballVelocity.y+=hitY*ballSpeed*0.4+(Math.random()-0.5)*ballSpeed*0.15; ballVelocity.z+=hitZ*ballSpeed*0.4+(Math.random()-0.5)*ballSpeed*0.15; ballVelocity.normalize().multiplyScalar(ballSpeed); ball.position.x=AI_PADDLE_X+PADDLE_THICKNESS/2+BALL_RADIUS+0.01; paddleHit=true;} if(paddleHit){volleyCount++; updateVolleyDisplay();}

            // --- Scoring ---
            if (ball.position.x > arenaHalfW + BALL_RADIUS * 2) { pointScored('red'); } else if (ball.position.x < -arenaHalfW - BALL_RADIUS * 2) { pointScored('blue'); }

            // --- Update Ball Position Indicators ---
            const clX=THREE.MathUtils.clamp(ball.position.x,-arenaHalfW,arenaHalfW); const clY=THREE.MathUtils.clamp(ball.position.y,-arenaHalfH,arenaHalfH); const clZ=THREE.MathUtils.clamp(ball.position.z,-arenaHalfD,arenaHalfD); indicators[0].position.set(-arenaHalfW,clY,-arenaHalfD); indicators[1].position.set(arenaHalfW,clY,-arenaHalfD); indicators[2].position.set(-arenaHalfW,clY,arenaHalfD); indicators[3].position.set(arenaHalfW,clY,arenaHalfD); indicators[4].position.set(clX,-arenaHalfH,-arenaHalfD); indicators[5].position.set(clX,-arenaHalfH,arenaHalfD); indicators[6].position.set(clX,arenaHalfH,-arenaHalfD); indicators[7].position.set(clX,arenaHalfH,arenaHalfD); indicators[8].position.set(-arenaHalfW,-arenaHalfH,clZ); indicators[9].position.set(arenaHalfW,-arenaHalfH,clZ); indicators[10].position.set(-arenaHalfW,arenaHalfH,clZ); indicators[11].position.set(arenaHalfW,arenaHalfH,clZ);

            // --- Update Camera ---
            const currentView=views[currentViewIndex]; if(currentView.type==="dynamic_corner"){let t_raw=(ball.position.z+arenaHalfD)/ARENA_DEPTH; let interp=THREE.MathUtils.clamp(t_raw,0,1); if(currentView.name.includes("Inverted")){interp=1.0-interp;} tempTargetCamPos.lerpVectors(currentView.cornerPosStart,currentView.cornerPosEnd,interp); ballTrackLookAt.copy(ball.position); ballTrackLookAt.y-=BALL_RADIUS*0.2; tempTargetLookAt.copy(ballTrackLookAt);}else{tempTargetCamPos.copy(currentView.pos); tempTargetLookAt.copy(currentView.lookAt);} camera.position.lerp(tempTargetCamPos,0.08); camera.getWorldDirection(tempCurrentLookAt).multiplyScalar(15).add(camera.position); tempCurrentLookAt.lerp(tempTargetLookAt,0.08); camera.lookAt(tempCurrentLookAt);

            // --- Render Scene ---
            renderer.render(scene, camera);
        }

        // --- Handle Window Resize ---
        window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); }, false);
        // --- Initial Setup ---
        transparencyButton.textContent = `Transparency: ${paddlesTransparent ? 'ON' : 'OFF'}`; // Set initial button text
        resetMatchState(); updateFixedViewPositions();
    </script>
