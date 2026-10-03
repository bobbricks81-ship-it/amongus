const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const MAP = require('./public/map');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const KILL_RANGE = 80;
const TASK_RANGE = 70;
const USE_RANGE = 80;
const REPORT_RANGE = 100;
const VENT_RANGE = 60;
const MAX_PLAYERS = 12;
const COLOR_COUNT = 12;
const FIRST_KILL_DELAY_MS = 10000;
const EMERGENCY_COOLDOWN_MS = 15000;
const SABOTAGE_COOLDOWN_MS = 30000;
const CRISIS_MS = 45000;
const DOOR_CLOSED_MS = 10000;
const DOOR_COOLDOWN_MS = 30000;
const RESULTS_MS = 5000;
const EJECT_MS = 6000;

const DEFAULT_SETTINGS = { impostors: 1, killCooldown: 25, tasks: 5, speed: 1, discussionTime: 15, votingTime: 60 };
const SETTING_LIMITS = {
  impostors: [1, 3], killCooldown: [10, 60], tasks: [1, 10], speed: [0.75, 1.5], discussionTime: [0, 60], votingTime: [15, 180],
};

/** @type {Map<string, Room>} */
const rooms = new Map();

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function playersOf(room) {
  return Array.from(room.players.values());
}

function newPlayer(room, socket, name, isHost) {
  const used = new Set(playersOf(room).map((p) => p.color));
  let color = 0;
  while (used.has(color)) color += 1;
  return {
    id: socket.id, name: String(name || 'Player').slice(0, 12) || 'Player', color, isHost,
    x: MAP.EMERGENCY.x, y: MAP.EMERGENCY.y + 80,
    alive: true, isImpostor: false, tasksAssigned: [], tasksDone: [],
    killReadyAt: 0, meetingsLeft: 1, inVent: null,
  };
}

function snapshot(room, viewerId) {
  const viewer = room.players.get(viewerId);
  const ended = room.state === 'ended';
  const meeting = room.meeting;
  return {
    serverNow: Date.now(),
    code: room.code,
    state: room.state,
    settings: room.settings,
    players: playersOf(room).map((p) => ({
      id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, alive: p.alive, isHost: p.isHost, inVent: !!p.inVent, isBot: !!p.isBot,
      isImpostor: ended || p.id === viewerId || (viewer && viewer.isImpostor) ? p.isImpostor : undefined,
    })),
    you: viewer ? {
      isImpostor: viewer.isImpostor, alive: viewer.alive, killReadyAt: viewer.killReadyAt,
      meetingsLeft: viewer.meetingsLeft, inVent: viewer.inVent,
      tasks: viewer.tasksAssigned.map((id) => ({ id, done: viewer.tasksDone.includes(id) })),
    } : null,
    bodies: room.bodies,
    totalTasks: room.totalTasks,
    doneTasks: room.doneTasks,
    emergencyReadyAt: room.emergencyReadyAt,
    sabotage: room.sabotage ? {
      type: room.sabotage.type, endsAt: room.sabotage.endsAt || null, switches: room.sabotage.switches,
      code: room.sabotage.code, done: room.sabotage.done, held: room.sabotage.held ? Object.keys(room.sabotage.held) : undefined,
    } : null,
    sabotageReadyAt: room.sabotageReadyAt,
    doors: room.doors,
    meeting: meeting ? {
      phase: meeting.phase, endsAt: meeting.endsAt, reason: meeting.reason, callerId: meeting.callerId,
      bodyColor: meeting.bodyColor, voted: Array.from(room.votes.keys()),
      myVote: room.votes.get(viewerId) || null, result: meeting.result || null,
    } : null,
    winner: room.winner || null,
    winReason: room.winReason || '',
  };
}

function broadcastState(room) {
  for (const p of room.players.values()) io.to(p.id).emit('state', snapshot(room, p.id));
}

function clearTimers(room) {
  if (room.meetingTimeout) clearTimeout(room.meetingTimeout);
  if (room.sabotageTimeout) clearTimeout(room.sabotageTimeout);
  room.meetingTimeout = null;
  room.sabotageTimeout = null;
}

