const socket = io();

let CONFIG = null;
let myId = null;
let latestState = null;
let myPos = { x: 400, y: 300 };
const keys = {};
let holdingTask = null; // taskId currently being held
let holdProgress = 0;
const HOLD_DURATION_MS = 1400;
let lastFrameTime = performance.now();

const screens = {
  menu: document.getElementById('screen-menu'),
  lobby: document.getElementById('screen-lobby'),
  game: document.getElementById('screen-game'),
  meeting: document.getElementById('screen-meeting'),
  end: document.getElementById('screen-end'),
};

function showScreen(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle('active', key === name);
  }
}

fetch('/config').then((r) => r.json()).then((cfg) => { CONFIG = cfg; });

// ---------- Menu ----------
const nameInput = document.getElementById('name-input');
const menuError = document.getElementById('menu-error');

document.getElementById('create-btn').addEventListener('click', () => {
  const name = nameInput.value.trim() || 'Player';
  socket.emit('create-room', name, (res) => {
    if (!res.ok) return (menuError.textContent = res.error || 'Could not create room.');
    menuError.textContent = '';
  });
});

document.getElementById('join-btn').addEventListener('click', () => {
  const name = nameInput.value.trim() || 'Player';
  const roomCode = document.getElementById('join-code-input').value.trim().toUpperCase();
  if (!roomCode) return (menuError.textContent = 'Enter a room code.');
  socket.emit('join-room', { roomCode, name }, (res) => {
    if (!res.ok) return (menuError.textContent = res.error || 'Could not join room.');
    menuError.textContent = '';
  });
});

// ---------- Lobby ----------
document.getElementById('start-btn').addEventListener('click', () => socket.emit('start-game'));
document.getElementById('again-btn').addEventListener('click', () => socket.emit('play-again'));
document.getElementById('vote-skip-btn').addEventListener('click', () => castVote('skip'));

