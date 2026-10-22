const form = document.getElementById("loginForm");
const gmail = document.getElementById("gmail");
const password = document.getElementById("password");
const message = document.getElementById("message");

// A live-reload (Live Server watching the workspace, or a manual refresh)
// can wipe the page while the redirect timer is still pending. Remembering
// the target in sessionStorage lets the reloaded page continue the redirect.
const REDIRECT_KEY = "chat.redirect";

function rememberRedirect(path) {
    try { sessionStorage.setItem(REDIRECT_KEY, path); } catch (error) { /* ignore */ }
}

function clearRedirect() {
    try { sessionStorage.removeItem(REDIRECT_KEY); } catch (error) { /* ignore */ }
}

function setMessage(text, isError) {
    message.textContent = text;
    message.classList.toggle("error", Boolean(isError));
}

function clearMessage() {
    setMessage("", false);
}

// Already signed in? Go straight to the chats.
if (API.getToken()) {
    API.me().then(function () {
        window.location.replace("app.html");
    }).catch(function () {
        API.setToken("");
    });
}

(function continueRedirect() {
    let pending = "";
    try { pending = sessionStorage.getItem(REDIRECT_KEY) || ""; } catch (error) { /* ignore */ }
    if (pending) {
        clearRedirect();
        window.location.replace(pending);
    }
}());

form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearMessage();

    const email = gmail.value.trim();
    const pass = password.value;

    if (email === "") {
        setMessage("Please enter your Gmail address.", true);
        return;
    }
    if (!Validation.isValidGmail(email)) {
        setMessage("Enter a valid Gmail address (example@gmail.com).", true);
        return;
    }
    if (pass === "") {
        setMessage("Please enter your password.", true);
        return;
    }

    const button = form.querySelector("button[type=submit]");
    button.disabled = true;

    API.login(email, pass).then(function (data) {
        API.setToken(data.token);
        setMessage("Welcome back, " + data.user.fullName + "!", false);
        rememberRedirect("app.html");
        setTimeout(function () {
            clearRedirect();
            window.location.href = "app.html";
        }, 600);
    }).catch(function (error) {
        setMessage(error.message, true);
        button.disabled = false;
    });
});

[gmail, password].forEach(function (input) {
    input.addEventListener("input", clearMessage);
});
