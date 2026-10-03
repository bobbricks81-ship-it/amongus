// AI crewmates. They walk the ship with real pathfinding, do tasks, react to sabotage,
// kill and vent when they are the impostor, and argue in meetings from what they actually saw.

const COLOR_NAMES = ['red', 'blue', 'green', 'pink', 'orange', 'yellow', 'black', 'white', 'purple', 'brown', 'cyan', 'lime'];
const BOT_NAMES = ['mika', 'jayden07', 'Luna', 'tobi', 'sarah_k', 'NoahG', 'pixelpaw', 'Kai', 'emma', 'zeke', 'oliver', 'ravi', 'Ivy', 'maxx', 'chloe', 'dannyb', 'nova', 'Theo'];

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

module.exports = function createBots({ MAP, act, playersOf, emitMove, ranges }) {
  // ---------- Pathfinding: BFS over a coarse grid, then straightened ----------
  const CELL = 20;
  const CLEAR = MAP.PLAYER_RADIUS + 2;
  const GW = Math.ceil(MAP.WORLD_W / CELL);
  const GH = Math.ceil(MAP.WORLD_H / CELL);
  const grid = new Uint8Array(GW * GH);
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      if (MAP.isWalkable(i * CELL + CELL / 2, j * CELL + CELL / 2, CLEAR)) grid[j * GW + i] = 1;
    }
  }
  const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  function nearestCell(x, y) {
    const ci = Math.max(0, Math.min(GW - 1, Math.floor(x / CELL)));
    const cj = Math.max(0, Math.min(GH - 1, Math.floor(y / CELL)));
    for (let r = 0; r < 12; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (i < 0 || j < 0 || i >= GW || j >= GH || !grid[j * GW + i]) continue;
          const d = Math.hypot(i * CELL + CELL / 2 - x, j * CELL + CELL / 2 - y);
          if (d < bestD) { bestD = d; best = j * GW + i; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  function clearLine(x1, y1, x2, y2) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.ceil(dist / 8);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!MAP.isWalkable(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false;
    }
    return true;
  }

  function findPath(sx, sy, tx, ty) {
    const start = nearestCell(sx, sy);
    const goal = nearestCell(tx, ty);
    if (start < 0 || goal < 0) return [];
    const prev = new Int32Array(GW * GH).fill(-1);
    const queue = [start];
    prev[start] = start;
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      if (cur === goal) break;
      const ci = cur % GW;
      const cj = (cur - ci) / GW;
      for (const [di, dj] of NEIGHBORS) {
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
        const n = nj * GW + ni;
        if (!grid[n] || prev[n] >= 0) continue;
        if (di && dj && (!grid[cj * GW + ni] || !grid[nj * GW + ci])) continue;
        prev[n] = cur;
        queue.push(n);
      }
    }
    if (prev[goal] < 0) return [];
    const cells = [];
    for (let c = goal; c !== start; c = prev[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => ({ x: (c % GW) * CELL + CELL / 2, y: Math.floor(c / GW) * CELL + CELL / 2 }));
    if (MAP.isWalkable(tx, ty)) pts.push({ x: tx, y: ty });
    // string-pull so they cut corners like a person instead of following the grid
    const out = [];
    let ax = sx;
    let ay = sy;
    let i = 0;
    while (i < pts.length) {
      let j = Math.min(pts.length - 1, i + 14);
      while (j > i && !clearLine(ax, ay, pts[j].x, pts[j].y)) j--;
      out.push(pts[j]);
      ax = pts[j].x;
      ay = pts[j].y;
      i = j + 1;
    }
    return out;
  }

  // ---------- Helpers ----------
  const colorOf = (p) => COLOR_NAMES[p.color] || 'someone';
  const closedDoors = (room, now) => MAP.closedDoors(Object.keys(room.doors).filter((id) => room.doors[id].closedUntil > now));

  function sees(room, viewer, x, y, doors) {
    let range = 340;
    if (!viewer.isImpostor && room.sabotage && room.sabotage.type === 'lights') range = 120;
    return Math.hypot(viewer.x - x, viewer.y - y) <= range && MAP.lineOfSight(viewer.x, viewer.y, x, y, doors);
  }

  function bump(bot, id, amount) {
    bot.bot.susp[id] = Math.min(100, (bot.bot.susp[id] || 0) + amount);
  }

  function setGoal(p, goal) {
    const b = p.bot;
    b.goal = goal;
    b.path = p.alive ? findPath(p.x, p.y, goal.x, goal.y) : [{ x: goal.x, y: goal.y }];
    b.pathIdx = 0;
    b.repathAt = 0;
  }

  function arrived(p, goal, range) {
    return Math.hypot(p.x - goal.x, p.y - goal.y) <= range;
  }

  function stepAlong(room, p, dist, doors) {
    const b = p.bot;
    let moved = false;
    while (dist > 0.01 && b.pathIdx < b.path.length) {
      const wp = b.path[b.pathIdx];
      const dx = wp.x - p.x;
      const dy = wp.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.5) { b.pathIdx++; continue; }
      const s = Math.min(d, dist);
      const nx = p.x + (dx / d) * s;
      const ny = p.y + (dy / d) * s;
      if (p.alive && doors.length && MAP.hitsDoor(nx, ny, doors) && !MAP.hitsDoor(p.x, p.y, doors)) break;
      p.x = nx;
      p.y = ny;
      dist -= s;
      moved = true;
    }
    if (moved) emitMove(room, p);
  }

  function create(room) {
    const used = new Set(playersOf(room).map((p) => p.name));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    return { name: free.length ? pick(free) : `crew${Math.floor(rand(10, 99))}` };
  }

  function freshBrain() {
    return {
      goal: null, path: [], pathIdx: 0, repathAt: 0, idleUntil: 0, nextLookAt: 0,
      susp: {}, seen: {}, witness: null, bodyInfo: null, lastTask: null, lastRoom: 'Cafeteria',
      sabKey: null, nextSabAt: 0, ventStep: 0, ventAt: 0, ownKills: new Set(), msgCount: 0, defended: false,
      chatty: rand(0.5, 1), reaction: rand(350, 1300),
    };
  }

  function onGameStart(room) {
    const now = Date.now();
    for (const p of playersOf(room)) {
      if (!p.isBot) continue;
      p.bot = freshBrain();
      p.bot.idleUntil = now + rand(4200, 6500); // sit through the role reveal like everyone else
      p.bot.nextSabAt = now + rand(25000, 55000);
    }
  }

  // ---------- Thinking ----------
  function look(room, p, now, doors) {
    const b = p.bot;
    b.lastRoom = MAP.placeName(p.x, p.y);
    if (!p.alive) return;
    for (const o of playersOf(room)) {
      if (o.id === p.id || !o.alive || o.inVent) continue;
      if (sees(room, p, o.x, o.y, doors)) b.seen[o.id] = { room: MAP.placeName(o.x, o.y), at: now };
    }
    if (b.goal && (b.goal.type === 'report' || b.goal.type === 'vent')) return;
    for (const body of room.bodies) {
      if (!sees(room, p, body.x, body.y, doors)) continue;
      if (p.isImpostor && b.ownKills.has(body.id) && !b.selfReport) continue;
      if (p.isImpostor && !b.ownKills.has(body.id) && Math.random() < 0.5) continue;
      const nearby = playersOf(room).filter((o) => o.id !== p.id && o.alive && !o.inVent
        && Math.hypot(o.x - body.x, o.y - body.y) < 230 && sees(room, p, o.x, o.y, doors));
      b.bodyInfo = { room: MAP.placeName(body.x, body.y), color: body.color, near: nearby.map((o) => o.id) };
      if (!p.isImpostor) for (const o of nearby) bump(p, o.id, 22);
      setGoal(p, { type: 'report', x: body.x, y: body.y, bodyId: body.id, at: 0 });
      return;
    }
  }

  function sabotageGoal(room, p) {
    const b = p.bot;
    const sab = room.sabotage;
    if (!sab || !p.alive) return null;
    if (b.sabKey !== sab) {
      b.sabKey = sab;
      const eager = sab.endsAt ? 0.9 : sab.type === 'lights' ? 0.55 : 0.4;
      b.sabRespond = Math.random() < (p.isImpostor ? 0.25 : eager);
    }
    if (!b.sabRespond) return null;
    let panels = MAP.PANELS.filter((pn) => pn.sabotage === sab.type);
    if (sab.done) panels = panels.filter((pn) => !sab.done[pn.id]);
    if (!panels.length) return null;
    const bots = playersOf(room).filter((o) => o.isBot);
    const panel = panels.length > 1 && sab.endsAt
      ? panels[bots.indexOf(p) % panels.length]
      : panels.reduce((a, c) => (Math.hypot(c.x - p.x, c.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? c : a));
    return { type: 'fix', x: panel.x, y: panel.y + (panel.y < 700 ? 30 : -30), panel, sab, at: 0 };
  }

  function wanderGoal() {
    const r = pick(MAP.ROOMS);
    return { type: 'wander', x: r.x + rand(60, r.w - 60), y: r.y + rand(60, r.h - 60), wait: rand(1500, 5000), at: 0 };
  }

  function crewThink(room, p) {
    const fix = sabotageGoal(room, p);
    if (fix) return setGoal(p, fix);
    const b = p.bot;
    if (p.alive && b.witness && !b.witness.told) {
      b.witness.told = true;
      return setGoal(p, { type: 'button', x: MAP.EMERGENCY.x, y: MAP.EMERGENCY.y + 45, tries: 0, at: 0 });
    }
    const todo = MAP.TASK_SPOTS
      .filter((s) => p.tasksAssigned.includes(s.id) && !p.tasksDone.includes(s.id))
      .sort((s1, s2) => Math.hypot(s1.x - p.x, s1.y - p.y) - Math.hypot(s2.x - p.x, s2.y - p.y));
    if (!todo.length) return setGoal(p, wanderGoal());
    const spot = todo.length > 1 && Math.random() < 0.3 ? todo[1] : todo[0];
    setGoal(p, { type: 'task', x: spot.x, y: spot.y + (spot.y < MAP.roomAt(spot.x, spot.y).y + 80 ? 34 : -6), spot, work: rand(3000, 7500), at: 0 });
  }

  function isolation(room, target) {
    return playersOf(room).filter((o) => o.alive && !o.isImpostor && o.id !== target.id
      && Math.hypot(o.x - target.x, o.y - target.y) < 420).length;
  }

  function impostorThink(room, p, now) {
    const b = p.bot;
    if (!p.alive) return setGoal(p, wanderGoal());
    const fix = sabotageGoal(room, p);
    if (fix) return setGoal(p, fix);
    const crew = playersOf(room).filter((o) => o.alive && !o.isImpostor && !o.inVent);
    if (crew.length && now >= p.killReadyAt - 6000) {
      const target = crew.reduce((best, c) => {
        const score = isolation(room, c) * 500 + Math.hypot(c.x - p.x, c.y - p.y);
        return !best || score < best.score ? { c, score } : best;
      }, null).c;
      return setGoal(p, { type: 'hunt', x: target.x, y: target.y, targetId: target.id, until: now + rand(9000, 16000), at: 0 });
    }
    const spots = [...MAP.TASK_SPOTS].sort((s1, s2) => Math.hypot(s1.x - p.x, s1.y - p.y) - Math.hypot(s2.x - p.x, s2.y - p.y));
    const spot = pick(spots.slice(0, 5));
    setGoal(p, { type: 'fake', x: spot.x, y: spot.y + 30, spot, work: rand(2500, 6000), at: 0 });
  }

  function tryKill(room, p, now, doors) {
    if (!p.alive || p.inVent || now < p.killReadyAt) return false;
    const others = playersOf(room).filter((o) => o.alive && !o.isImpostor && !o.inVent);
    for (const victim of others) {
      if (Math.hypot(victim.x - p.x, victim.y - p.y) > ranges.KILL_RANGE - 12) continue;
      if (!MAP.lineOfSight(p.x, p.y, victim.x, victim.y, doors)) continue;
      const witnessed = others.some((o) => o.id !== victim.id && sees(room, o, p.x, p.y, doors));
      if (witnessed && others.length > 2) continue;
      const before = room.bodies.length;
      act(room, p, 'eliminate', { targetId: victim.id });
      if (room.bodies.length === before) return false;
      const b = p.bot;
      b.ownKills.add(room.bodies[room.bodies.length - 1].id);
      b.selfReport = Math.random() < 0.12;
      const vent = MAP.VENTS.find((v) => Math.hypot(v.x - p.x, v.y - p.y) < 260);
      if (vent && Math.random() < 0.6) {
        setGoal(p, { type: 'vent', x: vent.x, y: vent.y, vent, at: 0 });
      } else {
        const far = MAP.ROOMS.filter((r) => Math.hypot(r.x + r.w / 2 - p.x, r.y + r.h / 2 - p.y) > 500);
        const r = pick(far);
        setGoal(p, { type: 'wander', x: r.x + r.w / 2, y: r.y + r.h / 2, wait: rand(1500, 4000), at: 0 });
      }
      return true;
    }
    return false;
  }

  function maybeSabotage(room, p, now) {
    const b = p.bot;
    if (now < b.nextSabAt) return;
    b.nextSabAt = now + rand(30000, 65000);
    const roll = Math.random();
    if (roll < 0.25) {
      const here = MAP.roomAt(p.x, p.y);
      const roomId = here && MAP.DOOR_ROOMS.includes(here.id) ? here.id : pick(MAP.DOOR_ROOMS);
      return act(room, p, 'sabotage', { type: 'doors', roomId });
    }
    act(room, p, 'sabotage', { type: roll < 0.5 ? 'lights' : roll < 0.7 ? 'reactor' : roll < 0.9 ? 'o2' : 'comms' });
  }

  function runGoal(room, p, now, doors) {
    const b = p.bot;
    const g = b.goal;
    if (g.type === 'hunt') {
      const target = room.players.get(g.targetId);
      if (!target || !target.alive || now > g.until) { b.goal = null; return; }
      if (now >= b.repathAt) {
        b.path = findPath(p.x, p.y, target.x, target.y);
        b.pathIdx = 0;
        b.repathAt = now + 700;
      }
      return;
    }
    if (g.type === 'fix' && room.sabotage !== g.sab) {
      b.goal = null;
      return;
    }
    const reach = g.type === 'report' ? ranges.REPORT_RANGE - 25 : g.type === 'wander' ? 40 : 30;
    if (!arrived(p, g, reach)) {
      // closed door or lost path: give up after a while and pick something else
      if (b.pathIdx >= b.path.length) { g.stuck = (g.stuck || 0) + 1; if (g.stuck > 20) b.goal = null; else setGoal(p, g); }
      return;
    }
    b.path = [];
    if (!g.at) g.at = now;
    const waited = now - g.at;
    switch (g.type) {
      case 'task':
        if (waited >= g.work) {
          act(room, p, 'do-task', { taskId: g.spot.id });
          b.lastTask = g.spot;
          b.goal = null;
          b.idleUntil = now + rand(300, 1600);
        }
        break;
      case 'fake':
        if (waited >= g.work) { b.lastTask = g.spot; b.goal = null; b.idleUntil = now + rand(300, 1200); }
        break;
      case 'wander':
        if (waited >= g.wait) b.goal = null;
        break;
      case 'report':
        if (waited >= b.reaction) {
          act(room, p, 'report-body', { bodyId: g.bodyId });
          b.goal = null;
        }
        break;
      case 'button':
        if (waited >= 600) {
          act(room, p, 'call-meeting', {});
          g.at = now;
          g.tries += 1;
          if (g.tries > 12) b.goal = null;
        }
        break;
      case 'fix': {
        const sab = room.sabotage;
        const panelId = g.panel.id;
        if (sab.type === 'lights' && waited >= 700) {
          const index = sab.switches.indexOf(false);
          g.at = now;
          if (index >= 0) act(room, p, 'fix-sabotage', { panelId, index });
        } else if (sab.type === 'reactor' && !g.holding && waited >= 500) {
          g.holding = true;
          act(room, p, 'fix-sabotage', { panelId, active: true });
        } else if (sab.type === 'o2' && waited >= 2600) {
          act(room, p, 'fix-sabotage', { panelId, code: sab.code });
          b.goal = null;
        } else if (sab.type === 'comms' && waited >= 3200) {
          act(room, p, 'fix-sabotage', { panelId });
        }
        break;
      }
      case 'vent':
        if (b.ventStep === 0) {
          act(room, p, 'vent-enter', { ventId: g.vent.id });
          if (!p.inVent) { b.goal = null; break; }
          b.ventStep = 1;
          b.ventAt = now + rand(1200, 2600);
        }
        break;
    }
  }

  function runVent(room, p, now) {
    const b = p.bot;
    if (now < b.ventAt) return;
    if (b.ventStep === 1) {
      const here = MAP.VENTS.find((v) => v.id === p.inVent);
      const dest = pick(MAP.VENTS.filter((v) => v.group === here.group && v.id !== here.id));
      act(room, p, 'vent-move', { ventId: dest.id });
      b.ventStep = 2;
      b.ventAt = now + rand(1500, 3500);
    } else {
      act(room, p, 'vent-exit', {});
      b.ventStep = 0;
      b.goal = null;
    }
  }

  function tick(room, dt) {
    if (room.state !== 'playing') return;
    const now = Date.now();
    const doors = closedDoors(room, now);
    for (const p of playersOf(room)) {
      if (!p.isBot || !p.bot || room.state !== 'playing') continue;
      const b = p.bot;
      if (p.inVent) { runVent(room, p, now); continue; }
      if (now >= b.nextLookAt) {
        b.nextLookAt = now + 200;
        look(room, p, now, doors);
        if (p.isImpostor) {
          if (tryKill(room, p, now, doors)) continue;
          maybeSabotage(room, p, now);
        }
        // a crisis interrupts whatever they were doing
        if (p.alive && room.sabotage && b.sabKey !== room.sabotage && b.goal && ['task', 'fake', 'wander'].includes(b.goal.type)) {
          const fix = sabotageGoal(room, p);
          if (fix) setGoal(p, fix);
        }
      }
      if (now < b.idleUntil) continue;
      if (!b.goal) {
        if (p.isImpostor) impostorThink(room, p, now); else crewThink(room, p);
        if (!b.goal) continue;
      }
      runGoal(room, p, now, doors);
      if (room.state !== 'playing') return;
      if (b.goal && b.path.length) stepAlong(room, p, 230 * room.settings.speed * dt, doors);
    }
  }

  // ---------- Things bots witness ----------
  function onKill(room, killer, victim) {
    const doors = closedDoors(room, Date.now());
    for (const p of playersOf(room)) {
      if (!p.isBot || !p.bot || !p.alive || p.isImpostor || p.id === victim.id) continue;
      if (!sees(room, p, victim.x, victim.y, doors)) continue;
      p.bot.susp[killer.id] = 100;
      p.bot.witness = { type: 'kill', id: killer.id, victimColor: victim.color, room: MAP.placeName(victim.x, victim.y), told: true };
    }
  }

  function onVent(room, venter) {
    const doors = closedDoors(room, Date.now());
    for (const p of playersOf(room)) {
      if (!p.isBot || !p.bot || !p.alive || p.isImpostor || p.id === venter.id) continue;
      if (!sees(room, p, venter.x, venter.y, doors)) continue;
      p.bot.susp[venter.id] = 100;
      p.bot.witness = { type: 'vent', id: venter.id, room: MAP.placeName(venter.x, venter.y), told: false };
    }
  }

  // ---------- Meetings ----------
  function humanize(text) {
    let t = text.toLowerCase();
    if (Math.random() < 0.12 && t.length > 6) {
      const i = Math.floor(rand(1, t.length - 2));
      t = t.slice(0, i) + t[i + 1] + t[i] + t.slice(i + 2);
    }
    return t;
  }

  function say(room, p, text, delay) {
    const meeting = room.meeting;
    const b = p.bot;
    if (b.msgCount >= 4) return;
    b.msgCount += 1;
    b.sayAt = Math.max(b.sayAt || 0, Date.now()) + delay + text.length * rand(45, 85);
    setTimeout(() => {
      if (room.meeting !== meeting || room.state !== 'meeting' || !p.alive) return;
      if (meeting.phase !== 'discussion' && meeting.phase !== 'voting') return;
      act(room, p, 'chat', { text: humanize(text) });
    }, b.sayAt - Date.now());
  }

  function alibi(room, p) {
    const b = p.bot;
    if (b.lastTask) return pick([`i was in ${b.lastTask.room} doing ${b.lastTask.label}`, `${b.lastTask.room}, was on ${b.lastTask.label}`, `i was at ${b.lastTask.room}`]);
    return pick([`i was in ${b.lastRoom}`, `was walking through ${b.lastRoom}`, `${b.lastRoom}`]);
  }

  function topSuspect(room, p) {
    let best = null;
    for (const [id, score] of Object.entries(p.bot.susp)) {
      const o = room.players.get(id);
      if (!o || !o.alive || o.id === p.id || (p.isImpostor && o.isImpostor)) continue;
      if (!best || score > best.score) best = { player: o, score };
    }
    return best;
  }

  function onMeeting(room) {
    const meeting = room.meeting;
    meeting.accused = {};
    const caller = room.players.get(meeting.callerId);
    for (const p of playersOf(room)) {
      if (!p.isBot || !p.bot) continue;
      const b = p.bot;
      b.goal = null;
      b.path = [];
      b.ventStep = 0;
      b.msgCount = 0;
      b.defended = false;
      b.sayAt = 0;
      if (!p.alive) continue;
      const lines = [];
      const w = b.witness;
      const suspect = w && room.players.get(w.id);
      if (caller === p && meeting.reason === 'report' && b.bodyInfo) {
        lines.push(pick([`body in ${b.bodyInfo.room}`, `found ${COLOR_NAMES[b.bodyInfo.color]} dead in ${b.bodyInfo.room}`, `${b.bodyInfo.room}. ${COLOR_NAMES[b.bodyInfo.color]} is dead`]));
      }
      if (!p.isImpostor && suspect && suspect.alive) {
        lines.push(w.type === 'kill'
          ? pick([`it was ${colorOf(suspect)} i SAW them kill ${COLOR_NAMES[w.victimColor]}`, `${colorOf(suspect)} killed right in front of me in ${w.room}`, `${colorOf(suspect)}!! watched them do it`])
          : pick([`${colorOf(suspect)} VENTED in ${w.room}`, `i saw ${colorOf(suspect)} jump in a vent in ${w.room}`, `${colorOf(suspect)} vented vote them`]));
        meeting.accused[suspect.id] = (meeting.accused[suspect.id] || 0) + 2;
      } else if (caller !== p) {
        const top = topSuspect(room, p);
        const opener = meeting.reason === 'report'
          ? pick(['where?', 'where was the body', 'who died', 'what happened', alibi(room, p)])
          : pick(['who called this', 'why the meeting?', 'whats up', alibi(room, p)]);
        if (Math.random() < b.chatty) lines.push(opener);
        if (!p.isImpostor && top && top.score >= 20 && b.bodyInfo && b.bodyInfo.near.includes(top.player.id)) {
          lines.push(pick([`${colorOf(top.player)} was right next to the body`, `${colorOf(top.player)} kinda sus ngl, was near it`, `i saw ${colorOf(top.player)} around there`]));
          meeting.accused[top.player.id] = (meeting.accused[top.player.id] || 0) + 1;
        } else if (Math.random() < b.chatty * 0.7) {
          const friend = Object.entries(b.seen).map(([id, s]) => ({ o: room.players.get(id), s }))
            .filter((e) => e.o && e.o.alive && Date.now() - e.s.at < 25000)[0];
          lines.push(p.isImpostor
            ? pick([alibi(room, p), 'i didnt see anyone', 'no idea tbh', 'skip if no proof'])
            : friend ? pick([`i was with ${colorOf(friend.o)} in ${friend.s.room}`, `${colorOf(friend.o)} is clear i think, saw them in ${friend.s.room}`])
              : pick([alibi(room, p), 'didnt see anything', 'idk skip?', 'anyone see anything?']));
        }
      } else if (meeting.reason === 'emergency' && !lines.length) {
        lines.push(pick(['someone is acting weird', 'just wanted to check in, anyone sus?']));
      }
      lines.forEach((line, i) => say(room, p, line, i === 0 ? rand(1200, 5500) : rand(2500, 6000)));
      b.bodyInfo = null;
    }
  }

  function onChat(room, sender, text) {
    const meeting = room.meeting;
    if (!meeting || !sender.alive) return;
    const lower = text.toLowerCase();
    const mentioned = playersOf(room).filter((o) => o.alive && o.id !== sender.id
      && (new RegExp(`\\b${COLOR_NAMES[o.color]}\\b`).test(lower) || lower.includes(o.name.toLowerCase())));
    const accusing = /(sus|saw|vent|kill|vote|it was|its |imp|lying|liar|fake)/.test(lower) && !/(clear|safe|not sus|with me|innocent)/.test(lower);
    const strong = /(saw|vent|kill)/.test(lower);
    const asksWhere = /\bwhere\b/.test(lower);
    const bots = playersOf(room).filter((p) => p.isBot && p.bot && p.alive && p.id !== sender.id);

    if (accusing) {
      for (const target of mentioned) {
        meeting.accused[target.id] = (meeting.accused[target.id] || 0) + (strong ? 2 : 1);
        for (const p of bots) {
          const b = p.bot;
          if (p.id === target.id) {
            if (b.defended) continue;
            b.defended = true;
            const mine = b.susp[sender.id] || 0;
            if (!p.isImpostor) bump(p, sender.id, 20);
            say(room, p, pick(p.isImpostor
              ? [`not me lol. ${alibi(room, p)}`, `why me?? ${colorOf(sender)} is just trying to frame me`, `${colorOf(sender)} is lying`, `no?? ${alibi(room, p)}`]
              : [`wasnt me, ${alibi(room, p)}`, `what no. ${alibi(room, p)}`, mine > 30 ? `thats cap, ${colorOf(sender)} is the sus one` : 'bro i was doing tasks']), rand(900, 2600));
          } else if (!p.isImpostor) {
            if ((b.susp[sender.id] || 0) < 60) bump(p, target.id, strong ? 35 : 14);
            if (!sender.isBot && Math.random() < 0.3) {
              say(room, p, pick(strong ? [`ok voting ${colorOf(target)}`, `wait fr? ${colorOf(target)}`, `i believe it, ${colorOf(target)} was acting weird`] : ['any proof?', `why ${colorOf(target)}`, 'hmm maybe']), rand(1200, 4000));
            }
          } else if (!target.isImpostor && Math.random() < 0.35) {
            say(room, p, pick([`yeah ${colorOf(target)} is sus`, `i can see it being ${colorOf(target)}`, `vote ${colorOf(target)}`]), rand(1500, 4500));
          }
        }
      }
    }
    if (asksWhere && !sender.isBot) {
      const responder = bots.find((p) => p.id === meeting.callerId) || pick(bots);
      if (responder) say(room, responder, responder.id === meeting.callerId && meeting.where ? meeting.where : alibi(room, responder), rand(800, 2500));
    }
  }

  function onVoting(room) {
    const meeting = room.meeting;
    const votingMs = room.settings.votingTime * 1000;
    for (const p of playersOf(room)) {
      if (!p.isBot || !p.bot || !p.alive) continue;
      setTimeout(() => {
        if (room.meeting !== meeting || meeting.phase !== 'voting' || !p.alive) return;
        let targetId = 'skip';
        if (p.isImpostor) {
          const blamed = Object.entries(meeting.accused)
            .map(([id, n]) => ({ o: room.players.get(id), n }))
            .filter((e) => e.o && e.o.alive && !e.o.isImpostor)
            .sort((a, b) => b.n - a.n)[0];
          if (blamed) targetId = blamed.o.id;
          else if (Math.random() < 0.3) {
            const crew = playersOf(room).filter((o) => o.alive && !o.isImpostor);
            if (crew.length) targetId = pick(crew).id;
          }
        } else {
          const top = topSuspect(room, p);
          if (top && (top.score >= 60 || (top.score >= 30 && Math.random() < 0.55))) targetId = top.player.id;
        }
        act(room, p, 'cast-vote', { targetId });
      }, Math.min(votingMs * 0.7, rand(3500, 16000)));
    }
  }

  return { create, onGameStart, tick, onKill, onVent, onMeeting, onChat, onVoting };
};
