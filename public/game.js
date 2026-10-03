const socket = io();

let CONFIG = { KILL_RANGE: 80, TASK_RANGE: 70, USE_RANGE: 80, REPORT_RANGE: 100, VENT_RANGE: 60 };
fetch('/config').then((r) => r.json()).then((cfg) => { CONFIG = cfg; });

const SPOTS = Object.fromEntries(MAP.TASK_SPOTS.map((s) => [s.id, s]));
const TASK_OPTS = {
  'caf-garbage': { verb: 'PULL', hint: 'Hold the lever to empty the chute.' },
  'storage-fuel': { verb: 'FILL', hint: 'Hold to fill the gas can.' },
  comms: { verb: 'DOWNLOAD', hint: 'Start the download and wait for it.' },
  medbay: { verb: 'SCAN', hint: 'Step on the scanner and hold still.' },
  'nav-course': { count: 5 },
  o2: { hint: 'Pull every red leaf out of the filter.' },
  shields: { hint: 'Click every red panel to prime the shields.' },
};
const SABOTAGE_NAMES = { lights: 'Lights', reactor: 'Reactor Meltdown', o2: 'Oxygen Depleted', comms: 'Comms' };
const BASE_SPEED = 230;

let myId = null;
let S = null; // latest server snapshot
let clockOffset = 0;
const serverNow = () => Date.now() + clockOffset;
const myPos = { x: MAP.EMERGENCY.x, y: MAP.EMERGENCY.y + 80 };
let myFacing = 1;
const myWalk = { phase: 0, moving: false };
const remote = new Map(); // id -> smoothed { x, y, facing, phase, moving }
const keys = {};
let visionRadius = 360;
let mapMode = null; // 'map' | 'sabotage' | 'admin'
let camsOpen = false;
let splashUntil = 0;
let splashTimer = null;
let voteSelection = null;
let lastFrameTime = performance.now();

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const iconImg = (color) => `<img src="${crewIcon(color)}" alt="" />`;

const screens = { menu: $('screen-menu'), lobby: $('screen-lobby'), game: $('screen-game') };
function showScreen(name) {
  for (const key of Object.keys(screens)) screens[key].classList.toggle('active', key === name);
}

// ---------- Sound ----------
let audio = null;
function beep(freq, at, dur, type, vol) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type || 'square';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol || 0.06, audio.currentTime + at);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + at + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(audio.currentTime + at);
  osc.stop(audio.currentTime + at + dur);
}
function sfx(kind) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (kind === 'task') { beep(660, 0, 0.12); beep(880, 0.12, 0.2); }
    if (kind === 'kill') { beep(140, 0, 0.35, 'sawtooth', 0.12); beep(70, 0.1, 0.4, 'sawtooth', 0.12); }
    if (kind === 'meeting') { beep(520, 0, 0.18); beep(390, 0.2, 0.18); beep(520, 0.4, 0.18); beep(390, 0.6, 0.3); }
    if (kind === 'alarm') { beep(300, 0, 0.25, 'sawtooth', 0.08); beep(300, 0.4, 0.25, 'sawtooth', 0.08); }
    if (kind === 'vote') beep(740, 0, 0.1);
  } catch (err) { /* no audio available */ }
}

// ---------- Menu ----------
const nameInput = $('name-input');
const menuError = $('menu-error');

