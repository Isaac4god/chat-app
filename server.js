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

function addClient(email, res) {
    if (!clients.has(email)) clients.set(email, new Set());
    clients.get(email).add(res);
}

function removeClient(email, res) {
    const set = clients.get(email);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) clients.delete(email);
}

function pushTo(email, event, data) {
    const set = clients.get(email);
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

function currentUser(req) {
    const token = req.headers["x-session-token"];
    if (!token) return null;
    const session = store.getSession(token);
    if (!session) return null;
    const user = store.findUserByEmail(session.email);
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

routes["POST /api/register"] = function (req, res) {
    readBody(req).then(function (body) {
        const fullName = String(body.fullName || "").trim();
        const email = String(body.email || "").trim();
        const password = String(body.password || "");

        const error = validate.registrationError(fullName, email, password, store.findUserByEmail(email));
        if (error) return sendJson(res, 400, { error: error });

        const user = store.createUser(fullName, email, password);
        sendJson(res, 201, { user: store.publicUser(user) });
    }).catch(function (err) {
        sendJson(res, 400, { error: err.message });
    });
};

routes["POST /api/login"] = function (req, res) {
    readBody(req).then(function (body) {
        const email = String(body.email || "").trim();
        const password = String(body.password || "");

        if (!validate.isValidGmail(email)) {
            return sendJson(res, 400, { error: "Enter a valid Gmail address (example@gmail.com)." });
        }

        const user = store.findUserByEmail(email);
        if (!user) {
            return sendJson(res, 401, { error: "No account found for this Gmail. Register first." });
        }
        if (!store.verifyPassword(password, user.passwordHash)) {
            return sendJson(res, 401, { error: "Incorrect password. Please try again." });
        }

        const token = store.createSession(user.email);
        sendJson(res, 200, { token: token, user: store.publicUser(user) });
    }).catch(function (err) {
        sendJson(res, 400, { error: err.message });
    });
};

routes["POST /api/logout"] = function (req, res) {
    const auth = currentUser(req);
    if (auth) store.destroySession(auth.token);
    sendJson(res, 200, { ok: true });
};

routes["GET /api/me"] = function (req, res) {
    const auth = currentUser(req);
    if (!auth) return sendJson(res, 401, { error: "Not signed in" });
    sendJson(res, 200, { user: store.publicUser(auth.user) });
};

routes["GET /api/users"] = function (req, res) {
    const auth = currentUser(req);
    if (!auth) return sendJson(res, 401, { error: "Not signed in" });
    sendJson(res, 200, { users: store.listUsers(auth.user.email) });
};

routes["GET /api/conversations"] = function (req, res) {
    const auth = currentUser(req);
    if (!auth) return sendJson(res, 401, { error: "Not signed in" });
    sendJson(res, 200, { conversations: store.getConversations(auth.user.email) });
};

routes["GET /api/messages"] = function (req, res, query) {
    const auth = currentUser(req);
    if (!auth) return sendJson(res, 401, { error: "Not signed in" });

    const peer = String(query.peer || "").trim();
    if (!peer) return sendJson(res, 400, { error: "A peer is required." });
    if (!store.findUserByEmail(peer)) {
        return sendJson(res, 404, { error: "That person is not on this app." });
    }

    const messages = store.getConversation(auth.user.email, peer);
    store.markRead(auth.user.email, peer);
    sendJson(res, 200, { messages: messages });
};

routes["POST /api/read"] = function (req, res) {
    const auth = currentUser(req);
    if (!auth) return sendJson(res, 401, { error: "Not signed in" });

    readBody(req).then(function (body) {
        const peer = String(body.peer || "").trim();
        if (!peer) return sendJson(res, 400, { error: "A peer is required." });
        store.markRead(auth.user.email, peer);
        sendJson(res, 200, { ok: true });
    }).catch(function (err) {
        sendJson(res, 400, { error: err.message });
    });
};

routes["POST /api/messages"] = function (req, res) {
    const auth = currentUser(req);
    if (!auth) return sendJson(res, 401, { error: "Not signed in" });

    readBody(req).then(function (body) {
        const to = String(body.to || "").trim();
        const text = String(body.text || "").trim();

        if (!to) return sendJson(res, 400, { error: "A recipient is required." });
        if (!text) return sendJson(res, 400, { error: "Type a message first." });
        if (text.length > 4000) return sendJson(res, 400, { error: "Message is too long." });

        const recipient = store.findUserByEmail(to);
        if (!recipient) return sendJson(res, 404, { error: "That person is not on this app." });

        const message = store.createMessage(auth.user.email, recipient.email, text);

        // Deliver live to the recipient and echo to the sender's other tabs.
        pushTo(recipient.email, "message", message);
        pushTo(auth.user.email, "message", message);

        sendJson(res, 201, { message: message });
    }).catch(function (err) {
        sendJson(res, 400, { error: err.message });
    });
};

/* ---------- Dispatch ---------- */

const server = http.createServer(function (req, res) {
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
        const session = store.getSession(token);
        const user = session ? store.findUserByEmail(session.email) : null;
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
        const beat = setInterval(function () {
            try { res.write(": ping\n\n"); } catch (error) { clearInterval(beat); }
        }, 25000);
        req.on("close", function () {
            clearInterval(beat);
            removeClient(user.email, res);
        });
        return;
    }

    const handler = routes[key];
    if (handler) {
        handler(req, res, query, cors);
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
