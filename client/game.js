// ============================================
// CTF ARENA - Game Client
// ============================================

// Configuration
const SERVER_URL = 'https://ctf-game-server.onrender.com';

// Game State
let socket = null;
let gameState = null;
let myId = null;
let myTeam = null;
let config = null;
let isConnected = false;
let currentScreen = 'menu';
let myUltimateCharge = 0;

// Ultimate charging state
let isHoldingUltimate = false;
let ultimateHoldStart = 0;
let ultimateHoldProgress = 0;
let lastShotTime = 0;
let currentPing = 0;
let currentWeapon = 'pistol'; // Default local tracking
let lastInputSendTime = 0;
const INPUT_SEND_INTERVAL = 33;
let weaponConfig = {
    pistol: { cooldown: 500 },
    smg: { cooldown: 100 },
    m79: { cooldown: 1500 },
    sniper: { cooldown: 2000 }
};

// Canvas & Rendering
let canvas = null;
let ctx = null;

// Input State
const input = {
    up: false,
    down: false,
    left: false,
    right: false,
    angle: 0
};

// Mouse position
let mouseX = 0;
let mouseY = 0;
let isMouseDown = false;

// Assets & Effects
const particles = [];
const hitEffects = [];
const activeBeams = [];
const healthPickups = [];
const activeEmojis = [];
const activeExplosions = [];
const bulletTrails = [];

// Screen shake
let shakeIntensity = 0;
let shakeTime = 0;

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initCanvas();
    initSocket();
    initEventListeners();
    requestAnimationFrame(gameLoop);
});

function initCanvas() {
    canvas = document.getElementById('game-canvas');
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
    const maxWidth = window.innerWidth - 40;
    const maxHeight = window.innerHeight - 160;
    const aspectRatio = 1200 / 700;

    let width = Math.min(1200, maxWidth);
    let height = width / aspectRatio;

    if (height > maxHeight) {
        height = maxHeight;
        width = height * aspectRatio;
    }

    canvas.width = 1200;
    canvas.height = 700;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
}

