<!-- Canvas -->
    <script type="module">
        import * as THREE from 'three';
        import { Reflector } from 'three/addons/objects/Reflector.js';
        import { CubeTextureLoader } from 'three';
        // --- Global State ---
        let gameStarted = false; let isPaused = false; let isMatchOver = false;
        let selectedPaddleWidth = 1.0; let PADDLE_VISUAL_WIDTH = 1.0; const PADDLE_THICKNESS = 0.4;
        let selectedDifficulty = 'normal'; let aiSpeedModifier = 1.0; let aiLagModifier = 1.0; let aiErrorChance = 0; let aiErrorMagnitude = 0;
        let paddlesTransparent = true; 
        let totalSetsToPlay = 3; let gamesNeededToWinSet = 2;

        // --- DOM Elements ---
        const startMenu = document.getElementById('start-menu'); const pauseMenu = document.getElementById('pause-menu'); const matchWinnerOverlay = document.getElementById('match-winner-overlay');
        const gameUi = document.getElementById('game-ui'); const gameScoreElement = document.getElementById('game-score'); const setScoreElement = document.getElementById('set-score'); const volleyCountElement = document.getElementById('volley-count');
        const viewInfoElement = document.getElementById('view-info'); const startButton = document.getElementById('start-button'); const resumeButton = document.getElementById('resume-button'); const restartGameButton = document.getElementById('restart-game-button'); const mainMenuButton = document.getElementById('main-menu-button'); const winnerMainMenuButton = document.getElementById('winner-main-menu-button');
        const paddleOptionButtons = document.querySelectorAll('.paddle-option'); const difficultyOptionButtons = document.querySelectorAll('.difficulty-option'); const setsOptionButtons = document.querySelectorAll('.sets-option'); const transparencyButton = document.getElementById('transparency-button');
        const touchPauseButton = document.getElementById('touch-pause-button'); // <<< Pause Button Element

        // --- Scene Setup ---
        const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight); renderer.setClearColor(0x050515);
        renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.domElement.style.visibility = 'hidden'; document.body.appendChild(renderer.domElement);
        const canvas = renderer.domElement; // Cache canvas element

         // --- Space Background ---
        const cubeLoader = new CubeTextureLoader();
        const spaceTexture = cubeLoader.load([ /* Placeholder URLs */
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPgvAQADPgGHRg9GLwAAAABJRU5ErkJggg==', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mOor6/nDwAFsQJQ91z78gAAAABJRU5ErkJggg==',
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mPkYPgPEwAD5gHlS/jZzwAAAABJRU5ErkJggg==', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkOPwvAQADBQGhMAXTeAAAAABJRU5ErkJggg==',
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkGAY/wQAAAZ8Anvg0pxYAAAAASUVORK5CYII=', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A+/DAAKPQGpBs976wAAAABJRU5ErkJggg=='
        ], () => { scene.background = spaceTexture; console.log("BG loaded."); }, undefined, (err) => { console.error("BG load error:", err); });

        // --- Game Constants ---
        const ARENA_WIDTH = 22; const ARENA_HEIGHT = 12; const ARENA_DEPTH = 16;
        const arenaHalfW = ARENA_WIDTH / 2; const arenaHalfH = ARENA_HEIGHT / 2; const arenaHalfD = ARENA_DEPTH / 2;
        const BALL_RADIUS = 0.3; const PADDLE_HEIGHT = 3;
        let PLAYER_PADDLE_X = 0; let AI_PADDLE_X = 0;
        const PADDLE_SPEED = 0.18; const BALL_SPEED_INITIAL = 0.11; const BALL_SPEED_INCREASE = 0.006; const AI_PADDLE_LAG_BASE = 0.07;

        // --- Game State Variables ---
        let ballSpeed = BALL_SPEED_INITIAL; let keysPressed = {}; let volleyCount = 0;
        let gameScores = { blue: 0, red: 0 }; let setScores = { blue: 0, red: 0 }; let matchScore = { blue: 0, red: 0 };
        let ballVelocity = new THREE.Vector3(0, 0, 0);

        // --- Camera Views ---
        const centerLookAt = new THREE.Vector3(0, 0, 0);
        const views = [
             { name: "Standard Overview", type: "static", pos: new THREE.Vector3(0, arenaHalfH * 1.8, arenaHalfD * 1.4), lookAt: new THREE.Vector3(0, -arenaHalfH * 0.3, 0) },
             { name: "Behind Blue Start (Fixed)", type: "static", pos: new THREE.Vector3(0,0,0), lookAt: new THREE.Vector3(0,0,0) },
             { name: "Dynamic Corner (Blue Side)", type: "dynamic_corner", cornerPosStart: new THREE.Vector3(), cornerPosEnd:   new THREE.Vector3(), lookAtMode: "ball" },
             { name: "Dynamic Corner Inverted (Blue Side)", type: "dynamic_corner", cornerPosStart: new THREE.Vector3(), cornerPosEnd:   new THREE.Vector3(), lookAtMode: "ball" },
             { name: "Top Down", type: "static", pos: new THREE.Vector3(0, arenaHalfH * 3.5, 0), lookAt: centerLookAt },
             { name: "Side View (Left)", type: "static", pos: new THREE.Vector3(0, 0, arenaHalfD * 1.8), lookAt: centerLookAt },
             { name: "Side View (Right)", type: "static", pos: new THREE.Vector3(0, 0, -arenaHalfD * 1.8), lookAt: centerLookAt }
        ];
        let currentViewIndex = 2; // Default View

        // --- Field Texture Function ---
        function createFieldTexture() { const c=document.createElement('canvas'); c.width=512; c.height=512; const x=c.getContext('2d'); x.fillStyle='#183818'; x.fillRect(0,0,512,512); for(let i=0;i<8000;i++){ const a=Math.random()*512,b=Math.random()*512,s=Math.random()*0.1+0.95; x.fillStyle=`rgb(${Math.floor(24*s)},${Math.floor(56*s)},${Math.floor(24*s)})`; x.fillRect(a,b,1,1);} const nl=11,ls=512/(nl-1); x.strokeStyle='rgba(200,200,220,0.7)'; x.lineWidth=3; x.beginPath(); for(let i=0;i<nl;i++){const a=i*ls; x.moveTo(a,0);x.lineTo(a,512);} x.stroke(); const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(ARENA_WIDTH/15, ARENA_DEPTH/15); t.anisotropy=renderer.capabilities.getMaxAnisotropy();t.needsUpdate=true;return t;}

        // --- Lighting, Ground, Arena, Mirrors Setup ---
        const ambientLight = new THREE.AmbientLight(0xAAAAAA); scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0); directionalLight.position.set(0, arenaHalfH * 2.5, 0); directionalLight.target.position.set(0, 0, 0); scene.add(directionalLight.target); directionalLight.castShadow = true; directionalLight.shadow.mapSize.width = 1024; directionalLight.shadow.mapSize.height = 1024; directionalLight.shadow.camera.near = 1; directionalLight.shadow.camera.far = arenaHalfH * 4; directionalLight.shadow.camera.left = -arenaHalfW - 2; directionalLight.shadow.camera.right = arenaHalfW + 2; directionalLight.shadow.camera.top = arenaHalfD + 2; directionalLight.shadow.camera.bottom = -arenaHalfD - 2; directionalLight.shadow.bias = -0.003; scene.add(directionalLight);
        const groundTexture = createFieldTexture(); const groundGeometry = new THREE.PlaneGeometry(ARENA_WIDTH, ARENA_DEPTH); const groundMaterial = new THREE.MeshStandardMaterial({ map: groundTexture, roughness: 0.8, metalness: 0.05 }); const groundPlane = new THREE.Mesh(groundGeometry, groundMaterial); groundPlane.rotation.x = -Math.PI / 2; groundPlane.position.y = -arenaHalfH - 0.01; groundPlane.receiveShadow = true; scene.add(groundPlane);
        const arenaGeometry = new THREE.BoxGeometry(ARENA_WIDTH, ARENA_HEIGHT, ARENA_DEPTH); const arenaEdges = new THREE.EdgesGeometry(arenaGeometry); const arenaMaterial = new THREE.LineBasicMaterial({ color: 0x60a0ff, linewidth: 1.5, transparent: true, opacity: 0.4 }); const arenaWireframe = new THREE.LineSegments(arenaEdges, arenaMaterial); scene.add(arenaWireframe);
        const mirrorGeometry = new THREE.PlaneGeometry(ARENA_WIDTH, ARENA_HEIGHT); const mirrorOptions = { clipBias: 0.003, textureWidth: window.innerWidth * window.devicePixelRatio * 0.8, textureHeight: window.innerHeight * window.devicePixelRatio * 0.8, color: 0x778899 }; const mirrorBack = new Reflector(mirrorGeometry, mirrorOptions); mirrorBack.position.set(0, 0, arenaHalfD - 0.02); mirrorBack.rotation.y = Math.PI; scene.add(mirrorBack); const mirrorFront = new Reflector(mirrorGeometry, mirrorOptions); mirrorFront.position.set(0, 0, -arenaHalfD + 0.02); scene.add(mirrorFront); const mirrorGlassMat = new THREE.MeshPhysicalMaterial({ color: 0x557799, transparent: true, opacity: 0.1, metalness: 0.2, roughness: 0.1 }); const glassBack = new THREE.Mesh(mirrorGeometry, mirrorGlassMat); glassBack.position.copy(mirrorBack.position); glassBack.rotation.copy(mirrorBack.rotation); scene.add(glassBack); const glassFront = new THREE.Mesh(mirrorGeometry, mirrorGlassMat); glassFront.position.copy(mirrorFront.position); scene.add(glassFront);

        // --- Paddles ---
        const playerMaterial = new THREE.MeshStandardMaterial({ color: 0x66aaff, metalness: 0.4, roughness: 0.3, transparent: true }); const playerPaddle = new THREE.Mesh(undefined, playerMaterial); playerPaddle.castShadow = true; scene.add(playerPaddle);
        const aiMaterial = new THREE.MeshStandardMaterial({ color: 0xff6666, metalness: 0.4, roughness: 0.3, transparent: true }); const aiPaddle = new THREE.Mesh(undefined, aiMaterial); aiPaddle.castShadow = true; scene.add(aiPaddle);

        // --- Ball ---
        const ballGeometry = new THREE.SphereGeometry(BALL_RADIUS, 24, 24); const ballMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.1, transmission: 0.5, thickness: 0.1 }); const ball = new THREE.Mesh(ballGeometry, ballMaterial); ball.castShadow = true; scene.add(ball);

        // --- Ball Position Indicators ---
        const indicatorSize = BALL_RADIUS * 0.6; const indicatorGeometry = new THREE.SphereGeometry(indicatorSize, 8, 8); const indicatorMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 }); const indicators = []; for (let i = 0; i < 12; i++) { const indicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial); indicators.push(indicator); scene.add(indicator); }

        // --- Functions ---
        function updateFixedViewPositions() { if (PLAYER_PADDLE_X === 0) { PLAYER_PADDLE_X = arenaHalfW - PADDLE_THICKNESS / 2; AI_PADDLE_X = -arenaHalfW + PADDLE_THICKNESS / 2; } const baseCornerX = PLAYER_PADDLE_X + 10; const baseCornerY = arenaHalfH * 0.8; const cornerZExtent = arenaHalfD * 0.7; const cornerRight = new THREE.Vector3(baseCornerX, baseCornerY, -cornerZExtent); const cornerLeft = new THREE.Vector3(baseCornerX, baseCornerY, cornerZExtent); views.forEach(view => { if (view.name === "Behind Blue Start (Fixed)") { view.pos.set(PLAYER_PADDLE_X + 12, arenaHalfH * 0.6, 0); view.lookAt.set(AI_PADDLE_X * 0.8, 0, 0); } else if (view.type === "dynamic_corner") { view.cornerPosStart.copy(cornerRight); view.cornerPosEnd.copy(cornerLeft); } }); }
        function updatePaddles(visualWidth) { /* ... applies transparency */ PADDLE_VISUAL_WIDTH = visualWidth; PLAYER_PADDLE_X = arenaHalfW - PADDLE_THICKNESS / 2; AI_PADDLE_X = -arenaHalfW + PADDLE_THICKNESS / 2; const newPaddleGeom = new THREE.BoxGeometry(PADDLE_THICKNESS, PADDLE_HEIGHT, PADDLE_VISUAL_WIDTH); if (playerPaddle.geometry) playerPaddle.geometry.dispose(); if (aiPaddle.geometry) aiPaddle.geometry.dispose(); playerPaddle.geometry = newPaddleGeom; aiPaddle.geometry = newPaddleGeom; playerPaddle.position.set(PLAYER_PADDLE_X, 0, 0); aiPaddle.position.set(AI_PADDLE_X, 0, 0); updateFixedViewPositions(); const isTransparent = paddlesTransparent; playerMaterial.transparent = isTransparent; aiMaterial.transparent = isTransparent; playerMaterial.opacity = isTransparent ? 0.65 : 1.0; aiMaterial.opacity = isTransparent ? 0.65 : 1.0; playerMaterial.needsUpdate = true; aiMaterial.needsUpdate = true; }
        function formatGameScore() { const pS = gameScores.blue; const aS = gameScores.red; const pN=["0","15","30","40"]; if(pS>=3 && aS>=3){if(pS===aS)return "Deuce";if(pS===aS+1)return "Ad Blue";if(aS===pS+1)return "Ad Red";} return `${pN[Math.min(pS,3)]} - ${pN[Math.min(aS,3)]}`; }
        function updateScoreDisplay() { gameScoreElement.textContent = formatGameScore(); setScoreElement.textContent = `Set: B ${setScores.blue} - ${setScores.red} R | Match: B ${matchScore.blue} - ${matchScore.red} R of ${totalSetsToPlay}`; }
        function updateViewInfo() { viewInfoElement.textContent = `View: ${views[currentViewIndex].name.replace("(Player Side)", "(Blue Side)")}`; }
        function updateVolleyDisplay() { volleyCountElement.textContent = `Volleys: ${volleyCount}`; }
        function matchWon(winner) { console.log(`Match: ${winner}`); isMatchOver = true; updateScoreDisplay(); document.getElementById('match-winner-text').textContent = `${winner.toUpperCase()} WINS THE MATCH!`; matchWinnerOverlay.classList.add('visible'); ballVelocity.set(0,0,0); touchPauseButton.style.visibility = 'hidden'; } // Hide pause button on win
        function setWon(winner) { console.log(`Set: ${winner}`); matchScore[winner]++; setScores = { blue: 0, red: 0 }; const setsNeeded = Math.ceil(totalSetsToPlay / 2); if (matchScore[winner] >= setsNeeded) { matchWon(winner); } else { updateScoreDisplay(); resetBall(winner === 'blue' ? 1 : -1); } }
        function gameWon(winner) { console.log(`Game: ${winner}`); setScores[winner]++; gameScores = { blue: 0, red: 0 }; if (setScores[winner] >= gamesNeededToWinSet) { setWon(winner); } else { updateScoreDisplay(); resetBall(winner === 'blue' ? 1 : -1); } }
        function pointScored(winner) { console.log(`Point: ${winner}`); gameScores[winner]++; volleyCount = 0; updateVolleyDisplay(); const p = gameScores.blue; const a = gameScores.red; let gameOver = false; if(p>=3&&a>=3){if(p===a+2||a===p+2)gameOver=true;}else if(p>=4||a>=4){gameOver=true;} if(gameOver){gameWon(winner);}else{updateScoreDisplay();resetBall(winner==='blue'?1:-1);} }
        function resetBall(direction) { ball.position.set(0, 0, 0); ballSpeed = BALL_SPEED_INITIAL; ballVelocity.set(0, 0, 0); setTimeout(() => { if (isPaused || !gameStarted || isMatchOver) return; ballVelocity.set( direction * ballSpeed, (Math.random() * 2 - 1) * ballSpeed * 0.6, (Math.random() * 2 - 1) * ballSpeed * 0.6 ); ballVelocity.normalize().multiplyScalar(ballSpeed); }, 900); }
        function resetMatchState() { gameScores = { blue: 0, red: 0 }; setScores = { blue: 0, red: 0 }; matchScore = { blue: 0, red: 0 }; volleyCount = 0; isMatchOver = false; updateScoreDisplay(); updateVolleyDisplay(); }
        function resetGame(isInitialStart = false) { resetMatchState(); if (!isInitialStart && playerPaddle.geometry) { playerPaddle.position.set(PLAYER_PADDLE_X, 0, 0); aiPaddle.position.set(AI_PADDLE_X, 0, 0); } resetBall(Math.random() > 0.5 ? 1 : -1); }
        function returnToMainMenu() { if (isPaused) resumeGame(); gameStarted = false; isPaused = false; isMatchOver = false; pauseMenu.classList.remove('visible'); matchWinnerOverlay.classList.remove('visible'); gameUi.style.visibility = 'hidden'; renderer.domElement.style.visibility = 'hidden'; touchPauseButton.style.visibility = 'hidden'; startMenu.classList.add('visible'); }
        function startGame() { if (gameStarted) return; if (selectedDifficulty === 'easy') { aiSpeedModifier = 0.60; aiLagModifier = 2.2; aiErrorChance = 0.025; aiErrorMagnitude = PADDLE_HEIGHT * 0.35; } else if (selectedDifficulty === 'normal') { aiSpeedModifier = 0.90; aiLagModifier = 1.0; aiErrorChance = 0.004; aiErrorMagnitude = PADDLE_HEIGHT * 0.1; } else { aiSpeedModifier = 1.15; aiLagModifier = 0.6; aiErrorChance = 0; aiErrorMagnitude = 0; } updatePaddles(selectedPaddleWidth); resetGame(true); gameStarted = true; isPaused = false; isMatchOver = false; startMenu.classList.remove('visible'); pauseMenu.classList.remove('visible'); matchWinnerOverlay.classList.remove('visible'); gameUi.style.visibility = 'visible'; renderer.domElement.style.visibility = 'visible'; touchPauseButton.style.visibility = 'visible'; updateViewInfo(); clock.start(); animate(); }
        function pauseGame() { if (!gameStarted || isPaused || isMatchOver) return; isPaused = true; pauseMenu.classList.add('visible'); clock.stop(); }
        function resumeGame() { if (!gameStarted || !isPaused || isMatchOver) return; isPaused = false; pauseMenu.classList.remove('visible'); clock.start(); }
        function togglePause() { if(isPaused) resumeGame(); else pauseGame(); }

        // --- Menu Event Listeners ---
        paddleOptionButtons.forEach(button => { button.addEventListener('click', () => { paddleOptionButtons.forEach(btn => btn.classList.remove('selected')); button.classList.add('selected'); selectedPaddleWidth = parseFloat(button.dataset.width); }); });
        difficultyOptionButtons.forEach(button => { button.addEventListener('click', () => { difficultyOptionButtons.forEach(btn => btn.classList.remove('selected')); button.classList.add('selected'); selectedDifficulty = button.dataset.difficulty; }); });
        setsOptionButtons.forEach(button => { button.addEventListener('click', () => { setsOptionButtons.forEach(btn => btn.classList.remove('selected')); button.classList.add('selected'); totalSetsToPlay = parseInt(button.dataset.sets); gamesNeededToWinSet = Math.ceil(totalSetsToPlay / 2); updateScoreDisplay(); }); });
        transparencyButton.addEventListener('click', () => { paddlesTransparent = !paddlesTransparent; transparencyButton.textContent = `Transparency: ${paddlesTransparent ? 'ON' : 'OFF'}`; if (gameStarted) updatePaddles(PADDLE_VISUAL_WIDTH); });
        startButton.addEventListener('click', startGame); resumeButton.addEventListener('click', resumeGame);
        restartGameButton.addEventListener('click', () => { if(!isPaused) return; resumeGame(); resetGame(); });
        mainMenuButton.addEventListener('click', returnToMainMenu); winnerMainMenuButton.addEventListener('click', returnToMainMenu);
        touchPauseButton.addEventListener('click', togglePause); // <<< Listener for touch pause

        // --- Keyboard Input Handling ---
        document.addEventListener('keydown', (event) => { const key = event.key.toLowerCase(); if (!gameStarted || isMatchOver) return; if (isPaused) { if (key === 'p' || key === 'escape') { resumeGame(); } return; } keysPressed[key] = true; if (key === 'v') { currentViewIndex = (currentViewIndex + 1) % views.length; updateViewInfo(); } if (key === 'p' || key === 'escape') { pauseGame(); } if (["arrowup", "arrowdown", "w", "s", "a", "d", "v", "p", "escape"].includes(key)) { event.preventDefault(); } });
        document.addEventListener('keyup', (event) => { if (!gameStarted || isPaused || isMatchOver) return; keysPressed[event.key.toLowerCase()] = false; });

        // --- Touch Input Handling (Revised) ---
         function processTouch(event) {
             if (!gameStarted || isPaused || isMatchOver || event.touches.length === 0) return;
             event.preventDefault(); // Prevent scroll/zoom on active game area

             const touch = event.touches[0];
             // Get touch relative to canvas
             const rect = canvas.getBoundingClientRect();
             const touchX = touch.clientX - rect.left;
             const touchY = touch.clientY - rect.top;

             // Map X touch coord (0 to canvasWidth) to Paddle Z coord (arenaHalfD-halfPaddle down to -arenaHalfD+halfPaddle)
             const playerHalfVisW = PADDLE_VISUAL_WIDTH / 2;
             const paddleZExtent = arenaHalfD - playerHalfVisW; // Max distance from center Z
             const targetPaddleZ = THREE.MathUtils.mapLinear(touchX, 0, canvas.clientWidth, paddleZExtent, -paddleZExtent); // Left side maps to +Z, Right to -Z

             // Map Y touch coord (0 to canvasHeight) to Paddle Y coord (arenaHalfH-halfPaddle down to -arenaHalfH+halfPaddle)
             const playerHalfH = PADDLE_HEIGHT / 2;
             const paddleYExtent = arenaHalfH - playerHalfH; // Max distance from center Y
             const targetPaddleY = THREE.MathUtils.mapLinear(touchY, 0, canvas.clientHeight, paddleYExtent, -paddleYExtent); // Top maps to +Y, Bottom to -Y

             // Set paddle position directly (clamping happens implicitly via mapLinear limits/bounds)
             playerPaddle.position.z = THREE.MathUtils.clamp(targetPaddleZ, -paddleZExtent, paddleZExtent);
             playerPaddle.position.y = THREE.MathUtils.clamp(targetPaddleY, -paddleYExtent, paddleYExtent);
         }

         // Apply processTouch to both start and move
         canvas.addEventListener('touchstart', processTouch, { passive: false });
         canvas.addEventListener('touchmove', processTouch, { passive: false });
         // No 'touchend' needed for this direct mapping logic

        // --- Game Loop ---
        const clock = new THREE.Clock(false);
        const tempTargetCamPos = new THREE.Vector3(); const tempTargetLookAt = new THREE.Vector3(); const tempCurrentLookAt = new THREE.Vector3(); const ballTrackLookAt = new THREE.Vector3();
        const aiTargetMod = new THREE.Vector2();

        function animate() {
            if (!gameStarted) { return; } // <<< Stop recursion if game ended/returned to menu
            requestAnimationFrame(animate);
            if (isPaused || isMatchOver) { renderer.render(scene, camera); return; }
            const deltaTime = clock.getDelta();

            // --- Paddle Movement (Player - Keyboard ONLY - Touch handled by events) ---
            const playerHalfH = PADDLE_HEIGHT / 2; const playerHalfVisW = PADDLE_VISUAL_WIDTH / 2;
            // Only apply keyboard if *no* touch is active (simple check, could be more robust)
             if (navigator.maxTouchPoints === 0 || !document.pointerLockElement) { // Rudimentary check if touch might be happening
                 if ((keysPressed['w'] || keysPressed['arrowup']) && playerPaddle.position.y < arenaHalfH - playerHalfH) { playerPaddle.position.y += PADDLE_SPEED; } if ((keysPressed['s'] || keysPressed['arrowdown']) && playerPaddle.position.y > -arenaHalfH + playerHalfH) { playerPaddle.position.y -= PADDLE_SPEED; } if (keysPressed['a'] && playerPaddle.position.z < arenaHalfD - playerHalfVisW) { playerPaddle.position.z += PADDLE_SPEED; } if (keysPressed['d'] && playerPaddle.position.z > -arenaHalfD + playerHalfVisW) { playerPaddle.position.z -= PADDLE_SPEED; }
                 // Clamp again after keyboard input
                 playerPaddle.position.y = THREE.MathUtils.clamp(playerPaddle.position.y, -arenaHalfH + playerHalfH, arenaHalfH - playerHalfH);
                 playerPaddle.position.z = THREE.MathUtils.clamp(playerPaddle.position.z, -arenaHalfD + playerHalfVisW, arenaHalfD - playerHalfVisW);
            }

            // --- Paddle Movement (AI) --- (Error Logic Included)
            let targetY=ball.position.y; let targetZ=ball.position.z; aiTargetMod.set(0,0); if(aiErrorChance>0&&Math.random()<aiErrorChance*deltaTime*60){aiTargetMod.y=(Math.random()-0.5)*2*aiErrorMagnitude; aiTargetMod.z=(Math.random()-0.5)*2*aiErrorMagnitude; targetY+=aiTargetMod.y; targetZ+=aiTargetMod.z;} const aiHalfH=PADDLE_HEIGHT/2; const aiHalfVisW=PADDLE_VISUAL_WIDTH/2; const dy=targetY-aiPaddle.position.y; const dz=targetZ-aiPaddle.position.z; const aiSpd=PADDLE_SPEED*0.85*aiSpeedModifier; const aiLag=AI_PADDLE_LAG_BASE*aiLagModifier; if(Math.abs(dy)>0.1){aiPaddle.position.y+=Math.sign(dy)*Math.min(aiSpd, Math.abs(dy)*aiLag);} if(Math.abs(dz)>0.1){aiPaddle.position.z+=Math.sign(dz)*Math.min(aiSpd, Math.abs(dz)*aiLag);} aiPaddle.position.y=THREE.MathUtils.clamp(aiPaddle.position.y,-arenaHalfH+aiHalfH,arenaHalfH-aiHalfH); aiPaddle.position.z=THREE.MathUtils.clamp(aiPaddle.position.z,-arenaHalfD+aiHalfVisW,arenaHalfD-aiHalfVisW);

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