$('create-btn').addEventListener('click', () => {
  socket.emit('create-room', nameInput.value.trim() || 'Player', (res) => {
    menuError.textContent = res.ok ? '' : res.error || 'Could not create room.';
  });
});
function joinRoom() {
  const roomCode = $('join-code-input').value.trim().toUpperCase();
  if (!roomCode) return (menuError.textContent = 'Enter a room code.');
  socket.emit('join-room', { roomCode, name: nameInput.value.trim() || 'Player' }, (res) => {
    menuError.textContent = res.ok ? '' : res.error || 'Could not join room.';
  });
}
$('join-btn').addEventListener('click', joinRoom);
$('join-code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });

// ---------- Lobby ----------
const SETTING_DEFS = [
  ['impostors', 'Impostors', [1, 2, 3], ''],
  ['killCooldown', 'Kill cooldown', [10, 15, 20, 25, 30, 45], 's'],
  ['tasks', 'Tasks each', [2, 3, 4, 5, 6, 8], ''],
  ['speed', 'Player speed', [0.75, 1, 1.25, 1.5], 'x'],
  ['discussionTime', 'Discussion time', [0, 15, 30, 45], 's'],
  ['votingTime', 'Voting time', [30, 60, 90, 120], 's'],
];
const settingSelects = {};
for (const [key, label, values, unit] of SETTING_DEFS) {
  const select = document.createElement('select');
  for (const v of values) select.add(new Option(`${v}${unit}`, v));
  select.addEventListener('change', () => socket.emit('set-settings', { [key]: Number(select.value) }));
  settingSelects[key] = select;
  const name = document.createElement('span');
  name.textContent = label;
  $('settings').append(name, select);
}
COLORS.forEach((col, i) => {
  const sw = document.createElement('button');
  sw.className = 'swatch';
  sw.style.background = col.hex;
  sw.title = col.name;
  sw.addEventListener('click', () => socket.emit('set-color', { color: i }));
  $('color-picker').appendChild(sw);
});
$('start-btn').addEventListener('click', () => socket.emit('start-game'));
$('add-bot-btn').addEventListener('click', () => socket.emit('add-bot'));
$('again-btn').addEventListener('click', () => socket.emit('play-again'));

function renderLobby(st) {
  const me = st.players.find((p) => p.id === myId);
  const host = !!(me && me.isHost);
  $('lobby-code').textContent = st.code;
  $('lobby-count').textContent = `${st.players.length}/12`;
  const list = $('lobby-players');
  list.innerHTML = '';
  for (const p of st.players) {
    const li = document.createElement('li');
    li.innerHTML = `${iconImg(p.color)}<span>${esc(p.name)}</span>`
      + (p.isHost ? '<span class="host-tag">HOST</span>' : '')
      + (p.id === myId ? '<span class="you-tag">YOU</span>' : '')
      + (p.isBot ? '<span class="you-tag">AI</span>' : '');
    if (p.isBot && host) {
      const rm = document.createElement('button');
      rm.textContent = '×';
      rm.style.cssText = 'padding:0 10px;margin-left:auto;box-shadow:none';
      rm.addEventListener('click', () => socket.emit('remove-bot', { id: p.id }));
      li.appendChild(rm);
    }
    list.appendChild(li);
  }
  const taken = new Set(st.players.map((p) => p.color));
  [...$('color-picker').children].forEach((sw, i) => {
    sw.classList.toggle('mine', !!me && me.color === i);
    sw.classList.toggle('taken', taken.has(i) && !(me && me.color === i));
  });
  for (const [key] of SETTING_DEFS) {
    settingSelects[key].value = st.settings[key];
    settingSelects[key].disabled = !host;
  }
  $('start-btn').classList.toggle('hidden', !host);
  $('add-bot-btn').classList.toggle('hidden', !host || st.players.length >= 12);
  $('start-btn').disabled = st.players.length < 2;
  $('lobby-hint').textContent = host
    ? (st.players.length < 2 ? 'You need at least 2 players. Add AI players to fill the ship.' : 'Ready when you are.')
    : 'Waiting for the host to start…';
}

// ---------- Splash + toast ----------
const splash = $('splash');
function showSplash(cls, html, ms) {
  splash.className = cls;
  splash.innerHTML = html;
  clearTimeout(splashTimer);
  splashUntil = performance.now() + ms;
  splashTimer = setTimeout(() => splash.classList.add('hidden'), ms);
}
let toastTimer = null;
function toast(text) {
  $('toast').textContent = text;
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 1500);
}

// ---------- World helpers ----------
const canvas = $('game-canvas');
const ctx = canvas.getContext('2d');
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

function closedDoorRects() {
  if (!S) return [];
  const t = serverNow();
  return MAP.closedDoors(Object.keys(S.doors).filter((id) => S.doors[id].closedUntil > t));
}

function inputBlocked() {
  return !S || S.state !== 'playing' || !!activeGame || !!mapMode || camsOpen || performance.now() < splashUntil;
}

function activePanels() {
  if (!S || !S.sabotage) return [];
  return MAP.PANELS.filter((p) => p.sabotage === S.sabotage.type && !(S.sabotage.done && S.sabotage.done[p.id]));
}

function myTodoIds() {
  const ids = new Set();
  if (S && S.you && !S.you.isImpostor) for (const t of S.you.tasks) if (!t.done) ids.add(t.id);
  return ids;
}

const distTo = (spot) => Math.hypot(myPos.x - spot.x, myPos.y - spot.y);

function useTarget() {
  const you = S.you;
  const found = [];
  const add = (kind, spot, range, rank) => {
    const d = distTo(spot);
    if (d <= range - 8) found.push({ kind, spot, d: d + rank });
  };
  for (const id of myTodoIds()) add('task', SPOTS[id], CONFIG.TASK_RANGE, 0);
  if (you.alive) {
    for (const p of activePanels()) add('panel', p, CONFIG.USE_RANGE, -1000);
    add('emergency', MAP.EMERGENCY, CONFIG.USE_RANGE, 0);
    add('security', MAP.SECURITY_CONSOLE, CONFIG.USE_RANGE, 0);
    add('admin', MAP.ADMIN_TABLE, CONFIG.USE_RANGE, 0);
  }
  found.sort((a, b) => a.d - b.d);
  return found[0] || null;
}

