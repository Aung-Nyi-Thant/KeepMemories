const API_URL = 'https://keepmemories-1.onrender.com/api';

document.addEventListener('DOMContentLoaded', () => {
    // Theme
    const savedTheme = localStorage.getItem('selected-theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    }

    loadUsers();

    // Close Modal Logic
    const userModalOverlay = document.getElementById('userModalOverlay');
    const closeUserModal = document.getElementById('closeUserModal');
    if (closeUserModal && userModalOverlay) {
        closeUserModal.addEventListener('click', () => {
            userModalOverlay.style.display = 'none';
        });

        // Close on clicking outside
        userModalOverlay.addEventListener('click', (e) => {
            if (e.target === userModalOverlay) {
                userModalOverlay.style.display = 'none';
            }
        });
    }
});

async function loadUsers() {
    const token = localStorage.getItem('authToken');
    const tbody = document.querySelector('#usersTable tbody');

    if (!token) {
        window.location.href = 'index.html';
        return;
    }

    try {
        const response = await fetch(`${API_URL}/admin/users`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 403) {
            alert("Access Denied: Admins only! 🚫");
            window.location.href = 'home.html';
            return;
        }

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }

        const result = await response.json();

        if (result.success) {
            renderTable(result.users);
        } else {
            console.error("Failed to load users:", result.error);
            tbody.innerHTML = `<tr><td colspan="5">Error: ${result.error || 'Failed to load users'}</td></tr>`;
        }
    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="5">Error connecting to server</td></tr>`;
    }
}

function renderTable(users) {
    const tbody = document.querySelector('#usersTable tbody');
    tbody.innerHTML = '';

    // Sort by Last Active (most recent first)
    users.sort((a, b) => b.lastActive - a.lastActive);

    users.forEach(user => {
        const tr = document.createElement('tr');

        // Logic for "Online" status (e.g., active in last 5 mins)
        const fiveMinsAgo = Date.now() - 5 * 60 * 1000;
        const isOnline = user.lastActive > fiveMinsAgo;
        const statusClass = isOnline ? 'online' : 'offline';
        const statusText = isOnline ? 'Online Now' : 'Offline';

        // Date Formatting
        const createdDate = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown'; // Legacy users might be 0
        const activeDate = user.lastActive ? new Date(user.lastActive).toLocaleString() : 'Never';

        // Account Age calculation
        let ageText = "N/A";
        if (user.createdAt) {
            const diffTime = Math.abs(Date.now() - user.createdAt);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            ageText = `${diffDays} days`;
        }

        tr.innerHTML = `
            <td>
                ${user.username} ${user.isAdmin ? '👑' : ''}
            </td>
            <td>${createdDate}</td>
            <td>${activeDate}</td>
            <td>${ageText}</td>
            <td><span class="status-dot ${statusClass}"></span> ${statusText}</td>
        `;

        tbody.appendChild(tr);

        // Click to show details
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => {
            showUserDetails(user);
        });
    });
}

function showUserDetails(user) {
    const avatarCircle = document.getElementById('modalAvatar');
    if (user.gender === 'Male') {
        avatarCircle.innerHTML = `<img src="assets/avatars/boy.png" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
    } else if (user.gender === 'Female') {
        avatarCircle.innerHTML = `<img src="assets/avatars/girl.png" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
    } else {
        avatarCircle.textContent = '👤';
    }

    document.getElementById('detailUserId').textContent = user.id;
    document.getElementById('modalUserName').textContent = user.username;
    document.getElementById('detailRole').textContent = user.isAdmin ? 'Administrator 👑' : 'Standard User';

    // Partner info
    const partnerSpan = document.getElementById('detailPartner');
    if (user.partnerId) {
        partnerSpan.textContent = `${user.partnerName} (ID: ${user.partnerId})`;
    } else {
        partnerSpan.textContent = 'None (Single)';
    }

    // Dates
    const createdDate = user.createdAt ? new Date(user.createdAt).toLocaleString() : 'Legacy Account';
    const activeDate = user.lastActive ? new Date(user.lastActive).toLocaleString() : 'Never';

    document.getElementById('detailCreated').textContent = createdDate;
    document.getElementById('detailActive').textContent = activeDate;

    document.getElementById('detailActive').textContent = activeDate;

    // Gender Select
    const genderSelect = document.getElementById('detailGenderSelect');
    genderSelect.value = user.gender || "null";

    const updateGenderBtn = document.getElementById('updateGenderBtn');
    // Clear old listeners if any (by replacing node or just reassignment)
    updateGenderBtn.onclick = () => {
        adminUpdateUserGender(user.id, genderSelect.value);
    };

    // Show it
    const overlay = document.getElementById('userModalOverlay');
    if (overlay) overlay.style.display = 'flex';
}

async function adminUpdateUserGender(targetUserId, gender) {
    const token = localStorage.getItem('authToken');
    try {
        const response = await fetch(`${API_URL}/admin/update-user-gender`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ targetUserId, gender: (gender === "null" ? null : gender) })
        });

        const result = await response.json();
        if (result.success) {
            alert("User gender updated!");
            loadUsers(); // Refresh table
        } else {
            alert("Update failed: " + result.error);
        }
    } catch (err) {
        console.error(err);
        alert("Server error");
    }
}