function placeAtSpawn(room) {
  const list = playersOf(room);
  list.forEach((p, i) => {
    const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
    p.x = MAP.EMERGENCY.x + Math.cos(a) * 95;
    p.y = MAP.EMERGENCY.y + Math.sin(a) * 85;
    p.inVent = null;
  });
}

function resetRoomToLobby(room) {
  clearTimers(room);
  room.state = 'lobby';
  room.bodies = [];
  room.votes = new Map();
  room.totalTasks = 0;
  room.doneTasks = 0;
  room.meeting = null;
  room.sabotage = null;
  room.doors = {};
  room.winner = null;
  room.winReason = '';
  for (const p of room.players.values()) {
    p.alive = true;
    p.isImpostor = false;
    p.tasksAssigned = [];
    p.tasksDone = [];
    p.inVent = null;
  }
}

function startGame(room) {
  const list = playersOf(room);
  if (list.length < 2) return;
  clearTimers(room);
  const now = Date.now();
  room.state = 'playing';
  room.bodies = [];
  room.votes = new Map();
  room.meeting = null;
  room.sabotage = null;
  room.doors = {};
  room.winner = null;
  room.winReason = '';
  room.doneTasks = 0;
  room.totalTasks = 0;
  room.emergencyReadyAt = now + EMERGENCY_COOLDOWN_MS;
  room.sabotageReadyAt = now + 15000;
  // With fewer than four players the usual "impostors outnumber crew" rule would end the game at once.
  room.smallGame = list.length < 4;

  const maxImpostors = list.length >= 9 ? 3 : list.length >= 7 ? 2 : 1;
  const impostorCount = Math.min(room.settings.impostors, maxImpostors);
  const shuffled = [...list].sort(() => Math.random() - 0.5);
  const impostorIds = new Set(shuffled.slice(0, impostorCount).map((p) => p.id));

  for (const p of list) {
    p.alive = true;
    p.isImpostor = impostorIds.has(p.id);
    p.killReadyAt = now + FIRST_KILL_DELAY_MS;
    p.meetingsLeft = 1;
    p.tasksDone = [];
    p.tasksAssigned = [];
    if (!p.isImpostor) {
      p.tasksAssigned = [...MAP.TASK_SPOTS].sort(() => Math.random() - 0.5).slice(0, room.settings.tasks).map((t) => t.id);
      room.totalTasks += p.tasksAssigned.length;
    }
  }
  placeAtSpawn(room);
  bots.onGameStart(room);
}

function endGame(room, winner, reason) {
  clearTimers(room);
  room.state = 'ended';
  room.meeting = null;
  room.sabotage = null;
  room.winner = winner;
  room.winReason = reason;
}

function checkWin(room) {
  if (room.state !== 'playing') return false;
  const alive = playersOf(room).filter((p) => p.alive);
  const impostors = alive.filter((p) => p.isImpostor);
  const crew = alive.filter((p) => !p.isImpostor);
  if (impostors.length === 0) {
    endGame(room, 'crew', 'Every impostor is gone.');
  } else if (room.totalTasks > 0 && room.doneTasks >= room.totalTasks) {
    endGame(room, 'crew', 'The crew finished every task.');
  } else if (room.smallGame ? crew.length === 0 : impostors.length >= crew.length) {
    endGame(room, 'impostor', 'The impostors took over the ship.');
  } else {
    return false;
  }
  return true;
}

// ---------- Sabotage ----------
function clearSabotage(room) {
  if (room.sabotageTimeout) clearTimeout(room.sabotageTimeout);
  room.sabotageTimeout = null;
  room.sabotage = null;
  room.sabotageReadyAt = Date.now() + SABOTAGE_COOLDOWN_MS;
}

