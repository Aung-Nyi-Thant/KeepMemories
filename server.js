const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');


const app = express();
const PORT = 3000;
const JWT_SECRET = 'super-pro-secret-key-123!@#'; // In production, use ENV var

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); // Increased limit for images
app.use(express.static(path.join(__dirname, 'public')));

// --- DATA STORE (Simple JSON File Persistence) ---
const DB_FILE = path.join(__dirname, 'database.json');

// Initial Load or Create DB
let db = {
    users: {},     // map userId -> { username, passwordHash, spaceId, partnerId }
    spaces: {}     // map spaceId -> { notes: [], images: [], dates: [] }
};

if (fs.existsSync(DB_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (err) {
        console.error("Error reading DB, starting fresh.");
    }
}

function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// --- HELPER FUNCTIONS ---
function generateId() {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
}

// --- MIDDLEWARE ---
function authenticate(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) return res.status(401).json({ error: "Access Denied: No Token" });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Invalid Token" });
        req.user = user; // { userId: ... }
        next();
    });
}

// --- API ENDPOINTS ---

// 1. REGISTER
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
    }

    // Check if username exists (simple check)
    const existingUser = Object.values(db.users).find(u => u.username === username);
    if (existingUser) {
        return res.status(400).json({ error: "Username already taken" });
    }

    const userId = generateId(); // Unique User ID (e.g., 9X2A1M)
    const spaceId = `SPACE_${userId}`; // Default space for new user

    // HASH PASSWORD
    const passwordHash = await bcrypt.hash(password, 10);

    db.users[userId] = {
        id: userId,
        username,
        passwordHash, // Store hash, not plain text
        spaceId,
        partnerId: null
    };

    // Create default space
    db.spaces[spaceId] = { notes: [], images: [], dates: [] };

    saveDB();

    // Issue Token
    consttoken = jwt.sign({ userId: userId }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ success: true, userId, username, spaceId, token: consttoken });
});

// 2. LOGIN
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 requests per windowMs
    message: "Too many login attempts from this IP, please try again after 15 minutes",
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

app.post('/api/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;

    // Find user by username
    const user = Object.values(db.users).find(u => u.username === username);

    if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
    }

    // Compare Password (support both legacy plain text for old accounts and new hashes)
    let validPass = false;
    if (user.passwordHash) {
        validPass = await bcrypt.compare(password, user.passwordHash);
    } else if (user.password) {
        // Fallback for old accounts (plaintext)
        validPass = (user.password === password);
        // Optional: Upgrade to hash on next login?
    }

    if (validPass) {
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            success: true,
            userId: user.id,
            username: user.username,
            partnerId: user.partnerId,
            token: token
        });
    } else {
        res.status(401).json({ error: "Invalid credentials" });
    }
});

// 3. GET DATA (Protected)
app.get('/api/data/:userId', authenticate, (req, res) => {
    // Ensure requesting user matches the token user
    if (req.user.userId !== req.params.userId) {
        // Allow if partners? For strict security, yes. 
        // But for now, let's keep it simple: You can only ask for YOUR data.
        return res.status(403).json({ error: "Unauthorized access to another user's data" });
    }

    const { userId } = req.params;
    const user = db.users[userId];

    if (!user) return res.status(404).json({ error: "User not found" });

    const spaceId = user.spaceId;
    const spaceData = db.spaces[spaceId] || { notes: [], images: [], dates: [] };

    // Also fetch partner username if exists
    let partnerName = null;
    if (user.partnerId) {
        partnerName = db.users[user.partnerId]?.username;
    }

    res.json({
        success: true,
        data: spaceData,
        partnerName: partnerName,
        myId: userId
    });
});

// 4. SAVE DATA (Protected)
app.post('/api/data/:userId', authenticate, (req, res) => {
    const { userId } = req.params;
    const { type, payload } = req.body; // type: 'notes' | 'images' | 'dates'

    const user = db.users[userId];
    if (!user) return res.status(404).json({ error: "User not found" });

    const spaceId = user.spaceId;
    if (!db.spaces[spaceId]) db.spaces[spaceId] = { notes: [], images: [], dates: [] };

    if (['notes', 'images', 'dates'].includes(type)) {
        db.spaces[spaceId][type] = payload;
        saveDB();
        res.json({ success: true });
    } else {
        res.status(400).json({ error: "Invalid data type" });
    }
});

