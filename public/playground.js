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
    // Relative paths to public/assets
    this.load.image('bg', 'assets/playground_bg.png');
    this.load.image('boy', 'assets/boy_pixel.png');
    this.load.image('girl', 'assets/girl_pixel.png');
}

function create() {
    // 1. Background
    this.add.image(400, 400, 'bg').setDisplaySize(800, 800);

    // 2. Physics Obstacles (Manual Mapping for collisions)
    const obstacles = this.physics.add.staticGroup();

    // Mapping based on playground_bg.png layout
    // === TOP ROW ===
    obstacles.add(this.add.zone(90, 100, 130, 160));    // Top-Left Pink Tree
    obstacles.add(this.add.zone(350, 80, 170, 150));    // Top-Center Tree
    obstacles.add(this.add.zone(570, 80, 120, 100));    // Top Pink Cherry Tree
    obstacles.add(this.add.zone(700, 130, 180, 200));   // Gazebo (Top Right)

    // === FLOWER BEDS (Left Side) ===
    obstacles.add(this.add.zone(115, 290, 150, 120));   // Upper-Left Flower Bed
    obstacles.add(this.add.zone(90, 470, 115, 200));    // Left-Middle Flower Bed (long vertical)
    obstacles.add(this.add.zone(115, 685, 180, 100));   // Bottom-Left Flower Bed

    // === CENTER FLOWER BEDS ===
    obstacles.add(this.add.zone(300, 335, 180, 80));    // Top-Center Flower Bed
    obstacles.add(this.add.zone(300, 465, 180, 80));    // Bottom-Center Flower Bed
    obstacles.add(this.add.zone(405, 400, 100, 150));   // Center Flower/Sunflower Area (vertical strip)

    // === RIGHT SIDE ===
    obstacles.add(this.add.zone(570, 290, 70, 70));     // Bench Area (Top Right of center)
    obstacles.add(this.add.zone(640, 500, 200, 170));   // Pond
    obstacles.add(this.add.zone(760, 350, 100, 100));   // Right Edge Tree
    obstacles.add(this.add.zone(770, 700, 100, 180));   // Bottom-Right Willow Tree

    // === BOTTOM ROW ===
    obstacles.add(this.add.zone(315, 720, 250, 100));   // Bottom-Center Flower Bed
    obstacles.add(this.add.zone(75, 715, 60, 100));     // Bottom-Left Tree Trunk


    // 3. Player initialization
    const gender = localStorage.getItem('userGender') || 'Male';
    player = this.physics.add.sprite(400, 550, (gender === 'Female' ? 'girl' : 'boy'));
    player.setCollideWorldBounds(true);
    player.setCircle(15, 20, 35); // Adjust for pixel sprite feet
    player.setDisplaySize(70, 70);
    player.username = localStorage.getItem('currentUsername') || 'You';

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
    partner = this.physics.add.sprite(-100, -100, 'girl');
    partner.setDisplaySize(70, 70);
    partner.setVisible(false);
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
    const speed = 250;

    // Movement Logic
    if (joystick.active && (Math.abs(joystick.x) > 0.1 || Math.abs(joystick.y) > 0.1)) {
        player.setVelocityX(joystick.x * speed);
        player.setVelocityY(joystick.y * speed);

        // Bobbing effect while walking
        player.yOffset = Math.sin(this.time.now / 100) * 5;
    } else {
        player.setVelocity(0);
        player.yOffset = Math.sin(this.time.now / 400) * 2; // Breathing idle
    }

    // Update name label position
    player.nameText.setPosition(player.x, player.y - 45 + player.yOffset);

    // Partner Interpolation
    if (partner.active && partner.targetX) {
        partner.setVisible(true);
        partner.nameText.setVisible(true);

        // Lerp for smooth movement
        partner.x += (partner.targetX - partner.x) * 0.15;
        partner.y += (partner.targetY - partner.y) * 0.15;

        // Partner bobbing based on movement speed
        const dist = Phaser.Math.Distance.Between(partner.x, partner.y, partner.targetX, partner.targetY);
        let bob = 0;
        if (dist > 2) {
            bob = Math.sin(this.time.now / 100) * 5;
        } else {
            bob = Math.sin(this.time.now / 400) * 2;
        }

        partner.y += bob; // Visual only
        partner.nameText.setPosition(partner.x, partner.y - 45);
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
                partner.setTexture(result.partnerGender === 'Female' ? 'girl' : 'boy');
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

// Invite Logic
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
