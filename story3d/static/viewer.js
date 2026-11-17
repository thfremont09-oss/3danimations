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
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });
// Faceted look for rocks, crystals and far scenery.
const flat = (color, o = {}) => mat(color, { flatShading: true, roughness: 0.95, ...o });
const glow = (color, k = 1.5) => mat(color, { emissive: color, emissiveIntensity: k });
function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const ico = (r, detail = 0) => new THREE.IcosahedronGeometry(r, detail);
const ball = (r, detail = 1) => (detail ? new THREE.SphereGeometry(r, 20, 14) : ico(r, 0));
const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 14);
function facet(geo) {             // hard edges: roofs, pyramids, trunks
  const g = geo.toNonIndexed();
  g.computeVertexNormals();
  return g;
}
const cyl = (rt, rb, h, s = 16) => (s <= 8 ? facet(new THREE.CylinderGeometry(rt, rb, h, s)) : new THREE.CylinderGeometry(rt, rb, h, s));
const cone = (r, h, s = 16) => (s <= 8 ? facet(new THREE.ConeGeometry(r, h, s)) : new THREE.ConeGeometry(r, h, s));
let groundNoise = null;
function noiseTexture() {         // soft mottling so grass, sand and snow are not one flat colour
  if (groundNoise) return groundNoise;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d'), R = mulberry(11);
  ctx.fillStyle = '#e9e9e9';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const x = R() * 256, y = R() * 256, r = 2 + R() * 16, dark = R() < 0.5;
    ctx.fillStyle = dark ? `rgba(0,0,0,${0.012 + R() * 0.025})` : `rgba(255,255,255,${0.02 + R() * 0.035})`;
    for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) {
      ctx.beginPath(); ctx.arc(x + dx, y + dy, r, 0, 6.3); ctx.fill();
    }
  }
  groundNoise = new THREE.CanvasTexture(c);
  groundNoise.colorSpace = THREE.SRGBColorSpace;
  groundNoise.wrapS = groundNoise.wrapT = THREE.RepeatWrapping;
  return groundNoise;
}
function groundMat(color, repeat) {
  if (FLAT) return mat(color);
  const map = noiseTexture().clone();
  map.needsUpdate = true;
  map.repeat.set(repeat, repeat);
  return mat(color, { map, roughness: 0.95 });
}
const patterns = {};
function patternTexture(kind, base, ink) {   // stripes and spots for animal coats
  const key = kind + base + ink;
  if (patterns[key]) return patterns[key];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d'), R = mulberry(hashStr(key));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  if (kind === 'stripes') {
    ctx.lineWidth = 7;
    for (let x = 4; x < 128; x += 18) {
      ctx.beginPath(); ctx.moveTo(x, 0);
      for (let y = 0; y <= 128; y += 16) ctx.lineTo(x + Math.sin(y * 0.2 + x) * 5, y);
      ctx.stroke();
    }
  } else {
    for (let i = 0; i < 26; i++) {
      ctx.beginPath(); ctx.ellipse(R() * 128, R() * 128, 5 + R() * 9, 4 + R() * 7, R() * 3, 0, 6.3); ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(kind === 'stripes' ? 2 : 3, kind === 'stripes' ? 1 : 2);
  return (patterns[key] = tex);
}

const put = (parent, child) => { parent.add(child); return child; };
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

const SKIN = ['#f6d3b3', '#eec39a', '#d9a577', '#b97f52', '#8d5a3b', '#6b4226'];
const HAIR = ['#1c1a17', '#3b2a1a', '#6b4423', '#a8703a', '#d9b36c', '#8c8c8c', '#b5452c'];
const TROUSERS = ['#2f3542', '#3b4a6b', '#5a4632', '#40454f'];

function buildPerson(o, id) {
  const g = new THREE.Group(), h = hashStr(id), pick = mulberry(h);
  const any = (list) => list[Math.floor(pick() * list.length)];
  const color = o.color || any(PALETTE);
  const ghost = o.ghost ? { transparent: true, opacity: 0.6 } : {};
  const steel = { metalness: 0.8, roughness: 0.3 };
  const cloth = mat(color, o.armor ? steel : ghost);
  const skin = mat(o.skin || any(SKIN), ghost);
  const pants = mat(o.armor ? '#8892a0' : any(TROUSERS), o.armor ? steel : {});
  const legs = [], arms = [];
  if (o.robe) {
    g.add(mesh(cyl(0.2, 0.5, 1.25, 20), cloth, 0, 0.66, 0));
  } else {
    const torso = mesh(capsule(0.19, 0.34), cloth, 0, 1.08, 0);
    torso.scale.set(1.15, 1, 0.8);
    g.add(torso);
    const hips = mesh(ball(0.2), pants, 0, 0.82, 0);
    hips.scale.set(1.1, 0.7, 0.85);
    g.add(hips);
    for (const s of [-1, 1]) {
      const p = pivot(g, s * 0.11, 0.8, 0);
      p.add(mesh(capsule(0.075, 0.56), pants, 0, -0.37, 0));
      const shoe = mesh(ball(0.09), mat('#2a2522'), 0, -0.75, 0.05);
      shoe.scale.set(0.9, 0.6, 1.5);
      p.add(shoe);
      legs.push(p);
    }
  }
  for (const s of [-1, 1]) {
    const p = pivot(g, s * 0.29, 1.34, 0);
    p.add(mesh(capsule(0.055, 0.46), cloth, 0, -0.28, 0));
    p.add(mesh(ball(0.06), skin, 0, -0.6, 0));
    p.userData.side = s;
    arms.push(p);
  }
  g.add(mesh(cyl(0.07, 0.08, 0.12, 10), skin, 0, 1.38, 0));
  const hr = o.bigHead ? 0.34 : 0.2;
  const head = mesh(ball(hr), skin, 0, 1.42 + hr, 0);
  if (!o.bigHead) head.scale.y = 1.08;
  for (const s of [-1, 1]) head.add(mesh(ball(hr * 0.14), mat('#1b1b1f'), s * hr * 0.36, hr * 0.12, hr * 0.9));
  if (!o.bigHead && !o.ghost) {
    const cap = new THREE.SphereGeometry(hr * 1.07, 18, 10, 0, Math.PI * 2, 0, Math.PI * (o.armor ? 0.62 : 0.52));
    const hair = mesh(cap, o.armor ? mat('#aab4c0', steel) : mat(any(HAIR)));
    hair.rotation.x = -0.32;
    head.add(hair);
    if (!o.armor && pick() < 0.4) {                 // longer hair
      const back = mesh(ball(hr * 0.95), hair.material, 0, -hr * 0.35, -hr * 0.42);
      back.scale.set(1, 1.25, 0.7);
      head.add(back);
    }
  }
  g.add(head);
  const top = 1.42 + hr * 2.1;
  if (o.crown) g.add(mesh(cyl(0.19, 0.15, 0.14, 8), mat('#f5c542', { metalness: 0.85, roughness: 0.25 }), 0, top, 0));
  if (o.hat) {
    g.add(mesh(cyl(0.4, 0.4, 0.04, 20), cloth, 0, top - 0.1, 0));
    g.add(mesh(cone(0.23, 0.6, 16), cloth, 0, top + 0.2, 0));
  }
  g.userData = { legs, arms, head, height: top + (o.hat ? 0.55 : 0.12) };
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
  const coat = o.pattern && !FLAT ? patternTexture(o.pattern, o.color, o.ink || '#1d1a17') : null;
  const m = coat ? mat('#ffffff', { map: coat }) : mat(o.color);
  const plain = mat(o.color), dark = mat(mix(o.color, '#000000', 0.32));
  const L = o.len || 1, H = o.leg || 0.5, W = o.width || 0.4, neck = o.neck || 0;
  const legs = [], wings = [], br = W * 0.5, by = H + br * 0.95;
  const body = mesh(capsule(br, Math.max(0.02, L - W)), m, 0, by, 0);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const hy = by + W * 0.3 + neck, hz = L / 2 + W * 0.2;
  if (neck) {
    const n = mesh(cyl(W * 0.2, W * 0.32, neck + W * 0.6, 12), m, 0, by + neck / 2 + W * 0.15, L / 2 - W * 0.12);
    n.rotation.x = 0.4;
    g.add(n);
  }
  if (o.mane) g.add(mesh(ball(W * 0.56), mat(mix(o.color, '#3a2208', 0.6)), 0, hy - W * 0.05, hz - W * 0.32));
  const head = mesh(ball(W * 0.4), plain, 0, hy, hz);
  head.scale.set(0.9, 0.9, 1.1);
  const snout = mesh(ball(W * 0.24), plain, 0, -W * 0.08, W * 0.36);
  snout.scale.z = 1.3;
  head.add(snout);
  head.add(mesh(ball(W * 0.07), mat('#15151a'), 0, -W * 0.04, W * 0.66));
  for (const s of [-1, 1]) {
    head.add(mesh(ball(W * 0.055), mat('#15151a'), s * W * 0.24, W * 0.12, W * 0.28));
    if (o.ears === 'up') head.add(mesh(cone(W * 0.13, W * 0.36, 10), dark, s * W * 0.22, W * 0.42, -W * 0.08));
    if (o.ears === 'round') head.add(mesh(ball(W * 0.14), dark, s * W * 0.3, W * 0.3, -W * 0.05));
    if (o.ears === 'long') head.add(mesh(capsule(W * 0.07, W * 0.7), plain, s * W * 0.16, W * 0.8, -W * 0.1));
  }
  if (o.horn) head.add(mesh(cone(W * 0.09, W * 0.8, 10), mat('#f3e3b3'), 0, W * 0.65, W * 0.15));
  if (o.trunk) head.add(mesh(cyl(W * 0.08, W * 0.14, H * 0.95, 10), plain, 0, -H * 0.5, W * 0.5));
  g.add(head);
  const lw = Math.max(0.035, W * 0.14);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const p = pivot(g, sx * (br - lw), H, sz * (L / 2 - lw * 1.6));
    p.add(mesh(cyl(lw, lw * 0.75, H, 10), m, 0, -H / 2, 0));
    const paw = mesh(ball(lw * 1.05), dark, 0, -H + lw * 0.45, lw * 0.3);
    paw.scale.y = 0.6;
    p.add(paw);
    legs.push(p);
  }
  const tl = o.tail || 0.3;
  const tail = pivot(g, 0, by + br * 0.3, -L / 2 + br * 0.2);
  const tm = mesh(cyl(W * 0.04, W * 0.1, tl, 10), dark, 0, 0, -tl / 2);
  tm.rotation.x = Math.PI / 2;
  tail.add(tm);
  tail.rotation.x = 0.5;
  if (o.wings) {
    for (const s of [-1, 1]) {
      const p = pivot(g, s * W * 0.35, by + br * 0.7, 0);
      p.add(mesh(box(L * 0.95, 0.04, L * 0.55), dark, s * L * 0.47, 0, 0));
      put(p, mesh(cyl(0.03, 0.05, L * 0.95, 8), plain, s * L * 0.47, 0.03, L * 0.26)).rotation.z = Math.PI / 2;
      p.userData.side = s;
      wings.push(p);
    }
  }
  let breath = null;
  if (o.breath) {
    breath = mesh(cone(W * 0.55, L * 0.9, 12), glow('#ff8a1c', 2.6), 0, hy - W * 0.1, hz + W * 0.5 + L * 0.45);
    breath.rotation.x = -Math.PI / 2;
    breath.castShadow = false;
    breath.visible = false;
    g.add(breath);
  }
  g.userData = { breath, legs, tail, wings, head, quad: true, height: hy + W * 0.6, sink: H * 0.85,
    mouth: [0, -W * 0.12, W * 0.74],
    seats: [[0, by + br * 0.8, L * 0.08, 'straddle'], [0, by + br * 0.8, -L * 0.28, 'straddle']] };
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

function buildBoat(o) {
  const g = new THREE.Group(), speed = o.variant === 'speed';
  const hullM = mat(speed ? '#f4f4f4' : '#8b5a36', speed ? { roughness: 0.3 } : {});
  g.add(mesh(box(1.3, 0.55, 2.6), hullM, 0, 0.2, 0));
  const bow = mesh(cone(0.92, 1.1, 4), hullM, 0, 0.2, 1.85);
  bow.rotation.x = Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.scale.z = 0.42;
  g.add(bow);
  g.add(mesh(box(1.1, 0.08, 2.3), mat(speed ? '#2e86ab' : '#a9774a'), 0, 0.46, 0));
  if (speed) {
    put(g, mesh(box(1.0, 0.4, 0.08), mat('#9fc4dc', { roughness: 0.1, metalness: 0.4 }), 0, 0.72, 0.5)).rotation.x = -0.4;
    g.add(mesh(box(0.5, 0.5, 0.4), mat('#2b2e35'), 0, 0.5, -1.4));
  } else if (o.sail === false) {
    for (const s of [-1, 1]) {
      const oar = mesh(cyl(0.03, 0.03, 2.2, 8), mat('#5d3b22'), s * 1.1, 0.4, 0);
      oar.rotation.z = s * 1.15;
      g.add(oar);
    }
    g.add(mesh(box(1.1, 0.06, 0.3), mat('#5d3b22'), 0, 0.52, -0.2));
  } else {
    g.add(mesh(cyl(0.05, 0.06, 2.6, 8), mat('#5d3b22'), 0, 1.7, 0.1));
    const sail = mesh(cone(1.0, 2.0, 3), mat('#f7f3e8'), 0, 1.9, 0.12);
    sail.scale.set(0.08, 1, 1);
    g.add(sail);
    g.add(mesh(box(0.05, 0.22, 0.4), mat('#d1495b'), 0, 3.0, -0.1));
  }
  g.userData = { boat: true, height: o.sail === false || speed ? 1.2 : 3.3 };
  return g;
}

function wheel(g, list, x, z, r = 0.27, w = 0.2, tyreColor = '#17171b') {
  const p = pivot(g, x, r, z);
  const tyre = mesh(cyl(r, r, w, 18), mat(tyreColor, { roughness: 0.9 }));
  tyre.rotation.z = Math.PI / 2;
  const hub = mesh(cyl(r * 0.55, r * 0.55, w * 1.06, 12), mat('#c3c8cf', { metalness: 0.7, roughness: 0.3 }));
  hub.rotation.z = Math.PI / 2;
  p.add(tyre, hub, mesh(box(w * 1.1, r * 1.5, r * 0.16), mat('#6d727a')));
  list.push(p);
}
// Occupied vehicles get see-through glass so the riders are visible.
const glass = (clear) => mat('#9fc4dc', clear ? { roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.28, depthWrite: false }
  : { roughness: 0.08, metalness: 0.4 });
function carLights(g, w, y, zf, zb) {
  for (const s of [-1, 1]) {
    g.add(mesh(box(0.22, 0.12, 0.06), glow('#fff3b0', 1.2), s * w, y, zf));
    g.add(mesh(box(0.22, 0.1, 0.06), glow('#e03131', 1), s * w, y, zb));
  }
}

function buildCar(o, id) {
  const g = new THREE.Group(), v = o.variant, van = v === 'van' || v === 'ambulance';
  const paint = mat(o.color || PALETTE[hashStr(id) % PALETTE.length], { roughness: 0.3, metalness: 0.45 });
  const wheels = [];
  g.add(mesh(box(1.2, 0.42, 2.6), paint, 0, 0.55, 0));
  const cl = van ? 2.0 : v === 'pickup' ? 0.9 : 1.3, cz = van ? -0.25 : v === 'pickup' ? 0.25 : -0.15;
  const ch = van ? 0.62 : 0.42, top = 0.76 + ch;
  if (o.open) {                                   // open top: windscreen and seat backs only
    put(g, mesh(box(1.05, 0.5, 0.05), glass(true), 0, 1.0, cz + cl / 2 + 0.1)).rotation.x = -0.3;
    g.add(mesh(box(1.05, 0.06, 0.05), paint, 0, 1.24, cz + cl / 2 + 0.03));
    g.add(mesh(box(1.0, 0.42, 0.12), mat('#3a2a22'), 0, 0.95, cz - cl / 2 + 0.05));
  } else {
    g.add(mesh(box(1.1, ch, cl), paint, 0, 0.76 + ch / 2, cz));
    g.add(mesh(box(1.12, ch * 0.6, cl * 0.82), glass(), 0, 0.8 + ch / 2, cz));
    g.add(mesh(box(0.96, ch * 0.6, cl + 0.03), glass(), 0, 0.8 + ch / 2, cz));
  }
  if (v === 'pickup') {
    g.add(mesh(box(1.2, 0.25, 0.06), paint, 0, 0.88, -1.27));
    for (const s of [-1, 1]) g.add(mesh(box(0.06, 0.25, 1.05), paint, s * 0.57, 0.88, -0.75));
  }
  for (const z of [1.32, -1.32]) g.add(mesh(box(1.24, 0.12, 0.08), mat('#2b2e35'), 0, 0.4, z));
  carLights(g, 0.42, 0.6, 1.31, -1.31);
  if (v === 'taxi' && !o.open) g.add(mesh(box(0.34, 0.13, 0.16), glow('#ffd43b', 1.2), 0, top + 0.07, cz));
  if (v === 'police' || v === 'ambulance') {
    const ly = o.open ? 0.82 : top + 0.05, lz = o.open ? -1.0 : cz;
    g.add(mesh(box(0.26, 0.1, 0.14), glow('#e03131', 2), -0.15, ly, lz));
    g.add(mesh(box(0.26, 0.1, 0.14), glow('#1c7ed6', 2), 0.15, ly, lz));
    g.add(mesh(box(1.22, 0.1, 2.0), mat(v === 'police' ? '#1f3a6e' : '#e03131'), 0, 0.62, 0));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(g, wheels, sx * 0.6, sz * 0.85);
  g.userData = { wheels, height: top + 0.2 };
  return g;
}

function buildTruck(o, id) {
  const g = new THREE.Group(), fire = o.variant === 'fire', wheels = [];
  const paint = mat(o.color || PALETTE[hashStr(id) % PALETTE.length], { roughness: 0.35, metalness: 0.35 });
  g.add(mesh(box(1.3, 0.25, 4.8), mat('#2b2e35'), 0, 0.55, 0));
  if (o.open) {
    g.add(mesh(box(1.45, 0.55, 1.2), paint, 0, 0.95, 1.75), mesh(box(1.45, 0.08, 1.2), paint, 0, 1.8, 1.75));
    g.add(mesh(box(1.45, 0.56, 0.08), paint, 0, 1.5, 1.19), mesh(box(1.4, 0.52, 1.1), glass(true), 0, 1.5, 1.78));
  } else {
    g.add(mesh(box(1.45, 1.15, 1.2), paint, 0, 1.25, 1.75));
    g.add(mesh(box(1.3, 0.45, 0.06), glass(), 0, 1.5, 2.36));
    g.add(mesh(box(1.47, 0.42, 0.7), glass(), 0, 1.5, 1.85));
  }
  if (fire) {
    g.add(mesh(box(1.45, 0.9, 3.3), paint, 0, 1.13, -0.65));
    for (const s of [-1, 1]) g.add(mesh(box(0.06, 0.06, 3.4), mat('#d9dee6', { metalness: 0.8, roughness: 0.3 }), s * 0.3, 1.75, -0.6));
    for (let i = 0; i < 9; i++) g.add(mesh(box(0.6, 0.05, 0.05), mat('#d9dee6'), 0, 1.75, -2.2 + i * 0.4));
    g.add(mesh(box(0.5, 0.12, 0.18), glow('#e03131', 2.2), 0, 1.9, 1.75));
  } else {
    g.add(mesh(box(1.55, 1.6, 3.3), mat('#eef0f2'), 0, 1.48, -0.7));
    g.add(mesh(box(1.57, 0.3, 3.3), paint, 0, 1.2, -0.7));
  }
  carLights(g, 0.5, 0.85, 2.36, -2.4);
  for (const sx of [-1, 1]) for (const z of [1.7, -0.9, -1.8]) wheel(g, wheels, sx * 0.68, z, 0.36, 0.26);
  g.userData = { wheels, wheelR: 0.36, height: 2.4 };
  return g;
}

function buildBus(o) {
  const g = new THREE.Group(), wheels = [];
  const paint = mat(o.color || '#f2b632', { roughness: 0.35, metalness: 0.3 });
  if (o.open) {
    g.add(mesh(box(1.55, 0.75, 5.6), paint, 0, 0.78, 0), mesh(box(1.55, 0.12, 5.6), paint, 0, 1.94, 0));
    g.add(mesh(box(1.5, 0.75, 5.5), glass(true), 0, 1.52, 0));
    for (const z of [-2.75, -0.9, 0.9, 2.75]) for (const sx of [-1, 1]) g.add(mesh(box(0.08, 0.75, 0.08), paint, sx * 0.73, 1.52, z));
  } else {
    g.add(mesh(box(1.55, 1.6, 5.6), paint, 0, 1.2, 0));
    g.add(mesh(box(1.57, 0.52, 5.0), glass(), 0, 1.52, -0.1));
    g.add(mesh(box(1.4, 0.7, 0.06), glass(), 0, 1.45, 2.8));
  }
  g.add(mesh(box(0.06, 1.1, 0.7), mat('#2b2e35'), 0.78, 0.98, 2.0));
  g.add(mesh(box(1.57, 0.12, 5.6), mat('#2b2e35'), 0, 0.5, 0));
  carLights(g, 0.55, 0.75, 2.81, -2.81);
  for (const sx of [-1, 1]) for (const z of [1.8, -1.8]) wheel(g, wheels, sx * 0.72, z, 0.36, 0.26);
  g.userData = { wheels, wheelR: 0.36, height: 2.2 };
  return g;
}

function buildTrain(o) {
  const outer = new THREE.Group(), g = new THREE.Group(), wheels = [], smoke = [];
  g.position.z = 3.2;
  outer.add(g);
  const black = mat('#24272d', { metalness: 0.5, roughness: 0.4 }), red = mat('#b3262b', { roughness: 0.4 });
  const boiler = mesh(cyl(0.6, 0.6, 2.3, 18), black, 0, 1.15, 1.2);
  boiler.rotation.x = Math.PI / 2;
  g.add(boiler);
  if (o.open) {
    g.add(mesh(box(1.35, 0.75, 1.2), red, 0, 0.93, -0.5), mesh(box(1.3, 0.75, 1.15), glass(true), 0, 1.68, -0.5));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(box(0.08, 0.75, 0.08), red, sx * 0.63, 1.68, -0.5 + sz * 0.56));
  } else {
    g.add(mesh(box(1.35, 1.5, 1.2), red, 0, 1.3, -0.5));
    g.add(mesh(box(1.37, 0.45, 0.7), glass(), 0, 1.65, -0.5));
  }
  g.add(mesh(box(1.5, 0.1, 1.4), black, 0, 2.1, -0.5));
  g.add(mesh(cyl(0.2, 0.15, 0.6, 12), black, 0, 2.0, 1.8));
  g.add(mesh(ball(0.2), mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), 0, 1.85, 1.0));
  g.add(mesh(box(1.3, 0.2, 3.6), black, 0, 0.5, 0.4));
  const plough = mesh(cone(0.75, 0.7, 4), red, 0, 0.45, 2.5);
  plough.rotation.set(Math.PI / 2, Math.PI / 4, 0);
  g.add(plough);
  for (const sx of [-1, 1]) for (const z of [1.5, 0.6, -0.5]) wheel(g, wheels, sx * 0.62, z, 0.34, 0.14, '#3a1d1d');
  ['#2e6f8e', '#3b8b6f', '#b9772e'].forEach((c, i) => {
    const z = -2.9 - i * 2.75;
    g.add(mesh(box(1.35, 1.25, 2.5), mat(c, { roughness: 0.45 }), 0, 1.2, z));
    g.add(mesh(box(1.37, 0.4, 2.0), glass(), 0, 1.45, z));
    g.add(mesh(box(1.45, 0.08, 2.6), black, 0, 1.87, z));
    g.add(mesh(box(0.2, 0.12, 0.3), black, 0, 0.6, z + 1.37));
    for (const sx of [-1, 1]) for (const dz of [0.8, -0.8]) wheel(g, wheels, sx * 0.62, z + dz, 0.28, 0.14, '#24272d');
  });
  for (let i = 0; i < 4; i++) {
    const puff = mesh(ball(0.3), mat('#e9ecef', { transparent: true, opacity: 0.8 }), 0, 2.4, 1.8);
    puff.castShadow = false;
    smoke.push(puff);
    g.add(puff);
  }
  outer.userData = { wheels, wheelR: 0.3, smoke, height: 2.4 };
  return outer;
}

