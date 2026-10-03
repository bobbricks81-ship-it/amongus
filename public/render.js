// Drawing helpers. Every function takes the 2D context it draws into so the main view,
// security cameras, minimap and UI icons can all share them.
const MAP = window.GAME_MAP;

const COLORS = [
  { name: 'Red', hex: '#c51111', shade: '#7a0838' },
  { name: 'Blue', hex: '#132ed1', shade: '#09158e' },
  { name: 'Green', hex: '#117f2d', shade: '#0a4d2e' },
  { name: 'Pink', hex: '#ed54ba', shade: '#ab2bad' },
  { name: 'Orange', hex: '#ef7d0d', shade: '#b33e15' },
  { name: 'Yellow', hex: '#f5f557', shade: '#c38823' },
  { name: 'Black', hex: '#3f474e', shade: '#1e1f26' },
  { name: 'White', hex: '#d6e0f0', shade: '#8394bf' },
  { name: 'Purple', hex: '#6b2fbb', shade: '#3b177c' },
  { name: 'Brown', hex: '#71491e', shade: '#5e2615' },
  { name: 'Cyan', hex: '#38fedc', shade: '#24a8be' },
  { name: 'Lime', hex: '#50ef39', shade: '#15a742' },
];

const OUTLINE = '#0a0a0a';
const TILE = 50;

function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// ---------- Crewmates ----------
// o: { facing: 1|-1, moving, phase, ghost, scale }
function drawCrewmate(c, x, y, colorIdx, o = {}) {
  const col = COLORS[colorIdx] || COLORS[0];
  const bob = o.moving ? Math.abs(Math.sin(o.phase)) * -2 : 0;
  const swing = o.moving ? Math.sin(o.phase) * 5 : 0;
  c.save();
  c.translate(x, y);
  c.scale((o.scale || 1) * (o.facing === -1 ? -1 : 1), o.scale || 1);
  if (o.ghost) c.globalAlpha *= 0.5;
  c.lineJoin = 'round';
  c.lineWidth = 3;
  c.strokeStyle = OUTLINE;

  if (!o.ghost) {
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.beginPath();
    c.ellipse(0, 24, 17, 5, 0, 0, Math.PI * 2);
    c.fill();
    // legs
    c.fillStyle = col.shade;
    rr(c, -13, 8, 11, 15 + swing * 0.5, 4); c.fill(); c.stroke();
    c.fillStyle = col.hex;
    rr(c, 2, 8, 11, 15 - swing * 0.5, 4); c.fill(); c.stroke();
  }

  c.translate(0, bob);
  // backpack
  c.fillStyle = col.shade;
  rr(c, -24, -10, 12, 24, 5); c.fill(); c.stroke();
  // body
  c.fillStyle = col.hex;
  rr(c, -15, -26, 30, o.ghost ? 46 : 40, 14); c.fill();
  c.save();
  c.clip();
  c.fillStyle = col.shade;
  c.fillRect(-15, 4, 30, 20);
  c.fillRect(-15, -26, 7, 50);
  c.restore();
  rr(c, -15, -26, 30, o.ghost ? 46 : 40, 14); c.stroke();
  // visor
  c.fillStyle = '#4b6f80';
  rr(c, -3, -19, 22, 14, 7); c.fill();
  c.fillStyle = '#95cadc';
  rr(c, -1, -19, 20, 10, 5); c.fill();
  c.fillStyle = '#fff';
  rr(c, 7, -17, 9, 3.5, 1.7); c.fill();
  rr(c, -3, -19, 22, 14, 7); c.stroke();
  c.restore();
}

function drawBody(c, x, y, colorIdx) {
  const col = COLORS[colorIdx] || COLORS[0];
  c.save();
  c.translate(x, y);
  c.lineJoin = 'round';
  c.lineWidth = 3;
  c.strokeStyle = OUTLINE;
  c.fillStyle = 'rgba(120,0,0,0.45)';
  c.beginPath(); c.ellipse(0, 20, 26, 8, 0, 0, Math.PI * 2); c.fill();
  // bone
  c.fillStyle = '#f2f2f2';
  rr(c, -3, -18, 6, 20, 2); c.fill(); c.stroke();
  c.beginPath(); c.arc(-4, -19, 4.5, 0, Math.PI * 2); c.fill(); c.stroke();
  c.beginPath(); c.arc(4, -19, 4.5, 0, Math.PI * 2); c.fill(); c.stroke();
  // lower half
  c.fillStyle = col.shade;
  rr(c, -24, -2, 12, 18, 5); c.fill(); c.stroke();
  rr(c, -13, 8, 11, 14, 4); c.fill(); c.stroke();
  c.fillStyle = col.hex;
  rr(c, 2, 8, 11, 14, 4); c.fill(); c.stroke();
  rr(c, -15, -6, 30, 22, 8); c.fill(); c.stroke();
  c.fillStyle = '#8a0f0f';
  c.beginPath(); c.ellipse(0, -5, 12, 4, 0, 0, Math.PI * 2); c.fill(); c.stroke();
  c.restore();
}

