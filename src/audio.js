// Web Audio API Sound Synthesizer for 3D Horror Game
// Generates immersive, terrifying procedural horror audio on the fly.
import funnyMoanUrl from '../ses/freesound_community-funny_moaning-101177.mp3';
import girlScreamUrl from '../ses/freesound_community-girl_scream-6465.mp3';
import demonVoiceUrl from '../ses/phatphrogstudio-demon-spirit-voice-ghost-whispers-amp-muttering-496706.mp3';
import footstepsUrl from '../ses/soundreality-footsteps-walking-boots-parquet-1-420135.mp3';
import victorySoundUrl from '../ses/VictorySound.mp3';

const buffers = {
    funnyMoan: null,
    girlScream: null,
    demonVoice: null,
    footsteps: null,
    victorySound: null
};

let moanCooldown = 12.0; // random moans every 12-25s
let whisperCooldown = 25.0; // whispers every 25-45s

async function loadAudioFile(url) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return await audioCtx.decodeAudioData(arrayBuffer);
}

async function preloadSounds() {
    const loadAndAssign = async (key, url) => {
        try {
            buffers[key] = await loadAudioFile(url);
            console.log(`Loaded ${key} successfully`);
        } catch (err) {
            console.error(`Failed to load sound ${key} (${url}):`, err);
        }
    };

    await Promise.all([
        loadAndAssign('funnyMoan', funnyMoanUrl),
        loadAndAssign('girlScream', girlScreamUrl),
        loadAndAssign('demonVoice', demonVoiceUrl),
        loadAndAssign('footsteps', footstepsUrl),
        loadAndAssign('victorySound', victorySoundUrl)
    ]);
}

function playMonsterMoan(mX, mZ, pX, pZ, pYaw) {
    if (!audioCtx || isMuted) return;
    if (!buffers.funnyMoan) return;
    
    const dx = mX - pX;
    const dz = mZ - pZ;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance > 120) return; // hear moans up to 120m away
    
    const time = audioCtx.currentTime;
    
    const buffer = buffers.funnyMoan;
    if (!buffer) return;
    
    // 3D Panning & Spatial gain
    const volume = 2.2 / (1 + distance * 0.04);
    if (volume < 0.02) return;
    
    const angle = -pYaw;
    const cosAngle = Math.cos(angle);
    const sinAngle = Math.sin(angle);
    const localX = dx * cosAngle - dz * sinAngle;
    const localZ = dx * sinAngle + dz * cosAngle;
    const pan = Math.max(-0.95, Math.min(0.95, localX / (Math.abs(localX) + Math.abs(localZ) + 0.01)));
    
    let pannerNode;
    if (audioCtx.createStereoPanner) {
        pannerNode = audioCtx.createStereoPanner();
        pannerNode.pan.setValueAtTime(pan, time);
    }
    
    const gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(volume, time);
    
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    
    // Lowpass filter to muffle voices through maze concrete
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(distance > 20 ? 450 : 1500, time);
    
    source.connect(filter);
    if (pannerNode) {
        filter.connect(pannerNode);
        pannerNode.connect(gainNode);
    } else {
        filter.connect(gainNode);
    }
    gainNode.connect(globalVolumeNode);
    
    source.start(time);
}

function playAmbientWhisper() {
    if (!audioCtx || isMuted || !buffers.demonVoice) return;
    
    const time = audioCtx.currentTime;
    const source = audioCtx.createBufferSource();
    source.buffer = buffers.demonVoice;
    
    const gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(0.0, time);
    gainNode.gain.linearRampToValueAtTime(1.3, time + 2.5); // boosted volume for clear whispering (was 0.35)
    gainNode.gain.setValueAtTime(1.3, time + buffers.demonVoice.duration - 2.5);
    gainNode.gain.linearRampToValueAtTime(0.001, time + buffers.demonVoice.duration); // fade out
    
    // Slow left-to-right panning in the player's head
    let pannerNode;
    if (audioCtx.createStereoPanner) {
        pannerNode = audioCtx.createStereoPanner();
        pannerNode.pan.setValueAtTime(-0.85, time);
        pannerNode.pan.linearRampToValueAtTime(0.85, time + buffers.demonVoice.duration);
    }
    
    if (pannerNode) {
        source.connect(pannerNode);
        pannerNode.connect(gainNode);
    } else {
        source.connect(gainNode);
    }
    gainNode.connect(globalVolumeNode);
    
    source.start(time);
}

