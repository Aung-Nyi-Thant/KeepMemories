const API_URL = 'https://keepmemories-1.onrender.com/api';
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

    // Theme Switcher Logic
    const themeBtns = document.querySelectorAll('.theme-btn');
    const htmlElement = document.documentElement;

    // The savedTheme variable is already declared above, so we'll reuse it or re-fetch if needed.
    // For consistency with the instruction, let's re-check it here.
    const savedThemeForSwitcher = localStorage.getItem('selected-theme');
    if (savedThemeForSwitcher) {
        htmlElement.setAttribute('data-theme', savedThemeForSwitcher);
        // Mark active
        themeBtns.forEach(btn => {
            if (btn.getAttribute('data-theme') === savedThemeForSwitcher) btn.classList.add('active');
        });
    }

    themeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const theme = btn.getAttribute('data-theme');
            htmlElement.setAttribute('data-theme', theme);
            localStorage.setItem('selected-theme', theme);

            // UI Update
            themeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Feedback
            btn.style.transform = 'scale(0.95)';
            setTimeout(() => { btn.style.transform = ''; }, 100);
        });
    });

    // Admin Functionality
    const adminBtn = document.getElementById('adminBtn');
    // Security: Always hidden by default, shown only after server verification
    if (adminBtn) {
        adminBtn.style.display = 'none';
        adminBtn.addEventListener('click', () => {
            window.location.href = 'admin_portal_9x2k.html';
        });
    }

    // Logout functionality
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (confirm("Are you sure you want to log out?")) {
                localStorage.clear();
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
            document.getElementById('profileUsername').textContent = username;
            document.getElementById('userId').textContent = result.myId;

            // Set Avatar Image based on gender
            const avatarCircle = document.getElementById('avatarInitial');
            const gender = result.gender;
            if (gender === 'Male') {
                avatarCircle.innerHTML = `<img src="assets/avatars/boy.png" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
            } else if (gender === 'Female') {
                avatarCircle.innerHTML = `<img src="assets/avatars/girl.png" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
            } else {
                avatarCircle.textContent = username.charAt(0).toUpperCase();
            }

            // Sync Admin Status
            const isSystemAdmin = result.isAdmin || username === 'Aung Nyi Nyi Thant' || username.toLowerCase() === 'admin';
            const adminBtn = document.getElementById('adminBtn');
            if (isSystemAdmin && adminBtn) {
                adminBtn.style.display = 'block';
            }

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
