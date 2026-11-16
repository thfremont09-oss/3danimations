// Story3D viewer: stages a storyboard (see story3d/parser.py) as a low-poly 3D film.
// Every shot is a pure function of time, so the timeline can be scrubbed freely.
import * as THREE from 'three';

const STORY = JSON.parse(document.getElementById('story-data').textContent);
const SHOW_CAPTIONS = !STORY.options || STORY.options.captions !== false;
// 2D style: flat unlit colours, no shadows, and a fixed side-on long-lens camera.
const FLAT = !!STORY.options && STORY.options.style === '2d';
const FLAT_FOV = 14;
const $ = (id) => document.getElementById(id);
const WATER_Y = -0.45;
const FADE = 0.6;

// ---------------------------------------------------------------- helpers
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const lerp = (a, b, u) => a + (b - a) * u;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ease = (u) => u * u * (3 - 2 * u);
const mix = (a, b, u) => new THREE.Color(a).lerp(new THREE.Color(b), u);

const mat = (color, o = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...o });
const glow = (color, k = 1.5) => mat(color, { emissive: color, emissiveIntensity: k });
function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const ball = (r, detail = 1) => new THREE.IcosahedronGeometry(r, detail);
const cyl = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r, h, s = 7) => new THREE.ConeGeometry(r, h, s);
function pivot(parent, x, y, z) {
  const p = new THREE.Group();
  p.position.set(x, y, z);
  parent.add(p);
  return p;
}

