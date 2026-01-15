const API_URL = 'https://keepmemories.onrender.com/api';
const currentUserId = localStorage.getItem('currentUserId');

if (!currentUserId) {
    window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initial Setup: Load Data from Backend
    // --- TODAY'S DATE ---
    const currentDay = document.getElementById('currentDay');
    const currentMonthYear = document.getElementById('currentMonthYear');
    if (currentDay && currentMonthYear) {
        const now = new Date();
        currentDay.textContent = now.getDate();
        currentMonthYear.textContent = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    // 1. Initial Setup: Load Data from Backend
    loadDashboardData();
    checkNotifications();
    renderPetStatus(); // Render initial defaults immediately

    // Logout removed from here, now in profile.js

    // --- NOTES FUNCTIONALITY ---
    const noteInput = document.getElementById('noteInput');
    const addNoteBtn = document.getElementById('addNoteBtn');
    const notesList = document.getElementById('notesList');

    addNoteBtn.addEventListener('click', () => {
        const text = noteInput.value.trim();
        if (text) {
            addNote(text);
        }
    });

    window.deleteNote = (index) => {
        deleteNoteItem(index);
    };


    // --- GALLERY FUNCTIONALITY ---
    const imageInput = document.getElementById('imageInput');

    imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function (event) {
                const imgData = event.target.result;
                addImage(imgData);
            };
            reader.readAsDataURL(file);
        }
    });



    const specialDateInput = document.getElementById('specialDateInput');
    const specialDateLabel = document.getElementById('specialDateLabel');
    const addDateBtn = document.getElementById('addDateBtn');

    addDateBtn.addEventListener('click', () => {
        const dateVal = specialDateInput.value;
        const labelVal = specialDateLabel.value.trim();

        if (dateVal && labelVal) {
            addDate({ date: dateVal, label: labelVal });
            specialDateInput.value = '';
            specialDateLabel.value = '';
        }
    });

    // --- PARTNER FUNCTIONALITY ---

    // --- THEME ---
    const savedTheme = localStorage.getItem('selected-theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    }

    // --- KEEP-ALIVE HEARTBEAT ---
    // Pings server every 5 minutes to prevent Render spin-down while active
    setInterval(() => {
        fetch(`${API_URL}/ping`).catch(e => console.log("Heartbeat failed", e));
    }, 1000 * 60 * 5);

});

// --- GLOBAL STATE ---
let localData = {
    notes: [],
    images: [],
    dates: [],
    pet: { name: "Lovebug", level: 3 }
};

// --- API ACTIONS ---

async function loadDashboardData() {
    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${API_URL}/data/${currentUserId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        // If simple 401/403, force logout
        if (response.status === 401 || response.status === 403) {
            alert("Session expired. Please log in again.");
            localStorage.clear();
            window.location.href = 'index.html';
            return;
        }

        const result = await response.json();

        if (result.success) {
            localData = result.data;

            // Update Header
            document.getElementById('displayUsername').textContent = result.username || 'Friend';

            // Store partner info for the heart popup
            if (result.partnerName) {
                document.getElementById('partnerSection').style.display = 'inline';
                document.getElementById('displayPartner').textContent = result.partnerName;

                // Update Popup Data
                document.querySelector('#heartPopup .avatar-circle').textContent = result.partnerName.charAt(0).toUpperCase();
                document.getElementById('popupInfo').textContent = `Connected with ${result.partnerName}`;
                document.getElementById('popupStatus').textContent = "Forever & Always 💕";
            } else {
                document.getElementById('partnerSection').style.display = 'none';

                // Single State Popup
                document.querySelector('#heartPopup .avatar-circle').textContent = result.username.charAt(0).toUpperCase();
                document.getElementById('popupInfo').textContent = "Waiting for a Partner";
                document.getElementById('popupStatus').textContent = "Invite someone special! 💌";
            }

            renderAll();
        } else {
            console.error("Failed to load data");
        }
    } catch (err) {
        console.error("Error connecting to server", err);
    }
}

async function saveData(type) {
    try {
        const token = localStorage.getItem('authToken');
        await fetch(`${API_URL}/data/${currentUserId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ type: type, payload: localData[type] })
        });
    } catch (err) {
        console.error("Error saving data", err);
    }
}

async function invitePartner(targetId) {
    try {
        const response = await fetch(`${API_URL}/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUserId, targetId: targetId })
        });
        const result = await response.json();

        if (result.success) {
            alert(result.message);
            location.reload(); // Reload to see partner name and shared state
        } else {
            alert(result.error);
        }
    } catch (err) {
        alert("Error sending invite");
    }
}

async function disconnectPartner() {
}

async function checkNotifications() {
    try {
        const response = await fetch(`${API_URL}/notifications/${currentUserId}`);
        const result = await response.json();

        if (result.success && result.pendingInvite) {
            showInviteModal(result.pendingInvite);
        }
    } catch (err) {
        console.error("Error checking notifications", err);
    }
}

function showInviteModal(invite) {
    const modal = document.getElementById('inviteModal');
    const nameSpan = document.getElementById('inviterName');
    const acceptBtn = document.getElementById('acceptBtn');
    const declineBtn = document.getElementById('declineBtn');

    nameSpan.textContent = invite.fromName || "A Friend";
    modal.style.display = 'flex';

    acceptBtn.onclick = () => respondToInvite(true);
    declineBtn.onclick = () => respondToInvite(false);
}

