// Procedural Labyrinth Generator for 3D Horror Game
// Generates a creepy maze, places walls, ceiling, floor, lights, collectibles, and batteries.

export class Maze {
    constructor(scene, THREE, presetData = null) {
        this.scene = scene;
        this.THREE = THREE;
        this.width = 19;  // Grid dimensions (must be odd)
        this.height = 19;
        this.cellSize = 4; // Each cell is 4x4 units in 3D
        this.wallHeight = 5.0;
        
        this.grid = [];
        this.wallMeshes = [];
        this.items = [];
        this.allItems = []; // Keeps track of all spawned crystals for cleanup
        this.batteries = [];
        this.allBatteries = []; // Keeps track of all spawned batteries for cleanup
        this.flickeringLights = [];
        
        // Procedural Textures
        this.wallTexture = this.createWallTexture();
        this.floorTexture = this.createFloorTexture();
        this.ceilingTexture = this.createCeilingTexture();
        
        if (presetData) {
            this.grid = presetData.mazeGrid;
            this.buildMaze3D();
            this.spawnPresetCollectibles(presetData.items, presetData.batteries);
        } else {
            // Generate grid array
            this.generateGrid();
            this.buildMaze3D();
            this.spawnCollectiblesAndBatteries();
        }
    }
    
    generateGrid() {
        // Initialize grid with 0 (Walls)
        this.grid = Array(this.height).fill(0).map(() => Array(this.width).fill(0));
        
        const stack = [];
        const startX = 1;
        const startY = 1;
        this.grid[startY][startX] = 1; // 1 = Path
        stack.push([startX, startY]);
        
        while (stack.length > 0) {
            const [cx, cy] = stack[stack.length - 1];
            const neighbors = [];
            
            const dirs = [
                [0, -2], // North
                [2, 0],  // East
                [0, 2],  // South
                [-2, 0]  // West
            ];
            
            for (const [dx, dy] of dirs) {
                const nx = cx + dx;
                const ny = cy + dy;
                if (nx > 0 && nx < this.width - 1 && ny > 0 && ny < this.height - 1) {
                    if (this.grid[ny][nx] === 0) {
                        neighbors.push([nx, ny, dx, dy]);
                    }
                }
            }
            
            if (neighbors.length > 0) {
                const [nx, ny, dx, dy] = neighbors[Math.floor(Math.random() * neighbors.length)];
                // Carve path
                this.grid[cy + dy/2][cx + dx/2] = 1;
                this.grid[ny][nx] = 1;
                stack.push([nx, ny]);
            } else {
                stack.pop();
            }
        }
        
        // Open up some random walls to create loops (so it's not a perfect single-solution maze, better for gameplay)
        for (let y = 2; y < this.height - 2; y += 2) {
            for (let x = 2; x < this.width - 2; x += 2) {
                if (this.grid[y][x] === 0 && Math.random() < 0.2) {
                    this.grid[y][x] = 1;
                }
            }
        }
        
        this.eliminateDeadEnds();
    }
    
