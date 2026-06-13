// Creepy Monster AI and 3D Model with Asymmetric Dragging/Wobbling Animations
import monsterFaceUrl from './assets/monster_face.png';

export class Monster {
    constructor(scene, THREE, maze) {
        this.scene = scene;
        this.THREE = THREE;
        this.maze = maze;
        
        // AI State Variables
        this.position = new this.THREE.Vector3(
            (maze.width - 1.5) * maze.cellSize, // Start near the opposite corner of player (who starts at 1.5, 1.5)
            0,
            (maze.height - 1.5) * maze.cellSize
        );
        this.velocity = new this.THREE.Vector3(0, 0, 0);
        this.speed = 1.0; // Patrol speed (was 1.4)
        this.chaseSpeed = 2.2; // Chase speed (was 2.7)
        this.rotationY = 0;
        
        // States: 'patrol', 'chase', 'search'
        this.state = 'patrol';
        this.targetPoint = null;
        this.chaseTarget = null; // Reference to player physics/position
        this.searchTimer = 0;
        
        // Detection radiuses
        this.sightDistance = 14.0;
        this.hearDistance = 6.5; // can hear player behind walls if player is sprinting
        this.isChasing = false;

        // Footstep tracking
        this.footstepCounter = 0;
        this.isRightStep = false;

        // Slam/Dash mechanic states: 'normal', 'charging', 'dashing'
        this.isDashingState = 'normal';
        this.dashCooldownTimer = 5.0; // trigger dash every 5s during chase
        this.dashChargeTimer = 0.0;
        this.dashActiveTimer = 0.0;
        this.dashDirection = new this.THREE.Vector3();
        this.stunTimer = 0.0;
        
        // Build 3D mesh structure
        this.meshGroup = new this.THREE.Group();
        this.buildMonsterModel();
        this.meshGroup.position.copy(this.position);
        this.scene.add(this.meshGroup);
        
        // Set first patrol target
        this.selectNewPatrolTarget();
    }
    
    buildMonsterModel() {
        const THREE = this.THREE;
        
        // Materials
        const darkSkinMat = new THREE.MeshStandardMaterial({
            color: 0x0a0a0d,
            roughness: 0.9,
            metalness: 0.1
        });
        
        // Head with the generated scary monster face on the front
        const textureLoader = new THREE.TextureLoader();
        const faceTex = textureLoader.load(monsterFaceUrl);
        faceTex.minFilter = THREE.LinearFilter;
        
        const faceMat = new THREE.MeshStandardMaterial({
            map: faceTex,
            roughness: 0.6,
            metalness: 0.1
        });
        
        // Material order in Three.js Box: Right, Left, Top, Bottom, Front, Back
        const headMaterials = [
            darkSkinMat, // Right
            darkSkinMat, // Left
            darkSkinMat, // Top
            darkSkinMat, // Bottom
            faceMat,     // Front (facing forward / negative Z in local space)
            darkSkinMat  // Back
        ];
        
        // Torso / Spine (Creepy, extremely wide, fat/chubby cylinder, Y=2.0, height=1.4)
        const spineGeo = new THREE.CylinderGeometry(0.85, 1.05, 1.4, 8);
        this.torso = new THREE.Mesh(spineGeo, darkSkinMat);
        this.torso.position.y = 2.0;
        this.torso.rotation.x = 0.75; // Leaned forward heavily (hunched over)
        this.torso.castShadow = true;
        this.meshGroup.add(this.torso);
        
        // Head Mesh (huge 1.2m x 1.0m x 1.2m box parented to Torso so it hunches naturally)
        const headGeo = new THREE.BoxGeometry(1.2, 1.0, 1.2);
        this.head = new THREE.Mesh(headGeo, headMaterials);
        this.head.position.set(0, 0.85, -0.3); // local position at top-front of hunched torso
        this.head.rotation.x = -0.3; // tilt face downwards
        this.head.castShadow = true;
        this.torso.add(this.head); // parented to torso!
        
        // Spindly Creepy Limbs (Legs spaced wider, made longer for 2x height)
        // Left Leg
        const legGeo = new THREE.CylinderGeometry(0.16, 0.12, 1.4, 6);
        this.leftLeg = new THREE.Mesh(legGeo, darkSkinMat);
        this.leftLeg.castShadow = true;
        this.leftLeg.geometry.translate(0, -0.7, 0); // pivot at top joint
        this.leftLeg.position.set(-0.55, 1.4, 0);
        this.meshGroup.add(this.leftLeg);
        
        // Right Leg (The broken dragging leg, spaced wider)
        this.rightLeg = new THREE.Mesh(legGeo, darkSkinMat);
        this.rightLeg.castShadow = true;
        this.rightLeg.geometry.translate(0, -0.7, 0); // pivot at top
        this.rightLeg.position.set(0.55, 1.4, 0);
        this.meshGroup.add(this.rightLeg);
        
        // Left Arm (Long and wobbly, parented to hunched torso)
        const armGeo = new THREE.CylinderGeometry(0.12, 0.08, 1.2, 6);
        this.leftArm = new THREE.Mesh(armGeo, darkSkinMat);
        this.leftArm.castShadow = true;
        this.leftArm.geometry.translate(0, -0.6, 0); // pivot at shoulder
        this.leftArm.position.set(-0.95, 0.5, 0);
        this.torso.add(this.leftArm); // parented to torso!
        
        // Right Arm (Broken, hanging lower, parented to hunched torso)
        const longArmGeo = new THREE.CylinderGeometry(0.12, 0.075, 1.3, 6);
        this.rightArm = new THREE.Mesh(longArmGeo, darkSkinMat);
        this.rightArm.castShadow = true;
        this.rightArm.geometry.translate(0, -0.65, 0); // pivot at shoulder
        this.rightArm.position.set(0.95, 0.45, 0);
        this.torso.add(this.rightArm); // parented to torso!
        
        // Bloody Knife attached to Right Arm (made even larger!)
        const knifeGroup = new THREE.Group();
        
        // Hilt
        const hiltGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.35, 6);
        const hiltMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
        const hilt = new THREE.Mesh(hiltGeo, hiltMat);
        hilt.rotation.x = Math.PI / 2;
        knifeGroup.add(hilt);
        
