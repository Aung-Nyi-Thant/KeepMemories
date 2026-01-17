/**
 * KeepMemories - Multiplayer Playground
 * Large World (3200x3200) + Proximity Chat + Smooth Physics
 */

const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 800,
    parent: 'game-container',
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 },
            debug: false
        }
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    }
};

const game = new Phaser.Game(config);

// ============ Movement Config ============
const MOV = {
    acceleration: 300, // px/s^2 - Slower acceleration
    drag: 500,         // px/s^2 - Stopping power
    maxSpeed: 100      // px/s   - Slower top speed (Verify requested)
};

// ============ Game State ============
let player;
let myPlayerId = null;
let players = new Map(); // Map of oderId -> player sprite
let joystick = { active: false, x: 0, y: 0 };
let currentUserId = localStorage.getItem('currentUserId');
let token = localStorage.getItem('authToken');
let socket = null;
let lastPositionSent = { x: 0, y: 0 };
let positionUpdateThrottle = 0;
let scene = null;

// ============ Private Chat State ============
let nearbyPlayers = []; // Array of nearby player objects
let currentRoomId = null;
let currentChatPartnerId = null;
let pendingInviteFromId = null;

// ============ Phaser Lifecycle ============
function preload() {
    this.load.image('bg_large', 'assets/map_large.jpg'); // Load new map

    // Boy character
    this.load.image('boy_idle', 'assets/boy_idle.png');
    this.load.image('boy_down1', 'assets/boy_down1.png');
    this.load.image('boy_down2', 'assets/boy_front.png');
    this.load.image('boy_right1', 'assets/boy_right1.png');
    this.load.image('boy_right2', 'assets/boy_right2.png');
    this.load.image('boy_up1', 'assets/boy_up1.png');
    this.load.image('boy_up2', 'assets/boy_up2.png');

    // Girl character
    this.load.image('girl_idle', 'assets/girl_idle.png');
    this.load.image('girl_down1', 'assets/girl_down1.png');
    this.load.image('girl_down2', 'assets/girl_down2.png');
    this.load.image('girl_right1', 'assets/girl_right1.png');
    this.load.image('girl_right2', 'assets/girl_right2.png');
    this.load.image('girl_up1', 'assets/girl_up1.png');
    this.load.image('girl_up2', 'assets/girl_up2.png');
}

function create() {
    scene = this;

    // 1. World & Camera Setup
    // Image is 1024x682. Scaled 3x = 3072 x 2046
    const mapWidth = 3072;
    const mapHeight = 2046;

    this.physics.world.setBounds(0, 0, mapWidth, mapHeight);
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);

    // Large Map Image
    // Centered placement: x,y is center. 
    this.add.image(mapWidth / 2, mapHeight / 2, 'bg_large').setDisplaySize(mapWidth, mapHeight);

    // 2. Physics Obstacles (Updated for larger world)
    const obstacles = this.physics.add.staticGroup();
    // Borders
    obstacles.add(this.add.zone(mapWidth / 2, 10, mapWidth, 20)); // Top
    obstacles.add(this.add.zone(mapWidth / 2, mapHeight - 10, mapWidth, 20)); // Bottom
    obstacles.add(this.add.zone(10, mapHeight / 2, 20, mapHeight)); // Left
    obstacles.add(this.add.zone(mapWidth - 10, mapHeight / 2, 20, mapHeight)); // Right

    // Some random obstacles scattered around (Adjusted for new map size)
    obstacles.add(this.add.zone(800, 800, 200, 200));
    obstacles.add(this.add.zone(2000, 800, 200, 200));
    obstacles.add(this.add.zone(800, 1500, 200, 200));
    obstacles.add(this.add.zone(2000, 1500, 200, 200));

    // 3. Player Setup
    const gender = localStorage.getItem('userGender') || 'Male';
    const spritePrefix = (gender === 'Female' ? 'girl' : 'boy');
    // Spawn in logic is handled by server, but we need initial position. 
    // Server will correct us on init, but start at center of a quadrant to be safe.
    player = this.physics.add.sprite(1600, 1600, spritePrefix + '_idle');
    player.setCollideWorldBounds(true);
    player.setCircle(15, 10, 40);
    player.setDisplaySize(50, 50);
    player.username = localStorage.getItem('currentUsername') || 'You';
    player.facing = 'down';
    player.spritePrefix = spritePrefix;
    player.walkFrame = 0;
    player.lastFrameTime = 0;
    player.yOffset = 0;

    // Apply smooth physics
    player.setDrag(MOV.drag);
    player.setMaxVelocity(MOV.maxSpeed);

    player.nameText = this.add.text(1600, 1550, player.username, {
        fontSize: '14px',
        fontFamily: 'Arial',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4
    }).setOrigin(0.5);

    // Camera Follow
    this.cameras.main.startFollow(player, true, 0.09, 0.09); // Smooth lerp

    this.physics.add.collider(player, obstacles);
    this.obstacles = obstacles;

    setupJoystick();
    initSocketIO(this);
    setupPrivateChatUI();
}