let audioCtx = null;
let globalVolumeNode = null;
let isMuted = false;

// Audio Node References
let ambientDroneNode = null;
let ambientOsc = null;
let ambientNoise = null;

let heartbeatTimer = null;
let heartbeatActive = false;
let heartbeatSpeed = 1500; // ms between thumps
let heartbeatVolume = 0.0;

let chaseMusicActive = false;
let chaseMusicTimer = null;
let chaseStep = 0;

function initAudio() {
    if (audioCtx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
    
    globalVolumeNode = audioCtx.createGain();
    globalVolumeNode.gain.setValueAtTime(0.5, audioCtx.currentTime); // default volume 50%
    globalVolumeNode.connect(audioCtx.destination);
    
    startAmbientDrone();
    preloadSounds();
}

function createNoiseBuffer() {
    const bufferSize = audioCtx.sampleRate * 2.0; // 2 seconds of noise
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    return buffer;
}

function startAmbientDrone() {
    if (!audioCtx || ambientDroneNode) return;
    
    const time = audioCtx.currentTime;
    
    // Ambient Drone Gain Node
    ambientDroneNode = audioCtx.createGain();
    ambientDroneNode.gain.setValueAtTime(0.25, time);
    ambientDroneNode.connect(globalVolumeNode);
    
    // Low Frequency Drone (Sub-bass hum)
    ambientOsc = audioCtx.createOscillator();
    ambientOsc.type = 'sawtooth';
    ambientOsc.frequency.setValueAtTime(45, time); // 45Hz sub bass
    
    const oscFilter = audioCtx.createBiquadFilter();
    oscFilter.type = 'lowpass';
    oscFilter.frequency.setValueAtTime(90, time);
    
    const oscGain = audioCtx.createGain();
    oscGain.gain.setValueAtTime(0.4, time);
    
    ambientOsc.connect(oscFilter);
    oscFilter.connect(oscGain);
    oscGain.connect(ambientDroneNode);
    ambientOsc.start(time);
    
    // Wind/Dust static sound (Lowpass white noise)
    ambientNoise = audioCtx.createBufferSource();
    ambientNoise.buffer = createNoiseBuffer();
    ambientNoise.loop = true;
    
    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(180, time);
    
    // Slow wind frequency modulation
    const windLFO = audioCtx.createOscillator();
    windLFO.frequency.setValueAtTime(0.08, time); // very slow 0.08Hz
    const windLFOGain = audioCtx.createGain();
    windLFOGain.gain.setValueAtTime(80, time); // modulate filter by 80Hz
    
    windLFO.connect(windLFOGain);
    windLFOGain.connect(noiseFilter.frequency);
    windLFO.start(time);
    
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.15, time);
    
    ambientNoise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ambientDroneNode);
    ambientNoise.start(time);
}

// Double Heartbeat Thump Scheduler
function playHeartbeatDoubleBeat() {
    if (!audioCtx || isMuted || !heartbeatActive) return;
    if (audioCtx.state === 'suspended') return;
    
    const time = audioCtx.currentTime;
    
    const playThump = (delay, volumeMultiplier, pitch = 55) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const filter = audioCtx.createBiquadFilter();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(pitch, time + delay);
        osc.frequency.exponentialRampToValueAtTime(10, time + delay + 0.15);
        
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(100, time + delay);
        
        gain.gain.setValueAtTime(0.0, time + delay);
        gain.gain.linearRampToValueAtTime(heartbeatVolume * volumeMultiplier * 0.9, time + delay + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, time + delay + 0.22);
        
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(globalVolumeNode);
        
        osc.start(time + delay);
        osc.stop(time + delay + 0.3);
    };
    
    // Thump 1
    playThump(0, 1.0, 58);
    // Thump 2 (slightly quieter, slightly lower pitch, 220ms later)
    playThump(0.22, 0.7, 52);
    
    // Schedule next thump dynamically based on current interval speed
    heartbeatTimer = setTimeout(playHeartbeatDoubleBeat, heartbeatSpeed);
}

