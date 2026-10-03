// Task and sabotage minigames. Each builder fills the modal body, calls finish() on success,
// and may return { cleanup, update } hooks.
const taskModal = document.getElementById('task-modal');
const taskTitle = document.getElementById('task-title');
const taskBody = document.getElementById('task-body');
let activeGame = null; // { kind, id, cleanup, update }

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shuffled(list) {
  return [...list].sort(() => Math.random() - 0.5);
}

const MINIGAMES = {
  // Drag each wire on the left to the matching colour on the right.
  wires(body, finish) {
    const NS = 'http://www.w3.org/2000/svg';
    const colors = ['#e2231a', '#3b5bdb', '#f5d63c', '#ed54ba'];
    const left = shuffled(colors);
    const right = shuffled(colors);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 420 280');
    svg.setAttribute('class', 'tg-wires');
    const yOf = (i) => 44 + i * 64;
    const mk = (tag, attrs) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      svg.appendChild(n);
      return n;
    };
    let drag = null;
    let connected = 0;
    const toLocal = (e) => {
      const r = svg.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * 420, y: ((e.clientY - r.top) / r.height) * 280 };
    };
    right.forEach((color, i) => mk('rect', { x: 380, y: yOf(i) - 14, width: 40, height: 28, fill: color, stroke: '#0a0d14', 'stroke-width': 3 }));
    left.forEach((color, i) => {
      const node = mk('rect', { x: 0, y: yOf(i) - 14, width: 40, height: 28, fill: color, stroke: '#0a0d14', 'stroke-width': 3, style: 'cursor:grab' });
      node.addEventListener('pointerdown', (e) => {
        if (node.dataset.done) return;
        const line = mk('line', { x1: 40, y1: yOf(i), x2: 40, y2: yOf(i), stroke: color, 'stroke-width': 12, 'stroke-linecap': 'round', 'pointer-events': 'none' });
        drag = { color, line, node };
        e.preventDefault();
      });
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = toLocal(e);
      drag.line.setAttribute('x2', p.x);
      drag.line.setAttribute('y2', p.y);
    });
    const release = (e) => {
      if (!drag) return;
      const p = toLocal(e);
      const idx = right.findIndex((_, i) => p.x > 350 && Math.abs(p.y - yOf(i)) < 26);
      if (idx >= 0 && right[idx] === drag.color) {
        drag.line.setAttribute('x2', 380);
        drag.line.setAttribute('y2', yOf(idx));
        drag.node.dataset.done = '1';
        connected += 1;
        if (connected === colors.length) finish();
      } else {
        drag.line.remove();
      }
      drag = null;
    };
    svg.addEventListener('pointerup', release);
    svg.addEventListener('pointerleave', release);
    body.appendChild(svg);
  },

  // Hold the button until the bar fills.
  hold(body, finish, o) {
    const bar = el('div', 'tg-bar');
    const fill = el('div');
    bar.appendChild(fill);
    const btn = el('button', 'tg-big', o.verb || 'HOLD');
    let held = false;
    let progress = 0;
    btn.addEventListener('pointerdown', () => { held = true; });
    const up = () => { held = false; };
    window.addEventListener('pointerup', up);
    const timer = setInterval(() => {
      progress = Math.max(0, Math.min(1, progress + (held ? 0.02 : -0.03)));
      fill.style.width = `${progress * 100}%`;
      if (progress >= 1) finish();
    }, 50);
    body.append(el('p', '', o.hint || 'Hold the button until it is done.'), bar, btn);
    return { cleanup() { clearInterval(timer); window.removeEventListener('pointerup', up); } };
  },

  // Shoot the asteroids drifting across the screen.
  targets(body, finish) {
    const field = el('div', 'tg-field');
    const msg = el('p', 'tg-msg', 'Destroyed: 0 / 8');
    let hits = 0;
    const spawn = () => {
      const rock = el('button', 'tg-asteroid');
      const fromLeft = Math.random() < 0.5;
      rock.style.top = `${Math.random() * 220}px`;
      rock.style.left = fromLeft ? '-50px' : '430px';
      rock.style.transition = 'left 3.2s linear, top 3.2s linear';
      field.appendChild(rock);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        rock.style.left = fromLeft ? '430px' : '-50px';
        rock.style.top = `${Math.random() * 220}px`;
      }));
      rock.addEventListener('pointerdown', () => {
        rock.remove();
        hits += 1;
        msg.textContent = `Destroyed: ${hits} / 8`;
        if (hits >= 8) finish();
      });
      setTimeout(() => rock.remove(), 3300);
    };
    const timer = setInterval(spawn, 550);
    spawn();
    body.append(field, msg);
    return { cleanup() { clearInterval(timer); } };
  },

  // Click every red tile.
  toggle(body, finish, o) {
    const grid = el('div', 'tg-grid');
    grid.style.gridTemplateColumns = 'repeat(4, 68px)';
    let left = 0;
    for (let i = 0; i < 8; i++) {
      const bad = i === 0 || Math.random() < 0.6;
      const btn = el('button', `tg-hex ${bad ? 'bad' : 'ok'}`);
      if (bad) left += 1;
      btn.addEventListener('click', () => {
        if (!btn.classList.contains('bad')) return;
        btn.classList.replace('bad', 'ok');
        left -= 1;
        if (left === 0) finish();
      });
      grid.appendChild(btn);
    }
    body.append(el('p', '', o.hint || 'Click every red panel.'), grid);
  },

  // Press the numbers in order.
  sequence(body, finish, o) {
    const count = o.count || 10;
    const grid = el('div', 'tg-grid');
    grid.style.gridTemplateColumns = 'repeat(5, 68px)';
    let next = 1;
    const buttons = shuffled(Array.from({ length: count }, (_, i) => i + 1)).map((n) => {
      const btn = el('button', '', String(n));
      btn.addEventListener('click', () => {
        if (n === next) {
          btn.classList.add('ok');
          next += 1;
          if (next > count) finish();
        } else {
          next = 1;
          buttons.forEach((b) => b.classList.remove('ok'));
        }
      });
      grid.appendChild(btn);
      return btn;
    });
    body.append(el('p', '', `Press 1 to ${count} in order.`), grid);
  },

  // Start it and wait.
  progress(body, finish, o) {
    const bar = el('div', 'tg-bar');
    const fill = el('div');
    bar.appendChild(fill);
    const msg = el('p', 'tg-msg', o.hint || 'Press start and wait.');
    const btn = el('button', 'tg-big green', o.verb || 'START');
    let timer = null;
    btn.addEventListener('click', () => {
      if (timer) return;
      btn.disabled = true;
      let p = 0;
      timer = setInterval(() => {
        p += 0.0125;
        fill.style.width = `${Math.min(100, p * 100)}%`;
        msg.textContent = `${Math.min(100, Math.round(p * 100))}%`;
        if (p >= 1) finish();
      }, 80);
    });
    body.append(msg, bar, btn);
    return { cleanup() { clearInterval(timer); } };
  },

  // Swipe the card: not too fast, not too slow.
  swipe(body, finish) {
    const slot = el('div', 'tg-slot');
    const card = el('div', 'tg-card');
    const msg = el('p', 'tg-msg', 'Swipe the card to the right.');
    slot.appendChild(card);
    let startX = 0;
    let startT = 0;
    let dragging = false;
    const MAX = 290;
    card.addEventListener('pointerdown', (e) => {
      dragging = true;
      startX = e.clientX;
      startT = performance.now();
      card.setPointerCapture(e.pointerId);
    });
    card.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      card.style.left = `${6 + Math.max(0, Math.min(MAX, e.clientX - startX))}px`;
    });
    card.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      const dist = e.clientX - startX;
      const took = performance.now() - startT;
      if (dist < MAX - 10) msg.textContent = 'Bad read. Swipe all the way.';
      else if (took < 350) msg.textContent = 'Too fast. Try again.';
      else if (took > 1500) msg.textContent = 'Too slow. Try again.';
      else { msg.textContent = 'Accepted. Thank you.'; return finish(); }
      card.style.left = '6px';
    });
    body.append(msg, slot);
  },

  // Drag the slider into the green zone.
  slider(body, finish, o) {
    const wrap = el('div', 'tg-range');
    const target = 15 + Math.floor(Math.random() * 70);
    const zone = el('div', 'zone');
    zone.style.left = `${target}%`;
    const input = el('input');
    input.type = 'range';
    input.min = 0;
    input.max = 100;
    input.value = target > 50 ? 0 : 100;
    input.addEventListener('change', () => {
      if (Math.abs(Number(input.value) - target) <= 5) finish();
    });
    wrap.append(zone, input);
    body.append(el('p', '', o.hint || 'Slide the lever to the green mark and let go.'), wrap);
  },

  // Hit the button while the marker is in the green zone, three times.
  timing(body, finish) {
    const track = el('div', 'tg-track');
    const zone = el('div', 'zone');
    const mark = el('div', 'mark');
    track.append(zone, mark);
    const msg = el('p', 'tg-msg', 'Hits: 0 / 3');
    const btn = el('button', 'tg-big green', 'NOW');
    let hits = 0;
    let zoneAt = 0;
    let pos = 0;
    const place = () => {
      zoneAt = 10 + Math.random() * 62;
      zone.style.left = `${zoneAt}%`;
      zone.style.width = '18%';
    };
    place();
    const t0 = performance.now();
    const timer = setInterval(() => {
      pos = 50 + 50 * Math.sin((performance.now() - t0) / 420);
      mark.style.left = `${pos}%`;
    }, 16);
    btn.addEventListener('pointerdown', () => {
      if (pos >= zoneAt && pos <= zoneAt + 18) {
        hits += 1;
        if (hits >= 3) return finish();
        place();
      } else {
        hits = 0;
      }
      msg.textContent = `Hits: ${hits} / 3`;
    });
    body.append(el('p', '', 'Press NOW while the marker is in the green.'), track, msg, btn);
    return { cleanup() { clearInterval(timer); } };
  },

  // ---- Sabotage fixes: these talk to the server through o.send ----
  switches(body, finish, o) {
    const row = el('div', 'tg-switches');
    const buttons = [0, 1, 2, 3, 4].map((i) => {
      const btn = el('button', 'tg-switch');
      btn.addEventListener('click', () => o.send({ index: i }));
      row.appendChild(btn);
      return btn;
    });
    const update = (sab) => {
      if (!sab || !sab.switches) return;
      sab.switches.forEach((on, i) => buttons[i].classList.toggle('on', on));
    };
    update(o.sabotage);
    body.append(el('p', '', 'Flip every switch up to restore the lights.'), row);
    return { update };
  },

  keypad(body, finish, o) {
    const note = el('div', 'tg-note', o.sabotage.code);
    const display = el('div', 'tg-display', '');
    const keys = el('div', 'tg-keys');
    let typed = '';
    const press = (k) => {
      if (k === 'C') typed = '';
      else if (k === 'OK') { o.send({ code: typed }); typed = ''; } else if (typed.length < 5) typed += k;
      display.textContent = typed;
    };
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK']) {
      const btn = el('button', '', k);
      btn.addEventListener('click', () => press(k));
      keys.appendChild(btn);
    }
    const msg = el('p', 'tg-msg', "Enter today's code.");
    body.append(note, display, keys, msg);
    return {
      update(sab) {
        if (sab && sab.done && sab.done[o.panelId]) {
          msg.textContent = 'Accepted! Now the other keypad needs the code too.';
          keys.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        }
      },
    };
  },

  reactorHold(body, finish, o) {
    const btn = el('button', 'tg-big', 'HOLD');
    const msg = el('p', 'tg-msg', 'Hold your hand on the scanner.');
    let held = false;
    btn.addEventListener('pointerdown', () => {
      held = true;
      btn.classList.add('green');
      msg.textContent = 'Holding. Waiting for the second scanner.';
      o.send({ active: true });
    });
    const up = () => {
      if (!held) return;
      held = false;
      btn.classList.remove('green');
      msg.textContent = 'Hold your hand on the scanner.';
      o.send({ active: false });
    };
    window.addEventListener('pointerup', up);
    body.append(msg, btn);
    return { cleanup() { up(); window.removeEventListener('pointerup', up); } };
  },
};

function openMinigame(game, title, opts, onDone) {
  closeMinigame();
  taskTitle.textContent = title;
  taskBody.innerHTML = '';
  taskModal.classList.remove('hidden');
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onDone();
    setTimeout(() => { if (activeGame === handle) closeMinigame(); }, 450);
  };
  const hooks = MINIGAMES[game](taskBody, finish, opts || {}) || {};
  const handle = { kind: opts.kind || 'task', id: opts.id, cleanup: hooks.cleanup, update: hooks.update };
  activeGame = handle;
  return handle;
}

function closeMinigame() {
  if (!activeGame) return;
  const game = activeGame;
  activeGame = null;
  if (game.cleanup) game.cleanup();
  taskModal.classList.add('hidden');
  taskBody.innerHTML = '';
}

document.getElementById('task-close').addEventListener('click', closeMinigame);