function initSocket() {
    socket = io(SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5
    });

    socket.on('connect', () => {
        console.log('Connected to server');
        isConnected = true;
        updateConnectionStatus(true);

        // Start ping measurement
        setInterval(() => {
            const start = Date.now();
            socket.emit('ping', () => {
                currentPing = Date.now() - start;
                document.getElementById('ping-display').textContent = `📶 ${currentPing}ms`;
            });
        }, 2000);
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        isConnected = false;
        updateConnectionStatus(false);
    });

    socket.on('connect_error', (error) => {
        console.log('Connection error:', error);
        updateConnectionStatus(false, 'Bağlantı hatası');
    });

    socket.on('matchmakingJoined', (data) => {
        console.log('Joined matchmaking, position:', data.position);
        document.getElementById('queue-position').textContent =
            `Sıra: ${data.position}`;
    });

    socket.on('gameStart', (data) => {
        console.log('Game starting!', data);
        myId = data.yourId;
        gameState = data.state;
        config = data.config;
        myTeam = gameState.players[myId]?.team;
        myUltimateCharge = 0;
        healthPickups.length = 0;

        // Copy initial health pickups
        if (gameState.healthPickups) {
            healthPickups.push(...gameState.healthPickups);
        }

        showScreen('game');
        updateHUD();
        updateUltimateUI();
        document.getElementById('weapon-overlay').classList.add('active'); // Show weapon selection
    });

    socket.on('gameState', (data) => {
        gameState = data.state;

        // Sync health pickups
        healthPickups.length = 0;
        if (gameState.healthPickups) {
            healthPickups.push(...gameState.healthPickups);
        }

        updateTimer(data.timeLeft);
        updateHUD();
    });

    socket.on('healthPickupSpawned', (pickup) => {
        healthPickups.push(pickup);
        // Green particle effect
        addParticleEffect(pickup.x, pickup.y, '#00ff88', 15);
    });

    socket.on('healthPickedUp', (data) => {
        // Remove pickup from local list
        const index = healthPickups.findIndex(p => p.id === data.pickupId);
        if (index !== -1) {
            const pickup = healthPickups[index];
            addParticleEffect(pickup.x, pickup.y, '#00ff88', 20);
            healthPickups.splice(index, 1);
        }

        if (data.playerId === myId) {
            updateHealth(data.newHealth);
        }
    });

    socket.on('playerHit', (data) => {
        if (data.playerId === myId) {
            updateHealth(data.health);
            shakeScreen(data.isUltimate ? 15 : 8);
        }
        const player = gameState?.players[data.playerId];
        if (player) {
            addHitEffect(player.x, player.y);
            if (data.isUltimate) {
                for (let i = 0; i < 30; i++) {
                    addParticleEffect(player.x, player.y, '#ff0000', 20);
                }
            }
        }
    });

    socket.on('playerRespawn', (data) => {
        if (data.playerId === myId) {
            updateHealth(100);
            document.getElementById('weapon-overlay').classList.add('active'); // Show weapon selection on respawn
        }
    });

    socket.on('flagPickup', (data) => {
        if (data.playerId === myId) {
            document.getElementById('flag-indicator').style.display = 'block';
        }
        addParticleEffect(
            gameState.flags[data.flagTeam].x,
            gameState.flags[data.flagTeam].y,
            data.flagTeam === 'red' ? '#ff3366' : '#00ccff'
        );
    });

    socket.on('flagReturned', (data) => {
        // Big celebration effect for flag return
        const flag = gameState.flags[data.flagTeam];
        const color = data.flagTeam === 'red' ? '#ff3366' : '#00ccff';
        for (let i = 0; i < 25; i++) {
            addParticleEffect(flag.x, flag.y, color, 2);
        }
        addParticleEffect(flag.x, flag.y, '#ffffff', 10);
    });

    socket.on('flagCapture', (data) => {
        if (data.playerId === myId) {
            document.getElementById('flag-indicator').style.display = 'none';
        }
        for (let i = 0; i < 30; i++) {
            particles.push({
                x: config.MAP_WIDTH / 2,
                y: config.MAP_HEIGHT / 2,
                vx: (Math.random() - 0.5) * 15,
                vy: (Math.random() - 0.5) * 15,
                life: 60,
                color: data.team === 'red' ? '#ff3366' : '#00ccff',
                size: Math.random() * 8 + 4
            });
        }
    });

    socket.on('ultimateCharge', (data) => {
        if (data.playerId === myId) {
            myUltimateCharge = data.charge;
            updateUltimateUI();
        }
    });

    socket.on('ultimateCharging', (data) => {
        console.log('Player charging ultimate:', data.playerId);
        // Show charging indicator on player
        if (gameState?.players[data.playerId]) {
            gameState.players[data.playerId].isChargingUltimate = true;
        }
    });

    socket.on('ultimateCancelled', (data) => {
        if (gameState?.players[data.playerId]) {
            gameState.players[data.playerId].isChargingUltimate = false;
        }
        if (data.playerId === myId) {
            isHoldingUltimate = false;
            ultimateHoldProgress = 0;
        }
    });

    socket.on('playerEmoji', (data) => {
        activeEmojis.push({
            x: data.x,
            y: data.y,
            emoji: data.emoji,
            startTime: Date.now(),
            offsetY: 0
        });
    });

    socket.on('explosion', (data) => {
        // Add explosion visual
        activeExplosions.push({
            x: data.x,
            y: data.y,
            maxRadius: data.radius,
            radius: 5,
            alpha: 1,
            life: 30
        });

        // Add particles
        for (let i = 0; i < 20; i++) {
            particles.push({
                x: data.x,
                y: data.y,
                vx: (Math.random() - 0.5) * 10,
                vy: (Math.random() - 0.5) * 10,
                life: 40,
                color: Math.random() > 0.5 ? '#ff9900' : '#ff3300',
                size: Math.random() * 6 + 2
            });
        }

        // Screen shake if close
        if (myId && gameState?.players[myId]) {
            const player = gameState.players[myId];
            const dist = Math.hypot(player.x - data.x, player.y - data.y);
            if (dist < 500) {
                shakeScreen(Math.max(5, 20 - dist / 25));
            }
        }
    });

    socket.on('ultimateFired', (data) => {
        console.log('Ultimate fired!', data);

        if (gameState?.players[data.playerId]) {
            gameState.players[data.playerId].isChargingUltimate = false;
        }

        // Add beam to visual effects
        activeBeams.push({
            ...data.beam,
            firedTime: Date.now()
        });

        // Big screen shake
        shakeScreen(20);

        // Add beam particles
        const color = data.beam.team === 'red' ? '#ff3366' : '#00ccff';
        for (let i = 0; i < 50; i++) {
            const t = Math.random();
            const x = data.beam.startX + (data.beam.endX - data.beam.startX) * t;
            const y = data.beam.startY + (data.beam.endY - data.beam.startY) * t;
            addParticleEffect(x, y, color, 2);
        }

        if (data.playerId === myId) {
            isHoldingUltimate = false;
            ultimateHoldProgress = 0;
        }
    });

    socket.on('gameOver', (data) => {
        console.log('Game over!', data);
        gameState = data.finalState;
        showGameOver(data.winner);
    });
}

function initEventListeners() {
    document.getElementById('play-btn').addEventListener('click', joinMatchmaking);
    document.getElementById('cancel-matchmaking').addEventListener('click', leaveMatchmaking);
    document.getElementById('play-again-btn').addEventListener('click', () => {
        showScreen('menu');
    });

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // Mouse events on document for better control
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('blur', resetInput);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            resetInput();
        }
    });
}

function resetInput() {
    input.up = false;
    input.down = false;
    input.left = false;
    input.right = false;

    // Cancel ultimate if holding
    if (isHoldingUltimate) {
        isHoldingUltimate = false;
        ultimateHoldProgress = 0;
        socket.emit('ultimateRelease', { angle: input.angle });
    }
}

// ============================================
// SCREEN MANAGEMENT
// ============================================

function showScreen(screenName) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(`${screenName}-screen`).classList.add('active');
    currentScreen = screenName;
}

