// 3D Horror Labyrinth Main Engine
// Written in ESM JavaScript, utilizing Three.js and Custom procedural systems.

import * as THREE from 'https://cdn.skypack.dev/three@0.136.0/build/three.module.js';
import { io } from 'socket.io-client';
import { audioSystem } from './audio.js';
import { Maze } from './maze.js';
import { Monster } from './monster.js';

let scene, camera, renderer;
let maze, monster;
let gameState = 'start'; // 'start', 'play', 'jumpscare', 'gameover', 'win'

// Multiplayer & Socket State
let socket = null;
let isMultiplayer = false;
let isHost = false;
let roomCode = '';
let playerName = 'Oyuncu';
let otherPlayers = {}; // Map of socketId -> { avatarGroup, name, isDead, position, targetPos }
let isPlayerDead = false;

// Co-op Game Session settings
let totalCrystalsRequired = 8;

// Character Skills & Cooldowns
const skills = {
    flash: { cooldown: 20.0, currentCd: 0.0 },
    dash: { cooldown: 8.0, currentCd: 0.0 },
    invisible: { cooldown: 15.0, currentCd: 0.0 }
};
let invisibilityTimer = 0.0;
let dashTimer = 0.0;
let dashDirection = new THREE.Vector3();

// Flashlight & Light Settings
let flashlight, lightTarget;
let ambientLight;
let batteryLevel = 1.0; // 0.0 to 1.0
let isFlashlightOn = true;
const batteryDrainRate = 0.0075; // drains completely in 133 seconds

// Player Physics & Stats
const playerPos = new THREE.Vector3(6, 1.6, 6); // start at cell (1.5, 1.5) -> 1.5 * 4 = 6
let playerYaw = 0;
let playerPitch = 0;
let playerRoll = 0; // camera roll/sway tilt angle
let playerStamina = 1.0; // 0.0 to 1.0
let crystalsCollected = 0;
let gameTime = 0;

const walkSpeed = 2.5;
const sprintSpeed = 4.2;
const playerHeight = 1.6;
let isSprinting = false;

// Input Management
const keys = { W: false, A: false, S: false, D: false, Shift: false };
let isTouchDevice = false;

// Mobile Controls variables
let joystickActive = false;
let joystickStartPos = { x: 0, y: 0 };
let joystickCurDir = { x: 0, y: 0 }; // normalized movement vector
const joystickMaxDistance = 45; // max pixels handle can drift

let mobileLookActive = false;
let mobileLookStartPos = { x: 0, y: 0 };
let mobileLookTouchId = null;

// Audio footstep tracking
let footstepCounter = 0;
const footstepIntervalWalk = 1.8; // units traveled between footsteps
const footstepIntervalSprint = 1.2;

// Timing helper
let lastTime = performance.now();

// 1. Initial Launch
window.onload = () => {
    detectDevice();
    initEngine();
};

function detectDevice() {
    isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.innerWidth < 1024);
    if (isTouchDevice) {
        document.getElementById('mobile-controls').classList.remove('hidden');
        document.getElementById('desktop-controls-hint').style.display = 'none';
        setupMobileControls();
    }
}

// 2. Setup Three.js Scene and Core components
function initEngine() {
    // Scene setup
    scene = new THREE.Scene();
    // Pitch-black horror background and thick fog
    scene.background = new THREE.Color(0x020203);
    scene.fog = new THREE.FogExp2(0x020203, 0.16);

    // Camera setup
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.copy(playerPos);
    scene.add(camera);

    // Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // Lighting
    // Barely audible ambient light to avoid complete pitch-black if flashlight is off
    ambientLight = new THREE.AmbientLight(0xffffff, 0.03);
    scene.add(ambientLight);

    // Flashlight SpotLight (Attached to camera, focused long-range beam, wider coverage)
    flashlight = new THREE.SpotLight(0xfff5dd, 3.5, 48.0, Math.PI / 5.2, 0.7, 1.0);
    flashlight.castShadow = true;
    flashlight.shadow.mapSize.width = 512;
    flashlight.shadow.mapSize.height = 512;
    flashlight.shadow.bias = -0.002;
    camera.add(flashlight);
    
    // Add target object to scene so spotlight direction is computed dynamically in tick()
    lightTarget = new THREE.Object3D();
    scene.add(lightTarget);
    flashlight.target = lightTarget;

    // Load Labyrinth & Monster
    maze = new Maze(scene, THREE);
    monster = new Monster(scene, THREE, maze);

    // Setup Desktop Mouse Pointer Lock and keys
    setupDesktopControls();
    
    // UI Button bindings
    setupUIBindings();

    // Resize Handler
    window.addEventListener('resize', onWindowResize);

    // Start tick loop
    requestAnimationFrame(tick);
}

// 3. Desktop Controls (Keyboard + PointerLock)
function setupDesktopControls() {
    const canvas = renderer.domElement;
    
    canvas.addEventListener('click', () => {
        if (gameState === 'play' && !isTouchDevice) {
            canvas.requestPointerLock();
        }
    });

    document.addEventListener('pointerlockchange', () => {
        // Paused state if pointer lock lost during play
        if (document.pointerLockElement !== canvas && gameState === 'play' && !isTouchDevice) {
            // Option to show a menu or just mute sounds temporarily
        }
    });

    window.addEventListener('keydown', (e) => {
        console.log("Tuşa basıldı:", e.key, "Kod:", e.code, "KeyCode:", e.keyCode, "Durum:", gameState);
        
        if (gameState !== 'play') return;
        
        const keyLower = e.key ? e.key.toLowerCase() : '';
        if (keyLower === 'u' || e.code === 'KeyU' || e.keyCode === 85) {
            crystalsCollected++;
            document.getElementById('crystals-collected').innerText = crystalsCollected;
            audioSystem.playPickup();
            showNotification(`KRİSTAL HİLESİ (${crystalsCollected} / 8)`);
            if (crystalsCollected >= 8) {
                triggerWin();
            }
            return;
        }

        switch (e.code) {
            case 'KeyW': keys.W = true; break;
            case 'KeyA': keys.A = true; break;
            case 'KeyS': keys.S = true; break;
            case 'KeyD': keys.D = true; break;
            case 'ShiftLeft':
            case 'ShiftRight':
                keys.Shift = true;
                break;
            case 'KeyF':
                toggleFlashlight();
                break;
            case 'KeyQ':
                triggerSkill('flash');
                break;
            case 'KeyE':
                triggerSkill('dash');
                break;
            case 'KeyR':
                triggerSkill('invisible');
                break;
        }
    });

    window.addEventListener('keyup', (e) => {
        switch (e.code) {
            case 'KeyW': keys.W = false; break;
            case 'KeyA': keys.A = false; break;
            case 'KeyS': keys.S = false; break;
            case 'KeyD': keys.D = false; break;
            case 'ShiftLeft':
            case 'ShiftRight':
                keys.Shift = false;
                break;
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (document.pointerLockElement !== canvas && !isTouchDevice) return;
        if (gameState !== 'play') return;

        const sensitivity = 0.0022;
        playerYaw -= e.movementX * sensitivity;
        playerPitch -= e.movementY * sensitivity;

        // Clamp vertical look (pitch)
        playerPitch = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, playerPitch));
    });
}

