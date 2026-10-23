/* Checks who is registered and who is signed in: the people list must carry\n   presence flags, and the online state must follow the live connections.\n\n   Run it with the server up:  node server.js   (in another terminal)\n                       then:  node test-presence.js                          */

const http = require("http");

const BASE = "http://localhost:3000";
let passed = 0;
let failed = 0;

function check(label, condition, detail) {
    if (condition) { passed += 1; console.log("PASS  " + label); }
    else { failed += 1; console.log("FAIL  " + label + (detail ? " -> " + detail : "")); }
}

function request(method, path, body, token) {
    return new Promise(function (resolve, reject) {
        const payload = body ? JSON.stringify(body) : null;
        const headers = { "Content-Type": "application/json" };
        if (token) headers["X-Session-Token"] = token;
        if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
        const req = http.request(BASE + path, { method: method, headers: headers }, function (res) {
            let raw = "";
            res.on("data", function (c) { raw += c; });
            res.on("end", function () {
                let parsed = null;
                try { parsed = JSON.parse(raw); } catch (e) { parsed = raw; }
                resolve({ status: res.statusCode, body: parsed });
            });
        });
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function openEvents(token, label) {
    return new Promise(function (resolve) {
        const req = http.get(BASE + "/api/events?token=" + encodeURIComponent(token), function (res) {
            const events = [];
            res.setEncoding("utf8");
            res.on("data", function (chunk) {
                chunk.split("\n\n").forEach(function (block) {
                    const line = block.split("\n").find(function (l) { return l.indexOf("data:") === 0; });
                    if (line) {
                        try { events.push({ block: block, data: JSON.parse(line.slice(5).trim()) }); } catch (e) { /* ignore */ }
                    }
                });
            });
            resolve({ req: req, events: events, label: label });
        });
        req.on("error", function () { resolve(null); });
    });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function main() {
    const stamp = Date.now();
    const a = "pa" + stamp + "@gmail.com";
    const b = "pb" + stamp + "@gmail.com";
    await request("POST", "/api/register", { fullName: "Person A", email: a, password: "pass1234" });
    await request("POST", "/api/register", { fullName: "Person B", email: b, password: "pass1234" });
    const la = await request("POST", "/api/login", { email: a, password: "pass1234" });
    const lb = await request("POST", "/api/login", { email: b, password: "pass1234" });
    const ta = la.body.token;
    const tb = lb.body.token;

    // Nobody is connected yet, so nobody is online.
    let res = await request("GET", "/api/users", null, ta);
    const userB = res.body.users.find(function (u) { return u.email === b; });
    check("the user list carries presence flags", userB && typeof userB.online === "boolean", JSON.stringify(res.body));
    check("nobody is online before anyone connects", userB && userB.online === false, JSON.stringify(userB));

    // Person B opens the chat screen: the live connection is made.
    const bEvents = await openEvents(tb, "B");
    await sleep(600);

    res = await request("GET", "/api/users", null, ta);
    const userB2 = res.body.users.find(function (u) { return u.email === b; });
    check("person B shows as online once connected", userB2 && userB2.online === true, JSON.stringify(userB2));

    const aEvents = await openEvents(ta, "A");
    await sleep(600);

    res = await request("GET", "/api/users", null, ta);
    const list = res.body.users;
    check("person A is not in their own list", !list.some(function (u) { return u.email === a; }));
    check("person B is listed as online", list.find(function (u) { return u.email === b; }).online === true);

    // A presence event must be pushed when someone comes online.
    const presenceEvent = aEvents.events.find(function (e) { return e.block.indexOf("event: presence") === 0; });
    check("a presence event is broadcast", !!presenceEvent, JSON.stringify(aEvents.events.map(function (e) { return e.block.slice(0, 40); })));

    // Person B leaves.
    bEvents.req.destroy();
    await sleep(800);

    res = await request("GET", "/api/users", null, ta);
    const userB3 = res.body.users.find(function (u) { return u.email === b; });
    check("person B is offline again after leaving", userB3 && userB3.online === false, JSON.stringify(userB3));
    check("a last seen time is recorded", userB3 && !!userB3.lastSeenAt, JSON.stringify(userB3));

    aEvents.req.destroy();
    console.log("\n" + passed + " passed, " + failed + " failed");
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(function (e) { console.error("crashed:", e); process.exit(1); });