function drawName(c, x, y, name, color) {
  c.save();
  c.font = "800 15px 'Baloo 2', 'Trebuchet MS', sans-serif";
  c.textAlign = 'center';
  c.lineJoin = 'round';
  c.lineWidth = 4;
  c.strokeStyle = '#000';
  c.strokeText(name, x, y);
  c.fillStyle = color || '#fff';
  c.fillText(name, x, y);
  c.restore();
}

const iconCache = new Map();
// Data-URL portrait used by lobby lists, vote cards and splash screens.
function crewIcon(colorIdx) {
  if (iconCache.has(colorIdx)) return iconCache.get(colorIdx);
  const cv = document.createElement('canvas');
  cv.width = 100;
  cv.height = 120;
  drawCrewmate(cv.getContext('2d'), 54, 62, colorIdx, { scale: 2 });
  const url = cv.toDataURL();
  iconCache.set(colorIdx, url);
  return url;
}

// ---------- Ship ----------
function drawFloorRect(c, r, color) {
  c.fillStyle = color;
  c.fillRect(r.x, r.y, r.w, r.h);
  c.strokeStyle = 'rgba(0,0,0,0.13)';
  c.lineWidth = 2;
  c.beginPath();
  for (let x = Math.ceil(r.x / TILE) * TILE; x < r.x + r.w; x += TILE) { c.moveTo(x, r.y); c.lineTo(x, r.y + r.h); }
  for (let y = Math.ceil(r.y / TILE) * TILE; y < r.y + r.h; y += TILE) { c.moveTo(r.x, y); c.lineTo(r.x + r.w, y); }
  c.stroke();
}

// Furniture: purely decorative, hugging walls so it never looks walk-through.
const DECOR = [
  // engines
  { x: 170, y: 190, w: 70, h: 60, color: '#b5651d', label: '' }, { x: 170, y: 350, w: 70, h: 80, color: '#b5651d' },
  { x: 170, y: 1060, w: 70, h: 70, color: '#b5651d' }, { x: 170, y: 1230, w: 70, h: 80, color: '#b5651d' },
  // reactor core
  { x: 26, y: 690, w: 30, h: 120, color: '#49c6e5' },
  // medbay beds
  { x: 590, y: 420, w: 80, h: 40, color: '#e6eef2' }, { x: 750, y: 420, w: 80, h: 40, color: '#e6eef2' },
  { x: 590, y: 500, w: 40, h: 80, color: '#e6eef2' },
  // electrical cabinets
  { x: 690, y: 884, w: 80, h: 22, color: '#4b4f38' }, { x: 610, y: 1040, w: 24, h: 70, color: '#4b4f38' },
  // storage crates
  { x: 1080, y: 1120, w: 90, h: 90, color: '#a9753c' }, { x: 1170, y: 1180, w: 60, h: 60, color: '#8a5c2b' },
  { x: 970, y: 1000, w: 50, h: 60, color: '#58708a' },
  // security monitors
  { x: 404, y: 664, w: 60, h: 24, color: '#27303f' },
  // comms desk
  { x: 1560, y: 1310, w: 70, h: 40, color: '#3d4d5c' },
  // weapons seat, shields emitters
  { x: 1900, y: 300, w: 80, h: 60, color: '#39455c' },
  { x: 1710, y: 1050, w: 50, h: 50, color: '#d94a4a' }, { x: 1710, y: 1250, w: 50, h: 50, color: '#d94a4a' },
  // navigation seats
  { x: 2270, y: 600, w: 60, h: 40, color: '#2f4666' }, { x: 2270, y: 780, w: 60, h: 40, color: '#2f4666' },
  // o2 tanks
  { x: 1570, y: 640, w: 30, h: 50, color: '#d7e3e0' }, { x: 1610, y: 640, w: 30, h: 50, color: '#d7e3e0' },
];