function nearestBody(doors) {
  if (!S.you.alive || S.you.inVent) return null;
  let best = null;
  for (const b of S.bodies) {
    const d = distTo(b);
    if (d <= CONFIG.REPORT_RANGE - 8 && (!best || d < best.d) && MAP.lineOfSight(myPos.x, myPos.y, b.x, b.y, doors)) best = { body: b, d };
  }
  return best && best.body;
}

function killTarget(doors) {
  const you = S.you;
  if (!you.isImpostor || !you.alive || you.inVent) return null;
  let best = null;
  for (const p of S.players) {
    if (p.id === myId || !p.alive || p.isImpostor || p.inVent) continue;
    const d = distTo(p);
    if (d <= CONFIG.KILL_RANGE - 8 && (!best || d < best.d) && MAP.lineOfSight(myPos.x, myPos.y, p.x, p.y, doors)) best = { p, d };
  }
  return best && best.p;
}

function nearVent() {
  if (!S.you.isImpostor || !S.you.alive) return null;
  return MAP.VENTS.find((v) => distTo(v) <= CONFIG.VENT_RANGE - 8) || null;
}

function emergencyBlock() {
  if (S.you.meetingsLeft <= 0) return 'No emergency meetings left';
  if (S.sabotage) return 'No meetings during a sabotage';
  const wait = Math.ceil((S.emergencyReadyAt - serverNow()) / 1000);
  return wait > 0 ? `Button ready in ${wait}s` : '';
}

// ---------- Actions ----------
function doUse() {
  const target = useTarget();
  if (!target) return;
  const spot = target.spot;
  if (target.kind === 'task') {
    openMinigame(spot.game, `${spot.room}: ${spot.label}`, { kind: 'task', id: spot.id, ...TASK_OPTS[spot.id] }, () => {
      socket.emit('do-task', { taskId: spot.id });
      sfx('task');
      toast('Task Completed!');
    });
  } else if (target.kind === 'panel') {
    const send = (data) => socket.emit('fix-sabotage', { panelId: spot.id, ...data });
    const game = { lights: 'switches', o2: 'keypad', reactor: 'reactorHold', comms: 'slider' }[spot.sabotage];
    openMinigame(game, spot.label, {
      kind: 'panel', id: spot.id, panelId: spot.id, sabotage: S.sabotage, send,
      hint: 'Tune the dial to the green mark to restore comms.',
    }, () => send({}));
  } else if (target.kind === 'emergency') {
    const blocked = emergencyBlock();
    if (blocked) toast(blocked); else socket.emit('call-meeting');
  } else if (target.kind === 'security') {
    camsOpen = true;
    $('cams-modal').classList.remove('hidden');
  } else if (target.kind === 'admin') {
    openMap('admin');
  }
}

function doReport() {
  const body = nearestBody(closedDoorRects());
  if (body) socket.emit('report-body', { bodyId: body.id });
}

function doKill() {
  const target = killTarget(closedDoorRects());
  if (target && serverNow() >= S.you.killReadyAt) socket.emit('eliminate', { targetId: target.id });
}

function doVent() {
  if (S.you.inVent) return socket.emit('vent-exit');
  const vent = nearVent();
  if (vent) socket.emit('vent-enter', { ventId: vent.id });
}

// ---------- Map / sabotage / admin overlay ----------
const sabotageButtons = [];
function sabButton(label, x, y, cls, payload) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.className = cls;
  btn.style.left = `${(x / MAP.WORLD_W) * 100}%`;
  btn.style.top = `${(y / MAP.WORLD_H) * 100}%`;
  btn.addEventListener('click', () => {
    socket.emit('sabotage', payload);
    if (payload.type !== 'doors') closeMap();
  });
  $('sabotage-buttons').appendChild(btn);
  sabotageButtons.push({ btn, payload });
}
{
  const center = (id) => {
    const r = MAP.ROOMS.find((room) => room.id === id);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };
  for (const [type, roomId, label] of [['lights', 'electrical', 'LIGHTS'], ['reactor', 'reactor', 'REACTOR'], ['o2', 'o2', 'O2'], ['comms', 'communications', 'COMMS']]) {
    const c = center(roomId);
    sabButton(label, c.x, c.y - 45, '', { type });
  }
  for (const roomId of MAP.DOOR_ROOMS) {
    const c = center(roomId);
    sabButton('DOORS', c.x, c.y + 70, 'door', { type: 'doors', roomId });
  }
}

