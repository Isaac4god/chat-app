/* Thin API client: keeps the session token and talks to the server. */

(function (root) {
    "use strict";

    const TOKEN_KEY = "chat.session";

    function getToken() {
        try {
            return localStorage.getItem(TOKEN_KEY) || "";
        } catch (error) {
            return "";
        }
    }

    function setToken(token) {
        try {
            if (token) localStorage.setItem(TOKEN_KEY, token);
            else localStorage.removeItem(TOKEN_KEY);
        } catch (error) {
            console.warn("Could not store the session token", error);
        }
    }

    /* ---------- API base resolution ---------- */

    // The page may be opened from a static server (VS Code Live Server,
    // python -m http.server, ...). Those servers cannot serve /api/*, so the
    // requests have to go to the real Node server on a different origin.
    // Resolution order:
    //   1. ?api=http://host:port  -> explicit override (also remembered)
    //   2. saved override from a previous visit
    //   3. same origin, if it really answers /api/health
    //   4. http://localhost:3000   (the default port of the Node server)
    const BASE_KEY = "chat.apiBase";
    const FALLBACK_BASE = "http://localhost:3000";

    function normalizeBase(value) {
        return String(value || "").replace(/\/+$/, "");
    }

    function readOverride() {
        try {
            const params = new URLSearchParams(window.location.search);
            const value = params.get("api");
            if (value) {
                const base = normalizeBase(value);
                localStorage.setItem(BASE_KEY, base);
                return base;
            }
        } catch (error) {
            /* ignore */
        }
        return "";
    }

    function readSavedBase() {
        try {
            return normalizeBase(localStorage.getItem(BASE_KEY));
        } catch (error) {
            return "";
        }
    }

    async function probe(base) {
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        const timer = setTimeout(function () {
            if (controller) controller.abort();
        }, 2500);
        try {
            const response = await fetch(normalizeBase(base) + "/api/health", {
                method: "GET",
                cache: "no-store",
                signal: controller ? controller.signal : undefined
            });
            if (!response.ok) return false;
            const data = await response.json();
            return !!(data && data.ok);
        } catch (error) {
            return false;
        } finally {
            clearTimeout(timer);
        }
    }

    async function resolveBase() {
        // 1. An explicit ?api= override always wins.
        const override = readOverride();
        if (override) return override;

        // 2. Same origin, but only if it really serves the API.
        if (await probe("")) return "";

        // 3. A previously saved override, if it still answers.
        const saved = readSavedBase();
        if (saved && (await probe(saved))) return saved;

        // 4. The default port of the Node server.
        if (await probe(FALLBACK_BASE)) return FALLBACK_BASE;

        // Nothing answered; keep the fallback so the error message is useful.
        return FALLBACK_BASE;
    }

    // Start resolving straight away so the first API call does not wait.
    const basePromise = resolveBase();

    function getBase() {
        return basePromise;
    }

    async function request(path, options) {
        const settings = Object.assign({ headers: {} }, options || {});
        settings.headers["Content-Type"] = "application/json";
        const token = getToken();
        if (token) settings.headers["X-Session-Token"] = token;

        const base = await getBase();
        const target = base + path;

        let response;
        try {
            response = await fetch(target, settings);
        } catch (error) {
            throw new Error(
                "Cannot reach the chat server at " + target + ". " +
                "Start it with \"npm start\", or point the page at it with ?api=http://localhost:3000"
            );
        }

        let data = null;
        let parsed = false;
        try {
            data = await response.json();
            parsed = true;
        } catch (error) {
            data = null;
        }

        if (!response.ok) {
            const message = data && data.error ? data.error : "Something went wrong.";
            const failure = new Error(message);
            failure.status = response.status;
            throw failure;
        }

        if (!parsed && response.status !== 204) {
            throw new Error(
                "The server at " + target + " did not return JSON. " +
                "This page is probably served by a static server that has no API. " +
                "Add ?api=http://localhost:3000 to the URL."
            );
        }
        return data;
    }

    root.API = {
        getToken: getToken,
        setToken: setToken,
        // Builds a full URL for an API path, honouring the resolved base.
        url: async function (path) {
            return (await getBase()) + path;
        },
        register: function (fullName, email, password) {
            return request("/api/register", {
                method: "POST",
                body: JSON.stringify({ fullName: fullName, email: email, password: password })
            });
        },
        login: function (email, password) {
            return request("/api/login", {
                method: "POST",
                body: JSON.stringify({ email: email, password: password })
            });
        },
        logout: function () {
            return request("/api/logout", { method: "POST" });
        },
        me: function () {
            return request("/api/me");
        },
        users: function () {
            return request("/api/users");
        },
        conversations: function () {
            return request("/api/conversations");
        },
        messages: function (peer) {
            return request("/api/messages?peer=" + encodeURIComponent(peer));
        },
        markRead: function (peer) {
            return request("/api/read", {
                method: "POST",
                body: JSON.stringify({ peer: peer })
            });
        },
        send: function (to, text) {
            return request("/api/messages", {
                method: "POST",
                body: JSON.stringify({ to: to, text: text })
            });
        }
    };
}(window));
