# RoboCamp 2026 — Competition Dashboard

Live competition dashboard for **RoboCamp 2026**, a mock robotics competition with 8 teams.

- **Public display** polls a Google Sheet as CSV — no auth, no backend needed for reads
- **Volunteer admin panel** writes scores and queue changes back to the sheet via a Vercel serverless function
- Deploys cleanly on **Vercel** (static files + one serverless function)

---

## Google Sheet setup

### 1. Create the spreadsheet

Create a Google Sheet with exactly **three tabs** named:

#### Tab: `Teams`
| A: ID | B: Name | C: Number | D: Round 1 | E: Round 2 | F: Round 3 |
|-------|---------|-----------|------------|------------|------------|
| 1 | Robo Rangers | 1001 | | | |
| 2 | Circuit Breakers | 1002 | | | |
| 3 | Tech Titans | 1003 | | | |
| 4 | Code Crushers | 1004 | | | |
| 5 | Bot Squad | 1005 | | | |
| 6 | Gear Grinders | 1006 | | | |
| 7 | Brick Builders | 1007 | | | |
| 8 | Logic League | 1008 | | | |

#### Tab: `Schedule`
| A: Match | B: Team Name | C: Team Number | D: Round |
|----------|-------------|----------------|----------|
| 1 | Robo Rangers | 1001 | 1 |
| 2 | Circuit Breakers | 1002 | 1 |
| ... | | | |

#### Tab: `Status`
| A: Key | B: Value |
|--------|----------|
| CurrentTeamName | Robo Rangers |
| CurrentTeamNumber | 1001 |
| CurrentRound | 1 |
| QueueIndex | 0 |

> Row order in the Status tab must be exactly as shown — the app reads by row position.

### 2. Publish the sheet (for public CSV reads)

1. **File → Share → Publish to web**
2. Choose **Entire document** and format **Web page**, click **Publish**
3. Also make sure **File → Share → Share with anyone** is set to **Viewer** (anyone with link)

> This lets the display page fetch CSV data directly from Google — no API key needed for reads.

### 3. Create a service account (for admin writes)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project (or use an existing one)
3. Enable the **Google Sheets API**
4. Go to **IAM & Admin → Service Accounts** → Create service account
5. Download the JSON key file
6. **Share your spreadsheet** with the service account email (e.g. `robocamp@project.iam.gserviceaccount.com`) as **Editor**

### 4. Get your Spreadsheet ID

The ID is the long string in the sheet URL:
```
https://docs.google.com/spreadsheets/d/THIS_IS_YOUR_ID/edit
```

---

## Configuration

### In `public/display.js` and `public/admin.js`

At the top of each file, set:

```js
const SHEET_ID = 'your-spreadsheet-id-here';
```

### In Vercel (environment variables)

| Variable | Value |
|---|---|
| `GOOGLE_SHEET_ID` | Your spreadsheet ID |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The full contents of your service account JSON key (paste the entire JSON as a single string) |

### Admin password

In `api/update.js`, change:
```js
const ADMIN_PASSWORD = 'Marshmellow';
```

---

## Running locally

```bash
npm install
npm start        # static preview only (no admin writes)
```

For full local dev including admin API:
```bash
npm install -g vercel
vercel dev       # runs Vercel dev server with serverless functions
```

Set env vars locally with a `.env` file (Vercel CLI reads it automatically):
```
GOOGLE_SHEET_ID=your-id-here
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

---

## Deploying to Vercel

```bash
npm install -g vercel
vercel --prod
```

Then in the Vercel dashboard → your project → **Settings → Environment Variables**, add:
- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`

Redeploy after adding env vars. That's it.

> The public display page at `/` fetches the Google Sheet CSV directly from the browser — no cold start, no server cost, just fast CSV polling every 4 seconds.

---

## Architecture

```
Browser (display page)
  └─ fetch CSV every 4s ──────────────────→ Google Sheets (public)

Browser (admin panel)
  ├─ fetch CSV every 5s ──────────────────→ Google Sheets (public read)
  └─ POST /api/update ──→ Vercel function ──→ Google Sheets API (authenticated write)
```

---

## Project structure

```
/
├── api/
│   └── update.js       # Vercel serverless function — all admin writes
├── public/
│   ├── index.html      # Public display page
│   ├── admin.html      # Volunteer control panel
│   ├── style.css       # Cream-gold theme
│   ├── display.js      # Polls CSV, renders scoreboard/schedule/queue
│   └── admin.js        # Admin controls, writes via /api/update
├── server.js           # Minimal local static server (npm start)
├── vercel.json         # Vercel routing config
└── package.json
```

---

## Admin panel

Password: **Marshmellow** (change in `api/update.js`)

| Control | What it does |
|---|---|
| Timer | Local countdown (per-browser, not synced — sync coming later) |
| Next / Previous | Advances queue position and updates Status tab |
| Enter Score | Writes score to Teams tab column D/E/F |
| Set Current Match | Overwrites Status tab rows 1–3 |
| Teams | Edit names/numbers; Save writes to Teams tab (scores preserved) |
| Schedule | Edit order; Save rewrites Schedule tab |