// Chase Music Sequencer (Tense Industrial Rhythm)
function playChaseStep() {
    if (!audioCtx || isMuted || !chaseMusicActive) return;
    if (audioCtx.state === 'suspended') return;
    
    const time = audioCtx.currentTime;
    
    // Kick drum beat on steps 0, 1, 2, 3
    const playKick = () => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(110, time);
        osc.frequency.exponentialRampToValueAtTime(30, time + 0.18);
        
        gain.gain.setValueAtTime(0.4, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
        
        osc.connect(gain);
        gain.connect(globalVolumeNode);
        osc.start(time);
        osc.stop(time + 0.22);
    };
    
    // Industrial metallic percussion on specific steps
    const playMetallicHit = (pitch = 180) => {
        const osc = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const filter = audioCtx.createBiquadFilter();
        
        osc.type = 'sawtooth';
        osc.frequency.value = pitch;
        osc2.type = 'sawtooth';
        osc2.frequency.value = pitch * 1.43; // metallic detuning
        
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(800, time);
        filter.frequency.exponentialRampToValueAtTime(200, time + 0.15);
        
        gain.gain.setValueAtTime(0.08, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
        
        osc.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(globalVolumeNode);
        
        osc.start(time);
        osc2.start(time);
        osc.stop(time + 0.15);
        osc2.stop(time + 0.15);
    };
    
    // Tense horror rise/screech pad
    const playTenseRise = () => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180 + Math.sin(time * 5) * 10, time);
        osc.frequency.linearRampToValueAtTime(240, time + 0.3);
        
        gain.gain.setValueAtTime(0.04, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);
        
        osc.connect(gain);
        gain.connect(globalVolumeNode);
        osc.start(time);
        osc.stop(time + 0.4);
    };

    // Sequence loop (140 BPM, step is 300ms)
    playKick();
    if (chaseStep % 2 === 1) {
        playMetallicHit(150 + (chaseStep * 20));
    }
    if (chaseStep === 3) {
        playTenseRise();
    }
    
    chaseStep = (chaseStep + 1) % 4;
    chaseMusicTimer = setTimeout(playChaseStep, 300);
}

// Digital Distortion Shaper for jumpscare screaming
function makeDistortionCurve(amount) {
    const k = typeof amount === 'number' ? amount : 50;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
        const x = (i * 2) / n_samples - 1;
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
}

