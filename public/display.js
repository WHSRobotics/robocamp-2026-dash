'use strict';

// ── CONFIGURE THIS ─────────────────────────────────────────────────────────
const SHEET_ID = '1gbXlbTxFC-Dh7S_pzb-v1ylSgRvgz3O6C8ti4upyVhw';
// ───────────────────────────────────────────────────────────────────────────

const POLL_MS = 4000;

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

// ── Time helpers (mirrors schedule.js) ──
function parseTime(s) {
  if (!s) return null;
  const [h, m] = s.split(':').map(Number);
  return isNaN(h) || isNaN(m) ? null : h * 60 + m;
}

function buildSlots(schedTeams) {
  const slots = [];
  for (let r = 0; r < 6; r++) {
    schedTeams.forEach(t => {
      const timeMin = parseTime(t.times[r]);
      if (timeMin !== null)
        slots.push({ teamName: t.name, teamNumber: t.number, round: r + 1, timeMin, timeStr: t.times[r] });
    });
  }
  // Midnight-wrap correction: if times jump back >30 min, add 24 h to remainder
  let offset = 0;
  for (let i = 1; i < slots.length; i++) {
    if (slots[i].timeMin + offset < slots[i - 1].timeMin - 30) offset += 1440;
    slots[i].timeMin += offset;
  }
  return slots;
}

function findQueueIdx(slots) {
  if (!slots.length) return 0;
  const now = new Date();
  let nowMin = now.getHours() * 60 + now.getMinutes();
  if (slots[slots.length - 1].timeMin > 1440 && nowMin < 720) nowMin += 1440;
  let idx = 0;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].timeMin <= nowMin) idx = i; else break;
  }
  return idx;
}

// ── Fetch & render ──
async function fetchAll() {
  try {
    const [skRows, pubRows, schedRows] = await Promise.all([
      fetchSheet('SCOREKEEPER'),
      fetchSheet('PUBLIC'),
      fetchSheet('SCHEDULER'),
    ]);

    // SCOREKEEPER: row 0 = header, rows 1+ = teams
    // Cols: Rank(A) | "N | Team Name"(B) | Adjusted Score(C) | Total Score(D) | M1-M6(E-J)
    const num = (v) => v !== '' && v != null ? Number(v) : null;
    const teams = skRows.slice(1).filter(r => r[1]).map(r => {
      const parts  = (r[1] || '').split('|').map(s => s.trim());
      const number = parts.length > 1 ? parts[0] : '';
      const name   = parts.length > 1 ? parts[1] : parts[0];
      return {
        rank:   Number(r[0]) || 0,
        name,
        number,
        adjust: num(r[2]),
        total:  num(r[3]),
        scores: { 1: num(r[4]), 2: num(r[5]), 3: num(r[6]), 4: num(r[7]), 5: num(r[8]), 6: num(r[9]) },
      };
    });

    // PUBLIC rows 1-4: key-value status pairs
    const status = Object.fromEntries(pubRows.slice(0, 4).map(r => [r[0], r[1] ?? '']));
    const currentMatch = {
      teamName:   status['CurrentTeamName']   || '—',
      teamNumber: status['CurrentTeamNumber'] || '—',
      round:      status['CurrentRound']      || '—',
    };

    // SCHEDULER: row 1 = header, rows 2+ = "N | Team Name" in col A, times in cols B-G
    const schedTeams = schedRows.slice(1)
      .filter(r => r[0] && r[0].includes('|'))
      .map(r => {
        const parts = r[0].split('|').map(s => s.trim());
        return { number: parts[0], name: parts[1] || parts[0], times: [r[1], r[2], r[3], r[4], r[5], r[6]] };
      });

    const slots = buildSlots(schedTeams);
    const queueIdx = findQueueIdx(slots);

    renderCurrentMatch(currentMatch);
    renderQueue(slots, queueIdx);
    renderScoreboard(teams);
  } catch (err) {
    console.error('[display]', err.message);
  }
}

// ── Render ──
function renderCurrentMatch({ teamName, teamNumber, round }) {
  document.getElementById('cur-team-name').textContent = teamName;
  document.getElementById('cur-team-num').textContent  = teamNumber;
  document.getElementById('cur-round').textContent     = round;
}

function renderQueue(slots, queueIdx) {
  const list   = document.getElementById('queue-list');
  const labels = [
    { label: 'NOW',  cls: 'now',  idx: queueIdx },
    { label: 'NEXT', cls: 'next', idx: queueIdx + 1 },
    { label: 'THEN', cls: 'then', idx: queueIdx + 2 },
  ];

  const items = labels
    .filter(s => s.idx >= 0 && s.idx < slots.length)
    .map(({ label, cls, idx }) => {
      const m = slots[idx];
      return `<li class="queue-item${cls === 'now' ? ' queue-now' : ''}">
        <span class="queue-badge ${cls}">${label}</span>
        <span class="queue-text">
          <strong>${esc(m.teamName)}</strong>
          <small> · #${esc(m.teamNumber)} · Rd ${m.round} · ${esc(m.timeStr)}</small>
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

  // Use sheet rank (column A); fall back to adjust-score sort
  const rows = [...teams].sort((a, b) => {
    if (a.rank && b.rank) return a.rank - b.rank;
    if (a.adjust === null && b.adjust === null) return 0;
    if (a.adjust === null) return 1;
    if (b.adjust === null) return -1;
    return b.adjust - a.adjust;
  });

  const s = (v) => v !== null ? v : '—';

  tbody.innerHTML = rows.map(({ name, number, rank, adjust, total, scores }) => {
    const rankCls = rank <= 3 ? `rank-${rank}` : '';
    return `<tr class="${rankCls}">
      <td><span class="rank-badge">${rank || '—'}</span></td>
      <td class="col-team-name"><span class="sb-team-num">${esc(number)}</span> | <strong>${esc(name)}</strong></td>
      <td class="col-adj">${s(adjust)}</td>
      <td class="col-total">${s(total)}</td>
      <td class="col-r">${s(scores[1])}</td>
      <td class="col-r">${s(scores[2])}</td>
      <td class="col-r">${s(scores[3])}</td>
      <td class="col-r">${s(scores[4])}</td>
      <td class="col-r">${s(scores[5])}</td>
      <td class="col-r">${s(scores[6])}</td>
    </tr>`;
  }).join('');
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Start polling ──
fetchAll();
setInterval(fetchAll, POLL_MS);
