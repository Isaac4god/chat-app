/* Thin API client: keeps the session token and talks to the Render server. */

(function (root) {
    "use strict";

    const TOKEN_KEY = "chat.session";
    const API_BASE = "https://chat-app-backend-wg29.onrender.com";

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

    async function request(path, options) {
        const settings = Object.assign({ headers: {} }, options || {});
        settings.headers["Content-Type"] = "application/json";
        const token = getToken();
        if (token) settings.headers["X-Session-Token"] = token;

        const target = API_BASE + path;

        let response;
        try {
            response = await fetch(target, settings);
        } catch (error) {
            throw new Error("Cannot reach the chat server at " + target + ".");
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
            throw new Error("The server at " + target + " did not return JSON.");
        }
        return data;
    }

    root.API = {
        getToken: getToken,
        setToken: setToken,
        url: function (path) {
            return API_BASE + path;
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
