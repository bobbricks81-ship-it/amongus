const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const WORLD_W = 800;
const WORLD_H = 600;
const KILL_RANGE = 55;
const TASK_RANGE = 45;
const REPORT_RANGE = 70;
const KILL_COOLDOWN_MS = 8000;
const TASKS_PER_CREW = 3;
const MEETING_DURATION_MS = 45000;

const TASK_SPOTS = [
  { id: 'coffee', label: 'Make Coffee', x: 110, y: 110 },
  { id: 'server', label: 'Reboot Server', x: 690, y: 110 },
  { id: 'printer', label: 'Fix Printer Jam', x: 110, y: 490 },
  { id: 'reports', label: 'File Reports', x: 690, y: 490 },
  { id: 'supplies', label: 'Count Supplies', x: 400, y: 300 },
  { id: 'shred', label: 'Shred Documents', x: 400, y: 110 },
  { id: 'mail', label: 'Sort Mail', x: 400, y: 490 },
];

const COLORS = ['#e05555', '#5588e0', '#55b56b', '#e0b955', '#b065d6', '#e07fb0', '#55c7c0', '#e0893f'];

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

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    alive: p.alive,
    color: p.color,
    isHost: p.isHost,
  };
}

function roomSnapshot(room, forPlayerId) {
  const viewer = room.players.get(forPlayerId);
  const revealRoles = room.state === 'ended';
  return {
    code: room.code,
    state: room.state,
    players: Array.from(room.players.values()).map((p) => ({
      ...publicPlayer(p),
      isMole: revealRoles ? p.isMole : viewer && viewer.id === p.id ? p.isMole : undefined,
    })),
    bodies: room.bodies.map((b) => ({ id: b.id, x: b.x, y: b.y, victimName: b.victimName })),
    totalTasks: room.totalTasks,
    doneTasks: room.doneTasks,
    meetingEndsAt: room.meetingEndsAt || null,
    votes: room.state === 'meeting' ? summarizeVotes(room) : null,
    resultMessage: room.resultMessage || null,
    youAreMole: viewer ? viewer.isMole : false,
    yourTasks: viewer ? viewer.tasksAssigned.map((id) => ({ id, label: TASK_SPOTS.find((t) => t.id === id).label, done: viewer.tasksDone.includes(id) })) : [],
  };
}

function summarizeVotes(room) {
  const tally = {};
  for (const v of room.votes.values()) tally[v] = (tally[v] || 0) + 1;
  return { cast: room.votes.size, aliveCount: aliveCrewAndMoleCount(room), tally };
}

function aliveCrewAndMoleCount(room) {
  return Array.from(room.players.values()).filter((p) => p.alive).length;
}

function broadcastState(room) {
  for (const p of room.players.values()) {
    io.to(p.id).emit('state', roomSnapshot(room, p.id));
  }
}

function resetRoomToLobby(room) {
  room.state = 'lobby';
  room.bodies = [];
  room.votes = new Map();
  room.totalTasks = 0;
  room.doneTasks = 0;
  room.meetingEndsAt = null;
  room.resultMessage = '';
  if (room.meetingTimeout) clearTimeout(room.meetingTimeout);
  room.meetingTimeout = null;
  for (const p of room.players.values()) {
    p.alive = true;
    p.isMole = false;
    p.tasksAssigned = [];
    p.tasksDone = [];
    p.x = 400;
    p.y = 300;
  }
}

function startGame(room) {
  const playerList = Array.from(room.players.values());
  if (playerList.length < 2) return;
  room.state = 'playing';
  room.bodies = [];
  room.votes = new Map();
  room.resultMessage = '';
  room.meetingEndsAt = null;

  const molePlayer = playerList[Math.floor(Math.random() * playerList.length)];
  room.doneTasks = 0;
  room.totalTasks = 0;

  for (const p of playerList) {
    p.alive = true;
    p.x = 380 + Math.random() * 40;
    p.y = 280 + Math.random() * 40;
    p.isMole = p.id === molePlayer.id;
    if (p.isMole) {
      p.tasksAssigned = [];
      p.tasksDone = [];
    } else {
      const shuffled = [...TASK_SPOTS].sort(() => Math.random() - 0.5).slice(0, TASKS_PER_CREW);
      p.tasksAssigned = shuffled.map((t) => t.id);
      p.tasksDone = [];
      room.totalTasks += p.tasksAssigned.length;
    }
  }
  room.lastKillAt = null;
}

