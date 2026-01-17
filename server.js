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
const { Server } = require('socket.io');
const http = require('http');

const app = express();

// Helper to generate unique IDs
function generateId(length = 6) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Trust only the first proxy (Render's load balancer) - required for express-rate-limit v8+
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-dev';

// Create HTTP server and Socket.IO instance
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Store active playground connections - tracks ALL players for shared world
const playgroundConnections = new Map(); // oderId -> { socketId, oderId, username, gender, color, x, y }

// Store active private chat rooms (ephemeral - not persisted)
const privateRooms = new Map(); // roomId -> { members: [oderId1, oderId2], messages: [], createdAt }

// Store pending chat invites
const pendingInvites = new Map(); // `${fromId}_${toId}` -> { fromId, toId, timestamp }

// Proximity detection config
const PROXIMITY_RADIUS = 100; // pixels - players within this distance can chat

app.use(cors());
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "https://cdn.jsdelivr.net", "https://cdn.socket.io"],
            "img-src": ["'self'", "data:", "blob:", "https://*"],
            "style-src": ["'self'", "'unsafe-inline'"],
            "connect-src": ["'self'", "ws:", "wss:", "http:", "https:"],
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
        const loadedData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        db = { ...db, ...loadedData }; // Merge loaded data with defaults

        // Ensure playground exists even if not in the file
        if (!db.playground) db.playground = {};
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
    const { targetUserId } = req.body;
    const targetId = targetUserId || db.users[userId]?.partnerId;

    if (!targetId) {
        return res.status(400).json({
            success: false,
            error: 'No target user specified. Please provide a targetUserId or have a partner connected.'
        });
    }

    if (targetId === userId) {
        return res.status(400).json({
            success: false,
            error: 'You cannot invite yourself!'
        });
    }

    const targetUser = db.users[targetId];
    if (!targetUser) {
        return res.status(404).json({
            success: false,
            error: 'User not found. Please check the User ID.'
        });
    }

    const user = db.users[userId];

    // Notify target via WebSocket if they're connected
    const targetConnection = playgroundConnections.get(targetId);
    if (targetConnection) {
        io.to(targetConnection.socketId).emit('playground:invite', {
            fromId: userId,
            fromName: user.username
        });
    } else {
        // Store invite flag for when they join
        if (!db.playground[targetId]) {
            db.playground[targetId] = { x: 400, y: 300, sprite: 'idle', lastUpdate: Date.now(), invitingPartner: userId };
        } else {
            db.playground[targetId].invitingPartner = userId;
        }
        saveDB();
    }

    res.json({
        success: true,
        message: `Invitation sent to ${targetUser.username}! 💌`
    });
});

// --- SOCKET.IO PLAYGROUND MULTIPLAYER (PROXIMITY-BASED PRIVATE CHAT) ---
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication error: No token provided'));
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return next(new Error('Authentication error: Invalid token'));
        }
        socket.oderId = decoded.userId;
        next();
    });
});

// Helper: Get all players data for initial state
function getAllPlayersData() {
    const players = [];
    playgroundConnections.forEach((data) => {
        players.push({
            oderId: data.oderId,
            username: data.username,
            gender: data.gender,
            color: data.color || '#00ff88',
            x: data.x,
            y: data.y,
            direction: data.direction || 'down',
            isMoving: false
        });
    });
    return players;
}