        // Blade (Larger blade)
        const bladeGeo = new THREE.BoxGeometry(0.03, 0.9, 0.12);
        
        // Procedural Blood-splattered Metal texture
        const bCanvas = document.createElement('canvas');
        bCanvas.width = 64; bCanvas.height = 128;
        const bCtx = bCanvas.getContext('2d');
        bCtx.fillStyle = '#909090'; // Silver metal
        bCtx.fillRect(0, 0, 64, 128);
        bCtx.fillStyle = '#800000'; // Coagulated dark blood
        bCtx.fillRect(0, 0, 64, 65); // top half completely covered in blood
        bCtx.fillStyle = '#b30000'; // Fresh red blood splats and drips
        bCtx.fillRect(15, 65, 12, 40); 
        bCtx.fillRect(35, 65, 8, 25);
        bCtx.fillRect(50, 65, 10, 50);
        bCtx.beginPath();
        bCtx.arc(20, 100, 8, 0, Math.PI * 2);
        bCtx.arc(45, 90, 6, 0, Math.PI * 2);
        bCtx.fill();
        const bladeTex = new THREE.CanvasTexture(bCanvas);
        
        const bladeMat = new THREE.MeshStandardMaterial({
            map: bladeTex,
            metalness: 0.9,
            roughness: 0.2
        });
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        blade.position.y = -0.55; // extends outwards from hilt
        knifeGroup.add(blade);
        
        // Position knife group at hand tip of right arm
        knifeGroup.position.set(0, -1.3, 0);
        knifeGroup.rotation.x = -Math.PI / 2.3; // point knife forward-downwards
        this.rightArm.add(knifeGroup);
        