// 4. Mobil Virtual Joysticks & Swipe Look
function setupMobileControls() {
    const handle = document.getElementById('joystick-handle');
    const base = document.getElementById('joystick-base');
    const joystickZone = document.getElementById('joystick-zone');
    
    // Virtual Joystick Touch events
    joystickZone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        joystickActive = true;
        
        const touch = e.touches[0];
        const baseRect = base.getBoundingClientRect();
        
        // Joystick center coordinate
        joystickStartPos.x = baseRect.left + baseRect.width / 2;
        joystickStartPos.y = baseRect.top + baseRect.height / 2;
    }, { passive: false });

    joystickZone.addEventListener('touchmove', (e) => {
        if (!joystickActive) return;
        e.preventDefault();
        
        const touch = e.touches[0];
        let dx = touch.clientX - joystickStartPos.x;
        let dy = touch.clientY - joystickStartPos.y;
        
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > joystickMaxDistance) {
            dx = (dx / distance) * joystickMaxDistance;
            dy = (dy / distance) * joystickMaxDistance;
        }
        
        // Update handle visual position
        handle.style.transform = `translate(${dx}px, ${dy}px)`;
        
        // Calculate normalized direction vector
        joystickCurDir.x = dx / joystickMaxDistance; // Horizontal movement
        joystickCurDir.y = dy / joystickMaxDistance; // Vertical movement
    }, { passive: false });

    const resetJoystick = () => {
        joystickActive = false;
        handle.style.transform = 'translate(0px, 0px)';
        joystickCurDir.x = 0;
        joystickCurDir.y = 0;
    };
    
    joystickZone.addEventListener('touchend', resetJoystick);
    joystickZone.addEventListener('touchcancel', resetJoystick);

    // Right Half of Screen - Swipe to Look
    window.addEventListener('touchstart', (e) => {
        if (gameState !== 'play') return;
        
        // Check all touches
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            
            // Only look on the right 60% of the screen
            if (touch.clientX > window.innerWidth * 0.4) {
                // If not already active, bind it
                if (!mobileLookActive) {
                    mobileLookActive = true;
                    mobileLookTouchId = touch.identifier;
                    mobileLookStartPos.x = touch.clientX;
                    mobileLookStartPos.y = touch.clientY;
                }
            }
        }
    });

    window.addEventListener('touchmove', (e) => {
        if (!mobileLookActive || gameState !== 'play') return;
        
        // Find corresponding touch
        for (let i = 0; i < e.touches.length; i++) {
            const touch = e.touches[i];
            if (touch.identifier === mobileLookTouchId) {
                const dx = touch.clientX - mobileLookStartPos.x;
                const dy = touch.clientY - mobileLookStartPos.y;
                
                const touchSensitivity = 0.005;
                playerYaw -= dx * touchSensitivity;
                playerPitch -= dy * touchSensitivity;
                
                playerPitch = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, playerPitch));
                
                // Keep look anchor updated
                mobileLookStartPos.x = touch.clientX;
                mobileLookStartPos.y = touch.clientY;
                break;
            }
        }
    });

    const endLook = (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === mobileLookTouchId) {
                mobileLookActive = false;
                mobileLookTouchId = null;
                break;
            }
        }
    };

    window.addEventListener('touchend', endLook);
    window.addEventListener('touchcancel', endLook);

    // Mobile Action buttons listeners
    const sprintBtn = document.getElementById('mobile-btn-sprint');
    sprintBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        keys.Shift = true;
    });
    sprintBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        keys.Shift = false;
    });

    const flashBtn = document.getElementById('mobile-btn-flashlight');
    flashBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        toggleFlashlight();
    });

    // Mobile skill buttons
    document.getElementById('mobile-btn-flash').addEventListener('touchstart', (e) => {
        e.preventDefault();
        triggerSkill('flash');
    });
    document.getElementById('mobile-btn-dash').addEventListener('touchstart', (e) => {
        e.preventDefault();
        triggerSkill('dash');
    });
    document.getElementById('mobile-btn-invisible').addEventListener('touchstart', (e) => {
        e.preventDefault();
        triggerSkill('invisible');
    });
}

// 5. Flashlight Logic
function toggleFlashlight() {
    if (batteryLevel <= 0.01) return; // battery dead
    
    isFlashlightOn = !isFlashlightOn;
    flashlight.visible = isFlashlightOn;
    audioSystem.playFlashlightClick();
}

