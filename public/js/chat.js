/* Chat app: conversation list, people list, message thread, live updates. */

(function () {
    "use strict";

    const el = {
        shell: document.querySelector(".chat-shell"),
        myAvatar: document.getElementById("myAvatar"),
        myName: document.getElementById("myName"),
        myEmail: document.getElementById("myEmail"),
        logoutButton: document.getElementById("logoutButton"),
        searchBox: document.getElementById("searchBox"),
        tabChats: document.getElementById("tabChats"),
        tabPeople: document.getElementById("tabPeople"),
        peopleTools: document.getElementById("peopleTools"),
        onlineOnly: document.getElementById("onlineOnly"),
        peopleCount: document.getElementById("peopleCount"),
        conversationList: document.getElementById("conversationList"),
        peopleList: document.getElementById("peopleList"),
        sidebarEmpty: document.getElementById("sidebarEmpty"),
        liveDot: document.getElementById("liveDot"),
        liveStatus: document.getElementById("liveStatus"),
        peerAvatar: document.getElementById("peerAvatar"),
        peerName: document.getElementById("peerName"),
        peerStatus: document.getElementById("peerStatus"),
        messageList: document.getElementById("messageList"),
        placeholder: document.getElementById("placeholder"),
        composer: document.getElementById("composer"),
        composerInput: document.getElementById("composerInput"),
        sendButton: document.getElementById("sendButton"),
        chatError: document.getElementById("chatError"),
        backButton: document.getElementById("backButton")
    };

    const state = {
        me: null,
        users: [],
        conversations: [],
        messages: [],
        peer: null,
        tab: "chats",
        search: "",
        onlineOnly: false,
        source: null
    };

    /* ---------- Formatting ---------- */

    function initials(name) {
        const parts = String(name || "?").trim().split(/\s+/);
        if (parts.length === 1) return parts[0].charAt(0);
        return parts[0].charAt(0) + parts[parts.length - 1].charAt(0);
    }

    // "Online", or "Last seen 5 minutes ago" for people who are not around.
    function presenceText(user) {
        if (user.online) return "Online";
        const seen = user.lastSeenAt ? new Date(user.lastSeenAt) : null;
        if (!seen || isNaN(seen.getTime())) return "Offline";
        return "Last seen " + lastSeenAgo(seen);
    }

    function lastSeenAgo(date) {
        const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
        if (seconds < 60) return "just now";
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return minutes + (minutes === 1 ? " minute ago" : " minutes ago");
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
        const days = Math.floor(hours / 24);
        if (days === 1) return "yesterday";
        if (days < 7) return days + " days ago";
        return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }

    function clockTime(iso) {
        return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function listTime(iso) {
        const date = new Date(iso);
        const now = new Date();
        const sameDay = date.toDateString() === now.toDateString();
        if (sameDay) return clockTime(iso);
        const yesterday = new Date(now.getTime() - 86400000);
        if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
        return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }

    function dayLabel(iso) {
        const date = new Date(iso);
        const now = new Date();
        if (date.toDateString() === now.toDateString()) return "Today";
        const yesterday = new Date(now.getTime() - 86400000);
        if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
        return date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
    }

    function matchesSearch(text) {
        if (!state.search) return true;
        return String(text || "").toLowerCase().indexOf(state.search) !== -1;
    }

    /* ---------- Rendering: sidebar ---------- */

    function userByEmail(email) {
        const needle = String(email || "").toLowerCase();
        const found = state.users.find(function (user) {
            return user.email.toLowerCase() === needle;
        });
        if (found) return found;
        return { fullName: email, email: email, online: false, lastSeenAt: null };
    }

    function buildRow(name, email, right, preview, online) {
        const li = document.createElement("li");
        li.dataset.email = email;

        const avatar = document.createElement("span");
        avatar.className = "avatar";
        avatar.textContent = initials(name);

        // A small dot on the avatar shows whether the person is online now.
        if (online) {
            const badge = document.createElement("span");
            badge.className = "avatar-online";
            badge.title = "Online";
            avatar.appendChild(badge);
        }

        const text = document.createElement("div");
        text.className = "row-text";

        const top = document.createElement("div");
        top.className = "row-top";

        const nameEl = document.createElement("span");
        nameEl.className = "row-name";
        nameEl.textContent = name;

        top.appendChild(nameEl);

        if (right) top.appendChild(right);

        text.appendChild(top);

        if (preview) {
            const previewEl = document.createElement("span");
            previewEl.className = online ? "row-preview presence online" : "row-preview presence";
            previewEl.textContent = preview;
            text.appendChild(previewEl);
        }

        li.appendChild(avatar);
        li.appendChild(text);
        return li;
    }

    function renderConversations() {
        const list = el.conversationList;
        list.innerHTML = "";

        const visible = state.conversations.filter(function (conv) {
            return matchesSearch(conv.fullName);
        });

        visible.forEach(function (conv) {
            const time = document.createElement("span");
            time.className = "row-time";
            time.textContent = listTime(conv.lastMessageAt);

            // The dot on the avatar says whether the person is online now.
            const peer = userByEmail(conv.peer);
            const li = buildRow(conv.fullName, conv.peer, time, conv.lastText, peer.online);

            if (conv.unread > 0) {
                const badge = document.createElement("span");
                badge.className = "badge";
                badge.textContent = conv.unread > 99 ? "99+" : conv.unread;
                li.appendChild(badge);
            }
            if (state.peer && state.peer.toLowerCase() === conv.peer.toLowerCase()) {
                li.classList.add("active");
            }

            li.addEventListener("click", function () {
                openConversation(conv.peer);
            });
            list.appendChild(li);
        });

        const nothing = visible.length === 0;
        el.sidebarEmpty.classList.toggle("hidden", !nothing);
        el.sidebarEmpty.textContent = state.search
            ? "No one matches that search."
            : "No conversations yet. Open the People tab to start one.";
    }

    function renderPeople() {
        const list = el.peopleList;
        list.innerHTML = "";

        let visible = state.users.filter(function (user) {
            return matchesSearch(user.fullName) || matchesSearch(user.email);
        });

        // The toggle shows only the people who are signed in right now.
        if (state.onlineOnly) {
            visible = visible.filter(function (user) { return user.online; });
        }

        visible.forEach(function (user) {
            // The second line says whether the person is online now, or when
            // they were last around.
            const li = buildRow(user.fullName, user.email, null, presenceText(user), user.online);
            if (state.peer && state.peer.toLowerCase() === user.email.toLowerCase()) {
                li.classList.add("active");
            }
            li.addEventListener("click", function () {
                openConversation(user.email);
            });
            list.appendChild(li);
        });

        const nothing = visible.length === 0;
        el.sidebarEmpty.classList.toggle("hidden", !nothing);
        if (state.onlineOnly && nothing) {
            el.sidebarEmpty.textContent = "Nobody else is online right now.";
        } else {
            el.sidebarEmpty.textContent = state.search
                ? "No one matches that search."
                : "You are the only person here so far.";
        }

        // "3 online" next to the toggle, so the count is obvious.
        if (el.peopleCount) {
            const online = state.users.filter(function (user) { return user.online; }).length;
            el.peopleCount.textContent = online + " online";
        }
    }

    /* ---------- Rendering: message thread ---------- */

    function renderMessages() {
        const list = el.messageList;
        list.innerHTML = "";

        if (!state.peer) {
            el.placeholder.classList.remove("hidden");
            el.placeholder.textContent = "Pick a person on the left to start a conversation.";
            list.appendChild(el.placeholder);
            return;
        }

        if (state.messages.length === 0) {
            el.placeholder.classList.remove("hidden");
            el.placeholder.textContent = "No messages yet. Say hello!";
            list.appendChild(el.placeholder);
            return;
        }

        el.placeholder.classList.add("hidden");

        const myEmail = (state.me && state.me.email) ? state.me.email.toLowerCase() : "";
        let lastDay = null;

        state.messages.forEach(function (message) {
            const day = new Date(message.createdAt).toDateString();
            if (day !== lastDay) {
                const divider = document.createElement("div");
                divider.className = "day-divider";
                divider.textContent = dayLabel(message.createdAt);
                list.appendChild(divider);
                lastDay = day;
            }

            const bubble = document.createElement("div");
            bubble.className = "bubble";
            if (message.from.toLowerCase() === myEmail) bubble.classList.add("out");

            const text = document.createElement("span");
            text.textContent = message.text;
            bubble.appendChild(text);

            const time = document.createElement("span");
            time.className = "bubble-time";
            time.textContent = clockTime(message.createdAt);
            bubble.appendChild(time);

            list.appendChild(bubble);
        });

        list.scrollTop = list.scrollHeight;
    }

    function updatePeerHeader() {
        if (!state.peer) {
            el.peerName.textContent = "Select someone to chat with";
            el.peerStatus.textContent = "";
            el.peerAvatar.textContent = "?";
            el.peerAvatar.classList.remove("online");
            return;
        }
        const peer = userByEmail(state.peer);
        el.peerName.textContent = peer.fullName;
        // The line under the name says whether the person is around now.
        el.peerStatus.textContent = peer.online
            ? "Online"
            : presenceText(peer);
        el.peerAvatar.textContent = initials(peer.fullName);
        el.peerAvatar.classList.toggle("online", !!peer.online);
    }

    function setComposerEnabled(enabled) {
        el.composerInput.disabled = !enabled;
        el.sendButton.disabled = !enabled || !el.composerInput.value.trim();
        if (enabled) el.composerInput.focus();
    }

    /* ---------- Data ---------- */

    function refreshSidebar() {
        return API.conversations().then(function (data) {
            state.conversations = data.conversations || [];
            renderConversations();
        });
    }

    function refreshUsers() {
        return API.users().then(function (data) {
            state.users = data.users || [];
            renderPeople();
        });
    }

    function openConversation(email) {
        state.peer = email;
        updatePeerHeader();
        setComposerEnabled(true);
        el.shell.classList.add("show-chat");

        API.messages(email).then(function (data) {
            // Ignore a stale response if the user switched conversations meanwhile.
            if (state.peer !== email) return;
            state.messages = data.messages || [];
            renderMessages();
            refreshSidebar();
        }).catch(function (error) {
            if (state.peer !== email) return;
            state.messages = [];
            renderMessages();
            el.chatError.textContent = error.message;
        });
    }

    function sendMessage() {
        const text = el.composerInput.value.trim();
        if (!text || !state.peer) return;

        const to = state.peer;
        el.composerInput.value = "";
        el.chatError.textContent = "";
        autoGrow();
        el.sendButton.disabled = true;

        API.send(to, text).then(function () {
            refreshSidebar();
        }).catch(function (error) {
            el.chatError.textContent = error.message;
            el.composerInput.value = text;
            autoGrow();
            el.sendButton.disabled = false;
        });
    }

    function autoGrow() {
        el.composerInput.style.height = "auto";
        el.composerInput.style.height = Math.min(el.composerInput.scrollHeight, 140) + "px";
    }

    /* ---------- Live updates (SSE) ---------- */

    function connectLive() {
        if (state.source) state.source.close();

        // The SSE endpoint may live on another origin (static-server front end).
        API.url("/api/events?token=" + encodeURIComponent(API.getToken()))
            .then(function (url) {
                const source = new EventSource(url);
                state.source = source;

                source.addEventListener("open", function () {
                    el.liveDot.classList.add("online");
                    el.liveStatus.textContent = "Live";
                });

                source.addEventListener("message", function (event) {
                    let message;
                    try {
                        message = JSON.parse(event.data);
                    } catch (error) {
                        return;
                    }
                    handleIncoming(message);
                });

                // Someone came online or went away: pull the fresh list so
                // the People tab and the online dots update straight away.
                source.addEventListener("presence", function (event) {
                    try {
                        JSON.parse(event.data);
                    } catch (error) {
                        return;
                    }
                    refreshUsers().then(function () {
                        renderConversations();
                        if (state.peer) updatePeerHeader();
                    });
                });

                source.addEventListener("error", function () {
                    el.liveDot.classList.remove("online");
                    el.liveStatus.textContent = "Reconnecting...";
                });
            })
            .catch(function (error) {
                el.liveDot.classList.remove("online");
                el.liveStatus.textContent = error.message || "Live updates unavailable.";
            });
    }

    function handleIncoming(message) {
        // A message in the open conversation: append it to the thread.
        if (state.peer && isPeerOf(message, state.peer)) {
            const exists = state.messages.some(function (m) { return m.id === message.id; });
            if (!exists) {
                state.messages.push(message);
                renderMessages();
            }
            // I am looking at this chat, so it counts as read.
            API.markRead(state.peer).catch(function () { /* ignore */ });
        }
        // Messages for other conversations show up as an unread badge in the sidebar.

        refreshSidebar();
        refreshUsers();
    }

    function isPeerOf(message, email) {
        const peer = String(email).toLowerCase();
        return message.from.toLowerCase() === peer || message.to.toLowerCase() === peer;
    }

    /* ---------- Events ---------- */

    el.composer.addEventListener("submit", function (event) {
        event.preventDefault();
        sendMessage();
    });

    el.composerInput.addEventListener("input", function () {
        autoGrow();
        el.sendButton.disabled = !el.composerInput.value.trim();
        el.chatError.textContent = "";
    });

    el.composerInput.addEventListener("keydown", function (event) {
        // Enter sends, Shift+Enter adds a new line.
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });

    el.tabChats.addEventListener("click", function () {
        state.tab = "chats";
        el.tabChats.classList.add("active");
        el.tabPeople.classList.remove("active");
        el.conversationList.classList.remove("hidden");
        el.peopleList.classList.add("hidden");
        // The online filter only makes sense on the People tab.
        if (el.peopleTools) el.peopleTools.classList.add("hidden");
        renderConversations();
    });

    el.tabPeople.addEventListener("click", function () {
        state.tab = "people";
        el.tabPeople.classList.add("active");
        el.tabChats.classList.remove("active");
        el.conversationList.classList.add("hidden");
        el.peopleList.classList.remove("hidden");
        if (el.peopleTools) el.peopleTools.classList.remove("hidden");
        renderPeople();
        refreshUsers();
    });

    if (el.onlineOnly) {
        el.onlineOnly.addEventListener("change", function () {
            state.onlineOnly = el.onlineOnly.checked;
            renderPeople();
        });
    }

    el.searchBox.addEventListener("input", function () {
        state.search = el.searchBox.value.trim().toLowerCase();
        if (state.tab === "chats") renderConversations();
        else renderPeople();
    });

    el.backButton.addEventListener("click", function () {
        el.shell.classList.remove("show-chat");
    });

    el.logoutButton.addEventListener("click", function () {
        API.logout().catch(function () { /* sign out locally anyway */ })
            .then(function () {
                API.setToken("");
                window.location.href = "index.html";
            });
    });

    /* ---------- Boot ---------- */

    API.me().then(function (data) {
        if (!data || !data.user) {
            throw new Error("Invalid session. Please log in again.");
        }
        state.me = data.user;
        el.myName.textContent = state.me.fullName || state.me.email;
        el.myEmail.textContent = state.me.email;
        el.myAvatar.textContent = initials(state.me.fullName || state.me.email);
        setComposerEnabled(false);
        renderMessages();

        return Promise.all([refreshSidebar(), refreshUsers()]);
    }).then(function () {
        connectLive();
    }).catch(function (error) {
        if (error.status === 401 || error.message === "Invalid session. Please log in again.") {
            API.setToken("");
            // Drop any pending login redirect so the login page cannot bounce
            // the user back to app.html and cause a refresh loop.
            try { sessionStorage.removeItem("chat.redirect"); } catch (error) { /* ignore */ }
            window.location.replace("index.html");
            return;
        }
        el.liveStatus.textContent = error.message;
    });
}());
