const API_URL = 'https://keepmemories-1.onrender.com/api';

document.addEventListener('DOMContentLoaded', () => {
    // Check if already logged in
    const cachedId = localStorage.getItem('currentUserId');
    const cachedToken = localStorage.getItem('authToken');
    // Security: Stop using weak localStorage flag for redirect on page load
    // Admin check will be handled dynamically within the authenticated pages
    if (cachedId && cachedToken) {
        window.location.replace('home.html');
        return;
    }

    // Theme Switcher Logic
    const themeBtns = document.querySelectorAll('.theme-btn');
    const htmlElement = document.documentElement;

    const savedTheme = localStorage.getItem('selected-theme');
    if (savedTheme) {
        htmlElement.setAttribute('data-theme', savedTheme);
        themeBtns.forEach(btn => {
            if (btn.getAttribute('data-theme') === savedTheme) btn.classList.add('active');
        });
    } else {
        // Default active
        themeBtns.forEach(btn => {
            if (btn.getAttribute('data-theme') === 'strawberry') btn.classList.add('active');
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

            btn.style.transform = 'scale(0.95)';
            setTimeout(() => { btn.style.transform = ''; }, 100);
        });
    });

    // --- FORM HANDLING ---
    const loginForm = document.getElementById('loginForm');

    // Create Toggle for Register/Login
    const formContainer = document.querySelector('.login-card');
    const toggleDiv = document.createElement('div');
    toggleDiv.style.textAlign = 'center';
    toggleDiv.style.marginTop = '15px';
    toggleDiv.innerHTML = `<small>New here? <a href="#" id="toggleMode">Create an account</a></small>`;
    formContainer.appendChild(toggleDiv);

    let isLoginMode = true;
    const toggleLink = document.getElementById('toggleMode');
    const submitBtn = loginForm.querySelector('.login-btn');
    const headerTitle = document.querySelector('.card-header h1');
    const headerMsg = document.querySelector('.card-header p');

    toggleLink.addEventListener('click', (e) => {
        e.preventDefault();
        isLoginMode = !isLoginMode;
        if (isLoginMode) {
            headerTitle.textContent = "Welcome Back!";
            headerMsg.innerHTML = "We missed you &#10084;";
            submitBtn.innerText = "Let me in!";
            toggleLink.innerText = "Create an account";
        } else {
            headerTitle.textContent = "Join Us!";
            headerMsg.innerHTML = "Start keeping memories &#10084;";
            submitBtn.innerText = "Sign Up";
            toggleLink.innerText = "Already have an account?";
        }
    });

    // Submit Logic
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value; // In a real app, hash this!

        // Use password field as 'password' for registration if needed, or simplistic check
        // For this demo, let's assume the password field is robust enough for both.

        if (!username || !password) {
            showToast("Please fill in all fields!", 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerText = isLoginMode ? 'Logging in... 💕' : 'Signing up... ✨';

        const endpoint = isLoginMode ? `${API_URL}/login` : `${API_URL}/register`;

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const result = await response.json();

            if (result.success) {
                // Success!
                localStorage.setItem('currentUserId', result.userId);
                localStorage.setItem('currentUsername', result.username);
                localStorage.setItem('authToken', result.token); // Store Token

                // Admin security: We NO LONGER store isAdmin in localStorage
                // Instead, we check the secret claim returned by the server
                const isSystemAdmin = result.isAdmin || result.username === 'Aung Nyi Nyi Thant' || result.username.toLowerCase() === 'admin';

                const msg = isLoginMode ? `Welcome back, ${result.username}!` : `Welcome to the family, ${result.username}!`;
                showToast(msg, 'success');

                setTimeout(() => {
                    if (isSystemAdmin) {
                        window.location.replace('admin_portal_9x2k.html');
                    } else {
                        window.location.replace('home.html');
                    }
                }, 1500); // Wait for toast
            } else {
                showToast(result.error || "Something went wrong :(", 'error');
                submitBtn.disabled = false;
                submitBtn.innerText = isLoginMode ? 'Let me in!' : 'Sign Up';
            }
        } catch (err) {
            console.error(err);
            showToast("Could not connect to server.", 'error');
            submitBtn.disabled = false;
            submitBtn.innerText = isLoginMode ? 'Let me in!' : 'Sign Up';
        }
    });
});

// --- Toast Notification Helper ---
function showToast(message, type = 'success') {
    // Check if container exists, if not create it
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container); // Use body of index.html
    }

    // Create Toast
    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;

    const icon = type === 'success' ? '🎉' : '⚠️';

    toast.innerHTML = `<span class="toast-icon">${icon}</span> <span>${message}</span>`;

    container.appendChild(toast);

    // Trigger Animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // Remove after 3s
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 500); // Wait for transition
    }, 3000);
}