    eliminateDeadEnds() {
        let deadEndsFound = true;
        let passes = 0;
        
        while (deadEndsFound && passes < 3) {
            deadEndsFound = false;
            passes++;
            
            for (let y = 1; y < this.height - 1; y++) {
                for (let x = 1; x < this.width - 1; x++) {
                    if (this.grid[y][x] === 1) {
                        const neighbors = [
                            { x: x, y: y - 1 }, // North
                            { x: x + 1, y: y }, // East
                            { x: x, y: y + 1 }, // South
                            { x: x - 1, y: y }  // West
                        ];
                        
                        const walls = neighbors.filter(n => this.grid[n.y][n.x] === 0);
                        
                        if (walls.length === 3) {
                            let opened = false;
                            const shuffledWalls = walls.sort(() => Math.random() - 0.5);
                            
                            for (const wall of shuffledWalls) {
                                const dx = wall.x - x;
                                const dy = wall.y - y;
                                const bx = wall.x + dx;
                                const by = wall.y + dy;
                                
                                if (bx > 0 && bx < this.width - 1 && by > 0 && by < this.height - 1) {
                                    if (this.grid[by][bx] === 1) {
                                        this.grid[wall.y][wall.x] = 1;
                                        opened = true;
                                        deadEndsFound = true;
                                        break;
                                    }
                                }
                            }
                            
                            if (!opened && shuffledWalls.length > 0) {
                                for (const wall of shuffledWalls) {
                                    if (wall.x > 0 && wall.x < this.width - 1 && wall.y > 0 && wall.y < this.height - 1) {
                                        this.grid[wall.y][wall.x] = 1;
                                        deadEndsFound = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Check collision against walls
    checkCollision(x, z, radius = 0.5) {
        // Convert world coordinates to grid coordinates
        const cellX = (x / this.cellSize);
        const cellZ = (z / this.cellSize);
        
        const checkPoints = [
            { x: x - radius, z: z - radius },
            { x: x + radius, z: z - radius },
            { x: x - radius, z: z + radius },
            { x: x + radius, z: z + radius }
        ];
        
        for (const pt of checkPoints) {
            const gx = Math.floor(pt.x / this.cellSize);
            const gz = Math.floor(pt.z / this.cellSize);
            
            if (gx < 0 || gx >= this.width || gz < 0 || gz >= this.height) {
                return true; // Out of bounds is treated as wall
            }
            
            if (this.grid[gz][gx] === 0) {
                return true; // Wall collision
            }
        }
        return false;
    }
    
    buildMaze3D() {
        const THREE = this.THREE;
        
        // 1. Materials
        const wallMat = new THREE.MeshStandardMaterial({
            map: this.wallTexture,
            roughness: 0.8,
            metalness: 0.2,
            bumpMap: this.wallTexture,
            bumpScale: 0.05
        });
        
        const floorMat = new THREE.MeshStandardMaterial({
            map: this.floorTexture,
            roughness: 0.6,
            metalness: 0.1
        });
        
        const ceilingMat = new THREE.MeshStandardMaterial({
            map: this.ceilingTexture,
            roughness: 0.9,
            metalness: 0.6
        });
        
        // Box geometry for wall segment
        const wallGeom = new THREE.BoxGeometry(this.cellSize, this.wallHeight, this.cellSize);
        
        // Build Walls
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.grid[y][x] === 0) {
                    const wallMesh = new THREE.Mesh(wallGeom, wallMat);
                    // Position at center of the grid cell
                    wallMesh.position.set(
                        (x + 0.5) * this.cellSize,
                        this.wallHeight / 2,
                        (y + 0.5) * this.cellSize
                    );
                    wallMesh.castShadow = true;
                    wallMesh.receiveShadow = true;
                    this.scene.add(wallMesh);
                    this.wallMeshes.push(wallMesh);
                }
            }
        }
        
        // 2. Floor Plane
        const floorGeom = new THREE.PlaneGeometry(this.width * this.cellSize, this.height * this.cellSize);
        const floorMesh = new THREE.Mesh(floorGeom, floorMat);
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.position.set((this.width * this.cellSize) / 2, 0, (this.height * this.cellSize) / 2);
        floorMesh.receiveShadow = true;
        this.scene.add(floorMesh);
        
        // 3. Ceiling Plane (facing down)
        const ceilingGeom = new THREE.PlaneGeometry(this.width * this.cellSize, this.height * this.cellSize);
        const ceilingMesh = new THREE.Mesh(ceilingGeom, ceilingMat);
        ceilingMesh.rotation.x = Math.PI / 2;
        ceilingMesh.position.set((this.width * this.cellSize) / 2, this.wallHeight, (this.height * this.cellSize) / 2);
        ceilingMesh.receiveShadow = true;
        this.scene.add(ceilingMesh);
        
        // 4. Place some dim, flickering ceiling lights
        this.placeCeilingLights();
    }
    
    placeCeilingLights() {
        const THREE = this.THREE;
        
        // Place a light every 4-5 cells along paths
        for (let y = 1; y < this.height - 1; y += 3) {
            for (let x = 1; x < this.width - 1; x += 3) {
                if (this.grid[y][x] === 1 && Math.random() > 0.4) {
                    const lx = (x + 0.5) * this.cellSize;
                    const lz = (y + 0.5) * this.cellSize;
                    const ly = this.wallHeight - 0.2;
                    
                    // Light bulb model
                    const bulbGeom = new THREE.CylinderGeometry(0.1, 0.15, 0.3, 8);
                    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });
                    const bulb = new THREE.Mesh(bulbGeom, bulbMat);
                    bulb.position.set(lx, ly, lz);
                    this.scene.add(bulb);
                    
                    // PointLight
                    const light = new THREE.PointLight(0xffddaa, 0.8, 10.0, 1.5);
                    light.position.set(lx, ly - 0.2, lz);
                    light.castShadow = false; // Disable shadows for minor lights to prevent GPU stalls and stuttering
                    this.scene.add(light);
                    
                    // Track for flicker animation
                    this.flickeringLights.push({
                        light: light,
                        bulb: bulb,
                        baseIntensity: 0.8,
                        flickerTimer: 0,
                        nextFlicker: Math.random() * 3 + 1
                    });
                }
            }
        }
    }
    
    spawnCollectiblesAndBatteries() {
        const THREE = this.THREE;
        
        // Find all path positions
        const pathCells = [];
        for (let y = 1; y < this.height - 1; y++) {
            for (let x = 1; x < this.width - 1; x++) {
                if (this.grid[y][x] === 1 && !(x === 1 && y === 1)) { // Ignore player start
                    pathCells.push({ x, y });
                }
            }
        }
        
        // Shuffle path cells
        for (let i = pathCells.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pathCells[i], pathCells[j]] = [pathCells[j], pathCells[i]];
        }
        
        // 1. Spawn 8 Red Glowing Crystals (Items to collect)
        const crystalCount = Math.min(8, pathCells.length);
        const crystalGeom = new THREE.OctahedronGeometry(0.4, 0);
        const crystalMat = new THREE.MeshStandardMaterial({
            color: 0xff0033,
            emissive: 0xaa0011,
            roughness: 0.1,
            metalness: 0.9
        });
        
        for (let i = 0; i < crystalCount; i++) {
            const cell = pathCells.pop();
            const cx = (cell.x + 0.5) * this.cellSize;
            const cz = (cell.y + 0.5) * this.cellSize;
            const cy = 1.0;
            
            const crystalMesh = new THREE.Mesh(crystalGeom, crystalMat);
            crystalMesh.position.set(cx, cy, cz);
            this.scene.add(crystalMesh);
            
            // Add a small red pulsing light to guide player
            const cLight = new THREE.PointLight(0xff0033, 0.6, 3.5);
            cLight.position.set(cx, cy + 0.5, cz);
            this.scene.add(cLight);
            
            const itemObj = {
                mesh: crystalMesh,
                light: cLight,
                gridX: cell.x,
                gridY: cell.y
            };
            this.items.push(itemObj);
            this.allItems.push(itemObj);
        }
        
        // 2. Spawn 5 Batteries
        const batteryCount = Math.min(5, pathCells.length);
        
        // Simple cylinder mesh for battery
        const batGeom = new THREE.CylinderGeometry(0.12, 0.12, 0.4, 8);
        const batMat = new THREE.MeshStandardMaterial({
            color: 0xffdd00,
            roughness: 0.3,
            metalness: 0.8
        });
        
        for (let i = 0; i < batteryCount; i++) {
            const cell = pathCells.pop();
            const cx = (cell.x + 0.5) * this.cellSize;
            const cz = (cell.y + 0.5) * this.cellSize;
            const cy = 0.25;
            
            const batMesh = new THREE.Mesh(batGeom, batMat);
            batMesh.position.set(cx, cy, cz);
            batMesh.rotation.z = Math.PI / 2; // lie on side
            this.scene.add(batMesh);
            
            // Small green light
            const bLight = new THREE.PointLight(0x00ff66, 0.4, 2.0);
            bLight.position.set(cx, cy + 0.2, cz);
            this.scene.add(bLight);
            
            const batObj = {
                mesh: batMesh,
                light: bLight,
                gridX: cell.x,
                gridY: cell.y
            };
            this.batteries.push(batObj);
            this.allBatteries.push(batObj);
        }
    }
    
    spawnPresetCollectibles(presetCrystals, presetBatteries) {
        const THREE = this.THREE;
        
        // 1. Spawn Crystals
        const crystalGeom = new THREE.OctahedronGeometry(0.4, 0);
        const crystalMat = new THREE.MeshStandardMaterial({
            color: 0xff0033,
            emissive: 0xaa0011,
            roughness: 0.1,
            metalness: 0.9
        });
        
        presetCrystals.forEach(cell => {
            const cx = (cell.gridX + 0.5) * this.cellSize;
            const cz = (cell.gridY + 0.5) * this.cellSize;
            const cy = 1.0;
            
            const crystalMesh = new THREE.Mesh(crystalGeom, crystalMat);
            crystalMesh.position.set(cx, cy, cz);
            this.scene.add(crystalMesh);
            
            const cLight = new THREE.PointLight(0xff0033, 0.6, 3.5);
            cLight.position.set(cx, cy + 0.5, cz);
            this.scene.add(cLight);
            
            const itemObj = {
                mesh: crystalMesh,
                light: cLight,
                gridX: cell.gridX,
                gridY: cell.gridY
            };
            this.items.push(itemObj);
            this.allItems.push(itemObj);
        });
        
        // 2. Spawn Batteries
        const batGeom = new THREE.CylinderGeometry(0.12, 0.12, 0.4, 8);
        const batMat = new THREE.MeshStandardMaterial({
            color: 0xffdd00,
            roughness: 0.3,
            metalness: 0.8
        });
        
        presetBatteries.forEach(cell => {
            const cx = (cell.gridX + 0.5) * this.cellSize;
            const cz = (cell.gridY + 0.5) * this.cellSize;
            const cy = 0.25;
            
            const batMesh = new THREE.Mesh(batGeom, batMat);
            batMesh.position.set(cx, cy, cz);
            batMesh.rotation.z = Math.PI / 2;
            this.scene.add(batMesh);
            
            const bLight = new THREE.PointLight(0x00ff66, 0.4, 2.0);
            bLight.position.set(cx, cy + 0.2, cz);
            this.scene.add(bLight);
            
            const batObj = {
                mesh: batMesh,
                light: bLight,
                gridX: cell.gridX,
                gridY: cell.gridY
            };
            this.batteries.push(batObj);
            this.allBatteries.push(batObj);
        });
    }
    
    update(deltaTime, time) {
        // 1. Animate crystals (rotate and pulse light)
        this.items.forEach(item => {
            item.mesh.rotation.y += deltaTime * 1.5;
            item.mesh.rotation.x += deltaTime * 0.8;
            // Hover up and down
            item.mesh.position.y = 1.0 + Math.sin(time * 3 + item.mesh.position.x) * 0.15;
            item.light.intensity = 0.6 + Math.sin(time * 6 + item.mesh.position.x) * 0.3;
        });
        
        // 2. Animate batteries
        this.batteries.forEach(bat => {
            bat.mesh.rotation.y += deltaTime * 1.0;
            bat.light.intensity = 0.4 + Math.sin(time * 4 + bat.mesh.position.x) * 0.15;
        });
        
        // 3. Flicker ceiling lights randomly
        this.flickeringLights.forEach(item => {
            item.flickerTimer += deltaTime;
            if (item.flickerTimer >= item.nextFlicker) {
                // Flickering state
                if (Math.random() > 0.4) {
                    item.light.intensity = 0.05; // dim out
                    item.bulb.material.color.setHex(0x333322); // turn off bulb glow
                } else {
                    item.light.intensity = item.baseIntensity * (0.8 + Math.random() * 0.4);
                    item.bulb.material.color.setHex(0xfff0c0);
                }
                
                // Done flickering, schedule next flicker event
                if (Math.random() > 0.8) {
                    item.flickerTimer = 0;
                    item.nextFlicker = Math.random() * 4 + 1; // 1-5s wait
                }
            } else {
                // Stable on, minor hums
                item.light.intensity = item.baseIntensity + (Math.random() - 0.5) * 0.05;
            }
        });
    }
    
    // Cleanup meshes
    destroy() {
        this.wallMeshes.forEach(mesh => {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        });
        this.allItems.forEach(item => {
            this.scene.remove(item.mesh);
            this.scene.remove(item.light);
            item.mesh.geometry.dispose();
            item.mesh.material.dispose();
        });
        this.allBatteries.forEach(bat => {
            this.scene.remove(bat.mesh);
            this.scene.remove(bat.light);
            bat.mesh.geometry.dispose();
            bat.mesh.material.dispose();
        });
        this.flickeringLights.forEach(item => {
            this.scene.remove(item.bulb);
            this.scene.remove(item.light);
            item.bulb.geometry.dispose();
            item.bulb.material.dispose();
        });
        
        this.wallTexture.dispose();
        this.floorTexture.dispose();
        this.ceilingTexture.dispose();
    }
    
    // Procedural Texture Synthesizers using Canvas
    createWallTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        // Dark metallic-brick background
        ctx.fillStyle = '#1e1b1a';
        ctx.fillRect(0, 0, 256, 256);
        
        // Draw bricks
        ctx.strokeStyle = '#0c0b0a';
        ctx.lineWidth = 3;
        const rows = 16;
        const cols = 4;
        const rh = 256 / rows;
        const cw = 256 / cols;
        
        for (let i = 0; i <= rows; i++) {
            // Horizontal lines
            ctx.beginPath();
            ctx.moveTo(0, i * rh);
            ctx.lineTo(256, i * rh);
            ctx.stroke();
            
            // Vertical lines (staggered)
            const offset = (i % 2) * (cw / 2);
            for (let j = 0; j <= cols + 1; j++) {
                ctx.beginPath();
                ctx.moveTo(j * cw - offset, i * rh);
                ctx.lineTo(j * cw - offset, (i + 1) * rh);
                ctx.stroke();
            }
        }
        
        // Add grimy noise and rust splatters
        for (let i = 0; i < 3000; i++) {
            const rx = Math.random() * 256;
            const ry = Math.random() * 256;
            const size = Math.random() * 2;
            const colorVal = Math.random();
            if (colorVal > 0.8) {
                ctx.fillStyle = 'rgba(120, 50, 30, 0.15)'; // rust
            } else if (colorVal > 0.5) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'; // dirt
            } else {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.04)'; // highlights
            }
            ctx.fillRect(rx, ry, size, size);
        }
        
        const texture = new this.THREE.CanvasTexture(canvas);
        texture.wrapS = this.THREE.RepeatWrapping;
        texture.wrapT = this.THREE.RepeatWrapping;
        texture.repeat.set(1, 1);
        return texture;
    }
    
    createFloorTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        // Dirty concrete tiles
        ctx.fillStyle = '#2d2d30';
        ctx.fillRect(0, 0, 256, 256);
        
        // Tile grid
        ctx.strokeStyle = '#121214';
        ctx.lineWidth = 4;
        ctx.strokeRect(0, 0, 256, 256);
        ctx.strokeRect(0, 0, 128, 128);
        ctx.strokeRect(128, 0, 128, 128);
        ctx.strokeRect(0, 128, 128, 128);
        ctx.strokeRect(128, 128, 128, 128);
        
        // Dirt splatters and cracks
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#1a1a1c';
        for (let i = 0; i < 15; i++) {
            ctx.beginPath();
            ctx.moveTo(Math.random() * 256, Math.random() * 256);
            ctx.lineTo(Math.random() * 256, Math.random() * 256);
            ctx.stroke();
        }
        
        // Grainy noise
        for (let i = 0; i < 5000; i++) {
            const rx = Math.random() * 256;
            const ry = Math.random() * 256;
            const colorVal = Math.random();
            ctx.fillStyle = colorVal > 0.5 ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.03)';
            ctx.fillRect(rx, ry, 1.5, 1.5);
        }
        
        const texture = new this.THREE.CanvasTexture(canvas);
        texture.wrapS = this.THREE.RepeatWrapping;
        texture.wrapT = this.THREE.RepeatWrapping;
        texture.repeat.set(8, 8); // Tile floor across the plane
        return texture;
    }
    
    createCeilingTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        // Rusted iron/steel panels
        ctx.fillStyle = '#1c1c1f';
        ctx.fillRect(0, 0, 256, 256);
        
        // Metal panel lines and rivets
        ctx.strokeStyle = '#0a0a0c';
        ctx.lineWidth = 3;
        ctx.strokeRect(0, 0, 256, 256);
        ctx.strokeRect(4, 4, 248, 248);
        
        // Rivet dots on corners
        ctx.fillStyle = '#2d2d33';
        const rivets = [[12, 12], [244, 12], [12, 244], [244, 244]];
        rivets.forEach(([rx, ry]) => {
            ctx.beginPath();
            ctx.arc(rx, ry, 3, 0, Math.PI * 2);
            ctx.fill();
        });
        
        // Rust spots (brownish orange overlay)
        for (let i = 0; i < 8; i++) {
            const rx = Math.random() * 256;
            const ry = Math.random() * 256;
            const r = Math.random() * 25 + 5;
            const grad = ctx.createRadialGradient(rx, ry, 0, rx, ry, r);
            grad.addColorStop(0, 'rgba(85, 35, 15, 0.6)');
            grad.addColorStop(1, 'rgba(85, 35, 15, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(rx, ry, r, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Noise
        for (let i = 0; i < 4000; i++) {
            const rx = Math.random() * 256;
            const ry = Math.random() * 256;
            ctx.fillStyle = Math.random() > 0.5 ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.02)';
            ctx.fillRect(rx, ry, 1, 1);
        }
        
        const texture = new this.THREE.CanvasTexture(canvas);
        texture.wrapS = this.THREE.RepeatWrapping;
        texture.wrapT = this.THREE.RepeatWrapping;
        texture.repeat.set(8, 8);
        return texture;
    }
}
