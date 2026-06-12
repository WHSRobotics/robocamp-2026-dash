'use strict';

const PUB_ID     = '2PACX-1vTcWLeyPjDMxTLCJmFTkoVd1cVD3xToMqejfjr8R4iu1IJ9KI-VXH-ToIFlKZCUW9mJrH7_w2FpP1uQ';
const SHEET_GIDS = { SCOREKEEPER: 0, PUBLIC: 199719322, SCHEDULER: 33248599 };
const POLL_MS    = 5000;
const NUM_ROUNDS = 6;

// ── CSV helpers ──
function csvUrl(name) {
  return `https://docs.google.com/spreadsheets/d/e/${PUB_ID}/pub?output=csv&gid=${SHEET_GIDS[name]}`;
}
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i+1] === '"') { cell += '"'; i++; }
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
  if (!r.ok) throw new Error(`Sheet "${name}" failed`);
  return parseCsv(await r.text());
}

// Parse "H:MM" or "HH:MM" → total minutes (for break window math)
function parseTime(s) {
  if (!s) return null;
  const [h, m] = s.split(':').map(Number);
  return isNaN(h) || isNaN(m) ? null : h * 60 + m;
}
// ── Queue helpers ──
function parseTime(s) {
  if (!s) return null;
  const [h, m] = s.split(':').map(Number);
  return isNaN(h) || isNaN(m) ? null : h * 60 + m;
}

function schedSlots(teams) {
  // Build in schedule order (M1 all teams → M6 all teams) so the sequence is
  // always chronological before midnight-wrap correction is applied.
  const slots = [];
  for (let r = 0; r < 6; r++) {
    teams.forEach(t => {
      const timeMin = parseTime(t.times[r]);
      if (timeMin !== null)
        slots.push({ teamName: t.name, teamNumber: t.number, round: r + 1, timeMin });
    });
  }
  // When a Delay Add pushes times past midnight, the sheet displays them as
  // e.g. "0:10" instead of "24:10". Detect the backward jump (>30 min) and
  // add 24h to that slot and everything after it.
  let offset = 0;
  for (let i = 1; i < slots.length; i++) {
    if (slots[i].timeMin + offset < slots[i - 1].timeMin - 30) offset += 1440;
    slots[i].timeMin += offset;
  }
  return slots;
}

function currentAndNext(slots) {
  if (!slots.length) return { current: null, next: null };
  const now = new Date();
  let nowMin = now.getHours() * 60 + now.getMinutes();
  // If the schedule crossed midnight (corrected times > 1440) and we're in
  // early AM, shift nowMin into the same reference frame.
  if (slots[slots.length - 1].timeMin > 1440 && nowMin < 720) nowMin += 1440;
  let curIdx = -1;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].timeMin <= nowMin) curIdx = i; else break;
  }
  if (curIdx === -1)               return { current: null, next: slots[0] };  // before event
  if (curIdx === slots.length - 1) return { current: null, next: null };       // after last match
  return { current: slots[curIdx], next: slots[curIdx + 1] };
}

// ── Fetch & render ──
async function fetchAll() {
  try {
    const schedRows = await fetchSheet('SCHEDULER');

    // SCHEDULER: row 1 = header, rows 2+ = teams (col A = "N | Team Name"),
    // plus a "Delay Add" label row followed by the numeric delay value on A13.
    // Team rows always contain "|"; non-team rows (header, label, value) do not.
    const teams = schedRows.slice(1)
      .filter(r => r[0] && r[0].includes('|'))
      .map(r => {
        const parts  = r[0].split('|').map(s => s.trim());
        const number = parts[0];
        const name   = parts[1] || parts[0];
        return { number, name, times: [r[1], r[2], r[3], r[4], r[5], r[6]] };
      });

    // Extract global delay: row after the "Delay Add" label row, col A
    const delayLabelIdx = schedRows.findIndex(
      r => r[0] && r[0].toLowerCase().startsWith('delay')
    );
    const globalDelay = delayLabelIdx >= 0 && schedRows[delayLabelIdx + 1]
      ? Number(schedRows[delayLabelIdx + 1][0]) || 0
      : 0;

    // Derive On Field / Next from SCHEDULER times vs. current clock
    const { current, next } = currentAndNext(schedSlots(teams));

    // Status bar
    document.getElementById('cur-name').textContent = current ? current.teamName : '—';
    document.getElementById('cur-meta').textContent = current ? `Team #${current.teamNumber} · Round ${current.round}` : '';
    if (next) {
      document.getElementById('queue-name').textContent = next.teamName;
      document.getElementById('queue-meta').textContent = `Team #${next.teamNumber} · Round ${next.round}`;
    } else {
      document.getElementById('queue-name').textContent = '—';
      document.getElementById('queue-meta').textContent = '';
    }

    renderDelay(globalDelay);
    renderSchedule(teams);
    setConnStatus('connected');
  } catch (err) {
    console.error('[schedule]', err.message);
    setConnStatus('error');
  }
}

function renderDelay(minutes) {
  const el = document.getElementById('delay-status');
  if (!el) return;
  if (!minutes) {
    el.textContent = '✓ On time';
    el.dataset.state = 'ontime';
  } else if (minutes > 0) {
    el.textContent = `▲ ${minutes} min behind schedule`;
    el.dataset.state = 'behind';
  } else {
    el.textContent = `▼ ${Math.abs(minutes)} min ahead of schedule`;
    el.dataset.state = 'ahead';
  }
}

function renderSchedule(teams) {
  const tbody = document.getElementById('sched-body');
  if (!teams.length) { tbody.innerHTML = ''; return; }

  tbody.innerHTML = teams.map(team => {
    const cells = team.times.map(t => `<td class="time-cell">${esc(t || '—')}</td>`).join('');
    return `<tr>
      <td class="col-team">
        <span class="team-name">${esc(team.name)}</span>
        <span class="team-num">(#${esc(team.number)})</span>
      </td>
      ${cells}
    </tr>`;
  }).join('');
}

function setConnStatus(state) {
  const el = document.getElementById('conn-status');
  if (!el) return;
  el.dataset.state = state === 'connected' ? 'connected' : 'disconnected';
  el.querySelector('.conn-label').textContent =
    state === 'connected' ? 'Live' : 'Sheet error — retrying…';
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

fetchAll();
setInterval(fetchAll, POLL_MS);