export const audioSystem = {
    init: () => {
        initAudio();
    },

    playVictory: () => {
        console.log("playVictory tetiklendi! audioCtx:", audioCtx ? "Aktif" : "Yok", "isMuted:", isMuted);
        if (!audioCtx) initAudio();
        if (isMuted) return;
        if (audioCtx.state === 'suspended') {
            console.log("AudioContext askıdaydı, uyandırılıyor...");
            audioCtx.resume();
        }
        
        const time = audioCtx.currentTime;
        if (buffers.victorySound) {
            console.log("Önceden yüklenmiş zafer müziği çalınıyor...");
            const source = audioCtx.createBufferSource();
            source.buffer = buffers.victorySound;
            const gainNode = audioCtx.createGain();
            gainNode.gain.setValueAtTime(1.0, time);
            source.connect(gainNode);
            gainNode.connect(globalVolumeNode);
            source.start(time);
        } else {
            console.log("Zafer müziği henüz yüklenmemişti, dinamik olarak çekiliyor...");
            loadAudioFile(victorySoundUrl).then(buffer => {
                buffers.victorySound = buffer;
                console.log("Zafer müziği dinamik olarak başarıyla yüklendi, çalınıyor...");
                const source = audioCtx.createBufferSource();
                source.buffer = buffer;
                const gainNode = audioCtx.createGain();
                gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
                source.connect(gainNode);
                gainNode.connect(globalVolumeNode);
                source.start(audioCtx.currentTime);
            }).catch(err => {
                console.error("Dinamik yükleme sırasında zafer müziği çalınamadı:", err);
            });
        }
    },

    setMute: (mute) => {
        isMuted = mute;
        if (globalVolumeNode) {
            globalVolumeNode.gain.setValueAtTime(mute ? 0 : 0.5, audioCtx ? audioCtx.currentTime : 0);
        }
    },

    setVolume: (volume) => {
        if (isMuted) return;
        if (globalVolumeNode && audioCtx) {
            globalVolumeNode.gain.setValueAtTime(volume, audioCtx.currentTime);
        }
    },

    playFootstep: (isRunning = false) => {
        if (!audioCtx || isMuted) return;
        if (audioCtx.state === 'suspended') return;

        const time = audioCtx.currentTime;
        const noise = audioCtx.createBufferSource();
        noise.buffer = createNoiseBuffer();

        const filter = audioCtx.createBiquadFilter();
        const gain = audioCtx.createGain();

        // Heavy low footstep sound for walking in concrete maze
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(120, time);
        
        const footVolume = isRunning ? 0.28 : 0.16;
        const speed = isRunning ? 0.08 : 0.12;

        gain.gain.setValueAtTime(footVolume, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + speed);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(globalVolumeNode);

        noise.start(time);
        noise.stop(time + speed + 0.05);
    },

    playMonsterFootstep: (mX, mZ, pX, pZ, pYaw, isDragging = false) => {
        if (!audioCtx || isMuted) return;
        if (audioCtx.state === 'suspended') return;
        
        const dx = mX - pX;
        const dz = mZ - pZ;
        const distance = Math.sqrt(dx * dx + dz * dz);
        if (distance > 420) return; // audible from 10x further away (was 42)
        
        const time = audioCtx.currentTime;
        
        // Volume attenuation
        const volume = 1.35 / (1 + distance * 0.009); // 10x slower attenuation (was 1 + distance * 0.09)
        if (volume < 0.01) return;
        
        // Panning calculation
        const angle = -pYaw;
        const cosAngle = Math.cos(angle);
        const sinAngle = Math.sin(angle);
        const localX = dx * cosAngle - dz * sinAngle;
        const localZ = dx * sinAngle + dz * cosAngle;
        
        // Pan value between -0.95 (left) and 0.95 (right)
        const pan = Math.max(-0.95, Math.min(0.95, localX / (Math.abs(localX) + Math.abs(localZ) + 0.01)));
        
        let pannerNode;
        if (audioCtx.createStereoPanner) {
            pannerNode = audioCtx.createStereoPanner();
            pannerNode.pan.setValueAtTime(pan, time);
        }
        
        // Gain Node
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(volume, time);
        
        if (buffers.footsteps) {
            // Play MP3 Step (Custom real audio!)
            const source = audioCtx.createBufferSource();
            source.buffer = buffers.footsteps;
            
            // Start at a random offset to make it sound varied (since recording has multiple steps)
            const duration = buffers.footsteps.duration;
            const startTime = Math.random() * Math.max(0.1, duration - 1.0);
            
            // Lowpass filter to make it sound heavier and muffled
            const filter = audioCtx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(isDragging ? 260 : 380, time);
            
            const stepGain = audioCtx.createGain();
            const playDuration = isDragging ? 0.7 : 0.45;
            stepGain.gain.setValueAtTime(isDragging ? 0.6 : 0.95, time);
            stepGain.gain.exponentialRampToValueAtTime(0.001, time + playDuration);
            
            source.connect(filter);
            filter.connect(stepGain);
            
            if (pannerNode) {
                stepGain.connect(pannerNode);
                pannerNode.connect(gain);
            } else {
                stepGain.connect(gain);
            }
            gain.connect(globalVolumeNode);
            
            source.start(time, startTime, playDuration);
        } else {
            // FALLBACK: original procedural sound
            // 1. Thump component (deep heavy landing)
            const osc = audioCtx.createOscillator();
            const oscGain = audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(80, time);
            osc.frequency.exponentialRampToValueAtTime(15, time + 0.28);
            oscGain.gain.setValueAtTime(0.4, time);
            oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
            osc.connect(oscGain);
            
            // 2. Scraping/dragging component (dragged leg sound)
            const noise = audioCtx.createBufferSource();
            noise.buffer = createNoiseBuffer();
            const noiseFilter = audioCtx.createBiquadFilter();
            noiseFilter.type = 'lowpass';
            noiseFilter.frequency.setValueAtTime(240, time);
            noiseFilter.frequency.exponentialRampToValueAtTime(50, time + 0.4);
            const noiseGain = audioCtx.createGain();
            
            const duration = isDragging ? 0.45 : 0.3;
            const dragVol = isDragging ? 0.35 : 0.18;
            noiseGain.gain.setValueAtTime(dragVol, time);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, time + duration);
            
            noise.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            
            // Connect nodes
            if (pannerNode) {
                oscGain.connect(pannerNode);
                noiseGain.connect(pannerNode);
                pannerNode.connect(gain);
            } else {
                oscGain.connect(gain);
                noiseGain.connect(gain);
            }
            
            gain.connect(globalVolumeNode);
            
            osc.start(time);
            noise.start(time);
            
            osc.stop(time + 0.35);
            noise.stop(time + duration + 0.05);
        }
    },

    playFlashlightClick: () => {
        if (!audioCtx || isMuted) return;
        const time = audioCtx.currentTime;

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1200, time);
        osc.frequency.setValueAtTime(600, time + 0.02);
        
        gain.gain.setValueAtTime(0.12, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
        
        osc.connect(gain);
        gain.connect(globalVolumeNode);
        osc.start(time);
        osc.stop(time + 0.05);
    },

    playPickup: () => {
        if (!audioCtx || isMuted) return;
        const time = audioCtx.currentTime;
        
        // Eerie bell chime chord (dissonant and high pitched)
        const notes = [659.25, 830.61, 987.77, 1318.51]; // E5, G#5, B5, E6
        
        notes.forEach((freq, idx) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, time + idx * 0.05);
            
            gain.gain.setValueAtTime(0.0, time + idx * 0.05);
            gain.gain.linearRampToValueAtTime(0.08, time + idx * 0.05 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, time + idx * 0.05 + 0.9);
            
            osc.connect(gain);
            gain.connect(globalVolumeNode);
            osc.start(time + idx * 0.05);
            osc.stop(time + idx * 0.05 + 1.0);
        });
    },

    // Dynamically adjust player heartbeat speed and volume based on distance
    updateHeartbeat: (distance) => {
        if (!audioCtx) return;
        
        if (distance > 30) {
            // Stop heartbeat if monster is far away
            if (heartbeatActive) {
                heartbeatActive = false;
                if (heartbeatTimer) clearTimeout(heartbeatTimer);
            }
            return;
        }
        
        // Heartbeat is active
        heartbeatActive = true;
        
        // Interpolate heartbeat volume & speed
        // Under 30m: starts slow, low volume. Under 5m: extremely fast, high volume
        const t = Math.max(0, Math.min(1, (30 - distance) / 25)); // 0 (far) to 1 (close)
        
        heartbeatSpeed = 1600 - (t * 1250); // scales from 1600ms down to 350ms
        heartbeatVolume = 0.15 + (t * 0.70); // volume scales from 15% to 85%
        
        // If timer is not running, start it
        if (!heartbeatTimer) {
            playHeartbeatDoubleBeat();
        }
    },

    setChaseMusicActive: (active) => {
        if (!audioCtx) return;
        
        if (active && !chaseMusicActive) {
            chaseMusicActive = true;
            chaseStep = 0;
            playChaseStep();
        } else if (!active && chaseMusicActive) {
            chaseMusicActive = false;
            if (chaseMusicTimer) clearTimeout(chaseMusicTimer);
        }
    },

    playJumpscare: () => {
        if (!audioCtx) initAudio();
        if (isMuted) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();
        
        const time = audioCtx.currentTime;
        
        // Play MP3 Girl Scream (Custom horror audio!)
        if (buffers.girlScream) {
            const screamSource = audioCtx.createBufferSource();
            screamSource.buffer = buffers.girlScream;
            const screamGain = audioCtx.createGain();
            screamGain.gain.setValueAtTime(2.2, time); // loud, terrifying volume
            screamSource.connect(screamGain);
            screamGain.connect(globalVolumeNode);
            screamSource.start(time);
        }
        
        // Loud distorted FM synthesize digital scream (blended for maximum punch)
        const oscLow = audioCtx.createOscillator();
        const oscHigh = audioCtx.createOscillator();
        const oscScreech = audioCtx.createOscillator();
        const oscScreech2 = audioCtx.createOscillator(); // second screech osc
        
        const noise = audioCtx.createBufferSource();
        noise.buffer = createNoiseBuffer();
        
        const distNode = audioCtx.createWaveShaper();
        distNode.curve = makeDistortionCurve(180); // more distortion (was 100)
        distNode.oversample = '4x';
        
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'peaking';
        filter.Q.value = 10;
        filter.frequency.setValueAtTime(3500, time);
        filter.frequency.exponentialRampToValueAtTime(800, time + 1.8);
        
        const mainGain = audioCtx.createGain();
        mainGain.gain.setValueAtTime(1.8, time); // extremely loud! (was 0.85)
        mainGain.gain.exponentialRampToValueAtTime(0.0001, time + 2.2); // fade out over 2.2 seconds
        
        // Low horror frequency rumble
        oscLow.type = 'sawtooth';
        oscLow.frequency.setValueAtTime(65, time);
        oscLow.frequency.exponentialRampToValueAtTime(25, time + 1.5);
        
        // High screech
        oscHigh.type = 'sawtooth';
        oscHigh.frequency.setValueAtTime(800, time);
        oscHigh.frequency.exponentialRampToValueAtTime(1800, time + 0.8);
        
        // FM Modulated metal screech
        oscScreech.type = 'square';
        oscScreech.frequency.setValueAtTime(1200, time);
        oscScreech.frequency.linearRampToValueAtTime(1500, time + 0.5);
        
        // FM Modulated metal screech 2
        oscScreech2.type = 'sawtooth';
        oscScreech2.frequency.setValueAtTime(2200, time);
        oscScreech2.frequency.exponentialRampToValueAtTime(3200, time + 0.6);

        // Modulate screech pitch rapidly for vibrato-screaming effect
        const vibrato = audioCtx.createOscillator();
        vibrato.frequency.setValueAtTime(45, time); // 45Hz tremor
        const vibGain = audioCtx.createGain();
        vibGain.gain.setValueAtTime(250, time);
        
        vibrato.connect(vibGain);
        vibGain.connect(oscScreech.frequency);
        vibrato.start(time);
        
        // Noise sweeps
        const noiseGain = audioCtx.createGain();
        noiseGain.gain.setValueAtTime(0.4, time);
        
        // Connect all sources to the distortion shaper -> filter -> main gain
        oscLow.connect(distNode);
        oscHigh.connect(distNode);
        oscScreech.connect(distNode);
        oscScreech2.connect(distNode);
        
        noise.connect(distNode);
        
        distNode.connect(filter);
        filter.connect(mainGain);
        mainGain.connect(globalVolumeNode);
        
        // Start playing
        oscLow.start(time);
        oscHigh.start(time);
        oscScreech.start(time);
        oscScreech2.start(time);
        noise.start(time);
        
        // Stop playing
        oscLow.stop(time + 2.1);
        oscHigh.stop(time + 2.1);
        oscScreech.stop(time + 2.1);
        oscScreech2.stop(time + 2.1);
        vibrato.stop(time + 2.1);
        noise.stop(time + 2.1);
    },

    updateAmbientScares: (deltaTime, mPos, pPos, pYaw) => {
        if (!audioCtx || isMuted) return;
        if (audioCtx.state === 'suspended') return;
        
        // Random growls/moans from monster's coordinates
        moanCooldown -= deltaTime;
        if (moanCooldown <= 0) {
            playMonsterMoan(mPos.x, mPos.z, pPos.x, pPos.z, pYaw);
            moanCooldown = 15.0 + Math.random() * 15.0; // every 15-30s
        }
        
        // Random eerie whispers inside the player's head
        whisperCooldown -= deltaTime;
        if (whisperCooldown <= 0) {
            playAmbientWhisper();
            whisperCooldown = 30.0 + Math.random() * 20.0; // every 30-50s
        }
    },

    stopAllLoops: () => {
        if (heartbeatTimer) clearTimeout(heartbeatTimer);
        if (chaseMusicTimer) clearTimeout(chaseMusicTimer);
        heartbeatActive = false;
        chaseMusicActive = false;
    }
};
