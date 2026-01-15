const API_URL = 'https://keepmemories.onrender.com/api';
const currentUserId = localStorage.getItem('currentUserId');

if (!currentUserId) {
    window.location.href = 'index.html';
}

// Global State
let localData = {
    pet: { name: "Lovebug", level: 3, exp: 0, mood: "Happy", lastFed: 0 }
};

document.addEventListener('DOMContentLoaded', () => {
    loadPetData();

    // Theme
    const savedTheme = localStorage.getItem('selected-theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    }

    // Event Listeners
    document.getElementById('feedBtn').addEventListener('click', () => interact('feed'));
    document.getElementById('playBtn').addEventListener('click', () => interact('play'));
    document.getElementById('walkBtn').addEventListener('click', () => interact('walk'));
    document.getElementById('sleepBtn').addEventListener('click', () => interact('sleep'));
});

async function loadPetData() {
    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${API_URL}/data/${currentUserId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const result = await response.json();

        if (result.success) {
            // Extract pet data specifically
            localData.pet = result.data.pet || { name: "Lovebug", level: 3, exp: 0, mood: "Happy", lastFed: 0 };
            renderPet();
        } else {
            console.error("Failed to load pet data");
        }
    } catch (err) {
        console.error("Error connecting to server", err);
    }
}

async function savePetData() {
    try {
        const token = localStorage.getItem('authToken');
        await fetch(`${API_URL}/data/${currentUserId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ type: 'pet', payload: localData.pet })
        });
    } catch (err) {
        console.error("Error saving pet data", err);
    }
}

function renderPet() {
    const p = localData.pet;
    if (!p) return;

    // Name & Level
    document.getElementById('petName').textContent = p.name;
    document.getElementById('petLevel').textContent = p.level;
    document.getElementById('petMood').textContent = p.mood || "Happy 😊";

    // XP Bar
    const maxExp = p.level * 100;
    const percentage = Math.min((p.exp / maxExp) * 100, 100);
    document.getElementById('petExpBar').style.width = percentage + '%';
    document.getElementById('xpText').textContent = `${p.exp} / ${maxExp} XP`;

    // Avatar Logic
    const dogContainer = document.getElementById('dogAvatar');

    // Remove old stage classes
    dogContainer.classList.remove('stage-baby', 'stage-teen', 'stage-adult');

    if (p.level < 3) {
        // Level 1-2: Egg
        dogContainer.innerHTML = `<img src="egg.png" alt="Egg" class="dog-img">`;
        dogContainer.classList.add('stage-baby'); // Keep it small/baby sized
    } else {
        // Level 3+: Dog
        dogContainer.innerHTML = `<img src="dog.png" alt="Cute Dog" class="dog-img">`;

        if (p.level <= 5) {
            dogContainer.classList.add('stage-teen'); // Level 3-5 (Normal Size)
        } else {
            dogContainer.classList.add('stage-adult'); // Level 6+ (Big)
        }
    }

    // Add sleeping overlay if needed
    if (p.mood === 'Sleeping 💤') {
        dogContainer.classList.add('sleeping');
    } else {
        dogContainer.classList.remove('sleeping');
    }

}

function interact(action) {
    if (!localData.pet) return;
    const p = localData.pet;
    const isEgg = p.level < 3;

    // Reset mood if sleeping and woken up (unless action is sleep)
    if (p.mood === 'Sleeping 💤' && action !== 'sleep') {
        p.mood = 'Happy 😊';
    }

    let animClass = '';

    switch (action) {
        case 'feed':
            p.exp += 15;
            p.mood = 'Full 😋';
            p.lastFed = Date.now();
            animClass = isEgg ? 'shake' : 'bounce';
            break;
        case 'play':
            p.exp += 20;
            p.mood = 'Excited 😆';
            animClass = isEgg ? 'shake' : 'dance';
            break;
        case 'walk':
            p.exp += 25;
            p.mood = 'Tired 🥵';
            animClass = isEgg ? 'shake' : 'walk-anim';
            break;
        case 'sleep':
            p.exp += 5;
            p.mood = 'Sleeping 💤';
            // No specific action animation for sleep, just the persistent Zzzs and grayscale
            break;
    }

    if (animClass) animateDog(animClass);

    checkLevelUp();
    renderPet();
    savePetData();
}

function animateDog(animClass) {
    const dog = document.getElementById('dogAvatar');
    // Remove previous action classes (excluding evolution stage and sleeping)
    const stages = ['stage-baby', 'stage-teen', 'stage-adult', 'sleeping'];
    dog.className = 'dog-avatar ' + [...dog.classList].filter(c => stages.includes(c)).join(' ');

    void dog.offsetWidth; // Trigger reflow
    dog.classList.add(animClass);

    // For non-infinite animations, remove after completion
    if (animClass !== 'walk-anim') {
        setTimeout(() => {
            dog.classList.remove(animClass);
        }, 1000); // Wait for animation duration
    }
}

function checkLevelUp() {
    const p = localData.pet;
    const maxExp = p.level * 100;

    if (p.exp >= maxExp) {
        p.level++;
        p.exp = p.exp - maxExp;
        alert(`🎉 Woof! ${p.name} grew to Level ${p.level}!`);
        // Force re-render to potentially update avatar
        renderPet();
    }
}

window.renamePet = () => {
    const newName = prompt("Enter a new name for your dog:", localData.pet.name);
    if (newName && newName.trim()) {
        localData.pet.name = newName.trim();
        renderPet();
        savePetData();
    }
};
