const API_URL = 'https://keepmemories.onrender.com/api';
const currentUserId = localStorage.getItem('currentUserId');

if (!currentUserId) {
    window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', () => {
    // Theme
    const savedTheme = localStorage.getItem('selected-theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    }

    loadProfile();

    // Copy ID functionality
    const idBadge = document.getElementById('idBadge');
    idBadge.addEventListener('click', () => {
        const idText = document.getElementById('userId').textContent;
        navigator.clipboard.writeText(idText).then(() => {
            const original = idBadge.innerHTML;
            idBadge.innerHTML = 'Copied! ✅';
            setTimeout(() => {
                idBadge.innerHTML = original;
            }, 1500);
        });
    });

    // Invite functionality
    const sendInviteBtn = document.getElementById('sendInviteBtn');
    sendInviteBtn.addEventListener('click', () => {
        const targetId = document.getElementById('inviteInput').value.trim();
        if (targetId) {
            invitePartner(targetId);
        }
    });

    // Logout functionality
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (confirm("Are you sure you want to log out?")) {
                localStorage.removeItem('currentUserId');
                window.location.href = 'index.html';
            }
        });
    }

    // Disconnect functionality
    const disconnectBtn = document.getElementById('disconnectBtn');
    if (disconnectBtn) {
        disconnectBtn.addEventListener('click', () => {
            if (confirm("Are you sure you want to stop keeping memories together? 💔\nThis will unlink your accounts.")) {
                disconnectPartner();
            }
        });
    }
});

async function loadProfile() {
    try {
        const token = localStorage.getItem('authToken');
        // reuse the data endpoint to get user info/ID
        const response = await fetch(`${API_URL}/data/${currentUserId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 401) {
            window.location.href = 'index.html';
            return;
        }

        const result = await response.json();

        if (result.success) {
            const username = localStorage.getItem('currentUsername') || 'Friend';

            document.getElementById('profileUsername').textContent = username;
            document.getElementById('userId').textContent = result.myId;
            document.getElementById('avatarInitial').textContent = username.charAt(0).toUpperCase();

            // Check if partnered
            if (result.partnerName) {
                const discBtn = document.getElementById('disconnectBtn');
                if (discBtn) {
                    discBtn.style.display = 'block';
                    discBtn.innerText = `Disconnect from ${result.partnerName} 💔`;
                }
            }
        }
    } catch (err) {
        console.error("Error loading profile", err);
    }
}

async function disconnectPartner() {
    try {
        const response = await fetch(`${API_URL}/disconnect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUserId })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Server Error (${response.status}): ${text.substring(0, 100)}...`);
        }

        const result = await response.json();

        if (result.success) {
            alert(result.message);
            location.reload();
        } else {
            alert(result.error);
        }
    } catch (err) {
        console.error("Disconnect Error:", err);
        alert("Error disconnecting: " + err.message);
    }
}

async function invitePartner(targetId) {
    const btn = document.getElementById('sendInviteBtn');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Sending... 🕊️";

    try {
        const response = await fetch(`${API_URL}/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUserId, targetId: targetId })
        });
        const result = await response.json();

        if (result.success) {
            alert(result.message);
            window.location.href = 'home.html';
        } else {
            alert(result.error);
        }
    } catch (err) {
        alert("Error sending invite");
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
}