function buildBike(o, id) {
  const g = new THREE.Group(), motor = o.variant === 'motor', wheels = [];
  const frame = mat(o.color || PALETTE[hashStr(id) % PALETTE.length], { metalness: 0.5, roughness: 0.35 });
  const r = 0.36, w = motor ? 0.16 : 0.05;
  wheel(g, wheels, 0, 0.62, r, w);
  wheel(g, wheels, 0, -0.62, r, w);
  const bar = (len, x, y, z, rx, t = motor ? 0.07 : 0.04) => {
    const b = mesh(cyl(t / 2, t / 2, len, 8), frame, x, y, z);
    b.rotation.x = rx;
    g.add(b);
  };
  bar(0.95, 0, 0.8, 0.05, Math.PI / 2);
  bar(0.62, 0, 0.6, -0.28, 0.3);
  bar(0.75, 0, 0.6, 0.2, -0.75);
  bar(0.72, 0, 0.68, 0.56, 0.25);
  bar(0.7, 0, 0.5, -0.45, 1.05);
  g.add(mesh(box(0.56, 0.04, 0.04), mat('#2b2e35'), 0, 1.02, 0.48));
  g.add(mesh(box(0.16, 0.06, 0.3), mat('#2b2e35'), 0, 0.92, -0.32));
  if (motor) {
    g.add(mesh(box(0.3, 0.36, 0.55), mat('#3a3d44', { metalness: 0.7, roughness: 0.4 }), 0, 0.48, 0));
    const tank = mesh(capsule(0.15, 0.3), frame, 0, 0.88, 0.1);
    tank.rotation.x = Math.PI / 2;
    g.add(tank);
    g.add(mesh(ball(0.09), glow('#fff3b0', 1.2), 0, 0.9, 0.72));
  }
  const rider = buildPerson(o.rider || {}, id + 'rider');      // someone has to ride it
  rider.visible = !o.open;                                    // unless the story names the rider
  rider.position.set(0, 0.16, -0.3);
  rider.rotation.x = 0.22;
  rider.userData.legs.forEach((leg, i) => { leg.rotation.x = -0.9; leg.rotation.z = (i ? 1 : -1) * 0.12; });
  rider.userData.arms.forEach((arm) => { arm.rotation.x = -1.15; });
  g.add(rider);
  g.userData = { wheels, wheelR: r, height: 1.95 };
  return g;
}