function renderLobby(state) {
  document.getElementById('lobby-code').textContent = state.code;
  const list = document.getElementById('lobby-players');
  list.innerHTML = '';
  const me = state.players.find((p) => p.id === myId);
  for (const p of state.players) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="name-row"><span class="dot" style="background:${p.color};color:${p.color}"></span>${p.name}${p.isHost ? '<span class="host-tag">HOST</span>' : ''}</span>`;
    list.appendChild(li);
  }
  document.getElementById('start-btn').classList.toggle('hidden', !me || !me.isHost);
  document.getElementById('lobby-hint').classList.toggle('hidden', !!(me && me.isHost));
  if (me && me.isHost) {
    document.getElementById('start-btn').disabled = state.players.length < 2;
  }
}

// ---------- Game rendering ----------
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const hudTasks = document.getElementById('hud-tasks');
const hudRole = document.getElementById('hud-role');
const actionPrompt = document.getElementById('action-prompt');
const taskOverlay = document.getElementById('task-overlay');
const taskLabel = document.getElementById('task-label');
const taskBarFill = document.getElementById('task-bar-fill');
const flashEl = document.getElementById('flash');

function renderHud(state) {
  hudTasks.textContent = `${state.doneTasks}/${state.totalTasks}`;
  hudRole.textContent = state.youAreMole ? '\u{1F977} MOLE' : '\u{1F4BC} CREW';
  hudRole.className = 'hud-role ' + (state.youAreMole ? 'mole' : 'crew');
}

// ---------- Visual effects state ----------
const renderPositions = new Map(); // id -> {x,y} smoothed position for remote players
const walkPhase = new Map(); // id -> {phase, moving}
let particles = []; // {x,y,vx,vy,life,maxLife,color,size,shape}
let shake = { t: 0, mag: 0 };
let prevAliveById = new Map();
let prevMyDoneTaskIds = new Set();

function spawnBurst(x, y, color, count, opts = {}) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (opts.speed || 90) * (0.5 + Math.random());
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (opts.lift || 40),
      life: 0,
      maxLife: 0.6 + Math.random() * 0.5,
      color,
      size: opts.size || 3 + Math.random() * 3,
      shape: opts.shape || 'paper',
    });
  }
}

function triggerShake(mag) { shake.t = 0.35; shake.mag = mag; }
function triggerFlash() {
  flashEl.classList.add('active');
  setTimeout(() => flashEl.classList.remove('active'), 140);
}

function updateEffects(dt) {
  particles = particles.filter((p) => p.life < p.maxLife);
  for (const p of particles) {
    p.life += dt;
    p.vy += 160 * dt; // gravity
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  if (shake.t > 0) shake.t = Math.max(0, shake.t - dt);
}

function drawParticles() {
  for (const p of particles) {
    const alpha = Math.max(0, 1 - p.life / p.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.life * 6);
    ctx.fillStyle = p.color;
    if (p.shape === 'paper') {
      ctx.fillRect(-p.size, -p.size * 0.7, p.size * 2, p.size * 1.4);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---------- Themed task station icons ----------
function drawTaskIcon(id, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#cfd3dc';
  ctx.fillStyle = '#cfd3dc';
  ctx.lineWidth = 2.5;
  switch (id) {
    case 'coffee':
      ctx.beginPath(); ctx.moveTo(-10, -6); ctx.lineTo(-10, 10); ctx.quadraticCurveTo(-10, 16, -4, 16);
      ctx.lineTo(4, 16); ctx.quadraticCurveTo(10, 16, 10, 10); ctx.lineTo(10, -6); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.arc(12, 2, 5, -1.2, 1.2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-7, -10); ctx.quadraticCurveTo(-4, -16, -1, -10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(2, -10); ctx.quadraticCurveTo(5, -16, 8, -10); ctx.stroke();
      break;
    case 'server':
      for (let i = -1; i <= 1; i++) {
        ctx.strokeRect(-14, i * 11 - 5, 28, 9);
        ctx.beginPath(); ctx.arc(9, i * 11 - 0.5, 1.6, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case 'printer':
      ctx.strokeRect(-14, -4, 28, 14);
      ctx.strokeRect(-9, -14, 18, 10);
      ctx.beginPath(); ctx.moveTo(-10, 10); ctx.lineTo(-10, 18); ctx.lineTo(10, 18); ctx.lineTo(10, 10); ctx.stroke();
      break;
    case 'reports':
      for (let i = 0; i < 3; i++) {
        ctx.strokeRect(-12 + i * 2, -12 + i * 4, 20, 24);
      }
      break;
    case 'supplies':
      ctx.strokeRect(-13, -8, 26, 20);
      ctx.beginPath(); ctx.moveTo(-13, -8); ctx.lineTo(0, -16); ctx.lineTo(13, -8); ctx.stroke();
      break;
    case 'shred':
      ctx.strokeRect(-12, -14, 24, 10);
      ctx.beginPath(); ctx.moveTo(-10, -4); ctx.lineTo(-13, 14); ctx.lineTo(13, 14); ctx.lineTo(10, -4); ctx.closePath(); ctx.stroke();
      for (let i = -8; i <= 8; i += 4) { ctx.beginPath(); ctx.moveTo(i, -14); ctx.lineTo(i, -4); ctx.stroke(); }
      break;
    case 'mail':
      ctx.strokeRect(-14, -10, 28, 20);
      ctx.beginPath(); ctx.moveTo(-14, -10); ctx.lineTo(0, 4); ctx.lineTo(14, -10); ctx.stroke();
      break;
    default:
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function drawFloor() {
  const tile = 50;
  for (let y = 0; y < canvas.height; y += tile) {
    for (let x = 0; x < canvas.width; x += tile) {
      const even = ((x / tile) + (y / tile)) % 2 === 0;
      ctx.fillStyle = even ? '#17191f' : '#14161b';
      ctx.fillRect(x, y, tile, tile);
    }
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.02)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += tile) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
  for (let y = 0; y <= canvas.height; y += tile) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTaskStations(state) {
  if (!CONFIG) return;
  for (const spot of CONFIG.TASK_SPOTS) {
    const inRange = isTaskGlowing(state, spot);
    ctx.save();
    if (inRange) {
      ctx.shadowColor = 'rgba(224,185,85,0.6)';
      ctx.shadowBlur = 22;
    }
    const grad = ctx.createLinearGradient(spot.x, spot.y - 40, spot.x, spot.y + 40);
    grad.addColorStop(0, '#272b35');
    grad.addColorStop(1, '#1c1f27');
    ctx.fillStyle = grad;
    ctx.strokeStyle = inRange ? '#e0b955' : '#3a3d47';
    ctx.lineWidth = 2;
    roundRect(spot.x - 55, spot.y - 40, 110, 80, 12);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    drawTaskIcon(spot.id, spot.x, spot.y - 6);

    ctx.fillStyle = '#9aa0ad';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(spot.label, spot.x, spot.y + 32);
  }
}

function isTaskGlowing(state, spot) {
  if (!state || state.youAreMole) return false;
  const task = state.yourTasks.find((t) => t.id === spot.id && !t.done);
  if (!task) return false;
  const dist = Math.hypot(myPos.x - spot.x, myPos.y - spot.y);
  return dist <= CONFIG.TASK_RANGE;
}

// ---------- Avatar drawing ----------
function drawAvatar(x, y, color, { alive, name, isSelf, moving, phase, isMole, showMoleTag }) {
  ctx.save();
  ctx.translate(x, y);

  if (!alive) {
    // fallen figure: tipped-over torso + chair/briefcase silhouette
    ctx.globalAlpha = 0.55;
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = color;
    roundRect(-16, -11, 32, 22, 8);
    ctx.fill();
    ctx.fillStyle = '#0e0f13';
    ctx.beginPath(); ctx.arc(14, 0, 8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#b02020';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✕', 0, -20);
    ctx.restore();
    drawNameTag(x, y - 34, name + ' (down)', '#e07f7f');
    return;
  }

  const bob = moving ? Math.sin(phase) * 2 : 0;
  const legSwing = moving ? Math.sin(phase * 1.6) * 7 : 0;

  // shadow
  ctx.beginPath();
  ctx.ellipse(0, 20, 15, 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();

  ctx.translate(0, bob);

  // legs
  ctx.strokeStyle = '#2a2d35';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-5, 10); ctx.lineTo(-5 + legSwing * 0.3, 19); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(5, 10); ctx.lineTo(5 - legSwing * 0.3, 19); ctx.stroke();

  // torso
  const grad = ctx.createLinearGradient(-15, -16, -15, 14);
  grad.addColorStop(0, lighten(color, 18));
  grad.addColorStop(1, color);
  ctx.fillStyle = grad;
  roundRect(-15, -16, 30, 30, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1.5;
  roundRect(-15, -16, 30, 30, 12);
  ctx.stroke();

  // collar / tie
  ctx.fillStyle = '#f3f3f3';
  ctx.beginPath();
  ctx.moveTo(-6, -16); ctx.lineTo(0, -9); ctx.lineTo(6, -16);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = isMole && showMoleTag ? '#b02020' : '#3a3d47';
  ctx.beginPath();
  ctx.moveTo(-3, -10); ctx.lineTo(3, -10); ctx.lineTo(2, 8); ctx.lineTo(0, 12); ctx.lineTo(-2, 8);
  ctx.closePath(); ctx.fill();

  // head
  ctx.beginPath();
  ctx.fillStyle = '#f0c9a0';
  ctx.arc(0, -24, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // face
  ctx.fillStyle = '#2a2d35';
  ctx.beginPath(); ctx.arc(-3.5, -25, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(3.5, -25, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -21, 3, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.strokeStyle = '#2a2d35';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (isSelf) {
    ctx.beginPath();
    ctx.arc(0, -4, 26, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();
  drawNameTag(x, y - 42, name, color);
}

function drawNameTag(x, y, name, color) {
  ctx.save();
  ctx.font = '12px sans-serif';
  const w = ctx.measureText(name).width + 14;
  ctx.fillStyle = 'rgba(14,15,19,0.72)';
  roundRect(x - w / 2, y - 12, w, 17, 8);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  roundRect(x - w / 2, y - 12, w, 17, 8);
  ctx.stroke();
  ctx.fillStyle = '#eef0f4';
  ctx.textAlign = 'center';
  ctx.fillText(name, x, y);
  ctx.restore();
}

function lighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 0xff) + amt, b = (n & 0xff) + amt;
  r = Math.min(255, r); g = Math.min(255, g); b = Math.min(255, b);
  return `rgb(${r},${g},${b})`;
}

function drawBodies(state) {
  for (const body of state.bodies) {
    ctx.save();
    ctx.translate(body.x, body.y);
    ctx.fillStyle = '#4a3b2a';
    roundRect(-13, -6, 26, 14, 3);
    ctx.fill();
    ctx.fillStyle = '#6b5438';
    ctx.fillRect(-2, -9, 4, 6);
    ctx.fillStyle = '#eee';
    ctx.save(); ctx.rotate(0.3); ctx.fillRect(2, -10, 10, 7); ctx.restore();
    ctx.fillStyle = '#b02020';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✕', 0, -16);
    ctx.restore();
  }
}

function drawWorld(state) {
  ctx.save();
  if (shake.t > 0) {
    const m = shake.mag * (shake.t / 0.35);
    ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
  }

  drawFloor();
  if (CONFIG) drawTaskStations(state);
  if (!state) { ctx.restore(); return; }

  drawBodies(state);

  const order = [...state.players].sort((a, b) => (a.id === myId ? 1 : 0) - (b.id === myId ? 1 : 0));
  for (const p of order) {
    let pos;
    if (p.id === myId) {
      pos = myPos;
    } else {
      if (!renderPositions.has(p.id)) renderPositions.set(p.id, { x: p.x, y: p.y });
      pos = renderPositions.get(p.id);
    }
    const wp = walkPhase.get(p.id) || { phase: 0, moving: false };
    drawAvatar(pos.x, pos.y, p.color, {
      alive: p.alive,
      name: p.name,
      isSelf: p.id === myId,
      moving: wp.moving,
      phase: wp.phase,
      isMole: p.isMole,
      showMoleTag: p.id === myId && state.youAreMole,
    });
  }

  drawParticles();
  ctx.restore();
}

function nearestAssignedTask(state) {
  const me = state.players.find((p) => p.id === myId);
  if (!me || !me.alive || state.youAreMole) return null;
  for (const t of state.yourTasks) {
    if (t.done) continue;
    const spot = CONFIG.TASK_SPOTS.find((s) => s.id === t.id);
    const dist = Math.hypot(myPos.x - spot.x, myPos.y - spot.y);
    if (dist <= CONFIG.TASK_RANGE) return t;
  }
  return null;
}

function nearestKillTarget(state) {
  if (!state.youAreMole) return null;
  let best = null;
  let bestDist = Infinity;
  for (const p of state.players) {
    if (p.id === myId || !p.alive || p.isMole) continue;
    const dist = Math.hypot(myPos.x - p.x, myPos.y - p.y);
    if (dist <= CONFIG.KILL_RANGE && dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  }
  return best;
}

function nearestBody(state) {
  let best = null;
  let bestDist = Infinity;
  for (const b of state.bodies) {
    const dist = Math.hypot(myPos.x - b.x, myPos.y - b.y);
    if (dist <= CONFIG.REPORT_RANGE && dist < bestDist) {
      best = b;
      bestDist = dist;
    }
  }
  return best;
}

function updateActionPrompt(state) {
  const task = nearestAssignedTask(state);
  const killTarget = nearestKillTarget(state);
  const body = nearestBody(state);

  if (holdingTask) {
    actionPrompt.classList.add('hidden');
    taskOverlay.classList.remove('hidden');
    return;
  }
  taskOverlay.classList.add('hidden');

  if (body) {
    actionPrompt.textContent = `Press R to report ${body.victimName}'s body`;
    actionPrompt.classList.remove('hidden');
  } else if (killTarget) {
    const onCooldown = state.lastKillAt && Date.now() - state.lastKillAt < CONFIG.KILL_COOLDOWN_MS;
    actionPrompt.textContent = onCooldown ? 'Kill on cooldown' : `Press Q to eliminate ${killTarget.name}`;
    actionPrompt.classList.remove('hidden');
  } else if (task) {
    actionPrompt.textContent = `Press E to ${task.label}`;
    actionPrompt.classList.remove('hidden');
  } else {
    actionPrompt.classList.add('hidden');
  }
}

