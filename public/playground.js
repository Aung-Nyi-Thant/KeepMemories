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

let player;
let partner;
let partnerId = null;
let joystick = { active: false, x: 0, y: 0 };
let currentUserId = localStorage.getItem('currentUserId');
let token = localStorage.getItem('authToken');
let API_URL = '/api';

function preload() {
    // Background
    this.load.image('bg', 'assets/playground_bg.png');

    // Boy character frames (individual images)
    this.load.image('boy_idle', 'assets/boy_idle.png');
    this.load.image('boy_down1', 'assets/boy_down1.png');
    this.load.image('boy_down2', 'assets/boy_front.png');
    this.load.image('boy_right1', 'assets/boy_right1.png');
    this.load.image('boy_right2', 'assets/boy_right2.png');
    this.load.image('boy_up1', 'assets/boy_up1.png');
    this.load.image('boy_up2', 'assets/boy_up2.png');

    // Girl character frames (individual images)
    this.load.image('girl_idle', 'assets/girl_idle.png');
    this.load.image('girl_down1', 'assets/girl_down1.png');
    this.load.image('girl_down2', 'assets/girl_down2.png');
    this.load.image('girl_right1', 'assets/girl_right1.png');
    this.load.image('girl_right2', 'assets/girl_right2.png');
    this.load.image('girl_up1', 'assets/girl_up1.png');
    this.load.image('girl_up2', 'assets/girl_up2.png');
}

function create() {
    // 1. Background
    this.add.image(400, 400, 'bg').setDisplaySize(800, 800);

    // 2. Physics Obstacles (Manual Mapping for collisions)
    const obstacles = this.physics.add.staticGroup();

    // Mapping based on NEW natural park layout
    // === BORDERS ===
    obstacles.add(this.add.zone(400, 20, 800, 50));     // Top border trees
    obstacles.add(this.add.zone(400, 785, 800, 40));    // Bottom border edge
    obstacles.add(this.add.zone(15, 400, 30, 800));     // Left edge
    obstacles.add(this.add.zone(785, 400, 40, 800));    // Right edge

    // === POND & DOCK ===
    obstacles.add(this.add.zone(695, 515, 230, 200));   // Main Pond Area
    obstacles.add(this.add.zone(540, 520, 80, 70));     // Bridge/Dock on pond

    // === SCATTERED TREES ===
    obstacles.add(this.add.zone(640, 80, 80, 80));      // Top-Right Inner Tree
    obstacles.add(this.add.zone(495, 345, 100, 100));   // Center Inner Tree
    obstacles.add(this.add.zone(45, 310, 90, 180));     // Left-Middle Bulk Trees
    obstacles.add(this.add.zone(800, 380, 120, 150));   // Right-Middle Edge Trees
    obstacles.add(this.add.zone(70, 750, 120, 120));    // Bottom-Left Trees
    obstacles.add(this.add.zone(750, 750, 120, 120));   // Bottom-Right Trees
    obstacles.add(this.add.zone(595, 940, 100, 100));   // Bottom Edge Tree

    // 3. Player initialization
    const gender = localStorage.getItem('userGender') || 'Male';
    const spritePrefix = (gender === 'Female' ? 'girl' : 'boy');
    player = this.physics.add.sprite(400, 550, spritePrefix + '_idle');
    player.setCollideWorldBounds(true);
    player.setCircle(15, 10, 40); // Hitbox for small sprite feet
    player.setDisplaySize(50, 50);
    player.username = localStorage.getItem('currentUsername') || 'You';
    player.facing = 'down';
    player.spritePrefix = spritePrefix;
    player.walkFrame = 0;
    player.lastFrameTime = 0;

    // Player Text
    player.nameText = this.add.text(400, 500, player.username, {
        fontSize: '16px',
        fontFamily: 'Arial',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 5
    }).setOrigin(0.5);

    // 4. Partner initialization
    const partnerPrefix = (gender === 'Female' ? 'boy' : 'girl');
    partner = this.physics.add.sprite(-100, -100, partnerPrefix + '_idle');
    partner.setDisplaySize(50, 50);
    partner.setVisible(false);
    partner.spritePrefix = partnerPrefix;
    partner.nameText = this.add.text(-100, -150, 'Partner', {
        fontSize: '16px',
        color: '#ffffff',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 5
    }).setOrigin(0.5).setVisible(false);

    // 5. Collisions
    this.physics.add.collider(player, obstacles);

    // 6. Joystick & Sync Intervals
    setupJoystick();

    // Use Phaser's Timer for sync events
    this.time.addEvent({ delay: 200, callback: syncPosition, callbackScope: this, loop: true });
    this.time.addEvent({ delay: 3000, callback: fetchData, callbackScope: this, loop: true });
}