function buildTractor(o) {
  const g = new THREE.Group(), wheels = [];
  const paint = mat(o.color || '#2f9e44', { roughness: 0.45 });
  g.add(mesh(box(0.9, 0.6, 1.5), paint, 0, 1.05, 0.55));
  g.add(mesh(box(1.0, 0.5, 1.1), paint, 0, 0.95, -0.5));
  g.add(mesh(box(1.0, 0.95, 0.95), glass(o.open), 0, 1.65, -0.5));
  g.add(mesh(box(1.1, 0.08, 1.05), paint, 0, 2.15, -0.5));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(box(0.07, 0.95, 0.07), mat('#2b2e35'), sx * 0.48, 1.65, -0.5 + sz * 0.45));
  g.add(mesh(cyl(0.05, 0.05, 0.8, 8), mat('#2b2e35'), 0.3, 1.7, 0.9));
  g.add(mesh(box(0.7, 0.3, 0.06), mat('#2b2e35'), 0, 1.0, 1.31));
  for (const sx of [-1, 1]) {
    wheel(g, wheels, sx * 0.72, -0.5, 0.62, 0.34);
    wheel(g, wheels, sx * 0.6, 1.0, 0.34, 0.2);
  }
  g.userData = { wheels, wheelR: 0.48, height: 2.3 };
  return g;
}

function buildHeli(o, id) {
  const g = new THREE.Group();
  const paint = mat(o.color || PALETTE[hashStr(id) % PALETTE.length], { roughness: 0.35, metalness: 0.3 });
  const body = mesh(ball(0.75), paint, 0, 1.2, 0);
  body.scale.set(0.9, 0.95, 1.5);
  g.add(body);
  const nose = mesh(ball(0.62), glass(o.open), 0, 1.25, 0.55);
  nose.scale.set(0.85, 0.85, 1);
  g.add(nose);
  const boom = mesh(cyl(0.1, 0.2, 2.6, 12), paint, 0, 1.35, -2.0);
  boom.rotation.x = Math.PI / 2;
  g.add(boom);
  g.add(mesh(box(0.06, 0.7, 0.4), paint, 0, 1.7, -3.2));
  const tailRotor = mesh(box(0.04, 0.8, 0.1), mat('#2b2e35'), 0.1, 1.7, -3.2);
  g.add(tailRotor);
  g.add(mesh(cyl(0.06, 0.06, 0.35, 8), mat('#2b2e35'), 0, 2.05, 0));
  const rotor = pivot(g, 0, 2.25, 0);
  rotor.add(mesh(box(4.4, 0.04, 0.18), mat('#2b2e35')), mesh(box(0.18, 0.04, 4.4), mat('#2b2e35')));
  for (const s of [-1, 1]) {
    g.add(mesh(box(0.07, 0.07, 2.0), mat('#2b2e35'), s * 0.55, 0.15, 0.1));
    for (const z of [0.6, -0.4]) g.add(mesh(box(0.05, 0.45, 0.05), mat('#2b2e35'), s * 0.5, 0.4, z));
  }
  g.userData = { rotor, tailRotor, height: 2.4 };
  return g;
}

function buildShip(o) {
  const g = new THREE.Group();
  const hull = mat(o.color || '#1f3a5f', { roughness: 0.5 }), white = mat('#f4f4f4', { roughness: 0.5 });
  g.add(mesh(box(2.6, 1.3, 9), hull, 0, 0.35, -0.5));
  const bow = mesh(cone(1.84, 2.6, 4), hull, 0, 0.35, 5.3);
  bow.rotation.set(Math.PI / 2, Math.PI / 4, 0);
  bow.scale.z = 0.5;
  g.add(bow);
  g.add(mesh(box(2.62, 0.2, 9), mat('#b3262b'), 0, -0.2, -0.5));
  g.add(mesh(box(2.3, 0.8, 6.5), white, 0, 1.4, -0.8));
  g.add(mesh(box(2.32, 0.28, 6.0), glass(), 0, 1.5, -0.8));
  g.add(mesh(box(1.9, 0.75, 2.2), white, 0, 2.15, 1.0));
  g.add(mesh(box(1.92, 0.3, 2.0), glass(), 0, 2.25, 1.05));
  for (const z of [-0.9, -2.4]) {
    g.add(mesh(cyl(0.38, 0.42, 1.3, 16), mat('#d9772e'), 0, 2.4, z));
    g.add(mesh(cyl(0.39, 0.39, 0.25, 16), mat('#24272d'), 0, 3.0, z));
  }
  g.add(mesh(cyl(0.04, 0.04, 1.6, 8), mat('#24272d'), 0, 3.2, 1.3));
  g.userData = { boat: true, height: 3.6 };
  return g;
}

function buildTank() {
  const g = new THREE.Group(), olive = mat('#5b6b3a', { roughness: 0.7 }), dark = mat('#2b2e35');
  for (const s of [-1, 1]) {
    g.add(mesh(box(0.5, 0.6, 3.4), dark, s * 0.8, 0.32, 0));
    for (let i = 0; i < 5; i++) {
      const w = mesh(cyl(0.24, 0.24, 0.52, 12), mat('#3f4a2a'), s * 0.8, 0.3, -1.3 + i * 0.65);
      w.rotation.z = Math.PI / 2;
      g.add(w);
    }
  }
  g.add(mesh(box(1.5, 0.55, 3.1), olive, 0, 0.8, 0));
  g.add(mesh(cyl(0.72, 0.8, 0.5, 16), olive, 0, 1.3, -0.2));
  const barrel = mesh(cyl(0.09, 0.09, 2.3, 12), olive, 0, 1.32, 1.5);
  barrel.rotation.x = Math.PI / 2;
  g.add(barrel);
  g.add(mesh(cyl(0.2, 0.2, 0.12, 12), dark, 0.2, 1.6, -0.3));
  g.userData = { height: 1.8 };
  return g;
}

function buildSled() {
  const g = new THREE.Group(), red = mat('#c62828', { roughness: 0.4 }), gold = mat('#f5c542', { metalness: 0.8, roughness: 0.3 });
  for (const s of [-1, 1]) {
    g.add(mesh(box(0.06, 0.06, 2.4), gold, s * 0.5, 0.05, 0));
    const curl = mesh(box(0.06, 0.5, 0.06), gold, s * 0.5, 0.25, 1.25);
    curl.rotation.x = 0.6;
    g.add(curl);
    for (const z of [0.6, -0.6]) g.add(mesh(box(0.05, 0.35, 0.05), gold, s * 0.5, 0.22, z));
  }
  g.add(mesh(box(1.1, 0.45, 1.9), red, 0, 0.6, -0.1));
  g.add(mesh(box(1.1, 0.7, 0.12), red, 0, 1.05, -1.0));
  put(g, mesh(box(1.1, 0.4, 0.12), red, 0, 0.95, 0.85)).rotation.x = -0.4;
  g.add(mesh(box(1.14, 0.06, 1.95), gold, 0, 0.84, -0.1));
  const sack = mesh(ball(0.5), mat('#7a4a2a'), 0, 1.05, -0.5);
  sack.scale.y = 0.9;
  g.add(sack);
  g.userData = { height: 1.6 };
  return g;
}