// 5. INVITE / LINK PARTNER
app.post('/api/invite', (req, res) => {
    const { userId, targetId } = req.body;

    const currentUser = db.users[userId];
    const targetUser = db.users[targetId];

    if (!currentUser || !targetUser) {
        return res.status(404).json({ error: "User or Partner ID not found" });
    }

    if (userId === targetId) {
        return res.status(400).json({ error: "You cannot invite yourself!" });
    }

    // Link them!
    // STRATEGY: Queue an invitation instead of instant link.

    // Check if there is already a pending invite
    if (targetUser.pendingInvite) {
        return res.status(400).json({ error: "User already has a pending invitation!" });
    }

    if (targetUser.partnerId) {
        return res.status(400).json({ error: "User already has a partner!" });
    }

    // Store pending invite on the target user
    targetUser.pendingInvite = {
        fromId: userId,
        fromName: currentUser.username,
        timestamp: Date.now()
    };

    saveDB();

    res.json({
        success: true,
        message: `Invitation letter sent to ${targetUser.username}! 💌`
    });
});

// 5b. CHECK NOTIFICATIONS (Poll for invites)
app.get('/api/notifications/:userId', (req, res) => {
    const { userId } = req.params;
    const user = db.users[userId];

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({
        success: true,
        pendingInvite: user.pendingInvite || null
    });
});

// 5c. RESPOND TO INVITE
app.post('/api/invite/respond', (req, res) => {
    const { userId, accept } = req.body;
    const currentUser = db.users[userId];

    if (!currentUser || !currentUser.pendingInvite) {
        return res.status(400).json({ error: "No pending invitation found." });
    }

    const senderId = currentUser.pendingInvite.fromId;
    const senderUser = db.users[senderId];

    if (accept) {
        if (!senderUser) {
            currentUser.pendingInvite = null; // Sender doesn't exist anymore?
            saveDB();
            return res.status(400).json({ error: "Sender no longer exists." });
        }

        // --- PERFORM LINKING (The old logic) ---
        // Acceptor (Current User) joins Sender's Space
        const sharedSpaceId = senderUser.spaceId;

        currentUser.spaceId = sharedSpaceId;
        currentUser.partnerId = senderId;
        senderUser.partnerId = userId;

        currentUser.pendingInvite = null; // Clear invite
        saveDB();

        res.json({ success: true, message: "Invitation Accepted! You are now connected. 💕" });

    } else {
        // Declined
        currentUser.pendingInvite = null; // Just clear it
        saveDB();
        res.json({ success: true, message: "Invitation declined." });
    }
});

// 6. DISCONNECT / BREAK UP
app.post('/api/disconnect', (req, res) => {
    const { userId } = req.body;
    const currentUser = db.users[userId];

    if (!currentUser) return res.status(404).json({ error: "User not found" });

    const partnerId = currentUser.partnerId;
    if (!partnerId) return res.status(400).json({ error: "You don't have a partner to disconnect from!" });

    const partnerUser = db.users[partnerId];

    // Reset Current User
    currentUser.partnerId = null;
    currentUser.spaceId = `SPACE_${userId}`; // Reset to their original personal space

    // Ensure that space exists (it should, but just in case)
    if (!db.spaces[currentUser.spaceId]) {
        db.spaces[currentUser.spaceId] = { notes: [], images: [], dates: [] };
    }

    // Reset Partner User (if they exist)
    if (partnerUser) {
        partnerUser.partnerId = null;
        partnerUser.spaceId = `SPACE_${partnerId}`; // Return them to their personal space

        if (!db.spaces[partnerUser.spaceId]) {
            db.spaces[partnerUser.spaceId] = { notes: [], images: [], dates: [] };
        }
    }

    // Note: The shared data stays in the space they both left.
    try {
        saveDB();
        res.json({ success: true, message: "You have disconnected from your partner." });
    } catch (err) {
        console.error("Error saving DB:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
