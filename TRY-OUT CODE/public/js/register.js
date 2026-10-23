const form = document.getElementById("registerForm");
const fullName = document.getElementById("fullName");
const gmail = document.getElementById("gmail");
const password = document.getElementById("password");
const confirmPassword = document.getElementById("confirmPassword");
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

(function continueRedirect() {
    let pending = "";
    try { pending = sessionStorage.getItem(REDIRECT_KEY) || ""; } catch (error) { /* ignore */ }
    if (pending) {
        clearRedirect();
        window.location.replace(pending);
    }
}());

function setMessage(text, isError) {
    message.textContent = text;
    message.classList.toggle("error", Boolean(isError));
}

function clearMessage() {
    setMessage("", false);
}

form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearMessage();

    const name = fullName.value.trim();
    const email = gmail.value.trim();
    const pass = password.value;

    if (name === "") {
        setMessage("Please enter your full name.", true);
        return;
    }
    if (!Validation.isValidName(name)) {
        setMessage("Name must be 2-50 letters and may include spaces, apostrophes, dots or hyphens.", true);
        return;
    }
    if (email === "") {
        setMessage("Please enter your Gmail address.", true);
        return;
    }
    if (!Validation.isValidGmail(email)) {
        setMessage("Enter a valid Gmail address (example@gmail.com).", true);
        return;
    }
    if (pass === "") {
        setMessage("Please enter a password.", true);
        return;
    }
    const issues = Validation.passwordIssues(pass);
    if (issues.length > 0) {
        setMessage(issues[0], true);
        return;
    }
    if (pass !== confirmPassword.value) {
        setMessage("Passwords do not match.", true);
        return;
    }

    const button = form.querySelector("button[type=submit]");
    button.disabled = true;

    API.register(name, email, pass).then(function () {
        setMessage("Account created! Redirecting to login...", false);
        form.reset();
        rememberRedirect("index.html");
        setTimeout(function () {
            clearRedirect();
            window.location.href = "index.html";
        }, 900);
    }).catch(function (error) {
        setMessage(error.message, true);
        button.disabled = false;
    });
});

[fullName, gmail, password, confirmPassword].forEach(function (input) {
    input.addEventListener("input", clearMessage);
});