function updateConnectionStatus(connected, customText = null) {
    const statusEl = document.getElementById('connection-status');
    const dotEl = statusEl.querySelector('.status-dot');
    const textEl = statusEl.querySelector('.status-text');

    if (connected) {
        dotEl.className = 'status-dot connected';
        textEl.textContent = 'Sunucuya bağlı';
    } else {
        dotEl.className = 'status-dot disconnected';
        textEl.textContent = customText || 'Bağlantı kesildi';
    }
}

// ============================================
// MATCHMAKING
// ============================================

function joinMatchmaking() {
    if (!isConnected) {
        alert('Sunucuya bağlı değil! Lütfen bekleyin...');
        return;
    }

    showScreen('matchmaking');
    socket.emit('joinMatchmaking');
}

function leaveMatchmaking() {
    socket.emit('leaveMatchmaking');
    showScreen('menu');
}

// ============================================
// INPUT HANDLING
// ============================================

function handleKeyDown(e) {
    if (currentScreen !== 'game') return;

    switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
            input.up = true;
            break;
        case 'KeyS':
        case 'ArrowDown':
            input.down = true;
            break;
        case 'KeyA':
        case 'ArrowLeft':
            input.left = true;
            break;
        case 'KeyD':
        case 'ArrowRight':
            input.right = true;
            break;
        case 'Space':
            e.preventDefault();
            if (!isHoldingUltimate && myUltimateCharge >= 100) {
                startUltimate();
            }
            break;
        case 'Digit1':
            socket.emit('sendEmoji', { index: 0 });
            break;
        case 'Digit2':
            socket.emit('sendEmoji', { index: 1 });
            break;
        case 'Digit3':
            socket.emit('sendEmoji', { index: 2 });
            break;
        case 'Digit4':
            socket.emit('sendEmoji', { index: 3 });
            break;
    }
}

function handleKeyUp(e) {
    switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
            input.up = false;
            break;
        case 'KeyS':
        case 'ArrowDown':
            input.down = false;
            break;
        case 'KeyA':
        case 'ArrowLeft':
            input.left = false;
            break;
        case 'KeyD':
        case 'ArrowRight':
            input.right = false;
            break;
        case 'Space':
            if (isHoldingUltimate) {
                releaseUltimate();
            }
            break;
    }
}

function handleMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Calculate mouse position relative to canvas, even when outside
    mouseX = (e.clientX - rect.left) * scaleX;
    mouseY = (e.clientY - rect.top) * scaleY;

    // Clamp to canvas bounds for aiming calculation
    const clampedX = Math.max(0, Math.min(canvas.width, mouseX));
    const clampedY = Math.max(0, Math.min(canvas.height, mouseY));

    const player = gameState?.players[myId];
    if (player) {
        // Use clamped values for angle calculation
        input.angle = Math.atan2(clampedY - player.y, clampedX - player.x);
    }
}

function handleMouseDown(e) {
    if (currentScreen !== 'game') return;
    if (document.getElementById('weapon-overlay').classList.contains('active')) return;

    if (e.button === 0) {
        if (!isHoldingUltimate) {
            isMouseDown = true;
            shoot(); // Immediate shot
        }
    }
}

function handleMouseUp(e) {
    if (currentScreen !== 'game') return;
    if (e.button === 0) {
        isMouseDown = false;

        // Release ultimate if holding
        if (isHoldingUltimate) {
            releaseUltimate();
        }
    }
}

function shoot() {
    if (!gameState || !myId) return;
    const player = gameState.players[myId];
    if (!player || player.isDead) return;
    if (player.isChargingUltimate) return;

    if (config?.WEAPONS) {
        // Use server config if available to keep sync, else fallback
        const weapon = config.WEAPONS[currentWeapon] || weaponConfig[currentWeapon];
        const now = Date.now();
        if (now - lastShotTime < weapon.cooldown) return;
        lastShotTime = now;
    } else {
        // Fallback checks
        const weapon = weaponConfig[currentWeapon];
        const now = Date.now();
        if (now - lastShotTime < weapon.cooldown) return;
        lastShotTime = now;
    }

    socket.emit('playerShoot', { angle: input.angle });

    const muzzleX = player.x + Math.cos(input.angle) * 20;
    const muzzleY = player.y + Math.sin(input.angle) * 20;
    addParticleEffect(muzzleX, muzzleY, '#ffff00', 5);

    // Add slight recoil shaking
    shakeScreen(currentWeapon === 'smg' ? 2 : 5);
}

function startUltimate() {
    if (!gameState || !myId) return;
    const player = gameState.players[myId];
    if (!player || player.isDead) return;
    if (myUltimateCharge < 100) return;

    isHoldingUltimate = true;
    ultimateHoldStart = Date.now();
    ultimateHoldProgress = 0;

    socket.emit('ultimateStart', { angle: input.angle });
}

function releaseUltimate() {
    isHoldingUltimate = false;
    socket.emit('ultimateRelease', { angle: input.angle });
    ultimateHoldProgress = 0;
}

// ============================================
// GAME LOOP
// ============================================

