require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');


const app = express();
// Trust only the first proxy (Render's load balancer) - required for express-rate-limit v8+
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-dev';

app.use(cors());
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "https://cdn.jsdelivr.net"],
            "img-src": ["'self'", "data:", "https://*"],
            "style-src": ["'self'", "'unsafe-inline'"],
        },
    },
}));
app.use(bodyParser.json({ limit: '50mb' })); // Increased limit for images
app.use(express.static(path.join(__dirname, 'public')));

// --- DATA STORE (Simple JSON File Persistence) ---
const DB_FILE = path.join(__dirname, 'database.json');

// Initial Load or Create DB
let db = {
    users: {},     // map userId -> { username, passwordHash, spaceId, partnerId }
    spaces: {},    // map spaceId -> { notes: [], images: [], dates: [] }
    playground: {} // map userId -> { x, y, sprite, lastUpdate, invitingPartner: bool }
};

if (fs.existsSync(DB_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (err) {
        console.error("Error reading DB, starting fresh.");
    }
}

async function saveDB() {
    try {
        await fs.promises.writeFile(DB_FILE, JSON.stringify(db, null, 2));
    } catch (err) {
        console.error("Critical error saving database:", err);
    }
}

// --- CONSTANTS ---
const INITIAL_PET = { name: "Lovebug", level: 3, exp: 0, mood: "Happy", lastFed: 0 };
const INITIAL_SUNFLOWER = { name: "Sunny", level: 1, exp: 0, stage: "Seed", lastWatered: 0, lastFertilized: 0 };

// --- PASSWORD MIGRATION ---
async function migratePasswords() {
    let migratedCount = 0;
    for (const userId in db.users) {
        const user = db.users[userId];
        if (user.password && !user.passwordHash) {
            console.log(`Migrating password for user: ${user.username}`);
            user.passwordHash = await bcrypt.hash(user.password, 10);
            delete user.password; // Remove plain text password
            migratedCount++;
        }
    }
    if (migratedCount > 0) {
        saveDB();
        console.log(`✅ Successfully migrated ${migratedCount} passwords to hashes.`);
    }
}
migratePasswords();

// --- MIDDLEWARE ---
function authenticate(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) return res.status(401).json({ error: "Access Denied: No Token" });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Invalid Token" });
        req.user = user; // { userId: ... }

        // Track Activity
        if (db.users[user.userId]) {
            db.users[user.userId].lastActive = Date.now();
            // Don't saveDB() on every request for performance, 
            // but for this scale it's fine or we can debounce.
            // Let's save periodically or just here for simplicity.
            saveDB();
        }

        next();
    });
}


// --- API ENDPOINTS ---