function checkWinConditions(room) {
  if (room.state !== 'playing') return;
  const alive = Array.from(room.players.values()).filter((p) => p.alive);
  const aliveCrew = alive.filter((p) => !p.isMole);
  if (room.doneTasks >= room.totalTasks && room.totalTasks > 0) {
    endGame(room, 'Crew finished all tasks. Crew wins!');
    return;
  }
  if (aliveCrew.length === 0) {
    endGame(room, 'The mole eliminated the whole crew. Mole wins!');
    return;
  }
}

function endGame(room, message) {
  room.state = 'ended';
  room.resultMessage = message;
  if (room.meetingTimeout) clearTimeout(room.meetingTimeout);
  room.meetingTimeout = null;
}

function startMeeting(room) {
  room.state = 'meeting';
  room.votes = new Map();
  room.meetingEndsAt = Date.now() + MEETING_DURATION_MS;
  room.meetingTimeout = setTimeout(() => resolveMeeting(room), MEETING_DURATION_MS);
}

function resolveMeeting(room) {
  if (room.state !== 'meeting') return;
  if (room.meetingTimeout) clearTimeout(room.meetingTimeout);
  room.meetingTimeout = null;

  const tally = {};
  for (const v of room.votes.values()) tally[v] = (tally[v] || 0) + 1;
  let ejectedId = null;
  let topVotes = 0;
  let tie = false;
  for (const [target, count] of Object.entries(tally)) {
    if (target === 'skip') continue;
    if (count > topVotes) {
      topVotes = count;
      ejectedId = target;
      tie = false;
    } else if (count === topVotes && topVotes > 0) {
      tie = true;
    }
  }

  room.state = 'playing';
  room.meetingEndsAt = null;

  if (ejectedId && !tie && topVotes > 0) {
    const ejected = room.players.get(ejectedId);
    if (ejected) {
      ejected.alive = false;
      if (ejected.isMole) {
        endGame(room, `${ejected.name} was ejected. They were the mole. Crew wins!`);
        broadcastState(room);
        return;
      } else {
        room.resultMessage = `${ejected.name} was ejected. They were not the mole.`;
      }
    }
  } else {
    room.resultMessage = 'No one was ejected (tie or skip).';
  }

  checkWinConditions(room);
  broadcastState(room);
}

