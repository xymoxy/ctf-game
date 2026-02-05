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

// Assets & Effects
const particles = [];
const hitEffects = [];

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
    // Max size while maintaining aspect ratio
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

        showScreen('game');
        updateHUD();
    });

    socket.on('gameState', (data) => {
        gameState = data.state;
        updateTimer(data.timeLeft);
        updateHUD();
    });

    socket.on('playerHit', (data) => {
        if (data.playerId === myId) {
            updateHealth(data.health);
            shakeScreen();
        }
        // Add hit effect
        const player = gameState?.players[data.playerId];
        if (player) {
            addHitEffect(player.x, player.y);
        }
    });

    socket.on('playerRespawn', (data) => {
        if (data.playerId === myId) {
            updateHealth(100);
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

    socket.on('flagCapture', (data) => {
        if (data.playerId === myId) {
            document.getElementById('flag-indicator').style.display = 'none';
        }
        // Celebration particles
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

    socket.on('gameOver', (data) => {
        console.log('Game over!', data);
        gameState = data.finalState;
        showGameOver(data.winner);
    });
}

function initEventListeners() {
    // Menu buttons
    document.getElementById('play-btn').addEventListener('click', joinMatchmaking);
    document.getElementById('cancel-matchmaking').addEventListener('click', leaveMatchmaking);
    document.getElementById('play-again-btn').addEventListener('click', () => {
        showScreen('menu');
    });

    // Keyboard controls
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // Mouse controls
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Fix: Reset input when window loses focus (alt-tab, tab switch)
    window.addEventListener('blur', resetInput);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            resetInput();
        }
    });
}

// Reset all input keys
function resetInput() {
    input.up = false;
    input.down = false;
    input.left = false;
    input.right = false;
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
    }
}

function handleMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    mouseX = (e.clientX - rect.left) * scaleX;
    mouseY = (e.clientY - rect.top) * scaleY;

    // Calculate angle from player to mouse
    const player = gameState?.players[myId];
    if (player) {
        input.angle = Math.atan2(mouseY - player.y, mouseX - player.x);
    }
}

function handleMouseDown(e) {
    if (currentScreen !== 'game') return;
    if (e.button === 0) { // Left click
        shoot();
    }
}

function shoot() {
    if (!gameState || !myId) return;
    const player = gameState.players[myId];
    if (!player || player.isDead) return;

    socket.emit('playerShoot', { angle: input.angle });

    // Add muzzle flash particle
    const muzzleX = player.x + Math.cos(input.angle) * 20;
    const muzzleY = player.y + Math.sin(input.angle) * 20;
    addParticleEffect(muzzleX, muzzleY, '#ffff00', 5);
}

// ============================================
// GAME LOOP
// ============================================

function gameLoop() {
    if (currentScreen === 'game' && gameState) {
        // Send input to server
        socket.emit('playerInput', input);

        // Render
        render();

        // Update particles
        updateParticles();
        updateHitEffects();
    }

    requestAnimationFrame(gameLoop);
}

// ============================================
// RENDERING
// ============================================

function render() {
    if (!ctx || !gameState || !config) return;

    // Clear canvas
    ctx.fillStyle = '#0d0d15';
    ctx.fillRect(0, 0, config.MAP_WIDTH, config.MAP_HEIGHT);

    // Draw grid
    drawGrid();

    // Draw team zones
    drawTeamZones();

    // Draw obstacles
    drawObstacles();

    // Draw flags
    drawFlags();

    // Draw bullets
    drawBullets();

    // Draw players
    drawPlayers();

    // Draw particles
    drawParticles();

    // Draw hit effects
    drawHitEffects();

    // Draw crosshair
    drawCrosshair();
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
    // Red zone (left)
    const gradient1 = ctx.createLinearGradient(0, 0, 150, 0);
    gradient1.addColorStop(0, 'rgba(255, 51, 102, 0.2)');
    gradient1.addColorStop(1, 'rgba(255, 51, 102, 0)');
    ctx.fillStyle = gradient1;
    ctx.fillRect(0, 0, 150, config.MAP_HEIGHT);

    // Blue zone (right)
    const gradient2 = ctx.createLinearGradient(config.MAP_WIDTH - 150, 0, config.MAP_WIDTH, 0);
    gradient2.addColorStop(0, 'rgba(0, 204, 255, 0)');
    gradient2.addColorStop(1, 'rgba(0, 204, 255, 0.2)');
    ctx.fillStyle = gradient2;
    ctx.fillRect(config.MAP_WIDTH - 150, 0, 150, config.MAP_HEIGHT);

    // Zone borders
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
        // Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(obs.x + 5, obs.y + 5, obs.width, obs.height);

        // Main block
        const gradient = ctx.createLinearGradient(obs.x, obs.y, obs.x + obs.width, obs.y + obs.height);
        gradient.addColorStop(0, '#2a2a40');
        gradient.addColorStop(1, '#1a1a2e');
        ctx.fillStyle = gradient;
        ctx.fillRect(obs.x, obs.y, obs.width, obs.height);

        // Border
        ctx.strokeStyle = 'rgba(153, 51, 255, 0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(obs.x, obs.y, obs.width, obs.height);

        // Glow
        ctx.shadowColor = 'rgba(153, 51, 255, 0.3)';
        ctx.shadowBlur = 10;
        ctx.strokeRect(obs.x, obs.y, obs.width, obs.height);
        ctx.shadowBlur = 0;
    });
}

