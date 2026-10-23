/* Validation rules shared by the browser and the server. */

(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    } else {
        root.Validation = api;
    }
}(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    // Gmail address: local part + @gmail.com, no spaces, single @.
    const GMAIL_PATTERN = /^[^\s@]+@gmail\.com$/i;
    const NAME_PATTERN = /^[A-Za-z][A-Za-z\s'.-]{1,49}$/;

    function isValidGmail(email) {
        return GMAIL_PATTERN.test(String(email || "").trim());
    }

    function isValidName(name) {
        return NAME_PATTERN.test(String(name || "").trim());
    }

    function passwordIssues(password) {
        const issues = [];
        const value = String(password || "");
        if (value.length < 8) {
            issues.push("Password must be at least 8 characters.");
        }
        if (!/[A-Za-z]/.test(value)) {
            issues.push("Password must include at least one letter.");
        }
        if (!/\d/.test(value)) {
            issues.push("Password must include at least one number.");
        }
        return issues;
    }

    // Returns an error string, or null when the details are valid.
    function registrationError(fullName, email, password, existingUser) {
        const name = String(fullName || "").trim();
        const mail = String(email || "").trim();

        if (name === "") return "Please enter your full name.";
        if (!isValidName(name)) {
            return "Name must be 2-50 letters and may include spaces, apostrophes, dots or hyphens.";
        }
        if (mail === "") return "Please enter your Gmail address.";
        if (!isValidGmail(mail)) return "Enter a valid Gmail address (example@gmail.com).";
        if (existingUser) return "An account with this Gmail already exists. Try logging in.";

        const issues = passwordIssues(password);
        if (issues.length > 0) return issues[0];
        return null;
    }

    return {
        isValidGmail: isValidGmail,
        isValidName: isValidName,
        passwordIssues: passwordIssues,
        registrationError: registrationError
    };
}));
