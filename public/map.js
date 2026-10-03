// Ship layout shared by the server (collision + range checks) and the client (rendering).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GAME_MAP = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const WORLD_W = 2400;
  const WORLD_H = 1540;
  const PLAYER_RADIUS = 14;

  const ROOMS = [
    { id: 'cafeteria', name: 'Cafeteria', x: 900, y: 100, w: 600, h: 440, color: '#7d8791' },
    { id: 'weapons', name: 'Weapons', x: 1700, y: 120, w: 300, h: 260, color: '#6f7c8f' },
    { id: 'o2', name: 'O2', x: 1560, y: 520, w: 200, h: 180, color: '#6d8f86' },
    { id: 'navigation', name: 'Navigation', x: 2060, y: 580, w: 280, h: 260, color: '#6b85a3' },
    { id: 'shields', name: 'Shields', x: 1700, y: 1040, w: 300, h: 280, color: '#807d9c' },
    { id: 'communications', name: 'Communications', x: 1380, y: 1300, w: 260, h: 180, color: '#6c8799' },
    { id: 'storage', name: 'Storage', x: 960, y: 960, w: 320, h: 420, color: '#94836f' },
    { id: 'admin', name: 'Admin', x: 1340, y: 740, w: 280, h: 200, color: '#828b6f' },
    { id: 'electrical', name: 'Electrical', x: 600, y: 880, w: 260, h: 240, color: '#958b5c' },
    { id: 'lower-engine', name: 'Lower Engine', x: 160, y: 1040, w: 300, h: 280, color: '#93705f' },
    { id: 'upper-engine', name: 'Upper Engine', x: 160, y: 160, w: 300, h: 280, color: '#93705f' },
    { id: 'reactor', name: 'Reactor', x: 20, y: 600, w: 200, h: 300, color: '#6a7fa8' },
    { id: 'security', name: 'Security', x: 400, y: 660, w: 160, h: 180, color: '#7f7491' },
    { id: 'medbay', name: 'MedBay', x: 580, y: 400, w: 260, h: 220, color: '#7099a3' },
  ];

  // Hallways overlap the rooms they join so doorways stay open.
  const CORRIDORS = [
    { x: 1480, y: 200, w: 240, h: 100 }, // cafeteria - weapons
    { x: 440, y: 220, w: 480, h: 100 }, // upper engine - cafeteria
    { x: 660, y: 300, w: 100, h: 120 }, // medbay branch
    { x: 260, y: 420, w: 100, h: 640 }, // upper engine - lower engine
    { x: 200, y: 700, w: 80, h: 100 }, // reactor branch
    { x: 340, y: 700, w: 80, h: 100 }, // security branch
    { x: 440, y: 1200, w: 540, h: 100 }, // lower engine - storage
    { x: 700, y: 1100, w: 100, h: 120 }, // electrical branch
    { x: 1100, y: 520, w: 100, h: 460 }, // cafeteria - storage
    { x: 1180, y: 800, w: 180, h: 100 }, // admin branch
    { x: 1260, y: 1120, w: 460, h: 100 }, // storage - shields
    { x: 1460, y: 1200, w: 100, h: 120 }, // communications branch
    { x: 1800, y: 360, w: 100, h: 700 }, // weapons - shields
    { x: 1740, y: 560, w: 80, h: 100 }, // o2 branch
    { x: 1880, y: 660, w: 200, h: 100 }, // navigation branch
  ];

  const WALKABLE = ROOMS.concat(CORRIDORS);

  // Doors an impostor can slam shut. Each sits in the hallway mouth of its room.
  const DOORS = [
    { room: 'cafeteria', x: 876, y: 220, w: 24, h: 100 },
    { room: 'cafeteria', x: 1500, y: 200, w: 24, h: 100 },
    { room: 'cafeteria', x: 1100, y: 540, w: 100, h: 24 },
    { room: 'medbay', x: 660, y: 376, w: 100, h: 24 },
    { room: 'electrical', x: 700, y: 1120, w: 100, h: 24 },
    { room: 'security', x: 376, y: 700, w: 24, h: 100 },
    { room: 'storage', x: 1100, y: 936, w: 100, h: 24 },
    { room: 'storage', x: 936, y: 1200, w: 24, h: 100 },
    { room: 'storage', x: 1280, y: 1120, w: 24, h: 100 },
    { room: 'upper-engine', x: 460, y: 220, w: 24, h: 100 },
    { room: 'upper-engine', x: 260, y: 440, w: 100, h: 24 },
    { room: 'lower-engine', x: 460, y: 1200, w: 24, h: 100 },
    { room: 'lower-engine', x: 260, y: 1016, w: 100, h: 24 },
  ];
  const DOOR_ROOMS = ['cafeteria', 'medbay', 'electrical', 'security', 'storage', 'upper-engine', 'lower-engine'];

  const EMERGENCY = { x: 1200, y: 320 };
  const TABLES = [
    { x: 1020, y: 210 }, { x: 1380, y: 210 }, { x: 1020, y: 430 }, { x: 1380, y: 430 },
  ];

  // `game` picks the minigame the client opens for the task.
  const TASK_SPOTS = [
    { id: 'caf-garbage', icon: 'cafeteria', game: 'hold', label: 'Empty Garbage', room: 'Cafeteria', x: 1440, y: 480 },
    { id: 'caf-wiring', icon: 'wiring', game: 'wires', label: 'Fix Wiring', room: 'Cafeteria', x: 960, y: 150 },
    { id: 'weapons', icon: 'navigation', game: 'targets', label: 'Clear Asteroids', room: 'Weapons', x: 1850, y: 170 },
    { id: 'o2', icon: 'o2', game: 'toggle', label: 'Clean O2 Filter', room: 'O2', x: 1620, y: 570 },
    { id: 'nav-course', icon: 'navigation', game: 'sequence', label: 'Chart Course', room: 'Navigation', x: 2280, y: 710 },
    { id: 'nav-steer', icon: 'reactor', game: 'timing', label: 'Stabilize Steering', room: 'Navigation', x: 2200, y: 630 },
    { id: 'shields', icon: 'shield', game: 'toggle', label: 'Prime Shields', room: 'Shields', x: 1850, y: 1270 },
    { id: 'comms', icon: 'download', game: 'progress', label: 'Download Data', room: 'Communications', x: 1510, y: 1430 },
    { id: 'storage-fuel', icon: 'o2', game: 'hold', label: 'Fuel Engines', room: 'Storage', x: 1010, y: 1320 },
    { id: 'storage-wiring', icon: 'wiring', game: 'wires', label: 'Fix Wiring', room: 'Storage', x: 1230, y: 1010 },
    { id: 'admin', icon: 'card', game: 'swipe', label: 'Swipe Card', room: 'Admin', x: 1560, y: 890 },
    { id: 'elec-power', icon: 'electrical', game: 'slider', label: 'Divert Power', room: 'Electrical', x: 650, y: 930 },
    { id: 'elec-calibrate', icon: 'reactor', game: 'timing', label: 'Calibrate Distributor', room: 'Electrical', x: 810, y: 930 },
    { id: 'lower-engine', icon: 'engine', game: 'slider', label: 'Align Engine Output', room: 'Lower Engine', x: 220, y: 1180 },
    { id: 'upper-engine', icon: 'engine', game: 'slider', label: 'Align Engine Output', room: 'Upper Engine', x: 220, y: 300 },
    { id: 'reactor', icon: 'reactor', game: 'sequence', label: 'Unlock Manifolds', room: 'Reactor', x: 70, y: 750 },
    { id: 'security', icon: 'wiring', game: 'wires', label: 'Fix Wiring', room: 'Security', x: 480, y: 700 },
    { id: 'medbay', icon: 'medbay', game: 'progress', label: 'Submit Scan', room: 'MedBay', x: 710, y: 560 },
  ];

  // Panels crewmates use to undo a sabotage.
  const PANELS = [
    { id: 'lights', sabotage: 'lights', label: 'Fix Lights', x: 730, y: 930 },
    { id: 'reactor-top', sabotage: 'reactor', label: 'Stop Reactor Meltdown', x: 70, y: 645 },
    { id: 'reactor-bottom', sabotage: 'reactor', label: 'Stop Reactor Meltdown', x: 70, y: 855 },
    { id: 'o2-o2', sabotage: 'o2', label: 'Restore Oxygen', x: 1710, y: 570 },
    { id: 'o2-admin', sabotage: 'o2', label: 'Restore Oxygen', x: 1385, y: 785 },
    { id: 'comms', sabotage: 'comms', label: 'Fix Communications', x: 1420, y: 1430 },
  ];

  const SECURITY_CONSOLE = { x: 435, y: 795 };
  const ADMIN_TABLE = { x: 1480, y: 810 };
  const CAMERAS = [
    { name: 'MedBay Hall', x: 710, y: 280 },
    { name: 'Navigation Hall', x: 1850, y: 700 },
    { name: 'Admin Hall', x: 1160, y: 830 },
    { name: 'Engine Hall', x: 310, y: 740 },
  ];

  // An impostor inside a vent can crawl to any other vent in the same group.
  const VENTS = [
    { id: 'vent-a1', group: 'a', x: 400, y: 220 },
    { id: 'vent-a2', group: 'a', x: 180, y: 640 },
    { id: 'vent-b1', group: 'b', x: 400, y: 1260 },
    { id: 'vent-b2', group: 'b', x: 180, y: 860 },
    { id: 'vent-c1', group: 'c', x: 800, y: 580 },
    { id: 'vent-c2', group: 'c', x: 520, y: 800 },
    { id: 'vent-c3', group: 'c', x: 640, y: 1080 },
    { id: 'vent-d1', group: 'd', x: 1440, y: 160 },
    { id: 'vent-d2', group: 'd', x: 1400, y: 900 },
    { id: 'vent-d3', group: 'd', x: 1850, y: 520 },
    { id: 'vent-e1', group: 'e', x: 1940, y: 180 },
    { id: 'vent-e2', group: 'e', x: 2120, y: 620 },
    { id: 'vent-f1', group: 'f', x: 1940, y: 1100 },
    { id: 'vent-f2', group: 'f', x: 2120, y: 800 },
  ];

  function inRect(r, x, y) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  function pointWalkable(x, y) {
    for (const r of WALKABLE) if (inRect(r, x, y)) return true;
    return false;
  }

  // A player fits at (x, y) when every corner of their bounding box is on floor.
  function isWalkable(x, y, radius) {
    const r = radius === undefined ? PLAYER_RADIUS : radius;
    return pointWalkable(x - r, y - r) && pointWalkable(x + r, y - r)
      && pointWalkable(x - r, y + r) && pointWalkable(x + r, y + r);
  }

  // closedRooms: array of room ids whose doors are currently shut.
  function closedDoors(closedRooms) {
    if (!closedRooms || closedRooms.length === 0) return [];
    return DOORS.filter((d) => closedRooms.includes(d.room));
  }

  function hitsDoor(x, y, doors, radius) {
    const r = radius === undefined ? PLAYER_RADIUS : radius;
    for (const d of doors) {
      if (x + r > d.x && x - r < d.x + d.w && y + r > d.y && y - r < d.y + d.h) return true;
    }
    return false;
  }

  function pointOpen(x, y, doors) {
    if (!pointWalkable(x, y)) return false;
    for (const d of doors) if (inRect(d, x, y)) return false;
    return true;
  }

  function lineOfSight(x1, y1, x2, y2, doors) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.ceil(dist / 10);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (!pointOpen(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, doors || [])) return false;
    }
    return true;
  }

  function roomAt(x, y) {
    for (const r of ROOMS) if (inRect(r, x, y)) return r;
    return null;
  }

  function placeName(x, y) {
    const r = roomAt(x, y);
    return r ? r.name : 'Hallway';
  }

  return {
    WORLD_W, WORLD_H, PLAYER_RADIUS, ROOMS, CORRIDORS, DOORS, DOOR_ROOMS, EMERGENCY, TABLES,
    TASK_SPOTS, PANELS, SECURITY_CONSOLE, ADMIN_TABLE, CAMERAS, VENTS,
    pointWalkable, isWalkable, closedDoors, hitsDoor, pointOpen, lineOfSight, roomAt, placeName,
  };
});
