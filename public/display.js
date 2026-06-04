'use strict';

// ── CONFIGURE THIS ─────────────────────────────────────────────────────────
// Paste your Google Sheet ID here (the long string in the sheet URL)
const SHEET_ID = 'YOUR_GOOGLE_SHEET_ID_HERE';
// ───────────────────────────────────────────────────────────────────────────

const POLL_MS        = 4000;  // how often to refresh from the sheet (ms)
const TIMER_DURATION = 150;   // 2:30 — for display purposes only for now

// ── CSV helpers ──
function csvUrl(sheetName) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cell += ch;
    } else {
      if      (ch === '"')  { inQ = true; }
      else if (ch === ',')  { row.push(cell.trim()); cell = ''; }
      else if (ch === '\n') {
        row.push(cell.trim()); cell = '';
        if (row.some(Boolean)) rows.push(row);
        row = [];
      } else if (ch === '\r') { /* skip */ }
      else cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

async function fetchSheet(name) {
  const r = await fetch(csvUrl(name));
  if (!r.ok) throw new Error(`Sheet "${name}" fetch failed (${r.status})`);
  return parseCsv(await r.text());
}

// ── Fetch & render ──
async function fetchAll() {
  try {
    const [teamsRows, schedRows, statusRows] = await Promise.all([
      fetchSheet('Teams'),
      fetchSheet('Schedule'),
      fetchSheet('Status'),
    ]);

    // Teams: header in row 0, data from row 1
    // Columns: ID | Name | Number | R1 | R2 | R3
    const teams = teamsRows.slice(1).map(r => ({
      id:     r[0],
      name:   r[1] || '',
      number: r[2] || '',
      scores: {
        1: r[3] !== '' && r[3] != null ? Number(r[3]) : null,
        2: r[4] !== '' && r[4] != null ? Number(r[4]) : null,
        3: r[5] !== '' && r[5] != null ? Number(r[5]) : null,
      },
    }));

    // Schedule: header in row 0, data from row 1
    // Columns: Match# | TeamName | TeamNumber | Round
    const schedule = schedRows.slice(1).map(r => ({
      id:         Number(r[0]) || 0,
      teamName:   r[1] || '',
      teamNumber: r[2] || '',
      round:      Number(r[3]) || 1,
    }));

    // Status: no header — key/value pairs
    // Row 0: CurrentTeamName | <value>
    // Row 1: CurrentTeamNumber | <value>
    // Row 2: CurrentRound | <value>
    // Row 3: QueueIndex | <value>
    const status = Object.fromEntries(statusRows.map(r => [r[0], r[1] ?? '']));
    const currentMatch = {
      teamName:   status['CurrentTeamName']   || '—',
      teamNumber: status['CurrentTeamNumber'] || '—',
      round:      status['CurrentRound']      || '—',
    };
    const queueIndex = Number(status['QueueIndex'] || 0);

    renderCurrentMatch(currentMatch);
    renderQueue(schedule, queueIndex);
    renderScoreboard(teams);
    renderSchedule(schedule, queueIndex);
    setConnStatus('connected');
  } catch (err) {
    console.error('[display]', err.message);
    setConnStatus('error');
  }
}

// ── Render ──
function renderCurrentMatch({ teamName, teamNumber, round }) {
  document.getElementById('cur-team-name').textContent = teamName;
  document.getElementById('cur-team-num').textContent  = teamNumber;
  document.getElementById('cur-round').textContent     = round;
}

function renderQueue(schedule, queueIndex) {
  const list  = document.getElementById('queue-list');
  const slots = [
    { label: 'NOW',  cls: 'now',  idx: queueIndex },
    { label: 'NEXT', cls: 'next', idx: queueIndex + 1 },
    { label: 'THEN', cls: 'then', idx: queueIndex + 2 },
  ];

  const items = slots
    .filter(s => s.idx < schedule.length)
    .map(({ label, cls, idx }) => {
      const m = schedule[idx];
      return `<li class="queue-item${cls === 'now' ? ' queue-now' : ''}">
        <span class="queue-badge ${cls}">${label}</span>
        <span class="queue-text">
          <strong>${esc(m.teamName)}</strong>
          <small> · #${esc(m.teamNumber)} · Rd ${m.round}</small>
        </span>
      </li>`;
    });

  list.innerHTML = items.length
    ? items.join('')
    : '<li class="queue-item queue-empty">No upcoming matches</li>';
}

function renderScoreboard(teams) {
  const tbody = document.getElementById('scoreboard-body');
  if (!teams.length) return;

  const rows = [...teams].sort((a, b) => {
    const ba = bestScore(a), bb = bestScore(b);
    if (ba === null && bb === null) return 0;
    if (ba === null) return 1;
    if (bb === null) return -1;
    return bb - ba;
  });

  tbody.innerHTML = rows.map(({ name, number, scores }, i) => {
    const rank    = i + 1;
    const rankCls = rank <= 3 ? `rank-${rank}` : '';
    const pill    = (v) => v !== null
      ? `<span class="score-pill">${v}</span>`
      : `<span class="score-pill empty">—</span>`;
    const best    = bestScore({ scores });
    const bestHtml = best !== null
      ? `<span class="best-score">${best}</span>`
      : `<span class="best-score no-score">—</span>`;

    return `<tr class="${rankCls}">
      <td><span class="rank-badge">${rank}</span></td>
      <td><strong>${esc(name)}</strong></td>
      <td class="col-num">${esc(number)}</td>
      <td class="col-r">${pill(scores[1])}</td>
      <td class="col-r">${pill(scores[2])}</td>
      <td class="col-r">${pill(scores[3])}</td>
      <td class="col-best">${bestHtml}</td>
    </tr>`;
  }).join('');
}

function renderSchedule(schedule, queueIndex) {
  const tbody = document.getElementById('schedule-body');
  if (!schedule.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">No schedule yet</td></tr>';
    return;
  }
  tbody.innerHTML = schedule.map((m, i) => {
    const cls = i === queueIndex ? 'match-active' : i < queueIndex ? 'match-done' : '';
    return `<tr class="${cls}">
      <td class="col-match">${m.id}</td>
      <td>${esc(m.teamName)}</td>
      <td class="col-num">${esc(m.teamNumber)}</td>
      <td><span class="round-chip r${m.round}">R${m.round}</span></td>
    </tr>`;
  }).join('');
}

function setConnStatus(state) {
  const el = document.getElementById('conn-status');
  el.dataset.state = state === 'connected' ? 'connected' : 'disconnected';
  el.querySelector('.conn-label').textContent =
    state === 'connected' ? 'Live' : 'Connection error — retrying…';
}

function bestScore({ scores }) {
  const vals = Object.values(scores).filter(v => v !== null);
  return vals.length ? Math.max(...vals) : null;
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Timer (local display only — sync coming later) ──
function fmtTime(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
document.getElementById('timer-digits').textContent = fmtTime(TIMER_DURATION);

// ── Start polling ──
fetchAll();
setInterval(fetchAll, POLL_MS);