function gameLoop() {
    if (currentScreen === 'game' && gameState) {
        // Update ultimate hold progress
        if (isHoldingUltimate) {
            const holdTime = Date.now() - ultimateHoldStart;
            ultimateHoldProgress = Math.min(100, (holdTime / (config?.ULTIMATE_HOLD_TIME || 1500)) * 100);
        }

        // Handle SMG Autofire
        if (isMouseDown && currentWeapon === 'smg' && !isHoldingUltimate) {
            shoot();
        }

        // Send input to server at controlled rate (prevents network spam)
        const now = Date.now();
        if (now - lastInputSendTime >= INPUT_SEND_INTERVAL) {
            socket.emit('playerInput', input);
            lastInputSendTime = now;
        }

        // Render
        render();

        // Update effects
        updateParticles();
        updateHitEffects();
        updateBeams();
        updateShake();
        updateEmojis();
        updateExplosions();
        updateBulletTrails();
    }

    requestAnimationFrame(gameLoop);
}

// ============================================
// RENDERING
// ============================================

function render() {
    if (!ctx || !gameState || !config) return;

    // Apply screen shake
    ctx.save();
    if (shakeIntensity > 0) {
        const offsetX = (Math.random() - 0.5) * shakeIntensity * 2;
        const offsetY = (Math.random() - 0.5) * shakeIntensity * 2;
        ctx.translate(offsetX, offsetY);
    }

    // Clear canvas
    ctx.fillStyle = '#0d0d15';
    ctx.fillRect(-20, -20, config.MAP_WIDTH + 40, config.MAP_HEIGHT + 40);

    // Draw grid
    drawGrid();

    // Draw team zones
    drawTeamZones();

    // Draw obstacles
    drawObstacles();

    // Draw health pickups
    drawHealthPickups();

    // Draw flags
    drawFlags();

    // Draw ultimate charging preview (if holding)
    if (isHoldingUltimate && myId && gameState.players[myId]) {
        drawUltimatePreview();
    }

    // Draw ultimate beams
    drawBeams();

    // Draw bullets
    drawBullets();

    // Draw players
    drawPlayers();

    // Draw particles
    drawParticles();

    // Draw hit effects
    drawHitEffects();

    // Draw bullet trails
    drawBulletTrails();

    // Draw explosions
    drawExplosions();

    // Draw active emojis
    drawEmojis();

    // Draw crosshair
    drawCrosshair();

    // Draw reload indicator
    drawReloadIndicator();

    // Draw ultimate hold bar (if charging)
    if (isHoldingUltimate) {
        drawUltimateHoldBar();
    }

    ctx.restore();
}

function drawGrid() {
    ctx.strokeStyle = 'rgba(153, 51, 255, 0.1)';
    ctx.lineWidth = 1;

    for (let x = 0; x <= config.MAP_WIDTH; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, config.MAP_HEIGHT);
        ctx.stroke();
    }

    for (let y = 0; y <= config.MAP_HEIGHT; y += 50) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(config.MAP_WIDTH, y);
        ctx.stroke();
    }
}

function drawTeamZones() {
    const gradient1 = ctx.createLinearGradient(0, 0, 150, 0);
    gradient1.addColorStop(0, 'rgba(255, 51, 102, 0.2)');
    gradient1.addColorStop(1, 'rgba(255, 51, 102, 0)');
    ctx.fillStyle = gradient1;
    ctx.fillRect(0, 0, 150, config.MAP_HEIGHT);

    const gradient2 = ctx.createLinearGradient(config.MAP_WIDTH - 150, 0, config.MAP_WIDTH, 0);
    gradient2.addColorStop(0, 'rgba(0, 204, 255, 0)');
    gradient2.addColorStop(1, 'rgba(0, 204, 255, 0.2)');
    ctx.fillStyle = gradient2;
    ctx.fillRect(config.MAP_WIDTH - 150, 0, 150, config.MAP_HEIGHT);

    ctx.strokeStyle = 'rgba(255, 51, 102, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 5]);
    ctx.beginPath();
    ctx.moveTo(150, 0);
    ctx.lineTo(150, config.MAP_HEIGHT);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 204, 255, 0.5)';
    ctx.beginPath();
    ctx.moveTo(config.MAP_WIDTH - 150, 0);
    ctx.lineTo(config.MAP_WIDTH - 150, config.MAP_HEIGHT);
    ctx.stroke();

    ctx.setLineDash([]);
}

function drawObstacles() {
    gameState.obstacles.forEach(obs => {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(obs.x + 5, obs.y + 5, obs.width, obs.height);

        const gradient = ctx.createLinearGradient(obs.x, obs.y, obs.x + obs.width, obs.y + obs.height);
        gradient.addColorStop(0, '#2a2a40');
        gradient.addColorStop(1, '#1a1a2e');
        ctx.fillStyle = gradient;
        ctx.fillRect(obs.x, obs.y, obs.width, obs.height);

        ctx.strokeStyle = 'rgba(153, 51, 255, 0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(obs.x, obs.y, obs.width, obs.height);

        ctx.shadowColor = 'rgba(153, 51, 255, 0.3)';
        ctx.shadowBlur = 10;
        ctx.strokeRect(obs.x, obs.y, obs.width, obs.height);
        ctx.shadowBlur = 0;
    });
}