function update() {
    const frameInterval = 150;

    // ===== SMOOTH ACCELERATED MOVEMENT =====
    if (joystick.active && (Math.abs(joystick.x) > 0.1 || Math.abs(joystick.y) > 0.1)) {
        // Apply acceleration based on joystick input
        player.setAccelerationX(joystick.x * MOV.acceleration);
        player.setAccelerationY(joystick.y * MOV.acceleration);

        // Determine facing direction
        let directionKey = '';
        if (Math.abs(joystick.x) > Math.abs(joystick.y)) {
            if (joystick.x > 0) {
                player.facing = 'right';
                player.setFlipX(false);
                directionKey = 'right';
            } else {
                player.facing = 'left';
                player.setFlipX(true);
                directionKey = 'right';
            }
        } else {
            if (joystick.y > 0) {
                player.facing = 'down';
                player.setFlipX(false);
                directionKey = 'down';
            } else {
                player.facing = 'up';
                player.setFlipX(false);
                directionKey = 'up';
            }
        }

        // Animation
        const now = this.time.now;
        if (now - player.lastFrameTime > frameInterval) {
            player.walkFrame = (player.walkFrame + 1) % 2;
            player.lastFrameTime = now;
        }
        const frameNum = player.walkFrame + 1;
        player.setTexture(player.spritePrefix + '_' + directionKey + frameNum);
        player.yOffset = 0;
    } else {
        // Stop acceleration -> Drag will slow player down smoothly
        player.setAcceleration(0);

        // Idle Animation (only when very slow)
        if (player.body.velocity.length() < 10) {
            player.setTexture(player.spritePrefix + '_idle');
            player.setFlipX(false);
            player.yOffset = Math.sin(this.time.now / 400) * 2;
        }
    }

    player.nameText.setPosition(player.x, player.y - 35 + player.yOffset);

    // Send position updates
    if (socket && socket.connected) {
        positionUpdateThrottle++;
        if (positionUpdateThrottle >= 3) {
            const dx = Math.abs(player.x - lastPositionSent.x);
            const dy = Math.abs(player.y - lastPositionSent.y);

            // Send update if position changed
            if (dx > 2 || dy > 2) {
                socket.emit('playground:move', {
                    x: Math.round(player.x),
                    y: Math.round(player.y),
                    direction: player.facing,
                    isMoving: joystick.active
                });
                lastPositionSent.x = player.x;
                lastPositionSent.y = player.y;
                positionUpdateThrottle = 0;
            }
        }
    }

    // Update other players with interpolation
    players.forEach((otherPlayer, oderId) => {
        if (oderId === myPlayerId) return;

        // Smooth lerp to target position (Factor 0.1 for weight)
        otherPlayer.x += (otherPlayer.targetX - otherPlayer.x) * 0.1;
        otherPlayer.y += (otherPlayer.targetY - otherPlayer.y) * 0.1;

        const dx = otherPlayer.targetX - otherPlayer.x;
        const dy = otherPlayer.targetY - otherPlayer.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 5 && otherPlayer.isMoving) {
            let dir = 'down';
            if (Math.abs(dx) > Math.abs(dy)) {
                dir = 'right';
                otherPlayer.setFlipX(dx < 0);
            } else {
                dir = dy > 0 ? 'down' : 'up';
                otherPlayer.setFlipX(false);
            }

            const now = this.time.now;
            if (!otherPlayer.lastFrameTime) otherPlayer.lastFrameTime = 0;
            if (now - otherPlayer.lastFrameTime > frameInterval) {
                otherPlayer.walkFrame = ((otherPlayer.walkFrame || 0) + 1) % 2;
                otherPlayer.lastFrameTime = now;
            }
            const frameNum = (otherPlayer.walkFrame || 0) + 1;
            otherPlayer.setTexture(otherPlayer.spritePrefix + '_' + dir + frameNum);
            otherPlayer.yOffset = 0;
        } else {
            otherPlayer.setTexture(otherPlayer.spritePrefix + '_idle');
            otherPlayer.setFlipX(false);
            otherPlayer.yOffset = Math.sin(this.time.now / 400) * 2;
        }

        otherPlayer.nameText.setPosition(otherPlayer.x, otherPlayer.y - 35 + (otherPlayer.yOffset || 0));
    });
}