// 1. REGISTER
app.post('/api/register', async (req, res) => {
    const { username, password, gender } = req.body;

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

    const isAdmin = (username.toLowerCase() === 'admin' || username === 'Aung Nyi Nyi Thant');

    db.users[userId] = {
        id: userId,
        username,
        passwordHash, // Store hash, not plain text
        gender: gender || null,
        spaceId,
        partnerId: null,
        createdAt: Date.now(),
        lastActive: Date.now(),
        isAdmin: isAdmin
    };


    // Create default space
    db.spaces[spaceId] = {
        notes: [],
        images: [],
        dates: [],
        pet: { ...INITIAL_PET },
        sunflower: { ...INITIAL_SUNFLOWER }
    };

    saveDB();

    // Issue Token
    const token = jwt.sign({ userId: userId }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ success: true, userId, username, spaceId, token: token });
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

    // Verify password against hash
    const validPass = await bcrypt.compare(password, user.passwordHash || "");

    if (validPass) {
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            success: true,
            userId: user.id,
            username: user.username,
            gender: user.gender,
            partnerId: user.partnerId,
            isAdmin: !!user.isAdmin || (user.username.toLowerCase() === 'admin' || user.username === 'Aung Nyi Nyi Thant'),
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
    if (!db.spaces[spaceId]) {
        db.spaces[spaceId] = { notes: [], images: [], dates: [], pet: { ...INITIAL_PET } };
    } else if (!db.spaces[spaceId].pet) {
        // Migration/Repair: If space exists but pet is missing
        db.spaces[spaceId].pet = { ...INITIAL_PET };
        saveDB();
    }

    // Sunflower Migration
    if (!db.spaces[spaceId].sunflower) {
        db.spaces[spaceId].sunflower = { ...INITIAL_SUNFLOWER };
        saveDB();
    }
    const spaceData = db.spaces[spaceId];

    // Also fetch partner username if exists
    let partnerName = null;
    if (user.partnerId) {
        partnerName = db.users[user.partnerId]?.username;
    }


    res.json({
        success: true,
        data: spaceData,
        username: user.username,
        gender: user.gender,
        isAdmin: !!user.isAdmin || (user.username.toLowerCase() === 'admin' || user.username === 'Aung Nyi Nyi Thant'),
        partnerName: partnerName,
        partnerGender: user.partnerId ? db.users[user.partnerId]?.gender : null,
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
    if (!db.spaces[spaceId]) db.spaces[spaceId] = { notes: [], images: [], dates: [], pet: { ...INITIAL_PET }, sunflower: { ...INITIAL_SUNFLOWER } };

    if (['notes', 'images', 'dates', 'pet', 'sunflower'].includes(type)) {
        if (type === 'pet') {
            console.log(`[POST] Saving pet data for user ${userId}:`, payload);
        }
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
        db.spaces[currentUser.spaceId] = {
            notes: [],
            images: [],
            dates: [],
            pet: { ...INITIAL_PET }
        };
    }

    // Reset Partner User (if they exist)
    if (partnerUser) {
        partnerUser.partnerId = null;
        partnerUser.spaceId = `SPACE_${partnerId}`; // Return them to their personal space

        if (!db.spaces[partnerUser.spaceId]) {
            db.spaces[partnerUser.spaceId] = {
                notes: [],
                images: [],
                dates: [],
                pet: { ...INITIAL_PET }
            };
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

// 7. ADMIN DASHBOARD
app.get('/api/admin/users', authenticate, (req, res) => {
    const requestUser = db.users[req.user.userId];
    const isSystemAdmin = requestUser && (requestUser.isAdmin || requestUser.username.toLowerCase() === 'admin' || requestUser.username === 'Aung Nyi Nyi Thant');

    if (!requestUser || !isSystemAdmin) {
        return res.status(403).json({ error: "Admin access required" });
    }

    const userList = Object.values(db.users).map(u => {
        let partnerName = null;
        if (u.partnerId) {
            partnerName = db.users[u.partnerId]?.username || "Unknown";
        }
        return {
            id: u.id,
            username: u.username,
            createdAt: u.createdAt || 0,
            lastActive: u.lastActive || 0,
            isAdmin: !!u.isAdmin,
            partnerId: u.partnerId || null,
            partnerName: partnerName
        };
    });

    res.json({ success: true, users: userList });
});

// 8. USER GENDER UPDATE
app.post('/api/user/update-gender', authenticate, (req, res) => {
    const { gender } = req.body;
    const user = db.users[req.user.userId];

    if (!user) return res.status(404).json({ error: "User not found" });
    if (!['Male', 'Female', 'Other'].includes(gender)) {
        return res.status(400).json({ error: "Invalid gender selection" });
    }

    user.gender = gender;
    saveDB();
    res.json({ success: true, message: "Gender updated successfully" });
});

// 9. ADMIN UPDATE USER GENDER
app.post('/api/admin/update-user-gender', authenticate, (req, res) => {
    const requestUser = db.users[req.user.userId];
    const isSystemAdmin = requestUser && (requestUser.isAdmin || requestUser.username.toLowerCase() === 'admin' || requestUser.username === 'Aung Nyi Nyi Thant');

    if (!requestUser || !isSystemAdmin) {
        return res.status(403).json({ error: "Admin access required" });
    }

    const { targetUserId, gender } = req.body;
    const targetUser = db.users[targetUserId];

    if (!targetUser) return res.status(404).json({ error: "Target user not found" });
    if (gender !== null && !['Male', 'Female', 'Other'].includes(gender)) {
        return res.status(400).json({ error: "Invalid gender selection" });
    }

    targetUser.gender = (gender === "null" || gender === null) ? null : gender;
    saveDB();
    res.json({ success: true, message: "User gender updated by admin" });
});

// 10. PLAYGROUND SYNC
app.post('/api/playground/update-pos', authenticate, (req, res) => {
    const { x, y, sprite } = req.body;
    const userId = req.user.userId;

    db.playground[userId] = {
        x, y, sprite,
        lastUpdate: Date.now(),
        invitingPartner: db.playground[userId]?.invitingPartner || false
    };

    // Auto-save periodically or just here
    // saveDB(); // Maybe too frequent for movement? Let's keep in-memory for playground mostly.

    res.json({ success: true });
});

app.get('/api/playground/status/:userId', authenticate, (req, res) => {
    const targetId = req.params.userId;
    const user = db.playground[targetId];

    if (!user) return res.json({ success: false });

    // Clean up old sessions (e.g. 30s inactivity)
    if (Date.now() - user.lastUpdate > 30000) {
        delete db.playground[targetId];
        return res.json({ success: false });
    }

    res.json({
        success: true,
        x: user.x,
        y: user.y,
        sprite: user.sprite,
        invitingPartner: user.invitingPartner
    });
});

app.post('/api/playground/invite', authenticate, (req, res) => {
    const userId = req.user.userId;
    if (!db.playground[userId]) {
        db.playground[userId] = { x: 400, y: 300, sprite: 'idle', lastUpdate: Date.now(), invitingPartner: true };
    } else {
        db.playground[userId].invitingPartner = true;
    }
    res.json({ success: true });
});

// Start Server
// --- STAY-ALIVE HEARTBEAT ---
app.get('/api/ping', (req, res) => {
    res.json({ success: true, timestamp: Date.now() });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