// 6. UI Interaction and State Changes
function setupUIBindings() {
    // Singleplayer start button
    document.getElementById('start-single-btn').addEventListener('click', () => {
        const nameVal = document.getElementById('player-name-input').value.trim();
        playerName = nameVal || "Oyuncu";
        isMultiplayer = false;
        isHost = false;
        
        audioSystem.init();
        startGame();
    });

    // Host Lobby Button
    document.getElementById('host-lobby-btn').addEventListener('click', () => {
        const nameVal = document.getElementById('player-name-input').value.trim();
        playerName = nameVal || "Kurucu";
        
        audioSystem.init();
        initSocket();
        
        socket.emit('createRoom', { playerName });
    });

    // Join Lobby Button
    document.getElementById('join-lobby-btn').addEventListener('click', () => {
        const codeVal = document.getElementById('room-code-input').value.trim().toUpperCase();
        if (codeVal.length !== 4) {
            alert("Lütfen 4 haneli oda kodunu girin!");
            return;
        }
        
        const nameVal = document.getElementById('player-name-input').value.trim();
        playerName = nameVal || "Oyuncu";
        
        audioSystem.init();
        initSocket();
        
        socket.emit('joinRoom', { roomCode: codeVal, playerName });
    });

    // Start Game from Lobby (Host only)
    document.getElementById('lobby-start-btn').addEventListener('click', () => {
        if (!isHost || !socket) return;
        
        // Host generates the level grid and spawns items/batteries
        const tempMaze = new Maze(scene, THREE);
        const mazeGrid = tempMaze.grid;
        
        const crystals = tempMaze.items.map(item => ({ gridX: item.gridX, gridY: item.gridY }));
        const batteries = tempMaze.batteries.map(bat => ({ gridX: bat.gridX, gridY: bat.gridY }));
        
        tempMaze.destroy(); // destroy the temporary maze
        
        socket.emit('startGame', {
            roomCode,
            mazeGrid,
            items: crystals,
            batteries
        });
    });

    // Leave Lobby
    document.getElementById('lobby-leave-btn').addEventListener('click', () => {
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        isMultiplayer = false;
        isHost = false;
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('start-screen').classList.remove('hidden');
    });

    // Game Over Restart
    document.getElementById('restart-btn').addEventListener('click', () => {
        if (isMultiplayer) {
            if (socket) socket.disconnect();
            socket = null;
            isMultiplayer = false;
            document.getElementById('game-over-screen').classList.add('hidden');
            document.getElementById('start-screen').classList.remove('hidden');
        } else {
            restartGame();
        }
    });

    // Win Screen Restart
    document.getElementById('win-restart-btn').addEventListener('click', () => {
        if (isMultiplayer) {
            if (socket) socket.disconnect();
            socket = null;
            isMultiplayer = false;
            document.getElementById('win-screen').classList.add('hidden');
            document.getElementById('start-screen').classList.remove('hidden');
        } else {
            restartGame();
        }
    });
}

function startGame() {
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('team-card').classList.add('hidden');
    
    isPlayerDead = false;
    invisibilityTimer = 0.0;
    dashTimer = 0.0;
    
    // Reset skills CD
    for (const key in skills) {
        skills[key].currentCd = 0.0;
        updateSkillUI(key);
    }
    
    // lock pointer on PC
    if (!isTouchDevice) {
        renderer.domElement.requestPointerLock();
    }
    
    gameState = 'play';
    gameTime = 0;
}