function buildCart() {
  const g = new THREE.Group(), wood = mat('#9a6a3c'), dark = mat('#5d3b22'), wheels = [];
  g.add(mesh(box(1.15, 0.1, 1.9), wood, 0, 0.72, -0.1));
  for (const s of [-1, 1]) {
    g.add(mesh(box(0.07, 0.42, 1.9), wood, s * 0.55, 0.95, -0.1));
    g.add(mesh(box(0.05, 0.05, 1.5), dark, s * 0.35, 0.7, 1.55));
    wheel(g, wheels, s * 0.68, -0.1, 0.46, 0.08, '#5d3b22');
  }
  for (const z of [0.83, -1.03]) g.add(mesh(box(1.15, 0.42, 0.07), wood, 0, 0.95, z));
  const hay = mesh(ball(0.55), mat('#d8b24a'), 0, 1.15, -0.1);
  hay.scale.set(0.9, 0.6, 1.4);
  g.add(hay);
  g.userData = { wheels, wheelR: 0.46, height: 1.5 };
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
  put(g, mesh(cone(0.9, 1.2, 10), mat('#f7f3e8'), 0, 1.75, 0)).rotation.x = Math.PI;
  g.add(mesh(box(0.7, 0.5, 0.7), mat('#8b5a36'), 0, 0.25, 0));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(mesh(cyl(0.015, 0.015, 1.0, 4), mat('#3a2a1c'), x * 0.3, 0.95, z * 0.3));
  }
  g.userData = { height: 5.6 };
  return g;
}

const BUILDERS = { truck: buildTruck, bus: buildBus, train: buildTrain, bike: buildBike, tractor: buildTractor,
  heli: buildHeli, ship: buildShip, tank: buildTank, sled: buildSled, cart: buildCart, ufo: buildUfo, balloon: buildBalloon, person: buildPerson, robot: buildRobot, quad: buildQuad, bird: buildBird,
  fish: buildFish, boat: buildBoat, car: buildCar, rocket: buildRocket, plane: buildPlane };
const FIGHTING = new Set(['fight', 'slay', 'die']);
const BEAT = 0.95;        // seconds per exchange of blows
const DUEL_END = 0.62;    // fraction of the scene at which a fight to the death is settled
const FOOTPRINT = { boat: 4.2, car: 3.4, rocket: 2.6, plane: 4.2, ufo: 3.2, balloon: 3.6, truck: 6, bus: 6.6,
  train: 12.5, bike: 2.4, tractor: 3.6, heli: 5, ship: 12, tank: 4.2, sled: 3.2, cart: 3.6 };
