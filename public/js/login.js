/* Login page: validate input, authenticate, then navigate to the chat app. */

(function () {
    "use strict";

    const form = document.getElementById("loginForm");
    const gmail = document.getElementById("gmail");
    const password = document.getElementById("password");
    const message = document.getElementById("message");

    function setMessage(text, isError) {
        message.textContent = text;
        message.classList.toggle("error", Boolean(isError));
    }

    function clearMessage() {
        setMessage("", false);
    }

    // Already signed in? Verify the token is still valid, then go to chats.
    if (API.getToken()) {
        API.me().then(function () {
            window.location.replace("app.html");
        }).catch(function () {
            API.setToken("");
        });
    }

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
            // Navigate immediately — replace() avoids history buildup.
            window.location.replace("app.html");
        }).catch(function (error) {
            setMessage(error.message, true);
            button.disabled = false;
        });
    });

    [gmail, password].forEach(function (input) {
        input.addEventListener("input", clearMessage);
    });
}());
