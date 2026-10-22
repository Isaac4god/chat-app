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
        source: null
    };

    /* ---------- Formatting ---------- */

    function initials(name) {
        const parts = String(name || "?").trim().split(/\s+/);
        if (parts.length === 1) return parts[0].charAt(0);
        return parts[0].charAt(0) + parts[parts.length - 1].charAt(0);
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
        return { fullName: email, email: email };
    }

    function buildRow(name, email, right, preview) {
        const li = document.createElement("li");
        li.dataset.email = email;

        const avatar = document.createElement("span");
        avatar.className = "avatar";
        avatar.textContent = initials(name);

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
            previewEl.className = "row-preview";
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

            const li = buildRow(conv.fullName, conv.peer, time, conv.lastText);

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

        const visible = state.users.filter(function (user) {
            return matchesSearch(user.fullName) || matchesSearch(user.email);
        });

        visible.forEach(function (user) {
            const li = buildRow(user.fullName, user.email, null, user.email);
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
        el.sidebarEmpty.textContent = state.search
            ? "No one matches that search."
            : "You are the only person here so far.";
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

        const myEmail = state.me.email.toLowerCase();
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
            return;
        }
        const peer = userByEmail(state.peer);
        el.peerName.textContent = peer.fullName;
        el.peerStatus.textContent = peer.email;
        el.peerAvatar.textContent = initials(peer.fullName);
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
        renderConversations();
    });

    el.tabPeople.addEventListener("click", function () {
        state.tab = "people";
        el.tabPeople.classList.add("active");
        el.tabChats.classList.remove("active");
        el.conversationList.classList.add("hidden");
        el.peopleList.classList.remove("hidden");
        renderPeople();
        refreshUsers();
    });

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
        state.me = data.user;
        el.myName.textContent = state.me.fullName;
        el.myEmail.textContent = state.me.email;
        el.myAvatar.textContent = initials(state.me.fullName);
        setComposerEnabled(false);
        renderMessages();

        return Promise.all([refreshSidebar(), refreshUsers()]);
    }).then(function () {
        connectLive();
    }).catch(function (error) {
        if (error.status === 401) {
            API.setToken("");
            window.location.replace("index.html");
            return;
        }
        el.liveStatus.textContent = error.message;
    });
}());