function restartGame() {
    document.getElementById('game-over-screen').classList.add('hidden');
    document.getElementById('win-screen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('team-card').classList.add('hidden');
    
    // Clear old level meshes
    maze.destroy();
    monster.destroy();
    
    // Reset player variables
    playerPos.set(6, 1.6, 6);
    playerYaw = 0;
    playerPitch = 0;
    batteryLevel = 1.0;
    isFlashlightOn = true;
    flashlight.visible = true;
    playerStamina = 1.0;
    crystalsCollected = 0;
    gameTime = 0;
    footstepCounter = 0;
    isPlayerDead = false;
    invisibilityTimer = 0.0;
    dashTimer = 0.0;
    
    // Reset skills CD
    for (const key in skills) {
        skills[key].currentCd = 0.0;
        updateSkillUI(key);
    }
    
    document.getElementById('crystals-collected').innerText = '0';
    document.getElementById('battery-bar').style.width = '100%';
    document.getElementById('battery-percent').innerText = '100%';
    document.getElementById('battery-bar').className = 'bar green';
    document.getElementById('stamina-bar').style.width = '100%';
    document.getElementById('jumpscare-img').classList.remove('grow-anim');
    const vignette = document.getElementById('proximity-vignette');
    if (vignette) vignette.style.boxShadow = 'none';
    
    // Rebuild level
    maze = new Maze(scene, THREE);
    monster = new Monster(scene, THREE, maze);
    
    // Reset audio loops
    audioSystem.stopAllLoops();
    
    if (!isTouchDevice) {
        renderer.domElement.requestPointerLock();
    }
    
    gameState = 'play';
}

function triggerJumpscare() {
    gameState = 'jumpscare';
    isPlayerDead = true;
    
    // Shake camera & screen, lock controls
    audioSystem.stopAllLoops();
    audioSystem.playJumpscare();
    
    // Display Jumpscare overlay with glitch shake and grow animation
    const overlay = document.getElementById('jumpscare-overlay');
    overlay.style.display = 'flex';
    const jsImg = document.getElementById('jumpscare-img');
    if (jsImg) jsImg.classList.add('grow-anim');
    document.body.classList.add('glitch-shake');
    
    // Face the monster completely
    const lookDir = new THREE.Vector3().subVectors(monster.position, camera.position);
    lookDir.y = 0.5; // Look slightly up to monster face height
    lookDir.normalize();
    
    playerYaw = Math.atan2(lookDir.x, lookDir.z);
    playerPitch = 0.2;
    
    if (isMultiplayer) {
        socket.emit('playerCaught', { roomCode, playerId: socket.id });
    }
    
    // Wait 2.2 seconds then show Game Over Menu or Spectate
    setTimeout(() => {
        overlay.style.display = 'none';
        document.body.classList.remove('glitch-shake');
        
        if (isMultiplayer) {
            showNotification("KATLEDİLDİN! TAKIMINI İZLİYORSUN...");
            gameState = 'spectator';
            // Disable pointer lock if they want
            if (document.pointerLockElement) {
                document.exitPointerLock();
            }
        } else {
            document.getElementById('hud').classList.add('hidden');
            document.getElementById('game-over-screen').classList.remove('hidden');
            
            document.getElementById('end-crystals').innerText = `${crystalsCollected} / 8`;
            document.getElementById('end-time').innerText = `${Math.floor(gameTime)} sn`;
            
            if (document.pointerLockElement) {
                document.exitPointerLock();
            }
            
            gameState = 'gameover';
        }
    }, 2200);
}

function triggerWin() {
    gameState = 'win';
    audioSystem.stopAllLoops();
    audioSystem.playVictory();
    
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('win-screen').classList.remove('hidden');
    document.getElementById('win-time').innerText = `${Math.floor(gameTime)} sn`;
    
    if (document.pointerLockElement) {
        document.exitPointerLock();
    }
}

// Notify UI popups
function showNotification(text) {
    const notif = document.getElementById('game-notification');
    notif.innerText = text;
    notif.style.opacity = 1;
    
    setTimeout(() => {
        notif.style.opacity = 0;
    }, 2000);
}

// 7. Core Update Game Tick Loop
function tick(currentTime) {
    requestAnimationFrame(tick);
    
    const deltaTime = Math.min((currentTime - lastTime) / 1000, 0.1); // clamp delta to prevent giant teleports
    lastTime = currentTime;
    
    if (gameState === 'play' || gameState === 'spectator') {
        gameTime += deltaTime;
        
        // 1. Update items/flicker lights inside maze
        maze.update(deltaTime, currentTime / 1000);
        
        // Decrement skills cooldowns
        for (const key in skills) {
            if (skills[key].currentCd > 0) {
                skills[key].currentCd = Math.max(0, skills[key].currentCd - deltaTime);
                updateSkillUI(key);
            }
        }
        
        // Decrement invisibility timer
        if (invisibilityTimer > 0) {
            invisibilityTimer -= deltaTime;
            if (invisibilityTimer <= 0) {
                showNotification("GÖRÜNMEZLİK SONA ERDİ!");
            }
        }
        
        // 2. Update player physics
        if (gameState === 'play' && !isPlayerDead) {
            updatePlayerPhysics(deltaTime);
            checkProximityInteractions();
        } else if (gameState === 'spectator') {
            // Spectator mode: Follow closest alive player
            let spectateTarget = null;
            for (const pid in otherPlayers) {
                if (!otherPlayers[pid].isDead) {
                    spectateTarget = otherPlayers[pid].position;
                    break;
                }
            }
            if (spectateTarget) {
                camera.position.lerp(new THREE.Vector3(spectateTarget.x, playerHeight, spectateTarget.z), deltaTime * 5.0);
            }
        }
        
        // 3. Update AI Monster & Ambient Scares
        if (!isMultiplayer || isHost) {
            // Host or Singleplayer updates AI
            let targetPos = camera.position;
            let targetSprinting = isSprinting && isMoving();
            
            if (isMultiplayer) {
                let minDist = (isPlayerDead || invisibilityTimer > 0) ? 999999 : camera.position.distanceTo(monster.position);
                let closestPos = camera.position;
                let closestSprinting = isSprinting && isMoving();
                
                for (const pid in otherPlayers) {
                    const otherP = otherPlayers[pid];
                    if (!otherP.isDead) {
                        const dist = otherP.position.distanceTo(monster.position);
                        if (dist < minDist) {
                            minDist = dist;
                            closestPos = otherP.position;
                            closestSprinting = false;
                        }
                    }
                }
                targetPos = closestPos;
                targetSprinting = closestSprinting;
            }
            
            // Update monster AI (Only if at least one player is alive)
            const allPlayersDead = isPlayerDead && Object.values(otherPlayers).every(p => p.isDead);
            if (!allPlayersDead) {
                monster.update(deltaTime, currentTime / 1000, targetPos, targetSprinting, audioSystem, playerYaw);
            }
            
            audioSystem.updateAmbientScares(deltaTime, monster.position, camera.position, playerYaw);
            
            // Host broadcasts monster position
            if (isMultiplayer && socket) {
                socket.emit('updateMonster', {
                    roomCode,
                    position: monster.position,
                    rotationY: monster.meshGroup.rotation.y,
                    state: monster.state,
                    targetPoint: monster.targetPoint,
                    isDashingState: monster.isDashingState
                });
            }
        } else {
            // Clients update monster animations but keep position synced from host
            monster.update(deltaTime, currentTime / 1000, monster.position, false, audioSystem, playerYaw);
        }
        
        // 4. Emit player status to server
        if (isMultiplayer && socket) {
            socket.emit('updatePlayer', {
                roomCode,
                position: camera.position,
                yaw: playerYaw,
                pitch: playerPitch,
                roll: playerRoll,
                isSprinting,
                isMoving: isMoving(),
                isDead: isPlayerDead,
                activeSkill: invisibilityTimer > 0 ? 'invisible' : null,
                isFlashlightOn: isFlashlightOn && flashlight.visible
            });
        }
        
        // 5. Update other players positions visually (lerp)
        for (const pid in otherPlayers) {
            const otherP = otherPlayers[pid];
            if (!otherP.isDead) {
                otherP.position.lerp(otherP.targetPos, deltaTime * 12.0);
                otherP.avatarGroup.position.set(otherP.position.x, 0, otherP.position.z);
            }
        }

        // 5. Update Red Proximity Vignette
        const distToMonster = camera.position.distanceTo(monster.position);
        const vignette = document.getElementById('proximity-vignette');
        if (vignette) {
            if (distToMonster < 16.0) {
                // Opacity scales from 0.0 at 16m to 0.85 at 1.3m
                const factor = Math.max(0, Math.min(0.85, (16.0 - distToMonster) / 14.7));
                vignette.style.boxShadow = `inset 0 0 ${40 + factor * 80}px rgba(255, 0, 0, ${factor})`;
            } else {
                vignette.style.boxShadow = 'none';
            }
        }
        
        // 6. Update circular neon radar display
        const radarPing = document.getElementById('radar-ping');
        const radarDistance = document.getElementById('radar-distance');
        if (radarPing && radarDistance) {
            const dx = monster.position.x - camera.position.x;
            const dz = monster.position.z - camera.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            
            // Distance text
            radarDistance.innerText = `${dist.toFixed(1)} m`;
            
            // Radar tracking ranges up to 35 meters
            if (dist < 35.0) {
                radarPing.style.display = 'block';
                
                // Direction angle relative to camera horizontal vectors (correct 3D to 2D projection)
                const forward = new THREE.Vector3();
                camera.getWorldDirection(forward);
                forward.y = 0;
                forward.normalize();
                
                const right = new THREE.Vector3(-forward.z, 0, forward.x);
                
                const localX = dx * right.x + dz * right.z;
                const localZ = dx * forward.x + dz * forward.z;
                
                const angle = Math.atan2(localX, localZ);
                
                // Map distance to a fraction (clamped to 30.0 for screen radius mapping)
                const maxRadarDist = 30.0;
                const clampedDist = Math.min(dist, maxRadarDist);
                const radiusFraction = clampedDist / maxRadarDist;
                
                // Screen radius percentage from center (50%)
                const radarRadius = 43; // leave padding to not overflow the border
                const screenX = 50 + Math.sin(angle) * radiusFraction * radarRadius;
                const screenY = 50 - Math.cos(angle) * radiusFraction * radarRadius;
                
                radarPing.style.left = `${screenX}%`;
                radarPing.style.top = `${screenY}%`;
                
                // Blink speed is faster when closer (ranges from 0.15s to 1.1s)
                const blinkDuration = Math.max(0.15, Math.min(1.1, dist * 0.032));
                radarPing.style.animationDuration = `${blinkDuration}s`;
                
                // Signal strength opacity decay
                const opacity = Math.max(0.2, Math.min(1.0, 1.0 - (dist / 35.0)));
                radarPing.style.opacity = opacity;
                
                if (!radarPing.classList.contains('active')) {
                    radarPing.classList.add('active');
                }
            } else {
                radarPing.style.display = 'none';
                radarPing.classList.remove('active');
            }
        }
    } else if (gameState === 'jumpscare') {
        // Freeze frame but keep camera vibrating slightly during jumpscare
        camera.position.x = playerPos.x + (Math.random() - 0.5) * 0.15;
        camera.position.y = playerPos.y + (Math.random() - 0.5) * 0.15;
        camera.position.z = playerPos.z + (Math.random() - 0.5) * 0.15;
    }
    
    // Rotate camera based on Pitch, Yaw, and Roll values
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    euler.x = playerPitch;
    euler.y = playerYaw;
    euler.z = playerRoll; // add roll tilt for head sway
    camera.quaternion.setFromEuler(euler);
    
    // Dynamically update flashlight target to point where camera is looking with ~0.2s delay
    if (lightTarget) {
        const cameraDir = new THREE.Vector3();
        camera.getWorldDirection(cameraDir);
        const desiredTargetPos = new THREE.Vector3().copy(camera.position).addScaledVector(cameraDir, 5.0);
        // Lerping: factor of 5.0 * deltaTime gives ~0.2s delay
        lightTarget.position.lerp(desiredTargetPos, deltaTime * 5.0);
    }
    
    renderer.render(scene, camera);
}

// Helper to determine if player is physically inputting movement
function isMoving() {
    if (isTouchDevice) {
        return Math.abs(joystickCurDir.x) > 0.1 || Math.abs(joystickCurDir.y) > 0.1;
    }
    return keys.W || keys.A || keys.S || keys.D;
}

// 8. Player Movement and Collisions
function updatePlayerPhysics(deltaTime) {
    // Determine movement direction vector in local camera horizontal plane
    const moveVector = new THREE.Vector3(0, 0, 0);
    
    if (isTouchDevice) {
        // Joystick inputs
        moveVector.x = joystickCurDir.x;
        moveVector.z = joystickCurDir.y;
    } else {
        // Keyboard inputs
        if (keys.W) moveVector.z = -1;
        if (keys.S) moveVector.z = 1;
        if (keys.A) moveVector.x = -1;
        if (keys.D) moveVector.x = 1;
        moveVector.normalize();
    }
    
    // Rotate movement vector according to player Yaw (horizontal look angle)
    const rotatedMove = new THREE.Vector3();
    rotatedMove.x = moveVector.x * Math.cos(playerYaw) + moveVector.z * Math.sin(playerYaw);
    rotatedMove.z = -moveVector.x * Math.sin(playerYaw) + moveVector.z * Math.cos(playerYaw);
    
    // Stamina & Sprint logic
    const moving = isMoving();
    if (keys.Shift && moving && playerStamina > 0.05) {
        isSprinting = true;
        playerStamina = Math.max(0, playerStamina - deltaTime * 0.25); // drains in 4s
    } else {
        isSprinting = false;
        // Recover stamina when walking/resting
        const recoverySpeed = moving ? 0.08 : 0.14;
        playerStamina = Math.min(1.0, playerStamina + deltaTime * recoverySpeed);
    }
    
    // Set movement speed
    let speed = isSprinting ? sprintSpeed : walkSpeed;
    let finalMoveX = rotatedMove.x;
    let finalMoveZ = rotatedMove.z;
    
    if (dashTimer > 0) {
        dashTimer -= deltaTime;
        speed = 12.0; // extremely fast dash speed
        finalMoveX = dashDirection.x;
        finalMoveZ = dashDirection.z;
    }
    
    // Calculate potential next position coordinates
    const nextX = playerPos.x + finalMoveX * speed * deltaTime;
    const nextZ = playerPos.z + finalMoveZ * speed * deltaTime;
    
    // Collision checking with sliding along walls
    const collidesX = maze.checkCollision(nextX, playerPos.z, 0.45);
    const collidesZ = maze.checkCollision(playerPos.x, nextZ, 0.45);
    
    if (!collidesX) {
        playerPos.x = nextX;
    }
    if (!collidesZ) {
        playerPos.z = nextZ;
    }
    
    // Reset camera baseline coordinates
    camera.position.copy(playerPos);
    camera.position.y = playerHeight;
    
    // Camera shake/wobble and tilt when moving
    if (moving && (!collidesX || !collidesZ)) {
        const bobSpeed = isSprinting ? 15.0 : 10.0;
        const bobTimer = performance.now() * 0.001 * bobSpeed;
        
        const scaleY = isSprinting ? 0.088 : 0.045; // vertical bounce
        const scaleX = isSprinting ? 0.072 : 0.038; // side-to-side sway
        const scaleZ = isSprinting ? 0.032 : 0.015; // roll rotation (Z) tilt
        
        camera.position.y = playerHeight + Math.sin(bobTimer) * scaleY;
        // Sway camera locally on local horizontal axes
        camera.translateX(Math.cos(bobTimer * 0.5) * scaleX);
        playerRoll = Math.sin(bobTimer * 0.5) * scaleZ;
        
        // Footstep sounds scheduling
        const distTraveled = speed * deltaTime;
        footstepCounter += distTraveled;
        const triggerLimit = isSprinting ? footstepIntervalSprint : footstepIntervalWalk;
        
        if (footstepCounter >= triggerLimit) {
            audioSystem.playFootstep(isSprinting);
            footstepCounter = 0;
        }
    } else {
        camera.position.y = playerHeight;
        playerRoll = 0;
    }
    
    // Update battery levels & flashlight flickering
    if (isFlashlightOn && flashlight.visible) {
        batteryLevel = Math.max(0, batteryLevel - deltaTime * batteryDrainRate);
        
        // Flickers when low on juice (< 20%)
        if (batteryLevel < 0.2) {
            const flickerChance = 0.15 + (0.2 - batteryLevel) * 3; // chances grow as juice dies
            if (Math.random() < flickerChance) {
                flashlight.intensity = Math.random() > 0.5 ? 0.05 : 2.5 * (batteryLevel * 5);
            } else {
                flashlight.intensity = 2.5;
            }
        } else {
            flashlight.intensity = 2.5;
        }
        
        if (batteryLevel <= 0.005) {
            isFlashlightOn = false;
            flashlight.visible = false;
            flashlight.intensity = 0;
            showNotification("FENERİN PİLİ BİTTİ!");
        }
        
        updateBatteryHUD();
    }
    
    // Sync stamina HUD
    document.getElementById('stamina-bar').style.width = `${playerStamina * 100}%`;
}

// Dynamic Battery Bar Styling Update
function updateBatteryHUD() {
    const percent = Math.floor(batteryLevel * 100);
    const bar = document.getElementById('battery-bar');
    document.getElementById('battery-percent').innerText = `${percent}%`;
    bar.style.width = `${percent}%`;
    
    if (batteryLevel > 0.5) {
        bar.className = 'bar green';
    } else if (batteryLevel > 0.2) {
        bar.className = 'bar yellow';
    } else {
        bar.className = 'bar red';
    }
}

// 9. Items pick-ups and Catching mechanism
function checkProximityInteractions() {
    if (isPlayerDead) return; // Dead players can't pick up or get caught
    const currentLoc = new THREE.Vector3(playerPos.x, 0, playerPos.z);
    
    // 1. Crystal Pickups
    for (let i = maze.items.length - 1; i >= 0; i--) {
        const item = maze.items[i];
        const itemPos = new THREE.Vector3(item.mesh.position.x, 0, item.mesh.position.z);
        
        if (currentLoc.distanceTo(itemPos) < 1.35) {
            // Collected! Make invisible and turn off light
            item.mesh.visible = false;
            item.light.intensity = 0.0;
            
            const itemIndex = maze.allItems.indexOf(item);
            maze.items.splice(i, 1);
            
            if (isMultiplayer) {
                socket.emit('collectItem', { roomCode, itemType: 'crystal', itemIndex, playerId: socket.id });
            } else {
                crystalsCollected++;
                document.getElementById('crystals-collected').innerText = crystalsCollected;
                audioSystem.playPickup();
                showNotification(`KRİSTAL TOPLANDI (${crystalsCollected} / 8)`);
                if (crystalsCollected === 8) {
                    triggerWin();
                }
            }
        }
    }
    
    // 2. Battery Pickups
    for (let i = maze.batteries.length - 1; i >= 0; i--) {
        const bat = maze.batteries[i];
        const batPos = new THREE.Vector3(bat.mesh.position.x, 0, bat.mesh.position.z);
        
        if (currentLoc.distanceTo(batPos) < 1.35) {
            if (batteryLevel < 0.95) {
                bat.mesh.visible = false;
                bat.light.intensity = 0.0;
                
                const itemIndex = maze.allBatteries.indexOf(bat);
                maze.batteries.splice(i, 1);
                
                if (isMultiplayer) {
                    socket.emit('collectItem', { roomCode, itemType: 'battery', itemIndex, playerId: socket.id });
                } else {
                    batteryLevel = Math.min(1.0, batteryLevel + 0.50);
                    isFlashlightOn = true;
                    flashlight.visible = true;
                    audioSystem.playPickup();
                    showNotification("PİL ALINDI! FENER ŞARJ EDİLDİ (+50%)");
                }
            }
        }
    }
    
    // 3. Catching check (Monster captures player)
    // If player is invisible, they cannot be caught
    if (invisibilityTimer > 0) return;
    
    const monsterLoc = new THREE.Vector3(monster.position.x, 0, monster.position.z);
    const catchDist = 1.3;
    
    if (currentLoc.distanceTo(monsterLoc) < catchDist) {
        triggerJumpscare();
    }
}

// 10. Screen Resize
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// 11. Multiplayer Socket Initialization
function initSocket() {
    if (socket) return;
    
    const socketUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
        ? 'http://localhost:3000' 
        : window.location.origin;
        
    socket = io(socketUrl);
    
    socket.on('roomCreated', ({ roomCode: code, players }) => {
        isMultiplayer = true;
        isHost = true;
        roomCode = code;
        
        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('lobby-screen').classList.remove('hidden');
        document.getElementById('lobby-code-display').innerText = code;
        document.getElementById('lobby-start-btn').classList.remove('hidden');
        
        updateLobbyPlayersList(players);
    });
    
    socket.on('roomJoined', ({ roomCode: code, players }) => {
        isMultiplayer = true;
        isHost = false;
        roomCode = code;
        
        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('lobby-screen').classList.remove('hidden');
        document.getElementById('lobby-code-display').innerText = code;
        document.getElementById('lobby-start-btn').classList.add('hidden');
        
        updateLobbyPlayersList(players);
        audioSystem.playPickup();
    });
    
    socket.on('playerJoined', ({ players }) => {
        updateLobbyPlayersList(players);
        audioSystem.playPickup();
    });
    
    socket.on('playerLeft', ({ players, playerId }) => {
        if (otherPlayers[playerId]) {
            scene.remove(otherPlayers[playerId].avatarGroup);
            delete otherPlayers[playerId];
        }
        updateLobbyPlayersList(players);
        updateTeamHUD();
    });
    
    socket.on('hostChanged', ({ hostId }) => {
        if (socket.id === hostId) {
            isHost = true;
            document.getElementById('lobby-start-btn').classList.remove('hidden');
        }
    });
    
    socket.on('gameStarted', ({ mazeGrid, items, batteries, players }) => {
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('hud').classList.remove('hidden');
        document.getElementById('team-card').classList.remove('hidden');
        
        isPlayerDead = false;
        
        // Rebuild level from host preset
        maze.destroy();
        monster.destroy();
        
        maze = new Maze(scene, THREE, { mazeGrid, items, batteries });
        monster = new Monster(scene, THREE, maze);
        
        // Reset player variables
        playerPos.set(6, 1.6, 6);
        playerYaw = 0;
        playerPitch = 0;
        batteryLevel = 1.0;
        isFlashlightOn = true;
        flashlight.visible = true;
        playerStamina = 1.0;
        crystalsCollected = 0;
        gameTime = 0;
        
        document.getElementById('crystals-collected').innerText = '0';
        document.getElementById('battery-bar').style.width = '100%';
        document.getElementById('stamina-bar').style.width = '100%';
        
        // Reset skills UI and CD
        for (const key in skills) {
            skills[key].currentCd = 0;
            updateSkillUI(key);
        }
        invisibilityTimer = 0;
        dashTimer = 0;
        
        setupOtherPlayersAvatars(players);
        
        if (!isTouchDevice) {
            renderer.domElement.requestPointerLock();
        }
        
        gameState = 'play';
        gameTime = 0;
    });
    
    socket.on('playerUpdated', ({ playerId, player }) => {
        const pObj = otherPlayers[playerId];
        if (!pObj) return;
        
        pObj.targetPos.copy(player.position);
        pObj.avatarGroup.rotation.y = player.yaw;
        
        // Update dead status
        if (player.isDead && !pObj.isDead) {
            pObj.isDead = true;
            pObj.avatarGroup.visible = false;
            updateTeamHUD();
        }
        
        // Update invisibility visual transparency
        pObj.avatarGroup.traverse(child => {
            if (child.isMesh) {
                child.material.transparent = true;
                child.material.opacity = player.activeSkill === 'invisible' ? 0.15 : 1.0;
            }
        });
        
        // Update Flashlight & pitch
        if (pObj.avatarGroup.userData.flashlight) {
            const isFlippedOn = player.isFlashlightOn && !pObj.isDead && player.activeSkill !== 'invisible';
            pObj.avatarGroup.userData.flashlight.visible = isFlippedOn;
            
            const target = pObj.avatarGroup.userData.lightTarget;
            if (target) {
                target.position.y = 1.35 + Math.sin(player.pitch) * 5.0;
                target.position.z = -Math.cos(player.pitch) * 5.0;
            }
        }
    });
    
    socket.on('monsterUpdated', ({ position, rotationY, state, targetPoint, isDashingState }) => {
        if (isHost) return;
        
        monster.position.copy(position);
        monster.meshGroup.position.copy(position);
        monster.meshGroup.rotation.y = rotationY;
        monster.state = state;
        monster.isDashingState = isDashingState;
    });
    
    socket.on('itemCollected', ({ itemType, itemIndex, playerId }) => {
        if (itemType === 'crystal') {
            const crystal = maze.allItems[itemIndex];
            if (crystal && crystal.mesh.visible) {
                crystal.mesh.visible = false;
                crystal.light.intensity = 0.0;
                
                const idx = maze.items.indexOf(crystal);
                if (idx !== -1) maze.items.splice(idx, 1);
                
                crystalsCollected++;
                document.getElementById('crystals-collected').innerText = crystalsCollected;
                audioSystem.playPickup();
                
                showNotification(`TAKIM ARKADAŞI KRİSTAL TOPLADI (${crystalsCollected} / 8)`);
                if (crystalsCollected === 8) {
                    triggerWin();
                }
            }
        } else if (itemType === 'battery') {
            const battery = maze.allBatteries[itemIndex];
            if (battery && battery.mesh.visible) {
                battery.mesh.visible = false;
                battery.light.intensity = 0.0;
                
                const idx = maze.batteries.indexOf(battery);
                if (idx !== -1) maze.batteries.splice(idx, 1);
                
                audioSystem.playPickup();
                showNotification("TAKIM ARKADAŞI PİL TOPLADI!");
            }
        }
    });
    
    socket.on('skillUsed', ({ playerId, skillName, position, forwardDir }) => {
        if (playerId === socket.id) return;
        triggerRemoteSkillEffect(skillName, position, forwardDir);
    });
    
    socket.on('playerCaught', ({ playerId }) => {
        const pObj = otherPlayers[playerId];
        if (pObj) {
            pObj.isDead = true;
            pObj.avatarGroup.visible = false;
            updateTeamHUD();
        }
        showNotification("BİR OYUNCU KATLEDİLDİ!");
    });
    
    socket.on('teamDefeated', () => {
        triggerGameOver();
    });
    
    socket.on('errorMsg', (msg) => {
        alert(msg);
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        isMultiplayer = false;
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('start-screen').classList.remove('hidden');
    });
}

// 12. Lobby UI Updater
function updateLobbyPlayersList(players) {
    const listDiv = document.getElementById('lobby-players-list');
    listDiv.innerHTML = '';
    
    for (const pid in players) {
        const p = players[pid];
        const isPlayerHost = pid === socket.id ? isHost : (p.id === socket.id ? false : false); // simple indicator
        
        const item = document.createElement('div');
        item.className = 'player-lobby-item';
        item.innerHTML = `
            <span>👤 ${p.name} ${pid === socket.id ? ' (Sen)' : ''}</span>
            <span class="ready-badge ${isPlayerHost ? 'host' : 'joined'}">${isPlayerHost ? 'KURUCU' : 'KATILDI'}</span>
        `;
        listDiv.appendChild(item);
    }
}

// 13. Team HUD Updater
function updateTeamHUD() {
    const teamDiv = document.getElementById('team-list');
    teamDiv.innerHTML = '';
    
    for (const pid in otherPlayers) {
        const p = otherPlayers[pid];
        const row = document.createElement('div');
        row.className = `team-player-row ${p.isDead ? 'dead' : ''}`;
        row.innerHTML = `
            <span class="player-name">👤 ${p.name}</span>
            <span class="player-status">${p.isDead ? '🩸 ELENDİ' : '🏃 AKTİF'}</span>
        `;
        teamDiv.appendChild(row);
    }
}

// 14. 3D Player Avatars Spawners
function setupOtherPlayersAvatars(players) {
    for (const pid in otherPlayers) {
        scene.remove(otherPlayers[pid].avatarGroup);
    }
    otherPlayers = {};
    
    const colors = [0x00ff66, 0x3366ff, 0xffaa00, 0xcc00ff];
    let idx = 0;
    
    for (const pid in players) {
        if (pid === socket.id) continue;
        
        const pData = players[pid];
        const color = colors[idx % colors.length];
        idx++;
        
        const avatarGroup = createPlayerAvatar(pData.name, color);
        otherPlayers[pid] = {
            avatarGroup,
            name: pData.name,
            isDead: pData.isDead,
            position: new THREE.Vector3(6, 1.6, 6),
            targetPos: new THREE.Vector3(6, 1.6, 6)
        };
    }
    
    updateTeamHUD();
}

function createPlayerAvatar(name, color = 0x00ff66) {
    const group = new THREE.Group();
    
    // Torso
    const torsoGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.2, 8);
    const torsoMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.5 });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 0.6;
    torso.castShadow = true;
    torso.receiveShadow = true;
    group.add(torso);
    
    // Head
    const headGeo = new THREE.SphereGeometry(0.22, 12, 12);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffdbac, roughness: 0.8 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.35;
    head.castShadow = true;
    group.add(head);
    
    // Hoodie hood
    const hoodGeo = new THREE.SphereGeometry(0.26, 12, 12, 0, Math.PI * 2, 0, Math.PI / 1.5);
    const hoodMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.6, side: THREE.DoubleSide });
    const hood = new THREE.Mesh(hoodGeo, hoodMat);
    hood.position.y = 1.35;
    hood.rotation.x = 0.2;
    group.add(hood);
    
    // floating Name Tag
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name, 128, 40);
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.y = 1.9;
    sprite.scale.set(1.5, 0.375, 1);
    group.add(sprite);

    // Flashlight SpotLight pointing down the negative Z-axis (which is the default forward direction)
    const otherFlashlight = new THREE.SpotLight(0xfff5dd, 3.0, 35.0, Math.PI / 5.2, 0.7, 1.0);
    otherFlashlight.position.set(0, 1.35, -0.15); // head height, slightly forward
    otherFlashlight.castShadow = true;
    otherFlashlight.shadow.mapSize.width = 256;
    otherFlashlight.shadow.mapSize.height = 256;
    otherFlashlight.shadow.bias = -0.002;
    group.add(otherFlashlight);
    
    // Spotlight Target (relative to avatar group)
    const otherLightTarget = new THREE.Object3D();
    otherLightTarget.position.set(0, 1.35, -5.0); // 5 units forward
    group.add(otherLightTarget);
    otherFlashlight.target = otherLightTarget;

    group.userData = {
        flashlight: otherFlashlight,
        lightTarget: otherLightTarget
    };
    
    scene.add(group);
    return group;
}