io.on('connection', (socket) => {
  socket.data.roomCode = null;

  socket.on('create-room', (name, cb) => {
    const code = makeRoomCode();
    const room = {
      code,
      players: new Map(),
      state: 'lobby',
      bodies: [],
      votes: new Map(),
      totalTasks: 0,
      doneTasks: 0,
      meetingEndsAt: null,
      meetingTimeout: null,
      resultMessage: '',
      lastKillAt: null,
    };
    rooms.set(code, room);
    const color = COLORS[0];
    room.players.set(socket.id, {
      id: socket.id, name: String(name || 'Player').slice(0, 16), x: 400, y: 300,
      alive: true, isMole: false, isHost: true, color,
      tasksAssigned: [], tasksDone: [],
    });
    socket.data.roomCode = code;
    socket.join(code);
    cb({ ok: true, code });
    broadcastState(room);
  });

  socket.on('join-room', ({ roomCode, name }, cb) => {
    const code = String(roomCode || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb({ ok: false, error: 'Room not found.' });
    if (room.state !== 'lobby') return cb({ ok: false, error: 'Game already in progress.' });
    if (room.players.size >= 8) return cb({ ok: false, error: 'Room is full.' });
    const color = COLORS[room.players.size % COLORS.length];
    room.players.set(socket.id, {
      id: socket.id, name: String(name || 'Player').slice(0, 16), x: 400, y: 300,
      alive: true, isMole: false, isHost: false, color,
      tasksAssigned: [], tasksDone: [],
    });
    socket.data.roomCode = code;
    socket.join(code);
    cb({ ok: true, code });
    broadcastState(room);
  });

  socket.on('start-game', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || !player.isHost || room.state !== 'lobby') return;
    startGame(room);
    broadcastState(room);
  });

  socket.on('play-again', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || !player.isHost) return;
    resetRoomToLobby(room);
    broadcastState(room);
  });

  socket.on('move', ({ x, y }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.state !== 'playing') return;
    const player = room.players.get(socket.id);
    if (!player || !player.alive) return;
    player.x = Math.max(20, Math.min(WORLD_W - 20, Number(x) || player.x));
    player.y = Math.max(20, Math.min(WORLD_H - 20, Number(y) || player.y));
    socket.to(room.code).emit('player-moved', { id: player.id, x: player.x, y: player.y });
  });

  socket.on('do-task', ({ taskId }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.state !== 'playing') return;
    const player = room.players.get(socket.id);
    if (!player || !player.alive || player.isMole) return;
    if (!player.tasksAssigned.includes(taskId) || player.tasksDone.includes(taskId)) return;
    const spot = TASK_SPOTS.find((t) => t.id === taskId);
    if (!spot) return;
    const dist = Math.hypot(player.x - spot.x, player.y - spot.y);
    if (dist > TASK_RANGE) return;
    player.tasksDone.push(taskId);
    room.doneTasks += 1;
    checkWinConditions(room);
    broadcastState(room);
  });

  socket.on('eliminate', ({ targetId }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.state !== 'playing') return;
    const mole = room.players.get(socket.id);
    const target = room.players.get(targetId);
    if (!mole || !mole.isMole || !mole.alive || !target || !target.alive || target.isMole) return;
    const now = Date.now();
    if (room.lastKillAt && now - room.lastKillAt < KILL_COOLDOWN_MS) return;
    const dist = Math.hypot(mole.x - target.x, mole.y - target.y);
    if (dist > KILL_RANGE) return;
    target.alive = false;
    room.lastKillAt = now;
    room.bodies.push({ id: `body-${target.id}-${now}`, x: target.x, y: target.y, victimName: target.name });
    checkWinConditions(room);
    broadcastState(room);
  });

  socket.on('report-body', ({ bodyId }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.state !== 'playing') return;
    const reporter = room.players.get(socket.id);
    if (!reporter || !reporter.alive) return;
    const body = room.bodies.find((b) => b.id === bodyId);
    if (!body) return;
    const dist = Math.hypot(reporter.x - body.x, reporter.y - body.y);
    if (dist > REPORT_RANGE) return;
    room.bodies = room.bodies.filter((b) => b.id !== bodyId);
    room.resultMessage = `${reporter.name} reported a body!`;
    startMeeting(room);
    broadcastState(room);
  });

  socket.on('cast-vote', ({ targetId }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.state !== 'meeting') return;
    const voter = room.players.get(socket.id);
    if (!voter || !voter.alive) return;
    room.votes.set(socket.id, targetId === 'skip' ? 'skip' : targetId);
    const aliveCount = aliveCrewAndMoleCount(room);
    broadcastState(room);
    if (room.votes.size >= aliveCount) {
      resolveMeeting(room);
    }
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const wasHost = room.players.get(socket.id)?.isHost;
    room.players.delete(socket.id);
    room.votes.delete(socket.id);
    if (room.players.size === 0) {
      if (room.meetingTimeout) clearTimeout(room.meetingTimeout);
      rooms.delete(room.code);
      return;
    }
    if (wasHost) {
      const next = room.players.values().next().value;
      if (next) next.isHost = true;
    }
    if (room.state === 'playing') checkWinConditions(room);
    broadcastState(room);
  });
});

app.get('/config', (_req, res) => {
  res.json({ WORLD_W, WORLD_H, TASK_SPOTS, KILL_RANGE, TASK_RANGE, REPORT_RANGE, KILL_COOLDOWN_MS });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Office Heist running on http://localhost:${PORT}`));
