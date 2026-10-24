/* Data layer: Supabase persistence for users, sessions and messages. */

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

/* ---------- Helpers ---------- */

function toCamelCaseUser(row) {
    if (!row) return null;
    return {
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        passwordHash: row.password_hash,
        createdAt: row.created_at
    };
}

function publicUser(user) {
    if (!user) return null;
    return { id: user.id, fullName: user.fullName, email: user.email };
}

/* ---------- Users ---------- */

async function findUserByEmail(email) {
    if (typeof email !== "string") return null;
    const needle = email.trim().toLowerCase();
    const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("email", needle)
        .maybeSingle();
    if (error || !data) return null;
    return toCamelCaseUser(data);
}

async function findUserById(id) {
    const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", id)
        .maybeSingle();
    if (error || !data) return null;
    return toCamelCaseUser(data);
}

async function createUser(fullName, email, password) {
    const { data, error } = await supabase
        .from("users")
        .insert([{ full_name: fullName, email: email.trim(), password_hash: hashPassword(password) }])
        .select()
        .single();
    if (error) throw error;
    return toCamelCaseUser(data);
}
async function listUsers(exceptEmail) {
    const needle = String(exceptEmail || "").toLowerCase();
    let query = supabase.from("users").select("id, full_name, email");
    if (needle) query = query.neq("email", needle);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(function (row) {
        return { id: row.id, fullName: row.full_name, email: row.email };
    });
}

async function listUsersWithPresence(exceptEmail, onlineEmails) {
    const users = await listUsers(exceptEmail);
    const onlineSet = new Set((onlineEmails || []).map(function (e) { return String(e).toLowerCase(); }));
    return users.map(function (user) {
        const online = onlineSet.has(user.email.toLowerCase());
        return {
            id: user.id,
            fullName: user.fullName,
            email: user.email,
            online: online,
            lastSeenAt: online ? new Date().toISOString() : null
        };
    });
}

/* ---------- Sessions ---------- */

function generateToken() {
    return crypto.randomBytes(32).toString("hex");
}

async function createSession(email) {
    const token = generateToken();
    const now = new Date().toISOString();
    const { error } = await supabase
        .from("sessions")
        .insert([{ token: token, email: email, created_at: now, last_seen_at: now }]);
    if (error) throw error;
    return token;
}

async function getSession(token) {
    const { data, error } = await supabase
        .from("sessions")
        .select("email")
        .eq("token", token)
        .maybeSingle();
    if (error || !data) return null;
    return { email: data.email };
}

async function destroySession(token) {
    await supabase.from("sessions").delete().eq("token", token);
}

async function hasSession(token) {
    const { data, error } = await supabase
        .from("sessions")
        .select("token")
        .eq("token", token)
        .maybeSingle();
    return !error && !!data;
}

async function lastSeen(email) {
    const { data, error } = await supabase
        .from("sessions")
        .select("last_seen_at")
        .eq("email", email)
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error || !data || !data.last_seen_at) return null;
    return data.last_seen_at;
}

async function touchSession(email) {
    const now = new Date().toISOString();
    const { error } = await supabase
        .from("sessions")
        .update({ last_seen_at: now })
        .eq("email", email);
    if (error) throw error;
}
/* ---------- Messages ---------- */

async function createMessage(fromEmail, toEmail, text) {
    const { data, error } = await supabase
        .from("messages")
        .insert([{
            from_email: fromEmail,
            to_email: toEmail,
            text: text,
            created_at: new Date().toISOString(),
            read_at: null
        }])
        .select()
        .single();
    if (error) throw error;
    return {
        id: data.id,
        from: data.from_email,
        to: data.to_email,
        text: data.text,
        createdAt: data.created_at,
        readAt: data.read_at
    };
}

async function getConversation(aEmail, bEmail) {
    const a = String(aEmail || "").toLowerCase();
    const b = String(bEmail || "").toLowerCase();
    const { data, error } = await supabase
        .from("messages")
        .select("*")
        .or("and(from_email.eq." + a + ",to_email.eq." + b + "),and(from_email.eq." + b + ",to_email.eq." + a + ")")
        .order("created_at", { ascending: true });
    if (error) throw error;
    return (data || []).map(function (m) {
        return {
            id: m.id,
            from: m.from_email,
            to: m.to_email,
            text: m.text,
            createdAt: m.created_at,
            readAt: m.read_at
        };
    });
}

async function getConversations(email) {
    const me = String(email || "").toLowerCase();
    const { data: messages, error } = await supabase
        .from("messages")
        .select("*")
        .or("from_email.eq." + me + ",to_email.eq." + me)
        .order("created_at", { ascending: false });
    if (error) throw error;

    const byPeer = new Map();

    for (const m of (messages || [])) {
        const from = String(m.from_email).toLowerCase();
        const to = String(m.to_email).toLowerCase();
        const peer = from === me ? to : from;

        if (!byPeer.has(peer)) {
            byPeer.set(peer, {
                peer: peer,
                lastMessageAt: m.created_at,
                lastText: m.text,
                unread: 0
            });
        }

        if (m.created_at >= byPeer.get(peer).lastMessageAt) {
            byPeer.get(peer).lastMessageAt = m.created_at;
            byPeer.get(peer).lastText = m.text;
        }

        if (to === me && !m.read_at) {
            byPeer.get(peer).unread += 1;
        }
    }

    const peers = Array.from(byPeer.keys());
    let peerNames = {};
    if (peers.length > 0) {
        const { data: users } = await supabase
            .from("users")
            .select("email, full_name")
            .in("email", peers);
        peerNames = Object.fromEntries((users || []).map(function (u) {
            return [String(u.email).toLowerCase(), u.full_name];
        }));
    }

    return Array.from(byPeer.values())
        .map(function (entry) {
            return {
                peer: entry.peer,
                fullName: peerNames[entry.peer] || entry.peer,
                lastMessageAt: entry.lastMessageAt,
                lastText: entry.lastText,
                unread: entry.unread
            };
        })
        .sort(function (a, b) { return b.lastMessageAt.localeCompare(a.lastMessageAt); });
}

async function markRead(email, peerEmail) {
    const me = String(email || "").toLowerCase();
    const peer = String(peerEmail || "").toLowerCase();
    const { error } = await supabase
        .from("messages")
        .update({ read_at: new Date().toISOString() })
        .eq("to_email", me)
        .eq("from_email", peer)
        .is("read_at", null);
    return !error;
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