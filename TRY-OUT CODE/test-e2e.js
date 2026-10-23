/* End-to-end check: register, login, send, receive, SSE delivery, logout. */

const http = require("http");

const BASE = "http://localhost:3000";
let passed = 0;
let failed = 0;

function check(label, condition, detail) {
    if (condition) {
        passed += 1;
        console.log("PASS  " + label);
    } else {
        failed += 1;
        console.log("FAIL  " + label + (detail ? " -> " + detail : ""));
    }
}

function request(method, path, body, token) {
    return new Promise(function (resolve, reject) {
        const payload = body ? JSON.stringify(body) : null;
        const headers = { "Content-Type": "application/json" };
        if (token) headers["X-Session-Token"] = token;
        if (payload) headers["Content-Length"] = Buffer.byteLength(payload);

        const req = http.request(BASE + path, { method: method, headers: headers }, function (res) {
            let raw = "";
            res.on("data", function (chunk) { raw += chunk; });
            res.on("end", function () {
                let parsed = null;
                try { parsed = JSON.parse(raw); } catch (error) { parsed = raw; }
                resolve({ status: res.statusCode, body: parsed });
            });
        });
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

// Keeps an SSE connection open and collects pushed events.
function openEvents(token, label) {
    return new Promise(function (resolve) {
        const req = http.get(BASE + "/api/events?token=" + encodeURIComponent(token), function (res) {
            const events = [];
            res.setEncoding("utf8");
            res.on("data", function (chunk) {
                chunk.split("\n\n").forEach(function (block) {
                    if (block.indexOf("event: message") === 0) {
                        const line = block.split("\n").find(function (l) { return l.indexOf("data:") === 0; });
                        if (line) events.push(JSON.parse(line.slice(5).trim()));
                    }
                });
            });
            resolve({ req: req, events: events, label: label });
        });
        req.on("error", function () { resolve(null); });
    });
}

async function waitFor(fn, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const value = fn();
        if (value) return value;
        await new Promise(function (r) { setTimeout(r, 100); });
    }
    return null;
}

async function main() {
    const stamp = Date.now();
    const alice = { name: "Alice Tester", email: "alice" + stamp + "@gmail.com" };
    const bob = { name: "Bob Tester", email: "bob" + stamp + "@gmail.com" };
    const password = "pass1234";

    // --- Registration ---
    let res = await request("POST", "/api/register", { fullName: alice.name, email: alice.email, password: password });
    check("register alice", res.status === 201 && res.body.user.email === alice.email, JSON.stringify(res.body));

    res = await request("POST", "/api/register", { fullName: bob.name, email: bob.email, password: password });
    check("register bob", res.status === 201, JSON.stringify(res.body));

    res = await request("POST", "/api/register", { fullName: "Dup", email: alice.email, password: password });
    check("duplicate email rejected", res.status === 400, "status " + res.status);

    res = await request("POST", "/api/register", { fullName: "Weak", email: "weak" + stamp + "@gmail.com", password: "abc" });
    check("weak password rejected", res.status === 400, "status " + res.status);

    res = await request("POST", "/api/register", { fullName: "Bad", email: "notgmail" + stamp + "@yahoo.com", password: password });
    check("non-gmail rejected", res.status === 400, "status " + res.status);

    // --- Login ---
    res = await request("POST", "/api/login", { email: alice.email, password: "wrongpass1" });
    check("wrong password rejected", res.status === 401, "status " + res.status);

    res = await request("POST", "/api/login", { email: "nobody" + stamp + "@gmail.com", password: password });
    check("unknown account rejected", res.status === 401, "status " + res.status);

    res = await request("POST", "/api/login", { email: alice.email, password: password });
    check("login alice", res.status === 200 && Boolean(res.body.token), JSON.stringify(res.body));
    const aliceToken = res.body.token;

    res = await request("POST", "/api/login", { email: bob.email, password: password });
    check("login bob", res.status === 200, JSON.stringify(res.body));
    const bobToken = res.body.token;

    // --- Auth guard ---
    res = await request("GET", "/api/me");
    check("me without token is 401", res.status === 401, "status " + res.status);

    res = await request("GET", "/api/me", null, aliceToken);
    check("me with token", res.status === 200 && res.body.user.email === alice.email, JSON.stringify(res.body));

    // --- Users list ---
    res = await request("GET", "/api/users", null, aliceToken);
    const aliceSeesBob = res.status === 200 && res.body.users.some(function (u) { return u.email === bob.email; });
    const aliceSeesSelf = res.status === 200 && res.body.users.some(function (u) { return u.email === alice.email; });
    check("alice sees bob in people list", aliceSeesBob, JSON.stringify(res.body));
    check("alice does not see herself in people list", !aliceSeesSelf, JSON.stringify(res.body));

    // --- Live SSE connections ---
    const aliceEvents = await openEvents(aliceToken, "alice");
    const bobEvents = await openEvents(bobToken, "bob");
    check("alice SSE connected", Boolean(aliceEvents));
    check("bob SSE connected", Boolean(bobEvents));

    await new Promise(function (r) { setTimeout(r, 300); });

    // --- Sending ---
    res = await request("POST", "/api/messages", { to: bob.email, text: "Hello Bob!" }, aliceToken);
    check("alice sends message", res.status === 201 && res.body.message.text === "Hello Bob!", JSON.stringify(res.body));
    const firstId = res.body.message.id;

    const delivered = await waitFor(function () {
        return bobEvents.events.find(function (m) { return m.id === firstId; });
    }, 3000);
    check("bob receives it live over SSE", Boolean(delivered), JSON.stringify(bobEvents.events));

    const echoed = await waitFor(function () {
        return aliceEvents.events.find(function (m) { return m.id === firstId; });
    }, 3000);
    check("sender sees the echo", Boolean(echoed));

    res = await request("POST", "/api/messages", { to: alice.email, text: "Hi Alice, this is Bob!" }, bobToken);
    check("bob replies to alice", res.status === 201 && res.body.message.to === alice.email, JSON.stringify(res.body));

    // --- Conversation history ---
    res = await request("GET", "/api/messages?peer=" + encodeURIComponent(bob.email), null, aliceToken);
    const history = res.body.messages || [];
    check("alice sees 2 messages in history", res.status === 200 && history.length === 2, "count " + history.length);
    check("history is oldest first", history.length === 2 && history[0].text === "Hello Bob!", JSON.stringify(history.map(function (m) { return m.text; })));

    // --- Unread counts ---
    res = await request("GET", "/api/conversations", null, bobToken);
    const bobConv = (res.body.conversations || [])[0];
    check("bob has 1 unread before opening", bobConv && bobConv.unread === 1, JSON.stringify(res.body));

    res = await request("GET", "/api/messages?peer=" + encodeURIComponent(alice.email), null, bobToken);
    check("bob opens conversation", res.status === 200);

    res = await request("GET", "/api/conversations", null, bobToken);
    const bobConvAfter = (res.body.conversations || [])[0];
    check("unread clears after opening", bobConvAfter && bobConvAfter.unread === 0, JSON.stringify(res.body));

    // --- Marking read explicitly ---
    res = await request("POST", "/api/messages", { to: bob.email, text: "Another one" }, aliceToken);
    check("alice sends another", res.status === 201, JSON.stringify(res.body));

    res = await request("GET", "/api/conversations", null, bobToken);
    const convUnread = (res.body.conversations || [])[0];
    check("unread goes back up to 1", convUnread && convUnread.unread === 1, JSON.stringify(res.body));

    res = await request("POST", "/api/read", { peer: alice.email }, bobToken);
    check("mark read endpoint works", res.status === 200, "status " + res.status);

    res = await request("GET", "/api/conversations", null, bobToken);
    const convRead = (res.body.conversations || [])[0];
    check("unread cleared via endpoint", convRead && convRead.unread === 0, JSON.stringify(res.body));

    res = await request("POST", "/api/read", { peer: alice.email });
    check("mark read without token is 401", res.status === 401, "status " + res.status);

    // --- Errors ---
    res = await request("POST", "/api/messages", { to: "ghost" + stamp + "@gmail.com", text: "hi" }, aliceToken);
    check("message to unknown user is 404", res.status === 404, "status " + res.status);

    res = await request("POST", "/api/messages", { to: bob.email, text: "   " }, aliceToken);
    check("empty message rejected", res.status === 400, "status " + res.status);

    res = await request("POST", "/api/messages", { to: bob.email, text: "hi" });
    check("send without token is 401", res.status === 401, "status " + res.status);

    // --- Logout ---
    res = await request("POST", "/api/logout", null, aliceToken);
    check("logout succeeds", res.status === 200, "status " + res.status);

    res = await request("GET", "/api/me", null, aliceToken);
    check("token invalid after logout", res.status === 401, "status " + res.status);

    if (aliceEvents) aliceEvents.req.destroy();
    if (bobEvents) bobEvents.req.destroy();

    console.log("\n" + passed + " passed, " + failed + " failed");
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(function (error) {
    console.error("Test crashed:", error);
    process.exit(1);
});
