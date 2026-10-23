/* Data layer: JSON-file persistence for users, sessions and messages. */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const EMPTY_DB = { users: [], sessions: {}, messages: [] };

let db = load();

function load() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        if (!fs.existsSync(DB_FILE)) return clone(EMPTY_DB);
        const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
        return {
            users: Array.isArray(parsed.users) ? parsed.users : [],
            sessions: parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {},
            messages: Array.isArray(parsed.messages) ? parsed.messages : []
        };
    } catch (error) {
        console.error("Could not read database, starting empty:", error.message);
        return clone(EMPTY_DB);
    }
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function save() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

/* ---------- Passwords ---------- */

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return salt + ":" + hash;
}

function verifyPassword(password, stored) {
    if (typeof stored !== "string" || !stored.includes(":")) return false;
    const parts = stored.split(":");
    const expected = Buffer.from(parts[1], "hex");
    const actual = crypto.scryptSync(password, parts[0], 64);
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
}

/* ---------- Users ---------- */

function findUserByEmail(email) {
    if (typeof email !== "string") return null;
    const needle = email.trim().toLowerCase();
    return db.users.find(function (user) {
        return user.email.toLowerCase() === needle;
    }) || null;
}

function findUserById(id) {
    return db.users.find(function (user) { return user.id === id; }) || null;
}

function createUser(fullName, email, password) {
    const user = {
        id: crypto.randomUUID(),
        fullName: fullName,
        email: email.trim(),
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString()
    };
    db.users.push(user);
    save();
    return user;
}

function publicUser(user) {
    return { id: user.id, fullName: user.fullName, email: user.email };
}

// The public details of one person, with the presence flags the people list
// needs: are they signed in right now, and when were they last around?
// The set of online people comes from the caller, because the live
// connections live with the server and not with the stored data.
function userWithPresence(user, onlineEmails) {
    const info = publicUser(user);
    const online = onlineEmails.has(user.email.toLowerCase());
    info.online = online;
    info.lastSeenAt = online ? new Date().toISOString() : lastSeen(user.email);
    return info;
}

function listUsers(exceptEmail) {
    const needle = String(exceptEmail || "").toLowerCase();
    return db.users
        .filter(function (user) { return user.email.toLowerCase() !== needle; })
        .map(publicUser)
        .sort(function (a, b) { return a.fullName.localeCompare(b.fullName); });
}

// Everyone else on the app, with presence information attached.
function listUsersWithPresence(exceptEmail, onlineEmails) {
    const needle = String(exceptEmail || "").toLowerCase();
    const online = onlineEmails || new Set();
    return db.users
        .filter(function (user) { return user.email.toLowerCase() !== needle; })
        .map(function (user) { return userWithPresence(user, online); })
        .sort(function (a, b) { return a.fullName.localeCompare(b.fullName); });
}

/* ---------- Sessions ---------- */

function createSession(email) {
    const token = crypto.randomBytes(32).toString("hex");
    const now = new Date().toISOString();
    db.sessions[token] = { email: email, createdAt: now, lastSeenAt: now };
    save();
    return token;
}

function getSession(token) {
    if (!token) return null;
    return db.sessions[token] || null;
}

// Does this person have a signed-in session?
function hasSession(email) {
    const needle = String(email || "").toLowerCase();
    return Object.keys(db.sessions).some(function (token) {
        const session = db.sessions[token];
        return session && String(session.email).toLowerCase() === needle;
    });
}

// When was this person last seen? The newest of their sessions wins.
function lastSeen(email) {
    const needle = String(email || "").toLowerCase();
    let latest = null;
    Object.keys(db.sessions).forEach(function (token) {
        const session = db.sessions[token];
        if (!session || String(session.email).toLowerCase() !== needle) return;
        const seen = session.lastSeenAt || session.createdAt;
        if (!latest || seen > latest) latest = seen;
    });
    return latest;
}

// Records that the person is active right now, so the list can say when
// they were last around.
function touchSession(email) {
    const needle = String(email || "").toLowerCase();
    let changed = false;
    Object.keys(db.sessions).forEach(function (token) {
        const session = db.sessions[token];
        if (session && String(session.email).toLowerCase() === needle) {
            session.lastSeenAt = new Date().toISOString();
            changed = true;
        }
    });
    if (changed) save();
}

function destroySession(token) {
    if (token && db.sessions[token]) {
        delete db.sessions[token];
        save();
    }
}

/* ---------- Messages ---------- */

function createMessage(fromEmail, toEmail, text) {
    const message = {
        id: crypto.randomUUID(),
        from: fromEmail,
        to: toEmail,
        text: text,
        createdAt: new Date().toISOString(),
        readAt: null
    };
    db.messages.push(message);
    save();
    return message;
}

// Messages between two people, oldest first.
function getConversation(aEmail, bEmail) {
    const a = aEmail.toLowerCase();
    const b = bEmail.toLowerCase();
    return db.messages
        .filter(function (m) {
            return (m.from.toLowerCase() === a && m.to.toLowerCase() === b)
                || (m.from.toLowerCase() === b && m.to.toLowerCase() === a);
        })
        .sort(function (x, y) { return x.createdAt.localeCompare(y.createdAt); });
}

// One entry per contact, newest conversation first, with unread count.
function getConversations(email) {
    const me = email.toLowerCase();
    const byPeer = new Map();

    db.messages.forEach(function (m) {
        const from = m.from.toLowerCase();
        const to = m.to.toLowerCase();
        if (from !== me && to !== me) return;

        const peer = from === me ? to : from;
        let entry = byPeer.get(peer);
        if (!entry) {
            entry = { peer: peer, lastMessageAt: m.createdAt, lastText: m.text, unread: 0 };
            byPeer.set(peer, entry);
        }
        if (m.createdAt >= entry.lastMessageAt) {
            entry.lastMessageAt = m.createdAt;
            entry.lastText = m.text;
        }
        if (to === me && !m.readAt) entry.unread += 1;
    });

    return Array.from(byPeer.values())
        .map(function (entry) {
            const user = findUserByEmail(entry.peer);
            return {
                peer: entry.peer,
                fullName: user ? user.fullName : entry.peer,
                lastMessageAt: entry.lastMessageAt,
                lastText: entry.lastText,
                unread: entry.unread
            };
        })
        .sort(function (a, b) { return b.lastMessageAt.localeCompare(a.lastMessageAt); });
}

// Marks everything the peer sent to me as read.
function markRead(email, peerEmail) {
    const me = email.toLowerCase();
    const peer = peerEmail.toLowerCase();
    let changed = false;
    db.messages.forEach(function (m) {
        if (m.to.toLowerCase() === me && m.from.toLowerCase() === peer && !m.readAt) {
            m.readAt = new Date().toISOString();
            changed = true;
        }
    });
    if (changed) save();
    return changed;
}

module.exports = {
    findUserByEmail: findUserByEmail,
    findUserById: findUserById,
    createUser: createUser,
    publicUser: publicUser,
    listUsers: listUsers,
    listUsersWithPresence: listUsersWithPresence,
    createSession: createSession,
    getSession: getSession,
    destroySession: destroySession,
    hasSession: hasSession,
    lastSeen: lastSeen,
    touchSession: touchSession,
    createMessage: createMessage,
    getConversation: getConversation,
    getConversations: getConversations,
    markRead: markRead,
    hashPassword: hashPassword,
    verifyPassword: verifyPassword
};
