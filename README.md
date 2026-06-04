# RoboCamp 2026 — Competition Dashboard

Live competition dashboard for **RoboCamp 2026**, a mock robotics competition with 8 teams. Built with Node.js + Express + Socket.io.

---

## Features

- **Public display page** (`/`) — large live timer, match queue, scoreboard, and full schedule; synced in real time across all connected clients
- **Volunteer control panel** (`/admin.html`) — password-protected; controls timer, scores, match queue, teams, and schedule
- **Server-authoritative timer** — timer state lives on the server; all clients receive updates via Socket.io
- **"TIME'S UP" indicator** — fires automatically when timer reaches 0:00
- **Live sync** — every connected display updates instantly when volunteers make changes

---

## Configurable Values

Open **`server.js`** and edit the block at the top:

```js
const ADMIN_PASSWORD   = 'Marshmellow';   // volunteer panel passcode
const COMPETITION_NAME = 'RoboCamp 2026'; // shown in header
const TIMER_DURATION   = 150;             // seconds (150 = 2:30)

const INITIAL_TEAMS = [
  { id: 1, name: 'Robo Rangers',     number: '1001' },
  // ... 8 teams total
];
```

---

## Running Locally

### Prerequisites
- Node.js 18 or later
- npm

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start

# 3. Open in browser
#   Public display:  http://localhost:3000
#   Volunteer panel: http://localhost:3000/admin.html
```

For development with auto-restart on file changes (Node 18+):

```bash
npm run dev
```

---

## Deployment

### Option A — Render (recommended, fully free, zero config)

Render runs a persistent Node.js process, which is what Socket.io + in-memory state require. No extra steps needed.

1. Push this repo to GitHub.
2. Go to [render.com](https://render.com) → **New Web Service**.
3. Connect your repo and set:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. Deploy. Share `/` with spectators and `/admin.html` with volunteers.

> The free tier spins down after 15 min of inactivity. Open the URL a few minutes before the competition starts to wake it up, or use the Starter plan ($7/mo) to keep it always-on.

---

### Option B — Vercel (frontend) + Render (backend)

Vercel's serverless functions can't hold Socket.io state, so the backend must still run on Render. This split setup lets the public display URL live on Vercel's CDN while the Socket.io server runs on Render.

**Step 1 — Deploy the backend to Render** (same as Option A above).  
Note the URL Render gives you, e.g. `https://robocamp-2026-dash.onrender.com`.

**Step 2 — Point the clients at the Render backend.**  
In both `public/display.js` and `public/admin.js`, change the first line from:

```js
const socket = io({ transports: ['polling', 'websocket'] });
```

to:

```js
const socket = io('https://robocamp-2026-dash.onrender.com', { transports: ['polling', 'websocket'] });
```

**Step 3 — Deploy to Vercel.**

```bash
npm i -g vercel
vercel --prod
```

Vercel will detect the `vercel.json` and route all requests through `server.js`. The static files are served by Express via Vercel's Node runtime — but **the Socket.io real-time connection goes directly to your Render URL**, not through Vercel.

> **Practical advice:** For a one-day competition, Option A (Render only) is simpler — one URL, one service, nothing to keep in sync. Use the split setup only if you specifically want the public display URL on a custom Vercel domain.

---

## Project Structure

```
robocamp-org-dash/
├── server.js          # Express + Socket.io server — all configurable values here
├── package.json
├── vercel.json        # Reference only (see note above)
├── .gitignore
├── README.md
└── public/
    ├── index.html     # Public display page
    ├── admin.html     # Volunteer control panel
    ├── style.css      # Shared styles (dark theme, responsive)
    ├── display.js     # Client JS for public page
    └── admin.js       # Client JS for admin panel
```

---

## Admin Panel Guide

| Section | What it does |
|---|---|
| **Timer Control** | Start / Stop / Reset the 2:30 countdown. Timer authority is server-side. |
| **Match Queue** | Advance or go back one match. Current and next two matches shown. |
| **Enter Score** | Select team + round, enter total points, save. Scores persist in server memory. |
| **Set Current Match** | Override the displayed team name, number, and round manually. |
| **Teams** | Edit team names and numbers; saving broadcasts changes to all displays. |
| **Match Schedule** | Reorder matches with ↑↓, remove with ✕, add new matches at the bottom. |

Admin password: **Marshmellow** (edit `ADMIN_PASSWORD` in `server.js` to change)

---

## Socket.io Events

| Event (client → server) | Payload |
|---|---|
| `timerStart` | `{ password }` |
| `timerStop` | `{ password }` |
| `timerReset` | `{ password }` |
| `advanceQueue` | `{ password }` |
| `prevQueue` | `{ password }` |
| `submitScore` | `{ password, teamId, round, score }` |
| `deleteScore` | `{ password, teamId, round }` |
| `setCurrentMatch` | `{ password, teamName, teamNumber, round }` |
| `updateTeams` | `{ password, teams[] }` |
| `updateSchedule` | `{ password, schedule[] }` |

| Event (server → client) | Payload |
|---|---|
| `fullState` | Complete state snapshot (sent on connect) |
| `timerUpdate` | `{ remaining, running }` |
| `scoresUpdate` | `{ [teamId]: { [round]: score } }` |
| `queueUpdate` | `{ queueIndex, currentMatch }` |
| `currentMatchUpdate` | `{ teamName, teamNumber, round }` |
| `scheduleUpdate` | `schedule[]` |
| `teamsUpdate` | `teams[]` |