function drawFlags() {
    ['red', 'blue'].forEach(team => {
        const flag = gameState.flags[team];
        const color = team === 'red' ? '#ff3366' : '#00ccff';
        const glowColor = team === 'red' ? 'rgba(255, 51, 102, 0.5)' : 'rgba(0, 204, 255, 0.5)';

        // Don't draw if being carried (will show above player)
        if (flag.carrier) return;

        // Glow effect
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 20;

        // Flag pole
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(flag.x, flag.y + 15);
        ctx.lineTo(flag.x, flag.y - 20);
        ctx.stroke();

        // Flag
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(flag.x, flag.y - 20);
        ctx.lineTo(flag.x + 25, flag.y - 10);
        ctx.lineTo(flag.x, flag.y);
        ctx.closePath();
        ctx.fill();

        // Home indicator ring
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

function drawBullets() {
    gameState.bullets.forEach(bullet => {
        const color = bullet.team === 'red' ? '#ff3366' : '#00ccff';

        // Trail
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(bullet.x - bullet.velocityX * 2, bullet.y - bullet.velocityY * 2);
        ctx.lineTo(bullet.x, bullet.y);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Bullet
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(bullet.x, bullet.y, 4, 0, Math.PI * 2);
        ctx.fill();

        // Glow
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
            // Draw death marker
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

        // Player glow
        ctx.shadowColor = color;
        ctx.shadowBlur = isMe ? 20 : 10;

        // Player body
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

        // Player border
        ctx.strokeStyle = isMe ? '#ffffff' : 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = isMe ? 3 : 2;
        ctx.beginPath();
        ctx.arc(player.x, player.y, 15, 0, Math.PI * 2);
        ctx.stroke();

        ctx.shadowBlur = 0;

        // Gun direction indicator
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

        // Flag on player if carrying
        if (player.hasFlag) {
            const enemyTeam = player.team === 'red' ? 'blue' : 'red';
            const flagColor = enemyTeam === 'red' ? '#ff3366' : '#00ccff';

            // Mini flag above player
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

        // Health bar (only for self)
        if (isMe) {
            const healthWidth = 40;
            const healthHeight = 6;
            const healthX = player.x - healthWidth / 2;
            const healthY = player.y + 25;

            // Background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(healthX, healthY, healthWidth, healthHeight);

            // Health
            const healthPercent = player.health / 100;
            const healthColor = healthPercent > 0.5 ? '#00ff88' :
                healthPercent > 0.25 ? '#ffcc00' : '#ff3366';
            ctx.fillStyle = healthColor;
            ctx.fillRect(healthX, healthY, healthWidth * healthPercent, healthHeight);

            // Border
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 1;
            ctx.strokeRect(healthX, healthY, healthWidth, healthHeight);
        }
    });
}

function drawCrosshair() {
    const size = 15;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2;

    // Cross
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

    // Center dot
    ctx.fillStyle = '#ff3366';
    ctx.beginPath();
    ctx.arc(mouseX, mouseY, 2, 0, Math.PI * 2);
    ctx.fill();
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

function shakeScreen() {
    const gameScreen = document.getElementById('game-screen');
    gameScreen.style.animation = 'none';
    setTimeout(() => {
        gameScreen.style.animation = 'shake 0.3s ease-out';
    }, 10);
}

// ============================================
// HUD UPDATES
// ============================================

function updateHUD() {
    if (!gameState) return;

    let redScore = 0;
    let blueScore = 0;

    Object.values(gameState.players).forEach(player => {
        if (player.team === 'red') redScore = player.score;
        else blueScore = player.score;
    });

    document.getElementById('red-score').textContent = redScore;
    document.getElementById('blue-score').textContent = blueScore;

    // Update my health
    const myPlayer = gameState.players[myId];
    if (myPlayer) {
        updateHealth(myPlayer.health);

        // Flag indicator
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

function updateTimer(timeLeft) {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    document.getElementById('game-timer').textContent =
        `${minutes}:${seconds.toString().padStart(2, '0')}`;

    // Warning when low time
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

    // Final scores
    let redScore = 0;
    let blueScore = 0;
    Object.values(gameState.players).forEach(player => {
        if (player.team === 'red') redScore = player.score;
        else blueScore = player.score;
    });

    document.getElementById('final-red-score').textContent = redScore;
    document.getElementById('final-blue-score').textContent = blueScore;
}

// Add shake animation
const style = document.createElement('style');
style.textContent = `
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        20% { transform: translateX(-10px); }
        40% { transform: translateX(10px); }
        60% { transform: translateX(-5px); }
        80% { transform: translateX(5px); }
    }
`;
document.head.appendChild(style);
