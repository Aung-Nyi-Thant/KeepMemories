const API_URL = '/api';
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const currentUserId = localStorage.getItem('currentUserId');
const token = localStorage.getItem('authToken');

// Game State
let player = {
    x: 400,
    y: 300,
    speed: 4,
    gender: 'Male',
    username: localStorage.getItem('currentUsername') || 'You',
    sprite: 'idle'
};

let partner = {
    x: -100, // Offscreen initially
    y: -100,
    active: false,
    username: 'Partner',
    gender: 'Female',
    sprite: 'idle'
};

let partnerId = null;
let assets = {};
let joystick = { active: false, x: 0, y: 0 };

// Load Assets
async function loadAssets() {
    const assetList = {
        bg: 'assets/playground_bg.png',
        boy: 'assets/boy_pixel.png',
        girl: 'assets/girl_pixel.png'
    };

    const promises = Object.entries(assetList).map(([key, url]) => {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                assets[key] = img;
                resolve();
            };
            img.src = url;
        });
    });

    await Promise.all(promises);
    startGame();
}

// Joystick Logic
const joystickElem = document.getElementById('joystick');
const knob = document.getElementById('knob');

joystickElem.addEventListener('touchstart', handleJoystickDown);
joystickElem.addEventListener('mousedown', handleJoystickDown);

function handleJoystickDown(e) {
    joystick.active = true;
    updateJoystick(e);
}

window.addEventListener('mousemove', updateJoystick);
window.addEventListener('touchmove', updateJoystick);
window.addEventListener('mouseup', () => joystick.active = false);
window.addEventListener('touchend', () => joystick.active = false);

function updateJoystick(e) {
    if (!joystick.active) {
        knob.style.transform = 'translate(0,0)';
        joystick.x = 0;
        joystick.y = 0;
        return;
    }

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

    // Normalize movement (0 to 1)
    joystick.x = dx / maxDist;
    joystick.y = dy / maxDist;
}

// Game Loop
function startGame() {
    requestAnimationFrame(gameLoop);
    setInterval(syncPosition, 100); // Poll partner every 100ms
    setInterval(fetchData, 2000);   // Refresh metadata
}

function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

function update() {
    if (joystick.active) {
        player.x += joystick.x * player.speed;
        player.y += joystick.y * player.speed;
        player.sprite = 'walking';

        // Boundary Check
        player.x = Math.max(0, Math.min(canvas.width, player.x));
        player.y = Math.max(0, Math.min(canvas.height, player.y));
    } else {
        player.sprite = 'idle';
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Background
    if (assets.bg) {
        ctx.drawImage(assets.bg, 0, 0, canvas.width, canvas.height);
    }

    // Draw Partner
    if (partner.active) {
        drawCharacter(partner);
    }

    // Draw Player
    drawCharacter(player);
}

function drawCharacter(char) {
    const sprite = char.gender === 'Female' ? assets.girl : assets.boy;
    if (!sprite) return;

    const size = 64;
    ctx.drawImage(sprite, char.x - size / 2, char.y - size / 2, size, size);

    // Draw Name
    ctx.fillStyle = "white";
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "center";
    ctx.shadowBlur = 4;
    ctx.shadowColor = "black";
    ctx.fillText(char.username, char.x, char.y - size / 2 - 10);
    ctx.shadowBlur = 0;
}

// API Sync
async function fetchData() {
    try {
        const response = await fetch(`${API_URL}/data/${currentUserId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await response.json();
        if (result.success) {
            player.gender = result.gender || 'Male';
            partnerId = result.partnerId;
            partner.username = result.partnerName || 'Partner';
        }
    } catch (e) { }
}

async function syncPosition() {
    // Send Own Position
    try {
        fetch(`${API_URL}/playground/update-pos`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ x: player.x, y: player.y, sprite: player.sprite })
        });

        // Get Partner Position
        if (partnerId) {
            const res = await fetch(`${API_URL}/playground/status/${partnerId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) {
                partner.x = data.x;
                partner.y = data.y;
                partner.sprite = data.sprite;
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
    if (online) {
        dot.className = "status-dot online";
        text.textContent = "Partner in Playground";
    } else {
        dot.className = "status-dot offline";
        text.textContent = "Partner Offline";
    }
}

// Invite Logic
document.getElementById('inviteBtn').addEventListener('click', async () => {
    try {
        const res = await fetch(`${API_URL}/playground/invite`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        alert("Invitation sent to partner! 💌");
    } catch (e) {
        alert("Error sending invitation.");
    }
});

loadAssets();
