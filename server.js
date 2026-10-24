/* Chat server: static files + JSON API + Server-Sent Events for live delivery. */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const store = require("./lib/store");
const validate = require("./public/js/validate.js");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
};

/* ---------- Live connections (SSE) ---------- */

// email -> Set of response objects
const clients = new Map();

// The people who are online right now: they hold a live event connection,
// which means their browser is open on the chat screen at this moment.
function onlineEmails() {
    const online = new Set();
    clients.forEach(function (set, email) {
        if (set.size > 0) online.add(email.toLowerCase());
    });
    return online;
}

function addClient(email, res) {
    const key = String(email || "").toLowerCase();
    if (!clients.has(key)) clients.set(key, new Set());
    clients.get(key).add(res);
}

function removeClient(email, res) {
    const key = String(email || "").toLowerCase();
    const set = clients.get(key);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) clients.delete(key);
}

function pushTo(email, event, data) {
    const set = clients.get(String(email || "").toLowerCase());
    if (!set) return;
    const payload = "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n";
    set.forEach(function (res) {
        try {
            res.write(payload);
        } catch (error) {
            removeClient(email, res);
        }
    });
}

// Tells everyone who is online that the list of online people has changed,
// so their People tab can update itself.
function broadcastPresence() {
    const online = Array.from(onlineEmails());
    const payload = "event: presence\ndata: " + JSON.stringify({ online: online }) + "\n\n";
    clients.forEach(function (set) {
        set.forEach(function (res) {
            try {
                res.write(payload);
            } catch (error) { /* the client is gone; the close handler cleans up */ }
        });
    });
}

/* ---------- Helpers ---------- */

// The front end is often opened from a plain static server (VS Code Live
// Server, python -m http.server, ...). Those servers cannot serve /api/*,
// so the browser has to talk to the real server instead. That makes the
// requests cross-origin, which needs permissive CORS headers.
function corsHeaders(req) {
    const origin = req.headers.origin;
    return {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Session-Token",
        "Access-Control-Max-Age": "600",
        "Vary": "Origin"
    };
}

function sendJson(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(text),
        "Cache-Control": "no-store"
    });
    res.end(text);
}

function readBody(req) {
    return new Promise(function (resolve, reject) {
        let raw = "";
        let tooLarge = false;
        req.on("data", function (chunk) {
            raw += chunk;
            if (raw.length > 100000) {
                tooLarge = true;
                req.destroy();
            }
        });
        req.on("end", function () {
            if (tooLarge) return reject(new Error("Payload too large"));
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch (error) {
                reject(new Error("Invalid JSON"));
            }
        });
        req.on("error", reject);
    });
}

async function currentUser(req) {
    const token = req.headers["x-session-token"];
    if (!token) return null;
    const session = await store.getSession(token);
    if (!session) return null;
    const user = await store.findUserByEmail(session.email);
    return user ? { token: token, user: user } : null;
}

function serveStatic(req, res, pathname) {
    let relative = decodeURIComponent(pathname);
    if (relative === "/") relative = "/index.html";

    const filePath = path.join(PUBLIC_DIR, path.normalize(relative).replace(/^([/\\])+/, ""));
    if (!filePath.startsWith(PUBLIC_DIR)) {
        return sendJson(res, 403, { error: "Forbidden" });
    }

    fs.readFile(filePath, function (error, data) {
        if (error) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Not found");
            return;
        }
        const type = mimeTypeFor(filePath);
        res.writeHead(200, { "Content-Type": type, "Cache-Control": cacheControl(filePath) });
        res.end(data);
    });
}