async function respondToInvite(accept) {
    try {
        const response = await fetch(`${API_URL}/invite/respond`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUserId, accept: accept })
        });
        const result = await response.json();

        if (result.success) {
            document.getElementById('inviteModal').style.display = 'none';
            alert(result.message);
            if (accept) location.reload();
        } else {
            alert(result.error);
        }
    } catch (err) {
        alert("Error responding to invite");
    }
}

// --- HELPER LOGIC ---

function addNote(text) {
    localData.notes.unshift(text);
    renderNotes();
    saveData('notes');
}

function deleteNoteItem(index) {
    localData.notes.splice(index, 1);
    renderNotes();
    saveData('notes');
}

function addImage(base64) {
    localData.images.unshift(base64);
    renderGallery();
    saveData('images');
}

function addDate(dateObj) {
    localData.dates.push(dateObj);
    localData.dates.sort((a, b) => new Date(a.date) - new Date(b.date));
    renderDates();
    saveData('dates');
}


// --- RENDERING (Copied/Adapted from previous home.js) ---

function renderAll() {
    renderNotes();
    renderGallery();
    renderDates();
    renderPetStatus();
}


function renderNotes() {
    const list = document.getElementById('notesList');
    list.innerHTML = '';
    if (localData.notes.length === 0) {
        list.innerHTML = '<div class="empty-state">No notes yet!</div>';
        return;
    }
    localData.notes.forEach((note, index) => {
        const div = document.createElement('div');
        div.className = 'note-item';
        div.innerHTML = `${note} <span class="delete-note" onclick="deleteNote(${index})">❌</span>`;
        list.appendChild(div);
    });
}

function renderGallery() {
    const grid = document.getElementById('galleryGrid');
    grid.innerHTML = '';
    if (localData.images.length === 0) {
        grid.innerHTML = '<div class="empty-state">No photos yet!</div>';
        return;
    }
    localData.images.forEach((img) => {
        const div = document.createElement('div');
        div.className = 'polaroid';
        div.innerHTML = `<img src="${img}" alt="Memory">`;
        grid.appendChild(div);
    });
}

function renderDates() {
    const list = document.getElementById('datesList');
    list.innerHTML = '';
    localData.dates.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'saved-date';

        const targetDate = new Date(item.date);
        const today = new Date();
        targetDate.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);

        const diffTime = targetDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        let daysText = diffDays === 0 ? "Today!" : diffDays > 0 ? `${diffDays} days left` : `${Math.abs(diffDays)} days ago`;

        li.innerHTML = `
            <div style="flex-grow: 1;">
                <span>${item.label}</span>
                <span class="date-days" style="display:block; font-size: 0.8em;">${daysText}</span>
            </div>
            <span class="delete-note" onclick="deleteDate(${index})" style="position: static; margin-left: 10px;">❌</span>
        `;
        list.appendChild(li);
    });
}

window.deleteDate = (index) => {
    deleteDateItem(index);
};

function deleteDateItem(index) {
    localData.dates.splice(index, 1);
    renderDates();
    saveData('dates');
}

function renderPetStatus() {
    const p = localData.pet || { name: "Lovebug", level: 3 };
    const nameEl = document.getElementById('dashPetName');
    const levelEl = document.getElementById('dashPetLevel');

    if (nameEl && levelEl) {
        nameEl.textContent = p.name;
        levelEl.textContent = p.level;
    }
}

// --- FLOATING HEART LOGIC ---
const heart = document.getElementById('floatingHeart');
const popup = document.getElementById('heartPopup');
let isDragging = false;
let startX, startY, initialLeft, initialTop;
let hasMoved = false;

// Mouse / Touch Events
heart.addEventListener('mousedown', dragStart);
heart.addEventListener('touchstart', dragStart, { passive: false });

document.addEventListener('mousemove', drag);
document.addEventListener('touchmove', drag, { passive: false });

document.addEventListener('mouseup', dragEnd);
document.addEventListener('touchend', dragEnd);

function dragStart(e) {
    initialLeft = heart.offsetLeft;
    initialTop = heart.offsetTop;

    // Get mouse/touch position
    if (e.type === 'touchstart') {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    } else {
        startX = e.clientX;
        startY = e.clientY;
    }

    isDragging = true;
    hasMoved = false;

    // Remove bottom/right positioning to allow left/top to take over
    heart.style.bottom = 'auto';
    heart.style.right = 'auto';
    heart.style.left = initialLeft + 'px';
    heart.style.top = initialTop + 'px';
}

function drag(e) {
    if (!isDragging) return;
    e.preventDefault(); // Prevent scrolling

    let currentX, currentY;

    if (e.type === 'touchmove') {
        currentX = e.touches[0].clientX;
        currentY = e.touches[0].clientY;
    } else {
        currentX = e.clientX;
        currentY = e.clientY;
    }

    const dx = currentX - startX;
    const dy = currentY - startY;

    // Detect if actually moved (to distinguish click from micro-drag)
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        hasMoved = true;
    }

    heart.style.left = (initialLeft + dx) + 'px';
    heart.style.top = (initialTop + dy) + 'px';
}

function dragEnd(e) {
    isDragging = false;
}

// Click Event (Triggered only if not dragged)
heart.addEventListener('click', (e) => {
    if (!hasMoved) {
        toggleHeartPopup(true);
    }
});

window.toggleHeartPopup = (show) => {
    if (show) {
        popup.classList.add('show');
    } else {
        popup.classList.remove('show');
    }
};
