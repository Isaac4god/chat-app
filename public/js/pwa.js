/* Registers the service worker and wires up the "Install app" button. */

(function () {
    "use strict";

    const INSTALL_KEY = "chat.installDismissed";
    let deferredPrompt = null;

    function canPrompt() {
        try {
            return !localStorage.getItem(INSTALL_KEY);
        } catch (error) {
            return true;
        }
    }

    function rememberDismissed() {
        try { localStorage.setItem(INSTALL_KEY, "1"); } catch (error) { /* ignore */ }
    }

    // Already running as an installed app? Then there is nothing to offer.
    function isInstalled() {
        return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
            window.navigator.standalone === true;
    }

    let pendingShow = false;

    function showBanner() {
        const banner = document.getElementById("installBanner");
        // The event can fire before the DOM is parsed; try again later.
        if (!banner) {
            pendingShow = true;
            return;
        }
        pendingShow = false;
        banner.classList.remove("hidden");
    }

    function hideBanner() {
        const banner = document.getElementById("installBanner");
        if (banner) banner.classList.add("hidden");
    }

    // Shown when the browser cannot offer its own install dialog.
    function showInstallHelp() {
        const help = document.getElementById("installHelp");
        if (!help) return;
        help.textContent = "Use your browser's menu (\u22EE) and choose \"Install app\" or \"Add to Home screen\".";
        help.classList.remove("hidden");
    }

    window.addEventListener("beforeinstallprompt", function (event) {
        // The browser wants to show its own install UI; we show ours instead.
        event.preventDefault();
        deferredPrompt = event;

        if (canPrompt() && !isInstalled()) {
            showBanner();
        }
    });

    window.addEventListener("appinstalled", function () {
        deferredPrompt = null;
        rememberDismissed();
        hideBanner();
    });

    document.addEventListener("DOMContentLoaded", function () {
        // Show a banner that was requested before the page was ready.
        if (pendingShow && deferredPrompt && canPrompt() && !isInstalled()) {
            showBanner();
        }

        const installButton = document.getElementById("installButton");
        const dismissButton = document.getElementById("installDismiss");

        if (installButton) {
            installButton.addEventListener("click", function () {
                if (!deferredPrompt) {
                    // No prompt available: explain how to install manually.
                    showInstallHelp();
                    return;
                }

                // The browser only lets a deferred prompt be used once, so
                // take it over before showing it.
                const prompt = deferredPrompt;
                deferredPrompt = null;

                try {
                    prompt.prompt();
                } catch (error) {
                    console.warn("The install prompt could not be shown", error);
                    showInstallHelp();
                    return;
                }

                const choice = prompt.userChoice;
                if (!choice || typeof choice.then !== "function") {
                    hideBanner();
                    return;
                }

                choice.then(function (result) {
                    // Only a real installation counts as "do not ask again".
                    // A dismissed browser dialog must not hide the banner for
                    // good, otherwise the app can never be installed later.
                    if (result && result.outcome === "accepted") rememberDismissed();
                    hideBanner();
                }).catch(function (error) {
                    console.warn("The install prompt failed", error);
                    hideBanner();
                });
            });
        }

        if (dismissButton) {
            dismissButton.addEventListener("click", function () {
                rememberDismissed();
                hideBanner();
            });
        }
    });

    /* ---------- Service worker ---------- */

    if ("serviceWorker" in navigator) {
        window.addEventListener("load", function () {
            navigator.serviceWorker.register("sw.js").then(function (registration) {
                // Apply a waiting worker straight away.
                if (registration.waiting) {
                    registration.waiting.postMessage({ type: "SKIP_WAITING" });
                }
                registration.addEventListener("updatefound", function () {
                    const worker = registration.installing;
                    if (!worker) return;
                    worker.addEventListener("statechange", function () {
                        if (worker.state === "installed" && navigator.serviceWorker.controller) {
                            showUpdateHint();
                        }
                    });
                });
            }).catch(function (error) {
                console.warn("Service worker registration failed", error);
            });
        });
    }

    let updateHintShown = false;

    function showUpdateHint() {
        const note = document.getElementById("updateNote");
        if (!note) return;
        // The worker can report the new version more than once; adding the
        // reload handler again would reload the page several times over.
        if (updateHintShown) return;
        updateHintShown = true;

        const text = document.getElementById("updateText");
        if (text) text.textContent = "A new version is ready.";
        note.classList.remove("hidden");
        const button = document.getElementById("updateButton");
        if (button) {
            button.classList.remove("hidden");
            button.addEventListener("click", function () {
                window.location.reload();
            });
        }
    }
}());