// 15. Skills Mechanics Activation
function triggerSkill(skillName) {
    const skill = skills[skillName];
    if (!skill || skill.currentCd > 0 || isPlayerDead || gameState !== 'play') return;
    
    skill.currentCd = skill.cooldown;
    updateSkillUI(skillName);
    
    if (skillName === 'flash') {
        audioSystem.playFlashlightClick();
        
        // 3D PointLight flash effect in the maze scene
        const flashLight = new THREE.PointLight(0xffffff, 8.0, 18.0, 1.2);
        flashLight.position.copy(camera.position);
        scene.add(flashLight);
        
        // Smoothly fade out the 3D PointLight
        let flashIntensity = 8.0;
        const interval = setInterval(() => {
            flashIntensity -= 0.8;
            if (flashIntensity <= 0) {
                scene.remove(flashLight);
                clearInterval(interval);
            } else {
                flashLight.intensity = flashIntensity;
            }
        }, 40);
        
        // Quick, non-blinding screen flash overlay (semi-transparent, fast fadeout)
        const flash = document.createElement('div');
        flash.style.position = 'fixed';
        flash.style.top = '0';
        flash.style.left = '0';
        flash.style.width = '100vw';
        flash.style.height = '100vh';
        flash.style.background = '#ffffff';
        flash.style.zIndex = '99999';
        flash.style.opacity = '0.4'; // only 40% opacity, so player is not blinded
        flash.style.transition = 'opacity 0.3s ease-out';
        document.body.appendChild(flash);
        
        setTimeout(() => {
            flash.style.opacity = '0';
            setTimeout(() => flash.remove(), 300);
        }, 50);
        
        // Stun local monster if close
        const dist = camera.position.distanceTo(monster.position);
        if (dist < 6.5) {
            monster.stunTimer = 3.5;
            showNotification("YARATIK KÖRLENDİ! (3.5 Sn)");
        } else {
            showNotification("IŞIK BOMBASI KULLANILDI!");
        }
        
        if (isMultiplayer && socket) {
            socket.emit('useSkill', { roomCode, skillName, position: camera.position });
        }
    } else if (skillName === 'dash') {
        dashTimer = 0.4;
        camera.getWorldDirection(dashDirection);
        dashDirection.y = 0;
        dashDirection.normalize();
        
        audioSystem.playFootstep(true);
        showNotification("ANİ DEPAR ATILDI!");
        
        if (isMultiplayer && socket) {
            socket.emit('useSkill', { roomCode, skillName, position: camera.position, forwardDir: dashDirection });
        }
    } else if (skillName === 'invisible') {
        invisibilityTimer = 3.0;
        showNotification("GÖRÜNMEZLİK AKTİF! (3 Sn)");
        
        const vignette = document.getElementById('proximity-vignette');
        if (vignette) {
            vignette.style.boxShadow = 'inset 0 0 100px rgba(0, 150, 255, 0.4)';
        }
        
        if (isMultiplayer && socket) {
            socket.emit('useSkill', { roomCode, skillName, position: camera.position });
        }
    }
}

