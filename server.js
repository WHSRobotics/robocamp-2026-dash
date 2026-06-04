'use strict';
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

// ============================================================
// CONFIGURABLE VALUES — edit these to customize the competition
// ============================================================
const ADMIN_PASSWORD   = 'Marshmellow';
const COMPETITION_NAME = 'RoboCamp 2026';
const TIMER_DURATION   = 150; // seconds (2 minutes 30 seconds)

const INITIAL_TEAMS = [
  { id: 1, name: 'Robo Rangers',     number: '1001' },
  { id: 2, name: 'Circuit Breakers', number: '1002' },
  { id: 3, name: 'Tech Titans',      number: '1003' },
  { id: 4, name: 'Code Crushers',    number: '1004' },
  { id: 5, name: 'Bot Squad',        number: '1005' },
  { id: 6, name: 'Gear Grinders',    number: '1006' },
  { id: 7, name: 'Brick Builders',   number: '1007' },
  { id: 8, name: 'Logic League',     number: '1008' },
];
// ============================================================

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors:       { origin: '*' },
  transports: ['polling', 'websocket'],
});

// Build default 3-round schedule with varied team order per round
function buildSchedule(teams) {
  const schedule = [];
  let matchNum = 0;
  const roundOrders = [
    [0, 1, 2, 3, 4, 5, 6, 7],
    [2, 4, 6, 0, 3, 5, 7, 1],
    [5, 1, 7, 3, 0, 6, 2, 4],
  ];
  for (let r = 0; r < 3; r++) {
    for (const idx of roundOrders[r]) {
      if (idx >= teams.length) continue;
      const team = teams[idx];
      schedule.push({
        id:         ++matchNum,
        teamId:     team.id,
        teamName:   team.name,
        teamNumber: team.number,
        round:      r + 1,
      });
    }
  }
  return schedule;
}

// ── Server state (in-memory, persists while the process runs) ──
const state = {
  teams:        JSON.parse(JSON.stringify(INITIAL_TEAMS)),
  scores:       {},   // { [teamId]: { [round]: score } }
  schedule:     [],
  queueIndex:   0,
  currentMatch: { teamName: '', teamNumber: '', round: 1 },
  timer:        { remaining: TIMER_DURATION, running: false },
};

state.schedule = buildSchedule(state.teams);
if (state.schedule.length > 0) {
  const m = state.schedule[0];
  state.currentMatch = { teamName: m.teamName, teamNumber: m.teamNumber, round: m.round };
}

// ── Timer ──
let timerInterval = null;

function tick() {
  if (state.timer.remaining > 0) state.timer.remaining--;
  if (state.timer.remaining <= 0) {
    state.timer.remaining = 0;
    state.timer.running   = false;
    clearInterval(timerInterval);
    timerInterval = null;
  }
  io.emit('timerUpdate', { remaining: state.timer.remaining, running: state.timer.running });
}

function startTimer() {
  if (state.timer.running || state.timer.remaining <= 0) return;
  state.timer.running = true;
  timerInterval = setInterval(tick, 1000);
  io.emit('timerUpdate', { remaining: state.timer.remaining, running: state.timer.running });
}

function stopTimer() {
  if (!state.timer.running) return;
  state.timer.running = false;
  clearInterval(timerInterval);
  timerInterval = null;
  io.emit('timerUpdate', { remaining: state.timer.remaining, running: state.timer.running });
}

function resetTimer() {
  clearInterval(timerInterval);
  timerInterval          = null;
  state.timer.running   = false;
  state.timer.remaining = TIMER_DURATION;
  io.emit('timerUpdate', { remaining: state.timer.remaining, running: state.timer.running });
}

function getFullState() {
  return {
    competitionName: COMPETITION_NAME,
    teams:           state.teams,
    scores:          state.scores,
    schedule:        state.schedule,
    queueIndex:      state.queueIndex,
    currentMatch:    state.currentMatch,
    timer:           { remaining: state.timer.remaining, running: state.timer.running },
  };
}

// ── Express ──
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Socket.io ──
io.on('connection', (socket) => {
  console.log('+ client', socket.id);
  socket.emit('fullState', getFullState());

  socket.on('disconnect', () => console.log('- client', socket.id));

  const authed = (pw) => pw === ADMIN_PASSWORD;

  socket.on('adminAuth', ({ password }, cb) => {
    if (typeof cb === 'function') cb({ success: authed(password) });
  });

  socket.on('timerStart', ({ password }) => {
    if (!authed(password)) return;
    startTimer();
  });

  socket.on('timerStop', ({ password }) => {
    if (!authed(password)) return;
    stopTimer();
  });

  socket.on('timerReset', ({ password }) => {
    if (!authed(password)) return;
    resetTimer();
  });

  socket.on('advanceQueue', ({ password }) => {
    if (!authed(password)) return;
    if (state.queueIndex < state.schedule.length - 1) {
      state.queueIndex++;
      const m = state.schedule[state.queueIndex];
      state.currentMatch = { teamName: m.teamName, teamNumber: m.teamNumber, round: m.round };
    }
    io.emit('queueUpdate', { queueIndex: state.queueIndex, currentMatch: state.currentMatch });
  });

  socket.on('prevQueue', ({ password }) => {
    if (!authed(password)) return;
    if (state.queueIndex > 0) {
      state.queueIndex--;
      const m = state.schedule[state.queueIndex];
      state.currentMatch = { teamName: m.teamName, teamNumber: m.teamNumber, round: m.round };
    }
    io.emit('queueUpdate', { queueIndex: state.queueIndex, currentMatch: state.currentMatch });
  });

  socket.on('submitScore', ({ password, teamId, round, score }) => {
    if (!authed(password)) return;
    const tid = Number(teamId);
    const r   = Number(round);
    const s   = Number(score);
    if (!state.scores[tid]) state.scores[tid] = {};
    state.scores[tid][r] = s;
    io.emit('scoresUpdate', state.scores);
  });

  socket.on('deleteScore', ({ password, teamId, round }) => {
    if (!authed(password)) return;
    const tid = Number(teamId);
    const r   = Number(round);
    if (state.scores[tid]) delete state.scores[tid][r];
    io.emit('scoresUpdate', state.scores);
  });

  socket.on('setCurrentMatch', ({ password, teamName, teamNumber, round }) => {
    if (!authed(password)) return;
    state.currentMatch = {
      teamName:   String(teamName),
      teamNumber: String(teamNumber),
      round:      Number(round),
    };
    io.emit('currentMatchUpdate', state.currentMatch);
  });

  socket.on('updateTeams', ({ password, teams }) => {
    if (!authed(password)) return;
    state.teams = teams;
    state.schedule = state.schedule.map(match => {
      const t = teams.find(x => x.id === match.teamId);
      return t ? { ...match, teamName: t.name, teamNumber: t.number } : match;
    });
    io.emit('teamsUpdate', state.teams);
    io.emit('scheduleUpdate', state.schedule);
  });

  socket.on('updateSchedule', ({ password, schedule }) => {
    if (!authed(password)) return;
    state.schedule = schedule.map((m, i) => ({ ...m, id: i + 1 }));
    if (state.queueIndex >= state.schedule.length) {
      state.queueIndex = Math.max(0, state.schedule.length - 1);
    }
    io.emit('scheduleUpdate', state.schedule);
    io.emit('queueUpdate', { queueIndex: state.queueIndex, currentMatch: state.currentMatch });
  });
});

// ── Start ──
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\nRoboCamp 2026 server → http://localhost:${PORT}`);
  console.log(`Admin panel         → http://localhost:${PORT}/admin.html\n`);
});
