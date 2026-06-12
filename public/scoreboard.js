'use strict';

const PUB_ID        = '2PACX-1vTcWLeyPjDMxTLCJmFTkoVd1cVD3xToMqejfjr8R4iu1IJ9KI-VXH-ToIFlKZCUW9mJrH7_w2FpP1uQ';
const SHEET_GIDS    = { SCOREKEEPER: 0, PUBLIC: 199719322, SCHEDULER: 33248599 };
const POLL_MS       = 5000;
const CAROUSEL_MS   = 4000; // ms per team in the carousel

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

// ── Queue helpers (mirrors schedule.js) ──
function parseTime(s) {
  if (!s) return null;
  const [h, m] = s.split(':').map(Number);
  return isNaN(h) || isNaN(m) ? null : h * 60 + m;
}

function schedSlots(schedTeams) {
  // Build in schedule order (M1 all teams → M6 all teams) so the sequence is
  // always chronological before midnight-wrap correction is applied.
  const slots = [];
  for (let r = 0; r < 6; r++) {
    schedTeams.forEach(t => {
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
    const [skRows, schedRows] = await Promise.all([
      fetchSheet('SCOREKEEPER'),
      fetchSheet('SCHEDULER'),
    ]);

    // SCOREKEEPER: scores for carousel
    const num = (v) => v !== '' && v != null ? Number(v) : null;
    const teams = skRows.slice(1).filter(r => r[1]).map(r => {
      const parts  = (r[1] || '').split('|').map(s => s.trim());
      const number = parts.length > 1 ? parts[0] : '';
      const name   = parts.length > 1 ? parts[1] : parts[0];
      return {
        name, number,
        rank:   num(r[0]),
        adjust: num(r[2]),
        total:  num(r[3]),
        scores: { 1: num(r[4]), 2: num(r[5]), 3: num(r[6]), 4: num(r[7]), 5: num(r[8]), 6: num(r[9]) },
      };
    });

    const sorted = [...teams].sort((a, b) => {
      if (a.rank === null && b.rank === null) return 0;
      if (a.rank === null) return 1;
      if (b.rank === null) return -1;
      return a.rank - b.rank;
    });

    // SCHEDULER: time-based queue
    const schedTeams = schedRows.slice(1)
      .filter(r => r[0] && r[0].includes('|'))
      .map(r => {
        const parts = r[0].split('|').map(s => s.trim());
        return { number: parts[0], name: parts[1] || parts[0], times: [r[1], r[2], r[3], r[4], r[5], r[6]] };
      });

    const { current, next } = currentAndNext(schedSlots(schedTeams));

    renderMatchInfo(current, next);
    updateCarousel(sorted);
    setConn('live');
  } catch (err) {
    console.error('[scoreboard]', err.message);
    setConn('error');
  }
}

// ── Match info ──
function renderMatchInfo(current, next) {
  document.getElementById('cur-name').textContent   = current ? current.teamName : '—';
  document.getElementById('cur-detail').textContent = current ? `#${current.teamNumber} · Match ${current.round}` : '';
  document.getElementById('next-name').textContent   = next ? next.teamName : '—';
  document.getElementById('next-detail').textContent = next ? `#${next.teamNumber} · Match ${next.round}` : '';
}

// ── Vertical carousel ──
let carouselData   = [];
let carouselIdx    = 0;
let carouselTimer  = null;
let carouselBuilt  = false;

function buildCarousel(teams) {
  carouselData = teams;
  const wrap = document.getElementById('carousel-wrap');

  wrap.innerHTML = teams.map((t, i) => {
    const rank    = t.rank ?? (i + 1);
    const rankCls = rank <= 3 ? `r${rank}` : '';

    const col = (label, val, cls = '') => {
      const empty   = val === null || val === undefined;
      const display = empty ? '—' : String(val);
      return `<div class="score-col ${cls}">
        <span class="col-label">${label}</span>
        <span class="col-val${empty ? ' col-empty' : ''}">${display}</span>
      </div>`;
    };

    const adjDisplay = t.adjust !== null
      ? (t.adjust >= 0 ? `+${t.adjust}` : `${t.adjust}`)
      : null;

    return `<div class="team-card state-${i === 0 ? 'active' : 'below'}" data-idx="${i}">
      <span class="card-rank ${rankCls}">#${rank}</span>
      <span class="card-name">${esc(t.number)} | ${esc(t.name)}</span>
      <div class="card-scores">
        ${col('Adj', adjDisplay, 'col-adj')}
        ${col('Total', t.total, 'col-total')}
        ${col('M1', t.scores[1])}
        ${col('M2', t.scores[2])}
        ${col('M3', t.scores[3])}
        ${col('M4', t.scores[4])}
        ${col('M5', t.scores[5])}
        ${col('M6', t.scores[6])}
      </div>
    </div>`;
  }).join('');
}

function updateCarousel(teams) {
  const sameCount = teams.length === carouselData.length;
  const sameNums  = sameCount && teams.every((t, i) => t.number === carouselData[i]?.number);

  if (!carouselBuilt || !sameNums) {
    // Rebuild cards (team list changed or first load)
    carouselIdx   = 0;
    carouselBuilt = true;
    buildCarousel(teams);
    if (!carouselTimer && teams.length > 1) {
      carouselTimer = setInterval(advanceCarousel, CAROUSEL_MS);
    }
  } else {
    // Update scores in-place without resetting position
    updateCarouselScores(teams);
    carouselData = teams;
  }
}

function updateCarouselScores(teams) {
  teams.forEach((t, i) => {
    const card = document.querySelector(`.team-card[data-idx="${i}"]`);
    if (!card) return;
    const cols = card.querySelectorAll('.col-val');
    const adjRaw = t.adjust !== null ? (t.adjust >= 0 ? `+${t.adjust}` : `${t.adjust}`) : null;
    const vals = [adjRaw, t.total,
      t.scores[1], t.scores[2], t.scores[3], t.scores[4], t.scores[5], t.scores[6]];
    cols.forEach((el, ci) => {
      const v = vals[ci];
      const empty = v === null || v === undefined;
      el.textContent = empty ? '—' : String(v);
      el.className   = `col-val${empty ? ' col-empty' : ''}`;
    });
  });
}

function advanceCarousel() {
  const cards = document.querySelectorAll('.team-card');
  if (cards.length < 2) return;

  const current = carouselIdx;
  const next    = (current + 1) % cards.length;

  cards[current].className = 'team-card state-above';
  cards[next].className    = 'team-card state-active';
  carouselIdx = next;

  // After transition, snap the "above" card back to "below" so it's ready to re-enter
  setTimeout(() => {
    cards[current].className = 'team-card state-below';
  }, 500);
}

// ── Utils ──
function setConn(state) {
  const dot = document.getElementById('conn-dot');
  dot.className = `conn-dot ${state}`;
}
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Boot ──
fetchAll();
setInterval(fetchAll, POLL_MS);
