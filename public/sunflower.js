const API_URL = 'https://keepmemories-1.onrender.com/api';
const currentUserId = localStorage.getItem('currentUserId');

if (!currentUserId) {
    window.location.href = 'index.html';
}

// Global State
let localData = {
    sunflower: { name: "Sunny", level: 1, exp: 0, stage: "Seed", lastWatered: 0, lastFertilized: 0 }
};

document.addEventListener('DOMContentLoaded', () => {
    loadSunflowerData();

    // Theme
    const savedTheme = localStorage.getItem('selected-theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    }

    // Event Listeners
    document.getElementById('waterBtn').addEventListener('click', () => interact('water'));
    document.getElementById('fertilizeBtn').addEventListener('click', () => interact('fertilize'));

    const sunflowerNameElement = document.getElementById('sunflowerName');
    if (sunflowerNameElement) {
        sunflowerNameElement.addEventListener('click', renameSunflower);
    }

    // --- KEEP-ALIVE HEARTBEAT ---
    setInterval(() => {
        fetch(`${API_URL}/ping`).catch(e => console.log("Heartbeat failed", e));
    }, 1000 * 60 * 5);
});

async function loadSunflowerData() {
    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${API_URL}/data/${currentUserId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const result = await response.json();

        if (result.success) {
            localData.sunflower = result.data.sunflower || { name: "Sunny", level: 1, exp: 0, stage: "Seed", lastWatered: 0, lastFertilized: 0 };
            renderSunflower();
        } else {
            console.error("Failed to load sunflower data");
        }
    } catch (err) {
        console.error("Error connecting to server", err);
    }
}

async function saveSunflowerData() {
    try {
        const token = localStorage.getItem('authToken');
        await fetch(`${API_URL}/data/${currentUserId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ type: 'sunflower', payload: localData.sunflower })
        });
    } catch (err) {
        console.error("Error saving sunflower data", err);
    }
}

function renderSunflower() {
    const s = localData.sunflower;
    if (!s) return;

    // Name & Level
    document.getElementById('sunflowerName').textContent = s.name;
    document.getElementById('sunflowerLevel').textContent = s.level;

    // XP Bar
    const maxExp = s.level * 100;
    const percentage = Math.min((s.exp / maxExp) * 100, 100);
    document.getElementById('sunflowerExpBar').style.width = percentage + '%';
    document.getElementById('xpText').textContent = `${s.exp} / ${maxExp} XP`;

    // Stage & Visual Logic
    const visual = document.getElementById('sunflowerVisual');
    const stageText = document.getElementById('sunflowerStage');

    let stage = "Seed";
    let emoji = "🌱";
    let isImage = false;

    if (s.level >= 10) {
        stage = "Bloomed";
        isImage = true;
    } else if (s.level >= 6) {
        stage = "Growing";
        emoji = "🌻"; // Or a smaller sprout
    } else if (s.level >= 3) {
        stage = "Sprout";
        emoji = "🌿";
    }

    s.stage = stage;
    stageText.textContent = stage;

    if (isImage) {
        visual.innerHTML = `<img src="sunflower_bloomed.png" alt="Sunflower" class="sunflower-image">`;
    } else {
        visual.innerHTML = emoji;
        visual.style.fontSize = "8rem";
    }
}

function interact(action) {
    if (!localData.sunflower) return;
    const s = localData.sunflower;

    if (action === 'water') {
        s.exp += 25;
        showAnimation('💧');
    } else if (action === 'fertilize') {
        s.exp += 50;
        showAnimation('🧪');
    }

    checkLevelUp();
    renderSunflower();
    saveSunflowerData();
}

function showAnimation(emoji) {
    const container = document.querySelector('.sunflower-container');
    const drop = document.createElement('div');
    drop.className = 'water-drop';
    drop.textContent = emoji;
    container.appendChild(drop);

    setTimeout(() => {
        drop.remove();
    }, 1000);
}

function checkLevelUp() {
    const s = localData.sunflower;
    const maxExp = s.level * 100;

    if (s.exp >= maxExp) {
        s.level++;
        s.exp = s.exp - maxExp;
        alert(`🎉 Yay! Your sunflower ${s.name} grew to Level ${s.level}!`);
        renderSunflower();
    }
}

function renameSunflower() {
    const newName = prompt("Enter a new name for your sunflower:", localData.sunflower.name);
    if (newName && newName.trim()) {
        localData.sunflower.name = newName.trim();
        renderSunflower();
        saveSunflowerData();
    }
}
