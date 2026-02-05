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
    SCORE_TO_WIN: 5,
    MATCH_TIME: 900, // 15 minutes
    RESPAWN_TIME: 2000,
    HIT_STUN_TIME: 500,
    // Ultimate settings
    ULTIMATE_CHARGE_ON_HIT: 25,
    ULTIMATE_CHARGE_ON_ENEMY_SCORE: 75,
    ULTIMATE_HOLD_TIME: 1500, // Hold for 1.5 seconds to charge
    ULTIMATE_DAMAGE: 100, // One shot kill
    // Health pickup settings
    HEALTH_PICKUP_SIZE: 20,
    HEALTH_PICKUP_AMOUNT: 50,
    HEALTH_PICKUP_SPAWN_INTERVAL: 10000, // Every 10 seconds
    MAX_HEALTH_PICKUPS: 3,
    // Emoji settings
    EMOJIS: ['😀', '😎', '💀', '🔥'],
    EMOJI_DURATION: 2000, // 2 seconds display time
    // Weapon settings
    WEAPONS: {
        pistol: { name: 'Deagle', damage: 45, cooldown: 500, speed: 18, range: 700 },
        smg: { name: 'SMG', damage: 12, cooldown: 100, speed: 20, range: 700, spread: 0.25 },
        m79: { name: 'M79', damage: 0, cooldown: 1500, speed: 12, range: 800, explosive: true, radius: 110, impactDamage: 100, splashDamage: 40 },
        sniper: { name: 'Sniper', damage: 100, cooldown: 2000, speed: 35, range: 1500 }
    }
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
                score: 0, // Legacy/Total? Let's use specific counters
                kills: 0,
                flags: 0,
                health: 100,
                angle: 0,
                velocityX: 0,
                velocityY: 0,
                isDead: false,
                lastHit: 0,
                lastShot: 0,
                currentWeapon: 'pistol',
                ultimateCharge: 0,
                isChargingUltimate: false,
                ultimateHoldStart: 0,
                ultimateHoldProgress: 0
            },
            [player2Id]: {
                id: player2Id,
                x: CONFIG.MAP_WIDTH - 100,
                y: CONFIG.MAP_HEIGHT / 2,
                team: 'blue',
                hasFlag: false,
                score: 0, // Legacy/Total? Let's use specific counters
                kills: 0,
                flags: 0,
                health: 100,
                angle: 0,
                velocityX: 0,
                velocityY: 0,
                isDead: false,
                lastHit: 0,
                lastShot: 0,
                currentWeapon: 'pistol',
                ultimateCharge: 0,
                isChargingUltimate: false,
                ultimateHoldStart: 0,
                ultimateHoldProgress: 0
            }
        },
        flags: {
            red: { x: 80, y: CONFIG.MAP_HEIGHT / 2, defX: 80, defY: CONFIG.MAP_HEIGHT / 2, isHome: true, carrier: null },
            blue: { x: CONFIG.MAP_WIDTH - 80, y: CONFIG.MAP_HEIGHT / 2, defX: CONFIG.MAP_WIDTH - 80, defY: CONFIG.MAP_HEIGHT / 2, isHome: true, carrier: null }
        },
        bullets: [],
        ultimateBeams: [],
        healthPickups: [],
        obstacles: generateObstacles(),
        startTime: Date.now(),
        lastHealthPickupSpawn: Date.now(),
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

// Check if a point is on a line segment (for ray collision)
function pointOnLineSegment(px, py, x1, y1, x2, y2, threshold = 15) {
    const d1 = distance(px, py, x1, y1);
    const d2 = distance(px, py, x2, y2);
    const lineLen = distance(x1, y1, x2, y2);
    const buffer = threshold;

    if (d1 + d2 >= lineLen - buffer && d1 + d2 <= lineLen + buffer) {
        return true;
    }
    return false;
}

