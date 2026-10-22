# Chat App

A WhatsApp-style messaging app. Register, log in, pick a person from the
People tab, and start chatting — messages arrive instantly, no refresh needed.

Built with **plain HTML, CSS and JavaScript** on the front end and a
**zero-dependency Node.js server** on the back end. No npm install required.

It is also a **Progressive Web App**: you can install it on your phone or
desktop and open it in its own window, just like a native app.

## Run it

```bash
node server.js
```

Then open <http://localhost:3000>

Change the port if you like:

```bash
PORT=8080 node server.js
```

## Install it as an app

The app ships with a web app manifest, a service worker and its own icons, so
browsers can install it directly.

**On a phone (Android / iOS):**
1. Open the site in Chrome (or Safari).
2. Tap **⋮** → **Install app** (Android) or **Share → Add to Home Screen** (iOS).
3. The Chat App icon appears on your home screen and opens without a browser
   address bar.

**On a desktop (Chrome / Edge):**
1. Open <http://localhost:3000>.
2. Click the install icon (⊕) in the address bar, or use the **Install app**
   banner at the bottom of the page.

**iOS Safari on a computer:** File → Add to Dock.

Notes:
- The app needs to be served over **HTTPS or localhost** for installation to
  be offered. On a phone over plain HTTP on your Wi-Fi, the browser may still
  let you add it to the home screen, but the service worker will not run.
- Install works offline for the app shell (pages, styles, scripts, icons).
  Chat messages obviously still need the server running.

### Try it with two people

1. Open <http://localhost:3000> in Chrome and register `alice@gmail.com`.
2. Open a **second browser profile** (or another device on the same Wi-Fi)
   and register `bob@gmail.com`.
3. In Alice's window: **People** tab → click Bob → type a message → Enter.
4. Bob's window shows the message straight away, with an unread badge.

To use it on your phone, start the server and visit
`http://<your-computers-ip>:3000` from the phone on the same Wi-Fi.

## Layout

```
server.js          HTTP server: static files, JSON API, live event stream
lib/store.js       Data layer - stores users, sessions and messages in data/db.json
public/
  index.html       Login page
  register.html    Registration page
  app.html         The chat screen (conversation list + message thread)
  offline.html     Shown when the app is opened with no connection
  manifest.json    Web app manifest (name, icons, colours, shortcuts)
  sw.js            Service worker: caches the app shell for offline use
  css/styles.css   All styling
  js/validate.js   Validation rules, shared by browser and server
  js/api.js        API client, holds the session token
  js/login.js      Login page logic
  js/register.js   Registration page logic
  js/chat.js       Chat screen logic
  js/pwa.js        Service worker registration + install prompt
  icons/           App icons (generated, see below)
data/db.json       Your accounts and messages (created on first run)
scripts/
  make-icons.js    Regenerates the icons (no image libraries needed)
```

## App icons

The icons are generated from code, so they can be tweaked and rebuilt:

```bash
npm run icons
```

This writes `public/icons/*.png` (192, 512, maskable variants, plus an Apple
touch icon and a favicon) using only Node's built-in `zlib`.

## API

| Method | Path              | Purpose                              |
| ------ | ----------------- | ------------------------------------ |
| POST   | `/api/register`   | Create an account                    |
| POST   | `/api/login`      | Sign in, returns a session token     |
| POST   | `/api/logout`     | End the session                      |
| GET    | `/api/me`         | The signed-in user                   |
| GET    | `/api/users`      | Everyone else on the app             |
| GET    | `/api/conversations` | Chat list with unread counts       |
| GET    | `/api/messages?peer=email` | Messages in one conversation  |
| POST   | `/api/messages`   | Send a message                       |
| GET    | `/api/events`     | Live event stream (Server-Sent Events) |

Authenticated calls use the `X-Session-Token` header.

## Security notes

- Passwords are hashed with **scrypt** and a random salt — never stored as
  plain text.
- Sessions are random 32-byte tokens held server-side.
- The session token is the only thing kept in the browser's `localStorage`.
- The service worker never caches `/api/*` responses, so chat data is never
  stored in the browser cache.

## Limitations

This is a local/learning project, so a few things are simplified:

- The database is a JSON file, so it suits tens of users, not thousands.
- There is no rate limiting on the login endpoint.
- Messages are plain text — no encryption, no media, no groups.
- The live connection uses Server-Sent Events, which is one-way (server to
  browser). Sending still goes through the normal API.
- Offline mode covers the app shell only; you need the server for messages.

Before real-world use, add HTTPS, rate limiting, and a proper database.

## Tests

```bash
npm test             # runs all three suites
node test-dom.js     # checks the HTML and JS agree on element ids
node test-pwa.js     # checks the manifest, icons and service worker
node test-e2e.js     # registers two users, exchanges messages, checks live delivery
```

`test-e2e.js` needs the server running.

