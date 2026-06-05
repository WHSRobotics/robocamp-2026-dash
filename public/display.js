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

// ── Fetch & render ──
async function fetchAll() {
  try {
    const [skRows, pubRows] = await Promise.all([
      fetchSheet('SCOREKEEPER'),
      fetchSheet('PUBLIC'),
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
        adjust: num(r[2]),  // column C — Adjusted Score
        total:  num(r[3]),  // column D — Total Score
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
    const queueIndex = Number(status['QueueIndex'] || 0);

    // PUBLIC rows 6+: schedule entries (numeric first field only — skip delay rows)
    const schedule = pubRows.slice(5)
      .filter(r => r[0] && !isNaN(Number(r[0])))
      .map(r => ({
        id:         Number(r[0]) || 0,
        teamName:   r[1] || '',
        teamNumber: r[2] || '',
        round:      Number(r[3]) || 1,
      }));

    renderCurrentMatch(currentMatch);
    renderQueue(schedule, queueIndex);
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