function startSabotage(room, type) {
  const now = Date.now();
  if (type === 'lights') {
    const switches = Array.from({ length: 5 }, () => Math.random() < 0.5);
    switches[Math.floor(Math.random() * 5)] = false;
    room.sabotage = { type, switches };
  } else if (type === 'comms') {
    room.sabotage = { type };
  } else if (type === 'reactor' || type === 'o2') {
    room.sabotage = type === 'reactor'
      ? { type, endsAt: now + CRISIS_MS, held: {} }
      : { type, endsAt: now + CRISIS_MS, done: {}, code: String(10000 + Math.floor(Math.random() * 90000)) };
    room.sabotageTimeout = setTimeout(() => {
      if (room.state !== 'playing' || !room.sabotage || room.sabotage.type !== type) return;
      endGame(room, 'impostor', type === 'reactor' ? 'The reactor melted down.' : 'The crew ran out of oxygen.');
      broadcastState(room);
    }, CRISIS_MS);
  }
}

// ---------- Meetings ----------
function startMeeting(room, reason, caller, body) {
  clearTimers(room);
  // A meeting cancels a running crisis; lights and comms stay broken.
  if (room.sabotage && room.sabotage.endsAt) clearSabotage(room);
  room.state = 'meeting';
  room.bodies = [];
  room.doors = {};
  room.votes = new Map();
  placeAtSpawn(room);
  const discussion = room.settings.discussionTime * 1000;
  room.meeting = {
    phase: discussion > 0 ? 'discussion' : 'voting',
    endsAt: Date.now() + (discussion > 0 ? discussion : room.settings.votingTime * 1000),
    reason, callerId: caller.id, bodyColor: body ? body.color : null, result: null,
  };
  room.meetingTimeout = setTimeout(() => advanceMeeting(room), room.meeting.endsAt - Date.now());
  bots.onMeeting(room);
  if (room.meeting.phase === 'voting') bots.onVoting(room);
}

function tallyVotes(room) {
  const tally = {};
  for (const p of playersOf(room)) {
    if (!p.alive) continue;
    const target = room.votes.get(p.id) || 'skip';
    (tally[target] = tally[target] || []).push(p.id);
  }
  let top = null;
  let topCount = 0;
  let tie = false;
  for (const [target, voters] of Object.entries(tally)) {
    if (voters.length > topCount) {
      top = target;
      topCount = voters.length;
      tie = false;
    } else if (voters.length === topCount) {
      tie = true;
    }
  }
  const ejected = !tie && top && top !== 'skip' ? room.players.get(top) : null;
  const result = { tally, ejectedId: null, ejectedName: null, ejectedColor: null, wasImpostor: false, text: '', remaining: 0 };
  if (ejected) {
    result.ejectedId = ejected.id;
    result.ejectedName = ejected.name;
    result.ejectedColor = ejected.color;
    result.wasImpostor = ejected.isImpostor;
    result.text = `${ejected.name} was ${ejected.isImpostor ? '' : 'not '}The Impostor.`;
  } else {
    result.text = tie ? 'No one was ejected. (Tie)' : 'No one was ejected. (Skipped)';
  }
  const impostorsLeft = playersOf(room).filter((p) => p.alive && p.isImpostor && p.id !== result.ejectedId).length;
  result.remaining = impostorsLeft;
  return result;
}

function advanceMeeting(room) {
  if (room.state !== 'meeting' || !room.meeting) return;
  if (room.meetingTimeout) clearTimeout(room.meetingTimeout);
  room.meetingTimeout = null;
  const meeting = room.meeting;
  const now = Date.now();
  let wait = 0;

  if (meeting.phase === 'discussion') {
    meeting.phase = 'voting';
    wait = room.settings.votingTime * 1000;
    bots.onVoting(room);
  } else if (meeting.phase === 'voting') {
    meeting.phase = 'results';
    meeting.result = tallyVotes(room);
    wait = RESULTS_MS;
  } else if (meeting.phase === 'results') {
    meeting.phase = 'ejection';
    const ejected = room.players.get(meeting.result.ejectedId);
    if (ejected) ejected.alive = false;
    wait = EJECT_MS;
  } else {
    room.state = 'playing';
    room.meeting = null;
    room.votes = new Map();
    room.emergencyReadyAt = now + EMERGENCY_COOLDOWN_MS;
    room.sabotageReadyAt = Math.max(room.sabotageReadyAt, now + 10000);
    for (const p of room.players.values()) p.killReadyAt = now + room.settings.killCooldown * 1000;
    placeAtSpawn(room);
    checkWin(room);
    broadcastState(room);
    return;
  }
  meeting.endsAt = now + wait;
  room.meetingTimeout = setTimeout(() => advanceMeeting(room), wait);
  broadcastState(room);
}