// ============ Joystick Setup ============
function setupJoystick() {
    const joystickElem = document.getElementById('joystick');
    const knob = document.getElementById('knob');
    if (!joystickElem) return;

    const handleDown = (e) => {
        joystick.active = true;
        updateKnob(e);
        if (e.cancelable) e.preventDefault();
    };

    const updateKnob = (e) => {
        if (!joystick.active) return;
        const rect = joystickElem.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        let dx = clientX - centerX;
        let dy = clientY - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const maxDist = rect.width / 2 - 25;

        if (distance > maxDist) {
            dx = (dx / distance) * maxDist;
            dy = (dy / distance) * maxDist;
        }

        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        joystick.x = dx / maxDist;
        joystick.y = dy / maxDist;
    };

    joystickElem.addEventListener('mousedown', handleDown);
    joystickElem.addEventListener('touchstart', handleDown);
    window.addEventListener('mousemove', updateKnob);
    window.addEventListener('touchmove', updateKnob, { passive: false });
    window.addEventListener('mouseup', () => { joystick.active = false; knob.style.transform = 'translate(0,0)'; });
    window.addEventListener('touchend', () => { joystick.active = false; knob.style.transform = 'translate(0,0)'; });
}

// ============ Socket.IO ============
function initSocketIO(gameScene) {
    if (!token) {
        console.warn('No auth token, Socket.IO skipped');
        return;
    }

    socket = io({ auth: { token } });

    socket.on('connect', () => {
        console.log('[Playground] Connected');
    });

    socket.on('connect_error', (error) => {
        console.error('[Playground] Connection error:', error.message);
    });

    socket.on('disconnect', () => {
        console.log('[Playground] Disconnected');
    });

    // ============ INITIALIZATION ============
    socket.on('playground:init', (data) => {
        console.log('[Playground] Init with', data.players.length, 'players');
        myPlayerId = data.oderId;

        // If server sent us our position (which it usually does via players array), sync it.
        // If not, we just stay where we spawned in create().

        data.players.forEach((p) => {
            if (p.oderId !== myPlayerId) {
                createOtherPlayer(p);
            } else {
                // Update my position from server
                if (player) {
                    player.setPosition(p.x, p.y);
                }
            }
        });

        updatePlayerCount();
    });

    // ============ PLAYER EVENTS ============
    socket.on('playground:playerJoined', (data) => {
        console.log('[Playground] Player joined:', data.player.username);
        if (data.player.oderId !== myPlayerId) {
            createOtherPlayer(data.player);
        }
        showToast(data.message, 'join');
        updatePlayerCount();
    });

    socket.on('playground:playerMoved', (data) => {
        const otherPlayer = players.get(data.oderId);
        if (otherPlayer) {
            otherPlayer.targetX = data.x;
            otherPlayer.targetY = data.y;
            otherPlayer.direction = data.direction;
            otherPlayer.isMoving = data.isMoving;
        }
    });

    socket.on('playground:playerLeft', (data) => {
        console.log('[Playground] Player left:', data.username);
        const otherPlayer = players.get(data.oderId);
        if (otherPlayer) {
            otherPlayer.nameText.destroy();
            otherPlayer.destroy();
            players.delete(data.oderId);
        }
        showToast(data.message, 'leave');
        updatePlayerCount();
    });

    // ============ NEARBY PLAYERS ============
    socket.on('playground:nearbyPlayers', (data) => {
        nearbyPlayers = data.nearby || [];
        updateNearbyPlayersUI();
    });

    // ============ CHAT INVITE RECEIVED ============
    socket.on('playground:chatInviteReceived', (data) => {
        console.log('[Chat] Invite from:', data.fromUsername);
        pendingInviteFromId = data.fromId;
        showInviteCard(data.fromUsername, data.fromColor);
    });

    socket.on('playground:chatInviteSent', (data) => {
        showToast(`Invite sent to ${data.toUsername}`, 'info');
    });

    socket.on('playground:chatInviteDeclined', (data) => {
        showToast(`${data.byUsername} declined your invite`, 'leave');
    });

    // ============ PRIVATE ROOM EVENTS ============
    socket.on('playground:chatRoomJoined', (data) => {
        console.log('[Chat] Room joined:', data.roomId);
        currentRoomId = data.roomId;
        currentChatPartnerId = data.partnerId;
        openPrivateChatModal(data.partnerUsername, data.partnerColor);
    });

    socket.on('playground:privateMessageReceived', (data) => {
        addPrivateMessage(data.fromId, data.fromUsername, data.message, data.fromColor);
    });

    socket.on('playground:chatRoomClosed', (data) => {
        console.log('[Chat] Room closed:', data.reason);
        showToast(data.reason, 'leave');
        closePrivateChatModal();
    });

    socket.on('playground:error', (data) => {
        showToast(data.message, 'error');
    });
}