function textSprite(text, { color = '#ffffff', height = 0.5 } = {}) {
  const px = 72, pad = 16;
  const c = document.createElement('canvas');
  let ctx = c.getContext('2d');
  const font = `700 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  c.height = px + pad * 2;
  ctx = c.getContext('2d');
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(0,0,0,.55)';
  ctx.strokeText(text, pad, c.height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, pad, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(height * c.width / c.height, height, 1);
  return sprite;
}

// ---------------------------------------------------------------- actors
const PALETTE = ['#d1495b', '#2e86ab', '#edae49', '#3b8b6f', '#8d5fd3', '#e07a5f',
                 '#3d5a80', '#c9596f', '#5a9e3d', '#d98032'];

function buildPerson(o, id) {
  const g = new THREE.Group();
  const color = o.color || PALETTE[hashStr(id) % PALETTE.length];
  const extra = o.armor ? { metalness: 0.75, roughness: 0.35 }
    : o.ghost ? { transparent: true, opacity: 0.6 } : {};
  const cloth = mat(color, extra);
  const skin = mat(o.skin || '#f0c7a0', o.ghost ? { transparent: true, opacity: 0.6 } : {});
  const legs = [], arms = [];
  if (o.robe) {
    g.add(mesh(cone(0.46, 1.3, 9), cloth, 0, 0.72, 0));
  } else {
    g.add(mesh(cyl(0.2, 0.27, 0.72, 8), cloth, 0, 1.02, 0));
    for (const s of [-1, 1]) {
      const p = pivot(g, s * 0.13, 0.68, 0);
      p.add(mesh(cyl(0.09, 0.08, 0.68, 6), mat('#39424e'), 0, -0.34, 0));
      legs.push(p);
    }
  }
  for (const s of [-1, 1]) {
    const p = pivot(g, s * 0.3, 1.32, 0);
    p.add(mesh(cyl(0.065, 0.055, 0.62, 6), cloth, 0, -0.31, 0));
    p.userData.side = s;
    arms.push(p);
  }
  const hr = o.bigHead ? 0.34 : 0.24;
  const head = mesh(ball(hr, 2), skin, 0, 1.4 + hr, 0);
  for (const s of [-1, 1]) head.add(mesh(ball(0.035, 1), mat('#1b1b1f'), s * hr * 0.38, 0.03, hr * 0.92));
  g.add(head);
  const top = 1.4 + hr * 2;
  if (o.crown) g.add(mesh(cyl(0.2, 0.16, 0.15, 6), mat('#f5c542', { metalness: 0.8, roughness: 0.3 }), 0, top + 0.02, 0));
  if (o.hat) {
    g.add(mesh(cyl(0.42, 0.42, 0.04, 12), cloth, 0, top - 0.08, 0));
    g.add(mesh(cone(0.25, 0.62, 9), cloth, 0, top + 0.24, 0));
  }
  g.userData = { legs, arms, head, height: top + (o.hat ? 0.6 : 0.15) };
  return g;
}

function buildRobot() {
  const g = new THREE.Group();
  const metal = mat('#9aa7b5', { metalness: 0.7, roughness: 0.4 });
  const dark = mat('#4a5562', { metalness: 0.6, roughness: 0.5 });
  const legs = [], arms = [];
  g.add(mesh(box(0.6, 0.7, 0.4), metal, 0, 1.05, 0));
  g.add(mesh(box(0.22, 0.12, 0.05), glow('#5eead4'), 0, 1.12, 0.21));
  for (const s of [-1, 1]) {
    const leg = pivot(g, s * 0.16, 0.7, 0);
    leg.add(mesh(box(0.16, 0.7, 0.18), dark, 0, -0.35, 0));
    legs.push(leg);
    const arm = pivot(g, s * 0.39, 1.34, 0);
    arm.add(mesh(box(0.13, 0.62, 0.14), dark, 0, -0.31, 0));
    arm.userData.side = s;
    arms.push(arm);
  }
  const head = mesh(box(0.46, 0.38, 0.4), metal, 0, 1.63, 0);
  for (const s of [-1, 1]) head.add(mesh(ball(0.06, 1), glow('#ffd166'), s * 0.11, 0.02, 0.2));
  head.add(mesh(cyl(0.015, 0.015, 0.25, 5), dark, 0, 0.3, 0));
  head.add(mesh(ball(0.05, 1), glow('#ff5d5d'), 0, 0.44, 0));
  g.add(head);
  g.userData = { legs, arms, head, height: 2.2 };
  return g;
}

function buildQuad(o) {
  const g = new THREE.Group();
  const m = mat(o.color), dark = mat(mix(o.color, '#000000', 0.25));
  const L = o.len || 1, H = o.leg || 0.5, W = o.width || 0.4, neck = o.neck || 0;
  const legs = [], wings = [];
  g.add(mesh(box(W, W * 0.9, L), m, 0, H + W * 0.45, 0));
  const hy = H + W * 0.75 + neck, hz = L / 2 + W * 0.25;
  if (neck) {
    const n = mesh(box(W * 0.5, neck + W * 0.5, W * 0.5), m, 0, H + W * 0.6 + neck / 2, L / 2 - W * 0.1);
    n.rotation.x = 0.35;
    g.add(n);
  }
  const head = mesh(box(W * 0.75, W * 0.65, W * 0.95), m, 0, hy, hz);
  for (const s of [-1, 1]) {
    head.add(mesh(ball(W * 0.07, 1), mat('#15151a'), s * W * 0.38, W * 0.1, W * 0.25));
    if (o.ears === 'up') head.add(mesh(cone(W * 0.16, W * 0.4, 4), dark, s * W * 0.25, W * 0.5, -W * 0.2));
    if (o.ears === 'round') head.add(mesh(ball(W * 0.18, 1), dark, s * W * 0.35, W * 0.35, -W * 0.2));
    if (o.ears === 'long') head.add(mesh(box(W * 0.16, W * 1.1, W * 0.1), m, s * W * 0.2, W * 0.85, -W * 0.2));
  }
  if (o.horn) head.add(mesh(cone(W * 0.1, W * 0.9, 5), mat('#f3e3b3'), 0, W * 0.75, W * 0.1));
  if (o.trunk) head.add(mesh(box(W * 0.2, H * 0.9, W * 0.2), m, 0, -H * 0.45, W * 0.5));
  g.add(head);
  const lw = Math.max(0.05, W * 0.24);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const p = pivot(g, sx * (W / 2 - lw / 2), H, sz * (L / 2 - lw));
    p.add(mesh(box(lw, H, lw), dark, 0, -H / 2, 0));
    legs.push(p);
  }
  const tl = o.tail || 0.3;
  const tail = pivot(g, 0, H + W * 0.7, -L / 2);
  const tm = mesh(box(W * 0.16, W * 0.16, tl), dark, 0, 0, -tl / 2);
  tail.add(tm);
  tail.rotation.x = 0.5;
  if (o.wings) {
    for (const s of [-1, 1]) {
      const p = pivot(g, s * W * 0.4, H + W * 0.9, 0);
      p.add(mesh(box(L * 0.9, 0.06, L * 0.55), dark, s * L * 0.45, 0, 0));
      p.userData.side = s;
      wings.push(p);
    }
  }
  let breath = null;
  if (o.breath) {
    breath = mesh(cone(W * 0.55, L * 0.9, 8), glow('#ff8a1c', 2.6), 0, hy - W * 0.1, hz + W * 0.5 + L * 0.45);
    breath.rotation.x = -Math.PI / 2;
    breath.castShadow = false;
    breath.visible = false;
    g.add(breath);
  }
  g.userData = { breath, legs, tail, wings, quad: true, height: hy + W * 0.6, sink: H * 0.85 };
  return g;
}

function buildBird(o) {
  const g = new THREE.Group();
  const m = mat(o.color), dark = mat(mix(o.color, '#000000', 0.3));
  const body = mesh(ball(0.22, 1), m, 0, 0.3, 0);
  body.scale.set(1, 0.85, 1.5);
  g.add(body);
  g.add(mesh(ball(0.14, 1), m, 0, 0.45, 0.28));
  const beak = mesh(cone(0.05, 0.16, 5), mat('#f2a33a'), 0, 0.43, 0.46);
  beak.rotation.x = Math.PI / 2;
  g.add(beak);
  g.add(mesh(box(0.14, 0.03, 0.3), dark, 0, 0.3, -0.4));
  const wings = [];
  for (const s of [-1, 1]) {
    const p = pivot(g, s * 0.14, 0.36, 0);
    p.add(mesh(box(0.55, 0.035, 0.3), dark, s * 0.28, 0, 0));
    p.userData.side = s;
    wings.push(p);
  }
  g.userData = { wings, height: 0.8 };
  return g;
}

function buildFish(o) {
  const g = new THREE.Group();
  const m = mat(o.color);
  const body = mesh(ball(0.3, 1), m, 0, 0, 0);
  body.scale.set(0.55, 0.8, 1.5);
  g.add(body);
  const tail = pivot(g, 0, 0, -0.42);
  const fin = mesh(cone(0.2, 0.3, 4), m, 0, 0, -0.12);
  fin.rotation.x = Math.PI / 2;
  fin.scale.x = 0.3;
  tail.add(fin);
  const top = mesh(cone(0.1, 0.22, 4), m, 0, 0.26, -0.05);
  top.scale.x = 0.3;
  g.add(top);
  for (const s of [-1, 1]) g.add(mesh(ball(0.035, 1), mat('#101014'), s * 0.13, 0.06, 0.3));
  g.userData = { fishTail: tail, height: 0.6 };
  return g;
}

function buildBoat() {
  const g = new THREE.Group();
  const wood = mat('#8b5a36');
  g.add(mesh(box(1.3, 0.55, 2.6), wood, 0, 0.2, 0));
  const bow = mesh(cone(0.92, 1.1, 4), wood, 0, 0.2, 1.85);
  bow.rotation.x = Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.scale.z = 0.42;
  g.add(bow);
  g.add(mesh(cyl(0.05, 0.06, 2.6, 6), mat('#5d3b22'), 0, 1.7, 0.1));
  const sail = mesh(cone(1.0, 2.0, 3), mat('#f7f3e8'), 0, 1.9, 0.12);
  sail.scale.set(0.08, 1, 1);
  g.add(sail);
  g.add(mesh(box(0.05, 0.22, 0.4), mat('#d1495b'), 0, 3.0, -0.1));
  g.userData = { boat: true, height: 3.3 };
  return g;
}

function buildCar(o, id) {
  const g = new THREE.Group();
  const paint = mat(PALETTE[hashStr(id) % PALETTE.length], { roughness: 0.5, metalness: 0.3 });
  g.add(mesh(box(1.1, 0.45, 2.3), paint, 0, 0.5, 0));
  g.add(mesh(box(0.98, 0.42, 1.2), mat('#cfe6f5', { roughness: 0.2 }), 0, 0.92, -0.1));
  for (const s of [-1, 1]) g.add(mesh(ball(0.09, 1), glow('#fff3b0', 1), s * 0.38, 0.52, 1.16));
  const wheels = [];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = mesh(cyl(0.26, 0.26, 0.2, 10), mat('#1d1d22'), sx * 0.58, 0.26, sz * 0.75);
    w.rotation.z = Math.PI / 2;
    g.add(w);
    wheels.push(w);
  }
  g.userData = { wheels, height: 1.3 };
  return g;
}

function buildRocket() {
  const g = new THREE.Group();
  const white = mat('#f1f3f5', { roughness: 0.4 }), red = mat('#d1495b');
  g.add(mesh(cyl(0.42, 0.42, 1.9, 12), white, 0, 1.45, 0));
  g.add(mesh(cone(0.42, 0.85, 12), red, 0, 2.82, 0));
  g.add(mesh(ball(0.17, 1), mat('#6ec5ff', { roughness: 0.15 }), 0, 1.9, 0.36));
  for (let i = 0; i < 3; i++) {
    const p = pivot(g, 0, 0, 0);
    p.rotation.y = (i * Math.PI * 2) / 3;
    p.add(mesh(box(0.08, 0.8, 0.55), red, 0, 0.7, 0.6));
  }
  const flame = mesh(cone(0.34, 1.4, 8), glow('#ffb347', 2.5), 0, -0.2, 0);
  flame.rotation.x = Math.PI;
  flame.castShadow = false;
  g.add(flame);
  g.userData = { flame, height: 3.4 };
  return g;
}

function buildPlane() {
  const g = new THREE.Group();
  const white = mat('#f1f3f5', { roughness: 0.4 }), red = mat('#d1495b');
  const body = mesh(cyl(0.3, 0.18, 2.6, 8), white, 0, 0.4, 0);
  body.rotation.x = -Math.PI / 2;
  g.add(body);
  g.add(mesh(box(3.6, 0.07, 0.6), red, 0, 0.4, 0.3));
  g.add(mesh(box(1.2, 0.06, 0.36), red, 0, 0.45, -1.15));
  g.add(mesh(box(0.06, 0.5, 0.36), red, 0, 0.7, -1.15));
  const prop = mesh(box(1.0, 0.08, 0.03), mat('#30343c'), 0, 0.4, 1.33);
  g.add(prop);
  g.userData = { prop, height: 1.1 };
  return g;
}

function buildUfo() {
  const g = new THREE.Group();
  const disc = mesh(ball(1.3, 2), mat('#aeb7c2', { metalness: 0.7, roughness: 0.3 }), 0, 0.5, 0);
  disc.scale.y = 0.25;
  g.add(disc);
  g.add(mesh(ball(0.55, 2), mat('#8be9fd', { transparent: true, opacity: 0.8, roughness: 0.1 }), 0, 0.72, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    g.add(mesh(ball(0.09, 1), glow(i % 2 ? '#ffd166' : '#ff5d8f', 2), Math.cos(a) * 1.05, 0.42, Math.sin(a) * 1.05));
  }
  g.userData = { height: 1.3, spin: disc };
  return g;
}

function buildBalloon(o, id) {
  const g = new THREE.Group();
  const colors = ['#e63946', '#f4a261', '#2a9d8f', '#8d5fd3', '#f2c230'];
  const env = mesh(ball(1.6, 2), mat(colors[hashStr(id) % colors.length]), 0, 3.6, 0);
  env.scale.y = 1.2;
  g.add(env);
  g.add(mesh(cone(0.9, 1.2, 10), mat('#f7f3e8'), 0, 1.75, 0)).rotation.x = Math.PI;
  g.add(mesh(box(0.7, 0.5, 0.7), mat('#8b5a36'), 0, 0.25, 0));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(mesh(cyl(0.015, 0.015, 1.0, 4), mat('#3a2a1c'), x * 0.3, 0.95, z * 0.3));
  }
  g.userData = { height: 5.6 };
  return g;
}

const BUILDERS = { ufo: buildUfo, balloon: buildBalloon, person: buildPerson, robot: buildRobot, quad: buildQuad, bird: buildBird,
  fish: buildFish, boat: buildBoat, car: buildCar, rocket: buildRocket, plane: buildPlane };
const FIGHTING = new Set(['fight', 'slay', 'die']);
const BEAT = 0.95;        // seconds per exchange of blows
const DUEL_END = 0.62;    // fraction of the scene at which a fight to the death is settled
const FOOTPRINT = { boat: 4.2, car: 3.2, rocket: 2.6, plane: 4.2, ufo: 3.2, balloon: 3.6 };

function makeActor(spec, n, stage) {
  const o = spec.model, base = o.base in BUILDERS ? o.base : 'person';
  const s = o.scale || 1;
  const g = BUILDERS[base](o, spec.id + n);
  const ud = g.userData;
  const wrap = new THREE.Group();
  const scaled = new THREE.Group();
  scaled.scale.setScalar(s);
  scaled.add(g);
  wrap.add(scaled);
  if (spec.name) {
    const label = textSprite(spec.name, { height: 0.42 });
    label.position.y = ud.height * s + 0.45;
    wrap.add(label);
  }
  if (FIGHTING.has(spec.action) && ud.arms) {      // fighters on two legs carry a blade
    const steel = mat('#d9dee6', { metalness: 0.85, roughness: 0.25 });
    const blade = mesh(box(0.05, 0.05, 0.95), steel, 0, -0.62, 0.5);
    blade.add(mesh(box(0.3, 0.06, 0.06), mat('#6b4a2b'), 0, 0, -0.42));
    ud.arms[1].add(blade);
  }
  let zzz = null;
  if (spec.action === 'sleep') {
    zzz = textSprite('z z z', { height: 0.5, color: '#e8ecff' });
    wrap.add(zzz);
  }
  const act = spec.action;
  const aquatic = base === 'fish' || base === 'boat' || act === 'swim';
  const ph = n * 1.7;                         // per-actor phase offset
  const actor = {
    wrap, focus: new THREE.Vector3(), aquatic,
    width: FOOTPRINT[base] || (base === 'quad' ? (o.len || 1) * s + 0.9 : 1.5 * Math.max(0.7, s)),
    scale: s, flying: act === 'fly' && !['rocket', 'person', 'robot', 'balloon'].includes(base),
    ambient: !!spec.ambient, base,
    moving: act === 'walk' || act === 'run' || act === 'swim',
    x0: 0, z0: 0, y0: 0, facing: 0, duel: false, action: act,
  };

  actor.update = (t, dur) => {
    let x = actor.x0, y = actor.y0, z = actor.z0, heading = actor.facing;
    let swing = 0, armsUp = 0, flap = 0, focusY = null;
    const held = [false, false];             // arms posed by the action itself
    if (ud.breath) ud.breath.visible = false;
    g.rotation.set(0, 0, 0);
    g.position.set(0, 0, 0);
    if (ud.head) ud.head.rotation.set(0, 0, 0);
    if (ud.flame) ud.flame.visible = false;

    if (act === 'walk' || act === 'run') {
      const fast = act === 'run';
      const v = (fast ? 4.2 : 1.5) * (o.speed || 1);
      const f = fast ? 11 : 6.5;
      x += v * (t - dur / 2);
      heading = Math.PI / 2;
      swing = Math.sin(t * f + ph) * (fast ? 0.95 : 0.55);
      if (ud.legs && ud.legs.length) y += Math.abs(Math.sin(t * f + ph)) * 0.05 * s;
      if (ud.wheels) ud.wheels.forEach((w) => { w.rotation.x = (v * t) / 0.26; });
    } else if (act === 'fly') {
      if (base === 'rocket') {
        const k = Math.max(0, t - 1.2);
        y += Math.min(90, 0.9 * k * k);
        x += Math.sin(t * 40) * (t > 0.6 && t < 1.6 ? 0.03 : 0);
        ud.flame.visible = t > 0.6;
        ud.flame.scale.y = 0.8 + Math.sin(t * 30) * 0.2;
      } else if (base === 'balloon') {
        y += 2 + Math.min(9, t * 0.9) + Math.sin(t * 0.8 + ph) * 0.3;
        x += (t - dur / 2) * 0.7;
        g.rotation.z = Math.sin(t * 0.7 + ph) * 0.04;
      } else if (base === 'person' || base === 'robot') {
        y += Math.min(2.2, t * 0.6) + 0.8 + Math.sin(t * 1.3 + ph) * 0.35;
        x += Math.sin(t * 0.45 + ph) * 1.2;
        armsUp = 0.6;
      } else {
        const r = 5.5 + n * 1.3 + (base === 'plane' ? 5 : 0) + (o.wings ? 4 : 0);
        const h = (base === 'plane' ? 9 : o.wings ? 7 : 4.2) + n * 0.6;
        const a = t * (base === 'plane' ? 0.9 : 0.75) + ph;
        x = Math.sin(a) * r;
        z = Math.cos(a) * r;
        y = h + Math.sin(t * 1.6 + ph) * 0.4;
        if (actor.ambient) { z -= 9; y += 1.5; }   // background life keeps clear of the camera
        heading = a + Math.PI / 2;
        g.rotation.z = -0.3;
        flap = Math.sin(t * (s < 0.5 ? 22 : 9) + ph) * 0.75;
        focusY = h;
        if (ud.prop) ud.prop.rotation.z = t * 30;
        if (ud.spin) { ud.spin.rotation.y = t * 3; g.rotation.z = Math.sin(t * 2) * 0.12; }
        if (ud.legs) ud.legs.forEach((leg) => { leg.rotation.x = 0.9; });
      }
    } else if (act === 'jump') {
      y += Math.abs(Math.sin(t * 4 + ph)) * 0.9;
      armsUp = 1;
    } else if (act === 'dance') {
      heading += t * 2.4 + ph;
      y += Math.abs(Math.sin(t * 5 + ph)) * 0.22;
      armsUp = 0.5 + Math.sin(t * 5 + ph) * 0.5;
    } else if (act === 'swim') {
      x += 0.9 * (o.speed || 1) * (t - dur / 2);
      heading = Math.PI / 2;
      if (base === 'fish') {
        const hop = Math.sin(t * 1.9 + ph);
        y += -0.25 * s + Math.max(0, hop) * 1.3 * Math.sqrt(s);
        g.rotation.x = -Math.cos(t * 1.9 + ph) * 0.5 * (hop > 0 ? 1 : 0);
      } else if (base !== 'boat') {
        y += -1.2 * s + Math.sin(t * 2.2 + ph) * 0.06;
        swing = Math.sin(t * 5 + ph) * 0.9;
      }
    } else if (act === 'sleep' || act === 'fall' || act === 'dead') {
      const u = act === 'fall' ? ease(clamp((t - dur * 0.4) / 0.5, 0, 1)) : 1;
      if (ud.quad && act === 'sleep') {
        g.position.y = -ud.sink;
      } else {
        g.rotation.z = u * Math.PI / 2;
        g.position.y = u * 0.25;
      }
      if (zzz) {
        const k = (t * 0.45 + n * 0.3) % 1;
        zzz.position.set(0.3 + k * 0.5, 0.9 * s + k * 1.3, 0);
        zzz.material.opacity = Math.sin(k * Math.PI);
      }
    } else if (act === 'talk') {
      const mine = (Math.floor(t / 1.6) + n) % 2 === 0;
      if (ud.head) ud.head.rotation.x = mine ? Math.sin(t * 9) * 0.1 : 0;
      if (ud.arms && mine) ud.arms[0].rotation.x = -0.6 - Math.sin(t * 6) * 0.35;
      y += mine ? Math.abs(Math.sin(t * 9)) * 0.02 : 0;
    } else if (act === 'fight' || act === 'slay' || act === 'die') {
      // A duel in beats: one side winds up, lunges and strikes while the other
      // blocks and is knocked back, then they swap. "slay" / "die" end it at DUEL_END.
      const over = act !== 'fight' && (t >= dur * DUEL_END || !actor.duel);
      if (!over) {
        const k = Math.floor(t / BEAT), p = t / BEAT - k;
        const attacking = (k + (actor.facing < 0 ? 1 : 0)) % 2 === 0 || !actor.duel;
        const reach = 0.7 + 0.25 * s;
        let adv = 0, lean = 0;
        if (attacking) {
          const wind = clamp(p / 0.3, 0, 1), hit = ease(clamp((p - 0.3) / 0.14, 0, 1));
          const back = ease(clamp((p - 0.55) / 0.45, 0, 1));
          adv = -0.25 * wind + (0.25 + reach) * hit - reach * back;
          lean = -0.3 * wind + 0.75 * hit - 0.45 * back;
          y += Math.sin(Math.PI * clamp((p - 0.25) / 0.4, 0, 1)) * 0.35 * s;
          if (ud.arms) { ud.arms[1].rotation.x = -2.7 * wind + 2.3 * hit - 0.6 * back - 0.4; held[1] = true; }
          if (ud.breath) { ud.breath.visible = p > 0.3 && p < 0.72; ud.breath.scale.z = 0.7 + Math.sin(t * 40) * 0.3; }
          flap = Math.sin(t * 14) * 0.6;
        } else {
          const hit = ease(clamp((p - 0.42) / 0.12, 0, 1)), back = ease(clamp((p - 0.62) / 0.38, 0, 1));
          adv = -0.55 * hit + 0.55 * back;
          lean = -0.4 * hit + 0.4 * back;
          x += Math.sin(t * 60) * 0.03 * hit * (1 - back);
          if (ud.arms) { ud.arms[0].rotation.x = -1.5; ud.arms[1].rotation.x = -0.9; held[0] = held[1] = true; }
          flap = 0.3;
        }
        x += Math.sin(heading) * adv;
        z += Math.cos(heading) * adv;
        g.rotation.x = lean * (ud.quad ? 0.45 : 1);
      } else if (act === 'slay') {
        armsUp = 1;                                    // the winner celebrates
        y += Math.abs(Math.sin(t * 4.5 + ph)) * 0.45;
      } else {
        const start = actor.duel ? dur * DUEL_END : dur * 0.4;
        const u = ease(clamp((t - start) / 0.55, 0, 1));
        g.rotation.z = u * Math.PI / 2 * (actor.facing < 0 ? -1 : 1);
        g.position.y = u * 0.25;
        flap = lerp(flap, -1.35, u);                   // wings fold as it falls
      }
    } else if (act === 'wave') {
      if (ud.arms) { ud.arms[1].userData.raise = 2.4 + Math.sin(t * 9 + ph) * 0.35; }
      else y += Math.abs(Math.sin(t * 4 + ph)) * 0.2;
    } else if (act === 'work') {
      const hit = Math.abs(Math.sin(t * 4.5 + ph));
      if (ud.arms) { ud.arms[1].rotation.x = -2.2 + hit * 1.6; g.rotation.x = 0.12 + (1 - hit) * 0.08; }
      else if (ud.head) ud.head.rotation.x = hit * 0.4;
    } else if (act === 'look') {
      const turn = Math.sin(t * 0.9 + ph);
      if (ud.head) ud.head.rotation.y = turn * 0.9; else heading += turn * 0.6;
    } else {
      y += Math.sin(t * 1.8 + ph) * 0.012;
    }

    if (ud.boat) {
      g.rotation.z = Math.sin(t * 1.3 + ph) * 0.07;
      g.rotation.x = Math.sin(t * 0.9 + ph) * 0.04;
    }
    if (base === 'bird' && act !== 'fly' && !FIGHTING.has(act)) flap = Math.sin(t * 2 + ph) * 0.08 - 0.5;
    const pair = [1, -1, -1, 1];
    if (ud.legs && act !== 'fly') {
      ud.legs.forEach((leg, i) => {
        leg.rotation.x = swing * (ud.quad ? pair[i] : i ? -1 : 1);
      });
    }
    if (ud.arms) {
      ud.arms.forEach((arm, i) => {
        if (act === 'talk' && arm.rotation.x < -0.5 && i === 0) return;
        if (held[i] || (act === 'work' && i === 1)) return;
        arm.rotation.x = -swing * (i ? -1 : 1) * 0.8;
        arm.rotation.z = arm.userData.side * (arm.userData.raise || 0.12 + armsUp * 2.5);
        arm.userData.raise = 0;
      });
    }
    if (ud.wings) ud.wings.forEach((w) => { w.rotation.z = w.userData.side * flap; });
    if (ud.tail) ud.tail.rotation.y = Math.sin(t * 5 + ph) * 0.35;
    if (ud.fishTail) ud.fishTail.rotation.y = Math.sin(t * 9 + ph) * 0.5;

    wrap.position.set(x, y, z);
    scaled.rotation.y = heading;
    if (focusY === null) actor.focus.set(x, Math.max(0.5, y + ud.height * s * 0.55), z);
    else actor.focus.set(x * 0.55, focusY, z * 0.55);
  };
  return actor;
}

// ---------------------------------------------------------------- scenery
function tree(R, snowy, palm) {
  const g = new THREE.Group();
  const h = 1.4 + R() * 1.4;
  const green = snowy ? '#e9f1f5' : mix('#3e8b3a', '#7cb342', R());
  g.add(mesh(cyl(0.16, 0.24, h, 6), mat('#6b4a2b'), 0, h / 2, 0));
  if (palm) {
    for (let i = 0; i < 6; i++) {
      const leaf = mesh(box(0.35, 0.06, 1.7), mat('#4c9a4a'), 0, h, 0);
      leaf.rotation.set(0.5, (i * Math.PI) / 3, 0, 'YXZ');
      leaf.translateZ(0.8);
      g.add(leaf);
    }
  } else {
    g.add(mesh(ball(1.1 + R() * 0.5, 1), mat(green), 0, h + 0.7, 0));
    g.add(mesh(ball(0.75, 1), mat(green), 0.55, h + 0.25, 0.3));
  }
  g.scale.setScalar(1 + R() * 0.8);
  return g;
}
function pine(R, snowy) {
  const g = new THREE.Group();
  const green = snowy ? '#eaf2f6' : mix('#1f5c3a', '#2f7d4a', R());
  g.add(mesh(cyl(0.14, 0.2, 1, 6), mat('#5b3d24'), 0, 0.5, 0));
  for (let i = 0; i < 3; i++) g.add(mesh(cone(1.25 - i * 0.32, 1.5, 7), mat(green), 0, 1.5 + i * 0.95, 0));
  g.scale.setScalar(1 + R() * 0.9);
  return g;
}
function rock(R, color = '#8a8d93') {
  const r = mesh(ball(0.5 + R() * 0.9, 0), mat(color));
  r.scale.set(1 + R() * 0.6, 0.6 + R() * 0.4, 1 + R() * 0.6);
  r.rotation.y = R() * 6;
  r.position.y = 0.15;
  return r;
}
function flowers(R) {
  const g = new THREE.Group();
  const colors = ['#ff6b8b', '#ffd166', '#c084fc', '#ffffff', '#ff8c42'];
  for (let i = 0; i < 6; i++) {
    const x = (R() - 0.5) * 1.6, z = (R() - 0.5) * 1.6, h = 0.25 + R() * 0.25;
    g.add(mesh(cyl(0.015, 0.015, h, 4), mat('#3f8f3f'), x, h / 2, z));
    g.add(mesh(ball(0.08, 0), mat(colors[Math.floor(R() * colors.length)]), x, h, z));
  }
  return g;
}
function cactus(R) {
  const g = new THREE.Group(), m = mat('#4f9a5a');
  const h = 1.6 + R() * 1.4;
  g.add(mesh(cyl(0.25, 0.28, h, 8), m, 0, h / 2, 0));
  for (const s of [-1, 1]) {
    g.add(mesh(box(0.5, 0.18, 0.18), m, s * 0.4, h * (0.45 + R() * 0.2), 0));
    g.add(mesh(cyl(0.1, 0.1, 0.6, 6), m, s * 0.62, h * 0.55 + 0.3, 0));
  }
  return g;
}
function house(R, night) {
  const g = new THREE.Group();
  const wall = ['#f2e2c4', '#e8c9a0', '#d9d4c7', '#f0d9d0'][Math.floor(R() * 4)];
  g.add(mesh(box(3.2, 2.2, 2.8), mat(wall), 0, 1.1, 0));
  const roof = mesh(cone(2.7, 1.6, 4), mat(['#a23e3e', '#7a4a2f', '#4f6a7d'][Math.floor(R() * 3)]), 0, 3.0, 0);
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  g.add(mesh(box(0.6, 1.15, 0.08), mat('#6b4226'), 0, 0.58, 1.42));
  const win = night ? glow('#ffd98a', 1.6) : mat('#a8d4f0', { roughness: 0.2 });
  for (const s of [-1, 1]) g.add(mesh(box(0.55, 0.55, 0.08), win, s * 1.0, 1.35, 1.42));
  g.add(mesh(box(0.4, 0.9, 0.4), mat('#8a6f5a'), 0.8, 3.2, -0.3));
  return g;
}
function castle(R, night) {
  const g = new THREE.Group(), stone = mat('#b3b6bd'), roofM = mat('#4b5fa8');
  g.add(mesh(box(9, 4, 9), stone, 0, 2, 0));
  g.add(mesh(box(4, 7.5, 4), stone, 0, 3.75, 0));
  const top = mesh(cone(3.2, 3, 4), roofM, 0, 9, 0);
  top.rotation.y = Math.PI / 4;
  g.add(top);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(mesh(cyl(1.3, 1.4, 7, 10), stone, sx * 4.5, 3.5, sz * 4.5));
    g.add(mesh(cone(1.6, 2.4, 10), roofM, sx * 4.5, 8.2, sz * 4.5));
  }
  g.add(mesh(box(1.8, 2.6, 0.2), mat('#4a3120'), 0, 1.3, 4.55));
  const win = night ? glow('#ffd98a', 1.6) : mat('#2a2f3a');
  for (const s of [-1, 1]) g.add(mesh(box(0.5, 0.9, 0.1), win, s * 0.9, 5.6, 2.02));
  return g;
}
function tower(R, night) {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    g.add(mesh(cyl(1.0 - i * 0.08, 1.08 - i * 0.08, 1.6, 12), mat(i % 2 ? '#d1495b' : '#f4f1ea'), 0, 0.8 + i * 1.6, 0));
  }
  g.add(mesh(cyl(0.95, 0.95, 0.15, 12), mat('#30343c'), 0, 8.05, 0));
  const lampM = night ? glow('#fff0a8', 3) : mat('#fff3c2');
  g.add(mesh(cyl(0.45, 0.45, 0.8, 8), lampM, 0, 8.5, 0));
  g.add(mesh(cone(0.75, 0.8, 8), mat('#30343c'), 0, 9.3, 0));
  if (night) {
    const light = new THREE.PointLight('#fff0a8', 60, 60);
    light.position.y = 8.5;
    g.add(light);
  }
  return g;
}
function tent() {
  const g = new THREE.Group();
  const t = mesh(cone(2, 2.4, 4), mat('#d98032'), 0, 1.2, 0);
  t.rotation.y = Math.PI / 4;
  g.add(t);
  g.add(mesh(box(0.7, 1.2, 0.05), mat('#3a2a1c'), 0, 0.6, 1.0));
  return g;
}
function campfire(R, night, anims) {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const log = mesh(cyl(0.07, 0.07, 0.8, 5), mat('#4a3120'), 0, 0.08, 0);
    log.rotation.set(Math.PI / 2, 0, (i * Math.PI) / 4, 'ZYX');
    g.add(log);
  }
  const flames = [];
  for (let i = 0; i < 3; i++) {
    const f = mesh(cone(0.22 - i * 0.05, 0.7 - i * 0.12, 6), glow(['#ff7b1c', '#ffb347', '#ffe08a'][i], 2.5),
      (i - 1) * 0.1, 0.4, i === 1 ? 0.08 : -0.05);
    f.castShadow = false;
    flames.push(f);
    g.add(f);
  }
  const light = new THREE.PointLight('#ff9a3c', night ? 30 : 8, 22);
  light.position.y = 0.9;
  g.add(light);
  const k = night ? 30 : 8;
  anims.push((t) => {
    flames.forEach((f, i) => { f.scale.y = 1 + Math.sin(t * (9 + i * 3) + i) * 0.25; });
    light.intensity = k * (0.85 + Math.sin(t * 13) * 0.1 + Math.sin(t * 7.3) * 0.08);
  });
  return g;
}
function chest() {
  const g = new THREE.Group(), gold = mat('#f5c542', { metalness: 0.8, roughness: 0.3 });
  g.add(mesh(box(0.9, 0.5, 0.6), mat('#7a4a22'), 0, 0.25, 0));
  const lid = mesh(box(0.9, 0.12, 0.6), mat('#8b5a2b'), 0, 0.3, -0.25);
  lid.rotation.x = -1.0;
  lid.position.set(0, 0.72, -0.42);
  g.add(lid);
  g.add(mesh(box(0.8, 0.14, 0.5), gold, 0, 0.5, 0));
  for (let i = 0; i < 5; i++) g.add(mesh(ball(0.09, 0), gold, (i - 2) * 0.15, 0.62, (i % 2) * 0.12 - 0.06));
  return g;
}
function crystal(R, night, anims) {
  const g = new THREE.Group();
  const c = mesh(new THREE.OctahedronGeometry(0.5), glow('#7ae7ff', 1.8), 0, 1.3, 0);
  c.scale.y = 1.6;
  g.add(c);
  g.add(mesh(ball(0.35, 0), mat('#6d7078'), 0, 0.15, 0));
  const light = new THREE.PointLight('#7ae7ff', 14, 16);
  light.position.y = 1.3;
  g.add(light);
  anims.push((t) => { c.rotation.y = t * 1.2; c.position.y = 1.3 + Math.sin(t * 1.5) * 0.15; });
  return g;
}
function lamp(R, night) {
  const g = new THREE.Group();
  g.add(mesh(cyl(0.05, 0.07, 2.4, 6), mat('#2d3038'), 0, 1.2, 0));
  g.add(mesh(ball(0.2, 1), glow('#ffe7a3', night ? 3 : 0.8), 0, 2.5, 0));
  const light = new THREE.PointLight('#ffe7a3', night ? 25 : 3, 20);
  light.position.y = 2.5;
  g.add(light);
  return g;
}
function bridge() {
  const g = new THREE.Group(), wood = mat('#8b5a36'), dark = mat('#5d3b22');
  for (let i = -4; i <= 4; i++) {
    const y = 1.1 - (i * i) * 0.06;
    const plank = mesh(box(0.72, 0.14, 2), wood, i * 0.7, y, 0);
    plank.rotation.z = -i * 0.085;
    g.add(plank);
    for (const z of [-0.95, 0.95]) g.add(mesh(box(0.08, 0.7, 0.08), dark, i * 0.7, y + 0.4, z));
  }
  for (const z of [-0.95, 0.95]) g.add(mesh(box(5.8, 0.07, 0.07), dark, 0, 1.55, z));
  return g;
}
function fence() {
  const g = new THREE.Group(), wood = mat('#b08a5a');
  for (let i = -4; i <= 4; i++) g.add(mesh(box(0.12, 0.95, 0.12), wood, i * 0.9, 0.47, 0));
  for (const y of [0.35, 0.72]) g.add(mesh(box(7.4, 0.09, 0.06), wood, 0, y, 0));
  return g;
}
function well() {
  const g = new THREE.Group();
  g.add(mesh(cyl(0.8, 0.85, 0.8, 10), mat('#9a9da3'), 0, 0.4, 0));
  g.add(mesh(cyl(0.62, 0.62, 0.05, 10), mat('#2f6f9a'), 0, 0.78, 0));
  for (const s of [-1, 1]) g.add(mesh(box(0.1, 1.5, 0.1), mat('#6b4a2b'), s * 0.7, 1.45, 0));
  const roof = mesh(cone(1.15, 0.7, 4), mat('#a23e3e'), 0, 2.5, 0);
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  return g;
}
function statue() {
  const g = new THREE.Group(), stone = mat('#b9bcc2');
  g.add(mesh(box(1.3, 0.9, 1.3), stone, 0, 0.45, 0));
  g.add(mesh(cyl(0.26, 0.36, 1.5, 8), stone, 0, 1.65, 0));
  g.add(mesh(ball(0.3, 1), stone, 0, 2.65, 0));
  const arm = mesh(box(0.14, 0.9, 0.14), stone, 0.42, 2.45, 0);
  arm.rotation.z = -0.5;
  g.add(arm);
  return g;
}
function windmill(R, night, anims) {
  const g = new THREE.Group();
  g.add(mesh(cyl(1.0, 1.6, 5, 8), mat('#efe6d3'), 0, 2.5, 0));
  g.add(mesh(cone(1.25, 1.3, 8), mat('#8a4b32'), 0, 5.6, 0));
  g.add(mesh(box(0.6, 1.1, 0.1), mat('#6b4226'), 0, 0.55, 1.5));
  const hub = pivot(g, 0, 4.5, 1.25);
  for (let i = 0; i < 4; i++) {
    const blade = pivot(hub, 0, 0, 0);
    blade.rotation.z = (i * Math.PI) / 2;
    blade.add(mesh(box(0.12, 3.2, 0.06), mat('#6b4a2b'), 0, 1.6, 0));
    blade.add(mesh(box(0.7, 2.4, 0.04), mat('#f7f3e8'), 0.4, 1.9, 0));
  }
  anims.push((t) => { hub.rotation.z = -t * 0.9; });
  return g;
}
function bench() {
  const g = new THREE.Group(), wood = mat('#8b5a36');
  g.add(mesh(box(1.8, 0.1, 0.5), wood, 0, 0.5, 0));
  g.add(mesh(box(1.8, 0.5, 0.08), wood, 0, 0.85, -0.22));
  for (const s of [-1, 1]) g.add(mesh(box(0.1, 0.5, 0.45), mat('#33363d'), s * 0.75, 0.25, 0));
  return g;
}
function fountain(R, night, anims) {
  const g = new THREE.Group(), stone = mat('#b9bcc2'), wet = mat('#4aa3d8', { transparent: true, opacity: 0.85, roughness: 0.2 });
  g.add(mesh(cyl(1.7, 1.8, 0.5, 14), stone, 0, 0.25, 0));
  g.add(mesh(cyl(1.5, 1.5, 0.06, 14), wet, 0, 0.5, 0));
  g.add(mesh(cyl(0.2, 0.3, 1.3, 8), stone, 0, 1.0, 0));
  g.add(mesh(cyl(0.7, 0.3, 0.2, 10), stone, 0, 1.7, 0));
  const drops = [];
  for (let i = 0; i < 10; i++) { const d = mesh(ball(0.07, 0), wet); d.castShadow = false; drops.push(d); g.add(d); }
  anims.push((t) => drops.forEach((d, i) => {
    const k = (t * 0.9 + i / drops.length) % 1, a = i * 2.4;
    d.position.set(Math.cos(a) * k * 1.1, 1.8 + k * 1.6 - k * k * 2.9, Math.sin(a) * k * 1.1);
  }));
  return g;
}
function grave(R) {
  const g = new THREE.Group(), stone = mat('#8d9096');
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 1.5, z = (R() - 0.5) * 1.2;
    if (i % 2) {
      g.add(mesh(box(0.14, 1.1, 0.14), stone, x, 0.55, z));
      g.add(mesh(box(0.6, 0.14, 0.14), stone, x, 0.8, z));
    } else {
      const slab = mesh(box(0.7, 0.9, 0.16), stone, x, 0.45, z);
      slab.rotation.z = (R() - 0.5) * 0.2;
      g.add(slab);
      g.add(mesh(cyl(0.35, 0.35, 0.16, 10), stone, x, 0.9, z)).rotation.x = Math.PI / 2;
    }
  }
  return g;
}
function snowman() {
  const g = new THREE.Group(), snow = mat('#ffffff');
  g.add(mesh(ball(0.6, 2), snow, 0, 0.55, 0));
  g.add(mesh(ball(0.43, 2), snow, 0, 1.4, 0));
  g.add(mesh(ball(0.3, 2), snow, 0, 2.02, 0));
  const nose = mesh(cone(0.06, 0.3, 6), mat('#ff8c1a'), 0, 2.02, 0.4);
  nose.rotation.x = Math.PI / 2;
  g.add(nose);
  for (const s of [-1, 1]) g.add(mesh(ball(0.04, 1), mat('#15151a'), s * 0.11, 2.1, 0.27));
  g.add(mesh(cyl(0.2, 0.2, 0.3, 10), mat('#1d1d22'), 0, 2.42, 0));
  g.add(mesh(cyl(0.32, 0.32, 0.04, 10), mat('#1d1d22'), 0, 2.28, 0));
  return g;
}
function table() {
  const g = new THREE.Group(), wood = mat('#9a6a3c');
  g.add(mesh(box(2.2, 0.1, 1.1), wood, 0, 0.8, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(box(0.1, 0.8, 0.1), wood, sx * 1.0, 0.4, sz * 0.45));
  g.add(mesh(box(1.6, 0.02, 0.7), mat('#f4f1ea'), 0, 0.86, 0));
  const food = ['#d1495b', '#edae49', '#5a9e3d', '#f4f1ea'];
  food.forEach((c, i) => g.add(mesh(ball(0.13, 1), mat(c), (i - 1.5) * 0.42, 0.98, (i % 2) * 0.2 - 0.1)));
  return g;
}
function flag(R, night, anims) {
  const g = new THREE.Group();
  const colors = ['#e63946', '#f2c230', '#2a9d8f', '#3d5a80', '#f28482', '#8d5fd3'];
  for (const s of [-1, 1]) g.add(mesh(cyl(0.05, 0.06, 3.6, 6), mat('#5d3b22'), s * 3, 1.8, 0));
  const pennants = [];
  for (let i = 0; i < 9; i++) {
    const u = i / 8, x = -3 + u * 6, y = 3.5 - Math.sin(u * Math.PI) * 0.7;
    const f = mesh(cone(0.22, 0.5, 3), mat(colors[i % colors.length]), x, y - 0.25, 0);
    f.rotation.x = Math.PI;
    f.scale.z = 0.15;
    pennants.push(f);
    g.add(f);
  }
  anims.push((t) => pennants.forEach((f, i) => { f.rotation.z = Math.sin(t * 3 + i) * 0.25; }));
  return g;
}
function barrel(R) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const b = mesh(cyl(0.36, 0.36, 0.9, 10), mat('#8b5a36'), (i - 1) * 0.85, 0.45, i === 1 ? 0.4 : 0);
    b.add(mesh(cyl(0.375, 0.375, 0.08, 10), mat('#3a3d44'), 0, 0.25, 0));
    b.add(mesh(cyl(0.375, 0.375, 0.08, 10), mat('#3a3d44'), 0, -0.25, 0));
    g.add(b);
  }
  g.add(mesh(box(0.8, 0.8, 0.8), mat('#b08a5a'), 1.7, 0.4, -0.2));
  return g;
}
function mushroom(R) {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const k = 0.5 + R() * 0.9, x = (i - 1.5) * 0.9, z = (R() - 0.5) * 0.8;
    g.add(mesh(cyl(0.12 * k, 0.16 * k, 0.6 * k, 7), mat('#f3ead8'), x, 0.3 * k, z));
    const cap = mesh(ball(0.45 * k, 1), mat(i % 2 ? '#d1495b' : '#c98b4a'), x, 0.6 * k, z);
    cap.scale.y = 0.6;
    g.add(cap);
  }
  return g;
}
function stall(R) {
  const g = new THREE.Group(), wood = mat('#8b5a36');
  g.add(mesh(box(2.6, 0.9, 1.1), wood, 0, 0.45, 0));
  for (const sx of [-1, 1]) g.add(mesh(box(0.1, 2.4, 0.1), wood, sx * 1.25, 1.2, -0.5));
  for (let i = 0; i < 5; i++) {
    const strip = mesh(box(0.56, 0.08, 1.6), mat(i % 2 ? '#f4f1ea' : '#d1495b'), (i - 2) * 0.56, 2.35, 0.1);
    strip.rotation.x = 0.3;
    g.add(strip);
  }
  const goods = ['#edae49', '#d1495b', '#5a9e3d', '#f28c38'];
  for (let i = 0; i < 8; i++) g.add(mesh(ball(0.13, 1), mat(goods[i % 4]), (i - 3.5) * 0.3, 1.0, (i % 2) * 0.25));
  return g;
}
function pyramid() {
  const g = new THREE.Group();
  const p = mesh(cone(13, 15, 4), mat('#d9b266'), 0, 7.5, 0);
  p.rotation.y = Math.PI / 4;
  g.add(p);
  const q = mesh(cone(7, 8, 4), mat('#cfa558'), 15, 4, -6);
  q.rotation.y = Math.PI / 4;
  g.add(q);
  return g;
}
function igloo() {
  const g = new THREE.Group();
  const dome = mesh(new THREE.SphereGeometry(2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat('#f4f8fb'));
  g.add(dome);
  g.add(mesh(box(1.1, 1.0, 1.0), mat('#e6eef4'), 0, 0.5, 1.9));
  g.add(mesh(box(0.6, 0.7, 0.1), mat('#27303d'), 0, 0.35, 2.41));
  return g;
}
function bush(R) {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const b = mesh(ball(0.5 + R() * 0.3, 1), mat(mix('#3e8b3a', '#5fa346', R())), (i - 1.5) * 0.8, 0.4, (R() - 0.5) * 0.6);
    b.scale.y = 0.8;
    g.add(b);
    if (i % 2) g.add(mesh(ball(0.07, 0), mat('#d1495b'), (i - 1.5) * 0.8 + 0.2, 0.75, 0.3));
  }
  return g;
}
function signpost() {
  const g = new THREE.Group(), wood = mat('#8b5a36');
  g.add(mesh(cyl(0.07, 0.08, 2.4, 6), wood, 0, 1.2, 0));
  [[0.5, 2.1, 0.15], [-0.5, 1.7, -0.2]].forEach(([x, y, r]) => {
    const b = mesh(box(1.1, 0.26, 0.06), mat('#c9a063'), x, y, 0.06);
    b.rotation.z = r;
    g.add(b);
  });
  return g;
}
function pumpkin(R) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const k = 0.7 + R() * 0.5, x = (i - 1) * 0.9;
    const p = mesh(ball(0.4 * k, 1), mat('#f28c1a'), x, 0.3 * k, (i % 2) * 0.4);
    p.scale.y = 0.78;
    g.add(p);
    g.add(mesh(cyl(0.04, 0.05, 0.16, 5), mat('#3f6b2a'), x, 0.64 * k, (i % 2) * 0.4));
  }
  return g;
}
const PROP_BUILDERS = { bridge, fence, well, statue, windmill, bench, fountain, grave, snowman, table,
  flag, barrel, mushroom, stall, pyramid, igloo, bush, signpost, pumpkin, house, castle, tower, tent, campfire, chest, crystal, lamp,
  tree: (R) => tree(R, false), rock: (R) => { const r = rock(R); r.scale.multiplyScalar(1.8); return r; },
  flowers: (R) => { const g = new THREE.Group(); for (let i = 0; i < 4; i++) { const f = flowers(R); f.position.x = (i - 1.5) * 1.3; g.add(f); } return g; },
  cactus };

let windowTextures = null;
function buildingWindows() {
  // [wall colour map, emissive map with only the lit windows]
  if (windowTextures) return windowTextures;
  const R = mulberry(7), lit = [];
  for (let i = 0; i < 32; i++) lit.push(R() < 0.4);
  windowTextures = [false, true].map((emissive) => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = emissive ? '#000000' : '#ffffff';
    ctx.fillRect(0, 0, 64, 128);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
      ctx.fillStyle = emissive ? (lit[y * 4 + x] ? '#ffdf94' : '#000000') : '#56667a';
      ctx.fillRect(4 + x * 16, 4 + y * 16, 9, 10);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  });
  return windowTextures;
}

function scatter(R, n, rmin, rmax, fn) {
  for (let i = 0; i < n; i++) {
    let x = 0, z = 0, k = 0;
    do {
      const a = R() * Math.PI * 2, r = lerp(rmin, rmax, Math.sqrt(R()));
      x = Math.cos(a) * r; z = Math.sin(a) * r;
    } while (((Math.abs(z) < 7 && Math.abs(x) < 48) || (FLAT && z > -3)) && ++k < 40);  // keep the stage (and, in 2D, the foreground) clear
    const obj = fn(x, z, i);
    if (obj) { obj.position.x = x; obj.position.z = z; obj.rotation.y = R() * 6.28; }
  }
}

// ---------------------------------------------------------------- environment
const TIMES = {
  day: { sky: '#8fc7f5', sun: '#fff3d6', si: 2.4, ai: 1.25, dir: [30, 55, 25], disc: '#fff6c9' },
  dawn: { sky: '#f3c9b0', sun: '#ffd2a8', si: 1.7, ai: 1.0, dir: [55, 20, 20], disc: '#ffe0b0' },
  sunset: { sky: '#ef8f62', sun: '#ffae73', si: 1.8, ai: 0.9, dir: [-55, 16, 15], disc: '#ffd08a' },
  night: { sky: '#0b1233', sun: '#a9bcff', si: 1.1, ai: 0.85, dir: [-25, 50, 25], disc: '#f4f1de' },
};
const GROUND = { meadow: '#6fb04a', forest: '#3f7a3a', desert: '#e3c178', snow: '#f2f6fa',
  city: '#6b6f76', village: '#7fb356', mountain: '#7a9a5f', ocean: '#ecd9a0', lake: '#6fb04a',
  space: '#8d8f9a' };
const MOODS = {
  joyful: { bg: '#3a1d5c', colors: ['#ffd166', '#ff7aa2', '#7ae7ff'] },
  calm: { bg: '#0f2a3d', colors: ['#7ad3c0', '#8fb8ff', '#e0f4ff'] },
  sad: { bg: '#1c2330', colors: ['#6f87a8', '#9aa7b8', '#4a5a75'] },
  tense: { bg: '#2a0d12', colors: ['#ff4d4d', '#ff9f1c', '#c1121f'] },
  mysterious: { bg: '#170f2e', colors: ['#b388ff', '#5eead4', '#f0abfc'] },
  neutral: { bg: '#141a2a', colors: ['#8fb8ff', '#ffd166', '#a7f3d0'] },
};

function environment(sc) {
  const T = TIMES[sc.time] || TIMES.day;
  const space = sc.setting === 'space';
  let sky = new THREE.Color(space ? '#02030a' : T.sky);
  let si = T.si, ai = T.ai, fog = [45, 190];
  if (sc.weather === 'rain' || sc.weather === 'storm') {
    sky.lerp(new THREE.Color(sc.time === 'night' ? '#151a26' : '#5b6673'), 0.75);
    si *= 0.45; ai *= 0.85; fog = [25, 120];
  } else if (sc.weather === 'fog') {
    sky.lerp(new THREE.Color(sc.time === 'night' ? '#2a3040' : '#c9d1d6'), 0.7);
    si *= 0.6; fog = [6, 55];
  } else if (sc.weather === 'snow') {
    sky.lerp(new THREE.Color(sc.time === 'night' ? '#27304a' : '#dfe7ee'), 0.6);
    si *= 0.7; fog = [25, 130];
  }
  if (sc.mood === 'sad') sky.lerp(new THREE.Color('#6d7682'), 0.3);
  if (sc.mood === 'tense') sky.multiplyScalar(0.78);
  if (sc.mood === 'mysterious') sky.lerp(new THREE.Color('#3a2a5c'), 0.3);
  if (space) fog = [200, 900];
  return { sky, sunColor: new THREE.Color(space ? '#ffffff' : T.sun), si: space ? 2.2 : si,
    ai: space ? 0.5 : ai, dir: new THREE.Vector3(...T.dir).normalize(), fog,
    storm: sc.weather === 'storm', disc: T.disc };
}

function starField(R, n, radius) {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, e = Math.asin(R() * 0.98 + 0.02);
    pos.set([Math.cos(a) * Math.cos(e) * radius, Math.sin(e) * radius, Math.sin(a) * Math.cos(e) * radius], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 1.8,
    sizeAttenuation: false, fog: false, transparent: true, opacity: 0.9 }));
}

function precipitation(R, kind, anims, root) {
  const H = 34, n = kind === 'snow' ? 1400 : 1100, geo = new THREE.BufferGeometry();
  const holder = new THREE.Group();
  if (kind === 'snow') {
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([(R() - 0.5) * 80, R() * H, (R() - 0.5) * 80], i * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: '#ffffff', size: 0.16, transparent: true, opacity: 0.9 });
    for (const dy of [0, H]) { const p = new THREE.Points(geo, m); p.position.y = dy; holder.add(p); }
    anims.push((t) => { holder.position.set(Math.sin(t * 0.6) * 0.8, -((t * 2.2) % H), 0); });
  } else {
    const pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const x = (R() - 0.5) * 80, y = R() * H, z = (R() - 0.5) * 80;
      pos.set([x, y, z, x + 0.12, y - 0.8, z], i * 6);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.LineBasicMaterial({ color: '#b9cbe0', transparent: true, opacity: 0.55 });
    for (const dy of [0, H]) { const p = new THREE.LineSegments(geo, m); p.position.y = dy; holder.add(p); }
    anims.push((t) => { holder.position.y = -((t * 26) % H); });
  }
  root.add(holder);
}

// ---------------------------------------------------------------- shots
function buildWorldShot(sc, idx) {
  const R = mulberry(STORY.seed + idx * 7919 + hashStr(sc.setting));
  const root = new THREE.Group(), anims = [];
  const env = environment(sc);
  const night = sc.time === 'night', setting = sc.setting;
  const snowy = setting === 'snow' || sc.weather === 'snow';
  const water = setting === 'ocean' || setting === 'lake';
  const space = setting === 'space';
  const add = (o) => { root.add(o); return o; };

  // cast
  const actors = [];
  sc.actors.forEach((spec) => {
    for (let i = 0; i < spec.count; i++) actors.push(makeActor({ ...spec, name: i ? null : spec.name }, actors.length, null));
  });
  // Ambient actors are background life: never on the stage mark, never followed by the camera.
  const cast = actors.filter((a) => !a.ambient), extras = actors.filter((a) => a.ambient);
  const landActors = actors.filter((a) => !a.aquatic && !(a.ambient && a.flying));
  const centreIsland = water && (landActors.length > 0 || sc.props.length > 0);

  // ground
  const groundColor = snowy ? GROUND.snow : GROUND[setting] || GROUND.meadow;
  if (water) {
    const geo = new THREE.PlaneGeometry(500, 500, 60, 60);
    geo.rotateX(-Math.PI / 2);
    const sea = new THREE.Mesh(geo, mat(setting === 'ocean' ? '#2f86b8' : '#3f93b0', {
      roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.93 }));
    sea.position.y = WATER_Y;
    sea.receiveShadow = true;
    add(sea);
    const p = geo.attributes.position, base = p.array.slice();
    anims.push((t) => {
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], z = base[i * 3 + 2];
        p.array[i * 3 + 1] = Math.sin(x * 0.18 + t * 1.3) * 0.16 + Math.cos(z * 0.22 + t * 1.1) * 0.14;
      }
      p.needsUpdate = true;
    });
    const island = add(mesh(cyl(12, 17, 1.4, 28), mat(groundColor), 0, -0.7, 0));
    island.castShadow = false;
    if (!centreIsland) island.position.set(-34, -0.7, -30);
    const palm = setting === 'ocean';
    for (let i = 0; i < 7; i++) {
      const tr = add(tree(R, snowy, palm)), a = R() * 6.28, r = 3 + R() * 7;
      if (centreIsland) tr.position.set((i % 2 ? 1 : -1) * (5.5 + R() * 4.5), 0, -1 - R() * 5);  // frame the stage
      else tr.position.set(island.position.x + Math.cos(a) * r, 0, island.position.z + Math.sin(a) * r);
    }
    scatter(R, 8, 40, 120, () => { const r = add(rock(R)); r.scale.multiplyScalar(2.5); return r; });
  } else {
    const ground = add(mesh(new THREE.CircleGeometry(320, 64), mat(groundColor)));
    ground.rotation.x = -Math.PI / 2;
    ground.castShadow = false;
  }

  // scenery
  const hills = (n, color) => scatter(R, n, 95, 150, () => {
    const h = add(mesh(ball(26 + R() * 18, 1), mat(color)));
    h.scale.y = 0.35 + R() * 0.25; h.castShadow = false; h.position.y = -3;
    return h;
  });
  const hillColor = mix(groundColor, '#2a4a35', snowy ? 0.05 : 0.3);
  if (setting === 'forest') {
    scatter(R, 110, 11, 90, () => add(R() < 0.6 ? pine(R, snowy) : tree(R, snowy)));
    scatter(R, 14, 9, 50, () => add(rock(R)));
    hills(8, hillColor);
  } else if (setting === 'meadow' || setting === 'lake' && false) {
    scatter(R, 16, 14, 80, () => add(tree(R, snowy)));
    if (!snowy) scatter(R, 46, 5, 34, () => add(flowers(R)));
    scatter(R, 6, 10, 50, () => add(rock(R)));
    hills(10, hillColor);
  } else if (setting === 'village') {
    scatter(R, 9, 14, 42, () => add(house(R, night)));
    scatter(R, 14, 12, 70, () => add(tree(R, snowy)));
    if (!snowy) scatter(R, 20, 5, 30, () => add(flowers(R)));
    hills(10, hillColor);
  } else if (setting === 'desert') {
    scatter(R, 14, 11, 70, () => add(cactus(R)));
    scatter(R, 12, 9, 60, () => add(rock(R, '#b98b5e')));
    scatter(R, 14, 45, 150, () => {
      const d = add(mesh(ball(18 + R() * 16, 1), mat('#dcb86c')));
      d.scale.y = 0.22; d.castShadow = false; d.position.y = -1.5;
      return d;
    });
  } else if (setting === 'snow') {
    scatter(R, 34, 11, 85, () => add(pine(R, true)));
    scatter(R, 16, 9, 70, () => {
      const m = add(mesh(ball(2 + R() * 3, 1), mat('#ffffff')));
      m.scale.y = 0.35; m.position.y = -0.2;
      return m;
    });
    hills(10, '#dfe8f0');
  } else if (setting === 'mountain') {
    scatter(R, 12, 70, 130, () => {
      const g = new THREE.Group(), h = 34 + R() * 34, r = 24 + R() * 14;
      g.add(mesh(cone(r, h, 6), mat(mix('#6f7684', '#8a8f9c', R())), 0, h / 2 - 1, 0));
      g.add(mesh(cone(r * 0.32, h * 0.32, 6), mat('#f6f9fc'), 0, h * 0.84 - 1, 0));
      g.children.forEach((c) => { c.castShadow = false; });
      return add(g);
    });
    scatter(R, 30, 11, 70, () => add(pine(R, snowy)));
    scatter(R, 18, 9, 60, () => add(rock(R)));
  } else if (setting === 'city') {
    const road = add(mesh(box(400, 0.04, 7), mat('#33363d'), 0, 0.02, 0));
    road.castShadow = false;
    for (let x = -100; x <= 100; x += 5) add(mesh(box(2, 0.02, 0.18), mat('#e9e2b5'), x, 0.05, 0)).castShadow = false;
    const tex = buildingWindows();
    for (let gx = -8; gx <= 8; gx++) for (const row of [-4, -3, -2, -1, 1, 2, 3]) {
      if (R() < 0.12 || (FLAT && row > 0)) continue;
      const w = 6 + R() * 4, d = 6 + R() * 4, h = 7 + R() * R() * 34;
      const [map, emissiveMap] = tex.map((x) => {
        const copy = x.clone();
        copy.needsUpdate = true;
        copy.repeat.set(Math.round(w / 3), Math.round(h / 6));
        return copy;
      });
      const m = mat(mix('#8f98a6', '#c9b8a6', R()), { map, emissive: '#ffffff', emissiveMap,
        emissiveIntensity: night ? 1.4 : 0, flatShading: false });
      add(mesh(box(w, h, d), m, gx * 12 + (R() - 0.5) * 2, h / 2, row * 12 + Math.sign(row) * 1.5));
    }
    for (let x = -42; x <= 42; x += 14) { const l = add(lamp(R, false)); l.position.set(x, 0, -4.3); }
  } else if (space) {
    scatter(R, 30, 9, 90, () => add(rock(R, '#6f717c')));
    scatter(R, 16, 9, 80, () => {
      const c = add(mesh(new THREE.CircleGeometry(1.5 + R() * 3, 16), mat('#74768a')));
      c.rotation.x = -Math.PI / 2; c.position.y = 0.02; c.castShadow = false;
      return null || (c.userData.keep = c);
    });
    const planets = [['#4f8fd9', 26, [-90, 70, -160]], ['#e0a05a', 12, [120, 95, -140]], ['#c084fc', 7, [40, 130, -170]]];
    planets.forEach(([color, r, p], i) => {
      const pl = add(new THREE.Mesh(ball(r, 2), new THREE.MeshStandardMaterial({ color, flatShading: true, fog: false })));
      pl.position.set(...p);
      if (i === 1) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r * 1.4, r * 2.1, 40),
          new THREE.MeshBasicMaterial({ color: '#f1d9b0', side: THREE.DoubleSide, transparent: true, opacity: 0.7, fog: false }));
        ring.rotation.x = 1.2;
        pl.add(ring);
      }
      anims.push((t) => { pl.rotation.y = t * 0.05; });
    });
  } else if (setting === 'lake') {
    scatter(R, 10, 70, 140, () => {
      const h = add(mesh(ball(24 + R() * 14, 1), mat('#4f8a4a')));
      h.scale.y = 0.4; h.castShadow = false; h.position.y = -3;
      return h;
    });
  }

  // sky
  if (night || space) add(starField(R, 700, 420));
  const clearSky = sc.weather === 'clear';
  if (clearSky && !space) {
    const disc = add(new THREE.Mesh(ball(night ? 9 : sc.time === 'day' ? 11 : 16, 3),
      new THREE.MeshBasicMaterial({ color: env.disc, fog: false })));
    disc.position.copy(env.dir).multiplyScalar(330);
    if (FLAT) disc.position.set(sc.time === 'sunset' ? -30 : 30, sc.time === 'day' || night ? 30 : 14, -330);
  }
  if (!space) {
    const cloudColor = night ? '#2a3350' : clearSky ? '#ffffff' : '#8d96a3';
    const cm = new THREE.MeshStandardMaterial({ color: cloudColor, flatShading: true, roughness: 1,
      transparent: true, opacity: night ? 0.7 : 0.95 });
    const count = clearSky ? 9 : 22;
    for (let i = 0; i < count; i++) {
      const c = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const puff = new THREE.Mesh(ball(3 + R() * 3, 1), cm);
        puff.position.set(k * 3.6 - 5, R() * 1.5, R() * 3);
        puff.scale.y = 0.6;
        c.add(puff);
      }
      const x0 = (R() - 0.5) * 300, speed = 0.6 + R() * 0.8;
      c.position.set(x0, 34 + R() * 22, -40 - R() * 140 + (i % 3 === 0 ? 150 : 0));
      c.scale.setScalar(1 + R() * 1.4);
      add(c);
      anims.push((t) => { c.position.x = x0 + t * speed; });
    }
  }
  if (sc.weather === 'rain' || sc.weather === 'storm') precipitation(R, 'rain', anims, root);
  if (sc.weather === 'snow') precipitation(R, 'snow', anims, root);

  // props sit in an arc behind the stage
  sc.props.forEach((p, i) => {
    const build = PROP_BUILDERS[p.base];
    if (!build) return;
    const obj = add(build(R, night, anims));
    // In 2D a prop straight behind the cast would hide behind them, so the arc starts off-centre.
    const a = -Math.PI / 2 + (i - (sc.props.length - 1) / 2) * 0.75 + (FLAT ? 0.6 : 0);
    const pr = centreIsland ? Math.min(p.r, 8.5) : p.r;
    obj.position.x = Math.cos(a) * pr;
    obj.position.z = Math.sin(a) * pr - 1.2;
    obj.rotation.y = -(a + Math.PI / 2) * 0.6;
  });

  // place the cast in a row across the stage
  const total = cast.reduce((s, a) => s + a.width, 0);
  let cursor = -total / 2;
  const mixedPace = cast.some((a) => a.moving) && cast.some((a) => !a.moving && !a.flying);
  extras.forEach((a, j) => {
    const spread = centreIsland ? 5 : 14;
    a.x0 = (R() - 0.5) * spread + (j % 2 ? 3 : -3);
    a.z0 = a.base === 'car' ? -2.2 : -3.6 - R() * (centreIsland ? 2 : 4);
    a.facing = (R() - 0.5) * 1.6;
    if (a.aquatic) {
      a.y0 = water ? WATER_Y : 0;
      a.z0 = centreIsland ? -16 - j * 3 : -7 - j * 4;
    }
    root.add(a.wrap);
  });
  cast.forEach((a, j) => {
    a.x0 = cursor + a.width / 2;
    cursor += a.width;
    a.z0 = cast.length > 1 ? (j % 2 ? 0.55 : -0.55) : 0;
    if (a.aquatic) {
      a.y0 = water ? WATER_Y : 0;
      if (centreIsland) a.z0 -= 16;
    } else if (mixedPace && a.moving) {
      a.z0 += 1.9;                       // walkers pass in front of whoever stands still
    }
    root.add(a.wrap);
  });
  const fighters = cast.filter((a) => FIGHTING.has(a.action));
  const duel = fighters.length > 1;
  fighters.forEach((a) => { a.duel = duel; });
  const toTheDeath = fighters.some((a) => a.action !== 'fight');
  const facing = (duel || sc.actors.some((s) => !s.ambient && s.action === 'talk')) && cast.length > 1;
  // Sparks where the blows land.
  const spark = new THREE.Group();
  if (duel) {
    for (let i = 0; i < 7; i++) {
      const ray = mesh(box(0.07, 0.07, 0.9), glow(i % 2 ? '#fff3b0' : '#ffb347', 3));
      ray.castShadow = false;
      ray.rotation.set(R() * 6, R() * 6, R() * 6);
      spark.add(ray);
    }
    spark.visible = false;
    root.add(spark);
  }
  const mid = (cast.length - 1) / 2;
  // Duellists stand a stride apart so their lunges meet in the middle.
  if (duel) cast.forEach((a, j) => { a.x0 += (j <= mid ? -1 : 1) * (0.9 + (a.base === 'quad' ? a.width * 0.2 : 0)); });
  cast.forEach((a, j) => { a.facing = facing ? (j <= mid ? Math.PI / 2 : -Math.PI / 2) : (j - mid) * -0.12; });

  const biggest = cast.reduce((m, a) => Math.max(m, a.scale), 1);
  // The camera follows the grounded cast when there is one, otherwise whoever is on screen.
  let leads = cast.filter((a) => !a.flying && !(a.aquatic && centreIsland));
  const allFlying = cast.length > 0 && !leads.length;
  if (!leads.length) leads = cast;
  const dist = cast.length ? clamp(6.5 + total * 0.5 + (biggest - 1) * 2.5 + (allFlying ? 5 : 0), 7, 26)
    : FLAT ? 13 : sc.props.length ? 16 : extras.length ? 19 : 24;
  const cam = FLAT ? flatRig(sc.camera, dist) : cameraRig(sc.camera, R() * 1.2 - 0.6, dist, sc.mood === 'tense');
  const focus = new THREE.Vector3(0, 2, 0);

  if (FLAT) flatten(root, env);
  return {
    root, env, duration: sc.duration,
    update(t, camera) {
      anims.forEach((fn) => fn(t));
      actors.forEach((a) => a.update(t, sc.duration));
      if (cast.length) {
        focus.set(0, 0, 0);
        leads.forEach((a) => focus.add(a.focus));
        focus.multiplyScalar(1 / leads.length);
      }
      let impact = 0;
      if (duel && (!toTheDeath || t < sc.duration * DUEL_END)) {
        const p = (t / BEAT) % 1;
        impact = p > 0.4 && p < 0.58 ? Math.sin(Math.PI * (p - 0.4) / 0.18) : 0;
      }
      spark.visible = impact > 0;
      if (impact) {
        spark.position.copy(fighters[0].focus).add(fighters[fighters.length - 1].focus).multiplyScalar(0.5);
        spark.scale.setScalar(0.4 + impact * 1.1);
        spark.rotation.z = Math.floor(t / BEAT) * 1.3;
      }
      if (cast.length) {
      } else if (sc.props.length) {
        focus.set(0, 2.2, -Math.min(sc.props[0].r, 12) * 0.6);
      } else if (extras.length) {
        focus.set(0, 1.8, -4);
      }
      cam(t, sc.duration, focus, camera);
      if (impact) {                                   // the camera feels each hit
        camera.position.x += Math.sin(t * 95) * 0.07 * impact;
        camera.position.y += Math.cos(t * 80) * 0.05 * impact;
      }
    },
  };
}

function buildAbstractShot(sc, idx) {
  const R = mulberry(STORY.seed + idx * 104729);
  const mood = MOODS[sc.mood] || MOODS.neutral;
  const root = new THREE.Group(), anims = [];
  root.add(starField(R, 500, 300));
  const core = mesh(ball(2.2, 1), mat(mood.colors[0], { roughness: 0.4, metalness: 0.2 }), 0, 4, 0);
  const cage = new THREE.Mesh(ball(3.1, 1), new THREE.MeshBasicMaterial({ color: mood.colors[2], wireframe: true, fog: false }));
  cage.position.y = 4;
  root.add(core, cage);
  const glowLight = new THREE.PointLight(mood.colors[1], 120, 60);
  glowLight.position.set(0, 4, 0);
  root.add(glowLight);
  const beat = sc.mood === 'tense' ? 5 : sc.mood === 'joyful' ? 3.2 : 1.4;
  anims.push((t) => {
    core.rotation.set(t * 0.3, t * 0.45, 0);
    cage.rotation.set(-t * 0.2, t * 0.15, t * 0.1);
    core.scale.setScalar(1 + Math.sin(t * beat) * 0.07);
  });
  const shapes = [() => new THREE.TetrahedronGeometry(0.5), () => new THREE.OctahedronGeometry(0.45),
    () => box(0.6, 0.6, 0.6), () => ball(0.4, 0)];
  for (let i = 0; i < 34; i++) {
    const m = mesh(shapes[i % 4](), mat(mood.colors[i % 3], { roughness: 0.5 }));
    const r = 5 + R() * 9, a0 = R() * 6.28, y0 = 1 + R() * 7, sp = (0.15 + R() * 0.35) * (i % 2 ? 1 : -1), ph = R() * 6;
    root.add(m);
    anims.push((t) => {
      const a = a0 + t * sp;
      m.position.set(Math.cos(a) * r, y0 + Math.sin(t * 0.8 + ph) * 0.7, Math.sin(a) * r);
      m.rotation.set(t * 0.7 + ph, t * 0.5, 0);
    });
  }
  (sc.keywords || []).forEach((word, i, all) => {
    const s = textSprite(word, { height: 1.0, color: i % 2 ? mood.colors[2] : '#ffffff' });
    const a0 = (i / all.length) * Math.PI * 2, y0 = 2.6 + (i % 2) * 2.6;
    root.add(s);
    anims.push((t) => {
      const a = a0 + t * 0.22;
      s.position.set(Math.sin(a) * 6.2, y0 + Math.sin(t * 0.9 + i) * 0.3, Math.cos(a) * 6.2);
    });
  });
  const floor = mesh(new THREE.CircleGeometry(60, 48), mat(mix(mood.bg, '#000000', 0.2), { roughness: 0.6 }));
  floor.rotation.x = -Math.PI / 2;
  floor.castShadow = false;
  root.add(floor);
  const sky = new THREE.Color(mood.bg);
  const env = { sky, sunColor: new THREE.Color('#ffffff'), si: 1.4, ai: 0.9,
    dir: new THREE.Vector3(0.4, 0.8, 0.5).normalize(), fog: [25, 90], storm: false };
  const cam = FLAT ? flatRig('orbit', 15) : cameraRig('orbit', R() * 6, 15, sc.mood === 'tense');
  const focus = new THREE.Vector3(0, 4, 0);
  if (FLAT) flatten(root, env);
  return { root, env, duration: sc.duration,
    update(t, camera) { anims.forEach((fn) => fn(t)); cam(t, sc.duration, focus, camera); } };
}

// 2D style: swap every lit material for a flat colour, tinted by the time of day.
function flatten(root, env) {
  const k = clamp(0.35 + env.si * 0.3, 0.5, 1);
  const tint = env.sunColor.clone().lerp(new THREE.Color('#ffffff'), 0.5).multiplyScalar(k);
  const done = new Map();
  root.traverse((o) => {
    const m = o.material;
    if (!o.isMesh || !m || !m.isMeshStandardMaterial) return;
    if (!done.has(m)) {
      const lit = m.emissiveIntensity > 0.5 && m.emissive.getHex() !== 0;
      const windows = lit && m.emissiveMap;
      done.set(m, new THREE.MeshBasicMaterial({
        color: windows ? new THREE.Color('#ffffff') : lit ? m.emissive.clone() : m.color.clone().multiply(tint),
        map: windows ? m.emissiveMap : m.map, transparent: m.transparent, opacity: m.opacity,
        fog: m.fog, side: m.side }));
    }
    o.material = done.get(m);
  });
}

function flatRig(mode, dist) {
  const half = Math.tan((FLAT_FOV / 2) * Math.PI / 180), pitch = Math.tan(2.2 * Math.PI / 180);
  return (t, dur, focus, camera) => {
    const u = clamp(t / dur, 0, 1);
    let H = dist * 0.92;
    if (mode === 'dolly') H *= 1.45 - 0.45 * ease(u);
    const panX = mode === 'orbit' ? (u - 0.5) * dist * 0.35 : 0;
    const panY = mode === 'crane' ? (1 - ease(u)) * H * 0.1 : 0;
    const D = H / (2 * half);
    const tx = focus.x + panX, ty = focus.y + H * 0.06 + panY;
    camera.position.set(tx, ty + D * pitch, focus.z + D);
    camera.lookAt(tx, ty, focus.z);
    camera.userData.fogShift = D;
  };
}

function cameraRig(mode, a0, dist, shaky) {
  const target = new THREE.Vector3();
  return (t, dur, focus, camera) => {
    const u = clamp(t / dur, 0, 1);
    let a = a0, d = dist, h = dist * 0.32 + 1.2;
    if (mode === 'orbit') a += u * 1.1 - 0.55;
    else if (mode === 'dolly') { d *= 1.75 - 0.75 * ease(u); a += u * 0.25; h = d * 0.3 + 1; }
    else if (mode === 'crane') { h = lerp(dist * 0.12 + 0.8, dist * 0.75, ease(u)); a += u * 0.5 - 0.25; d *= 1.15; }
    else if (mode === 'track') { a = 0.28 + Math.sin(u * Math.PI) * 0.2; d = Math.min(dist, 9.5); h = d * 0.28 + 1; }
    target.copy(focus);
    camera.position.set(focus.x + Math.sin(a) * d, Math.max(0.9, focus.y + h - 1), focus.z + Math.cos(a) * d);
    if (shaky) {
      camera.position.x += Math.sin(t * 17) * 0.05;
      camera.position.y += Math.sin(t * 23) * 0.04;
    }
    camera.lookAt(target);
  };
}

// ---------------------------------------------------------------- player
function start() {
  const canvas = $('stage'), wrap = $('wrap');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = !FLAT;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (!FLAT) renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#000000', 40, 190);
  const camera = new THREE.PerspectiveCamera(FLAT ? FLAT_FOV : 48, 16 / 9, 0.5, 1600);
  const hemi = new THREE.HemisphereLight('#ffffff', '#55604a', 1);
  const sun = new THREE.DirectionalLight('#ffffff', 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 220 });
  sun.shadow.bias = -0.0005;
  scene.add(hemi, sun, sun.target);

  const scenes = STORY.scenes;
  const starts = [];
  let total = 0;
  scenes.forEach((s) => { starts.push(total); total += s.duration; });
  const shots = [];
  let T = 0, playing = true, current = -1, shot = null, last = performance.now(), fade = 0, caption = '';
  let recorder = null, recCanvas = null, recCtx = null;

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function resize() {
    const w = wrap.clientWidth || 800, h = wrap.clientHeight || 450;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(wrap);
  resize();

  function captionAt(sc, t) {
    const caps = sc.captions;
    if (caps.length === 1) return caps[0];
    const sum = caps.reduce((s, c) => s + c.length, 0);
    let acc = 0;
    for (const c of caps) { acc += (c.length / sum) * sc.duration; if (t < acc) return c; }
    return caps[caps.length - 1];
  }

  function draw() {
    let i = scenes.length - 1;
    while (i > 0 && T < starts[i]) i--;
    const sc = scenes[i], t = clamp(T - starts[i], 0, sc.duration);
    if (i !== current) {
      if (shot) scene.remove(shot.root);
      shot = shots[i] || (shots[i] = sc.abstract ? buildAbstractShot(sc, i) : buildWorldShot(sc, i));
      scene.add(shot.root);
      current = i;
      const e = shot.env;
      sun.color.copy(e.sunColor);
      hemi.color.copy(e.sky).lerp(new THREE.Color('#ffffff'), 0.6);
      $('badge').textContent = `Scene ${i + 1} / ${scenes.length}`;
    }
    const e = shot.env;
    const k = Math.floor(t / 2.3), ph = t / 2.3 - k;
    const flash = e.storm && mulberry(k + current * 31)() > 0.45 && ph < 0.07 ? 1 : 0;
    scene.background = flash ? e.sky.clone().lerp(new THREE.Color('#dfe6ff'), 0.6) : e.sky;
    scene.fog.color.copy(scene.background);
    sun.intensity = e.si + flash * 5;
    hemi.intensity = e.ai + flash * 2;
    shot.update(t, camera);
    const shift = camera.userData.fogShift || 0;   // the 2D camera sits far back
    scene.fog.near = e.fog[0] + shift;
    scene.fog.far = e.fog[1] + shift;
    sun.target.position.set(camera.position.x * 0.3, 0, camera.position.z * 0.3);
    sun.position.copy(sun.target.position).addScaledVector(e.dir, 90);

    fade = 1 - clamp(Math.min(t / FADE, (sc.duration - t) / FADE), 0, 1);
    $('fade').style.opacity = fade;
    caption = SHOW_CAPTIONS ? captionAt(sc, t) : '';
    if ($('caption').textContent !== caption) $('caption').textContent = caption;
    $('seek').value = Math.round((T / total) * 1000);
    $('time').textContent = `${fmt(T)} / ${fmt(total)}`;
    renderer.render(scene, camera);
    if (recorder) drawRecordingFrame();
  }

  function drawRecordingFrame() {
    const w = recCanvas.width, h = recCanvas.height;
    recCtx.drawImage(canvas, 0, 0, w, h);
    if (fade > 0) { recCtx.fillStyle = `rgba(0,0,0,${fade})`; recCtx.fillRect(0, 0, w, h); }
    if (!caption) return;
    const size = Math.round(h * 0.042);
    recCtx.font = `500 ${size}px system-ui, sans-serif`;
    recCtx.textAlign = 'center';
    const lines = [];
    let line = '';
    for (const word of caption.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (recCtx.measureText(next).width > w * 0.8 && line) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
    const lh = size * 1.35, y0 = h - size * 1.6 - lines.length * lh;
    recCtx.fillStyle = 'rgba(0,0,0,.5)';
    recCtx.fillRect(w * 0.08, y0 - size * 0.4, w * 0.84, lines.length * lh + size * 0.6);
    recCtx.fillStyle = '#fff';
    lines.forEach((l, i) => recCtx.fillText(l, w / 2, y0 + size * 0.85 + i * lh));
  }

  function setPlaying(on) {
    playing = on;
    $('play').textContent = on ? 'Pause' : T >= total - 0.05 ? 'Replay' : 'Play';
  }
  function stopRecording() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }
  function startRecording() {
    if (recorder) { stopRecording(); return; }
    const type = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(
      (m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
    if (!type) { alert('This browser cannot record video.'); return; }
    recCanvas = document.createElement('canvas');
    recCanvas.width = canvas.width;
    recCanvas.height = canvas.height;
    recCtx = recCanvas.getContext('2d');
    const chunks = [];
    recorder = new MediaRecorder(recCanvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 8e6 });
    recorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
    recorder.onstop = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(chunks, { type }));
      a.download = `story3d.${type.includes('mp4') ? 'mp4' : 'webm'}`;
      a.click();
      recorder = null;
      $('rec').textContent = 'Record';
      $('rec').classList.remove('on');
    };
    T = 0;
    setPlaying(true);
    recorder.start();
    $('rec').textContent = 'Stop recording';
    $('rec').classList.add('on');
  }

  $('play').onclick = () => { if (!playing && T >= total - 0.05) T = 0; setPlaying(!playing); };
  $('seek').oninput = (ev) => { T = (ev.target.value / 1000) * total; if (!playing) setPlaying(false); };
  $('rec').onclick = startRecording;
  $('full').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : wrap.requestFullscreen());
  window.addEventListener('keydown', (ev) => { if (ev.code === 'Space') { ev.preventDefault(); $('play').click(); } });
  // Test hook: jump to a time and render one frame.
  window.story3d = { seek(time) { T = clamp(time, 0, total); setPlaying(false); draw(); }, total };

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      T += dt;
      if (T >= total) { T = total; setPlaying(false); stopRecording(); }
    }
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function fail(message) {
  const el = $('error');
  el.style.display = 'flex';
  el.textContent = message;
  $('bar').style.display = 'none';
}

if (!STORY.scenes || !STORY.scenes.length) {
  fail('Nothing to animate yet. Enter some text first.');
} else {
  try { start(); } catch (err) {
    console.error(err);
    fail(`Could not start the 3D viewer (${err.message}). WebGL may be disabled in this browser.`);
  }
}