const WATER_BASES = new Set(['fish', 'boat', 'ship']);
// Where riders go: [x, y, z, pose] in the vehicle's own space. y is hip height for
// 'sit' and 'straddle', foot height for 'stand'.
const SEATS = {
  car: [[-0.27, 0.72, -0.15, 'sit'], [0.27, 0.72, -0.15, 'sit'], [0, 0.72, -0.8, 'sit']],
  truck: [[-0.33, 1.15, 1.7, 'sit'], [0.33, 1.15, 1.7, 'sit']],
  bus: [[-0.4, 1.2, 2.0, 'sit'], [0.4, 1.2, 0.9, 'sit'], [-0.4, 1.2, -0.2, 'sit'], [0.4, 1.2, -1.3, 'sit']],
  train: [[0, 1.25, 2.7, 'sit']],
  bike: [[0, 0.98, -0.3, 'straddle']],
  tractor: [[0, 1.3, -0.5, 'sit']],
  heli: [[0, 0.95, 0.35, 'sit']],
  plane: [[0, 0.5, -0.1, 'sit']],
  ship: [[0, 1.0, 3.3, 'stand'], [0.6, 1.0, 2.5, 'stand'], [-0.6, 1.0, 2.5, 'stand']],
  boat: [[0, 0.55, -0.7, 'sit'], [0, 0.55, 0.7, 'sit']],
  tank: [[0, 0.95, -0.2, 'stand']],
  sled: [[0, 0.95, -0.2, 'sit'], [0, 0.95, 0.45, 'sit']],
  cart: [[0, 1.0, 0.4, 'sit'], [0, 1.0, -0.5, 'sit']],
  balloon: [[0, 0.1, 0, 'stand']],
  ufo: [[0, 0.75, 0, 'sit']],
  rocket: [[0, 1.6, 0, 'sit']],
  bird: [[0, 0.5, -0.05, 'straddle']],
  fish: [[0, 0.28, 0, 'straddle']],
};
const SNUG = new Set(['truck', 'bus', 'train', 'tractor', 'heli', 'rocket', 'ufo']);   // riders shrink to fit the cab
// Furniture people can use: [pose, height].
const PERCH = { bench: ['sit', 0.55], sofa: ['sit', 0.6], rock: ['sit', 1.0], haystack: ['sit', 1.25],
  barrel: ['sit', 0.92], bed: ['lie', 0.68], bathtub: ['sit', 0.35], bridge: ['stand', 1.12], table: ['stand', 0.88] };

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
  const item = spec.holding, held = item && stage && PROP_BUILDERS[item.base];
  if (item && item.kind !== 'sword' && held) {     // something carried in a hand or a mouth
    const thing = held(stage.R, stage.night, item.base === 'beachball' ? [] : stage.anims, true);
    thing.scale.setScalar(item.scale / (ud.arms ? 1 : Math.max(0.6, s)));
    if (ud.arms) { thing.position.set(0, -0.64, 0.1); ud.arms[1].add(thing); }
    else if (ud.head && ud.mouth) { thing.position.set(...ud.mouth); ud.head.add(thing); }
    else { thing.position.set(0, ud.height, 0); g.add(thing); }
  }
  if ((FIGHTING.has(spec.action) || (item && item.kind === 'sword')) && ud.arms) {      // fighters on two legs carry a blade
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
  const aquatic = WATER_BASES.has(base) || act === 'swim';
  const ph = n * 1.7;                         // per-actor phase offset
  const actor = {
    wrap, focus: new THREE.Vector3(), aquatic,
    width: FOOTPRINT[base] || (base === 'quad' ? (o.len || 1) * s + 0.9 : 1.5 * Math.max(0.7, s)),
    scale: s, flying: act === 'fly' && !['rocket', 'person', 'robot', 'balloon'].includes(base),
    ambient: !!spec.ambient, base,
    moving: act === 'walk' || act === 'run' || act === 'swim',
    x0: 0, z0: 0, y0: 0, facing: 0, duel: false, action: act,
    id: spec.id, riding: spec.riding, on: spec.on, mount: null, seat: null, perch: null, riders: 0,
    seats: ud.seats || SEATS[base] || [[0, ud.height * 0.6, 0, 'sit']], heading: 0, lift: 0,
  };

  const hip = ud.quad ? (o.leg || 0.5) : ud.legs && ud.legs.length ? 0.8 : 0.25;   // seat-to-feet distance
  function ride(t) {                         // sit in or on the mount and go where it goes
    const m = actor.mount, [sx0, sy, sz0, pose] = actor.seat;
    const k = SNUG.has(m.base) ? 0.68 : 1, mh = m.heading;
    const sx = (ud.quad ? 0 : sx0) * m.scale, sz = sz0 * m.scale;   // four-legged riders take the middle
    g.rotation.set(0, 0, 0);
    g.position.set(0, 0, 0);
    scaled.scale.setScalar(s * k);
    scaled.rotation.y = mh;
    wrap.position.set(
      m.wrap.position.x + sx * Math.cos(mh) + sz * Math.sin(mh),
      m.wrap.position.y + m.lift + sy * m.scale - (pose === 'stand' ? 0 : hip * s * k),
      m.wrap.position.z - sx * Math.sin(mh) + sz * Math.cos(mh));
    if (ud.legs && !ud.quad) {
      ud.legs.forEach((leg, i) => {
        leg.rotation.x = pose === 'stand' ? 0 : pose === 'straddle' ? -0.35 : -1.45;
        leg.rotation.z = pose === 'straddle' ? (i ? 1 : -1) * 0.5 : 0;
      });
    }
    if (ud.arms) {
      ud.arms.forEach((arm, i) => {
        arm.rotation.x = pose === 'stand' ? 0 : -1.05;
        arm.rotation.z = arm.userData.side * 0.12;
        if (act === 'wave' && i) arm.rotation.set(0, 0, arm.userData.side * (2.4 + Math.sin(t * 9) * 0.35));
      });
    }
    if (ud.tail) ud.tail.rotation.y = Math.sin(t * 6 + ph) * 0.4;
    if (ud.head) ud.head.rotation.set(0, Math.sin(t * 0.8 + ph) * 0.3, 0);
    if (ud.wings) ud.wings.forEach((w) => { w.rotation.z = -w.userData.side * 0.5; });
    actor.focus.copy(m.focus);
  }

  actor.update = (t, dur) => {
    if (actor.mount) { ride(t); return; }
    let x = actor.x0, y = actor.y0, z = actor.z0, heading = actor.facing;
    let sitting = false;
    if (actor.perch && !actor.moving) {      // on a bench, a bed, a bridge...
      const [pose, h] = actor.perch;
      sitting = pose === 'sit' && !ud.quad && ud.legs && ud.legs.length > 0;
      y += sitting ? h - hip * s : h;
    }
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
      if (ud.wheels) ud.wheels.forEach((w) => { w.rotation.x = (v * t) / (ud.wheelR || 0.27); });
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
        const r = 5.5 + n * 1.3 + ((base === 'plane' || base === 'heli') ? 5 : 0) + (o.wings ? 4 : 0);
        const h = ((base === 'plane' || base === 'heli') ? 9 : o.wings ? 7 : 4.2) + n * 0.6;
        const a = t * ((base === 'plane' || base === 'heli') ? 0.9 : 0.75) + ph;
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

    if (ud.rotor) { ud.rotor.rotation.y = t * 24; ud.tailRotor.rotation.x = t * 30; }
    if (ud.smoke) {
      ud.smoke.forEach((puff, i) => {
        const k = (t * 0.55 + i / ud.smoke.length) % 1;
        puff.position.set(0, 2.4 + k * 2.4, 1.8 - k * 1.6);
        puff.scale.setScalar(0.5 + k * 1.6);
        puff.material.opacity = 0.8 * (1 - k);
      });
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
    if (sitting) ud.legs.forEach((leg) => { leg.rotation.x = -1.45; });
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
    actor.heading = heading;
    actor.lift = g.position.y;
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
    const crown = 1.0 + R() * 0.4;
    g.add(mesh(ball(crown), mat(green, { roughness: 1 }), 0, h + crown * 0.7, 0));
    for (let i = 0; i < 5; i++) {                       // a clumpy canopy rather than one ball
      const a = (i / 5) * 6.28 + R(), k = crown * (0.55 + R() * 0.25);
      const shade = snowy ? '#e9f1f5' : mix(green, i % 2 ? '#2f6b2c' : '#9ccc65', 0.25);
      g.add(mesh(ball(k), mat(shade, { roughness: 1 }), Math.cos(a) * crown * 0.7, h + crown * (0.45 + R() * 0.6), Math.sin(a) * crown * 0.7));
    }
    const branch = mesh(cyl(0.05, 0.08, 0.9, 6), mat('#6b4a2b'), 0.3, h * 0.85, 0);
    branch.rotation.z = -0.8;
    g.add(branch);
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
  const r = mesh(ico(0.5 + R() * 0.9, 1), flat(color));
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
  const c = mesh(new THREE.OctahedronGeometry(0.5), mat('#7ae7ff', { emissive: '#7ae7ff', emissiveIntensity: 1.8, flatShading: true }), 0, 1.3, 0);
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
      put(g, mesh(cyl(0.35, 0.35, 0.16, 10), stone, x, 0.9, z)).rotation.x = Math.PI / 2;
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
// ---- everyday objects ------------------------------------------------------
const BRIGHT = ['#e63946', '#f2c230', '#2a9d8f', '#3d5a80', '#f28482', '#8d5fd3', '#f28c38'];
const metal = (c = '#b9bec6') => mat(c, { metalness: 0.75, roughness: 0.3 });
function beachball(R, night, anims) {
  const g = new THREE.Group();
  const b = new THREE.Group();
  b.add(mesh(ball(0.45), mat('#f4f4f4')));
  BRIGHT.slice(0, 3).forEach((c, i) => {
    const band = mesh(new THREE.SphereGeometry(0.455, 16, 12, i * 2.1, 0.9), mat(c));
    b.add(band);
  });
  g.add(b);
  anims.push((t) => { b.position.y = 0.45 + Math.abs(Math.sin(t * 2.6)) * 1.1; b.rotation.x = t * 2; });
  return g;
}
function kite(R, night, anims) {
  const g = new THREE.Group();
  const k = mesh(new THREE.OctahedronGeometry(0.7), mat(BRIGHT[Math.floor(R() * 7)], { side: THREE.DoubleSide }));
  k.scale.set(0.75, 1.1, 0.05);
  const string = mesh(cyl(0.008, 0.008, 6.2, 4), mat('#f4f4f4'));
  const tail = mesh(box(0.05, 1.2, 0.02), mat('#f2c230'));
  g.add(k, string, tail);
  anims.push((t) => {
    const x = Math.sin(t * 0.9) * 1.2, y = 6 + Math.sin(t * 1.4) * 0.5;
    k.position.set(x, y, 0);
    k.rotation.z = Math.sin(t * 1.4) * 0.3;
    tail.position.set(x, y - 1.2, 0);
    string.position.set(x / 2, y / 2, 0);
    string.rotation.z = -Math.atan2(x, y);
    string.scale.y = Math.hypot(x, y) / 6.2;
  });
  return g;
}
function umbrella(R, night, anims, held) {
  const g = new THREE.Group(), c = BRIGHT[Math.floor(R() * 7)];
  g.add(mesh(cyl(0.04, 0.04, 2.3, 8), mat('#e9e9e9'), 0, 1.15, 0));
  for (let i = 0; i < 8; i++) {
    const seg = mesh(new THREE.ConeGeometry(1.5, 0.55, 8, 1, true, (i * Math.PI) / 4, Math.PI / 4),
      mat(i % 2 ? '#f7f3e8' : c, { side: THREE.DoubleSide }), 0, 2.35, 0);
    g.add(seg);
  }
  if (!held) {
    g.add(mesh(box(0.9, 0.03, 1.9), mat(BRIGHT[Math.floor(R() * 7)]), 1.4, 0.03, 0.3));
    g.rotation.z = 0.08;
  }
  return g;
}
function books(R) {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const b = mesh(box(0.55, 0.11, 0.4), mat(BRIGHT[Math.floor(R() * 7)]), (R() - 0.5) * 0.06, 0.06 + i * 0.115, 0);
    b.rotation.y = (R() - 0.5) * 0.5;
    b.add(mesh(box(0.5, 0.08, 0.41), mat('#f4efe2'), 0.03, 0, 0));
    g.add(b);
  }
  return g;
}
function bed(R) {
  const g = new THREE.Group(), wood = mat('#7a5230');
  g.add(mesh(box(1.5, 0.3, 2.3), wood, 0, 0.3, 0));
  g.add(mesh(box(1.5, 0.9, 0.1), wood, 0, 0.7, -1.15));
  g.add(mesh(box(1.4, 0.22, 2.2), mat('#f4f4f4'), 0, 0.55, 0));
  g.add(mesh(box(1.42, 0.1, 1.4), mat(BRIGHT[Math.floor(R() * 7)]), 0, 0.68, 0.4));
  const pillow = mesh(ball(0.3), mat('#ffffff'), 0, 0.74, -0.8);
  pillow.scale.set(1.5, 0.4, 0.8);
  g.add(pillow);
  return g;
}
function sofa(R) {
  const g = new THREE.Group(), c = mat(BRIGHT[Math.floor(R() * 7)], { roughness: 0.95 });
  g.add(mesh(box(2.2, 0.4, 0.9), c, 0, 0.4, 0));
  g.add(mesh(box(2.2, 0.7, 0.25), c, 0, 0.85, -0.35));
  for (const s of [-1, 1]) g.add(mesh(box(0.25, 0.55, 0.9), c, s * 1.1, 0.6, 0));
  for (const s of [-1, 1]) g.add(mesh(box(0.9, 0.14, 0.7), mat('#f4efe2'), s * 0.5, 0.66, 0.05));
  return g;
}
function tv() {
  const g = new THREE.Group(), dark = mat('#1b1d22');
  g.add(mesh(box(1.6, 0.5, 0.45), mat('#7a5230'), 0, 0.25, 0));
  g.add(mesh(box(1.5, 0.9, 0.07), dark, 0, 1.05, 0));
  g.add(mesh(box(1.4, 0.8, 0.02), glow('#6ec5ff', 1.3), 0, 1.05, 0.04));
  g.add(mesh(box(0.4, 0.12, 0.2), dark, 0, 0.56, 0));
  return g;
}
function clock(R, night, anims) {
  const g = new THREE.Group(), wood = mat('#6b4226');
  g.add(mesh(box(0.6, 2.2, 0.4), wood, 0, 1.1, 0));
  g.add(mesh(box(0.7, 0.12, 0.5), wood, 0, 2.25, 0));
  const face = mesh(cyl(0.24, 0.24, 0.04, 20), mat('#f7f3e8'), 0, 1.8, 0.21);
  face.rotation.x = Math.PI / 2;
  g.add(face);
  const hand = pivot(g, 0, 1.8, 0.24), short = pivot(g, 0, 1.8, 0.24);
  hand.add(mesh(box(0.02, 0.2, 0.01), mat('#1b1d22'), 0, 0.1, 0));
  short.add(mesh(box(0.03, 0.13, 0.01), mat('#1b1d22'), 0, 0.065, 0));
  const bob = pivot(g, 0, 1.4, 0.21);
  bob.add(mesh(cyl(0.01, 0.01, 0.6, 6), metal('#d9b23a'), 0, -0.3, 0), mesh(ball(0.08), metal('#d9b23a'), 0, -0.62, 0));
  anims.push((t) => { hand.rotation.z = -t * 1.2; short.rotation.z = -t * 0.1; bob.rotation.z = Math.sin(t * 3) * 0.25; });
  return g;
}
function door(R) {
  const g = new THREE.Group();
  g.add(mesh(box(1.3, 2.3, 0.14), mat('#e9e4d8'), 0, 1.15, 0));
  const leaf = pivot(g, -0.5, 0, 0.08);
  leaf.add(mesh(box(1.0, 2.05, 0.07), mat(BRIGHT[Math.floor(R() * 7)]), 0.5, 1.03, 0));
  leaf.add(mesh(ball(0.05), metal('#d9b23a'), 0.88, 1.0, 0.06));
  leaf.rotation.y = -0.5;
  return g;
}
function ladder() {
  const g = new THREE.Group(), wood = mat('#b08a5a');
  for (const s of [-1, 1]) g.add(mesh(box(0.07, 3.2, 0.07), wood, s * 0.3, 1.6, 0));
  for (let i = 0; i < 8; i++) g.add(mesh(box(0.6, 0.05, 0.05), wood, 0, 0.3 + i * 0.38, 0));
  g.rotation.x = -0.25;
  return g;
}
function mailbox() {
  const g = new THREE.Group();
  g.add(mesh(box(0.1, 1.1, 0.1), mat('#6b4a2b'), 0, 0.55, 0));
  const b = mesh(cyl(0.2, 0.2, 0.55, 14), mat('#c62828', { roughness: 0.4 }), 0, 1.25, 0);
  b.rotation.x = Math.PI / 2;
  g.add(b, mesh(box(0.4, 0.2, 0.55), mat('#c62828', { roughness: 0.4 }), 0, 1.15, 0));
  g.add(mesh(box(0.03, 0.3, 0.12), mat('#f2c230'), 0.22, 1.4, 0.1));
  return g;
}
function trashcan() {
  const g = new THREE.Group();
  g.add(mesh(cyl(0.36, 0.3, 0.95, 16), metal('#8a9099'), 0, 0.48, 0));
  g.add(mesh(cyl(0.39, 0.39, 0.08, 16), metal('#6d737c'), 0, 1.0, 0));
  g.add(mesh(box(0.2, 0.06, 0.06), metal('#6d737c'), 0, 1.07, 0));
  return g;
}
function trafficlight(R, night, anims) {
  const g = new THREE.Group(), dark = mat('#24272d');
  g.add(mesh(cyl(0.07, 0.09, 3.0, 10), dark, 0, 1.5, 0));
  g.add(mesh(box(0.42, 1.1, 0.36), dark, 0, 3.4, 0));
  const lamps = ['#ff3b30', '#ffcc00', '#34c759'].map((c, i) => {
    const l = mesh(ball(0.13), mat(c, { emissive: c, emissiveIntensity: 0.1 }), 0, 3.75 - i * 0.35, 0.18);
    g.add(l);
    return l;
  });
  anims.push((t) => {
    const on = [0, 2, 1][Math.floor(t / 1.6) % 3];
    lamps.forEach((l, i) => { if (l.material.emissiveIntensity !== undefined) l.material.emissiveIntensity = i === on ? 2.5 : 0.08; });
  });
  return g;
}
function stopsign() {
  const g = new THREE.Group();
  g.add(mesh(cyl(0.05, 0.05, 2.4, 8), metal(), 0, 1.2, 0));
  const sign = mesh(cyl(0.42, 0.42, 0.05, 8), mat('#d62828', { roughness: 0.5 }), 0, 2.5, 0.04);
  sign.rotation.set(Math.PI / 2, Math.PI / 8, 0);
  g.add(sign, mesh(box(0.5, 0.12, 0.02), mat('#ffffff'), 0, 2.5, 0.08));
  return g;
}
function hydrant() {
  const g = new THREE.Group(), red = mat('#d62828', { roughness: 0.45 });
  g.add(mesh(cyl(0.2, 0.24, 0.75, 14), red, 0, 0.38, 0), mesh(ball(0.21), red, 0, 0.78, 0));
  g.add(mesh(cyl(0.28, 0.28, 0.07, 14), red, 0, 0.05, 0));
  const arm = mesh(cyl(0.08, 0.08, 0.6, 10), red, 0, 0.5, 0);
  arm.rotation.z = Math.PI / 2;
  g.add(arm);
  return g;
}
function swing(R, night, anims) {
  const g = new THREE.Group(), steel = metal('#3d5a80');
  for (const s of [-1, 1]) for (const z of [-1, 1]) {
    const leg = mesh(cyl(0.05, 0.05, 2.9, 8), steel, s * 1.3, 1.35, z * 0.55);
    leg.rotation.x = -z * 0.38;
    g.add(leg);
  }
  const top = mesh(cyl(0.05, 0.05, 2.8, 8), steel, 0, 2.7, 0);
  top.rotation.z = Math.PI / 2;
  g.add(top);
  const seats = [-0.6, 0.6].map((x, i) => {
    const p = pivot(g, x, 2.7, 0);
    for (const s of [-1, 1]) p.add(mesh(cyl(0.012, 0.012, 2.0, 4), mat('#2b2e35'), s * 0.22, -1.0, 0));
    p.add(mesh(box(0.55, 0.05, 0.25), mat(BRIGHT[i * 2]), 0, -2.0, 0));
    return p;
  });
  anims.push((t) => seats.forEach((p, i) => { p.rotation.x = Math.sin(t * 2.2 + i * 1.7) * 0.6; }));
  return g;
}
function slide() {
  const g = new THREE.Group(), steel = metal('#3d5a80');
  const chute = mesh(box(0.7, 0.06, 3.2), mat('#f2c230', { roughness: 0.3 }), 0, 1.05, 0.9);
  chute.rotation.x = 0.62;
  g.add(chute);
  for (const s of [-1, 1]) {
    const rail = mesh(box(0.05, 0.18, 3.2), mat('#e63946'), s * 0.36, 1.13, 0.9);
    rail.rotation.x = 0.62;
    g.add(rail, mesh(cyl(0.04, 0.04, 2.1, 8), steel, s * 0.3, 1.05, -0.6));
  }
  for (let i = 0; i < 6; i++) g.add(mesh(box(0.6, 0.04, 0.05), steel, 0, 0.3 + i * 0.32, -0.6));
  g.add(mesh(box(0.8, 0.06, 0.6), steel, 0, 2.05, -0.4));
  return g;
}
function sandcastle() {
  const g = new THREE.Group(), sand = mat('#e2c58a', { roughness: 1 });
  g.add(mesh(box(1.6, 0.5, 1.6), sand, 0, 0.25, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(mesh(cyl(0.26, 0.3, 0.9, 12), sand, sx * 0.8, 0.45, sz * 0.8));
    g.add(mesh(cone(0.3, 0.4, 12), sand, sx * 0.8, 1.1, sz * 0.8));
  }
  g.add(mesh(cyl(0.35, 0.4, 0.8, 12), sand, 0, 0.9, 0), mesh(cone(0.4, 0.5, 12), sand, 0, 1.55, 0));
  g.add(mesh(cyl(0.012, 0.012, 0.5, 4), mat('#5d3b22'), 0, 2.0, 0), mesh(box(0.22, 0.14, 0.01), mat('#e63946'), 0.12, 2.15, 0));
  const pail = mesh(cyl(0.2, 0.15, 0.3, 12), mat('#2e86ab'), 1.4, 0.15, 0.5);
  g.add(pail);
  return g;
}
function surfboard(R) {
  const g = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const b = mesh(capsule(0.3, 1.7), mat(BRIGHT[Math.floor(R() * 7)], { roughness: 0.3 }), i * 0.8 - 0.4, 1.1, 0);
    b.scale.z = 0.12;
    b.rotation.z = (i ? 1 : -1) * 0.12;
    b.add(mesh(box(0.08, 2.2, 0.32), mat('#f7f3e8')));
    g.add(b);
  }
  return g;
}
function cannon() {
  const g = new THREE.Group(), iron = metal('#3a3d44'), wheels = [];
  const barrel = mesh(cyl(0.16, 0.24, 1.9, 14), iron, 0, 0.8, 0.3);
  barrel.rotation.x = Math.PI / 2 - 0.25;
  g.add(barrel, mesh(box(0.6, 0.3, 1.2), mat('#6b4226'), 0, 0.5, -0.2));
  for (const s of [-1, 1]) wheel(g, wheels, s * 0.42, -0.1, 0.42, 0.09, '#5d3b22');
  for (let i = 0; i < 3; i++) g.add(mesh(ball(0.14), iron, 0.9 + (i % 2) * 0.28, 0.14 + (i === 2 ? 0.22 : 0), 0.2 + (i === 2 ? 0.14 : i * 0.28)));
  return g;
}
function ferriswheel(R, night, anims) {
  const g = new THREE.Group(), steel = metal('#d9dee6'), r = 6;
  for (const s of [-1, 1]) for (const z of [-1, 1]) {
    const leg = mesh(cyl(0.12, 0.12, 8.2, 8), steel, s * 1.9, 3.7, z * 0.7);
    leg.rotation.z = s * 0.26;
    g.add(leg);
  }
  const w = pivot(g, 0, 7.5, 0);
  for (const z of [-0.5, 0.5]) w.add(mesh(new THREE.TorusGeometry(r, 0.09, 8, 48), steel, 0, 0, z));
  const cabins = [];
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5;
    const spoke = mesh(cyl(0.04, 0.04, r, 6), steel, Math.cos(a) * r / 2, Math.sin(a) * r / 2, 0);
    spoke.rotation.z = a - Math.PI / 2;
    w.add(spoke);
    const cab = pivot(w, Math.cos(a) * r, Math.sin(a) * r, 0);
    cab.add(mesh(box(0.8, 0.7, 0.8), night ? glow(BRIGHT[i % 7], 0.9) : mat(BRIGHT[i % 7]), 0, -0.55, 0));
    cabins.push(cab);
  }
  put(w, mesh(cyl(0.4, 0.4, 1.3, 14), mat('#e63946'), 0, 0, 0)).rotation.x = Math.PI / 2;
  anims.push((t) => { w.rotation.z = t * 0.25; cabins.forEach((c) => { c.rotation.z = -t * 0.25; }); });
  return g;
}
function carousel(R, night, anims) {
  const g = new THREE.Group();
  g.add(mesh(cyl(2.6, 2.6, 0.25, 24), mat('#c62828'), 0, 0.13, 0));
  const spin = pivot(g, 0, 0, 0);
  spin.add(mesh(cyl(0.25, 0.25, 3.2, 12), mat('#f5c542', { metalness: 0.7, roughness: 0.3 }), 0, 1.8, 0));
  const horses = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3, x = Math.cos(a) * 1.9, z = Math.sin(a) * 1.9;
    spin.add(mesh(cyl(0.03, 0.03, 3.0, 6), metal('#f5c542'), x, 1.8, z));
    const h = buildQuad({ color: i % 2 ? '#f4f1f8' : BRIGHT[i % 7], len: 0.8, leg: 0.4, width: 0.28, neck: 0.25, ears: 'up', tail: 0.3 });
    h.position.set(x, 0.5, z);
    h.rotation.y = -a;
    horses.push(h);
    spin.add(h);
  }
  for (let i = 0; i < 12; i++) {
    g.add(mesh(new THREE.ConeGeometry(3.0, 1.2, 12, 1, false, (i * Math.PI) / 6, Math.PI / 6), mat(i % 2 ? '#f7f3e8' : '#c62828'), 0, 3.9, 0));
  }
  g.add(mesh(ball(0.2), metal('#f5c542'), 0, 4.6, 0));
  anims.push((t) => { spin.rotation.y = t * 0.6; horses.forEach((h, i) => { h.position.y = 0.6 + Math.sin(t * 2 + i * 2) * 0.3; }); });
  return g;
}
function telescope() {
  const g = new THREE.Group(), dark = mat('#2b2e35');
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3, leg = mesh(cyl(0.03, 0.03, 1.5, 6), dark, Math.cos(a) * 0.3, 0.7, Math.sin(a) * 0.3);
    leg.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
    g.add(leg);
  }
  const tube = mesh(cyl(0.12, 0.09, 1.4, 14), mat('#f4f4f4', { roughness: 0.3 }), 0, 1.6, 0.2);
  tube.rotation.x = Math.PI / 2 - 0.6;
  g.add(tube);
  return g;
}
function cake() {
  const g = new THREE.Group();
  g.add(mesh(box(1.0, 0.75, 1.0), mat('#9a6a3c'), 0, 0.38, 0), mesh(cyl(0.6, 0.6, 0.04, 20), mat('#f4f4f4'), 0, 0.78, 0));
  [['#f7c9d4', 0.45, 0.3], ['#fff3e0', 0.33, 0.25], ['#f7c9d4', 0.22, 0.2]].reduce((y, [c, r, h]) => {
    g.add(mesh(cyl(r, r, h, 20), mat(c), 0, y + h / 2, 0));
    return y + h;
  }, 0.8);
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5;
    g.add(mesh(cyl(0.015, 0.015, 0.16, 6), mat(BRIGHT[i]), Math.cos(a) * 0.13, 1.63, Math.sin(a) * 0.13));
    g.add(mesh(ball(0.03), glow('#ffcc66', 3), Math.cos(a) * 0.13, 1.74, Math.sin(a) * 0.13));
  }
  return g;
}
function gift(R) {
  const g = new THREE.Group();
  [[0, 0, 0.7], [0.75, 0.2, 0.5], [-0.6, 0.35, 0.42], [0.2, 0.75, 0.36]].forEach(([x, z, k], i) => {
    const c = BRIGHT[Math.floor(R() * 7)], ribbon = mat(i % 2 ? '#f5c542' : '#ffffff');
    g.add(mesh(box(k, k, k), mat(c), x, k / 2, z));
    g.add(mesh(box(k * 1.02, k * 1.02, k * 0.16), ribbon, x, k / 2, z), mesh(box(k * 0.16, k * 1.02, k * 1.02), ribbon, x, k / 2, z));
    g.add(mesh(ball(k * 0.12), ribbon, x, k + k * 0.08, z));
  });
  return g;
}
function xmastree(R, night) {
  const g = new THREE.Group();
  g.add(mesh(cyl(0.16, 0.2, 0.6, 8), mat('#5b3d24'), 0, 0.3, 0));
  for (let i = 0; i < 4; i++) g.add(mesh(cone(1.3 - i * 0.28, 1.2, 16), mat('#1f6b3a'), 0, 1.0 + i * 0.75, 0));
  for (let i = 0; i < 22; i++) {
    const y = 0.7 + R() * 2.9, r = (1.25 - (y - 0.5) * 0.33) * 0.95, a = R() * 6.28;
    g.add(mesh(ball(0.08), glow(BRIGHT[i % 7], night ? 2.5 : 0.9), Math.cos(a) * r, y, Math.sin(a) * r));
  }
  g.add(mesh(new THREE.OctahedronGeometry(0.22), glow('#ffd43b', 2.5), 0, 4.0, 0));
  return g;
}
function basket(R) {
  const g = new THREE.Group(), wicker = mat('#b98a4b', { roughness: 1 });
  g.add(mesh(cyl(0.5, 0.38, 0.45, 16), wicker, 0, 0.23, 0));
  const handle = mesh(new THREE.TorusGeometry(0.46, 0.03, 6, 20, Math.PI), wicker, 0, 0.42, 0);
  g.add(handle);
  ['#d62828', '#f28c38', '#f2c230', '#5a9e3d', '#d62828', '#8d5fd3'].forEach((c, i) => {
    g.add(mesh(ball(0.13), mat(c, { roughness: 0.4 }), Math.cos(i) * 0.24, 0.5 + (i % 2) * 0.08, Math.sin(i) * 0.24));
  });
  return g;
}
function haystack(R) {
  const g = new THREE.Group(), hay = mat('#d8b24a', { roughness: 1 });
  [[0, 0.35, 0], [1.25, 0.35, 0.2], [0.6, 1.05, 0.1]].forEach(([x, y, z]) => {
    const b = mesh(cyl(0.6, 0.6, 1.1, 16), hay, x, y + 0.25, z);
    b.rotation.z = Math.PI / 2;
    b.rotation.y = (R() - 0.5) * 0.4;
    g.add(b);
  });
  const fork = mesh(cyl(0.025, 0.025, 1.8, 6), mat('#5d3b22'), -0.9, 0.9, 0.2);
  fork.rotation.z = 0.3;
  g.add(fork);
  return g;
}
function beehive(R, night, anims) {
  const g = new THREE.Group(), straw = mat('#e0b040', { roughness: 1 });
  g.add(mesh(box(0.9, 0.6, 0.9), mat('#8b5a36'), 0, 0.3, 0));
  for (let i = 0; i < 5; i++) put(g, mesh(new THREE.TorusGeometry(0.42 - i * 0.07, 0.11, 8, 20), straw, 0, 0.7 + i * 0.17, 0)).rotation.x = Math.PI / 2;
  g.add(mesh(ball(0.1), mat('#2b1d0e'), 0, 0.85, 0.42));
  const bees = [];
  for (let i = 0; i < 6; i++) { const b = mesh(ball(0.045), mat('#f4c20d')); bees.push(b); g.add(b); }
  anims.push((t) => bees.forEach((b, i) => b.position.set(Math.sin(t * (2 + i * 0.3) + i) * 0.9, 1.1 + Math.sin(t * 3 + i * 2) * 0.4, Math.cos(t * (1.7 + i * 0.4) + i) * 0.9)));
  return g;
}
function piano() {
  const g = new THREE.Group(), black = mat('#15161a', { roughness: 0.2, metalness: 0.3 });
  g.add(mesh(box(1.7, 1.1, 0.6), black, 0, 0.75, -0.15), mesh(box(1.7, 0.1, 0.4), black, 0, 0.72, 0.3));
  g.add(mesh(box(1.55, 0.04, 0.3), mat('#fbfbf5'), 0, 0.79, 0.32));
  for (let i = 0; i < 10; i++) g.add(mesh(box(0.07, 0.05, 0.18), black, -0.68 + i * 0.15 + (i % 3 === 2 ? 0.04 : 0), 0.82, 0.27));
  for (const s of [-1, 1]) g.add(mesh(box(0.1, 0.7, 0.1), black, s * 0.78, 0.35, 0.42));
  g.add(mesh(box(0.7, 0.08, 0.35), black, 0, 0.5, 0.95), mesh(box(0.08, 0.5, 0.08), black, 0, 0.25, 0.95));
  return g;
}
function drums() {
  const g = new THREE.Group(), red = mat('#c62828', { roughness: 0.35 }), skin = mat('#f4efe2');
  const kick = mesh(cyl(0.5, 0.5, 0.45, 20), red, 0, 0.5, 0);
  kick.rotation.x = Math.PI / 2;
  g.add(kick, mesh(cyl(0.46, 0.46, 0.02, 20), skin, 0, 0.5, 0.23));
  g.children[1].rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) {
    g.add(mesh(cyl(0.26, 0.26, 0.22, 16), red, s * 0.42, 1.12, 0), mesh(cyl(0.25, 0.25, 0.02, 16), skin, s * 0.42, 1.24, 0));
    g.add(mesh(cyl(0.02, 0.02, 1.5, 6), metal(), s * 1.0, 0.75, -0.2));
    const cym = mesh(cyl(0.36, 0.36, 0.015, 20), metal('#d9b23a'), s * 1.0, 1.5, -0.2);
    cym.rotation.z = s * 0.15;
    g.add(cym);
  }
  return g;
}
function guitar(R, night, anims, held) {
  const g = new THREE.Group(), wood = mat('#c98b4a', { roughness: 0.35 });
  const a = mesh(ball(0.3), wood, 0, 0.35, 0), b = mesh(ball(0.23), wood, 0, 0.72, 0);
  a.scale.z = b.scale.z = 0.3;
  g.add(a, b, mesh(ball(0.08), mat('#2b1d0e'), 0, 0.55, 0.08));
  g.add(mesh(box(0.08, 0.85, 0.04), mat('#4a3120'), 0, 1.3, 0.02), mesh(box(0.12, 0.2, 0.05), mat('#4a3120'), 0, 1.8, 0.02));
  g.rotation.set(-0.2, 0, 0.15);
  if (held) return g;
  const amp = mesh(box(0.7, 0.7, 0.4), mat('#24272d'), 0.9, 0.35, -0.2);
  const wrap = new THREE.Group();
  wrap.add(g, amp, mesh(cyl(0.22, 0.22, 0.02, 16), mat('#6d727a'), 0.9, 0.38, 0.01));
  wrap.children[2].rotation.x = Math.PI / 2;
  return wrap;
}
function easel(R) {
  const g = new THREE.Group(), wood = mat('#9a6a3c');
  for (const [x, rz] of [[-0.35, -0.17], [0.35, 0.17]]) {
    const leg = mesh(box(0.06, 2.0, 0.06), wood, x, 1.0, 0);
    leg.rotation.z = rz;
    g.add(leg);
  }
  const back = mesh(box(0.06, 2.0, 0.06), wood, 0, 0.95, -0.4);
  back.rotation.x = 0.4;
  g.add(back, mesh(box(1.0, 0.8, 0.04), mat('#fbfbf5'), 0, 1.35, 0.06), mesh(box(1.0, 0.06, 0.12), wood, 0, 0.93, 0.08));
  for (let i = 0; i < 6; i++) {
    const blob = mesh(ball(0.1 + R() * 0.1), mat(BRIGHT[Math.floor(R() * 7)]), (R() - 0.5) * 0.7, 1.35 + (R() - 0.5) * 0.5, 0.08);
    blob.scale.z = 0.05;
    g.add(blob);
  }
  return g;
}
function globe(R, night, anims) {
  const g = new THREE.Group();
  g.add(mesh(box(0.8, 0.8, 0.8), mat('#7a5230'), 0, 0.4, 0), mesh(cyl(0.25, 0.3, 0.08, 16), metal('#d9b23a'), 0, 0.84, 0));
  const w = pivot(g, 0, 1.4, 0);
  w.add(mesh(ball(0.45), mat('#2f7fc1', { roughness: 0.4 })));
  for (let i = 0; i < 7; i++) {
    const land = mesh(ball(0.14 + R() * 0.1), mat('#4f9a4a'));
    land.position.setFromSphericalCoords(0.4, 0.6 + R() * 1.9, R() * 6.28);
    land.scale.setScalar(0.9);
    w.add(land);
  }
  w.rotation.z = 0.4;
  anims.push((t) => { w.rotation.y = t * 0.7; });
  return g;
}
function trophy() {
  const g = new THREE.Group(), gold = mat('#f5c542', { metalness: 0.9, roughness: 0.2 });
  g.add(mesh(box(0.7, 0.9, 0.7), mat('#e9e4d8'), 0, 0.45, 0), mesh(box(0.4, 0.15, 0.4), mat('#24272d'), 0, 0.98, 0));
  g.add(mesh(cyl(0.05, 0.12, 0.3, 12), gold, 0, 1.2, 0), mesh(cyl(0.28, 0.1, 0.45, 16), gold, 0, 1.55, 0));
  for (const s of [-1, 1]) g.add(mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 14), gold, s * 0.3, 1.58, 0));
  return g;
}
function rainbow() {
  const g = new THREE.Group();
  ['#e63946', '#f28c38', '#f2c230', '#34c759', '#2e86ab', '#8d5fd3'].forEach((c, i) => {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(34 - i * 1.3, 0.65, 6, 60, Math.PI),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55, fog: false }));
    g.add(arc);
  });
  g.position.y = -2;
  return g;
}
function swordstone() {
  const g = new THREE.Group();
  const stone = mesh(ico(0.8, 0), flat('#8a8d93'), 0, 0.4, 0);
  stone.scale.set(1.3, 0.8, 1.1);
  g.add(stone, mesh(box(0.09, 1.1, 0.03), metal('#d9dee6'), 0, 1.35, 0), mesh(box(0.42, 0.07, 0.07), metal('#d9b23a'), 0, 1.9, 0));
  g.add(mesh(cyl(0.035, 0.035, 0.3, 8), mat('#5d3b22'), 0, 2.08, 0), mesh(ball(0.06), metal('#d9b23a'), 0, 2.26, 0));
  return g;
}
function dish() {
  const g = new THREE.Group();
  g.add(mesh(cyl(0.08, 0.12, 1.6, 10), metal(), 0, 0.8, 0));
  const d = mesh(new THREE.SphereGeometry(1.0, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.32), mat('#f4f4f4', { side: THREE.DoubleSide, roughness: 0.4 }), 0, 2.5, 0);
  d.rotation.x = Math.PI - 0.9;
  g.add(d);
  const feed = mesh(cyl(0.02, 0.02, 0.9, 6), metal('#2b2e35'), 0, 2.05, 0.55);
  feed.rotation.x = 0.9;
  g.add(feed);
  return g;
}
function wheelbarrow() {
  const g = new THREE.Group(), wheels = [];
  const tub = mesh(box(0.8, 0.4, 1.1), mat('#2f9e44', { roughness: 0.5 }), 0, 0.65, -0.1);
  tub.rotation.x = -0.1;
  g.add(tub);
  wheel(g, wheels, 0, 0.7, 0.26, 0.1);
  for (const s of [-1, 1]) {
    g.add(mesh(box(0.05, 0.05, 1.9), mat('#5d3b22'), s * 0.35, 0.5, -0.4), mesh(box(0.05, 0.4, 0.05), mat('#2b2e35'), s * 0.3, 0.2, -0.5));
  }
  const dirt = mesh(ball(0.38), mat('#6b4a2b', { roughness: 1 }), 0, 0.85, -0.1);
  dirt.scale.y = 0.5;
  g.add(dirt);
  return g;
}
function bathtub() {
  const g = new THREE.Group(), white = mat('#fbfbfb', { roughness: 0.15 });
  const tub = mesh(capsule(0.5, 1.1), white, 0, 0.55, 0);
  tub.rotation.z = Math.PI / 2;
  tub.scale.y = 1;
  g.add(tub, mesh(box(1.5, 0.04, 0.8), mat('#9fd3f0', { transparent: true, opacity: 0.8 }), 0, 0.9, 0));
  for (let i = 0; i < 7; i++) g.add(mesh(ball(0.12 + (i % 3) * 0.04), mat('#ffffff', { transparent: true, opacity: 0.9 }), -0.5 + i * 0.17, 0.98, (i % 2) * 0.25 - 0.12));
  g.add(mesh(cyl(0.025, 0.025, 0.5, 8), metal(), 0.85, 1.1, 0));
  return g;
}
function fridge() {
  const g = new THREE.Group(), white = mat('#eef0f2', { roughness: 0.25, metalness: 0.2 });
  g.add(mesh(box(0.9, 1.9, 0.8), white, 0, 0.95, 0), mesh(box(0.86, 0.02, 0.02), mat('#9aa0a8'), 0, 1.3, 0.41));
  for (const y of [1.55, 1.0]) g.add(mesh(box(0.04, 0.35, 0.05), metal(), 0.34, y, 0.43));
  return g;
}
function computer() {
  const g = new THREE.Group(), wood = mat('#9a6a3c'), dark = mat('#1b1d22');
  g.add(mesh(box(1.7, 0.08, 0.8), wood, 0, 0.78, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(box(0.08, 0.78, 0.08), wood, sx * 0.78, 0.39, sz * 0.34));
  g.add(mesh(box(0.85, 0.52, 0.05), dark, 0, 1.25, -0.15), mesh(box(0.78, 0.45, 0.01), glow('#7cc4ff', 1.3), 0, 1.25, -0.12));
  g.add(mesh(box(0.08, 0.2, 0.06), dark, 0, 0.92, -0.15), mesh(box(0.6, 0.03, 0.22), dark, 0, 0.84, 0.15));
  g.add(mesh(box(0.5, 0.5, 0.5), mat('#3d5a80'), 0, 0.5, 0.75), mesh(box(0.5, 0.6, 0.08), mat('#3d5a80'), 0, 0.9, 0.98));
  return g;
}
function phonebooth(R, night) {
  const g = new THREE.Group(), red = mat('#c62828', { roughness: 0.4 });
  g.add(mesh(box(1.0, 0.15, 1.0), red, 0, 0.08, 0), mesh(box(1.0, 0.25, 1.0), red, 0, 2.5, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(box(0.1, 2.4, 0.1), red, sx * 0.45, 1.25, sz * 0.45));
  g.add(mesh(box(0.85, 2.2, 0.85), night ? glow('#ffe7a3', 0.7) : mat('#bfe0f2', { transparent: true, opacity: 0.45, roughness: 0.1 }), 0, 1.25, 0));
  g.add(mesh(cyl(0.5, 0.5, 0.1, 4), red, 0, 2.68, 0));
  return g;
}
function busstop() {
  const g = new THREE.Group(), steel = metal('#6d737c');
  for (const s of [-1, 1]) g.add(mesh(box(0.08, 2.3, 0.08), steel, s * 1.4, 1.15, -0.5));
  g.add(mesh(box(3.1, 0.08, 1.3), steel, 0, 2.35, 0), mesh(box(2.8, 1.6, 0.04), mat('#bfe0f2', { transparent: true, opacity: 0.45, roughness: 0.1 }), 0, 1.3, -0.5));
  g.add(mesh(box(2.2, 0.08, 0.4), mat('#8b5a36'), 0, 0.5, -0.2));
  for (const s of [-1, 1]) g.add(mesh(box(0.08, 0.5, 0.35), steel, s * 0.9, 0.25, -0.2));
  g.add(mesh(cyl(0.04, 0.04, 2.6, 8), steel, 2.0, 1.3, 0.3), mesh(box(0.5, 0.5, 0.04), mat('#1c7ed6'), 2.0, 2.4, 0.33));
  return g;
}
function balloons(R, night, anims) {
  const g = new THREE.Group(), bunch = [];
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Group();
    const body = mesh(ball(0.3), mat(BRIGHT[i % 7], { roughness: 0.25 }), 0, 0, 0);
    body.scale.y = 1.2;
    b.add(body, mesh(cyl(0.006, 0.006, 2.2, 4), mat('#f4f4f4'), 0, -1.45, 0));
    b.userData = { x: (R() - 0.5) * 1.3, y: 2.7 + R() * 0.9, z: (R() - 0.5) * 0.8 };
    bunch.push(b);
    g.add(b);
  }
  g.add(mesh(box(0.3, 0.3, 0.3), mat('#6d727a'), 0, 0.15, 0));
  anims.push((t) => bunch.forEach((b, i) => {
    b.position.set(b.userData.x + Math.sin(t * 1.1 + i) * 0.12, b.userData.y + Math.sin(t * 1.6 + i * 2) * 0.08, b.userData.z);
  }));
  return g;
}
function bone() {
  const g = new THREE.Group(), white = mat('#f4efe2');
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Group();
    const shaft = mesh(cyl(0.05, 0.05, 0.6, 8), white);
    shaft.rotation.z = Math.PI / 2;
    b.add(shaft);
    for (const s of [-1, 1]) for (const z of [-1, 1]) b.add(mesh(ball(0.08), white, s * 0.32, 0, z * 0.06));
    b.position.set(i * 0.5 - 0.2, 0.08, i * 0.4);
    b.rotation.y = i * 1.1;
    g.add(b);
  }
  return g;
}
function shield() {
  const g = new THREE.Group();
  const rack = mesh(box(1.6, 0.08, 0.08), mat('#5d3b22'), 0, 1.3, 0);
  g.add(rack);
  for (const s of [-1, 1]) g.add(mesh(box(0.08, 1.4, 0.08), mat('#5d3b22'), s * 0.75, 0.7, 0));
  const sh = mesh(cyl(0.45, 0.45, 0.07, 20), mat('#1f3a6e', { roughness: 0.4 }), -0.3, 0.85, 0.1);
  sh.rotation.x = Math.PI / 2;
  g.add(sh, mesh(ball(0.1), metal('#d9b23a'), -0.3, 0.85, 0.15));
  const blade = mesh(box(0.07, 1.1, 0.02), metal('#d9dee6'), 0.4, 0.75, 0.1);
  g.add(blade, mesh(box(0.3, 0.06, 0.06), metal('#d9b23a'), 0.4, 1.28, 0.1));
  return g;
}
const PROP_BUILDERS = { beachball, kite, umbrella, books, bed, sofa, tv, clock, door, ladder, mailbox, trashcan,
  trafficlight, stopsign, hydrant, swing, slide, sandcastle, surfboard, cannon, ferriswheel, carousel, telescope,
  cake, gift, xmastree, basket, haystack, beehive, piano, drums, guitar, easel, globe, trophy, rainbow, swordstone,
  dish, wheelbarrow, bathtub, fridge, computer, phonebooth, busstop, balloons, bone, shield, bridge, fence, well, statue, windmill, bench, fountain, grave, snowman, table,
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

function skyDome(horizon, zenith) {   // a gradient sky instead of one flat colour
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: zenith }, bottom: { value: horizon } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vDir; void main() { float h = clamp(vDir.y * 1.5, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.6)), 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), m);
  dome.renderOrder = -1;
  return dome;
}
let haloTexture = null;
function glowTexture() {
  if (haloTexture) return haloTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d'), grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return (haloTexture = new THREE.CanvasTexture(c));
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
    for (let i = 0; i < spec.count; i++) actors.push(makeActor({ ...spec, name: i ? null : spec.name }, actors.length, { R, night, anims }));
  });
  // Riders are attached to whatever they ride and take no place of their own on stage.
  actors.forEach((a) => {
    const m = a.riding && actors.find((b) => b.id === a.riding && b !== a && !b.riding);
    if (!m) return;
    const seat = m.seats[Math.min(m.riders, m.seats.length - 1)];
    const extra = Math.max(0, m.riders - m.seats.length + 1);
    a.seat = [seat[0], seat[1], seat[2] - extra * 0.55, seat[3]];
    a.mount = m;
    a.aquatic = m.aquatic;
    a.flying = m.flying;
    m.riders += 1;
  });
  actors.sort((a, b) => (a.mount ? 1 : 0) - (b.mount ? 1 : 0));    // mounts move first
  // Ambient actors are background life: never on the stage mark, never followed by the camera.
  const riders = actors.filter((a) => a.mount);
  const cast = actors.filter((a) => !a.ambient && !a.mount), extras = actors.filter((a) => a.ambient && !a.mount);
  const landActors = actors.filter((a) => !a.aquatic && !(a.ambient && a.flying));
  const centreIsland = water && (landActors.length > 0 || sc.props.length > 0);

  // ground
  const groundColor = snowy ? GROUND.snow : GROUND[setting] || GROUND.meadow;
  if (water) {
    const geo = new THREE.PlaneGeometry(500, 500, 60, 60);
    geo.rotateX(-Math.PI / 2);
    const sea = new THREE.Mesh(geo, mat(setting === 'ocean' ? '#1f78ad' : '#2f8aa3', {
      roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.92, flatShading: true }));
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
    const island = add(mesh(cyl(12, 17, 1.4, 40), groundMat(groundColor, 7), 0, -0.7, 0));
    island.castShadow = false;
    if (!centreIsland) island.position.set(-34, -0.7, -30);
    const foam = new THREE.Mesh(new THREE.RingGeometry(13.2, 14.6, 56),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45 }));
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(island.position.x, WATER_Y + 0.2, island.position.z);
    add(foam);
    anims.push((t) => { foam.scale.setScalar(1 + Math.sin(t * 1.2) * 0.02); foam.material.opacity = 0.35 + Math.sin(t * 1.2) * 0.12; });
    const palm = setting === 'ocean';
    for (let i = 0; i < 7; i++) {
      const tr = add(tree(R, snowy, palm)), a = R() * 6.28, r = 3 + R() * 7;
      if (centreIsland) tr.position.set((i % 2 ? 1 : -1) * (5.5 + R() * 4.5), 0, -1 - R() * 5);  // frame the stage
      else tr.position.set(island.position.x + Math.cos(a) * r, 0, island.position.z + Math.sin(a) * r);
    }
    scatter(R, 8, 40, 120, () => { const r = add(rock(R)); r.scale.multiplyScalar(2.5); return r; });
  } else {
    const ground = add(mesh(new THREE.CircleGeometry(320, 64), groundMat(groundColor, 95)));
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
  let dome = null;
  if (!space) {
    const deep = { day: '#2a6cc4', dawn: '#6f9bd6', sunset: '#3a4488', night: '#01030f' }[sc.time] || '#2a6cc4';
    const zenith = clearSky ? env.sky.clone().lerp(new THREE.Color(deep), 0.85) : env.sky.clone().multiplyScalar(0.62);
    dome = add(skyDome(env.sky, zenith));
  }
  if (clearSky && !space && !FLAT) {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: env.disc, transparent: true,
      opacity: night ? 0.35 : 0.8, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    halo.position.copy(env.dir).multiplyScalar(325);
    halo.scale.setScalar(night ? 70 : sc.time === 'day' ? 110 : 170);
    add(halo);
  }
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
  const propObjects = {};
  sc.props.forEach((p, i) => {
    const build = PROP_BUILDERS[p.base];
    if (!build) return;
    const obj = add(build(R, night, anims));
    propObjects[p.kind] = obj;
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
  riders.forEach((a) => root.add(a.wrap));
  // Furniture comes to whoever is using it.
  Object.keys(PERCH).forEach((kind) => {
    const users = cast.filter((a) => a.on === kind && !a.moving), obj = propObjects[kind];
    if (!users.length || !obj) return;
    const cx = users.reduce((sum, a) => sum + a.x0, 0) / users.length, lie = PERCH[kind][0] === 'lie';
    obj.position.set(lie ? cx - 0.9 : cx, 0, kind === 'barrel' ? -0.4 : 0);
    obj.rotation.y = lie ? Math.PI / 2 : 0;
    users.forEach((a) => { a.perch = PERCH[kind]; a.z0 = lie ? 0 : 0.06; a.seated = true; });
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
  cast.forEach((a, j) => { if (a.seated) { a.facing = 0; return; } a.facing = facing ? (j <= mid ? Math.PI / 2 : -Math.PI / 2) : (j - mid) * -0.12; });

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
    root, env, dome, duration: sc.duration,
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
  const core = mesh(ico(2.2, 1), flat(mood.colors[0], { roughness: 0.4, metalness: 0.2 }), 0, 4, 0);
  const cage = new THREE.Mesh(ico(3.1, 1), new THREE.MeshBasicMaterial({ color: mood.colors[2], wireframe: true, fog: false }));
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
    if (shot.dome) shot.dome.visible = !flash;       // lightning lights the whole sky
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
