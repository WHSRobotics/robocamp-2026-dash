'use strict';

// ── CONFIGURE THIS ─────────────────────────────────────────────────────────
const SHEET_ID = 'YOUR_GOOGLE_SHEET_ID_HERE';
// ───────────────────────────────────────────────────────────────────────────

const POLL_MS        = 5000;
const TIMER_DURATION = 150;

// ── Auth ──
let adminPassword = '';
let appState = { teams: [], schedule: [], queueIndex: 0, currentMatch: {} };

// ── API helper ──
async function apiFetch(action, data = {}) {
  const res = await fetch('/api/update', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ password: adminPassword, action, ...data }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

// ── CSV helpers (same as display.js) ──
function csvUrl(name) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
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

async function fetchAll() {
  try {
    const [teamsRows, schedRows, statusRows] = await Promise.all([
      fetchSheet('Teams'),
      fetchSheet('Schedule'),
      fetchSheet('Status'),
    ]);

    appState.teams = teamsRows.slice(1).map(r => ({
      id:     r[0],
      name:   r[1] || '',
      number: r[2] || '',
      scores: {
        1: r[3] !== '' && r[3] != null ? Number(r[3]) : null,
        2: r[4] !== '' && r[4] != null ? Number(r[4]) : null,
        3: r[5] !== '' && r[5] != null ? Number(r[5]) : null,
      },
    }));

    appState.schedule = schedRows.slice(1).map(r => ({
      id:         Number(r[0]) || 0,
      teamName:   r[1] || '',
      teamNumber: r[2] || '',
      round:      Number(r[3]) || 1,
    }));

    const status       = Object.fromEntries(statusRows.map(r => [r[0], r[1] ?? '']));
    appState.currentMatch = {
      teamName:   status['CurrentTeamName']   || '',
      teamNumber: status['CurrentTeamNumber'] || '',
      round:      Number(status['CurrentRound'] || 1),
    };
    appState.queueIndex = Number(status['QueueIndex'] || 0);

    syncUI();
    setConnStatus('connected');
  } catch (err) {
    console.error('[admin]', err.message);
    setConnStatus('disconnected');
  }
}

// ── Gate ──
document.getElementById('gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = document.getElementById('gate-pw').value.trim();
  try {
    const res = await fetch('/api/update', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ password: pw, action: 'ping' }),
    });
    if (res.ok) {
      adminPassword = pw;
      document.getElementById('gate-overlay').classList.add('hidden');
      document.getElementById('admin-shell').classList.remove('hidden');
      await fetchAll();
      startPolling();
    } else {
      showGateError();
    }
  } catch {
    showGateError();
  }
});

function showGateError() {
  const err = document.getElementById('gate-error');
  err.classList.remove('hidden');
  err.style.animation = 'none';
  requestAnimationFrame(() => { err.style.animation = ''; });
  document.getElementById('gate-pw').value = '';
}

document.getElementById('btn-logout').addEventListener('click', () => {
  adminPassword = '';
  stopPolling();
  document.getElementById('gate-overlay').classList.remove('hidden');
  document.getElementById('admin-shell').classList.add('hidden');
  document.getElementById('gate-pw').value = '';
  document.getElementById('gate-error').classList.add('hidden');
});

// ── Polling ──
let pollTimer = null;
function startPolling() { pollTimer = setInterval(fetchAll, POLL_MS); }
function stopPolling()  { clearInterval(pollTimer); }

// ── Timer (local only — sync coming later) ──
let timerRunning  = false;
let timerRemaining = TIMER_DURATION;
let timerInterval  = null;

