'use strict';

const TIMER_DURATION = 150;

// ── Auth ──
let adminPassword = '';
let appState = {};

// ── Socket ──
const socket = io({ transports: ['polling', 'websocket'] });

socket.on('connect', () => setConnStatus('connected'));
socket.on('disconnect', () => setConnStatus('disconnected'));

socket.on('fullState', (data) => {
  appState = data;
  if (adminPassword) syncUI();
});

socket.on('timerUpdate', ({ remaining, running }) => {
  appState.timer = { remaining, running };
  renderAdminTimer();
  renderStatusBar();
});

socket.on('scoresUpdate', (scores) => {
  appState.scores = scores;
});

socket.on('queueUpdate', ({ queueIndex, currentMatch }) => {
  appState.queueIndex   = queueIndex;
  appState.currentMatch = currentMatch;
  renderQueue();
  renderStatusBar();
  renderScheduleEditor();
});

socket.on('currentMatchUpdate', (cm) => {
  appState.currentMatch = cm;
  renderStatusBar();
  populateMatchForm();
});

socket.on('scheduleUpdate', (schedule) => {
  appState.schedule = schedule;
  renderScheduleEditor();
  renderStatusBar();
});

socket.on('teamsUpdate', (teams) => {
  appState.teams = teams;
  renderTeamsTable();
  populateTeamDropdown();
});

// ── Gate ──
document.getElementById('gate-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const pw = document.getElementById('gate-pw').value.trim();
  socket.emit('adminAuth', { password: pw }, ({ success }) => {
    if (success) {
      adminPassword = pw;
      document.getElementById('gate-overlay').classList.add('hidden');
      document.getElementById('admin-shell').classList.remove('hidden');
      syncUI();
    } else {
      const err = document.getElementById('gate-error');
      err.classList.remove('hidden');
      err.style.animation = 'none';
      requestAnimationFrame(() => { err.style.animation = ''; });
      document.getElementById('gate-pw').value = '';
    }
  });
});

document.getElementById('btn-logout').addEventListener('click', () => {
  adminPassword = '';
  document.getElementById('gate-overlay').classList.remove('hidden');
  document.getElementById('admin-shell').classList.add('hidden');
  document.getElementById('gate-pw').value = '';
  document.getElementById('gate-error').classList.add('hidden');
});

// ── Timer controls ──
document.getElementById('btn-start').addEventListener('click', () => {
  socket.emit('timerStart', { password: adminPassword });
});
document.getElementById('btn-stop').addEventListener('click', () => {
  socket.emit('timerStop', { password: adminPassword });
});
document.getElementById('btn-reset').addEventListener('click', () => {
  socket.emit('timerReset', { password: adminPassword });
});

// ── Queue navigation ──
document.getElementById('btn-next-match').addEventListener('click', () => {
  socket.emit('advanceQueue', { password: adminPassword });
});
document.getElementById('btn-prev-match').addEventListener('click', () => {
  socket.emit('prevQueue', { password: adminPassword });
});

// ── Score form ──
document.getElementById('score-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const teamId = document.getElementById('score-team').value;
  const round  = document.getElementById('score-round').value;
  const score  = document.getElementById('score-value').value;
  if (score === '') return showFeedback('score-feedback', 'Enter a score value.', 'error');
  socket.emit('submitScore', {
    password: adminPassword,
    teamId:   Number(teamId),
    round:    Number(round),
    score:    Number(score),
  });
  showFeedback('score-feedback', `Score ${score} saved for Round ${round}.`, 'success');
  document.getElementById('score-value').value = '';
});

document.getElementById('btn-delete-score').addEventListener('click', () => {
  const teamId = document.getElementById('score-team').value;
  const round  = document.getElementById('score-round').value;
  socket.emit('deleteScore', {
    password: adminPassword,
    teamId:   Number(teamId),
    round:    Number(round),
  });
  showFeedback('score-feedback', `Round ${round} score deleted.`, 'success');
});

// ── Match override form ──
document.getElementById('match-form').addEventListener('submit', (e) => {
  e.preventDefault();
  socket.emit('setCurrentMatch', {
    password:   adminPassword,
    teamName:   document.getElementById('match-team-name').value.trim(),
    teamNumber: document.getElementById('match-team-num').value.trim(),
    round:      Number(document.getElementById('match-round').value),
  });
});

// ── Team editor ──
document.getElementById('btn-save-teams').addEventListener('click', () => {
  const rows  = document.querySelectorAll('#teams-body tr');
  const teams = [];
  rows.forEach(row => {
    const id     = Number(row.dataset.id);
    const name   = row.querySelector('.team-name-input').value.trim();
    const number = row.querySelector('.team-num-input').value.trim();
    if (name) teams.push({ id, name, number });
  });
  socket.emit('updateTeams', { password: adminPassword, teams });
});

// ── Schedule editor ──
document.getElementById('btn-save-schedule').addEventListener('click', () => {
  const schedule = collectSchedule();
  socket.emit('updateSchedule', { password: adminPassword, schedule });
});

document.getElementById('btn-add-match').addEventListener('click', () => {
  const teamId = Number(document.getElementById('add-team-select').value);
  const round  = Number(document.getElementById('add-round-select').value);
  const team   = appState.teams.find(t => t.id === teamId);
  if (!team) return;
  const newMatch = {
    id:         (appState.schedule.length + 1),
    teamId:     team.id,
    teamName:   team.name,
    teamNumber: team.number,
    round,
  };
  appState.schedule = [...appState.schedule, newMatch];
  renderScheduleEditor();
});

