'use strict';

const TIMER_DURATION = 150;

// ── State ──
let state = {
  teams:        [],
  scores:       {},
  schedule:     [],
  queueIndex:   0,
  currentMatch: { teamName: '', teamNumber: '', round: 1 },
  timer:        { remaining: TIMER_DURATION, running: false },
};

// ── Socket ──
const socket = io({ transports: ['polling', 'websocket'] });

socket.on('connect', () => setConnStatus('connected'));
socket.on('disconnect', () => setConnStatus('disconnected'));

socket.on('fullState', (data) => {
  Object.assign(state, data);
  renderAll();
});

socket.on('timerUpdate', ({ remaining, running }) => {
  state.timer = { remaining, running };
  renderTimer();
});

socket.on('scoresUpdate', (scores) => {
  state.scores = scores;
  renderScoreboard();
});

socket.on('queueUpdate', ({ queueIndex, currentMatch }) => {
  state.queueIndex   = queueIndex;
  state.currentMatch = currentMatch;
  renderCurrentMatch();
  renderQueue();
  renderSchedule();
});

socket.on('currentMatchUpdate', (currentMatch) => {
  state.currentMatch = currentMatch;
  renderCurrentMatch();
});

socket.on('scheduleUpdate', (schedule) => {
  state.schedule = schedule;
  renderQueue();
  renderSchedule();
});

socket.on('teamsUpdate', (teams) => {
  state.teams = teams;
  renderScoreboard();
});

// ── Render functions ──
function renderAll() {
  renderTimer();
  renderCurrentMatch();
  renderQueue();
  renderScoreboard();
  renderSchedule();
  if (state.competitionName) {
    document.getElementById('competition-name').textContent = state.competitionName;
    document.title = state.competitionName;
  }
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderTimer() {
  const { remaining, running } = state.timer;
  const digits = document.getElementById('timer-digits');
  const badge  = document.getElementById('timer-badge');
  const bar    = document.getElementById('timer-bar');

  digits.textContent = fmtTime(remaining);

  const pct = (remaining / TIMER_DURATION) * 100;
  bar.style.width = pct + '%';

  // Bar color
  bar.classList.remove('warning', 'critical');
  if (pct <= 15) bar.classList.add('critical');
  else if (pct <= 40) bar.classList.add('warning');

  // Badge + digits state
  digits.classList.remove('times-up');
  if (remaining === 0 && !running) {
    badge.dataset.state  = 'timesup';
    badge.textContent    = "TIME'S UP!";
    digits.classList.add('times-up');
  } else if (running) {
    badge.dataset.state = 'running';
    badge.textContent   = 'RUNNING';
  } else if (remaining === TIMER_DURATION) {
    badge.dataset.state = 'ready';
    badge.textContent   = 'READY';
  } else {
    badge.dataset.state = 'stopped';
    badge.textContent   = 'PAUSED';
  }
}

function renderCurrentMatch() {
  const { teamName, teamNumber, round } = state.currentMatch;
  document.getElementById('cur-team-name').textContent = teamName || '—';
  document.getElementById('cur-team-num').textContent  = teamNumber || '—';
  document.getElementById('cur-round').textContent     = round || '—';
}

function renderQueue() {
  const list = document.getElementById('queue-list');
  const { schedule, queueIndex } = state;

  const slots = [
    { label: 'NOW',  cls: 'now',  idx: queueIndex },
    { label: 'NEXT', cls: 'next', idx: queueIndex + 1 },
    { label: 'THEN', cls: 'then', idx: queueIndex + 2 },
  ];

  list.innerHTML = '';

  let anyShown = false;
  for (const { label, cls, idx } of slots) {
    if (idx >= schedule.length) continue;
    const m  = schedule[idx];
    const li = document.createElement('li');
    li.className = 'queue-item' + (cls === 'now' ? ' queue-now' : '');
    li.innerHTML = `
      <span class="queue-badge ${cls}">${label}</span>
      <span class="queue-text">
        <strong>${esc(m.teamName)}</strong>
        <small> · #${esc(m.teamNumber)} · Rd ${m.round}</small>
      </span>`;
    list.appendChild(li);
    anyShown = true;
  }

  if (!anyShown) {
    list.innerHTML = '<li class="queue-item queue-empty">No upcoming matches</li>';
  }
}

function bestScore(teamId) {
  const rounds = state.scores[teamId];
  if (!rounds) return null;
  const vals = Object.values(rounds).map(Number);
  return vals.length ? Math.max(...vals) : null;
}

function renderScoreboard() {
  const tbody = document.getElementById('scoreboard-body');
  if (!state.teams.length) return;

  const rows = state.teams.map(team => {
    const rounds = state.scores[team.id] || {};
    const best   = bestScore(team.id);
    return { team, rounds, best };
  });

  rows.sort((a, b) => {
    if (a.best === null && b.best === null) return 0;
    if (a.best === null) return 1;
    if (b.best === null) return -1;
    return b.best - a.best;
  });

  tbody.innerHTML = rows.map(({ team, rounds, best }, i) => {
    const rank     = i + 1;
    const rankCls  = rank <= 3 ? `rank-${rank}` : '';
    const r1       = rounds[1] !== undefined ? `<span class="score-pill">${rounds[1]}</span>` : '<span class="score-pill empty">—</span>';
    const r2       = rounds[2] !== undefined ? `<span class="score-pill">${rounds[2]}</span>` : '<span class="score-pill empty">—</span>';
    const r3       = rounds[3] !== undefined ? `<span class="score-pill">${rounds[3]}</span>` : '<span class="score-pill empty">—</span>';
    const bestHtml = best !== null
      ? `<span class="best-score">${best}</span>`
      : '<span class="best-score no-score">—</span>';

    return `<tr class="${rankCls}">
      <td><span class="rank-badge">${rank}</span></td>
      <td><strong>${esc(team.name)}</strong></td>
      <td class="col-num">${esc(team.number)}</td>
      <td class="col-r">${r1}</td>
      <td class="col-r">${r2}</td>
      <td class="col-r">${r3}</td>
      <td class="col-best">${bestHtml}</td>
    </tr>`;
  }).join('');
}

function renderSchedule() {
  const tbody = document.getElementById('schedule-body');
  const { schedule, queueIndex } = state;

  if (!schedule.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">No schedule yet</td></tr>';
    return;
  }

  tbody.innerHTML = schedule.map((m, i) => {
    const isActive = i === queueIndex;
    const isDone   = i < queueIndex;
    const cls      = isActive ? 'match-active' : isDone ? 'match-done' : '';
    const rdCls    = `r${m.round}`;
    return `<tr class="${cls}">
      <td class="col-match">${m.id}</td>
      <td>${esc(m.teamName)}</td>
      <td class="col-num">${esc(m.teamNumber)}</td>
      <td><span class="round-chip ${rdCls}">R${m.round}</span></td>
    </tr>`;
  }).join('');
}

function setConnStatus(state) {
  const el = document.getElementById('conn-status');
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