// Spawn health pickup at random location
function spawnHealthPickup(state) {
    // Find a valid spawn location (not on obstacles, not too close to flags)
    let attempts = 0;
    while (attempts < 20) {
        const x = 200 + Math.random() * (CONFIG.MAP_WIDTH - 400);
        const y = 100 + Math.random() * (CONFIG.MAP_HEIGHT - 200);

        // Check not on obstacle
        if (!collidesWithObstacle(x, y, CONFIG.HEALTH_PICKUP_SIZE, state.obstacles)) {
            // Check not too close to flags
            const distToRedFlag = distance(x, y, state.flags.red.x, state.flags.red.y);
            const distToBlueFlag = distance(x, y, state.flags.blue.x, state.flags.blue.y);

            if (distToRedFlag > 100 && distToBlueFlag > 100) {
                return {
                    id: Math.random().toString(36).substr(2, 9),
                    x: x,
                    y: y,
                    spawnTime: Date.now()
                };
            }
        }
        attempts++;
    }
    return null;
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
        if (player.isChargingUltimate) return;

        const weapon = CONFIG.WEAPONS[player.currentWeapon];
        const now = Date.now();

        if (now - player.lastShot < weapon.cooldown) return;
        player.lastShot = now;

        // Apply spread for SMG
        let fireAngle = angle;
        if (weapon.spread) {
            fireAngle += (Math.random() - 0.5) * weapon.spread;
        }

        const bullet = {
            id: Math.random().toString(36).substr(2, 9),
            x: player.x,
            y: player.y,
            angle: fireAngle,
            ownerId: playerId,
            team: player.team,
            velocityX: Math.cos(fireAngle) * weapon.speed,
            velocityY: Math.sin(fireAngle) * weapon.speed,
            damage: weapon.damage,
            range: weapon.range,
            distanceTraveled: 0,
            type: player.currentWeapon,
            explosive: weapon.explosive
        };

        this.state.bullets.push(bullet);
    }

    handleWeaponSelect(playerId, weaponType) {
        const player = this.state.players[playerId];
        if (!player) return;

        // Validate weapon type
        if (CONFIG.WEAPONS[weaponType]) {
            player.currentWeapon = weaponType;
        }
    }

    // Start charging ultimate (SPACE pressed)
    handleUltimateStart(playerId, angle) {
        const player = this.state.players[playerId];
        if (!player || player.isDead) return;

        // Ultimate temporarily disabled
        return;

        if (player.ultimateCharge < 100) return; // Not fully charged
        if (player.isChargingUltimate) return; // Already charging

        player.isChargingUltimate = true;
        player.ultimateHoldStart = Date.now();
        player.ultimateHoldProgress = 0;
        player.ultimateAngle = angle;

        this.broadcast('ultimateCharging', {
            playerId: playerId,
            angle: angle
        });
    }

    // Release ultimate (SPACE released)
    handleUltimateRelease(playerId, angle) {
        const player = this.state.players[playerId];
        if (!player || !player.isChargingUltimate) return;

        const holdTime = Date.now() - player.ultimateHoldStart;

        // Only fire if held long enough
        if (holdTime >= CONFIG.ULTIMATE_HOLD_TIME) {
            this.fireUltimate(playerId, angle);
        } else {
            // Cancelled - didn't hold long enough
            player.isChargingUltimate = false;
            player.ultimateHoldProgress = 0;
            this.broadcast('ultimateCancelled', { playerId: playerId });
        }
    }

    fireUltimate(playerId, angle) {
        const player = this.state.players[playerId];
        if (!player) return;

        player.isChargingUltimate = false;
        player.ultimateCharge = 0;
        player.ultimateHoldProgress = 0;

        // Calculate ray endpoint (goes through entire map)
        const rayLength = 2000;
        const endX = player.x + Math.cos(angle) * rayLength;
        const endY = player.y + Math.sin(angle) * rayLength;

        const beam = {
            id: Math.random().toString(36).substr(2, 9),
            ownerId: playerId,
            team: player.team,
            startX: player.x,
            startY: player.y,
            endX: endX,
            endY: endY,
            angle: angle,
            firedTime: Date.now()
        };

        this.state.ultimateBeams.push(beam);

        // Check for hits (ray goes through walls!)
        for (const [targetId, targetPlayer] of Object.entries(this.state.players)) {
            if (targetId === playerId || targetPlayer.isDead) continue;
            if (targetPlayer.team === player.team) continue;

            if (pointOnLineSegment(
                targetPlayer.x, targetPlayer.y,
                beam.startX, beam.startY,
                beam.endX, beam.endY,
                CONFIG.PLAYER_SIZE
            )) {
                this.hitPlayerWithUltimate(targetId, playerId);
            }
        }

        this.broadcast('ultimateFired', {
            playerId: playerId,
            beam: beam
        });

        // Remove beam after display time
        setTimeout(() => {
            const index = this.state.ultimateBeams.findIndex(b => b.id === beam.id);
            if (index !== -1) {
                this.state.ultimateBeams.splice(index, 1);
            }
        }, 500);
    }

    hitPlayerWithUltimate(playerId, attackerId) {
        const player = this.state.players[playerId];

        player.health = 0;
        player.isDead = true;

        if (player.hasFlag) {
            const enemyTeam = player.team === 'red' ? 'blue' : 'red';
            this.state.flags[enemyTeam].x = player.x;
            this.state.flags[enemyTeam].y = player.y;
            this.state.flags[enemyTeam].isHome = false;
            this.state.flags[enemyTeam].carrier = null;
            player.hasFlag = false;
        }

        setTimeout(() => {
            this.respawnPlayer(playerId);
        }, CONFIG.RESPAWN_TIME);

        this.broadcast('playerHit', { playerId, attackerId, health: 0, isUltimate: true });
    }

    addUltimateCharge(playerId, amount) {
        const player = this.state.players[playerId];
        if (!player) return;

        player.ultimateCharge = Math.min(100, player.ultimateCharge + amount);

        this.broadcast('ultimateCharge', {
            playerId: playerId,
            charge: player.ultimateCharge
        });
    }

    update() {
        if (this.state.gameOver) return;

        const now = Date.now();
        const elapsed = Math.floor((now - this.state.startTime) / 1000);
        const timeLeft = CONFIG.MATCH_TIME - elapsed;

        if (timeLeft <= 0) {
            this.endGame();
            return;
        }

        // Spawn health pickups periodically
        if (now - this.state.lastHealthPickupSpawn >= CONFIG.HEALTH_PICKUP_SPAWN_INTERVAL) {
            if (this.state.healthPickups.length < CONFIG.MAX_HEALTH_PICKUPS) {
                const pickup = spawnHealthPickup(this.state);
                if (pickup) {
                    this.state.healthPickups.push(pickup);
                    this.broadcast('healthPickupSpawned', pickup);
                }
            }
            this.state.lastHealthPickupSpawn = now;
        }

        // Update players
        for (const [playerId, player] of Object.entries(this.state.players)) {
            if (player.isDead) continue;

            const input = this.inputs[playerId] || {};

            // Handle movement (slower while charging ultimate)
            const speedMod = player.isChargingUltimate ? 0.3 : 1;
            let moveX = 0;
            let moveY = 0;

            if (input.up) moveY -= CONFIG.PLAYER_SPEED * speedMod;
            if (input.down) moveY += CONFIG.PLAYER_SPEED * speedMod;
            if (input.left) moveX -= CONFIG.PLAYER_SPEED * speedMod;
            if (input.right) moveX += CONFIG.PLAYER_SPEED * speedMod;

            // Try X movement separately
            let newX = player.x + moveX;
            newX = Math.max(CONFIG.PLAYER_SIZE / 2, Math.min(CONFIG.MAP_WIDTH - CONFIG.PLAYER_SIZE / 2, newX));
            if (!collidesWithObstacle(newX, player.y, CONFIG.PLAYER_SIZE, this.state.obstacles)) {
                player.x = newX;
            }

            // Try Y movement separately (wall sliding!)
            let newY = player.y + moveY;
            newY = Math.max(CONFIG.PLAYER_SIZE / 2, Math.min(CONFIG.MAP_HEIGHT - CONFIG.PLAYER_SIZE / 2, newY));
            if (!collidesWithObstacle(player.x, newY, CONFIG.PLAYER_SIZE, this.state.obstacles)) {
                player.y = newY;
            }

            if (input.angle !== undefined) {
                player.angle = input.angle;
                if (player.isChargingUltimate) {
                    player.ultimateAngle = input.angle;
                }
            }

            // Update ultimate hold progress
            if (player.isChargingUltimate) {
                const holdTime = now - player.ultimateHoldStart;
                player.ultimateHoldProgress = Math.min(100, (holdTime / CONFIG.ULTIMATE_HOLD_TIME) * 100);
            }

            // Check health pickup
            this.checkHealthPickup(player);

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

    checkHealthPickup(player) {
        for (let i = this.state.healthPickups.length - 1; i >= 0; i--) {
            const pickup = this.state.healthPickups[i];
            if (distance(player.x, player.y, pickup.x, pickup.y) < (CONFIG.PLAYER_SIZE / 2 + CONFIG.HEALTH_PICKUP_SIZE / 2)) {
                // Pick up health
                player.health = Math.min(100, player.health + CONFIG.HEALTH_PICKUP_AMOUNT);
                this.state.healthPickups.splice(i, 1);

                this.broadcast('healthPickedUp', {
                    playerId: player.id,
                    pickupId: pickup.id,
                    newHealth: player.health
                });
            }
        }
    }

    updateBullets() {
        const bulletsToRemove = [];

        for (let i = 0; i < this.state.bullets.length; i++) {
            const bullet = this.state.bullets[i];

            // Move bullet
            const speed = Math.sqrt(bullet.velocityX ** 2 + bullet.velocityY ** 2);
            bullet.x += bullet.velocityX;
            bullet.y += bullet.velocityY;
            bullet.distanceTraveled = (bullet.distanceTraveled || 0) + speed;

            // Check range
            if (bullet.range && bullet.distanceTraveled >= bullet.range) {
                if (bullet.explosive) {
                    this.createExplosion(bullet);
                }
                bulletsToRemove.push(i);
                continue;
            }

            // Check bounds
            if (bullet.x < 0 || bullet.x > CONFIG.MAP_WIDTH ||
                bullet.y < 0 || bullet.y > CONFIG.MAP_HEIGHT) {
                bulletsToRemove.push(i);
                continue;
            }

            // Check obstacles
            if (collidesWithObstacle(bullet.x, bullet.y, CONFIG.BULLET_SIZE, this.state.obstacles)) {
                if (bullet.explosive) {
                    this.createExplosion(bullet);
                }
                bulletsToRemove.push(i);
                continue;
            }

            // Check player hits
            for (const [playerId, player] of Object.entries(this.state.players)) {
                if (playerId === bullet.ownerId || player.isDead) continue;
                if (player.team === bullet.team) continue;

                if (distance(bullet.x, bullet.y, player.x, player.y) < (CONFIG.PLAYER_SIZE / 2 + CONFIG.BULLET_SIZE / 2)) {
                    bulletsToRemove.push(i);

                    if (bullet.explosive) {
                        this.createExplosion(bullet);
                    } else {
                        // Pass specific damage
                        this.hitPlayer(playerId, bullet.ownerId, bullet.damage);
                    }
                    break;
                }
            }
        }

        for (let i = bulletsToRemove.length - 1; i >= 0; i--) {
            this.state.bullets.splice(bulletsToRemove[i], 1);
        }
    }

    createExplosion(bullet) {
        const weapon = CONFIG.WEAPONS.m79;
        this.broadcast('explosion', {
            x: bullet.x,
            y: bullet.y,
            radius: weapon.radius
        });

        for (const [targetId, targetPlayer] of Object.entries(this.state.players)) {
            if (targetPlayer.isDead) continue;

            // Allow self-damage but prevent team damage (except self)
            if (targetPlayer.team === bullet.team && targetId !== bullet.ownerId) continue;

            const dist = distance(bullet.x, bullet.y, targetPlayer.x, targetPlayer.y);
            if (dist <= weapon.radius) {
                // Damage Falloff:
                // Direct Hit (0 dist) = 100% Damage
                // Max Range (radius) = ~30% Damage

                const falloff = 1 - (dist / weapon.radius);

                // Base damage from config impactDamage at center, min 30 at edge
                let damage = Math.floor(30 + ((weapon.impactDamage - 30) * falloff));

                // If very close, ensure full impact damage (LETHAL RADIUS)
                if (dist < 20) damage = weapon.impactDamage;

                this.hitPlayer(targetId, bullet.ownerId, damage);
            }
        }
    }

    hitPlayer(playerId, attackerId, damage = 34) {
        const player = this.state.players[playerId];
        const attacker = this.state.players[attackerId];
        const now = Date.now();

        if (now - player.lastHit < CONFIG.HIT_STUN_TIME) return;

        player.health -= damage;
        player.lastHit = now;

        // Add ultimate charge to attacker (25%)
        if (attacker) {
            this.addUltimateCharge(attackerId, CONFIG.ULTIMATE_CHARGE_ON_HIT);
        }

        if (player.health <= 0) {
            player.isDead = true;
            player.health = 0;

            // Increment kills for attacker
            if (attacker && attackerId !== playerId) {
                attacker.kills = (attacker.kills || 0) + 1;
            }

            if (player.hasFlag) {
                const enemyTeam = player.team === 'red' ? 'blue' : 'red';
                this.state.flags[enemyTeam].x = player.x;
                this.state.flags[enemyTeam].y = player.y;
                this.state.flags[enemyTeam].isHome = false;
                this.state.flags[enemyTeam].carrier = null;
                player.hasFlag = false;
            }

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
        // First check: Can we RETURN our own flag?
        const ownFlag = this.state.flags[player.team];

        // Cannot return flag if it's currently held by an enemy (must kill carrier first)
        // Only proceed with return check if it's NOT home and NOT carried
        if (!ownFlag.isHome && !ownFlag.carrier) {
            // Our flag is dropped on the ground
            if (distance(player.x, player.y, ownFlag.x, ownFlag.y) < (CONFIG.PLAYER_SIZE / 2 + CONFIG.FLAG_SIZE / 2)) {
                // Return our flag to base!
                this.resetFlag(player.team);
                this.broadcast('flagReturned', { playerId: player.id, flagTeam: player.team });
                return;
            }
        }

        // Second check: Can we PICKUP enemy flag?
        const enemyTeam = player.team === 'red' ? 'blue' : 'red';
        const flag = this.state.flags[enemyTeam];

        if (flag.carrier) return;
        if (player.hasFlag) return;

        if (distance(player.x, player.y, flag.x, flag.y) < (CONFIG.PLAYER_SIZE / 2 + CONFIG.FLAG_SIZE / 2)) {
            flag.carrier = player.id;
            player.hasFlag = true;
            this.broadcast('flagPickup', { playerId: player.id, flagTeam: enemyTeam });
        }
    }

    checkFlagCapture(player) {
        if (!player.hasFlag) return;

        // CTF RULE: Your own flag must be at your base to score!
        const homeFlag = this.state.flags[player.team];
        if (!homeFlag.isHome) return; // Can't score if your flag is stolen!

        // Define base positions (where you score)
        const baseX = player.team === 'red' ? 80 : CONFIG.MAP_WIDTH - 80;
        const baseY = CONFIG.MAP_HEIGHT / 2;

        const enemyTeam = player.team === 'red' ? 'blue' : 'red';
        const enemyFlag = this.state.flags[enemyTeam];

        // Check if player is at their BASE
        if (distance(player.x, player.y, baseX, baseY) < (CONFIG.PLAYER_SIZE + CONFIG.FLAG_SIZE)) {
            // CAPTURE!
            player.hasFlag = false;
            player.score += 1; // Legacy support
            player.flags = (player.flags || 0) + 1; // Explicit flag count

            enemyFlag.isHome = true;
            enemyFlag.x = enemyFlag.defX || (player.team === 'red' ? CONFIG.MAP_WIDTH - 80 : 80);
            enemyFlag.y = enemyFlag.defY || CONFIG.MAP_HEIGHT / 2;
            enemyFlag.carrier = null;

            this.broadcast('flagCapture', {
                playerId: player.id,
                team: player.team,
                score: player.flags
            });

            // Check win condition
            if (player.flags >= CONFIG.SCORE_TO_WIN) {
                this.endGame(player.id);
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

        clearInterval(this.gameLoop);

        setTimeout(() => {
            gameRooms.delete(this.roomId);
        }, 5000);
    }

    handleDisconnect(playerId) {
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

    socket.on('joinMatchmaking', () => {
        if (matchmakingQueue.find(s => s.id === socket.id)) return;

        for (const room of gameRooms.values()) {
            if (room.players.find(p => p.id === socket.id)) return;
        }

        matchmakingQueue.push(socket);
        socket.emit('matchmakingJoined', { position: matchmakingQueue.length });

        console.log(`Player ${socket.id} joined queue. Queue size: ${matchmakingQueue.length}`);

        if (matchmakingQueue.length >= 2) {
            const player1 = matchmakingQueue.shift();
            const player2 = matchmakingQueue.shift();

            const roomId = generateRoomId();
            const room = new GameRoom(roomId, player1, player2);
            gameRooms.set(roomId, room);

            console.log(`Match created: ${roomId} with ${player1.id} vs ${player2.id}`);
        }
    });

    socket.on('leaveMatchmaking', () => {
        matchmakingQueue = matchmakingQueue.filter(s => s.id !== socket.id);
        socket.emit('matchmakingLeft');
    });

    socket.on('playerInput', (input) => {
        for (const room of gameRooms.values()) {
            if (room.state.players[socket.id]) {
                room.handleInput(socket.id, input);
                break;
            }
        }
    });

    socket.on('playerShoot', (data) => {
        for (const room of gameRooms.values()) {
            if (room.state.players[socket.id]) {
                room.handleShoot(socket.id, data.angle);
                break;
            }
        }
    });

    // Ultimate start (SPACE pressed)
    socket.on('ultimateStart', (data) => {
        for (const room of gameRooms.values()) {
            if (room.state.players[socket.id]) {
                room.handleUltimateStart(socket.id, data.angle);
                break;
            }
        }
    });

    // Ultimate release (SPACE released)
    socket.on('ultimateRelease', (data) => {
        for (const room of gameRooms.values()) {
            if (room.state.players[socket.id]) {
                room.handleUltimateRelease(socket.id, data.angle);
                break;
            }
        }
    });

    // Send emoji (1-2-3-4 keys)
    socket.on('sendEmoji', (data) => {
        for (const room of gameRooms.values()) {
            if (room.state.players[socket.id]) {
                const player = room.state.players[socket.id];
                const emojiIndex = data.index;
                if (emojiIndex >= 0 && emojiIndex < CONFIG.EMOJIS.length) {
                    room.broadcast('playerEmoji', {
                        playerId: socket.id,
                        emoji: CONFIG.EMOJIS[emojiIndex],
                        x: player.x,
                        y: player.y
                    });
                }
                break;
            }
        }
    });

    socket.on('selectWeapon', (data) => {
        for (const room of gameRooms.values()) {
            if (room.state.players[socket.id]) {
                room.handleWeaponSelect(socket.id, data.weapon);
                break;
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);

        matchmakingQueue = matchmakingQueue.filter(s => s.id !== socket.id);

        for (const room of gameRooms.values()) {
            if (room.state.players[socket.id]) {
                room.handleDisconnect(socket.id);
                break;
            }
        }
    });
});

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