function openMap(mode) {
  if (activeGame || camsOpen) return;
  mapMode = mode;
  $('map-title').textContent = mode === 'sabotage' ? 'Sabotage' : mode === 'admin' ? 'Admin: who is where' : 'Map';
  $('sabotage-buttons').classList.toggle('hidden', mode !== 'sabotage');
  $('map-modal').classList.remove('hidden');
}
function closeMap() {
  mapMode = null;
  $('map-modal').classList.add('hidden');
}
function closeCams() {
  camsOpen = false;
  $('cams-modal').classList.add('hidden');
}
function closeOverlays() {
  closeMinigame();
  closeMap();
  closeCams();
}
$('map-close').addEventListener('click', closeMap);
$('cams-close').addEventListener('click', closeCams);
$('map-btn').addEventListener('click', () => (mapMode ? closeMap() : openMap('map')));
$('btn-use').addEventListener('click', () => { if (!inputBlocked()) doUse(); });
$('btn-report').addEventListener('click', () => { if (!inputBlocked()) doReport(); });
$('btn-kill').addEventListener('click', () => { if (!inputBlocked()) doKill(); });
$('btn-vent').addEventListener('click', () => { if (!inputBlocked()) doVent(); });
$('btn-sabotage').addEventListener('click', () => { if (S && S.state === 'playing') openMap('sabotage'); });

function drawMapOverlay() {
  const mapCtx = $('map-canvas').getContext('2d');
  const me = S.players.find((p) => p.id === myId);
  const opts = { me: me && { x: myPos.x, y: myPos.y, color: me.color } };
  const comms = S.sabotage && S.sabotage.type === 'comms';
  if (mapMode === 'admin') {
    opts.me = null;
    opts.counts = {};
    if (!comms) {
      for (const p of S.players) {
        if (!p.alive) continue;
        const pos = p.id === myId ? myPos : p;
        const room = MAP.roomAt(pos.x, pos.y);
        if (room) opts.counts[room.id] = (opts.counts[room.id] || 0) + 1;
      }
    }
  } else {
    if (mapMode === 'map' && !comms) opts.taskIds = myTodoIds();
    opts.panels = activePanels();
  }
  drawMiniMap(mapCtx, 912, 585, opts);
  if (mapMode === 'sabotage') {
    const t = serverNow();
    for (const { btn, payload } of sabotageButtons) {
      if (payload.type === 'doors') {
        const door = S.doors[payload.roomId];
        btn.disabled = !!door && door.readyAt > t;
      } else {
        btn.disabled = !!S.sabotage || S.sabotageReadyAt > t;
      }
    }
  }
}

