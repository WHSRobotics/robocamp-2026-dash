'use strict';

const TIMER_DURATION = 150; // seconds (2:30)

// ── State ──
let remaining = TIMER_DURATION;
let running   = false;
let interval  = null;

// ── Auth ──
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
      unlock();
    } else {
      showGateError();
    }
  } catch {
    // If the API isn't available (e.g. local static server), fall back
    // to a client-side check so the page still works for demos
    if (pw === 'Marshmellow') {
      unlock();
    } else {
      showGateError();
    }
  }
});

function unlock() {
  document.getElementById('gate-overlay').classList.add('hidden');
  document.getElementById('tp-header').classList.remove('hidden');
  document.getElementById('tp-stage').classList.remove('hidden');
  renderTimer();
}

function showGateError() {
  const err = document.getElementById('gate-error');
  err.classList.remove('hidden');
  err.style.animation = 'none';
  requestAnimationFrame(() => { err.style.animation = ''; });
  document.getElementById('gate-pw').value = '';
}

document.getElementById('btn-lock').addEventListener('click', () => {
  stopTimer();
  document.getElementById('gate-overlay').classList.remove('hidden');
  document.getElementById('tp-header').classList.add('hidden');
  document.getElementById('tp-stage').classList.add('hidden');
  document.getElementById('gate-pw').value = '';
  document.getElementById('gate-error').classList.add('hidden');
});

// ── Timer controls ──
document.getElementById('btn-start').addEventListener('click', startTimer);
document.getElementById('btn-stop').addEventListener('click', stopTimer);
document.getElementById('btn-reset').addEventListener('click', resetTimer);

function startTimer() {
  if (running || remaining <= 0) return;
  running  = true;
  interval = setInterval(tick, 1000);
  renderTimer();
}

function stopTimer() {
  if (!running) return;
  running = false;
  clearInterval(interval);
  interval = null;
  renderTimer();
}

function resetTimer() {
  stopTimer();
  remaining = TIMER_DURATION;
  renderTimer();
}

function tick() {
  if (remaining > 0) remaining--;
  if (remaining <= 0) {
    remaining = 0;
    running   = false;
    clearInterval(interval);
    interval = null;
  }
  renderTimer();
}

// ── Render ──
function fmtTime(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function renderTimer() {
  const digits = document.getElementById('tp-digits');
  const badge  = document.getElementById('tp-badge');
  const bar    = document.getElementById('tp-bar');
  const page   = document.getElementById('timer-page');

  digits.textContent = fmtTime(remaining);

  const pct = (remaining / TIMER_DURATION) * 100;
  bar.style.width = pct + '%';

  bar.classList.remove('warning', 'critical');
  if (pct <= 15)      bar.classList.add('critical');
  else if (pct <= 40) bar.classList.add('warning');

  digits.classList.remove('running', 'times-up');
  page.classList.remove('times-up');

  if (remaining === 0) {
    badge.dataset.state  = 'timesup';
    badge.textContent    = "TIME'S UP!";
    digits.classList.add('times-up');
    page.classList.add('times-up');
  } else if (running) {
    badge.dataset.state = 'running';
    badge.textContent   = 'RUNNING';
    digits.classList.add('running');
  } else if (remaining === TIMER_DURATION) {
    badge.dataset.state = 'ready';
    badge.textContent   = 'READY';
  } else {
    badge.dataset.state = 'paused';
    badge.textContent   = 'PAUSED';
  }
}

// Initial render
renderTimer();