function drawHealthPickups() {
    const now = Date.now();

    healthPickups.forEach(pickup => {
        const pulse = 1 + Math.sin(now / 200) * 0.15;
        const size = 20 * pulse;

        // Glow
        ctx.shadowColor = 'rgba(0, 255, 136, 0.8)';
        ctx.shadowBlur = 20;

        // Cross shape
        ctx.fillStyle = '#00ff88';
        ctx.fillRect(pickup.x - size / 2, pickup.y - size / 6, size, size / 3);
        ctx.fillRect(pickup.x - size / 6, pickup.y - size / 2, size / 3, size);

        // White center
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(pickup.x - size / 6, pickup.y - size / 6, size / 3, size / 3);

        ctx.shadowBlur = 0;

        // Floating particles
        if (Math.random() < 0.1) {
            addParticleEffect(pickup.x, pickup.y, '#00ff88', 1);
        }
    });
}

function drawFlags() {
    ['red', 'blue'].forEach(team => {
        const flag = gameState.flags[team];
        const color = team === 'red' ? '#ff3366' : '#00ccff';
        const glowColor = team === 'red' ? 'rgba(255, 51, 102, 0.5)' : 'rgba(0, 204, 255, 0.5)';

        if (flag.carrier) return;

        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 20;

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(flag.x, flag.y + 15);
        ctx.lineTo(flag.x, flag.y - 20);
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(flag.x, flag.y - 20);
        ctx.lineTo(flag.x + 25, flag.y - 10);
        ctx.lineTo(flag.x, flag.y);
        ctx.closePath();
        ctx.fill();

        if (flag.isHome) {
            ctx.strokeStyle = glowColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(flag.x, flag.y, 35, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.shadowBlur = 0;
    });
}

function drawUltimatePreview() {
    const player = gameState.players[myId];
    if (!player) return;

    const angle = input.angle;
    const rayLength = 2000;
    const endX = player.x + Math.cos(angle) * rayLength;
    const endY = player.y + Math.sin(angle) * rayLength;

    const color = player.team === 'red' ? '#ff3366' : '#00ccff';
    const progress = ultimateHoldProgress / 100;
    const pulse = 0.5 + Math.sin(Date.now() / 50) * 0.3;
    const width = 5 + progress * 20;

    ctx.globalAlpha = (0.2 + progress * 0.5) * pulse;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.setLineDash([20, 10]);
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Warning text
    if (progress < 100) {
        ctx.fillStyle = color;
        ctx.font = 'bold 20px Orbitron';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.floor(progress)}%`, player.x, player.y - 50);
    } else {
        ctx.fillStyle = '#ffcc00';
        ctx.font = 'bold 24px Orbitron';
        ctx.textAlign = 'center';
        ctx.fillText('RELEASE!', player.x, player.y - 50);
    }
}

function drawUltimateHoldBar() {
    // Center bar at top of screen
    const barWidth = 300;
    const barHeight = 20;
    const x = config.MAP_WIDTH / 2 - barWidth / 2;
    const y = 50;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(x - 5, y - 5, barWidth + 10, barHeight + 10);

    // Border
    ctx.strokeStyle = ultimateHoldProgress >= 100 ? '#ffcc00' : '#9933ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 5, y - 5, barWidth + 10, barHeight + 10);

    // Fill
    const fillWidth = (ultimateHoldProgress / 100) * barWidth;
    const gradient = ctx.createLinearGradient(x, y, x + fillWidth, y);

    if (ultimateHoldProgress >= 100) {
        gradient.addColorStop(0, '#ffcc00');
        gradient.addColorStop(1, '#ff9900');
    } else {
        gradient.addColorStop(0, '#9933ff');
        gradient.addColorStop(1, '#ff3366');
    }

    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, fillWidth, barHeight);

    // Text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px Orbitron';
    ctx.textAlign = 'center';
    ctx.fillText(ultimateHoldProgress >= 100 ? '⚡ RELEASE SPACE! ⚡' : 'CHARGING...', config.MAP_WIDTH / 2, y + 14);
}

function drawBeams() {
    const now = Date.now();

    activeBeams.forEach(beam => {
        const fadeElapsed = now - beam.firedTime;
        const fadeProgress = Math.min(1, fadeElapsed / 500);
        const alpha = 1 - fadeProgress;

        if (alpha > 0) {
            const color = beam.team === 'red' ? '#ff3366' : '#00ccff';

            ctx.globalAlpha = alpha;

            // White core
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 30 * alpha;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(beam.startX, beam.startY);
            ctx.lineTo(beam.endX, beam.endY);
            ctx.stroke();

            // Colored outer
            ctx.strokeStyle = color;
            ctx.lineWidth = 15 * alpha;
            ctx.beginPath();
            ctx.moveTo(beam.startX, beam.startY);
            ctx.lineTo(beam.endX, beam.endY);
            ctx.stroke();

            ctx.globalAlpha = 1;
        }
    });
}

function updateBeams() {
    const now = Date.now();
    for (let i = activeBeams.length - 1; i >= 0; i--) {
        const beam = activeBeams[i];
        const fadeElapsed = now - beam.firedTime;
        if (fadeElapsed > 500) {
            activeBeams.splice(i, 1);
        }
    }
}

function drawBullets() {
    gameState.bullets.forEach(bullet => {
        const color = bullet.team === 'red' ? '#ff3366' : '#00ccff';

        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(bullet.x - bullet.velocityX * 2, bullet.y - bullet.velocityY * 2);
        ctx.lineTo(bullet.x, bullet.y);
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    });
}

function drawPlayers() {
    Object.values(gameState.players).forEach(player => {
        if (player.isDead) {
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = player.team === 'red' ? '#ff3366' : '#00ccff';
            ctx.beginPath();
            ctx.arc(player.x, player.y, 15, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            return;
        }

        const isMe = player.id === myId;
        const color = player.team === 'red' ? '#ff3366' : '#00ccff';
        const darkColor = player.team === 'red' ? '#cc2952' : '#0099cc';

        ctx.shadowColor = color;
        ctx.shadowBlur = isMe ? 20 : 10;

        const gradient = ctx.createRadialGradient(
            player.x, player.y, 0,
            player.x, player.y, 15
        );
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, darkColor);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(player.x, player.y, 15, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = isMe ? '#ffffff' : 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = isMe ? 3 : 2;
        ctx.beginPath();
        ctx.arc(player.x, player.y, 15, 0, Math.PI * 2);
        ctx.stroke();

        ctx.shadowBlur = 0;

        // Charging indicator with shimmer
        if (player.isChargingUltimate || (isMe && isHoldingUltimate)) {
            const progress = isMe ? ultimateHoldProgress : (player.ultimateHoldProgress || 0);
            const pulseSize = 25 + Math.sin(Date.now() / 50) * 5;

            ctx.strokeStyle = progress >= 100 ? '#ffcc00' : '#9933ff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(player.x, player.y, pulseSize, 0, Math.PI * 2);
            ctx.stroke();

            // Electric effect
            if (Math.random() < 0.3) {
                const sparkAngle = Math.random() * Math.PI * 2;
                const sparkDist = 20 + Math.random() * 10;
                addParticleEffect(
                    player.x + Math.cos(sparkAngle) * sparkDist,
                    player.y + Math.sin(sparkAngle) * sparkDist,
                    '#ffcc00', 1
                );
            }
        }

        // Gun
        const gunLength = 25;
        const gunX = player.x + Math.cos(player.angle) * gunLength;
        const gunY = player.y + Math.sin(player.angle) * gunLength;

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(player.x + Math.cos(player.angle) * 10, player.y + Math.sin(player.angle) * 10);
        ctx.lineTo(gunX, gunY);
        ctx.stroke();

        // Flag on player
        if (player.hasFlag) {
            const enemyTeam = player.team === 'red' ? 'blue' : 'red';
            const flagColor = enemyTeam === 'red' ? '#ff3366' : '#00ccff';

            ctx.fillStyle = flagColor;
            ctx.beginPath();
            ctx.moveTo(player.x - 5, player.y - 25);
            ctx.lineTo(player.x + 15, player.y - 35);
            ctx.lineTo(player.x - 5, player.y - 45);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(player.x - 5, player.y - 20);
            ctx.lineTo(player.x - 5, player.y - 50);
            ctx.stroke();
        }

        // Health bar
        const healthWidth = 40;
        const healthHeight = 6;
        const healthX = player.x - healthWidth / 2;
        const healthY = player.y + 25;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(healthX, healthY, healthWidth, healthHeight);

        const healthPercent = player.health / 100;
        const healthColor = healthPercent > 0.5 ? '#00ff88' :
            healthPercent > 0.25 ? '#ffcc00' : '#ff3366';
        ctx.fillStyle = healthColor;
        ctx.fillRect(healthX, healthY, healthWidth * healthPercent, healthHeight);

        ctx.strokeStyle = isMe ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = isMe ? 2 : 1;
        ctx.strokeRect(healthX, healthY, healthWidth, healthHeight);

        // Ultimate charge indicator
        const ultCharge = player.ultimateCharge || 0;
        if (ultCharge > 0) {
            const ultY = healthY + healthHeight + 3;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(healthX, ultY, healthWidth, 3);
            ctx.fillStyle = ultCharge >= 100 ? '#ffcc00' : '#9933ff';
            ctx.fillRect(healthX, ultY, healthWidth * (ultCharge / 100), 3);
        }
    });
}

function drawCrosshair() {
    const size = 15;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(mouseX - size, mouseY);
    ctx.lineTo(mouseX - 5, mouseY);
    ctx.moveTo(mouseX + 5, mouseY);
    ctx.lineTo(mouseX + size, mouseY);
    ctx.moveTo(mouseX, mouseY - size);
    ctx.lineTo(mouseX, mouseY - 5);
    ctx.moveTo(mouseX, mouseY + 5);
    ctx.lineTo(mouseX, mouseY + size);
    ctx.stroke();

    // Center dot - changes when ultimate ready or charging
    if (isHoldingUltimate) {
        ctx.fillStyle = ultimateHoldProgress >= 100 ? '#ffcc00' : '#9933ff';
        ctx.beginPath();
        ctx.arc(mouseX, mouseY, 6, 0, Math.PI * 2);
        ctx.fill();
    } else if (myUltimateCharge >= 100) {
        ctx.fillStyle = '#ffcc00';
        ctx.beginPath();
        ctx.arc(mouseX, mouseY, 4, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.fillStyle = '#ff3366';
        ctx.beginPath();
        ctx.arc(mouseX, mouseY, 2, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ============================================
// PARTICLES & EFFECTS
// ============================================

function addParticleEffect(x, y, color, count = 10) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 8,
            vy: (Math.random() - 0.5) * 8,
            life: 30 + Math.random() * 20,
            color: color,
            size: Math.random() * 5 + 2
        });
    }
}

function addHitEffect(x, y) {
    hitEffects.push({
        x: x,
        y: y,
        radius: 5,
        maxRadius: 30,
        life: 15
    });
}

function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.95;
        p.vy *= 0.95;
        p.life--;

        if (p.life <= 0) {
            particles.splice(i, 1);
        }
    }
}

function updateHitEffects() {
    for (let i = hitEffects.length - 1; i >= 0; i--) {
        const e = hitEffects[i];
        e.radius += (e.maxRadius - e.radius) * 0.3;
        e.life--;

        if (e.life <= 0) {
            hitEffects.splice(i, 1);
        }
    }
}

function drawParticles() {
    particles.forEach(p => {
        ctx.globalAlpha = p.life / 50;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1;
}

function drawHitEffects() {
    hitEffects.forEach(e => {
        ctx.globalAlpha = e.life / 15;
        ctx.strokeStyle = '#ff3366';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
        ctx.stroke();
    });
    ctx.globalAlpha = 1;
}

function shakeScreen(intensity = 10) {
    shakeIntensity = intensity;
    shakeTime = Date.now();
}

function updateShake() {
    if (shakeIntensity > 0) {
        const elapsed = Date.now() - shakeTime;
        const duration = 300;
        shakeIntensity = Math.max(0, shakeIntensity * (1 - elapsed / duration));
    }
}

// ============================================
// HUD UPDATES
// ============================================

function updateHUD() {
    if (!gameState) return;

    let redScore = 0;
    let blueScore = 0;
    let redKills = 0;
    let blueKills = 0;

    Object.values(gameState.players).forEach(player => {
        if (player.team === 'red') {
            redScore = player.flags || 0;
            redKills += player.kills || 0;
        } else {
            blueScore = player.flags || 0;
            blueKills += player.kills || 0;
        }
    });

    document.getElementById('red-score').textContent = redScore;
    document.getElementById('blue-score').textContent = blueScore;
    document.getElementById('red-kills').textContent = `⚔️ ${redKills}`;
    document.getElementById('blue-kills').textContent = `⚔️ ${blueKills}`;

    const myPlayer = gameState.players[myId];
    if (myPlayer) {
        updateHealth(myPlayer.health);
        myUltimateCharge = myPlayer.ultimateCharge || 0;
        updateUltimateUI();

        document.getElementById('flag-indicator').style.display =
            myPlayer.hasFlag ? 'block' : 'none';
    }
}

function updateHealth(health) {
    document.getElementById('health-fill').style.width = health + '%';
    document.getElementById('health-text').textContent = health;

    const healthFill = document.getElementById('health-fill');
    if (health > 50) {
        healthFill.style.background = 'linear-gradient(90deg, #00ff88, #00cc66)';
    } else if (health > 25) {
        healthFill.style.background = 'linear-gradient(90deg, #ffcc00, #ff9900)';
    } else {
        healthFill.style.background = 'linear-gradient(90deg, #ff3366, #ff0044)';
    }
}

function updateUltimateUI() {
    const ultBar = document.getElementById('ultimate-bar');
    const ultFill = document.getElementById('ultimate-fill');
    const ultText = document.getElementById('ultimate-text');

    if (ultFill && ultText) {
        ultFill.style.width = myUltimateCharge + '%';
        ultText.textContent = myUltimateCharge >= 100 ? 'SPACE BASILI TUT!' : `${Math.floor(myUltimateCharge)}%`;

        if (myUltimateCharge >= 100) {
            ultFill.style.background = 'linear-gradient(90deg, #ffcc00, #ff9900)';
            ultBar.classList.add('ready');
        } else {
            ultFill.style.background = 'linear-gradient(90deg, #9933ff, #6600cc)';
            ultBar.classList.remove('ready');
        }
    }
}

function updateTimer(timeLeft) {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    document.getElementById('game-timer').textContent =
        `${minutes}:${seconds.toString().padStart(2, '0')}`;

    if (timeLeft <= 30) {
        document.getElementById('game-timer').style.color = '#ff3366';
        document.getElementById('game-timer').style.animation = 'pulse 0.5s infinite';
    }
}

// ============================================
// GAME OVER
// ============================================

function showGameOver(winner) {
    showScreen('gameover');

    const resultIcon = document.getElementById('result-icon');
    const resultTitle = document.getElementById('result-title');
    const resultSubtitle = document.getElementById('result-subtitle');

    if (winner === 'tie') {
        resultIcon.textContent = '🤝';
        resultTitle.textContent = 'BERABERE!';
        resultTitle.className = 'result-title tie';
        resultSubtitle.textContent = 'İyi mücadele!';
    } else if (winner === myId) {
        resultIcon.textContent = '🏆';
        resultTitle.textContent = 'KAZANDIN!';
        resultTitle.className = 'result-title win';
        resultSubtitle.textContent = 'Tebrikler, şampiyon!';
    } else {
        resultIcon.textContent = '😔';
        resultTitle.textContent = 'KAYBETTİN';
        resultTitle.className = 'result-title lose';
        resultSubtitle.textContent = 'Bir dahaki sefere!';
    }

    let redScore = 0;
    let blueScore = 0;
    Object.values(gameState.players).forEach(player => {
        if (player.team === 'red') redScore = player.flags || 0;
        else blueScore = player.flags || 0;
    });

    document.getElementById('final-red-score').textContent = redScore;
    document.getElementById('final-blue-score').textContent = blueScore;
}

// ============================================
// EMOJI SYSTEM
// ============================================

function drawEmojis() {
    ctx.textAlign = 'center';
    ctx.font = '30px Arial';

    activeEmojis.forEach(emoji => {
        ctx.fillStyle = `rgba(255, 255, 255, ${1 - (Date.now() - emoji.startTime) / 2000})`;
        ctx.fillText(emoji.emoji, emoji.x, emoji.y - 40 - emoji.offsetY);
    });
}

function updateEmojis() {
    const now = Date.now();
    for (let i = activeEmojis.length - 1; i >= 0; i--) {
        const emoji = activeEmojis[i];
        const elapsed = now - emoji.startTime;

        if (elapsed > 2000) {
            activeEmojis.splice(i, 1);
        } else {
            // Float up logic
            emoji.offsetY += 0.5;
        }
    }
}

// ============================================
// VISUAL EFFECTS SYSTEM
// ============================================

function updateExplosions() {
    for (let i = activeExplosions.length - 1; i >= 0; i--) {
        const exp = activeExplosions[i];
        exp.radius += (exp.maxRadius - exp.radius) * 0.15;
        exp.alpha = exp.life / 30;
        exp.life--;

        if (exp.life <= 0) {
            activeExplosions.splice(i, 1);
        }
    }
}

function updateBulletTrails() {
    // Add new trails for sniper bullets
    if (gameState && gameState.bullets) {
        gameState.bullets.forEach(bullet => {
            if (bullet.type === 'sniper') {
                // Create visual trail segment
                bulletTrails.push({
                    x: bullet.x,
                    y: bullet.y,
                    life: 20 // Short life
                });
            }
        });
    }

    // Update existing trails
    for (let i = bulletTrails.length - 1; i >= 0; i--) {
        const trail = bulletTrails[i];
        trail.life--;
        if (trail.life <= 0) {
            bulletTrails.splice(i, 1);
        }
    }
}

function drawExplosions() {
    activeExplosions.forEach(exp => {
        ctx.save();
        ctx.globalAlpha = exp.alpha;

        // Shockwave
        ctx.beginPath();
        ctx.arc(exp.x, exp.y, exp.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 100, 50, 0.3)';
        ctx.fill();
        ctx.strokeStyle = '#ffcc00';
        ctx.lineWidth = 4;
        ctx.stroke();

        // Inner fire
        ctx.beginPath();
        ctx.arc(exp.x, exp.y, exp.radius * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 50, 0, 0.5)';
        ctx.fill();

        ctx.restore();
    });
}

function drawBulletTrails() {
    bulletTrails.forEach(trail => {
        ctx.save();
        ctx.globalAlpha = trail.life / 20;
        ctx.fillStyle = '#aaaaaa';
        ctx.beginPath();
        ctx.arc(trail.x, trail.y, 4, 0, Math.PI * 2); // Simple dot trail for now, simpler effectively
        ctx.fill();
        ctx.restore();
    });
}

// ============================================
// WEAPON SYSTEM
// ============================================

window.selectWeapon = function (weaponType) {
    if (!socket) return;
    currentWeapon = weaponType;
    socket.emit('selectWeapon', { weapon: weaponType });
    document.getElementById('weapon-overlay').classList.remove('active');
};

function drawReloadIndicator() {
    if (!config?.WEAPONS || !myId || !gameState?.players[myId]) return;
    if (gameState.players[myId].isDead) return;

    // Use server config if available, else local fallback
    const weapon = config.WEAPONS[currentWeapon] || weaponConfig[currentWeapon];
    if (!weapon) return;

    const now = Date.now();
    const elapsed = now - lastShotTime;

    if (elapsed < weapon.cooldown) {
        // Draw reload circle near cursor/player
        const percent = elapsed / weapon.cooldown;
        const radius = 15;

        ctx.beginPath();
        ctx.arc(mouseX, mouseY + 30, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(mouseX, mouseY + 30, radius, -Math.PI / 2, (-Math.PI / 2) + (Math.PI * 2 * percent));
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 3;
        ctx.stroke();
    }
}
