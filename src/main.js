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
let playerColor = '#00ff66';
let playerFaceBase64 = null;
let flashPointLight = null;

// Start Screen 3D Preview Engine Variables
let previewScene = null;
let previewCamera = null;
let previewRenderer = null;
let previewAvatarGroup = null;

// Audio customization variables (Death / Victory)
let deathAudioBase64 = null;
let victoryAudioBase64 = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecordingAudio = false;
let recordingTarget = ''; // 'death' or 'victory'

// Spectator modes list
let spectatorTargetList = [];
let spectatorIndex = 0;

// Game Settings and Proximity Voice Chat variables
let mouseSensitivity = 0.0022;
let voiceMediaRecorder = null;
let voiceStream = null;
let isVoiceChatting = false;


// Co-op Game Session settings
let totalCrystalsRequired = 8;

// Character Skills & Cooldowns
const skills = {
    flash: { cooldown: 20.0, currentCd: 0.0, count: 0 },
    dash: { cooldown: 8.0, currentCd: 0.0, count: -1 }, // infinite
    invisible: { cooldown: 15.0, currentCd: 0.0, count: 0 }
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
    initStartScreenPreview();
    setupPaintEditor();
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

    // Pre-allocated Flash PointLight (non-shadow casting to avoid GPU hitching/lag during flashbangs)
    flashPointLight = new THREE.PointLight(0xffffff, 0.0, 18.0, 1.2);
    flashPointLight.castShadow = false;
    scene.add(flashPointLight);

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
            showPauseMenu();
        }
    });

    window.addEventListener('keydown', (e) => {
        console.log("Tuşa basıldı:", e.key, "Kod:", e.code, "KeyCode:", e.keyCode, "Durum:", gameState);
        
        // Handle Escape in both play and paused states
        if (e.code === 'Escape' || e.keyCode === 27) {
            if (gameState === 'play') {
                showPauseMenu();
            } else if (gameState === 'paused') {
                resumeGame();
            }
            return;
        }

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
            case 'KeyT':
                if (isMultiplayer) {
                    startVoiceTransmission();
                }
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
            case 'KeyT':
                if (isMultiplayer) {
                    stopVoiceTransmission();
                }
                break;
        }
    });

    window.addEventListener('blur', () => {
        stopVoiceTransmission();
    });

    window.addEventListener('mousemove', (e) => {
        if (document.pointerLockElement !== canvas && !isTouchDevice) return;
        if (gameState !== 'play') return;

        playerYaw -= e.movementX * mouseSensitivity;
        playerPitch -= e.movementY * mouseSensitivity;

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
        
        socket.emit('createRoom', { 
            playerName, 
            playerColor, 
            playerFace: playerFaceBase64,
            playerDeathSound: deathAudioBase64,
            playerVictorySound: victoryAudioBase64
        });
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
        
        socket.emit('joinRoom', { 
            roomCode: codeVal, 
            playerName, 
            playerColor, 
            playerFace: playerFaceBase64,
            playerDeathSound: deathAudioBase64,
            playerVictorySound: victoryAudioBase64
        });
    });

    // Color Picker input listener
    document.getElementById('player-color-picker').addEventListener('input', (e) => {
        playerColor = e.target.value;
        updatePreviewAvatar();
    });

    // File inputs for custom audio uploads
    document.getElementById('upload-death-btn').addEventListener('click', () => {
        document.getElementById('file-death-input').click();
    });
    document.getElementById('file-death-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = event => {
                deathAudioBase64 = event.target.result;
                document.getElementById('death-sound-status').innerText = `📁 ${file.name.substring(0, 15)}...`;
                document.getElementById('death-sound-status').style.color = '#00ff66';
                showNotification("Ölüm Sesi Yüklendi!");
            };
            reader.readAsDataURL(file);
        }
    });

    document.getElementById('upload-win-btn').addEventListener('click', () => {
        document.getElementById('file-win-input').click();
    });
    document.getElementById('file-win-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = event => {
                victoryAudioBase64 = event.target.result;
                document.getElementById('win-sound-status').innerText = `📁 ${file.name.substring(0, 15)}...`;
                document.getElementById('win-sound-status').style.color = '#00ff66';
                showNotification("Kazanma Sesi Yüklendi!");
            };
            reader.readAsDataURL(file);
        }
    });

    // Mic recording actions
    document.getElementById('record-death-btn').addEventListener('click', () => {
        startRecordingAudio('death');
    });
    document.getElementById('record-win-btn').addEventListener('click', () => {
        startRecordingAudio('win');
    });

    // Spectator Switcher buttons listeners
    document.getElementById('spec-prev-btn').addEventListener('click', () => {
        if (spectatorTargetList.length > 0) {
            spectatorIndex = (spectatorIndex - 1 + spectatorTargetList.length) % spectatorTargetList.length;
        }
    });
    document.getElementById('spec-next-btn').addEventListener('click', () => {
        if (spectatorTargetList.length > 0) {
            spectatorIndex = (spectatorIndex + 1) % spectatorTargetList.length;
        }
    });

    // Start Game from Lobby (Host only)
    document.getElementById('lobby-start-btn').addEventListener('click', () => {
        if (!isHost || !socket) return;
        
        // Host generates the level grid and spawns items/batteries/chests
        const tempMaze = new Maze(scene, THREE);
        const mazeGrid = tempMaze.grid;
        
        const crystals = tempMaze.items.map(item => ({ gridX: item.gridX, gridY: item.gridY }));
        const batteries = tempMaze.batteries.map(bat => ({ gridX: bat.gridX, gridY: bat.gridY }));
        const chests = tempMaze.chests.map(c => ({ gridX: c.gridX, gridY: c.gridY }));
        
        tempMaze.destroy(); // destroy the temporary maze
        
        socket.emit('startGame', {
            roomCode,
            mazeGrid,
            items: crystals,
            batteries,
            chests
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
        
        // Re-init preview
        setTimeout(() => {
            initStartScreenPreview();
        }, 100);
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

    // Pause / settings menu buttons
    document.getElementById('resume-game-btn').addEventListener('click', resumeGame);
    document.getElementById('settings-menu-btn').addEventListener('click', () => {
        document.getElementById('settings-overlay').classList.remove('hidden');
    });
    document.getElementById('close-settings-btn').addEventListener('click', () => {
        document.getElementById('settings-overlay').classList.add('hidden');
    });
    document.getElementById('return-lobby-btn').addEventListener('click', () => {
        hidePauseMenu();
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        isMultiplayer = false;
        isHost = false;
        gameState = 'start';
        document.getElementById('hud').classList.add('hidden');
        document.getElementById('spectator-hud').classList.add('hidden');
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('start-screen').classList.remove('hidden');
        setTimeout(() => {
            initStartScreenPreview();
        }, 100);
    });

    // Sensitivity slider
    document.getElementById('sensitivity-slider').addEventListener('input', (e) => {
        mouseSensitivity = (parseInt(e.target.value) / 10.0) * 0.0022;
    });

    // Volume slider
    document.getElementById('volume-slider').addEventListener('input', (e) => {
        const vol = parseFloat(e.target.value) / 100.0;
        audioSystem.setVolume(vol);
    });
}

function startGame() {
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('team-card').classList.add('hidden');
    document.getElementById('spectator-hud').classList.add('hidden');
    
    isPlayerDead = false;
    invisibilityTimer = 0.0;
    dashTimer = 0.0;
    
    // Reset skills CD and count
    for (const key in skills) {
        skills[key].currentCd = 0.0;
        skills[key].count = key === 'dash' ? -1 : 0;
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
    document.getElementById('spectator-hud').classList.add('hidden');
    
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
    
    // Reset skills CD and count
    for (const key in skills) {
        skills[key].currentCd = 0.0;
        skills[key].count = key === 'dash' ? -1 : 0;
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
    if (deathAudioBase64) {
        playBase64Audio(deathAudioBase64);
    }
    
    // Wait 2.2 seconds then show Game Over Menu or Spectate
    setTimeout(() => {
        overlay.style.display = 'none';
        document.body.classList.remove('glitch-shake');
        
        if (isMultiplayer) {
            showNotification("KATLEDİLDİN! TAKIMINI İZLİYORSUN...");
            gameState = 'spectator';
            document.getElementById('spectator-hud').classList.remove('hidden');
            // Disable pointer lock if they want
            if (document.pointerLockElement) {
                document.exitPointerLock();
            }
        } else {
            document.getElementById('hud').classList.add('hidden');
            document.getElementById('spectator-hud').classList.add('hidden');
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
    
    if (victoryAudioBase64) {
        playBase64Audio(victoryAudioBase64);
    } else {
        audioSystem.playVictory();
    }
    
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('spectator-hud').classList.add('hidden');
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
            // Spectator mode: Switch between alive other players manually
            spectatorTargetList = [];
            for (const pid in otherPlayers) {
                if (!otherPlayers[pid].isDead) {
                    spectatorTargetList.push(pid);
                }
            }
            
            if (spectatorTargetList.length > 0) {
                if (spectatorIndex >= spectatorTargetList.length) {
                    spectatorIndex = 0;
                }
                const targetPid = spectatorTargetList[spectatorIndex];
                const spectateTarget = otherPlayers[targetPid];
                if (spectateTarget) {
                    camera.position.lerp(new THREE.Vector3(spectateTarget.position.x, playerHeight, spectateTarget.position.z), deltaTime * 5.0);
                    document.getElementById('spec-player-name').innerText = spectateTarget.name;
                }
            } else {
                document.getElementById('spec-player-name').innerText = "Herkes Elendi";
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
    
    // 4. Chest Pickups
    for (let i = maze.chests.length - 1; i >= 0; i--) {
        const chest = maze.chests[i];
        const chestPos = new THREE.Vector3(chest.mesh.position.x, 0, chest.mesh.position.z);
        
        if (currentLoc.distanceTo(chestPos) < 1.35) {
            chest.mesh.visible = false;
            chest.light.intensity = 0.0;
            
            const itemIndex = maze.allChests.indexOf(chest);
            maze.chests.splice(i, 1);
            
            if (isMultiplayer) {
                socket.emit('collectItem', { roomCode, itemType: 'chest', itemIndex, playerId: socket.id });
            } else {
                awardRandomSkill();
            }
        }
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
    
    socket.on('gameStarted', ({ mazeGrid, items, batteries, chests, players }) => {
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('hud').classList.remove('hidden');
        document.getElementById('team-card').classList.remove('hidden');
        
        isPlayerDead = false;
        
        // Rebuild level from host preset
        maze.destroy();
        monster.destroy();
        
        maze = new Maze(scene, THREE, { mazeGrid, items, batteries, chests });
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
        document.getElementById('spectator-hud').classList.add('hidden');
        
        // Reset skills UI and CD
        for (const key in skills) {
            skills[key].currentCd = 0;
            skills[key].count = key === 'dash' ? -1 : 0;
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
        
        // Update Flashlight & arm pitch angle
        if (pObj.avatarGroup.userData.flashlight) {
            const isFlippedOn = player.isFlashlightOn && !pObj.isDead && player.activeSkill !== 'invisible';
            pObj.avatarGroup.userData.flashlight.visible = isFlippedOn;
            
            const handGroup = pObj.avatarGroup.userData.handGroup;
            if (handGroup) {
                handGroup.rotation.x = player.pitch;
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
        } else if (itemType === 'chest') {
            const chest = maze.allChests[itemIndex];
            if (chest && chest.mesh.visible) {
                chest.mesh.visible = false;
                chest.light.intensity = 0.0;
                
                const idx = maze.chests.indexOf(chest);
                if (idx !== -1) maze.chests.splice(idx, 1);
                
                audioSystem.playPickup();
                
                if (playerId === socket.id) {
                    awardRandomSkill();
                } else {
                    showNotification("TAKIM ARKADAŞI BİR SANDIK AÇTI!");
                }
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
            
            // Play custom death sound of caught player
            if (pObj.deathSound) {
                playBase64Audio(pObj.deathSound);
            }
        }
        showNotification("BİR OYUNCU KATLEDİLDİ!");
    });
    
    socket.on('teamDefeated', () => {
        triggerGameOver();
    });

    socket.on('voicePacket', ({ playerId, audio }) => {
        const pObj = otherPlayers[playerId];
        if (!pObj || pObj.isDead) return;
        
        // Proximity distance check
        const dist = camera.position.distanceTo(pObj.avatarGroup.position);
        const maxVoiceDistance = 25.0; // units/meters
        if (dist > maxVoiceDistance) return;
        
        // Calculate volume scale based on proximity distance (linear rolloff)
        const vol = Math.max(0.0, 1.0 - (dist / maxVoiceDistance));
        
        // Play audio chunk
        try {
            const playerAud = new Audio(audio);
            const globalVol = parseFloat(document.getElementById('volume-slider').value) / 100.0;
            const micGain = parseFloat(document.getElementById('mic-gain-slider').value) / 5.0; // standard gain multiplier
            playerAud.volume = vol * globalVol * micGain;
            playerAud.play().catch(e => {});
        } catch(err) {
            console.error("Error playing voice packet:", err);
        }
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
        
        const avatarGroup = createPlayerAvatar(pData.name, pData.color, pData.face);
        otherPlayers[pid] = {
            avatarGroup,
            name: pData.name,
            isDead: pData.isDead,
            position: new THREE.Vector3(6, 1.6, 6),
            targetPos: new THREE.Vector3(6, 1.6, 6),
            deathSound: pData.deathSound,
            victorySound: pData.victorySound
        };
    }
    
    updateTeamHUD();
}

function createPlayerAvatar(name, color = '#00ff66', faceBase64 = null) {
    const group = new THREE.Group();
    
    // Torso
    const torsoGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.2, 8);
    const torsoMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.5 });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 0.6;
    torso.castShadow = true;
    torso.receiveShadow = true;
    group.add(torso);
    
    // Custom Spherical Head
    const headGeo = new THREE.SphereGeometry(0.22, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffdbac, roughness: 0.8 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.35;
    head.castShadow = true;
    group.add(head);
    
    // Front Visor circular plate holding the face texture to avoid sphere distortion
    let faceMat;
    if (faceBase64) {
        const img = new Image();
        img.src = faceBase64;
        const faceTex = new THREE.Texture(img);
        img.onload = () => {
            faceTex.needsUpdate = true;
        };
        faceMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.6, transparent: true });
    } else {
        // Pixel smiley face fallback
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffdbac';
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = '#000000';
        ctx.fillRect(16, 20, 8, 8);
        ctx.fillRect(40, 20, 8, 8);
        ctx.fillStyle = '#ff3366';
        ctx.fillRect(20, 42, 24, 6);
        
        const faceTex = new THREE.CanvasTexture(canvas);
        faceMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.6, transparent: true });
    }

    const visorGeo = new THREE.CircleGeometry(0.12, 16);
    const visor = new THREE.Mesh(visorGeo, faceMat);
    visor.position.set(0, 1.35, -0.225); // front surface offset (radius of head is 0.22, placed slightly outside to prevent clipping)
    visor.rotation.y = Math.PI; // Face forward down negative Z axis
    group.add(visor);
    
    // Hoodie hood cover
    const hoodGeo = new THREE.SphereGeometry(0.26, 12, 12, 0, Math.PI * 2, 0, Math.PI / 1.5);
    const hoodMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.6, side: THREE.DoubleSide });
    const hood = new THREE.Mesh(hoodGeo, hoodMat);
    hood.position.y = 1.35;
    hood.rotation.x = -0.55; // Tilt hood backward to fully expose the face/visor
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

    // Right arm/flashlight group
    const handGroup = new THREE.Group();
    handGroup.position.set(0.35, 0.85, 0); // pivot at shoulder
    group.add(handGroup);

    // 3D Flashlight Cylinders
    const handleGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.25, 6);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.set(0, -0.2, -0.2); // offset from pivot forward
    handle.rotation.x = Math.PI / 2;
    handGroup.add(handle);

    const headGeo2 = new THREE.CylinderGeometry(0.05, 0.03, 0.08, 6);
    const headMat2 = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5 });
    const fhead = new THREE.Mesh(headGeo2, headMat2);
    fhead.position.set(0, -0.2, -0.34);
    fhead.rotation.x = Math.PI / 2;
    handGroup.add(fhead);

    // Flashlight SpotLight pointing down the negative Z-axis (default forward direction)
    const otherFlashlight = new THREE.SpotLight(0xfff5dd, 3.0, 35.0, Math.PI / 5.2, 0.7, 1.0);
    otherFlashlight.position.set(0, -0.2, -0.4); // tip of flashlight
    otherFlashlight.castShadow = true;
    otherFlashlight.shadow.mapSize.width = 256;
    otherFlashlight.shadow.mapSize.height = 256;
    otherFlashlight.shadow.bias = -0.002;
    handGroup.add(otherFlashlight);
    
    // Spotlight Target (relative to handGroup)
    const otherLightTarget = new THREE.Object3D();
    otherLightTarget.position.set(0, -0.2, -5.0); // 5 units forward
    handGroup.add(otherLightTarget);
    otherFlashlight.target = otherLightTarget;

    group.userData = {
        flashlight: otherFlashlight,
        lightTarget: otherLightTarget,
        handGroup: handGroup
    };
    
    scene.add(group);
    return group;
}

// 15. Skills Mechanics Activation
function triggerSkill(skillName) {
    const skill = skills[skillName];
    if (!skill || skill.currentCd > 0 || isPlayerDead || gameState !== 'play') return;
    
    if (skill.count === 0) {
        showNotification("YETENEK KİLİTLİ! SANDIKLARDAN BULMALISIN.");
        return;
    }
    
    if (skill.count > 0) {
        skill.count--;
    }
    
    skill.currentCd = skill.cooldown;
    updateSkillUI(skillName);
    
    if (skillName === 'flash') {
        audioSystem.playFlashlightClick();
        
        // Reusable PointLight flash (no shader stalls or re-allocs)
        flashPointLight.position.copy(camera.position);
        flashPointLight.intensity = 8.0;
        
        let flashIntensity = 8.0;
        const interval = setInterval(() => {
            flashIntensity -= 0.8;
            if (flashIntensity <= 0) {
                flashPointLight.intensity = 0.0;
                clearInterval(interval);
            } else {
                flashPointLight.intensity = flashIntensity;
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
            showNotification("PANDİK CANAVARI KÖRLENDİ! (3.5 Sn)");
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
    
    // Update count badge
    const countBadge = document.getElementById(`count-${skillName}`);
    if (countBadge) {
        countBadge.innerText = skill.count === -1 ? '∞' : skill.count;
    }
    
    if (skill.count === 0) {
        slot.classList.add('locked');
    } else {
        slot.classList.remove('locked');
    }
    
    if (skill.currentCd > 0) {
        const ratio = (skill.currentCd / skill.cooldown) * 100;
        overlay.style.transform = `translateY(${100 - ratio}%)`;
        slot.classList.remove('ready');
        if (mobBtn) {
            mobBtn.classList.add('cooldown');
        }
    } else {
        overlay.style.transform = `translateY(100%)`;
        if (skill.count !== 0) {
            slot.classList.add('ready');
            if (mobBtn) mobBtn.classList.remove('cooldown');
        } else {
            slot.classList.remove('ready');
            if (mobBtn) mobBtn.classList.add('cooldown');
        }
    }
    
    // Update mobile button texts dynamically with charges/lock status
    if (mobBtn) {
        if (skill.count === 0) {
            mobBtn.innerText = skillName === 'flash' ? '💥 Kilitli' : '👤 Kilitli';
        } else {
            mobBtn.innerText = skillName === 'flash' 
                ? `💥 Flash (${skill.count})` 
                : (skillName === 'invisible' ? `👤 Gizlen (${skill.count})` : '🏃 Koş');
        }
    }
}

// Play effects of skills triggered by other players
function triggerRemoteSkillEffect(skillName, position, forwardDir) {
    if (skillName === 'flash') {
        flashPointLight.position.copy(position);
        flashPointLight.intensity = 6.0;
        setTimeout(() => {
            flashPointLight.intensity = 0.0;
        }, 150);
        
        showNotification("BİRİ IŞIK BOMBASI PATLATTI!");
    } else if (skillName === 'dash') {
        showNotification("BİR OYUNCU HIZLANDI!");
    } else if (skillName === 'invisible') {
        showNotification("BİR OYUNCU GÖRÜNMEZ OLDU!");
    }
}

// Award random skill when looting a chest
function awardRandomSkill() {
    audioSystem.playPickup();
    const rand = Math.random() > 0.5 ? 'flash' : 'invisible';
    skills[rand].count++;
    
    const skillNameTr = rand === 'flash' ? 'Işık Bombası' : 'Görünmezlik';
    const skillIcon = rand === 'flash' ? '💥' : '👤';
    showNotification(`${skillIcon} +1 ${skillNameTr} Yeteneği Kazanıldı!`);
    
    updateSkillUI(rand);
}

// Team Defeat trigger Game Over UI
function triggerGameOver() {
    gameState = 'gameover';
    audioSystem.stopAllLoops();
    
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('spectator-hud').classList.add('hidden');
    document.getElementById('game-over-screen').classList.remove('hidden');
    document.getElementById('end-crystals').innerText = `${crystalsCollected} / 8`;
    document.getElementById('end-time').innerText = `${Math.floor(gameTime)} sn`;
    
    if (document.pointerLockElement) {
        document.exitPointerLock();
    }
}

// 3D Start Screen Avatar Previews Engine
function initStartScreenPreview() {
    const container = document.getElementById('preview-3d-container');
    if (!container) return;
    
    // Clear old preview renderer if exists
    container.innerHTML = '';
    
    previewScene = new THREE.Scene();
    previewScene.background = new THREE.Color(0x050102);
    previewScene.fog = new THREE.FogExp2(0x050102, 0.22);
    
    previewCamera = new THREE.PerspectiveCamera(48, container.clientWidth / container.clientHeight, 0.1, 10);
    previewCamera.position.set(0, 1.0, 1.95);
    previewCamera.lookAt(0, 0.9, 0);
    
    previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    previewRenderer.setSize(container.clientWidth, container.clientHeight);
    previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    previewRenderer.shadowMap.enabled = true;
    container.appendChild(previewRenderer.domElement);
    
    const amb = new THREE.AmbientLight(0xffffff, 0.2);
    previewScene.add(amb);
    
    const spot = new THREE.SpotLight(0xffffff, 2.5, 10.0, Math.PI / 5, 0.5, 1.0);
    spot.position.set(1.0, 2.5, 1.5);
    spot.castShadow = true;
    previewScene.add(spot);

    const redGlow = new THREE.PointLight(0xff0033, 1.8, 3.5);
    redGlow.position.set(0, 0.1, 0);
    previewScene.add(redGlow);
    
    updatePreviewAvatar();
    
    function animatePreview() {
        if (gameState !== 'start') return;
        requestAnimationFrame(animatePreview);
        
        if (previewAvatarGroup) {
            previewAvatarGroup.rotation.y += 0.012;
        }
        previewRenderer.render(previewScene, previewCamera);
    }
    requestAnimationFrame(animatePreview);
}

function updatePreviewAvatar() {
    if (!previewScene) return;
    if (previewAvatarGroup) {
        previewScene.remove(previewAvatarGroup);
        previewAvatarGroup.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
    }
    
    previewAvatarGroup = createPlayerAvatar(playerName, playerColor, playerFaceBase64);
    previewAvatarGroup.position.set(0, 0, 0);
    previewScene.add(previewAvatarGroup);
}

// Media Recorder microphone capture (up to 3 seconds)
function startRecordingAudio(target) {
    if (isRecordingAudio) return;
    
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            isRecordingAudio = true;
            recordingTarget = target;
            audioChunks = [];
            
            const btn = document.getElementById(`record-${target}-btn`);
            btn.innerText = "🛑 Kaydediyor...";
            btn.style.background = '#ff0033';
            
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.ondataavailable = e => {
                audioChunks.push(e.data);
            };
            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.onload = event => {
                    const base64 = event.target.result;
                    if (recordingTarget === 'death') {
                        deathAudioBase64 = base64;
                        document.getElementById('death-sound-status').innerText = '🎙️ Mikrofon Kaydı Hazır (3sn)';
                        document.getElementById('death-sound-status').style.color = '#00ff66';
                    } else {
                        victoryAudioBase64 = base64;
                        document.getElementById('win-sound-status').innerText = '🎙️ Mikrofon Kaydı Hazır (3sn)';
                        document.getElementById('win-sound-status').style.color = '#00ff66';
                    }
                    showNotification("Ses Kaydı Alındı!");
                };
                reader.readAsDataURL(audioBlob);
                
                btn.innerText = "🎙️ Kaydet";
                btn.style.background = recordingTarget === 'death' ? '#7c0010' : '#007c40';
                
                stream.getTracks().forEach(track => track.stop());
                isRecordingAudio = false;
            };
            
            mediaRecorder.start();
            
            setTimeout(() => {
                if (isRecordingAudio && mediaRecorder.state !== 'inactive') {
                    mediaRecorder.stop();
                }
            }, 3000);
        })
        .catch(err => {
            console.error("Mic access denied:", err);
            alert("Mikrofon izni alınamadı!");
        });
}

// Play custom audio Base64 string natively
function playBase64Audio(base64Data) {
    try {
        const audio = new Audio(base64Data);
        audio.volume = 1.0;
        audio.play().catch(e => console.error("Error playing custom audio:", e));
    } catch(e) {
        console.error("Failed playing custom audio:", e);
    }
}

// Paint tool functions
let paintCanvas, paintCtx;
let isDrawingPaint = false;
let brushColor = '#000000';
let brushSize = 4;
let uploadedImage = null;
let faceScale = 100;
let faceOffsetX = 0;
let faceOffsetY = 0;

function setupPaintEditor() {
    paintCanvas = document.getElementById('paint-canvas');
    if (!paintCanvas) return;
    paintCtx = paintCanvas.getContext('2d');
    
    resetPaintCanvas();
    
    paintCanvas.addEventListener('mousedown', (e) => { isDrawingPaint = true; drawOnPaintCanvas(e); });
    paintCanvas.addEventListener('mousemove', (e) => { if (isDrawingPaint) drawOnPaintCanvas(e); });
    paintCanvas.addEventListener('mouseup', () => isDrawingPaint = false);
    paintCanvas.addEventListener('mouseleave', () => isDrawingPaint = false);
    
    paintCanvas.addEventListener('touchstart', (e) => { e.preventDefault(); isDrawingPaint = true; drawOnPaintCanvas(e.touches[0]); }, { passive: false });
    paintCanvas.addEventListener('touchmove', (e) => { e.preventDefault(); if (isDrawingPaint) drawOnPaintCanvas(e.touches[0]); }, { passive: false });
    paintCanvas.addEventListener('touchend', () => isDrawingPaint = false);

    document.querySelectorAll('.brush-color').forEach(el => {
        el.addEventListener('click', (e) => {
            document.querySelectorAll('.brush-color').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            brushColor = e.target.dataset.color;
        });
    });
    
    document.getElementById('brush-size-slider').addEventListener('input', (e) => {
        brushSize = parseInt(e.target.value);
    });
    
    document.getElementById('clear-canvas-btn').addEventListener('click', () => {
        uploadedImage = null;
        resetPaintCanvas();
    });
    
    document.getElementById('face-scale-slider').addEventListener('input', (e) => {
        faceScale = parseInt(e.target.value);
        redrawPaintCanvas();
    });
    document.getElementById('face-offset-x-slider').addEventListener('input', (e) => {
        faceOffsetX = parseInt(e.target.value);
        redrawPaintCanvas();
    });
    document.getElementById('face-offset-y-slider').addEventListener('input', (e) => {
        faceOffsetY = parseInt(e.target.value);
        redrawPaintCanvas();
    });

    // File input for custom player face
    const faceInput = document.getElementById('player-face-input');
    if (faceInput) {
        faceInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = event => {
                    uploadedImage = new Image();
                    uploadedImage.onload = () => {
                        redrawPaintCanvas();
                    };
                    uploadedImage.src = event.target.result;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // Name change update local preview
    document.getElementById('player-name-input').addEventListener('input', (e) => {
        playerName = e.target.value.trim() || "Oyuncu";
        updatePreviewAvatar();
    });
}

function resetPaintCanvas() {
    paintCtx.fillStyle = '#ffdbac';
    paintCtx.fillRect(0, 0, 128, 128);
    
    paintCtx.fillStyle = '#000000';
    paintCtx.fillRect(32, 40, 16, 16);
    paintCtx.fillRect(80, 40, 16, 16);
    paintCtx.fillStyle = '#ff3366';
    paintCtx.fillRect(40, 84, 48, 12);
    
    savePaintCanvasToFace();
}

function drawOnPaintCanvas(e) {
    const rect = paintCanvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 128;
    const y = ((e.clientY - rect.top) / rect.height) * 128;
    
    paintCtx.fillStyle = brushColor;
    paintCtx.beginPath();
    paintCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    paintCtx.fill();
    
    savePaintCanvasToFace();
}

function redrawPaintCanvas() {
    paintCtx.clearRect(0, 0, 128, 128);
    paintCtx.fillStyle = '#ffdbac';
    paintCtx.fillRect(0, 0, 128, 128);
    
    if (uploadedImage) {
        const scale = faceScale / 100.0;
        const w = 128 * scale;
        const h = 128 * scale;
        const x = (128 - w) / 2 + faceOffsetX;
        const y = (128 - h) / 2 + faceOffsetY;
        paintCtx.drawImage(uploadedImage, x, y, w, h);
    }
    
    savePaintCanvasToFace();
}

function savePaintCanvasToFace() {
    playerFaceBase64 = paintCanvas.toDataURL('image/png');
    updatePreviewAvatar();
}

// Pause Menu Overlay & Settings Panel
function showPauseMenu() {
    if (gameState !== 'play') return;
    gameState = 'paused';
    document.getElementById('pause-menu').classList.remove('hidden');
    audioSystem.stopAllLoops();
    if (document.pointerLockElement) {
        document.exitPointerLock();
    }
}

function hidePauseMenu() {
    document.getElementById('pause-menu').classList.add('hidden');
    document.getElementById('settings-overlay').classList.add('hidden');
}

function resumeGame() {
    hidePauseMenu();
    gameState = 'play';
    if (!isTouchDevice) {
        canvas.requestPointerLock();
    }
}

// Proximity Voice Chat (PTT) functions
function startVoiceTransmission() {
    if (isVoiceChatting) return;
    isVoiceChatting = true;
    
    let pttIndicator = document.getElementById('ptt-indicator');
    if (!pttIndicator) {
        pttIndicator = document.createElement('div');
        pttIndicator.id = 'ptt-indicator';
        pttIndicator.style.cssText = "position: absolute; top: 20px; left: 50%; transform: translateX(-50%); background: rgba(0, 255, 102, 0.25); border: 2px solid #00ff66; color: #00ff66; padding: 5px 15px; border-radius: 20px; font-weight: 800; font-size: 14px; text-shadow: 0 0 10px #00ff66; z-index: 9999; pointer-events: none;";
        pttIndicator.innerText = "🎙️ MİKROFON AÇIK [T]";
        document.body.appendChild(pttIndicator);
    } else {
        pttIndicator.style.display = 'block';
    }
    
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            voiceStream = stream;
            voiceMediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            
            voiceMediaRecorder.ondataavailable = e => {
                if (e.data && e.data.size > 0 && isVoiceChatting && socket) {
                    const reader = new FileReader();
                    reader.onload = event => {
                        socket.emit('voicePacket', {
                            roomCode,
                            audio: event.target.result
                        });
                    };
                    reader.readAsDataURL(e.data);
                }
            };
            
            voiceMediaRecorder.start(200); // Chunks every 200ms
        })
        .catch(err => {
            console.error("PTT microphone access error:", err);
            isVoiceChatting = false;
            if (pttIndicator) pttIndicator.style.display = 'none';
        });
}

function stopVoiceTransmission() {
    if (!isVoiceChatting) return;
    isVoiceChatting = false;
    
    const pttIndicator = document.getElementById('ptt-indicator');
    if (pttIndicator) pttIndicator.style.display = 'none';
    
    if (voiceMediaRecorder && voiceMediaRecorder.state !== 'inactive') {
        try {
            voiceMediaRecorder.stop();
        } catch(e) {}
    }
    if (voiceStream) {
        voiceStream.getTracks().forEach(track => track.stop());
        voiceStream = null;
    }
}