// ---------- Movement + input ----------
window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  if (!latestState || latestState.state !== 'playing') return;
  const me = latestState.players.find((p) => p.id === myId);
  if (!me || !me.alive) return;

  if (e.key.toLowerCase() === 'r') {
    const body = nearestBody(latestState);
    if (body) socket.emit('report-body', { bodyId: body.id });
  }
  if (e.key.toLowerCase() === 'q') {
    const target = nearestKillTarget(latestState);
    if (target) socket.emit('eliminate', { targetId: target.id });
  }
  if (e.key.toLowerCase() === 'e' && !holdingTask) {
    const task = nearestAssignedTask(latestState);
    if (task) {
      holdingTask = task;
      holdProgress = 0;
      taskLabel.textContent = task.label;
    }
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
  if (e.key.toLowerCase() === 'e' && holdingTask) {
    holdingTask = null;
    holdProgress = 0;
    taskBarFill.style.width = '0%';
  }
});

let lastMoveSent = 0;
function tickMovement(dt) {
  if (!latestState || latestState.state !== 'playing') return;
  const me = latestState.players.find((p) => p.id === myId);
  if (!me || !me.alive) return;
  if (holdingTask) return; // frozen while doing a task

  const speed = 220; // px/sec
  let dx = 0, dy = 0;
  if (keys['w'] || keys['arrowup']) dy -= 1;
  if (keys['s'] || keys['arrowdown']) dy += 1;
  if (keys['a'] || keys['arrowleft']) dx -= 1;
  if (keys['d'] || keys['arrowright']) dx += 1;

  const myWp = walkPhase.get(myId) || { phase: 0, moving: false };
  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    myPos.x = Math.max(20, Math.min(canvas.width - 20, myPos.x + (dx / len) * speed * dt));
    myPos.y = Math.max(20, Math.min(canvas.height - 20, myPos.y + (dy / len) * speed * dt));
    myWp.moving = true;
    myWp.phase += dt * 10;
  } else {
    myWp.moving = false;
  }
  walkPhase.set(myId, myWp);

  const now = performance.now();
  if (now - lastMoveSent > 50) {
    lastMoveSent = now;
    socket.emit('move', { x: myPos.x, y: myPos.y });
  }
}