// ---------- Input ----------
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (S && S.state !== 'lobby' && [' ', 'tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  if (e.repeat) return;
  keys[k] = true;
  if (!S || S.state !== 'playing') return;
  if (k === 'escape') return closeOverlays();
  if (k === 'm' || k === 'tab') return mapMode ? closeMap() : openMap('map');
  if (k === 'b' && S.you.isImpostor) return mapMode ? closeMap() : openMap('sabotage');
  if (inputBlocked()) return;
  if (k === 'e' || k === ' ') doUse();
  if (k === 'r') doReport();
  if (k === 'q') doKill();
  if (k === 'v') doVent();
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('blur', () => { for (const k of Object.keys(keys)) keys[k] = false; });

let lastMoveSent = 0;
function tickMovement(dt, doors) {
  myWalk.moving = false;
  if (inputBlocked() || S.you.inVent) return;
  let dx = 0;
  let dy = 0;
  if (keys.w || keys.arrowup) dy -= 1;
  if (keys.s || keys.arrowdown) dy += 1;
  if (keys.a || keys.arrowleft) dx -= 1;
  if (keys.d || keys.arrowright) dx += 1;
  if (!dx && !dy) return;
  const len = Math.hypot(dx, dy);
  const step = BASE_SPEED * S.settings.speed * dt;
  const nx = myPos.x + (dx / len) * step;
  const ny = myPos.y + (dy / len) * step;
  if (!S.you.alive) {
    myPos.x = Math.max(0, Math.min(MAP.WORLD_W, nx));
    myPos.y = Math.max(0, Math.min(MAP.WORLD_H, ny));
  } else {
    // If a door slammed on top of us, let us walk out of it.
    const stuck = MAP.hitsDoor(myPos.x, myPos.y, doors);
    const ok = (x, y) => MAP.isWalkable(x, y) && (stuck || !MAP.hitsDoor(x, y, doors));
    if (ok(nx, myPos.y)) myPos.x = nx;
    if (ok(myPos.x, ny)) myPos.y = ny;
  }
  if (dx) myFacing = dx;
  myWalk.moving = true;
  myWalk.phase += dt * 14;
  const now = performance.now();
  if (now - lastMoveSent > 50) {
    lastMoveSent = now;
    socket.emit('move', { x: myPos.x, y: myPos.y });
  }
}

function tickRemote(dt) {
  const k = 1 - Math.exp(-dt * 14);
  for (const p of S.players) {
    if (p.id === myId) continue;
    let r = remote.get(p.id);
    if (!r) { r = { x: p.x, y: p.y, facing: 1, phase: 0, moving: false }; remote.set(p.id, r); }
    const dx = p.x - r.x;
    const dy = p.y - r.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 220) { r.x = p.x; r.y = p.y; r.moving = false; continue; }
    r.moving = dist > 2;
    if (r.moving) r.phase += dt * 14;
    if (Math.abs(dx) > 1.5) r.facing = dx > 0 ? 1 : -1;
    r.x += dx * k;
    r.y += dy * k;
  }
}

socket.on('player-moved', ({ id, x, y }) => {
  if (!S) return;
  const p = S.players.find((pl) => pl.id === id);
  if (p) { p.x = x; p.y = y; }
});

// ---------- Drawing ----------
// includeGhosts: dead players are drawn (only ghosts see ghosts). selfLive: use local position for me.
function drawEntities(c, includeGhosts, selfLive) {
  for (const b of S.bodies) drawBody(c, b.x, b.y, b.color);
  const list = [];
  for (const p of S.players) {
    if (p.inVent || (!p.alive && !includeGhosts)) continue;
    const isMe = p.id === myId;
    const r = isMe ? null : remote.get(p.id);
    if (!isMe && !r) continue;
    list.push({
      p,
      x: isMe ? myPos.x : r.x,
      y: isMe ? myPos.y : r.y,
      facing: isMe ? myFacing : r.facing,
      moving: isMe ? (selfLive && myWalk.moving) : r.moving,
      phase: isMe ? myWalk.phase : r.phase,
    });
  }
  list.sort((a, b) => a.y - b.y);
  for (const e of list) {
    drawCrewmate(c, e.x, e.y, e.p.color, { facing: e.facing, moving: e.moving, phase: e.phase, ghost: !e.p.alive });
    drawName(c, e.x, e.y - 38, e.p.name, e.p.isImpostor && S.you.isImpostor ? '#ff3b30' : '#fff');
  }
}

function drawArrow(x, y, angle, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.strokeStyle = '#0a0a0a';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(20, 0); ctx.lineTo(-14, -15); ctx.lineTo(-6, 0); ctx.lineTo(-14, 15);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawArrows(camX, camY, zoom) {
  const W = canvas.width;
  const H = canvas.height;
  const targets = activePanels().map((p) => ({ spot: p, color: '#ff3b30' }));
  if (!(S.sabotage && S.sabotage.type === 'comms')) {
    for (const id of myTodoIds()) targets.push({ spot: SPOTS[id], color: '#f5d63c' });
  }
  for (const { spot, color } of targets) {
    const sx = (spot.x - camX) * zoom;
    const sy = (spot.y - camY) * zoom;
    if (sx > 30 && sx < W - 30 && sy > 30 && sy < H - 30) continue;
    const angle = Math.atan2(sy - H / 2, sx - W / 2);
    const t = Math.min((W / 2 - 46) / Math.abs(Math.cos(angle) || 1e-6), (H / 2 - 46) / Math.abs(Math.sin(angle) || 1e-6));
    drawArrow(W / 2 + Math.cos(angle) * t, H / 2 + Math.sin(angle) * t, angle, color);
  }
}

function drawWorld(dt, doors) {
  const W = canvas.width;
  const H = canvas.height;
  const zoom = Math.max(H / 640, W / 1300);
  const vw = W / zoom;
  const vh = H / zoom;
  const camX = myPos.x - vw / 2;
  const camY = myPos.y - vh / 2;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawStars(ctx, W, H, camX, camY);
  ctx.setTransform(zoom, 0, 0, zoom, -camX * zoom, -camY * zoom);
  drawShip(ctx, doors);
  drawStations(ctx, myTodoIds(), activePanels(), performance.now());

  if (!S.you.alive) {
    drawEntities(ctx, true, true);
  } else {
    const lightsOut = S.sabotage && S.sabotage.type === 'lights' && !S.you.isImpostor;
    const wanted = S.you.isImpostor ? 470 : lightsOut ? 110 : 360;
    visionRadius += (wanted - visionRadius) * Math.min(1, dt * 3);
    const poly = computeVisibility(myPos.x, myPos.y, visionRadius, doors);
    ctx.save();
    ctx.beginPath();
    tracePolygon(ctx, poly);
    ctx.clip();
    drawEntities(ctx, false, true);
    const fade = ctx.createRadialGradient(myPos.x, myPos.y, visionRadius * 0.55, myPos.x, myPos.y, visionRadius);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = fade;
    ctx.fillRect(camX, camY, vw, vh);
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.beginPath();
    ctx.rect(camX - 20, camY - 20, vw + 40, vh + 40);
    tracePolygon(ctx, poly);
    ctx.fill('evenodd');
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawArrows(camX, camY, zoom);
}

function drawCams() {
  const cv = $('cams-canvas');
  const c = cv.getContext('2d');
  const qw = cv.width / 2;
  const qh = cv.height / 2;
  const doors = closedDoorRects();
  const scale = 0.72;
  MAP.CAMERAS.forEach((cam, i) => {
    const ox = (i % 2) * qw;
    const oy = Math.floor(i / 2) * qh;
    c.save();
    c.beginPath();
    c.rect(ox, oy, qw, qh);
    c.clip();
    c.fillStyle = '#05070c';
    c.fillRect(ox, oy, qw, qh);
    c.translate(ox + qw / 2 - cam.x * scale, oy + qh / 2 - cam.y * scale);
    c.scale(scale, scale);
    drawShip(c, doors);
    drawStations(c, new Set(), [], 0);
    drawEntities(c, false, false);
    c.restore();
    c.fillStyle = 'rgba(40, 255, 120, 0.07)';
    c.fillRect(ox, oy, qw, qh);
    c.strokeStyle = '#0a0d14';
    c.lineWidth = 6;
    c.strokeRect(ox, oy, qw, qh);
    c.fillStyle = '#fff';
    c.font = "800 16px 'Baloo 2', sans-serif";
    c.fillText(`CAM ${i + 1}: ${cam.name}`, ox + 12, oy + 24);
  });
}

// ---------- HUD ----------
function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function renderTaskList(st) {
  const list = $('task-list');
  if (st.sabotage && st.sabotage.type === 'comms') {
    list.innerHTML = '<div class="fake">[ Comms Sabotaged ]</div>';
    return;
  }
  if (st.you.isImpostor) {
    list.innerHTML = '<div class="fake">Sabotage and kill everyone.</div><div class="title">Fake tasks:</div>'
      + MAP.TASK_SPOTS.slice(0, 4).map((s) => `<div>${s.room}: ${s.label}</div>`).join('');
    return;
  }
  list.innerHTML = (st.you.alive ? '' : '<div class="title">You are dead. Finish your tasks to help the crew.</div>')
    + st.you.tasks.map((t) => `<div class="${t.done ? 'done' : ''}">${SPOTS[t.id].room}: ${SPOTS[t.id].label}</div>`).join('');
}

function renderVentArrows(st) {
  const box = $('vent-arrows');
  const here = st.you.inVent && MAP.VENTS.find((v) => v.id === st.you.inVent);
  box.classList.toggle('hidden', !here || st.state !== 'playing');
  if (!here) return;
  box.innerHTML = '';
  for (const v of MAP.VENTS.filter((o) => o.group === here.group && o.id !== here.id)) {
    const btn = document.createElement('button');
    btn.textContent = `➤ ${MAP.placeName(v.x, v.y)}`;
    btn.addEventListener('click', () => socket.emit('vent-move', { ventId: v.id }));
    box.appendChild(btn);
  }
}

function updateHud(doors) {
  const you = S.you;
  const t = serverNow();
  $('taskbar-fill').style.width = `${S.totalTasks ? (S.doneTasks / S.totalTasks) * 100 : 0}%`;
  setText($('room-name'), you.inVent ? 'In the vents' : MAP.placeName(myPos.x, myPos.y));

  const sab = S.sabotage;
  const alert = $('alert');
  alert.classList.toggle('hidden', !sab);
  if (sab) {
    const left = sab.endsAt ? ` in ${Math.max(0, Math.ceil((sab.endsAt - t) / 1000))}s` : '';
    const where = { lights: 'Fix the lights in Electrical', reactor: `Reactor meltdown${left}`, o2: `Oxygen depleted${left}`, comms: 'Comms sabotaged: fix in Communications' }[sab.type];
    setText(alert, `⚠ ${where}`);
  }
  $('flash').classList.toggle('crisis', !!(sab && sab.endsAt));

  const target = useTarget();
  const useLabel = !target ? 'USE' : { task: 'USE', panel: 'FIX', emergency: 'BUTTON', security: 'CAMS', admin: 'ADMIN' }[target.kind];
  setText($('use-label'), useLabel);
  $('btn-use').disabled = !target;
  $('btn-report').disabled = !nearestBody(doors);
  $('btn-report').classList.toggle('hidden', !you.alive);
  $('btn-kill').classList.toggle('hidden', !you.isImpostor || !you.alive);
  $('btn-vent').classList.toggle('hidden', !you.isImpostor || !you.alive);
  $('btn-sabotage').classList.toggle('hidden', !you.isImpostor);
  if (you.isImpostor) {
    const cd = Math.ceil((you.killReadyAt - t) / 1000);
    setText($('kill-cd'), cd > 0 ? String(cd) : '');
    $('btn-kill').disabled = cd > 0 || !killTarget(doors);
    $('btn-vent').disabled = !you.inVent && !nearVent();
  }
}

// ---------- Meeting ----------
function renderMeeting(st) {
  const m = st.meeting;
  const me = st.players.find((p) => p.id === myId);
  const caller = st.players.find((p) => p.id === m.callerId);
  $('meeting-title').textContent = m.phase === 'results' ? 'Voting Results' : 'Who Is The Impostor?';
  $('meeting-sub').textContent = caller
    ? `${caller.name} ${m.reason === 'report' ? 'reported a dead body' : 'called an emergency meeting'}.` : '';
  const canVote = m.phase === 'voting' && me && me.alive && !m.myVote;
  const grid = $('meeting-grid');
  grid.innerHTML = '';
  for (const p of st.players) {
    const card = document.createElement('div');
    card.className = 'vote-card' + (p.alive ? '' : ' dead') + (voteSelection === p.id && canVote ? ' selected' : '')
      + (p.isImpostor && st.you.isImpostor ? ' impostor' : '');
    let html = `${iconImg(p.color)}<span class="vname">${esc(p.name)}</span>`;
    if (p.id === m.callerId) html += '<span class="badge">📢</span>';
    if (m.result) {
      const voters = m.result.tally[p.id] || [];
      html += `<span class="vote-dots">${voters.map((id) => voteDot(st, id)).join('')}</span>`;
    } else if (m.voted.includes(p.id)) {
      html += '<span class="badge">VOTED</span>';
    }
    card.innerHTML = html;
    if (canVote && p.alive) {
      card.addEventListener('click', () => { voteSelection = p.id; renderMeeting(S); });
      if (voteSelection === p.id) {
        const ok = document.createElement('button');
        ok.className = 'confirm';
        ok.textContent = '✔';
        ok.addEventListener('click', (e) => { e.stopPropagation(); castVote(p.id); });
        card.appendChild(ok);
      }
    }
    grid.appendChild(card);
  }
  $('vote-skip-btn').disabled = !canVote;
  $('skip-votes').innerHTML = m.result ? (m.result.tally.skip || []).map((id) => voteDot(st, id)).join('') : '';
  $('chat-input').placeholder = me && me.alive ? 'Say something…' : 'Ghost chat (only the dead can read this)';
}

function voteDot(st, id) {
  const p = st.players.find((pl) => pl.id === id);
  return `<span class="vote-dot" style="background:${p ? COLORS[p.color].hex : '#888'}"></span>`;
}

function castVote(targetId) {
  socket.emit('cast-vote', { targetId });
  voteSelection = null;
  sfx('vote');
}
$('vote-skip-btn').addEventListener('click', () => castVote('skip'));

function updateMeetingTimer() {
  const m = S.meeting;
  const left = Math.max(0, Math.ceil((m.endsAt - serverNow()) / 1000));
  const text = m.phase === 'discussion' ? `Voting begins in ${left}s`
    : m.phase === 'voting' ? (m.myVote ? `Vote cast. Ends in ${left}s` : `Voting ends in ${left}s`)
      : `Proceeding in ${left}s`;
  setText($('meeting-timer'), text);
}

$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('chat-input');
  if (input.value.trim()) socket.emit('chat', { text: input.value });
  input.value = '';
});
socket.on('chat', (msg) => {
  const log = $('chat-log');
  const div = document.createElement('div');
  div.className = 'chat-msg' + (msg.ghost ? ' ghost' : '');
  div.innerHTML = `<span class="who" style="color:${COLORS[msg.color].shade}">${esc(msg.name)}${msg.ghost ? ' (ghost)' : ''}</span>${esc(msg.text)}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
});

function showEjection(result) {
  const img = result.ejectedId ? `<img src="${crewIcon(result.ejectedColor)}" alt="" />` : '';
  showSplash('eject', `${img}<p id="eject-text"></p><p id="eject-remaining"></p>`, 5800);
  const text = result.text;
  let i = 0;
  const timer = setInterval(() => {
    const node = $('eject-text');
    if (!node) return clearInterval(timer);
    i += 1;
    node.textContent = text.slice(0, i);
    if (i >= text.length) {
      clearInterval(timer);
      $('eject-remaining').textContent = `${result.remaining} Impostor${result.remaining === 1 ? '' : 's'} remain${result.remaining === 1 ? 's' : ''}.`;
    }
  }, 45);
}

// ---------- End screen ----------
function renderEnd(st) {
  const me = st.players.find((p) => p.id === myId);
  const won = !!me && (st.winner === 'impostor') === !!me.isImpostor;
  $('end-screen').classList.toggle('defeat', !won);
  $('end-title').textContent = won ? 'VICTORY' : 'DEFEAT';
  $('end-message').textContent = `${st.winner === 'impostor' ? 'Impostors win.' : 'Crewmates win.'} ${st.winReason}`;
  const winners = st.players.filter((p) => (st.winner === 'impostor') === !!p.isImpostor);
  $('end-lineup').innerHTML = winners.map((p) => iconImg(p.color)).join('');
  $('end-roles').innerHTML = st.players.map((p) => `<li class="${p.isImpostor ? 'imp' : ''}">${iconImg(p.color)}${esc(p.name)}: ${p.isImpostor ? 'Impostor' : 'Crewmate'}</li>`).join('');
  $('again-btn').classList.toggle('hidden', !me || !me.isHost);
  $('end-hint').classList.toggle('hidden', !!(me && me.isHost));
}

// ---------- Main loop ----------
function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  if (S && S.state !== 'lobby' && S.you) {
    const doors = closedDoorRects();
    tickMovement(dt, doors);
    tickRemote(dt);
    drawWorld(dt, doors);
    if (S.state === 'playing') updateHud(doors);
    if (S.state === 'meeting') updateMeetingTimer();
    if (mapMode) drawMapOverlay();
    if (camsOpen) drawCams();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------- Server events ----------
socket.on('connect', () => { myId = socket.id; });
socket.on('disconnect', () => {
  S = null;
  closeOverlays();
  showScreen('menu');
  menuError.textContent = 'Disconnected from the server.';
});

socket.on('you-died', ({ killerColor }) => {
  closeOverlays();
  sfx('kill');
  showSplash('killed', `<h1>YOU WERE KILLED</h1>${iconImg(killerColor)}<p>You are a ghost now. You can still finish your tasks.</p>`, 2600);
});

socket.on('state', (st) => {
  clockOffset = st.serverNow - Date.now();
  const prev = S;
  const prevState = prev ? prev.state : 'lobby';
  S = st;
  const me = st.players.find((p) => p.id === myId);

  if (st.state === 'lobby') {
    closeOverlays();
    remote.clear();
    $('chat-log').innerHTML = '';
    $('meeting').classList.add('hidden');
    $('end-screen').classList.add('hidden');
    splash.classList.add('hidden');
    showScreen('lobby');
    renderLobby(st);
    return;
  }
  showScreen('game');

  const teleported = prevState !== st.state || (prev && prev.you && prev.you.inVent !== st.you.inVent) || !!st.you.inVent;
  if (me && (teleported || Math.hypot(me.x - myPos.x, me.y - myPos.y) > 90)) {
    myPos.x = me.x;
    myPos.y = me.y;
  }

  if (st.state === 'playing' && (prevState === 'lobby' || prevState === 'ended')) {
    closeOverlays();
    const n = st.players.length;
    const count = Math.min(st.settings.impostors, n >= 9 ? 3 : n >= 7 ? 2 : 1);
    if (st.you.isImpostor) {
      const team = st.players.filter((p) => p.isImpostor);
      showSplash('impostor', `<h1>IMPOSTOR</h1><p>Kill the crew. Don't get caught.</p><div class="lineup">${team.map((p) => iconImg(p.color)).join('')}</div>`, 3800);
    } else {
      showSplash('crew', `<h1>CREWMATE</h1><p>There ${count === 1 ? 'is <b style="color:#ff3b30">1 Impostor</b>' : `are <b style="color:#ff3b30">${count} Impostors</b>`} among us.</p><div class="lineup">${st.players.map((p) => iconImg(p.color)).join('')}</div>`, 3800);
    }
  }

  if (st.state === 'meeting' && prevState !== 'meeting') {
    closeOverlays();
    voteSelection = null;
    sfx('meeting');
    const report = st.meeting.reason === 'report';
    showSplash('alarm', `<h1>${report ? 'DEAD BODY REPORTED' : 'EMERGENCY MEETING'}</h1>${report && st.meeting.bodyColor !== null ? iconImg(st.meeting.bodyColor) : ''}`, 2400);
  }
  if (st.state === 'meeting') {
    const prevPhase = prev && prev.meeting ? prev.meeting.phase : null;
    if (st.meeting.phase === 'ejection' && prevPhase !== 'ejection') showEjection(st.meeting.result);
    renderMeeting(st);
  }
  $('meeting').classList.toggle('hidden', st.state !== 'meeting' || st.meeting.phase === 'ejection');

  if (st.state === 'ended' && prevState !== 'ended') {
    closeOverlays();
    splash.classList.add('hidden');
    renderEnd(st);
  }
  $('end-screen').classList.toggle('hidden', st.state !== 'ended');
  $('hud').classList.toggle('hidden', st.state !== 'playing');

  if (st.state === 'playing') {
    if (st.sabotage && !(prev && prev.sabotage)) sfx('alarm');
    if (activeGame && activeGame.kind === 'panel') {
      if (!st.sabotage) closeMinigame();
      else if (activeGame.update) activeGame.update(st.sabotage);
    }
    if (st.you.inVent) closeOverlays();
    renderTaskList(st);
  }
  renderVentArrows(st);
});
