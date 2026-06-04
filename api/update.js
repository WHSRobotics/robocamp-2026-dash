'use strict';
// ── Vercel serverless function — handles all admin writes to Google Sheets ──
// Required env vars (set in Vercel dashboard):
//   GOOGLE_SHEET_ID              — the spreadsheet ID from its URL
//   GOOGLE_SERVICE_ACCOUNT_JSON  — full service account JSON as a single string

const { google } = require('googleapis');

// ── CONFIGURABLE ───────────────────────────────────────────────────────────
const ADMIN_PASSWORD = 'Marshmellow';
// ───────────────────────────────────────────────────────────────────────────

function getSheets() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth  = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const ID = () => process.env.GOOGLE_SHEET_ID;

async function read(sheets, range) {
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: ID(), range });
  return r.data.values || [];
}

async function write(sheets, range, values) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: ID(),
    range,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
}

async function clear(sheets, range) {
  await sheets.spreadsheets.values.clear({ spreadsheetId: ID(), range });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { password, action, ...data } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Unauthorized' });

  const sheets = getSheets();

  try {
    switch (action) {

      // Verify password (used by gate form)
      case 'ping':
        break;

      // Write a single score cell — finds team row by ID
      case 'setScore': {
        const { teamId, round, score } = data;
        const teamRows = await read(sheets, 'Teams!A2:A100');
        const rowIdx   = teamRows.findIndex(r => String(r[0]) === String(teamId));
        if (rowIdx === -1) throw new Error(`Team ${teamId} not found`);
        const col = ['D', 'E', 'F'][Number(round) - 1];
        const row = rowIdx + 2;
        const val = score === '' || score == null ? '' : Number(score);
        await write(sheets, `Teams!${col}${row}`, [[val]]);
        break;
      }

      // Overwrite Status tab with new current match
      case 'setCurrentMatch': {
        const { teamName, teamNumber, round, queueIndex } = data;
        await write(sheets, 'Status!B1:B4', [
          [String(teamName   ?? '')],
          [String(teamNumber ?? '')],
          [Number(round      ?? 1)],
          [Number(queueIndex ?? 0)],
        ]);
        break;
      }

      // Read current queue position, move forward one match
      case 'advanceQueue': {
        const [statusRows, schedRows] = await Promise.all([
          read(sheets, 'Status!A1:B4'),
          read(sheets, 'Schedule!A2:D200'),
        ]);
        let qi = Number(statusRows[3]?.[1] ?? 0);
        if (qi < schedRows.length - 1) {
          qi++;
          const m = schedRows[qi];
          await write(sheets, 'Status!B1:B4', [
            [m[1] ?? ''], [m[2] ?? ''], [Number(m[3] ?? 1)], [qi],
          ]);
        }
        break;
      }

      // Move queue backward one match
      case 'prevQueue': {
        const [statusRows, schedRows] = await Promise.all([
          read(sheets, 'Status!A1:B4'),
          read(sheets, 'Schedule!A2:D200'),
        ]);
        let qi = Number(statusRows[3]?.[1] ?? 0);
        if (qi > 0) {
          qi--;
          const m = schedRows[qi];
          await write(sheets, 'Status!B1:B4', [
            [m[1] ?? ''], [m[2] ?? ''], [Number(m[3] ?? 1)], [qi],
          ]);
        }
        break;
      }

      // Overwrite team names/numbers (preserves existing scores)
      case 'updateTeams': {
        const { teams } = data;
        // Read existing scores first so we don't lose them
        const existing = await read(sheets, 'Teams!A2:F100');
        const scoreMap = {};
        existing.forEach(r => {
          if (r[0]) scoreMap[String(r[0])] = [r[3] ?? '', r[4] ?? '', r[5] ?? ''];
        });
        const rows = teams.map(t => {
          const s = scoreMap[String(t.id)] || ['', '', ''];
          return [t.id, t.name, t.number, s[0], s[1], s[2]];
        });
        await clear(sheets, 'Teams!A2:F100');
        if (rows.length) await write(sheets, `Teams!A2:F${rows.length + 1}`, rows);
        break;
      }

      // Overwrite full schedule
      case 'updateSchedule': {
        const { schedule } = data;
        const rows = schedule.map(m => [m.id, m.teamName, m.teamNumber, m.round]);
        await clear(sheets, 'Schedule!A2:D200');
        if (rows.length) await write(sheets, `Schedule!A2:D${rows.length + 1}`, rows);
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[api/update]', err.message);
    res.status(500).json({ error: err.message });
  }
};