// ============ Create Other Player ============
function createOtherPlayer(playerData) {
    if (!scene) return;

    const spritePrefix = (playerData.gender === 'Female' ? 'girl' : 'boy');
    const otherPlayer = scene.physics.add.sprite(playerData.x, playerData.y, spritePrefix + '_idle');
    otherPlayer.setCollideWorldBounds(true);
    otherPlayer.setCircle(15, 10, 40);
    otherPlayer.setDisplaySize(50, 50);
    otherPlayer.spritePrefix = spritePrefix;
    otherPlayer.targetX = playerData.x;
    otherPlayer.targetY = playerData.y;
    otherPlayer.direction = playerData.direction || 'down';
    otherPlayer.isMoving = false;
    otherPlayer.walkFrame = 0;
    otherPlayer.lastFrameTime = 0;
    otherPlayer.yOffset = 0;

    otherPlayer.nameText = scene.add.text(playerData.x, playerData.y - 35, playerData.username, {
        fontSize: '14px',
        fontFamily: 'Arial',
        fontStyle: 'bold',
        color: playerData.color || '#ffffff',
        stroke: '#000000',
        strokeThickness: 4
    }).setOrigin(0.5);

    if (scene.obstacles) {
        scene.physics.add.collider(otherPlayer, scene.obstacles);
    }

    players.set(playerData.oderId, otherPlayer);
}

// ============ Nearby Players UI ============
function updateNearbyPlayersUI() {
    const indicator = document.getElementById('nearby-indicator');
    const list = document.getElementById('nearby-list');
    if (!indicator || !list) return;

    // Filter out players we're already chatting with
    const filteredNearby = nearbyPlayers.filter(p => p.oderId !== currentChatPartnerId);

    if (filteredNearby.length === 0) {
        indicator.classList.remove('visible');
        return;
    }

    indicator.classList.add('visible');
    list.innerHTML = filteredNearby.map(p => `
        <div class="nearby-player">
            <span class="name">${escapeHtml(p.username)}</span>
            <button class="chat-invite-btn" data-id="${p.oderId}">💬 Chat</button>
        </div>
    `).join('');

    // Add click handlers
    list.querySelectorAll('.chat-invite-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.id;
            if (socket && socket.connected) {
                socket.emit('playground:chatInvite', { targetId });
            }
        });
    });
}

// ============ Audio & Haptics ============
let audioCtx = null;
let inviteTimeout = null;

function initAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function playInviteSound() {
    initAudioContext();
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.3);

    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.3);
}

// ============ Invite Card ============
function showInviteCard(fromUsername, fromColor) {
    const card = document.getElementById('invite-card');
    const nameEl = document.getElementById('invite-from-name');
    if (!card || !nameEl) return;

    nameEl.textContent = fromUsername;
    nameEl.style.color = fromColor || '#fff';

    // Visuals & Sound
    card.classList.add('visible');
    card.classList.add('vibrate');
    playInviteSound();

    // Auto-dismiss after 10 seconds
    if (inviteTimeout) clearTimeout(inviteTimeout);
    inviteTimeout = setTimeout(() => {
        if (socket && pendingInviteFromId) {
            socket.emit('playground:chatInviteDecline', { fromId: pendingInviteFromId });
        }
        hideInviteCard();
        showToast('Invite expired', 'leave');
    }, 10000);
}

function hideInviteCard() {
    const card = document.getElementById('invite-card');
    if (card) {
        card.classList.remove('visible');
        card.classList.remove('vibrate');
    }
    if (inviteTimeout) {
        clearTimeout(inviteTimeout);
        inviteTimeout = null;
    }
    pendingInviteFromId = null;
}