function near(player, spot, range) {
  return Math.hypot(player.x - spot.x, player.y - spot.y) <= range;
}

function emitMove(room, p) {
  io.to(room.code).except(p.id).emit('player-moved', { id: p.id, x: p.x, y: p.y });
}

// Every in-game action, keyed by event name. Sockets and AI players both go through act().
const ACTIONS = {
  'set-color': { state: 'lobby', fn(room, player, { color }) {
    const c = Number(color);
    if (!Number.isInteger(c) || c < 0 || c >= COLOR_COUNT) return;
    if (playersOf(room).some((p) => p.color === c)) return;
    player.color = c;
    broadcastState(room);
  } },

  'set-settings': { state: 'lobby', fn(room, player, changes) {
    if (!player.isHost) return;
    for (const [key, [min, max]] of Object.entries(SETTING_LIMITS)) {
      const v = Number(changes[key]);
      if (Number.isFinite(v)) room.settings[key] = Math.max(min, Math.min(max, v));
    }
    broadcastState(room);
  } },

  'add-bot': { state: 'lobby', fn(room, player) {
    if (!player.isHost || room.players.size >= MAX_PLAYERS) return;
    const id = `bot-${Math.random().toString(36).slice(2, 10)}`;
    const bot = newPlayer(room, { id }, bots.create(room).name, false);
    bot.isBot = true;
    room.players.set(id, bot);
    broadcastState(room);
  } },

  'remove-bot': { state: 'lobby', fn(room, player, { id }) {
    const bot = room.players.get(id);
    if (!player.isHost || !bot || !bot.isBot) return;
    room.players.delete(id);
    broadcastState(room);
  } },

  'start-game': { state: 'lobby', fn(room, player) {
    if (!player.isHost) return;
    startGame(room);
    broadcastState(room);
  } },

  'play-again': { state: 'ended', fn(room, player) {
    if (!player.isHost) return;
    resetRoomToLobby(room);
    broadcastState(room);
  } },

  move: { state: 'playing', fn(room, player, { x, y }) {
    if (player.inVent) return;
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
    if (player.alive) {
      if (!MAP.isWalkable(nx, ny)) return;
    } else if (nx < 0 || ny < 0 || nx > MAP.WORLD_W || ny > MAP.WORLD_H) {
      return; // ghosts drift through walls but stay on the map
    }
    player.x = nx;
    player.y = ny;
    emitMove(room, player);
  } },

  'do-task': { state: 'playing', fn(room, player, { taskId }) {
    if (player.isImpostor) return;
    if (!player.tasksAssigned.includes(taskId) || player.tasksDone.includes(taskId)) return;
    const spot = MAP.TASK_SPOTS.find((t) => t.id === taskId);
    if (!spot || !near(player, spot, TASK_RANGE)) return;
    player.tasksDone.push(taskId);
    room.doneTasks += 1;
    checkWin(room);
    broadcastState(room);
  } },

  eliminate: { state: 'playing', fn(room, player, { targetId }) {
    const target = room.players.get(targetId);
    if (!player.isImpostor || !player.alive || player.inVent) return;
    if (!target || !target.alive || target.isImpostor || target.inVent) return;
    const now = Date.now();
    if (now < player.killReadyAt || !near(player, target, KILL_RANGE)) return;
    target.alive = false;
    player.killReadyAt = now + room.settings.killCooldown * 1000;
    room.bodies.push({ id: `body-${target.id}-${now}`, x: target.x, y: target.y, color: target.color });
    bots.onKill(room, player, target);
    // The killer lunges onto the victim, like the real thing.
    player.x = target.x;
    player.y = target.y;
    if (room.sabotage && room.sabotage.held) {
      for (const [panelId, holder] of Object.entries(room.sabotage.held)) {
        if (holder === target.id) delete room.sabotage.held[panelId];
      }
    }
    io.to(target.id).emit('you-died', { killerColor: player.color });
    checkWin(room);
    broadcastState(room);
  } },

  'report-body': { state: 'playing', fn(room, player, { bodyId }) {
    if (!player.alive || player.inVent) return;
    const body = room.bodies.find((b) => b.id === bodyId);
    if (!body || !near(player, body, REPORT_RANGE)) return;
    startMeeting(room, 'report', player, body);
    broadcastState(room);
  } },

  'call-meeting': { state: 'playing', fn(room, player) {
    if (!player.alive || player.meetingsLeft <= 0) return;
    if (Date.now() < room.emergencyReadyAt || !near(player, MAP.EMERGENCY, USE_RANGE)) return;
    if (room.sabotage) return; // no button while something is sabotaged
    player.meetingsLeft -= 1;
    startMeeting(room, 'emergency', player, null);
    broadcastState(room);
  } },

  'vent-enter': { state: 'playing', fn(room, player, { ventId }) {
    if (!player.alive || !player.isImpostor || player.inVent) return;
    const vent = MAP.VENTS.find((v) => v.id === ventId);
    if (!vent || !near(player, vent, VENT_RANGE)) return;
    bots.onVent(room, player);
    player.inVent = vent.id;
    player.x = vent.x;
    player.y = vent.y;
    broadcastState(room);
  } },

  'vent-move': { state: 'playing', fn(room, player, { ventId }) {
    if (!player.inVent) return;
    const current = MAP.VENTS.find((v) => v.id === player.inVent);
    const dest = MAP.VENTS.find((v) => v.id === ventId);
    if (!current || !dest || dest.group !== current.group) return;
    player.inVent = dest.id;
    player.x = dest.x;
    player.y = dest.y;
    broadcastState(room);
  } },

  'vent-exit': { state: 'playing', fn(room, player) {
    if (!player.inVent) return;
    player.inVent = null;
    bots.onVent(room, player);
    broadcastState(room);
  } },

  sabotage: { state: 'playing', fn(room, player, { type, roomId }) {
    if (!player.isImpostor) return;
    const now = Date.now();
    if (type === 'doors') {
      if (!MAP.DOOR_ROOMS.includes(roomId)) return;
      const door = room.doors[roomId];
      if (door && now < door.readyAt) return;
      room.doors[roomId] = { closedUntil: now + DOOR_CLOSED_MS, readyAt: now + DOOR_COOLDOWN_MS };
    } else {
      if (!['lights', 'comms', 'reactor', 'o2'].includes(type)) return;
      if (room.sabotage || now < room.sabotageReadyAt) return;
      startSabotage(room, type);
    }
    broadcastState(room);
  } },

  'fix-sabotage': { state: 'playing', fn(room, player, { panelId, index, active, code }) {
    if (!player.alive || !room.sabotage) return;
    const panel = MAP.PANELS.find((p) => p.id === panelId);
    const sab = room.sabotage;
    if (!panel || panel.sabotage !== sab.type || !near(player, panel, USE_RANGE)) return;
    if (sab.type === 'lights') {
      const i = Number(index);
      if (!Number.isInteger(i) || i < 0 || i >= sab.switches.length) return;
      sab.switches[i] = !sab.switches[i];
      if (sab.switches.every(Boolean)) clearSabotage(room);
    } else if (sab.type === 'comms') {
      clearSabotage(room);
    } else if (sab.type === 'reactor') {
      if (active) sab.held[panelId] = player.id;
      else if (sab.held[panelId] === player.id) delete sab.held[panelId];
      const alive = playersOf(room).filter((p) => p.alive).length;
      if (Object.keys(sab.held).length >= (alive >= 3 ? 2 : 1)) clearSabotage(room);
    } else if (sab.type === 'o2') {
      if (String(code) !== sab.code) return;
      sab.done[panelId] = true;
      if (Object.keys(sab.done).length >= 2) clearSabotage(room);
    }
    broadcastState(room);
  } },

  'cast-vote': { state: 'meeting', fn(room, player, { targetId }) {
    if (!player.alive || room.meeting.phase !== 'voting' || room.votes.has(player.id)) return;
    const target = targetId === 'skip' ? null : room.players.get(targetId);
    if (targetId !== 'skip' && (!target || !target.alive)) return;
    room.votes.set(player.id, targetId);
    const aliveCount = playersOf(room).filter((p) => p.alive).length;
    if (room.votes.size >= aliveCount) advanceMeeting(room);
    else broadcastState(room);
  } },

  chat: { state: 'meeting', fn(room, player, { text }) {
    const clean = String(text || '').trim().slice(0, 120);
    if (!clean) return;
    const msg = { name: player.name, color: player.color, text: clean, ghost: !player.alive };
    for (const p of room.players.values()) {
      if (!msg.ghost || !p.alive) io.to(p.id).emit('chat', msg);
    }
    bots.onChat(room, player, clean);
  } },
};

