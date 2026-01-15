const API_URL = 'https://keepmemories.onrender.com/api';

document.addEventListener('DOMContentLoaded', () => {
    // Theme
    const savedTheme = localStorage.getItem('selected-theme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    }

    loadUsers();
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

        const result = await response.json();

        if (result.success) {
            renderTable(result.users);
        } else {
            tbody.innerHTML = `<tr><td colspan="5">Error: ${result.error}</td></tr>`;
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
    });
}