// ============ Private Chat Modal ============
function openPrivateChatModal(partnerUsername, partnerColor) {
    const modal = document.getElementById('private-chat-modal');
    const nameEl = document.getElementById('chat-partner-name');
    const messagesEl = document.getElementById('private-chat-messages');

    if (!modal || !nameEl) return;

    nameEl.textContent = partnerUsername;
    nameEl.style.color = partnerColor || '#fff';
    messagesEl.innerHTML = ''; // Clear messages
    modal.classList.add('visible');
    hideInviteCard();
}

function closePrivateChatModal() {
    const modal = document.getElementById('private-chat-modal');
    if (modal) modal.classList.remove('visible');

    if (currentRoomId && socket) {
        socket.emit('playground:leaveChat', { roomId: currentRoomId });
    }

    currentRoomId = null;
    currentChatPartnerId = null;
}

function addPrivateMessage(fromId, fromUsername, message, fromColor) {
    const messagesEl = document.getElementById('private-chat-messages');
    if (!messagesEl) return;

    const isMe = fromId === myPlayerId;
    const msgDiv = document.createElement('div');
    msgDiv.className = `private-msg ${isMe ? 'mine' : 'theirs'}`;
    msgDiv.innerHTML = `
        <div class="sender" style="color: ${fromColor || '#fff'}">${escapeHtml(fromUsername)}</div>
        <div>${escapeHtml(message)}</div>
    `;
    messagesEl.appendChild(msgDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ============ Chat UI Setup ============
function setupPrivateChatUI() {
    // Accept/Decline invite buttons
    const acceptBtn = document.getElementById('accept-invite-btn');
    const declineBtn = document.getElementById('decline-invite-btn');

    if (acceptBtn) {
        acceptBtn.addEventListener('click', () => {
            if (pendingInviteFromId && socket) {
                socket.emit('playground:chatInviteAccept', { fromId: pendingInviteFromId });
            }
            hideInviteCard();
        });
    }

    if (declineBtn) {
        declineBtn.addEventListener('click', () => {
            if (pendingInviteFromId && socket) {
                socket.emit('playground:chatInviteDecline', { fromId: pendingInviteFromId });
            }
            hideInviteCard();
        });
    }

    // Private chat form
    const chatForm = document.getElementById('private-chat-form');
    const chatInput = document.getElementById('private-chat-input');
    const closeBtn = document.getElementById('private-chat-close');

    if (chatForm) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const message = chatInput.value.trim();
            if (message && socket && currentRoomId) {
                socket.emit('playground:privateMessage', {
                    roomId: currentRoomId,
                    message: message
                });
                chatInput.value = '';
            }
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            closePrivateChatModal();
        });
    }
}

// ============ Toast Notifications ============
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}

// ============ Player Count ============
function updatePlayerCount() {
    const countEl = document.getElementById('player-count');
    if (countEl) {
        countEl.textContent = players.size + 1;
    }
}

// ============ Utility ============
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============ Navigation ============
const homeBtn = document.getElementById('homeBtn');
if (homeBtn) {
    homeBtn.addEventListener('click', () => {
        window.location.href = 'home.html';
    });
}

// ============ Invite by ID Modal (kept for backwards compat) ============
const inviteBtn = document.getElementById('inviteBtn');
const inviteModal = document.getElementById('inviteModal');
const inviteUserIdInput = document.getElementById('inviteUserIdInput');
const sendInviteBtn = document.getElementById('sendInviteBtn');
const cancelInviteBtn = document.getElementById('cancelInviteBtn');

if (inviteBtn) {
    inviteBtn.addEventListener('click', () => {
        if (inviteModal) {
            inviteModal.classList.add('active');
            inviteUserIdInput.focus();
        }
    });
}

if (cancelInviteBtn) {
    cancelInviteBtn.addEventListener('click', () => {
        if (inviteModal) {
            inviteModal.classList.remove('active');
            inviteUserIdInput.value = '';
        }
    });
}

if (inviteModal) {
    inviteModal.addEventListener('click', (e) => {
        if (e.target === inviteModal) {
            inviteModal.classList.remove('active');
            inviteUserIdInput.value = '';
        }
    });
}

if (sendInviteBtn) {
    sendInviteBtn.addEventListener('click', () => {
        const targetId = inviteUserIdInput.value.trim();
        if (!targetId) {
            showToast('Please enter a User ID', 'error');
            return;
        }
        showToast(`Tell ${targetId} to join the playground!`, 'info');
        inviteModal.classList.remove('active');
        inviteUserIdInput.value = '';
    });
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    if (socket) socket.disconnect();
});