function updateSkillUI(skillName) {
    const skill = skills[skillName];
    let slotId = '';
    let overlayId = '';
    let mobBtnId = '';
    
    if (skillName === 'flash') { slotId = 'skill-flash'; overlayId = 'cooldown-flash'; mobBtnId = 'mobile-btn-flash'; }
    else if (skillName === 'dash') { slotId = 'skill-dash'; overlayId = 'cooldown-dash'; mobBtnId = 'mobile-btn-dash'; }
    else if (skillName === 'invisible') { slotId = 'skill-invisible'; overlayId = 'cooldown-invisible'; mobBtnId = 'mobile-btn-invisible'; }
    
    const slot = document.getElementById(slotId);
    const overlay = document.getElementById(overlayId);
    const mobBtn = document.getElementById(mobBtnId);
    
    if (skill.currentCd > 0) {
        const ratio = (skill.currentCd / skill.cooldown) * 100;
        overlay.style.transform = `translateY(${100 - ratio}%)`;
        slot.classList.remove('ready');
        if (mobBtn) mobBtn.classList.add('cooldown');
    } else {
        overlay.style.transform = `translateY(100%)`;
        slot.classList.add('ready');
        if (mobBtn) mobBtn.classList.remove('cooldown');
    }
}

// Play effects of skills triggered by other players
function triggerRemoteSkillEffect(skillName, position, forwardDir) {
    if (skillName === 'flash') {
        const light = new THREE.PointLight(0xffffff, 2.0, 15.0);
        light.position.copy(position);
        scene.add(light);
        setTimeout(() => scene.remove(light), 150);
        
        showNotification("BİRİ IŞIK BOMBASI PATLATTI!");
    } else if (skillName === 'dash') {
        showNotification("BİR OYUNCU HIZLANDI!");
    } else if (skillName === 'invisible') {
        showNotification("BİR OYUNCU GÖRÜNMEZ OLDU!");
    }
}

// Team Defeat trigger Game Over UI
function triggerGameOver() {
    gameState = 'gameover';
    audioSystem.stopAllLoops();
    
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('game-over-screen').classList.remove('hidden');
    document.getElementById('end-crystals').innerText = `${crystalsCollected} / 8`;
    document.getElementById('end-time').innerText = `${Math.floor(gameTime)} sn`;
    
    if (document.pointerLockElement) {
        document.exitPointerLock();
    }
}
