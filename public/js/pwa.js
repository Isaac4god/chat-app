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

    function showBanner() {
        const banner = document.getElementById("installBanner");
        if (!banner || !deferredPrompt) return;
        banner.classList.remove("hidden");
    }

    function hideBanner() {
        const banner = document.getElementById("installBanner");
        if (banner) banner.classList.add("hidden");
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
        const installButton = document.getElementById("installButton");
        const dismissButton = document.getElementById("installDismiss");

        if (installButton) {
            installButton.addEventListener("click", function () {
                if (!deferredPrompt) {
                    // No prompt available: explain how to install manually.
                    const help = document.getElementById("installHelp");
                    if (help) {
                        help.textContent = "Use your browser's menu (⋮) and choose \"Install app\" or \"Add to Home screen\".";
                        help.classList.remove("hidden");
                    }
                    return;
                }
                deferredPrompt.prompt();
                deferredPrompt.userChoice.then(function () {
                    deferredPrompt = null;
                    rememberDismissed();
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

    function showUpdateHint() {
        const note = document.getElementById("updateNote");
        if (!note) return;
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
