const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Game Configuration
const CONFIG = {
    TICK_RATE: 60,
    MAP_WIDTH: 1200,
    MAP_HEIGHT: 700,
    PLAYER_SPEED: 5,
    PLAYER_SIZE: 30,
    BULLET_SPEED: 15,
    BULLET_SIZE: 8,
    FLAG_SIZE: 25,
    SCORE_TO_WIN: 3,
    MATCH_TIME: 180, // 3 minutes
    RESPAWN_TIME: 2000,
    HIT_STUN_TIME: 500
};

// Matchmaking Queue
let matchmakingQueue = [];

// Active Game Rooms
const gameRooms = new Map();

// Generate unique room ID
function generateRoomId() {
    return 'room_' + Math.random().toString(36).substr(2, 9);
}

// Create initial game state
function createGameState(player1Id, player2Id) {
    return {
        players: {
            [player1Id]: {
                id: player1Id,
                x: 100,
                y: CONFIG.MAP_HEIGHT / 2,
                team: 'red',
                hasFlag: false,
                score: 0,
                health: 100,
                angle: 0,
                velocityX: 0,
                velocityY: 0,
                isDead: false,
                lastHit: 0
            },
            [player2Id]: {
                id: player2Id,
                x: CONFIG.MAP_WIDTH - 100,
                y: CONFIG.MAP_HEIGHT / 2,
                team: 'blue',
                hasFlag: false,
                score: 0,
                health: 100,
                angle: 0,
                velocityX: 0,
                velocityY: 0,
                isDead: false,
                lastHit: 0
            }
        },
        flags: {
            red: { x: 80, y: CONFIG.MAP_HEIGHT / 2, isHome: true, carrier: null },
            blue: { x: CONFIG.MAP_WIDTH - 80, y: CONFIG.MAP_HEIGHT / 2, isHome: true, carrier: null }
        },
        bullets: [],
        obstacles: generateObstacles(),
        startTime: Date.now(),
        matchTime: CONFIG.MATCH_TIME,
        gameOver: false,
        winner: null
    };
}

// Generate random obstacles for the map
function generateObstacles() {
    const obstacles = [];
    // Center obstacles
    obstacles.push({ x: CONFIG.MAP_WIDTH / 2 - 50, y: CONFIG.MAP_HEIGHT / 2 - 80, width: 100, height: 160 });
    // Side obstacles
    obstacles.push({ x: 250, y: 150, width: 80, height: 80 });
    obstacles.push({ x: 250, y: CONFIG.MAP_HEIGHT - 230, width: 80, height: 80 });
    obstacles.push({ x: CONFIG.MAP_WIDTH - 330, y: 150, width: 80, height: 80 });
    obstacles.push({ x: CONFIG.MAP_WIDTH - 330, y: CONFIG.MAP_HEIGHT - 230, width: 80, height: 80 });
    // Small cover
    obstacles.push({ x: 450, y: CONFIG.MAP_HEIGHT / 2 - 30, width: 60, height: 60 });
    obstacles.push({ x: CONFIG.MAP_WIDTH - 510, y: CONFIG.MAP_HEIGHT / 2 - 30, width: 60, height: 60 });
    return obstacles;
}

// Check collision between two rectangles
function checkCollision(rect1, rect2) {
    return rect1.x < rect2.x + rect2.width &&
        rect1.x + rect1.width > rect2.x &&
        rect1.y < rect2.y + rect2.height &&
        rect1.y + rect1.height > rect2.y;
}

// Check if player collides with any obstacle
function collidesWithObstacle(x, y, size, obstacles) {
    const playerRect = { x: x - size / 2, y: y - size / 2, width: size, height: size };
    for (const obs of obstacles) {
        if (checkCollision(playerRect, obs)) {
            return true;
        }
    }
    return false;
}