function update() {
    const speed = 180;
    const frameInterval = 150; // Milliseconds between frame switches

    // Movement Logic
    if (joystick.active && (Math.abs(joystick.x) > 0.1 || Math.abs(joystick.y) > 0.1)) {
        player.setVelocityX(joystick.x * speed);
        player.setVelocityY(joystick.y * speed);

        // Determine facing direction and play walk animation
        let directionKey = '';
        if (Math.abs(joystick.x) > Math.abs(joystick.y)) {
            // Horizontal movement
            if (joystick.x > 0) {
                player.facing = 'right';
                player.setFlipX(false);
                directionKey = 'right';
            } else {
                player.facing = 'left';
                player.setFlipX(true); // Mirror the right frames
                directionKey = 'right'; // Use right frames, flipped
            }
        } else {
            // Vertical movement
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

        // Animate by switching textures
        const now = this.time.now;
        if (now - player.lastFrameTime > frameInterval) {
            player.walkFrame = (player.walkFrame + 1) % 2;
            player.lastFrameTime = now;
        }
        const frameNum = player.walkFrame + 1;
        player.setTexture(player.spritePrefix + '_' + directionKey + frameNum);

        player.yOffset = 0;
    } else {
        player.setVelocity(0);
        player.setTexture(player.spritePrefix + '_idle');
        player.setFlipX(false);
        player.yOffset = Math.sin(this.time.now / 400) * 2; // Breathing idle
    }

    // Update name label position
    player.nameText.setPosition(player.x, player.y - 35 + player.yOffset);

    // Partner Interpolation
    if (partner.active && partner.targetX) {
        partner.setVisible(true);
        partner.nameText.setVisible(true);

        // Lerp for smooth movement
        partner.x += (partner.targetX - partner.x) * 0.15;
        partner.y += (partner.targetY - partner.y) * 0.15;

        // Partner Animation logic
        const dx = partner.targetX - partner.x;
        const dy = partner.targetY - partner.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 5) { // Moving
            let partnerDir = 'down';
            if (Math.abs(dx) > Math.abs(dy)) {
                if (dx > 0) {
                    partnerDir = 'right';
                    partner.setFlipX(false);
                } else {
                    partnerDir = 'right';
                    partner.setFlipX(true);
                }
            } else {
                partnerDir = dy > 0 ? 'down' : 'up';
            }

            // Frame switching
            const now = this.time.now;
            if (!partner.lastFrameTime) partner.lastFrameTime = 0;
            if (now - partner.lastFrameTime > frameInterval) {
                partner.walkFrame = ((partner.walkFrame || 0) + 1) % 2;
                partner.lastFrameTime = now;
            }
            const frameNum = (partner.walkFrame || 0) + 1;
            partner.setTexture(partner.spritePrefix + '_' + partnerDir + frameNum);
            partner.yOffset = 0;
        } else {
            // Idle
            partner.setTexture(partner.spritePrefix + '_idle');
            partner.setFlipX(false);
            partner.yOffset = Math.sin(this.time.now / 400) * 2;
        }

        partner.y += partner.yOffset; // Visual bobbing
        partner.nameText.setPosition(partner.x, partner.y - 35);
    } else {
        partner.setVisible(false);
        partner.nameText.setVisible(false);
    }
}

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

async function fetchData() {
    if (!token) return;
    try {
        const res = await fetch(`${API_URL}/data/${currentUserId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await res.json();
        if (result.success) {
            partnerId = result.partnerId;
            partner.nameText.setText(result.partnerName || 'Partner');
            if (result.partnerGender) {
                partner.spritePrefix = (result.partnerGender === 'Female' ? 'girl' : 'boy');
                partner.setTexture(partner.spritePrefix + '_idle');
            }
        }
    } catch (e) { }
}

async function syncPosition() {
    if (!token || !player) return;
    try {
        // Send own position
        fetch(`${API_URL}/playground/update-pos`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ x: player.x, y: player.y })
        });

        // Get partner position
        if (partnerId) {
            const res = await fetch(`${API_URL}/playground/status/${partnerId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success && data.x !== undefined) {
                partner.targetX = data.x;
                partner.targetY = data.y;
                partner.active = true;
                updatePartnerStatus(true);
            } else {
                partner.active = false;
                updatePartnerStatus(false);
            }
        }
    } catch (e) { }
}

function updatePartnerStatus(online) {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    if (!dot || !text) return;
    if (online) {
        dot.className = "status-dot online";
        text.textContent = "Partner in Playground";
    } else {
        dot.className = "status-dot offline";
        text.textContent = "Partner Offline";
    }
}

// Button Logic (Navigation & Invites)
const homeBtn = document.getElementById('homeBtn');
if (homeBtn) {
    homeBtn.addEventListener('click', () => {
        window.location.href = 'home.html';
    });
}

const inviteBtn = document.getElementById('inviteBtn');
if (inviteBtn) {
    inviteBtn.addEventListener('click', async () => {
        try {
            await fetch(`${API_URL}/playground/invite`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            alert("Invitation sent! 💌");
        } catch (e) {
            alert("Error sending invitation.");
        }
    });
}