function fmtTime(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function renderAdminTimer() {
  const el = document.getElementById('admin-timer');
  el.textContent = fmtTime(timerRemaining);
  el.style.color = timerRemaining === 0 ? '#c0392b' : timerRunning ? '#1a7a3c' : '';
  document.getElementById('sb-timer').textContent = fmtTime(timerRemaining);
}

document.getElementById('btn-start').addEventListener('click', () => {
  if (timerRunning || timerRemaining <= 0) return;
  timerRunning = true;
  timerInterval = setInterval(() => {
    timerRemaining--;
    if (timerRemaining <= 0) {
      timerRemaining = 0;
      timerRunning = false;
      clearInterval(timerInterval);
    }
    renderAdminTimer();
  }, 1000);
  renderAdminTimer();
});

document.getElementById('btn-stop').addEventListener('click', () => {
  if (!timerRunning) return;
  timerRunning = false;
  clearInterval(timerInterval);
  renderAdminTimer();
});

document.getElementById('btn-reset').addEventListener('click', () => {
  timerRunning = false;
  clearInterval(timerInterval);
  timerRemaining = TIMER_DURATION;
  renderAdminTimer();
});

// ── Queue controls ──
document.getElementById('btn-next-match').addEventListener('click', async () => {
  try {
    await apiFetch('advanceQueue');
    await fetchAll();
  } catch (err) { alert('Error: ' + err.message); }
});

document.getElementById('btn-prev-match').addEventListener('click', async () => {
  try {
    await apiFetch('prevQueue');
    await fetchAll();
  } catch (err) { alert('Error: ' + err.message); }
});

// ── Score form ──
document.getElementById('score-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const teamId = document.getElementById('score-team').value;
  const round  = document.getElementById('score-round').value;
  const score  = document.getElementById('score-value').value;
  if (score === '') return showFeedback('score-feedback', 'Enter a score value.', 'error');
  try {
    await apiFetch('setScore', { teamId, round: Number(round), score: Number(score) });
    showFeedback('score-feedback', `Score ${score} saved for Round ${round}.`, 'success');
    document.getElementById('score-value').value = '';
    setTimeout(fetchAll, 1500);
  } catch (err) {
    showFeedback('score-feedback', 'Save failed: ' + err.message, 'error');
  }
});

document.getElementById('btn-delete-score').addEventListener('click', async () => {
  const teamId = document.getElementById('score-team').value;
  const round  = document.getElementById('score-round').value;
  try {
    await apiFetch('setScore', { teamId, round: Number(round), score: '' });
    showFeedback('score-feedback', `Round ${round} score cleared.`, 'success');
    setTimeout(fetchAll, 1500);
  } catch (err) {
    showFeedback('score-feedback', 'Delete failed: ' + err.message, 'error');
  }
});

// ── Current match form ──
document.getElementById('match-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await apiFetch('setCurrentMatch', {
      teamName:   document.getElementById('match-team-name').value.trim(),
      teamNumber: document.getElementById('match-team-num').value.trim(),
      round:      Number(document.getElementById('match-round').value),
      queueIndex: appState.queueIndex,
    });
    setTimeout(fetchAll, 1500);
  } catch (err) { alert('Error: ' + err.message); }
});

// ── Teams editor ──
document.getElementById('btn-save-teams').addEventListener('click', async () => {
  const rows  = document.querySelectorAll('#teams-body tr');
  const teams = [];
  rows.forEach(row => {
    const id     = row.dataset.id;
    const name   = row.querySelector('.team-name-input').value.trim();
    const number = row.querySelector('.team-num-input').value.trim();
    if (name) teams.push({ id, name, number });
  });
  try {
    await apiFetch('updateTeams', { teams });
    showFeedback('teams-feedback', 'Teams saved.', 'success');
    setTimeout(fetchAll, 1500);
  } catch (err) {
    showFeedback('teams-feedback', 'Save failed: ' + err.message, 'error');
  }
});

// ── Schedule editor ──
document.getElementById('btn-save-schedule').addEventListener('click', async () => {
  const schedule = appState.schedule.map((m, i) => ({ ...m, id: i + 1 }));
  try {
    await apiFetch('updateSchedule', { schedule });
    showFeedback('sched-feedback', 'Schedule saved.', 'success');
    setTimeout(fetchAll, 1500);
  } catch (err) {
    showFeedback('sched-feedback', 'Save failed: ' + err.message, 'error');
  }
});

document.getElementById('btn-add-match').addEventListener('click', () => {
  const teamId = document.getElementById('add-team-select').value;
  const round  = Number(document.getElementById('add-round-select').value);
  const team   = appState.teams.find(t => String(t.id) === String(teamId));
  if (!team) return;
  appState.schedule = [...appState.schedule, {
    id:         appState.schedule.length + 1,
    teamId:     team.id,
    teamName:   team.name,
    teamNumber: team.number,
    round,
  }];
  renderScheduleEditor();
});