// Distance between two points
function distance(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

// Game Room class
class GameRoom {
    constructor(roomId, player1Socket, player2Socket) {
        this.roomId = roomId;
        this.players = [player1Socket, player2Socket];
        this.state = createGameState(player1Socket.id, player2Socket.id);
        this.lastUpdate = Date.now();
        this.inputs = {};

        // Join socket room
        player1Socket.join(roomId);
        player2Socket.join(roomId);

        // Start game loop
        this.gameLoop = setInterval(() => this.update(), 1000 / CONFIG.TICK_RATE);

        // Send initial state
        this.broadcast('gameStart', {
            roomId: this.roomId,
            state: this.state,
            config: CONFIG,
            yourId: null // Will be set per-player
        });

        player1Socket.emit('gameStart', {
            roomId: this.roomId,
            state: this.state,
            config: CONFIG,
            yourId: player1Socket.id
        });

        player2Socket.emit('gameStart', {
            roomId: this.roomId,
            state: this.state,
            config: CONFIG,
            yourId: player2Socket.id
        });
    }

    broadcast(event, data) {
        io.to(this.roomId).emit(event, data);
    }

    handleInput(playerId, input) {
        this.inputs[playerId] = input;
    }

    handleShoot(playerId, angle) {
        const player = this.state.players[playerId];
        if (!player || player.isDead) return;

        const bullet = {
            id: Math.random().toString(36).substr(2, 9),
            x: player.x,
            y: player.y,
            angle: angle,
            ownerId: playerId,
            team: player.team,
            velocityX: Math.cos(angle) * CONFIG.BULLET_SPEED,
            velocityY: Math.sin(angle) * CONFIG.BULLET_SPEED
        };

        this.state.bullets.push(bullet);
    }

    update() {
        if (this.state.gameOver) return;

        const now = Date.now();
        const elapsed = Math.floor((now - this.state.startTime) / 1000);
        const timeLeft = CONFIG.MATCH_TIME - elapsed;

        // Check time over
        if (timeLeft <= 0) {
            this.endGame();
            return;
        }

        // Update players
        for (const [playerId, player] of Object.entries(this.state.players)) {
            if (player.isDead) continue;

            const input = this.inputs[playerId] || {};
            let newX = player.x;
            let newY = player.y;

            // Handle movement
            if (input.up) newY -= CONFIG.PLAYER_SPEED;
            if (input.down) newY += CONFIG.PLAYER_SPEED;
            if (input.left) newX -= CONFIG.PLAYER_SPEED;
            if (input.right) newX += CONFIG.PLAYER_SPEED;

            // Check bounds
            newX = Math.max(CONFIG.PLAYER_SIZE / 2, Math.min(CONFIG.MAP_WIDTH - CONFIG.PLAYER_SIZE / 2, newX));
            newY = Math.max(CONFIG.PLAYER_SIZE / 2, Math.min(CONFIG.MAP_HEIGHT - CONFIG.PLAYER_SIZE / 2, newY));

            // Check obstacle collision
            if (!collidesWithObstacle(newX, newY, CONFIG.PLAYER_SIZE, this.state.obstacles)) {
                player.x = newX;
                player.y = newY;
            }

            // Update angle
            if (input.angle !== undefined) {
                player.angle = input.angle;
            }

            // Check flag pickup
            this.checkFlagPickup(player);

            // Check flag capture
            this.checkFlagCapture(player);
        }

        // Update bullets
        this.updateBullets();

        // Update flag positions for carriers
        this.updateFlagPositions();

        // Broadcast state
        this.broadcast('gameState', {
            state: this.state,
            timeLeft: timeLeft
        });
    }

    updateBullets() {
        const bulletsToRemove = [];

        for (let i = 0; i < this.state.bullets.length; i++) {
            const bullet = this.state.bullets[i];

            // Move bullet
            bullet.x += bullet.velocityX;
            bullet.y += bullet.velocityY;

            // Check out of bounds
            if (bullet.x < 0 || bullet.x > CONFIG.MAP_WIDTH ||
                bullet.y < 0 || bullet.y > CONFIG.MAP_HEIGHT) {
                bulletsToRemove.push(i);
                continue;
            }

            // Check obstacle collision
            if (collidesWithObstacle(bullet.x, bullet.y, CONFIG.BULLET_SIZE, this.state.obstacles)) {
                bulletsToRemove.push(i);
                continue;
            }

            // Check player hit
            for (const [playerId, player] of Object.entries(this.state.players)) {
                if (playerId === bullet.ownerId || player.isDead) continue;
                if (player.team === bullet.team) continue;

                if (distance(bullet.x, bullet.y, player.x, player.y) < (CONFIG.PLAYER_SIZE / 2 + CONFIG.BULLET_SIZE / 2)) {
                    bulletsToRemove.push(i);
                    this.hitPlayer(playerId, bullet.ownerId);
                    break;
                }
            }
        }

        // Remove bullets (reverse order to maintain indices)
        for (let i = bulletsToRemove.length - 1; i >= 0; i--) {
            this.state.bullets.splice(bulletsToRemove[i], 1);
        }
    }

    hitPlayer(playerId, attackerId) {
        const player = this.state.players[playerId];
        const now = Date.now();

        if (now - player.lastHit < CONFIG.HIT_STUN_TIME) return;

        player.health -= 34;
        player.lastHit = now;

        if (player.health <= 0) {
            player.isDead = true;
            player.health = 0;

            // Drop flag if carrying
            if (player.hasFlag) {
                const enemyTeam = player.team === 'red' ? 'blue' : 'red';
                this.state.flags[enemyTeam].x = player.x;
                this.state.flags[enemyTeam].y = player.y;
                this.state.flags[enemyTeam].isHome = false;
                this.state.flags[enemyTeam].carrier = null;
                player.hasFlag = false;
            }

            // Respawn after delay
            setTimeout(() => {
                this.respawnPlayer(playerId);
            }, CONFIG.RESPAWN_TIME);
        }

        this.broadcast('playerHit', { playerId, attackerId, health: player.health });
    }

    respawnPlayer(playerId) {
        const player = this.state.players[playerId];
        if (!player) return;

        player.isDead = false;
        player.health = 100;

        // Respawn at team base
        if (player.team === 'red') {
            player.x = 100;
            player.y = CONFIG.MAP_HEIGHT / 2;
        } else {
            player.x = CONFIG.MAP_WIDTH - 100;
            player.y = CONFIG.MAP_HEIGHT / 2;
        }

        this.broadcast('playerRespawn', { playerId });
    }

    checkFlagPickup(player) {
        // Can only pick up enemy flag
        const enemyTeam = player.team === 'red' ? 'blue' : 'red';
        const flag = this.state.flags[enemyTeam];

        if (flag.carrier) return; // Already being carried
        if (player.hasFlag) return; // Already has a flag

        if (distance(player.x, player.y, flag.x, flag.y) < (CONFIG.PLAYER_SIZE / 2 + CONFIG.FLAG_SIZE / 2)) {
            flag.carrier = player.id;
            player.hasFlag = true;
            this.broadcast('flagPickup', { playerId: player.id, flagTeam: enemyTeam });
        }
    }

    checkFlagCapture(player) {
        if (!player.hasFlag) return;

        // Check if at home base with enemy flag
        const homeFlag = this.state.flags[player.team];

        if (distance(player.x, player.y, homeFlag.x, homeFlag.y) < (CONFIG.PLAYER_SIZE / 2 + CONFIG.FLAG_SIZE)) {
            // Only capture if own flag is home
            if (homeFlag.isHome) {
                player.score++;
                player.hasFlag = false;

                // Reset enemy flag
                const enemyTeam = player.team === 'red' ? 'blue' : 'red';
                this.resetFlag(enemyTeam);

                this.broadcast('flagCapture', {
                    playerId: player.id,
                    score: player.score,
                    team: player.team
                });

                // Check win condition
                if (player.score >= CONFIG.SCORE_TO_WIN) {
                    this.endGame(player.id);
                }
            }
        }
    }

    resetFlag(team) {
        const flag = this.state.flags[team];
        flag.isHome = true;
        flag.carrier = null;

        if (team === 'red') {
            flag.x = 80;
            flag.y = CONFIG.MAP_HEIGHT / 2;
        } else {
            flag.x = CONFIG.MAP_WIDTH - 80;
            flag.y = CONFIG.MAP_HEIGHT / 2;
        }
    }

    updateFlagPositions() {
        for (const [team, flag] of Object.entries(this.state.flags)) {
            if (flag.carrier) {
                const carrier = this.state.players[flag.carrier];
                if (carrier && !carrier.isDead) {
                    flag.x = carrier.x;
                    flag.y = carrier.y - CONFIG.PLAYER_SIZE / 2 - 10;
                }
            }
        }
    }

    endGame(winnerId = null) {
        this.state.gameOver = true;

        if (winnerId) {
            this.state.winner = winnerId;
        } else {
            // Time over - determine winner by score
            const players = Object.values(this.state.players);
            if (players[0].score > players[1].score) {
                this.state.winner = players[0].id;
            } else if (players[1].score > players[0].score) {
                this.state.winner = players[1].id;
            } else {
                this.state.winner = 'tie';
            }
        }

        this.broadcast('gameOver', {
            winner: this.state.winner,
            finalState: this.state
        });

        // Clean up
        clearInterval(this.gameLoop);

        // Remove room after delay
        setTimeout(() => {
            gameRooms.delete(this.roomId);
        }, 5000);
    }

    handleDisconnect(playerId) {
        // Other player wins by default
        const otherPlayer = Object.keys(this.state.players).find(id => id !== playerId);
        if (otherPlayer && !this.state.gameOver) {
            this.endGame(otherPlayer);
        }

        clearInterval(this.gameLoop);
        gameRooms.delete(this.roomId);
    }
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    // Join matchmaking
    socket.on('joinMatchmaking', () => {
        // Check if already in queue
        if (matchmakingQueue.find(s => s.id === socket.id)) return;

        // Check if already in a game
        for (const room of gameRooms.values()) {
            if (room.players.find(p => p.id === socket.id)) return;
        }

        matchmakingQueue.push(socket);
        socket.emit('matchmakingJoined', { position: matchmakingQueue.length });

        console.log(`Player ${socket.id} joined queue. Queue size: ${matchmakingQueue.length}`);

        // Try to match
        if (matchmakingQueue.length >= 2) {
            const player1 = matchmakingQueue.shift();
            const player2 = matchmakingQueue.shift();

            const roomId = generateRoomId();
            const room = new GameRoom(roomId, player1, player2);
            gameRooms.set(roomId, room);

            console.log(`Match created: ${roomId} with ${player1.id} vs ${player2.id}`);
        }
    });

    // Leave matchmaking
    socket.on('leaveMatchmaking', () => {
        matchmakingQueue = matchmakingQueue.filter(s => s.id !== socket.id);
        socket.emit('matchmakingLeft');
    });

    // Player input
    socket.on('playerInput', (input) => {
        for (const room of gameRooms.values()) {
            if (room.state.players[socket.id]) {
                room.handleInput(socket.id, input);
                break;
            }
        }
    });

    // Player shoot
    socket.on('playerShoot', (data) => {
        for (const room of gameRooms.values()) {
            if (room.state.players[socket.id]) {
                room.handleShoot(socket.id, data.angle);
                break;
            }
        }
    });

    // Disconnect handling
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);

        // Remove from matchmaking
        matchmakingQueue = matchmakingQueue.filter(s => s.id !== socket.id);

        // Handle game disconnect
        for (const room of gameRooms.values()) {
            if (room.state.players[socket.id]) {
                room.handleDisconnect(socket.id);
                break;
            }
        }
    });
});

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        players: io.engine.clientsCount,
        queue: matchmakingQueue.length,
        activeGames: gameRooms.size
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🎮 CTF Game Server running on port ${PORT}`);
});