// ── Render functions ──
function syncUI() {
  renderAdminTimer();
  renderQueue();
  renderStatusBar();
  renderTeamsTable();
  renderScheduleEditor();
  populateTeamDropdown();
  populateMatchForm();
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderAdminTimer() {
  const { remaining, running } = appState.timer || { remaining: TIMER_DURATION, running: false };
  const el = document.getElementById('admin-timer');
  el.textContent = fmtTime(remaining);
  if (remaining === 0 && !running) {
    el.style.color = '#ff4757';
  } else if (running) {
    el.style.color = '#00ff9d';
  } else {
    el.style.color = '';
  }
  document.getElementById('sb-timer').textContent = fmtTime(remaining);
}

function renderQueue() {
  const { schedule = [], queueIndex = 0, currentMatch = {} } = appState;
  const now   = schedule[queueIndex];
  const next1 = schedule[queueIndex + 1];
  const next2 = schedule[queueIndex + 2];

  const fmt = (m) => m ? `${m.teamName} #${m.teamNumber} · Rd ${m.round}` : '—';

  document.getElementById('qp-now-val').textContent   = fmt(now   || currentMatch.teamName ? currentMatch : null);
  document.getElementById('qp-next1-val').textContent = fmt(next1);
  document.getElementById('qp-next2-val').textContent = fmt(next2);
}

function renderStatusBar() {
  const { currentMatch = {}, queueIndex = 0, schedule = [], timer = {} } = appState;
  document.getElementById('sb-current').textContent =
    currentMatch.teamName ? `${currentMatch.teamName} · Rd ${currentMatch.round}` : '—';
  document.getElementById('sb-queue').textContent   = `${queueIndex + 1} / ${schedule.length}`;
  document.getElementById('sb-timer').textContent   = fmtTime(timer.remaining ?? TIMER_DURATION);
}

function renderTeamsTable() {
  const tbody = document.getElementById('teams-body');
  tbody.innerHTML = (appState.teams || []).map(t => `
    <tr data-id="${t.id}">
      <td>${t.id}</td>
      <td><input class="team-name-input" value="${esc(t.name)}" placeholder="Team name"></td>
      <td><input class="team-num-input" value="${esc(t.number)}" placeholder="1001"></td>
    </tr>`).join('');
}

function populateTeamDropdown() {
  const sel = document.getElementById('score-team');
  const addSel = document.getElementById('add-team-select');
  const opts = (appState.teams || []).map(t =>
    `<option value="${t.id}">${esc(t.name)} (#${esc(t.number)})</option>`
  ).join('');
  sel.innerHTML = opts;
  addSel.innerHTML = opts;
}

function populateMatchForm() {
  const { currentMatch = {} } = appState;
  document.getElementById('match-team-name').value = currentMatch.teamName || '';
  document.getElementById('match-team-num').value  = currentMatch.teamNumber || '';
  document.getElementById('match-round').value     = currentMatch.round || 1;
}

function renderScheduleEditor() {
  const list = document.getElementById('schedule-editor-list');
  const { schedule = [], queueIndex = 0 } = appState;

  list.innerHTML = schedule.map((m, i) => {
    const isActive = i === queueIndex;
    return `<li class="se-item${isActive ? ' se-active' : ''}" data-idx="${i}">
      <span class="se-num">${i + 1}</span>
      <span class="se-info">
        <span class="se-team">${esc(m.teamName)} <span style="color:var(--text-dim);">#${esc(m.teamNumber)}</span></span>
        <span class="se-round"> · Round ${m.round}</span>
      </span>
      <span class="se-actions">
        <button class="se-btn up-btn" data-idx="${i}" title="Move up">↑</button>
        <button class="se-btn dn-btn" data-idx="${i}" title="Move down">↓</button>
        <button class="se-btn del del-btn" data-idx="${i}" title="Remove">✕</button>
      </span>
    </li>`;
  }).join('') || '<li class="se-item" style="color:var(--text-dim);justify-content:center;padding:20px;">No matches in schedule</li>';

  list.querySelectorAll('.up-btn').forEach(btn => {
    btn.addEventListener('click', () => moveScheduleItem(Number(btn.dataset.idx), -1));
  });
  list.querySelectorAll('.dn-btn').forEach(btn => {
    btn.addEventListener('click', () => moveScheduleItem(Number(btn.dataset.idx), 1));
  });
  list.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', () => removeScheduleItem(Number(btn.dataset.idx)));
  });
}

function moveScheduleItem(idx, dir) {
  const s   = [...appState.schedule];
  const to  = idx + dir;
  if (to < 0 || to >= s.length) return;
  [s[idx], s[to]] = [s[to], s[idx]];
  appState.schedule = s;
  renderScheduleEditor();
}

function removeScheduleItem(idx) {
  appState.schedule = appState.schedule.filter((_, i) => i !== idx);
  renderScheduleEditor();
}

function collectSchedule() {
  return appState.schedule.map((m, i) => ({ ...m, id: i + 1 }));
}

function showFeedback(id, msg, type) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className   = `form-feedback ${type}`;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 3000);
}

function setConnStatus(state) {
  const el = document.getElementById('conn-status');
  if (!el) return;
  el.dataset.state = state;
  el.querySelector('.conn-label').textContent =
    state === 'connected' ? 'Live' : 'Reconnecting…';
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