function act(room, player, type, data) {
  const action = ACTIONS[type];
  if (!action || !room || !player || room.state !== action.state) return;
  action.fn(room, player, data && typeof data === 'object' ? data : {});
}

const bots = require('./bots')({ MAP, act, playersOf, emitMove, ranges: { KILL_RANGE, REPORT_RANGE } });

let lastBotTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.2, (now - lastBotTick) / 1000);
  lastBotTick = now;
  for (const room of rooms.values()) bots.tick(room, dt);
}, 50);

io.on('connection', (socket) => {
  socket.data.roomCode = null;

  socket.on('create-room', (name, cb) => {
    if (typeof cb !== 'function') return;
    const code = makeRoomCode();
    const room = {
      code, players: new Map(), state: 'lobby', settings: { ...DEFAULT_SETTINGS },
      bodies: [], votes: new Map(), totalTasks: 0, doneTasks: 0,
      meeting: null, meetingTimeout: null, sabotage: null, sabotageTimeout: null, sabotageReadyAt: 0,
      doors: {}, emergencyReadyAt: 0, winner: null, winReason: '', smallGame: false,
    };
    rooms.set(code, room);
    room.players.set(socket.id, newPlayer(room, socket, name, true));
    socket.data.roomCode = code;
    socket.join(code);
    cb({ ok: true, code });
    broadcastState(room);
  });

  socket.on('join-room', ({ roomCode, name } = {}, cb) => {
    if (typeof cb !== 'function') return;
    const code = String(roomCode || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: 'Room not found.' });
    if (room.state !== 'lobby') return cb({ ok: false, error: 'Game already in progress.' });
    if (room.players.size >= MAX_PLAYERS) return cb({ ok: false, error: 'Room is full.' });
    room.players.set(socket.id, newPlayer(room, socket, name, false));
    socket.data.roomCode = code;
    socket.join(code);
    cb({ ok: true, code });
    broadcastState(room);
  });

  for (const type of Object.keys(ACTIONS)) {
    socket.on(type, (data) => {
      const room = rooms.get(socket.data.roomCode);
      act(room, room && room.players.get(socket.id), type, data);
    });
  }

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const leaver = room.players.get(socket.id);
    room.players.delete(socket.id);
    room.votes.delete(socket.id);
    const humans = playersOf(room).filter((p) => !p.isBot);
    if (humans.length === 0) {
      clearTimers(room);
      rooms.delete(room.code);
      return;
    }
    if (leaver) {
      room.totalTasks -= leaver.tasksAssigned.length;
      room.doneTasks -= leaver.tasksDone.length;
      if (leaver.isHost) humans[0].isHost = true;
    }
    if (room.state === 'playing') {
      checkWin(room);
    } else if (room.state === 'meeting' && room.meeting.phase === 'voting') {
      const aliveCount = playersOf(room).filter((p) => p.alive).length;
      if (room.votes.size >= aliveCount) return advanceMeeting(room);
    }
    broadcastState(room);
  });
});

app.get('/config', (_req, res) => {
  res.json({ KILL_RANGE, TASK_RANGE, USE_RANGE, REPORT_RANGE, VENT_RANGE });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Crewmates running on http://localhost:${PORT}`));