function drawShip(c, doors) {
  const all = MAP.CORRIDORS.concat(MAP.ROOMS);
  c.save();
  c.lineJoin = 'round';
  c.strokeStyle = OUTLINE;
  c.lineWidth = 46;
  for (const r of all) c.strokeRect(r.x, r.y, r.w, r.h);
  c.strokeStyle = '#8f9aa8';
  c.lineWidth = 34;
  for (const r of all) c.strokeRect(r.x, r.y, r.w, r.h);
  c.strokeStyle = '#5d6877';
  c.lineWidth = 14;
  for (const r of all) c.strokeRect(r.x, r.y, r.w, r.h);
  for (const r of MAP.CORRIDORS) drawFloorRect(c, r, '#5b6370');
  for (const r of MAP.ROOMS) drawFloorRect(c, r, r.color);

  // room names stencilled on the floor
  c.font = "800 26px 'Baloo 2', 'Trebuchet MS', sans-serif";
  c.textAlign = 'center';
  c.fillStyle = 'rgba(0,0,0,0.2)';
  for (const r of MAP.ROOMS) c.fillText(r.name.toUpperCase(), r.x + r.w / 2, r.y + r.h - 16);

  c.lineWidth = 3;
  c.strokeStyle = OUTLINE;
  for (const d of DECOR) {
    c.fillStyle = d.color;
    rr(c, d.x, d.y, d.w, d.h, 6); c.fill(); c.stroke();
  }

  // cafeteria tables
  for (const t of MAP.TABLES.concat([MAP.EMERGENCY])) {
    c.fillStyle = 'rgba(0,0,0,0.2)';
    c.beginPath(); c.arc(t.x + 4, t.y + 6, 50, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#3f8fc4';
    c.beginPath(); c.arc(t.x, t.y, 50, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = '#5fb0e0';
    c.beginPath(); c.arc(t.x, t.y, 38, 0, Math.PI * 2); c.fill();
  }
  // emergency button
  const e = MAP.EMERGENCY;
  c.fillStyle = '#cfd6df';
  c.beginPath(); c.arc(e.x, e.y, 22, 0, Math.PI * 2); c.fill(); c.stroke();
  c.fillStyle = '#e2231a';
  c.beginPath(); c.arc(e.x, e.y - 3, 14, 0, Math.PI * 2); c.fill(); c.stroke();

  // admin table + security console
  const a = MAP.ADMIN_TABLE;
  c.fillStyle = '#2f5d43';
  rr(c, a.x - 50, a.y - 28, 100, 56, 10); c.fill(); c.stroke();
  c.fillStyle = '#6ff06a';
  rr(c, a.x - 38, a.y - 18, 76, 36, 6); c.fill();
  const s = MAP.SECURITY_CONSOLE;
  c.fillStyle = '#27303f';
  rr(c, s.x - 28, s.y - 20, 56, 40, 6); c.fill(); c.stroke();
  c.fillStyle = '#7fd4ff';
  c.fillRect(s.x - 20, s.y - 13, 18, 11); c.fillRect(s.x + 2, s.y - 13, 18, 11);
  c.fillRect(s.x - 20, s.y + 2, 18, 11); c.fillRect(s.x + 2, s.y + 2, 18, 11);

  for (const v of MAP.VENTS) {
    c.fillStyle = '#6f7885';
    rr(c, v.x - 22, v.y - 15, 44, 30, 6); c.fill(); c.stroke();
    c.beginPath();
    for (let i = -8; i <= 8; i += 8) { c.moveTo(v.x - 16, v.y + i); c.lineTo(v.x + 16, v.y + i); }
    c.stroke();
  }

  for (const d of doors || []) {
    c.fillStyle = '#39424f';
    c.fillRect(d.x, d.y, d.w, d.h);
    c.strokeRect(d.x, d.y, d.w, d.h);
    c.fillStyle = '#f5d63c';
    if (d.w > d.h) for (let x = d.x + 10; x < d.x + d.w - 10; x += 26) c.fillRect(x, d.y + 8, 14, d.h - 16);
    else for (let y = d.y + 10; y < d.y + d.h - 10; y += 26) c.fillRect(d.x + 8, y, d.w - 16, 14);
  }
  c.restore();
}

function drawTaskIcon(c, icon) {
  c.strokeStyle = '#e9edf5';
  c.fillStyle = '#e9edf5';
  c.lineWidth = 2.5;
  switch (icon) {
    case 'wiring':
      c.strokeStyle = '#ff5b5b'; c.beginPath(); c.moveTo(-12, -10); c.quadraticCurveTo(0, 4, -12, 11); c.stroke();
      c.strokeStyle = '#6ff06a'; c.beginPath(); c.moveTo(-3, -12); c.quadraticCurveTo(7, 0, -3, 12); c.stroke();
      c.strokeStyle = '#6aa5ff'; c.beginPath(); c.moveTo(7, -10); c.quadraticCurveTo(15, 0, 7, 9); c.stroke();
      break;
    case 'reactor':
      c.beginPath(); c.arc(0, 0, 11, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(0, 0, 3, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(0, 0); c.lineTo(7, -7); c.stroke();
      break;
    case 'o2':
      rr(c, -7, -11, 14, 23, 4); c.stroke();
      c.strokeRect(-3, -15, 6, 4);
      break;
    case 'navigation':
      c.beginPath(); c.arc(0, 0, 12, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(6, -8); c.lineTo(2, 2); c.lineTo(-6, 8); c.lineTo(-2, -2); c.closePath(); c.fill();
      break;
    case 'medbay':
      c.lineWidth = 5;
      c.beginPath(); c.moveTo(0, -11); c.lineTo(0, 11); c.moveTo(-11, 0); c.lineTo(11, 0); c.stroke();
      break;
    case 'electrical':
      c.beginPath(); c.moveTo(3, -13); c.lineTo(-7, 2); c.lineTo(0, 2); c.lineTo(-3, 13); c.lineTo(8, -3); c.lineTo(1, -3); c.closePath(); c.fill();
      break;
    case 'cafeteria':
      c.beginPath(); c.moveTo(-9, -8); c.lineTo(-7, 12); c.lineTo(7, 12); c.lineTo(9, -8); c.closePath(); c.stroke();
      c.beginPath(); c.moveTo(-12, -9); c.lineTo(12, -9); c.moveTo(-3, -13); c.lineTo(3, -13); c.stroke();
      break;
    case 'shield':
      c.beginPath(); c.moveTo(0, -13); c.lineTo(11, -8); c.lineTo(9, 5); c.lineTo(0, 13); c.lineTo(-9, 5); c.lineTo(-11, -8); c.closePath(); c.stroke();
      break;
    case 'download':
      c.beginPath(); c.moveTo(0, -12); c.lineTo(0, 4); c.moveTo(-7, -2); c.lineTo(0, 5); c.lineTo(7, -2); c.moveTo(-11, 11); c.lineTo(11, 11); c.stroke();
      break;
    case 'card':
      rr(c, -13, -9, 26, 18, 3); c.stroke();
      c.fillRect(-13, -4, 26, 5);
      break;
    case 'engine':
      c.beginPath(); c.arc(0, 0, 7, 0, Math.PI * 2); c.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        c.beginPath(); c.moveTo(Math.cos(a) * 9, Math.sin(a) * 9); c.lineTo(Math.cos(a) * 13, Math.sin(a) * 13); c.stroke();
      }
      break;
    default:
      c.beginPath(); c.arc(0, 0, 9, 0, Math.PI * 2); c.stroke();
  }
}

// highlightIds: task ids to outline in yellow. activePanels: sabotage panels to show.
function drawStations(c, highlightIds, activePanels, time) {
  const pulse = 0.5 + 0.5 * Math.sin(time / 200);
  for (const spot of MAP.TASK_SPOTS) {
    const mine = highlightIds.has(spot.id);
    c.save();
    c.translate(spot.x, spot.y);
    if (mine) { c.shadowColor = '#f5d63c'; c.shadowBlur = 10 + pulse * 16; }
    c.fillStyle = '#2a3140';
    c.strokeStyle = mine ? '#f5d63c' : OUTLINE;
    c.lineWidth = mine ? 4 : 3;
    rr(c, -24, -21, 48, 42, 8); c.fill(); c.stroke();
    c.shadowBlur = 0;
    drawTaskIcon(c, spot.icon);
    c.restore();
  }
  for (const p of activePanels) {
    c.save();
    c.translate(p.x, p.y);
    c.shadowColor = '#ff2a1f';
    c.shadowBlur = 10 + pulse * 20;
    c.fillStyle = '#e2231a';
    c.strokeStyle = OUTLINE;
    c.lineWidth = 3;
    rr(c, -22, -22, 44, 44, 8); c.fill(); c.stroke();
    c.shadowBlur = 0;
    c.fillStyle = '#fff';
    c.font = '800 30px sans-serif';
    c.textAlign = 'center';
    c.fillText('!', 0, 11);
    c.restore();
  }
}

// ---------- Vision ----------
// Returns a flat [x0, y0, x1, y1, ...] polygon of what can be seen from (px, py).
function computeVisibility(px, py, radius, doors) {
  const RAYS = 300;
  const STEP = 8;
  const pts = new Array(RAYS * 2);
  for (let i = 0; i < RAYS; i++) {
    const a = (i / RAYS) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let d = 0;
    let hit = false;
    while (d < radius) {
      const nd = Math.min(radius, d + STEP);
      if (!MAP.pointOpen(px + dx * nd, py + dy * nd, doors)) { hit = true; break; }
      d = nd;
    }
    if (hit) {
      let lo = d;
      let hi = d + STEP;
      for (let k = 0; k < 3; k++) {
        const mid = (lo + hi) / 2;
        if (MAP.pointOpen(px + dx * mid, py + dy * mid, doors)) lo = mid; else hi = mid;
      }
      d = Math.min(radius, lo + 20); // spill onto the wall face so walls stay lit
    }
    pts[i * 2] = px + dx * d;
    pts[i * 2 + 1] = py + dy * d;
  }
  return pts;
}

function tracePolygon(c, pts) {
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
}

const STARS = Array.from({ length: 220 }, (_, i) => ({
  x: (i * 7919) % 2600, y: (i * 104729) % 1600, s: 1 + ((i * 31) % 10) / 6,
}));

function drawStars(c, w, h, camX, camY) {
  c.fillStyle = '#05070c';
  c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(255,255,255,0.75)';
  for (const s of STARS) {
    const x = (((s.x - camX * 0.2) % 2600) + 2600) % 2600;
    const y = (((s.y - camY * 0.2) % 1600) + 1600) % 1600;
    if (x < w && y < h) c.fillRect(x, y, s.s, s.s);
  }
}

// ---------- Minimap ----------
// o: { me: {x, y, color}, taskIds: Set, panels: [], counts: {roomId: n} }
function drawMiniMap(c, w, h, o) {
  const s = w / MAP.WORLD_W;
  c.clearRect(0, 0, w, h);
  c.fillStyle = '#0c1220';
  c.fillRect(0, 0, w, h);
  c.save();
  c.scale(s, s);
  c.fillStyle = '#2a6f97';
  for (const r of MAP.CORRIDORS) c.fillRect(r.x, r.y, r.w, r.h);
  c.fillStyle = '#3f9bd1';
  for (const r of MAP.ROOMS) c.fillRect(r.x, r.y, r.w, r.h);
  c.textAlign = 'center';
  c.font = "800 36px 'Baloo 2', 'Trebuchet MS', sans-serif";
  for (const r of MAP.ROOMS) {
    c.fillStyle = '#eaf6ff';
    c.fillText(r.name, r.x + r.w / 2, r.y + r.h / 2 + 12);
    const n = o.counts && o.counts[r.id];
    if (n) {
      c.fillStyle = '#f5d63c';
      for (let i = 0; i < n; i++) {
        c.beginPath(); c.arc(r.x + r.w / 2 + (i - (n - 1) / 2) * 44, r.y + r.h / 2 + 50, 18, 0, Math.PI * 2); c.fill();
      }
    }
  }
  if (o.taskIds) {
    for (const spot of MAP.TASK_SPOTS) {
      if (!o.taskIds.has(spot.id)) continue;
      c.fillStyle = '#f5d63c';
      c.strokeStyle = OUTLINE;
      c.lineWidth = 6;
      c.beginPath(); c.arc(spot.x, spot.y, 22, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = OUTLINE;
      c.font = '800 34px sans-serif';
      c.fillText('!', spot.x, spot.y + 12);
      c.font = "800 36px 'Baloo 2', 'Trebuchet MS', sans-serif";
    }
  }
  for (const p of o.panels || []) {
    c.fillStyle = '#e2231a';
    c.strokeStyle = '#fff';
    c.lineWidth = 6;
    c.beginPath(); c.arc(p.x, p.y, 26, 0, Math.PI * 2); c.fill(); c.stroke();
  }
  if (o.me) drawCrewmate(c, o.me.x, o.me.y, o.me.color, { scale: 2.2 });
  c.restore();
}
