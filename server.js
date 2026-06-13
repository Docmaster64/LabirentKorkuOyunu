const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve built frontend files in production
app.use(express.static(path.join(__dirname, 'dist')));

// Keep track of active game rooms
const rooms = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    
    // 1. Create a Room
    socket.on('createRoom', ({ playerName, playerColor, playerFace }) => {
        const roomCode = Math.floor(1000 + Math.random() * 9000).toString();
        
        rooms[roomCode] = {
            code: roomCode,
            hostId: socket.id,
            players: {},
            gameStarted: false,
            mazeData: null,
            itemsCollected: 0
        };
        
        rooms[roomCode].players[socket.id] = {
            id: socket.id,
            name: playerName || `Oyuncu 1`,
            position: { x: 6, y: 1.6, z: 6 },
            yaw: 0,
            pitch: 0,
            roll: 0,
            isSprinting: false,
            isMoving: false,
            isDead: false,
            activeSkill: null,
            isFlashlightOn: true,
            color: playerColor || '#00ff66',
            face: playerFace || null
        };
        
        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode, players: rooms[roomCode].players });
        console.log(`Room created: ${roomCode} by host: ${socket.id}`);
    });
    
    // 2. Join an existing Room
    socket.on('joinRoom', ({ roomCode, playerName, playerColor, playerFace }) => {
        const code = roomCode.trim();
        const room = rooms[code];
        
        if (!room) {
            socket.emit('errorMsg', 'Oda bulunamadı!');
            return;
        }
        
        if (room.gameStarted) {
            socket.emit('errorMsg', 'Oyun çoktan başladı!');
            return;
        }
        
        const playerCount = Object.keys(room.players).length;
        if (playerCount >= 4) {
            socket.emit('errorMsg', 'Oda dolu! (Maksimum 4 Oyuncu)');
            return;
        }
        
        room.players[socket.id] = {
            id: socket.id,
            name: playerName || `Oyuncu ${playerCount + 1}`,
            position: { x: 6, y: 1.6, z: 6 },
            yaw: 0,
            pitch: 0,
            roll: 0,
            isSprinting: false,
            isMoving: false,
            isDead: false,
            activeSkill: null,
            isFlashlightOn: true,
            color: playerColor || '#00ff66',
            face: playerFace || null
        };
        
        socket.join(code);
        socket.emit('roomJoined', { roomCode: code, players: room.players });
        socket.to(code).emit('playerJoined', { players: room.players, newPlayerId: socket.id });
        console.log(`Player ${socket.id} joined room ${code}`);
    });
    
    // 3. Host Starts Game
    socket.on('startGame', ({ roomCode, mazeGrid, items, batteries, chests }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;
        
        room.gameStarted = true;
        room.mazeData = { mazeGrid, items, batteries, chests };
        room.itemsCollected = 0;
        
        // Reset player dead states
        for (const pid in room.players) {
            room.players[pid].isDead = false;
        }
        
        io.to(roomCode).emit('gameStarted', {
            mazeGrid,
            items,
            batteries,
            chests,
            players: room.players
        });
        console.log(`Game started in room ${roomCode}`);
    });
    
    // 4. Update Player position/status (tick)
    socket.on('updatePlayer', ({ roomCode, position, yaw, pitch, roll, isSprinting, isMoving, isDead, activeSkill, isFlashlightOn }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        const player = room.players[socket.id];
        if (!player) return;
        
        player.position = position;
        player.yaw = yaw;
        player.pitch = pitch;
        player.roll = roll;
        player.isSprinting = isSprinting;
        player.isMoving = isMoving;
        player.isDead = isDead;
        player.activeSkill = activeSkill;
        player.isFlashlightOn = isFlashlightOn;
        
        // Broadcast updates to other clients in same room
        socket.to(roomCode).emit('playerUpdated', { playerId: socket.id, player });
    });
    
    // 5. Host broadcasts Monster updates
    socket.on('updateMonster', ({ roomCode, position, rotationY, state, targetPoint, isDashingState }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;
        
        // Broadcast to clients in same room
        socket.to(roomCode).emit('monsterUpdated', {
            position,
            rotationY,
            state,
            targetPoint,
            isDashingState
        });
    });
    
    // 6. Player collects an item (crystal or battery)
    socket.on('collectItem', ({ roomCode, itemType, itemIndex, playerId }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        io.to(roomCode).emit('itemCollected', { itemType, itemIndex, playerId });
        
        if (itemType === 'crystal') {
            room.itemsCollected++;
        }
        console.log(`Item collected in room ${roomCode}: ${itemType} at index ${itemIndex}`);
    });
    
    // 7. Player uses a skill (Trigger effect on clients, e.g. flashbang explosion, decoy sound)
    socket.on('useSkill', ({ roomCode, skillName, position, forwardDir }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        io.to(roomCode).emit('skillUsed', { playerId: socket.id, skillName, position, forwardDir });
        console.log(`Player ${socket.id} used skill ${skillName} in room ${roomCode}`);
    });
    
    // 8. Player is caught by monster
    socket.on('playerCaught', ({ roomCode, playerId }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        const player = room.players[playerId];
        if (player) {
            player.isDead = true;
        }
        
        io.to(roomCode).emit('playerCaught', { playerId });
        
        // Check if all players in room are dead
        const allDead = Object.values(room.players).every(p => p.isDead);
        if (allDead) {
            io.to(roomCode).emit('teamDefeated');
            console.log(`Team defeated in room ${roomCode}`);
        }
    });
    
    // 9. Handle Disconnection
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        
        // Find which rooms the player was in and remove them
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            if (room.players[socket.id]) {
                delete room.players[socket.id];
                
                const playersLeft = Object.keys(room.players).length;
                if (playersLeft === 0) {
                    // Room is empty, delete it
                    delete rooms[roomCode];
                    console.log(`Room ${roomCode} deleted as it became empty.`);
                } else {
                    // Notify others
                    io.to(roomCode).emit('playerLeft', { playerId: socket.id, players: room.players });
                    
                    // If Host left, assign a new host
                    if (room.hostId === socket.id) {
                        const newHostId = Object.keys(room.players)[0];
                        room.hostId = newHostId;
                        io.to(roomCode).emit('hostChanged', { hostId: newHostId });
                        console.log(`Host changed to ${newHostId} in room ${roomCode}`);
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Socket.io Server running on port ${PORT}`));