        // Red glowing eyes (Parented directly to the larger head)
        const eyeGeo = new THREE.SphereGeometry(0.05, 4, 4);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.25, 0.1, 0.61); // place slightly in front of face
        
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.25, 0.1, 0.61);
        
        this.head.add(leftEye);
        this.head.add(rightEye);
        
        // Ambient monster breathing light (Parented to the head)
        this.glowLight = new THREE.PointLight(0xff0000, 0.35, 4.5);
        this.glowLight.position.set(0, 0.1, 0.45);
        this.head.add(this.glowLight);
    }
    
    findPathBFS(startGx, startGy, targetGx, targetGy) {
        const grid = this.maze.grid;
        const width = this.maze.width;
        const height = this.maze.height;
        
        if (startGx === targetGx && startGy === targetGy) return [];
        if (startGx < 0 || startGx >= width || startGy < 0 || startGy >= height ||
            targetGx < 0 || targetGx >= width || targetGy < 0 || targetGy >= height) {
            return [];
        }
        
        const queue = [[startGx, startGy]];
        const visited = Array(height).fill(null).map(() => Array(width).fill(false));
        visited[startGy][startGx] = true;
        
        const parent = Array(height).fill(null).map(() => Array(width).fill(null));
        let found = false;
        
        const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        
        while (queue.length > 0) {
            const [cx, cy] = queue.shift();
            if (cx === targetGx && cy === targetGy) {
                found = true;
                break;
            }
            
            for (const [dx, dy] of dirs) {
                const nx = cx + dx;
                const ny = cy + dy;
                
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    if (grid[ny][nx] === 1 && !visited[ny][nx]) {
                        visited[ny][nx] = true;
                        parent[ny][nx] = [cx, cy];
                        queue.push([nx, ny]);
                    }
                }
            }
        }
        
        if (!found) return [];
        
        const path = [];
        let curr = [targetGx, targetGy];
        while (curr !== null) {
            path.push(curr);
            const [cx, cy] = curr;
            curr = parent[cy][cx];
        }
        path.reverse();
        return path;
    }

    selectNewPatrolTarget() {
        // Find a random path cell in the maze
        let targetX, targetY;
        let attempts = 0;
        
        do {
            targetX = Math.floor(Math.random() * (this.maze.width - 2)) + 1;
            targetY = Math.floor(Math.random() * (this.maze.height - 2)) + 1;
            attempts++;
        } while (this.maze.grid[targetY][targetX] !== 1 && attempts < 100);
        
        this.targetPoint = new this.THREE.Vector3(
            (targetX + 0.5) * this.maze.cellSize,
            0,
            (targetY + 0.5) * this.maze.cellSize
        );
    }
    
    update(deltaTime, time, playerPos, playerIsSprinting, audioSystem, playerYaw) {
        this.chaseTarget = playerPos;
        
        const distToPlayer = this.position.distanceTo(playerPos);
        
        // Feed distance to audio system to modulate heartbeat frequency and volume
        audioSystem.updateHeartbeat(distToPlayer);
        
        if (this.stunTimer > 0) {
            this.stunTimer -= deltaTime;
            this.velocity.set(0, 0, 0);
            this.speed = 0;
            
            // Stun animation (twitching, idle breathing, dim eyes)
            const breathe = Math.sin(time * 4.0) * 0.02;
            this.leftArm.rotation.set(breathe, 0, -0.05);
            this.rightArm.rotation.set(-breathe, 0, 0.15);
            this.leftLeg.rotation.set(0, 0, 0);
            this.rightLeg.rotation.set(0, 0, 0);
            
            this.torso.position.y = 2.0 + breathe * 0.1;
            this.head.position.y = 0.85 + breathe * 0.15;
            this.head.rotation.set(-0.3 + (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.05, 0);
            
            this.glowLight.intensity = Math.random() > 0.75 ? 0.05 : 0.0;
            this.meshGroup.position.copy(this.position);
            return;
        }
        
        // --- AI STATE MACHINE ---
        switch (this.state) {
            case 'patrol':
                this.speed = 1.4;
                this.isChasing = false;
                audioSystem.setChaseMusicActive(false);
                this.isDashingState = 'normal';
                this.dashCooldownTimer = 5.0;
                
                // Check if target reached
                if (this.position.distanceTo(this.targetPoint) < 1.0) {
                    this.selectNewPatrolTarget();
                }
                
                // Sense player
                if (this.canDetectPlayer(distToPlayer, playerIsSprinting)) {
                    this.state = 'chase';
                }
                break;
                
            case 'chase':
                if (!this.isChasing) {
                    this.isChasing = true;
                    audioSystem.setChaseMusicActive(true);
                }
                
                // Slam/Dash mechanic state machine
                if (this.isDashingState === 'normal') {
                    this.speed = this.chaseSpeed;
                    this.targetPoint = this.chaseTarget;
                    this.dashCooldownTimer -= deltaTime;
                    
                    // Sadece oyuncu 6.5 metre veya daha yakınsa atılmayı başlat
                    if (this.dashCooldownTimer <= 0 && distToPlayer <= 6.5) {
                        this.isDashingState = 'charging';
                        this.dashChargeTimer = 0.50; // freeze and charge for 0.5s
                    }
                } else if (this.isDashingState === 'charging') {
                    this.speed = 0; // stop moving
                    this.velocity.set(0, 0, 0);
                    this.dashChargeTimer -= deltaTime;
                    
                    if (this.dashChargeTimer <= 0) {
                        this.isDashingState = 'dashing';
                        this.dashActiveTimer = 0.45; // lunge for 0.45s
                        // Dash straight at the player's position at this exact instant
                        this.dashDirection.subVectors(playerPos, this.position).normalize();
                    }
                } else if (this.isDashingState === 'dashing') {
                    this.speed = 8.2; // very fast charge!
                    this.dashActiveTimer -= deltaTime;
                    
                    if (this.dashActiveTimer <= 0) {
                        this.isDashingState = 'normal';
                        this.dashCooldownTimer = 5.0; // reset cooldown to 5 seconds
                        this.speed = this.chaseSpeed;
                    }
                }
                
                // Lose player if they get too far away (e.g. 18 meters)
                if (distToPlayer > 18.0) {
                    this.state = 'search';
                    this.searchTimer = 4.0; // search area for 4 seconds
                    this.targetPoint = playerPos.clone(); // head to last known position
                    this.isDashingState = 'normal';
                    this.dashCooldownTimer = 5.0;
                }
                break;
                
            case 'search':
                this.speed = 1.6;
                this.isChasing = false;
                audioSystem.setChaseMusicActive(false);
                this.isDashingState = 'normal';
                this.dashCooldownTimer = 5.0;
                
                this.searchTimer -= deltaTime;
                if (this.searchTimer <= 0) {
                    this.state = 'patrol';
                    this.selectNewPatrolTarget();
                }
                
                // Sense player again
                if (this.canDetectPlayer(distToPlayer, playerIsSprinting)) {
                    this.state = 'chase';
                }
                break;
        }
        
        // --- MOVEMENT & PATHFINDING (STEERING & SLIDING ALONG WALLS) ---
        if (this.targetPoint || this.isDashingState === 'dashing') {
            let nextX, nextZ;
            
            if (this.isDashingState === 'dashing') {
                // Dash straight forward ignoring steering calculations
                this.velocity.copy(this.dashDirection).multiplyScalar(this.speed);
                nextX = this.position.x + this.velocity.x * deltaTime;
                nextZ = this.position.z + this.velocity.z * deltaTime;
            } else if (this.isDashingState === 'charging') {
                this.velocity.set(0, 0, 0);
                nextX = this.position.x;
                nextZ = this.position.z;
            } else {
                // Smart BFS corridor pathfinding
                const mGx = Math.floor(this.position.x / this.maze.cellSize);
                const mGy = Math.floor(this.position.z / this.maze.cellSize);
                const tGx = Math.floor(this.targetPoint.x / this.maze.cellSize);
                const tGy = Math.floor(this.targetPoint.z / this.maze.cellSize);
                
                const path = this.findPathBFS(mGx, mGy, tGx, tGy);
                
                let steerTarget = this.targetPoint;
                if (path && path.length > 1) {
                    const nextCell = path[1];
                    steerTarget = new this.THREE.Vector3(
                        (nextCell[0] + 0.5) * this.maze.cellSize,
                        this.position.y,
                        (nextCell[1] + 0.5) * this.maze.cellSize
                    );
                }
                
                const dir = new this.THREE.Vector3().subVectors(steerTarget, this.position);
                dir.y = 0;
                
                if (dir.lengthSq() > 0.01) {
                    dir.normalize();
                    const desiredVel = dir.multiplyScalar(this.speed);
                    this.velocity.lerp(desiredVel, deltaTime * 5.0);
                } else {
                    this.velocity.set(0, 0, 0);
                }
                nextX = this.position.x + this.velocity.x * deltaTime;
                nextZ = this.position.z + this.velocity.z * deltaTime;
            }
            
            // Wall collisions with sliding effect
            const isCharging = this.isDashingState === 'charging';
            if (!isCharging && this.velocity.lengthSq() > 0.001) {
                const collide = this.maze.checkCollision(nextX, nextZ, 0.45);
                
                if (!collide) {
                    this.position.x = nextX;
                    this.position.z = nextZ;
                } else {
                    // Try sliding
                    const slideXCollide = this.maze.checkCollision(nextX, this.position.z, 0.45);
                    if (!slideXCollide) {
                        this.position.x = nextX;
                    } else {
                        const slideZCollide = this.maze.checkCollision(this.position.x, nextZ, 0.45);
                        if (!slideZCollide) {
                            this.position.z = nextZ;
                        } else {
                            this.velocity.set(0, 0, 0);
                            if (this.state === 'patrol') {
                                this.selectNewPatrolTarget();
                            }
                        }
                    }
                }
            }
            
            // Visual position update (Add shiver shake during charging)
            if (this.isDashingState === 'charging') {
                const shiverX = (Math.random() - 0.5) * 0.09;
                const shiverZ = (Math.random() - 0.5) * 0.09;
                this.meshGroup.position.set(
                    this.position.x + shiverX,
                    this.position.y,
                    this.position.z + shiverZ
                );
            } else {
                this.meshGroup.position.copy(this.position);
            }
            
            // Rotate mesh towards velocity vector (smooth interpolation)
            if (this.velocity.lengthSq() > 0.01 && this.isDashingState !== 'charging') {
                const targetRotation = Math.atan2(this.velocity.x, this.velocity.z);
                let diff = targetRotation - this.rotationY;
                while (diff < -Math.PI) diff += Math.PI * 2;
                while (diff > Math.PI) diff -= Math.PI * 2;
                this.rotationY += diff * deltaTime * 8.0;
                this.meshGroup.rotation.y = this.rotationY;
            }
        }
        
        // --- 3D SPATIAL FOOTSTEPS SOUND GENERATOR ---
        const actualMovement = this.velocity.length() * deltaTime;
        if (this.isDashingState !== 'charging' && actualMovement > 0.005) {
            this.footstepCounter += actualMovement;
            
            // Footsteps play more frequently when running (dashing)
            const stepInterval = this.isDashingState === 'dashing' ? 1.2 : 3.0; // slower, heavier footsteps (was 1.0 / 2.5)
            
            if (this.footstepCounter >= stepInterval) {
                this.isRightStep = !this.isRightStep;
                audioSystem.playMonsterFootstep(
                    this.position.x, 
                    this.position.z, 
                    playerPos.x, 
                    playerPos.z, 
                    playerYaw, 
                    this.isRightStep // if right leg, plays drag scrape sound!
                );
                this.footstepCounter = 0;
            }
        }
        
        // --- ASYMMETRICAL MOVEMENT ANIMATION ---
        const speedFactor = this.velocity.length();
        const isMoving = speedFactor > 0.2;
        
        if (isMoving) {
            // Slower limb swings to feel heavy and lumbering (was 7.0 / 2.5)
            const cycleSpeed = this.state === 'chase' ? 4.5 : 1.8; 
            const t = time * cycleSpeed;
            
            // Left Leg: Walks with a normal swinging motion
            this.leftLeg.rotation.x = Math.sin(t) * 0.45;
            this.leftLeg.rotation.z = 0;
            
            // Right Leg: The broken/stiff leg, dragged behind at a weird angle, with a slight limp wobble
            this.rightLeg.rotation.x = -0.55 + Math.sin(t * 0.5) * 0.12; // tilted back and dragging
            this.rightLeg.rotation.z = 0.22; // splayed out to the side
            
            if (this.state === 'chase') {
                // Raise arms straight in the air holding the bloody knife! (creepy, threatening waves)
                this.leftArm.rotation.x = 2.9 + Math.sin(t) * 0.2;
                this.leftArm.rotation.z = -0.4 + Math.cos(t) * 0.1;
                
                this.rightArm.rotation.x = 2.9 + Math.cos(t) * 0.2;
                this.rightArm.rotation.z = 0.4 + Math.sin(t) * 0.1;
            } else {
                // Left Arm: Flails and reaches forward aggressively
                this.leftArm.rotation.x = 0.6 + Math.sin(t) * 0.6;
                this.leftArm.rotation.z = -0.15 + Math.sin(t * 1.3) * 0.2;
                
                // Right Arm: Completely broken and limp, swings side-to-side as it drags on the floor
                this.rightArm.rotation.x = -0.2 + Math.cos(t) * 0.15;
                this.rightArm.rotation.z = 0.35 + Math.sin(t * 0.8) * 0.15; // swings outward
            }
            
            // Creepy torso bobbing (2.0 baseline)
            this.torso.position.y = 2.0 + Math.sin(t * 2) * 0.05;
            this.head.position.y = 0.85 + Math.sin(t * 2) * 0.02;
            
            // Head twitching slightly (maintaining -0.3 forward hunched tilt)
            this.head.rotation.x = -0.3;
            this.head.rotation.z = Math.sin(t * 0.3) * 0.08;
            this.head.rotation.y = Math.cos(t * 0.5) * 0.1;
        } else {
            // Idle breathing
            const breathe = Math.sin(time * 2.0) * 0.04;
            this.leftArm.rotation.x = breathe;
            this.rightArm.rotation.x = -breathe;
            this.leftArm.rotation.z = -0.05;
            this.rightArm.rotation.z = 0.15;
            this.leftLeg.rotation.x = 0;
            this.rightLeg.rotation.x = 0;
            this.rightLeg.rotation.z = 0.1;
            
            this.torso.position.y = 2.0 + breathe * 0.1;
            this.head.position.y = 0.85 + breathe * 0.15;
            
            this.head.rotation.set(-0.3, 0, 0);
        }
        
        // Pulse the red glowing eyes
        this.glowLight.intensity = 0.2 + Math.sin(time * 8.0) * 0.15;
    }
    
    canDetectPlayer(distance, playerIsSprinting) {
        // 1. Direct proximity detection (Too close, hear breathing/footsteps)
        if (distance < this.hearDistance) {
            return true;
        }
        
        // 2. Sprinting sound detection (Heard from further away, even through walls)
        if (playerIsSprinting && distance < this.sightDistance) {
            return true;
        }
        
        // 3. Sight check (Simple line-of-sight in maze corridors)
        // If distance is within sightDistance and there is a direct corridor alignment
        if (distance < this.sightDistance) {
            // Check if player is in the same cell column or row and walls do not block
            const pGx = Math.floor(this.chaseTarget.x / this.maze.cellSize);
            const pGy = Math.floor(this.chaseTarget.z / this.maze.cellSize);
            const mGx = Math.floor(this.position.x / this.maze.cellSize);
            const mGy = Math.floor(this.position.z / this.maze.cellSize);
            
            if (pGx === mGx) {
                // Check if walls block between mGy and pGy
                const start = Math.min(mGy, pGy);
                const end = Math.max(mGy, pGy);
                let blocked = false;
                for (let y = start + 1; y < end; y++) {
                    if (this.maze.grid[y][pGx] === 0) {
                        blocked = true;
                        break;
                    }
                }
                if (!blocked) return true;
            }
            
            if (pGy === mGy) {
                // Check if walls block between mGx and pGx
                const start = Math.min(mGx, pGx);
                const end = Math.max(mGx, pGx);
                let blocked = false;
                for (let x = start + 1; x < end; x++) {
                    if (this.maze.grid[pGy][x] === 0) {
                        blocked = true;
                        break;
                    }
                }
                if (!blocked) return true;
            }
        }
        
        return false;
    }
    
    reset(maze) {
        this.maze = maze;
        this.position.set(
            (maze.width - 1.5) * maze.cellSize,
            0,
            (maze.height - 1.5) * maze.cellSize
        );
        this.meshGroup.position.copy(this.position);
        this.state = 'patrol';
        this.isChasing = false;
        this.velocity.set(0, 0, 0);
        this.selectNewPatrolTarget();
    }
    
    destroy() {
        this.scene.remove(this.meshGroup);
        // Traverse and dispose geometries and materials
        this.meshGroup.traverse(child => {
            if (child.isMesh) {
                child.geometry.dispose();
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => mat.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    }
}