function tickTaskHold(dt) {
  if (!holdingTask) return;
  if (!keys['e']) {
    holdingTask = null;
    holdProgress = 0;
    taskBarFill.style.width = '0%';
    return;
  }
  holdProgress += dt * 1000;
  taskBarFill.style.width = `${Math.min(100, (holdProgress / HOLD_DURATION_MS) * 100)}%`;
  if (holdProgress >= HOLD_DURATION_MS) {
    socket.emit('do-task', { taskId: holdingTask.id });
    holdingTask = null;
    holdProgress = 0;
    taskBarFill.style.width = '0%';
  }
}

function tickInterpolation(dt) {
  if (!latestState) return;
  const lerpFactor = 1 - Math.exp(-dt * 12);
  for (const p of latestState.players) {
    if (p.id === myId) continue;
    if (!renderPositions.has(p.id)) { renderPositions.set(p.id, { x: p.x, y: p.y }); continue; }
    const rp = renderPositions.get(p.id);
    const dist = Math.hypot(p.x - rp.x, p.y - rp.y);
    const wp = walkPhase.get(p.id) || { phase: 0, moving: false };
    wp.moving = dist > 1.5;
    if (wp.moving) wp.phase += dt * 10;
    walkPhase.set(p.id, wp);
    rp.x += (p.x - rp.x) * lerpFactor;
    rp.y += (p.y - rp.y) * lerpFactor;
  }
}