// Helper: Calculate distance between two players
function getDistance(player1, player2) {
    const dx = player1.x - player2.x;
    const dy = player1.y - player2.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// Helper: Get nearby players for a given player
function getNearbyPlayers(oderId) {
    const player = playgroundConnections.get(oderId);
    if (!player) return [];

    const nearby = [];
    playgroundConnections.forEach((other, otherId) => {
        if (otherId !== oderId) {
            const distance = getDistance(player, other);
            if (distance <= PROXIMITY_RADIUS) {
                nearby.push({
                    oderId: other.oderId,
                    username: other.username,
                    distance: Math.round(distance)
                });
            }
        }
    });
    return nearby;
}

// Helper: Generate unique room ID
function generateRoomId(oderId1, oderId2) {
    const sorted = [oderId1, oderId2].sort();
    return `private_${sorted[0]}_${sorted[1]}_${Date.now()}`;
}

// Helper: Find existing room between two players
function findExistingRoom(oderId1, oderId2) {
    for (const [roomId, room] of privateRooms) {
        if (room.members.includes(oderId1) && room.members.includes(oderId2)) {
            return roomId;
        }
    }
    return null;
}

// Avatar colors for random assignment
const AVATAR_COLORS = ['#00ff88', '#ff6b6b', '#4ecdc4', '#ffe66d', '#a855f7', '#f472b6', '#60a5fa', '#fb923c'];

io.on('connection', (socket) => {
    const oderId = socket.oderId;
    const user = db.users[oderId];

    if (!user) {
        socket.disconnect();
        return;
    }

    console.log(`[Playground] User ${user.username} (${oderId}) connected`);

    // Assign random spawn position and color
    const spawnX = 500 + Math.random() * 2000;
    const spawnY = 500 + Math.random() * 1000;
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    // Store connection with full player data
    const playerData = {
        socketId: socket.id,
        oderId: oderId,
        username: user.username,
        gender: user.gender,
        color: color,
        x: spawnX,
        y: spawnY,
        direction: 'down',
        isMoving: false,
        currentRoom: null // Track current private chat room
    };
    playgroundConnections.set(oderId, playerData);

    // Join the global playground room (for position updates only)
    socket.join('playground:global');

    // Send current world state to the new player
    socket.emit('playground:init', {
        oderId: oderId,
        players: getAllPlayersData()
        // NO chatHistory - no global chat!
    });

    // Notify ALL other players about the new player
    socket.to('playground:global').emit('playground:playerJoined', {
        player: playerData,
        message: `${user.username} joined the playground! 🎮`
    });

    // ============ POSITION UPDATES ============
    socket.on('playground:move', (data) => {
        const { x, y, direction, isMoving } = data;

        // Update stored position
        const connection = playgroundConnections.get(oderId);
        if (connection) {
            connection.x = x;
            connection.y = y;
            connection.direction = direction || connection.direction;
            connection.isMoving = isMoving || false;
            playgroundConnections.set(oderId, connection);
        }

        // Broadcast position to ALL players
        socket.to('playground:global').emit('playground:playerMoved', {
            oderId: oderId,
            x: x,
            y: y,
            direction: direction,
            isMoving: isMoving
        });

        // Check and notify about nearby players (for chat eligibility)
        const nearby = getNearbyPlayers(oderId);
        socket.emit('playground:nearbyPlayers', { nearby });
    });

    // ============ PRIVATE CHAT INVITE ============
    socket.on('playground:chatInvite', (data) => {
        const targetId = data?.targetId;
        if (!targetId) return;

        const targetConnection = playgroundConnections.get(targetId);
        if (!targetConnection) {
            socket.emit('playground:error', { message: 'Player not found' });
            return;
        }

        // Check if players are within proximity
        const myConnection = playgroundConnections.get(oderId);
        const distance = getDistance(myConnection, targetConnection);

        if (distance > PROXIMITY_RADIUS) {
            socket.emit('playground:error', { message: 'Player is too far away to chat' });
            return;
        }

        // Check if already in a room together
        const existingRoom = findExistingRoom(oderId, targetId);
        if (existingRoom) {
            socket.emit('playground:error', { message: 'Already chatting with this player' });
            return;
        }

        // Store pending invite
        const inviteKey = `${oderId}_${targetId}`;
        pendingInvites.set(inviteKey, {
            fromId: oderId,
            toId: targetId,
            fromUsername: user.username,
            fromColor: myConnection.color,
            timestamp: Date.now()
        });

        console.log(`[Chat Invite] ${user.username} -> ${targetConnection.username}`);

        // Send invite ONLY to target player's socket
        io.to(targetConnection.socketId).emit('playground:chatInviteReceived', {
            fromId: oderId,
            fromUsername: user.username,
            fromColor: myConnection.color
        });

        socket.emit('playground:chatInviteSent', {
            toId: targetId,
            toUsername: targetConnection.username
        });
    });

    // ============ ACCEPT INVITE ============
    socket.on('playground:chatInviteAccept', (data) => {
        const fromId = data?.fromId;
        if (!fromId) return;

        const inviteKey = `${fromId}_${oderId}`;
        const invite = pendingInvites.get(inviteKey);

        if (!invite) {
            socket.emit('playground:error', { message: 'Invite expired or not found' });
            return;
        }

        const fromConnection = playgroundConnections.get(fromId);
        if (!fromConnection) {
            pendingInvites.delete(inviteKey);
            socket.emit('playground:error', { message: 'Player left the playground' });
            return;
        }

        // Create private room
        const roomId = generateRoomId(oderId, fromId);
        privateRooms.set(roomId, {
            members: [oderId, fromId],
            messages: [],
            createdAt: Date.now()
        });

        // Update player data with current room
        const myConnection = playgroundConnections.get(oderId);
        if (myConnection) {
            myConnection.currentRoom = roomId;
            playgroundConnections.set(oderId, myConnection);
        }
        fromConnection.currentRoom = roomId;
        playgroundConnections.set(fromId, fromConnection);

        // Both players join the private room
        socket.join(roomId);
        const fromSocket = io.sockets.sockets.get(fromConnection.socketId);
        if (fromSocket) {
            fromSocket.join(roomId);
        }

        // Remove pending invite
        pendingInvites.delete(inviteKey);

        console.log(`[Chat Room] Created ${roomId} for ${user.username} & ${fromConnection.username}`);

        // Notify both players
        socket.emit('playground:chatRoomJoined', {
            roomId: roomId,
            partnerId: fromId,
            partnerUsername: fromConnection.username,
            partnerColor: fromConnection.color
        });

        io.to(fromConnection.socketId).emit('playground:chatRoomJoined', {
            roomId: roomId,
            partnerId: oderId,
            partnerUsername: user.username,
            partnerColor: myConnection?.color || color
        });
    });

    // ============ DECLINE INVITE ============
    socket.on('playground:chatInviteDecline', (data) => {
        const fromId = data?.fromId;
        if (!fromId) return;

        const inviteKey = `${fromId}_${oderId}`;
        const invite = pendingInvites.get(inviteKey);

        if (invite) {
            pendingInvites.delete(inviteKey);

            const fromConnection = playgroundConnections.get(fromId);
            if (fromConnection) {
                io.to(fromConnection.socketId).emit('playground:chatInviteDeclined', {
                    byId: oderId,
                    byUsername: user.username
                });
            }
        }
    });

    // ============ PRIVATE CHAT MESSAGE ============
    socket.on('playground:privateMessage', (data) => {
        const { roomId, message } = data;
        if (!roomId || !message) return;

        const room = privateRooms.get(roomId);
        if (!room) {
            socket.emit('playground:error', { message: 'Chat room not found' });
            return;
        }

        // Security: Verify sender is a member of the room
        if (!room.members.includes(oderId)) {
            socket.emit('playground:error', { message: 'Access denied' });
            return;
        }

        const sanitizedMessage = message.trim().substring(0, 200);
        if (!sanitizedMessage) return;

        const myConnection = playgroundConnections.get(oderId);

        const msgData = {
            roomId: roomId,
            fromId: oderId,
            fromUsername: user.username,
            fromColor: myConnection?.color || '#ffffff',
            message: sanitizedMessage,
            timestamp: Date.now()
        };

        // Store in room history (ephemeral)
        room.messages.push(msgData);
        if (room.messages.length > 100) {
            room.messages.shift();
        }

        console.log(`[Private Chat] ${user.username}: ${sanitizedMessage}`);

        // Send ONLY to room members
        io.to(roomId).emit('playground:privateMessageReceived', msgData);
    });

    // ============ LEAVE PRIVATE CHAT ============
    socket.on('playground:leaveChat', (data) => {
        const { roomId } = data;
        if (!roomId) return;

        const room = privateRooms.get(roomId);
        if (!room) return;

        // Remove player from room
        socket.leave(roomId);

        const myConnection = playgroundConnections.get(oderId);
        if (myConnection) {
            myConnection.currentRoom = null;
            playgroundConnections.set(oderId, myConnection);
        }

        // Notify other room member
        const otherMemberId = room.members.find(id => id !== oderId);
        if (otherMemberId) {
            const otherConnection = playgroundConnections.get(otherMemberId);
            if (otherConnection) {
                io.to(otherConnection.socketId).emit('playground:chatRoomClosed', {
                    roomId: roomId,
                    reason: `${user.username} left the chat`
                });

                otherConnection.currentRoom = null;
                playgroundConnections.set(otherMemberId, otherConnection);

                const otherSocket = io.sockets.sockets.get(otherConnection.socketId);
                if (otherSocket) {
                    otherSocket.leave(roomId);
                }
            }
        }

        // Delete room (messages are ephemeral)
        privateRooms.delete(roomId);
        console.log(`[Chat Room] Closed ${roomId}`);
    });

    // ============ DISCONNECT ============
    socket.on('disconnect', () => {
        console.log(`[Playground] User ${user.username} (${oderId}) left`);

        const connection = playgroundConnections.get(oderId);

        // Clean up any private room the player was in
        if (connection?.currentRoom) {
            const room = privateRooms.get(connection.currentRoom);
            if (room) {
                const otherMemberId = room.members.find(id => id !== oderId);
                if (otherMemberId) {
                    const otherConnection = playgroundConnections.get(otherMemberId);
                    if (otherConnection) {
                        io.to(otherConnection.socketId).emit('playground:chatRoomClosed', {
                            roomId: connection.currentRoom,
                            reason: `${user.username} disconnected`
                        });
                        otherConnection.currentRoom = null;
                        playgroundConnections.set(otherMemberId, otherConnection);
                    }
                }
                privateRooms.delete(connection.currentRoom);
            }
        }

        // Clean up pending invites from this user
        for (const [key, invite] of pendingInvites) {
            if (invite.fromId === oderId || invite.toId === oderId) {
                pendingInvites.delete(key);
            }
        }

        // Notify ALL remaining players
        socket.to('playground:global').emit('playground:playerLeft', {
            oderId: oderId,
            username: user.username,
            message: `${user.username} left the playground`
        });

        playgroundConnections.delete(oderId);
    });
});

// Start Server
// --- STAY-ALIVE HEARTBEAT ---
app.get('/api/ping', (req, res) => {
    res.json({ success: true, timestamp: Date.now() });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Socket.IO server ready for playground multiplayer`);
});