// ── UI sync ──
function syncUI() {
  renderStatusBar();
  renderQueue();
  renderTeamsTable();
  renderScheduleEditor();
  populateTeamDropdown();
  populateMatchForm();
  renderAdminTimer();
}

function renderStatusBar() {
  const { currentMatch = {}, queueIndex = 0, schedule = [] } = appState;
  document.getElementById('sb-current').textContent =
    currentMatch.teamName ? `${currentMatch.teamName} · Rd ${currentMatch.round}` : '—';
  document.getElementById('sb-queue').textContent = `${queueIndex + 1} / ${schedule.length}`;
}

function renderQueue() {
  const { schedule = [], queueIndex = 0, currentMatch = {} } = appState;
  const fmt = (m) => m ? `${m.teamName} #${m.teamNumber} · Rd ${m.round}` : '—';
  document.getElementById('qp-now-val').textContent   =
    schedule[queueIndex] ? fmt(schedule[queueIndex]) : fmt(currentMatch.teamName ? currentMatch : null);
  document.getElementById('qp-next1-val').textContent = fmt(schedule[queueIndex + 1]);
  document.getElementById('qp-next2-val').textContent = fmt(schedule[queueIndex + 2]);
}

function renderTeamsTable() {
  document.getElementById('teams-body').innerHTML = appState.teams.map(t => `
    <tr data-id="${t.id}">
      <td>${t.id}</td>
      <td><input class="team-name-input" value="${esc(t.name)}" placeholder="Team name"></td>
      <td><input class="team-num-input"  value="${esc(t.number)}" placeholder="1001"></td>
    </tr>`).join('');
}

function populateTeamDropdown() {
  const opts = appState.teams.map(t =>
    `<option value="${t.id}">${esc(t.name)} (#${esc(t.number)})</option>`).join('');
  document.getElementById('score-team').innerHTML = opts;
  document.getElementById('add-team-select').innerHTML = opts;
}

function populateMatchForm() {
  const m = appState.currentMatch || {};
  document.getElementById('match-team-name').value = m.teamName  || '';
  document.getElementById('match-team-num').value  = m.teamNumber || '';
  document.getElementById('match-round').value     = m.round     || 1;
}

function renderScheduleEditor() {
  const { schedule = [], queueIndex = 0 } = appState;
  const list = document.getElementById('schedule-editor-list');

  list.innerHTML = schedule.map((m, i) => `
    <li class="se-item${i === queueIndex ? ' se-active' : ''}" data-idx="${i}">
      <span class="se-num">${i + 1}</span>
      <span class="se-info">
        <span class="se-team">${esc(m.teamName)} <span style="color:var(--text-dim);">#${esc(m.teamNumber)}</span></span>
        <span class="se-round"> · Round ${m.round}</span>
      </span>
      <span class="se-actions">
        <button class="se-btn up-btn" data-idx="${i}">↑</button>
        <button class="se-btn dn-btn" data-idx="${i}">↓</button>
        <button class="se-btn del del-btn" data-idx="${i}">✕</button>
      </span>
    </li>`).join('') ||
    '<li class="se-item" style="color:var(--text-dim);justify-content:center;padding:20px;">No matches</li>';

  list.querySelectorAll('.up-btn').forEach(b =>
    b.addEventListener('click', () => moveScheduleItem(Number(b.dataset.idx), -1)));
  list.querySelectorAll('.dn-btn').forEach(b =>
    b.addEventListener('click', () => moveScheduleItem(Number(b.dataset.idx),  1)));
  list.querySelectorAll('.del-btn').forEach(b =>
    b.addEventListener('click', () => {
      appState.schedule = appState.schedule.filter((_, i) => i !== Number(b.dataset.idx));
      renderScheduleEditor();
    }));
}

function moveScheduleItem(idx, dir) {
  const s = [...appState.schedule];
  const to = idx + dir;
  if (to < 0 || to >= s.length) return;
  [s[idx], s[to]] = [s[to], s[idx]];
  appState.schedule = s;
  renderScheduleEditor();
}

function setConnStatus(state) {
  const el = document.getElementById('conn-status');
  if (!el) return;
  el.dataset.state = state === 'connected' ? 'connected' : 'disconnected';
  el.querySelector('.conn-label').textContent =
    state === 'connected' ? 'Live' : 'Sheet error';
}

function showFeedback(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className   = `form-feedback ${type}`;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 3500);
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