function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  tickMovement(dt);
  tickTaskHold(dt);
  tickInterpolation(dt);
  updateEffects(dt);
  if (latestState && latestState.state === 'playing') {
    drawWorld(latestState);
    updateActionPrompt(latestState);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

socket.on('player-moved', ({ id, x, y }) => {
  if (!latestState) return;
  const p = latestState.players.find((pl) => pl.id === id);
  if (p) { p.x = x; p.y = y; }
});

// ---------- Meeting ----------
let myVote = null;
function renderMeeting(state) {
  document.getElementById('meeting-message').textContent = state.resultMessage || 'A body was found. Discuss!';
  const list = document.getElementById('meeting-players');
  list.innerHTML = '';
  const me = state.players.find((p) => p.id === myId);
  for (const p of state.players) {
    const li = document.createElement('li');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'name-row';
    nameSpan.innerHTML = `<span class="dot" style="background:${p.color};color:${p.color}"></span>${p.name}${!p.alive ? '<span class="dead-tag">dead</span>' : ''}`;
    li.appendChild(nameSpan);
    if (p.alive && me && me.alive) {
      const btn = document.createElement('button');
      btn.className = 'vote-btn' + (myVote === p.id ? ' voted' : '');
      btn.textContent = p.id === myId ? 'Vote (self)' : 'Vote';
      btn.disabled = !!myVote;
      btn.addEventListener('click', () => castVote(p.id));
      li.appendChild(btn);
    }
    list.appendChild(li);
  }
  document.getElementById('vote-skip-btn').disabled = !!myVote || !(me && me.alive);
  const votes = state.votes;
  document.getElementById('meeting-timer').textContent = votes ? `${votes.cast}/${votes.aliveCount} voted` : '';
}

function castVote(targetId) {
  if (myVote) return;
  myVote = targetId;
  socket.emit('cast-vote', { targetId });
}

// ---------- End screen ----------
function renderEnd(state) {
  document.getElementById('end-title').textContent = state.resultMessage?.includes('Mole wins') ? 'Mole Wins' : 'Crew Wins';
  document.getElementById('end-message').textContent = state.resultMessage || '';
  const list = document.getElementById('end-roles');
  list.innerHTML = '';
  for (const p of state.players) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="name-row"><span class="dot" style="background:${p.color};color:${p.color}"></span>${p.name}</span><span>${p.isMole ? 'MOLE' : 'Crew'}</span>`;
    list.appendChild(li);
  }
  const me = state.players.find((p) => p.id === myId);
  document.getElementById('again-btn').classList.toggle('hidden', !me || !me.isHost);
}

// ---------- Main state handler ----------
socket.on('connect', () => { myId = socket.id; });

socket.on('state', (state) => {
  if (state.state === 'playing') {
    for (const p of state.players) {
      const wasAlive = prevAliveById.get(p.id);
      if (wasAlive === true && p.alive === false) {
        const pos = p.id === myId ? myPos : (renderPositions.get(p.id) || p);
        spawnBurst(pos.x, pos.y, '#cfcfcf', 16, { shape: 'paper', speed: 130, lift: 70 });
        triggerShake(10);
        triggerFlash();
      }
      prevAliveById.set(p.id, p.alive);
    }

    if (!state.youAreMole) {
      const doneNow = new Set(state.yourTasks.filter((t) => t.done).map((t) => t.id));
      for (const id of doneNow) {
        if (!prevMyDoneTaskIds.has(id)) {
          const spot = CONFIG && CONFIG.TASK_SPOTS.find((s) => s.id === id);
          if (spot) spawnBurst(spot.x, spot.y, '#e0b955', 14, { shape: 'confetti', speed: 100, lift: 90 });
        }
      }
      prevMyDoneTaskIds = doneNow;
    }
  } else if (state.state === 'lobby') {
    prevAliveById = new Map();
    prevMyDoneTaskIds = new Set();
    renderPositions.clear();
    particles = [];
  }

  latestState = state;
  if (state.state !== 'meeting') myVote = null;

  switch (state.state) {
    case 'lobby':
      showScreen('lobby');
      renderLobby(state);
      break;
    case 'playing':
      showScreen('game');
      renderHud(state);
      {
        const me = state.players.find((p) => p.id === myId);
        if (me) { myPos.x = me.x; myPos.y = me.y; }
      }
      break;
    case 'meeting':
      showScreen('meeting');
      renderMeeting(state);
      break;
    case 'ended':
      showScreen('end');
      renderEnd(state);
      break;
  }
});