// The manifest needs the manifest+json type to be recognised as a web app
// manifest; everything else falls back to the extension table.
function mimeTypeFor(filePath) {
    if (path.basename(filePath).toLowerCase() === "manifest.json") {
        return "application/manifest+json; charset=utf-8";
    }
    return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

// The service worker and the manifest must never be served stale, otherwise
// an updated app (or a new release) would never reach the browser.
function cacheControl(filePath) {
    const name = path.basename(filePath).toLowerCase();
    if (name === "sw.js" || name === "manifest.json") return "no-cache";
    if (name === "index.html" || name === "register.html" || name === "app.html" || name === "offline.html") {
        return "no-cache";
    }
    return "public, max-age=3600";
}

/* ---------- API routes ---------- */

const routes = {};

routes["POST /api/register"] = async function (req, res) {
    try {
        const body = await readBody(req);
        const fullName = String(body.fullName || "").trim();
        const email = String(body.email || "").trim();
        const password = String(body.password || "");

        const error = validate.registrationError(fullName, email, password, await store.findUserByEmail(email));
        if (error) return sendJson(res, 400, { error: error });

        const user = await store.createUser(fullName, email, password);
        sendJson(res, 201, { user: store.publicUser(user) });
    } catch (err) {
        sendJson(res, 400, { error: err.message });
    }
};

routes["POST /api/login"] = async function (req, res) {
    try {
        const body = await readBody(req);
        const email = String(body.email || "").trim();
        const password = String(body.password || "");

        if (!validate.isValidGmail(email)) {
            return sendJson(res, 400, { error: "Enter a valid Gmail address (example@gmail.com)." });
        }

        const user = await store.findUserByEmail(email);
        if (!user) {
            return sendJson(res, 401, { error: "No account found for this Gmail. Register first." });
        }
        if (!store.verifyPassword(password, user.passwordHash)) {
            return sendJson(res, 401, { error: "Incorrect password. Please try again." });
        }

        const token = await store.createSession(user.email);
        sendJson(res, 200, { token: token, user: store.publicUser(user) });
    } catch (err) {
        sendJson(res, 400, { error: err.message });
    }
};

routes["POST /api/logout"] = async function (req, res) {
    const auth = await currentUser(req);
    if (auth) await store.destroySession(auth.token);
    sendJson(res, 200, { ok: true });
};

routes["GET /api/me"] = function (req, res) {
    const auth = currentUser(req);
    if (!auth) return sendJson(res, 401, { error: "Not signed in" });
    sendJson(res, 200, { user: store.publicUser(auth.user) });
};

routes["GET /api/users"] = async function (req, res) {
    const auth = await currentUser(req);
    if (!auth) return sendJson(res, 401, { error: "Not signed in" });
    sendJson(res, 200, { users: await store.listUsersWithPresence(auth.user.email, onlineEmails()) });
};

routes["GET /api/conversations"] = async function (req, res) {
    const auth = await currentUser(req);
    if (!auth) return sendJson(res, 401, { error: "Not signed in" });
    sendJson(res, 200, { conversations: await store.getConversations(auth.user.email) });
};

routes["GET /api/messages"] = async function (req, res, query) {
    const auth = await currentUser(req);
    if (!auth) return sendJson(res, 401, { error: "Not signed in" });

    const peer = String(query.peer || "").trim();
    if (!peer) return sendJson(res, 400, { error: "A peer is required." });
    if (!await store.findUserByEmail(peer)) {
        return sendJson(res, 404, { error: "That person is not on this app." });
    }

    const messages = await store.getConversation(auth.user.email, peer);
    await store.markRead(auth.user.email, peer);
    sendJson(res, 200, { messages: messages });
};

routes["POST /api/read"] = async function (req, res) {
    const auth = await currentUser(req);
    if (!auth) return sendJson(res, 401, { error: "Not signed in" });

    const body = await readBody(req);
    const peer = String(body.peer || "").trim();
    if (!peer) return sendJson(res, 400, { error: "A peer is required." });
    await store.markRead(auth.user.email, peer);
    sendJson(res, 200, { ok: true });
};

routes["POST /api/messages"] = async function (req, res) {
    const auth = await currentUser(req);
    if (!auth) return sendJson(res, 401, { error: "Not signed in" });

    const body = await readBody(req);
    const to = String(body.to || "").trim();
    const text = String(body.text || "").trim();

    if (!to) return sendJson(res, 400, { error: "A recipient is required." });
    if (!text) return sendJson(res, 400, { error: "Type a message first." });
    if (text.length > 4000) return sendJson(res, 400, { error: "Message is too long." });

    const recipient = await store.findUserByEmail(to);
    if (!recipient) return sendJson(res, 404, { error: "That person is not on this app." });

    const message = await store.createMessage(auth.user.email, recipient.email, text);

    // Deliver live to the recipient and echo to the sender's other tabs.
    pushTo(recipient.email, "message", message);
    pushTo(auth.user.email, "message", message);

    sendJson(res, 201, { message: message });
};

/* ---------- Dispatch ---------- */

const server = http.createServer(async function (req, res) {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;
    const query = parsed.query;
    const key = req.method + " " + pathname;
    const cors = corsHeaders(req);

    // Preflight for cross-origin API calls from a static-server front end.
    if (req.method === "OPTIONS") {
        res.writeHead(204, cors);
        res.end();
        return;
    }

    // Every API response gets the CORS headers, no matter which route runs.
    Object.keys(cors).forEach(function (name) {
        res.setHeader(name, cors[name]);
    });

    if (pathname === "/api/health") {
        sendJson(res, 200, { ok: true, service: "chat-app" });
        return;
    }

    if (pathname === "/api/events") {
        // EventSource cannot send custom headers, so the token comes via the query string.
        const token = query.token || req.headers["x-session-token"];
        const session = await store.getSession(token);
        const user = session ? await store.findUserByEmail(session.email) : null;
        if (!user) {
            res.writeHead(401, { "Content-Type": "text/plain" });
            res.end("Not signed in");
            return;
        }
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        });
        res.write(": connected\n\n");
        addClient(user.email, res);
        await store.touchSession(user.email);
        broadcastPresence();
        const beat = setInterval(function () {
            try { res.write(": ping\n\n"); } catch (error) { clearInterval(beat); }
        }, 25000);
        req.on("close", function () {
            clearInterval(beat);
            removeClient(user.email, res);
            // Remember when they were last here, but only if they are not
            // still connected in another tab.
            if (onlineEmails().has(user.email.toLowerCase())) return;
            store.touchSession(user.email);
            broadcastPresence();
        });
        return;
    }

    const handler = routes[key];
    if (handler) {
        await handler(req, res, query, cors);
        return;
    }

    if (pathname.startsWith("/api/")) {
        sendJson(res, 404, { error: "Unknown endpoint." });
        return;
    }

    if (req.method === "GET") {
        serveStatic(req, res, pathname);
        return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
});

server.listen(PORT, HOST, function () {
    console.log("Chat app running at http://localhost:" + PORT);
});
