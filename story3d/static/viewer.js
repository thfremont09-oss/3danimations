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
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  m.castShadow = geo.boundingSphere.radius > 0.05;     // a button or a seed casts no shadow worth drawing
  m.receiveShadow = true;
  return m;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const ico = (r, detail = 0) => new THREE.IcosahedronGeometry(r, detail);
// Spheres get as many segments as their size can show, and identical ones share geometry.
const shapeCache = new Map();
const cached = (key, make) => shapeCache.get(key) || shapeCache.set(key, make()).get(key);
const ball = (r, detail = 1) => {
  if (!detail) return ico(r, 0);
  const [w, h] = detail >= 2 || r >= 0.25 ? [24, 16] : r >= 0.08 ? [16, 11] : r >= 0.03 ? [11, 8] : [8, 6];
  return cached(`b${r.toFixed(4)}:${w}`, () => new THREE.SphereGeometry(r, w, h));
};
// A lighter sphere for foliage and other background clumps.
const blob = (r) => cached(`l${r.toFixed(3)}`, () => new THREE.SphereGeometry(r, 10, 7));
const soft = (r) => cached(`s${r.toFixed(2)}`, () => new THREE.SphereGeometry(r, 16, 10));   // hills and dunes
const capsule = (r, len) => cached(`c${r.toFixed(4)}:${len.toFixed(4)}`,
  () => (r < 0.04 ? new THREE.CapsuleGeometry(r, len, 3, 8) : new THREE.CapsuleGeometry(r, len, 6, 14)));
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

// ---- richer shapes -----------------------------------------------------------
// A box with softened edges and corners.
const rboxCache = new Map();
function rbox(w, h, d, r = Math.min(w, h, d) * 0.2) {
  const key = [w, h, d, r].map((v) => v.toFixed(3)).join();
  if (rboxCache.has(key)) return rboxCache.get(key);
  r = Math.max(0.002, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
  const b = r * 0.45, c = r - b, iw = w - 2 * b, ih = h - 2 * b;
  const s = new THREE.Shape();
  s.moveTo(-iw / 2 + c, -ih / 2);
  s.lineTo(iw / 2 - c, -ih / 2); s.quadraticCurveTo(iw / 2, -ih / 2, iw / 2, -ih / 2 + c);
  s.lineTo(iw / 2, ih / 2 - c); s.quadraticCurveTo(iw / 2, ih / 2, iw / 2 - c, ih / 2);
  s.lineTo(-iw / 2 + c, ih / 2); s.quadraticCurveTo(-iw / 2, ih / 2, -iw / 2, ih / 2 - c);
  s.lineTo(-iw / 2, -ih / 2 + c); s.quadraticCurveTo(-iw / 2, -ih / 2, -iw / 2 + c, -ih / 2);
  const geo = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * b), bevelEnabled: true,
    bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 3 });
  geo.translate(0, 0, -Math.max(0.001, d - 2 * b) / 2);
  geo.computeVertexNormals();
  rboxCache.set(key, geo);
  return geo;
}
// A shape turned on a lathe from [radius, height] pairs: vases, trunks, bottles, towers.
const lathe = (pts, segs = 18) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)), segs);
// A smooth tube through points: tails, branches, handles, horns.
const tube = (pts, r, segs = 20, sides = 8) =>
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), segs, r, sides, false);
// A flat outline given thickness: leaves, flags, fins, panels.
function slab(points, depth, bevel = 0) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 });
  geo.translate(0, 0, -depth / 2);
  return geo;
}
const dome = (r, part = 0.5) => new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI * part);
const gem = (r) => new THREE.OctahedronGeometry(r);
const dodeca = (r) => new THREE.DodecahedronGeometry(r);
const tetra = (r) => new THREE.TetrahedronGeometry(r);

// Fuse a still piece of scenery into one mesh per material: same look, far fewer draw calls.
const bakeKey = (m) => [m.type, m.color.getHexString(), m.emissive ? m.emissive.getHexString() + m.emissiveIntensity : '',
  m.flatShading, m.roughness, m.metalness, m.side, m.transparent, m.opacity, m.map ? m.map.uuid : ''].join('|');
// Fuse the rigid parts of a model: meshes that never move on their own relative to
// their parent. Pivots (wheels, limbs, heads) keep moving; anything listed in keep
// (a mouth, fire, a rotor) stays a separate mesh.
// A mirrored part (scale -1) turns inside out once its matrix is baked in: swap each
// triangle's winding back.
function unmirror(geo, matrix) {
  if (matrix.determinant() >= 0) return geo;
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name], n = a.itemSize, arr = a.array;
    for (let t = 0; t < a.count; t += 3) for (let k = 0; k < n; k++) {
      const i1 = (t + 1) * n + k, i2 = (t + 2) * n + k, v = arr[i1];
      arr[i1] = arr[i2];
      arr[i2] = v;
    }
  }
  return geo;
}
function bakeStatic(node, keep) {
  const loose = node.children.filter((c) => c.isMesh && !keep.has(c) && !c.children.length
    && c.material && !Array.isArray(c.material));
  if (loose.length > 1) {
    const buckets = new Map();
    loose.forEach((m) => {
      m.updateMatrix();
      const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      geo.applyMatrix4(m.matrix);
      unmirror(geo, m.matrix);
      const key = bakeKey(m.material);
      if (!buckets.has(key)) buckets.set(key, { material: m.material, geos: [], shadow: false });
      const b = buckets.get(key);
      b.geos.push(geo);
      b.shadow = b.shadow || m.castShadow;
      node.remove(m);
    });
    buckets.forEach(({ material, geos, shadow }) => {
      const merged = mergeGeos(geos);
      if (!merged) return;
      const m = new THREE.Mesh(merged, material);
      m.castShadow = shadow;
      m.receiveShadow = true;
      node.add(m);
    });
  }
  node.children.forEach((c) => { if (c.children.length || c.isGroup) bakeStatic(c, keep); });   // into heads too; the mouth stays its own
}
function mergeGeos(geos) {
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    if (!geos.every((g) => g.attributes[name])) { if (name === 'position') return null; continue; }
    const size = geos[0].attributes[name].itemSize;
    const arr = new Float32Array(geos.reduce((n, g) => n + g.attributes[name].count, 0) * size);
    let off = 0;
    geos.forEach((g) => { arr.set(g.attributes[name].array, off); off += g.attributes[name].count * size; });
    merged.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  merged.computeBoundingSphere();
  return merged;
}
function bakeInPlace(group) {
  if (!group || !group.isGroup) return group;
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert(), rel = new THREE.Matrix4();
  const buckets = new Map();
  group.traverse((m) => {
    if (!m.isMesh) return;
    rel.multiplyMatrices(inv, m.matrixWorld);
    const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    geo.applyMatrix4(rel);
    unmirror(geo, rel);
    const key = bakeKey(m.material);
    if (!buckets.has(key)) buckets.set(key, { material: m.material, geos: [] });
    buckets.get(key).geos.push(geo);
  });
  group.clear();
  buckets.forEach(({ material, geos }) => {
    const merged = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      if (!geos.every((g) => g.attributes[name])) continue;
      const size = geos[0].attributes[name].itemSize;
      const arr = new Float32Array(geos.reduce((n, g) => n + g.attributes[name].count, 0) * size);
      let off = 0;
      geos.forEach((g) => { arr.set(g.attributes[name].array, off); off += g.attributes[name].count * size; });
      merged.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    const m = new THREE.Mesh(merged, material);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  });
  return group;
}
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
  const trim = mat(mix(color, '#000000', 0.35), o.armor ? steel : ghost);
  if (o.robe) {
    g.add(mesh(lathe([[0.5, 0.04], [0.47, 0.3], [0.32, 0.9], [0.2, 1.3]], 22), cloth, 0, 0, 0));
    put(g, mesh(new THREE.TorusGeometry(0.49, 0.025, 6, 24), trim, 0, 0.06, 0)).rotation.x = Math.PI / 2;   // hem
    put(g, mesh(new THREE.TorusGeometry(0.29, 0.03, 6, 20), trim, 0, 0.95, 0)).rotation.x = Math.PI / 2;    // sash
  } else {
    const torso = mesh(capsule(0.19, 0.34), cloth, 0, 1.08, 0);
    torso.scale.set(1.15, 1, 0.8);
    g.add(torso);
    const hips = mesh(ball(0.2), pants, 0, 0.82, 0);
    hips.scale.set(1.1, 0.7, 0.85);
    g.add(hips);
    const belt = mesh(cyl(0.215, 0.215, 0.06, 20), mat(o.armor ? '#6b4a2b' : '#3a2a22'), 0, 0.9, 0);
    belt.scale.z = 0.8;
    g.add(belt, mesh(rbox(0.07, 0.055, 0.02, 0.01), mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), 0, 0.9, 0.17));
    for (let i = 0; i < 3; i++) g.add(mesh(ball(0.016), trim, 0, 1.0 + i * 0.1, 0.155 - i * 0.004));   // buttons
    for (const s of [-1, 1]) {
      const p = pivot(g, s * 0.11, 0.8, 0);
      p.add(mesh(capsule(0.075, 0.56), pants, 0, -0.37, 0));
      p.add(mesh(cyl(0.082, 0.082, 0.05, 14), mat(mix(o.armor ? '#8892a0' : '#2f3542', '#000000', 0.2)), 0, -0.66, 0));  // hem
      const shoe = mesh(ball(0.09), mat('#2a2522'), 0, -0.75, 0.05);
      shoe.scale.set(0.9, 0.6, 1.5);
      p.add(shoe, mesh(rbox(0.15, 0.025, 0.26, 0.01), mat('#151312'), 0, -0.79, 0.05));                          // sole
      legs.push(p);
    }
  }
  for (const s of [-1, 1]) {
    const p = pivot(g, s * 0.29, 1.34, 0);
    p.rotation.order = 'YXZ';                     // yaw last, so a hand can reach across to the mouth
    p.add(mesh(capsule(0.056, 0.2), cloth, 0, -0.155, 0));
    const elbow = pivot(p, 0, -0.31, 0);
    elbow.add(mesh(ball(0.054), cloth));
    elbow.add(mesh(capsule(0.05, 0.19), cloth, 0, -0.145, 0));
    elbow.add(mesh(cyl(0.057, 0.057, 0.04, 12), trim, 0, -0.25, 0));                 // cuff
    const hand = pivot(elbow, 0, -0.3, 0);
    hand.add(mesh(ball(0.06), skin));
    put(hand, mesh(capsule(0.018, 0.04), skin, -s * 0.045, 0.0, 0.035)).rotation.z = -s * 0.6;   // thumb
    p.userData = { side: s, elbow, hand, L1: 0.31, L2: 0.3 };
    arms.push(p);
  }
  g.add(mesh(cyl(0.07, 0.08, 0.12, 10), skin, 0, 1.38, 0));
  put(g, mesh(new THREE.TorusGeometry(0.09, 0.025, 6, 16), trim, 0, 1.34, 0)).rotation.x = Math.PI / 2;   // collar
  const hr = o.bigHead ? 0.34 : 0.2;
  const head = mesh(ball(hr), skin, 0, 1.42 + hr, 0);
  if (!o.bigHead) head.scale.y = 1.08;
  for (const s of [-1, 1]) {
    const white = mesh(ball(hr * 0.17), mat('#fbfbf7', ghost), s * hr * 0.36, hr * 0.12, hr * 0.84);
    white.scale.z = 0.6;
    head.add(white, mesh(ball(hr * 0.11), mat('#1b1b1f'), s * hr * 0.36, hr * 0.11, hr * 0.94));
    put(head, mesh(rbox(hr * 0.32, hr * 0.06, hr * 0.06, hr * 0.02), mat(o.bigHead ? '#1b1b1f' : '#3b2a1a'), s * hr * 0.36, hr * 0.38, hr * 0.86)).rotation.z = -s * 0.15;  // brow
    const ear = mesh(ball(hr * 0.2), skin, s * hr * 0.98, 0, 0);
    ear.scale.set(0.45, 1, 0.7);
    if (!o.bigHead) head.add(ear);
  }
  const nose = mesh(ball(hr * 0.13), skin, 0, -hr * 0.1, hr * 0.98);
  nose.scale.set(0.9, 1, 1.1);
  head.add(nose);
  const lips = mesh(ball(hr * 0.2), mat('#7a2e2e'), 0, -hr * 0.4, hr * 0.88);
  lips.scale.set(1.3, 0.25, 0.5);
  head.add(lips);
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
  g.userData = { legs, arms, head, lips, mouthAt: [0, 1.42 + hr - hr * 0.42, hr * 0.98 + 0.05],
    height: top + (o.hat ? 0.55 : 0.12) };
  return g;
}

function buildRobot() {
  const g = new THREE.Group();
  const metal = mat('#9aa7b5', { metalness: 0.7, roughness: 0.4 });
  const dark = mat('#4a5562', { metalness: 0.6, roughness: 0.5 });
  const legs = [], arms = [];
  g.add(mesh(rbox(0.6, 0.7, 0.4, 0.06), metal, 0, 1.05, 0));
  g.add(mesh(rbox(0.34, 0.26, 0.04, 0.03), dark, 0, 1.12, 0.2));                     // chest panel
  g.add(mesh(box(0.22, 0.06, 0.05), glow('#5eead4'), 0, 1.16, 0.22));
  ['#ff5d5d', '#ffd166', '#5eead4'].forEach((c, i) => g.add(mesh(ball(0.022), glow(c, 2), (i - 1) * 0.07, 1.06, 0.225)));
  g.add(mesh(rbox(0.62, 0.08, 0.42, 0.03), dark, 0, 0.74, 0), mesh(rbox(0.36, 0.42, 0.14, 0.04), dark, 0, 1.08, -0.26));   // belt, power pack
  g.add(mesh(cyl(0.08, 0.1, 0.12, 10), dark, 0, 1.44, 0));                          // neck
  for (const s of [-1, 1]) {
    const leg = pivot(g, s * 0.16, 0.7, 0);
    leg.add(mesh(box(0.16, 0.7, 0.18), dark, 0, -0.35, 0));
    legs.push(leg);
    const arm = pivot(g, s * 0.39, 1.34, 0);
    arm.rotation.order = 'YXZ';
    arm.add(mesh(box(0.13, 0.3, 0.14), dark, 0, -0.15, 0));
    const elbow = pivot(arm, 0, -0.31, 0);
    elbow.add(mesh(ball(0.075), metal), mesh(box(0.12, 0.28, 0.13), dark, 0, -0.15, 0));
    const hand = pivot(elbow, 0, -0.31, 0);
    hand.add(mesh(rbox(0.14, 0.1, 0.14, 0.03), metal));
    for (const k of [-1, 1]) hand.add(mesh(box(0.03, 0.08, 0.03), dark, k * 0.04, -0.08, 0.03));   // claw fingers
    arm.add(mesh(ball(0.1), metal));                                                                  // shoulder joint
    leg.add(mesh(ball(0.09), metal, 0, -0.35, 0), mesh(rbox(0.2, 0.08, 0.3, 0.03), metal, 0, -0.68, 0.05));   // knee, foot
    arm.userData = { side: s, elbow, hand, L1: 0.31, L2: 0.31 };
    arms.push(arm);
  }
  const head = mesh(box(0.46, 0.38, 0.4), metal, 0, 1.63, 0);
  for (const s of [-1, 1]) head.add(mesh(ball(0.06, 1), glow('#ffd166'), s * 0.11, 0.02, 0.2));
  head.add(mesh(cyl(0.015, 0.015, 0.25, 5), dark, 0, 0.3, 0), mesh(cyl(0.04, 0.05, 0.04, 10), metal, 0, 0.2, 0));
  for (const k of [-1, 1]) put(head, mesh(cyl(0.05, 0.05, 0.06, 10), dark, k * 0.25, 0, 0)).rotation.z = Math.PI / 2;   // ear bolts
  head.add(mesh(ball(0.05, 1), glow('#ff5d5d'), 0, 0.44, 0));
  const lips = mesh(box(0.2, 0.05, 0.03), mat('#1d232b'), 0, -0.1, 0.205);
  head.add(lips);
  g.add(head);
  g.userData = { legs, arms, head, lips, mouthAt: [0, 1.53, 0.3], height: 2.2 };
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
  // Neck and head hang from one joint at the chest, so the head can dip to eat or bite.
  const neckPivot = pivot(g, 0, by, L / 2 - W * 0.3), np = neckPivot.position;
  if (neck) {
    const n = mesh(cyl(W * 0.2, W * 0.32, neck + W * 0.6, 12), m, 0, by + neck / 2 + W * 0.15 - np.y, L / 2 - W * 0.12 - np.z);
    n.rotation.x = 0.4;
    neckPivot.add(n);
  }
  if (o.mane) neckPivot.add(mesh(ball(W * 0.56), mat(mix(o.color, '#3a2208', 0.6)), 0, hy - W * 0.05 - np.y, hz - W * 0.32 - np.z));
  const head = mesh(ball(W * 0.4), plain, 0, hy - np.y, hz - np.z);
  head.scale.set(0.9, 0.9, 1.1);
  const snout = mesh(ball(W * 0.24), plain, 0, -W * 0.08, W * 0.36);
  snout.scale.z = 1.3;
  head.add(snout);
  head.add(mesh(ball(W * 0.07), mat('#15151a'), 0, -W * 0.04, W * 0.66));
  const light = mat(o.breath ? '#e0a83e' : mix(o.color, '#ffffff', 0.28));   // dragons have a golden scaled belly
  head.add(mesh(rbox(W * 0.22, W * 0.02, W * 0.02, W * 0.008), mat('#2a1a14'), 0, -W * 0.2, W * 0.52));   // mouth line
  for (const s of [-1, 1]) {
    const white = mesh(ball(W * 0.075), mat('#fbfbf7'), s * W * 0.24, W * 0.12, W * 0.25);
    white.scale.z = 0.7;
    head.add(white, mesh(ball(W * 0.055), mat('#15151a'), s * W * 0.25, W * 0.12, W * 0.29));
    head.add(mesh(ball(W * 0.018), mat('#ffffff'), s * W * 0.23, W * 0.15, W * 0.33));                     // glint
    head.add(mesh(ball(W * 0.025), mat('#2a1a14'), s * W * 0.05, -W * 0.02, W * 0.68));                  // nostril
    if (o.ears === 'up') head.add(mesh(cone(W * 0.07, W * 0.24, 8), mat('#e8a3a3'), s * W * 0.22, W * 0.38, -W * 0.04));
    if (o.ears === 'round') head.add(mesh(ball(W * 0.09), mat('#e8a3a3'), s * W * 0.3, W * 0.3, -W * 0.0));
    if (o.ears === 'up') head.add(mesh(cone(W * 0.13, W * 0.36, 10), dark, s * W * 0.22, W * 0.42, -W * 0.08));
    if (o.ears === 'round') head.add(mesh(ball(W * 0.14), dark, s * W * 0.3, W * 0.3, -W * 0.05));
    if (o.ears === 'long') head.add(mesh(capsule(W * 0.07, W * 0.7), plain, s * W * 0.16, W * 0.8, -W * 0.1));
  }
  if (o.horn) head.add(mesh(cone(W * 0.09, W * 0.8, 10), mat('#f3e3b3'), 0, W * 0.65, W * 0.15));
  if (o.trunk) head.add(mesh(cyl(W * 0.08, W * 0.14, H * 0.95, 10), plain, 0, -H * 0.5, W * 0.5));
  neckPivot.add(head);
  // How far the neck must tip for the mouth to reach the ground (or as low as it can).
  const sy = hy - np.y - W * 0.12, sz = hz - np.z + W * 0.62;
  let graze = 0, low = np.y + sy;
  for (let a = 0; a <= 1.35; a += 0.03) {
    graze = a;
    low = np.y + sy * Math.cos(a) - sz * Math.sin(a);
    if (low <= W * 0.15 + 0.03) break;
  }
  const grazeZ = np.z + sy * Math.sin(graze) + sz * Math.cos(graze);
  const belly = mesh(capsule(br * 0.8, Math.max(0.02, L - W) * 0.8), light, 0, by - br * 0.35, 0);
  belly.rotation.x = Math.PI / 2;
  belly.scale.set(1, 1, 0.7);
  g.add(belly, mesh(ball(br * 0.75), light, 0, by + br * 0.05, L / 2 - W * 0.05));   // pale belly and chest
  const lw = Math.max(0.035, W * 0.14);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const p = pivot(g, sx * (br - lw), H, sz * (L / 2 - lw * 1.6));
    p.add(mesh(cyl(lw, lw * 0.75, H, 10), m, 0, -H / 2, 0));
    p.add(mesh(ball(lw * 1.08), m, 0, -H * 0.5, lw * 0.1));                            // knee
    const paw = mesh(ball(lw * 1.05), dark, 0, -H + lw * 0.45, lw * 0.3);
    paw.scale.y = 0.6;
    p.add(paw);
    for (const k of [-1, 1]) p.add(mesh(ball(lw * 0.42), dark, k * lw * 0.45, -H + lw * 0.3, lw * 1.05));   // toes
    legs.push(p);
  }
  const tl = o.tail || 0.3;
  const tail = pivot(g, 0, by + br * 0.3, -L / 2 + br * 0.2);
  const tm = mesh(cyl(W * 0.04, W * 0.1, tl, 10), dark, 0, 0, -tl / 2);
  tm.rotation.x = Math.PI / 2;
  tail.add(tm, mesh(ball(W * 0.11), mat(mix(o.color, o.mane ? '#3a2208' : '#ffffff', 0.4)), 0, 0, -tl));   // tuft
  tail.rotation.x = 0.5;
  if (o.wings && o.breath) {                    // a dragon: spines down the back and horns
    for (let i = 0; i < 6; i++) g.add(mesh(cone(W * 0.08, W * 0.28, 6), mat('#f3e3b3'), 0, by + br * 0.95, L / 2 - W * 0.4 - i * (L - W * 0.4) / 6));
    for (const k of [-1, 1]) put(head, mesh(cone(W * 0.06, W * 0.5, 8), mat('#f3e3b3'), k * W * 0.18, W * 0.42, -W * 0.25)).rotation.x = -0.6;
  }
  if (o.wings) {
    // Bat-like wings: a scalloped membrane with a bony leading edge.
    const span = L * 0.85, chord = L * 0.42, shape = new THREE.Shape();
    shape.moveTo(0, chord * 0.45);
    shape.lineTo(span * 0.5, chord * 0.75);                        // up to the wrist
    shape.lineTo(span, chord * 0.35);                              // wing tip
    shape.quadraticCurveTo(span * 0.82, 0, span * 0.66, -chord * 0.12);
    shape.quadraticCurveTo(span * 0.5, chord * 0.05, span * 0.36, -chord * 0.3);
    shape.quadraticCurveTo(span * 0.2, -chord * 0.05, 0, -chord * 0.4);
    shape.lineTo(0, chord * 0.45);
    const membrane = new THREE.ShapeGeometry(shape, 10);
    membrane.rotateX(Math.PI / 2);                                 // lie flat, leading edge forward
    const skin = mat(mix(o.color, '#000000', 0.45), { side: THREE.DoubleSide, roughness: 0.7 });
    const up = new THREE.Vector3(0, 1, 0);
    for (const s of [-1, 1]) {
      const p = pivot(g, s * W * 0.35, by + br * 0.7, 0);
      const wing = mesh(membrane, skin);
      wing.scale.x = s;
      p.add(wing);
      [[0, chord * 0.45, span * 0.5, chord * 0.75], [span * 0.5, chord * 0.75, span, chord * 0.35]].forEach(([x0, z0, x1, z1]) => {
        const dir = new THREE.Vector3(s * (x1 - x0), 0, z1 - z0), len = dir.length();
        const bone = mesh(cyl(0.022, 0.04, len, 8), plain, s * (x0 + x1) / 2, 0.02, (z0 + z1) / 2);
        bone.quaternion.setFromUnitVectors(up, dir.normalize());
        p.add(bone);
      });
      p.userData.side = s;
      wings.push(p);
    }
  }
  let breath = null;
  if (o.breath) {
    breath = mesh(cone(W * 0.55, L * 0.9, 12), glow('#ff8a1c', 2.6), 0, 0, L * 0.45);
    breath.rotation.x = -Math.PI / 2;
    breath.castShadow = false;
    breath.visible = false;
    breath.userData.len = L * 0.9;
    const nozzle = pivot(neckPivot, 0, hy - W * 0.1 - np.y, hz + W * 0.5 - np.z);   // fire grows from the jaws
    nozzle.add(breath);
    breath.userData.nozzle = nozzle;
  }
  g.userData = { breath, legs, tail, wings, head, neck: neckPivot, grazeAngle: graze,
    grazeAt: [0, Math.max(0, low - W * 0.12), grazeZ], headH: hy, quad: true, height: hy + W * 0.6, sink: H * 0.85,
    mouth: [0, -W * 0.12, W * 0.74],
    seats: [[0, by + br * 0.8, L * 0.08, 'straddle'], [0, by + br * 0.8, -L * 0.28, 'straddle']] };
  return g;
}

function buildBird(o) {
  const g = new THREE.Group();
  const m = mat(o.color), dark = mat(mix(o.color, '#000000', 0.3)), pale = mat(mix(o.color, '#ffffff', 0.55));
  const beakM = mat('#f2a33a');
  const body = mesh(ball(0.22, 1), m, 0, 0.3, 0);
  body.scale.set(1, 0.85, 1.5);
  g.add(body);
  const breast = mesh(ball(0.17), pale, 0, 0.26, 0.14);
  breast.scale.set(1, 0.9, 1.1);
  g.add(breast, mesh(ball(0.14, 1), m, 0, 0.45, 0.28));
  const beak = mesh(cone(0.05, 0.16, 8), beakM, 0, 0.45, 0.46);
  beak.rotation.x = Math.PI / 2;
  const lower = mesh(cone(0.035, 0.11, 8), mat('#d98a2a'), 0, 0.41, 0.44);
  lower.rotation.x = Math.PI / 2 + 0.25;
  g.add(beak, lower);
  for (const s of [-1, 1]) {
    g.add(mesh(ball(0.03), mat('#fbfbf7'), s * 0.085, 0.48, 0.37), mesh(ball(0.02), mat('#101014'), s * 0.095, 0.485, 0.39));
    const leg = mesh(cyl(0.012, 0.012, 0.16, 6), beakM, s * 0.07, 0.1, 0.02);
    g.add(leg);
    for (const a of [-0.5, 0, 0.5]) put(g, mesh(box(0.012, 0.012, 0.07), beakM, s * 0.07 + Math.sin(a) * 0.03, 0.02, 0.05 + Math.cos(a) * 0.02)).rotation.y = a;
  }
  for (let i = 0; i < 3; i++) put(g, mesh(slab([[0, 0], [0.04, 0.1], [0, 0.32], [-0.04, 0.1]], 0.012), dark, (i - 1) * 0.05, 0.31, -0.33)).rotation.set(-Math.PI / 2 + 0.25, 0, (i - 1) * 0.35);
  put(g, mesh(slab([[0, 0], [0.03, 0.08], [0, 0.14], [-0.03, 0.08]], 0.01), dark, 0, 0.57, 0.24)).rotation.x = -0.4;   // crest
  const wings = [];
  const wing = slab([[0, -0.15], [0.3, -0.12], [0.55, 0.0], [0.42, 0.08], [0.2, 0.15], [0, 0.15]], 0.03);
  wing.rotateX(Math.PI / 2);
  for (const s of [-1, 1]) {
    const p = pivot(g, s * 0.14, 0.36, 0);
    const w = mesh(wing, dark);
    w.scale.x = s;
    p.add(w);
    for (let i = 0; i < 3; i++) p.add(mesh(box(0.05, 0.02, 0.16), m, s * (0.38 + i * 0.06), 0.01, -0.13 + i * 0.03));   // primaries
    p.userData.side = s;
    wings.push(p);
  }
  g.userData = { wings, height: 0.8 };
  return g;
}

function buildFish(o) {
  const g = new THREE.Group();
  const m = mat(o.color, { roughness: 0.4 }), pale = mat(mix(o.color, '#ffffff', 0.55), { roughness: 0.4 });
  const dark = mat(mix(o.color, '#000000', 0.3));
  const body = mesh(ball(0.3, 1), m, 0, 0, 0);
  body.scale.set(0.55, 0.8, 1.5);
  const belly = mesh(ball(0.26), pale, 0, -0.08, 0.02);
  belly.scale.set(0.5, 0.55, 1.4);
  g.add(body, belly);
  const tail = pivot(g, 0, 0, -0.42);
  const fin = mesh(slab([[0, 0], [0.22, -0.2], [0.18, 0], [0.22, 0.2]], 0.02), dark, 0, 0, -0.04);
  fin.rotation.y = Math.PI / 2;
  tail.add(fin);
  put(g, mesh(slab([[0, 0], [0.12, 0.2], [0.24, 0]], 0.02), dark, 0, 0.2, 0)).rotation.y = Math.PI / 2;   // dorsal fin
  for (const s of [-1, 1]) {
    g.add(mesh(ball(0.05), mat('#fbfbf7'), s * 0.13, 0.06, 0.28), mesh(ball(0.032), mat('#101014'), s * 0.15, 0.06, 0.3));
    const pec = mesh(slab([[0, 0], [0.12, -0.05], [0.1, 0.05]], 0.015), dark, s * 0.15, -0.06, 0.1);
    pec.rotation.y = s * 0.6;
    pec.scale.x = s;
    g.add(pec);
    put(g, mesh(new THREE.TorusGeometry(0.14, 0.008, 4, 10, 1.6), dark, s * 0.06, 0, 0.18)).rotation.set(0, s * Math.PI / 2, -0.8);   // gill
    for (let i = 0; i < 2; i++) g.add(mesh(box(0.01, 0.3, 0.05), dark, s * 0.155, 0, -0.05 - i * 0.14));     // stripes
  }
  g.add(mesh(rbox(0.08, 0.02, 0.02, 0.008), mat('#3a1d1d'), 0, -0.05, 0.44));                                   // mouth
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
  const wood = mat('#5d3b22');
  for (const s of [-1, 1]) {
    g.add(mesh(box(0.05, 0.08, 2.4), wood, s * 0.65, 0.52, 0));
    put(g, mesh(cyl(0.05, 0.05, 0.03, 10), mat('#bfe0f2', { roughness: 0.1 }), s * 0.66, 0.25, 0.5)).rotation.z = Math.PI / 2;
  }
  for (const z of [0.6, -0.6]) g.add(mesh(box(1.1, 0.05, 0.25), mat('#a9774a'), 0, 0.42, z));
  put(g, mesh(new THREE.TorusGeometry(0.12, 0.035, 6, 14), mat('#d9c38a'), 0.35, 0.5, -0.9)).rotation.x = Math.PI / 2;
  g.add(mesh(box(0.05, 0.5, 0.3), wood, 0, 0.0, -1.35));
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
  if (w < 0.1) {                                   // thin wheels have spokes
    for (let i = 0; i < 6; i++) put(p, mesh(box(w * 0.4, r * 1.8, 0.012), mat('#c3c8cf', { metalness: 0.7, roughness: 0.3 }))).rotation.x = (i * Math.PI) / 6;
  } else {
    for (const k of [-1, 1]) put(p, mesh(new THREE.TorusGeometry(r * 0.97, r * 0.06, 6, 20), mat('#2a2a30'), k * w * 0.3, 0, 0)).rotation.y = Math.PI / 2;   // tread
    put(p, mesh(cyl(r * 0.2, r * 0.2, w * 1.14, 10), mat('#8a9099', { metalness: 0.8, roughness: 0.25 }))).rotation.z = Math.PI / 2;   // hubcap
  }
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
  // mirrors, handles, grille, plates, exhaust, aerial, wipers, a stripe
  const chrome = mat('#c3c8cf', { metalness: 0.8, roughness: 0.25 }), black = mat('#1d1d22');
  for (const s of [-1, 1]) {
    g.add(mesh(rbox(0.07, 0.08, 0.14, 0.02), paint, s * 0.64, 0.98, cz + cl / 2 - 0.05));
    for (const z of [0.25, -0.45]) g.add(mesh(rbox(0.02, 0.025, 0.12, 0.008), chrome, s * 0.605, 0.68, z));
    g.add(mesh(box(0.012, 0.06, 2.0), mat(mix(o.color || '#888888', '#ffffff', 0.5)), s * 0.605, 0.52, 0));
    if (!o.open) put(g, mesh(box(0.02, 0.012, 0.36), black, s * 0.2, 0.79, cz + cl / 2 + 0.02)).rotation.set(0, Math.PI / 2, 0.5);
  }
  for (let i = 0; i < 3; i++) g.add(mesh(box(0.6, 0.025, 0.03), chrome, 0, 0.5 + i * 0.05, 1.31));
  for (const z of [1.34, -1.34]) g.add(mesh(rbox(0.32, 0.1, 0.02, 0.01), mat('#f4f1e1'), 0, 0.42, z));
  put(g, mesh(cyl(0.035, 0.035, 0.2, 8), chrome, 0.38, 0.38, -1.38)).rotation.x = Math.PI / 2;
  g.add(mesh(cyl(0.006, 0.006, 0.5, 4), black, -0.45, 0.95, -0.9));
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
  const chrome = mat('#c3c8cf', { metalness: 0.8, roughness: 0.25 }), black = mat('#1d1d22');
  for (const s of [-1, 1]) {
    g.add(mesh(rbox(0.08, 0.3, 0.06, 0.02), black, s * 0.82, 1.6, 2.05), mesh(cyl(0.008, 0.008, 0.2, 4), chrome, s * 0.77, 1.6, 2.05));
    g.add(mesh(cyl(0.05, 0.05, 1.1, 10), chrome, s * 0.62, 1.9, 1.2), mesh(cyl(0.18, 0.18, 0.6, 14), chrome, s * 0.62, 0.62, 0.7));
    g.add(mesh(box(0.3, 0.06, 0.25), black, s * 0.6, 0.38, 1.75), mesh(box(0.02, 0.35, 0.3), black, s * 0.7, 0.42, -2.3));
  }
  for (let i = 0; i < 3; i++) g.add(mesh(box(0.9, 0.04, 0.03), chrome, 0, 0.85 + i * 0.1, 2.37), mesh(ball(0.05), glow('#ffb347', 1.2), (i - 1) * 0.25, 1.86, 2.3));
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
  const chrome = mat('#c3c8cf', { metalness: 0.8, roughness: 0.25 }), black = mat('#1d1d22');
  if (!o.open) for (const s of [-1, 1]) for (let i = 0; i < 4; i++) g.add(mesh(box(0.03, 0.55, 0.08), paint, s * 0.79, 1.52, -2.0 + i * 1.25));
  for (const s of [-1, 1]) g.add(mesh(rbox(0.08, 0.32, 0.06, 0.02), black, s * 0.86, 1.6, 2.7), put(new THREE.Group(), mesh(box(0.4, 0.02, 0.02), black, s * 0.3, 1.18, 2.82)));
  g.add(mesh(rbox(1.0, 0.22, 0.05, 0.02), mat('#1d1d22'), 0, 1.86, 2.81), mesh(box(0.8, 0.12, 0.04), glow('#ffb347', 1.2), 0, 1.86, 2.84));
  g.add(mesh(rbox(0.9, 0.2, 1.4, 0.05), mat('#d9dee6'), 0, 2.08, -0.5), mesh(box(1.6, 0.12, 0.1), chrome, 0, 0.42, 2.83), mesh(box(1.6, 0.12, 0.1), chrome, 0, 0.42, -2.83));
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
  // boiler bands, bell, whistle, lamp, rails, cow-catcher, rods; windows, doors and couplings on the carriages
  const brass = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 });
  for (let i = 0; i < 3; i++) put(g, mesh(new THREE.TorusGeometry(0.61, 0.025, 6, 20), brass, 0, 1.15, 0.4 + i * 0.6)).rotation.y = 0;
  g.add(mesh(lathe([[0.08, 0], [0.11, 0.1], [0.05, 0.16]], 12), brass, 0, 1.75, 0.4), mesh(cyl(0.03, 0.03, 0.2, 8), brass, 0.25, 1.8, 0.7));
  g.add(mesh(lathe([[0.14, 0], [0.16, 0.12], [0.1, 0.2]], 12), black, 0, 1.15, 2.35), mesh(ball(0.1), glow('#fff3b0', 1.4), 0, 1.25, 2.42));
  for (const s of [-1, 1]) g.add(mesh(cyl(0.015, 0.015, 2.0, 6), brass, s * 0.64, 1.3, 1.2), mesh(box(0.04, 0.04, 1.2), mat('#8a9099', { metalness: 0.8, roughness: 0.3 }), s * 0.72, 0.38, 1.0));
  for (let i = 0; i < 5; i++) put(g, mesh(box(0.05, 0.05, 0.6), mat('#b3262b'), (i - 2) * 0.22, 0.35, 2.45)).rotation.x = -0.5;
  ['#2e6f8e', '#3b8b6f', '#b9772e'].forEach((c, i) => {
    const z = -2.9 - i * 2.75;
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) g.add(mesh(box(0.05, 0.38, 0.36), mat('#bfe0f2', { roughness: 0.1 }), s * 0.69, 1.45, z - 0.75 + k * 0.75));
    g.add(mesh(box(1.37, 0.9, 0.06), mat(mix(c, '#000000', 0.25)), 0, 1.15, z - 1.26), mesh(box(0.12, 0.12, 0.5), black, 0, 0.6, z + 1.55));
    g.add(mesh(rbox(0.5, 0.12, 0.6, 0.04), mat(mix(c, '#ffffff', 0.3)), 0, 1.95, z));
  });
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
  const black = mat('#2b2e35'), chrome = mat('#c3c8cf', { metalness: 0.8, roughness: 0.25 });
  put(g, mesh(cyl(0.09, 0.09, 0.02, 16), chrome, 0.04, 0.38, 0)).rotation.z = Math.PI / 2;         // chain ring
  g.add(mesh(box(0.012, 0.012, 0.62), black, 0.05, 0.38, -0.31));                                  // chain
  for (const k of [-1, 1]) {
    g.add(mesh(box(0.02, 0.16, 0.025), chrome, k * 0.07, 0.38 - k * 0.06, k * 0.03), mesh(rbox(0.09, 0.02, 0.05, 0.008), black, k * 0.11, 0.38 - k * 0.14, k * 0.06));
    const fender = mesh(new THREE.TorusGeometry(r * 1.08, 0.015, 4, 12, Math.PI * 0.7), mat(o.color || '#d1495b'), 0, r, k * 0.62);
    fender.rotation.set(0, Math.PI / 2, Math.PI * 0.15);
    g.add(fender);
  }
  g.add(mesh(cyl(0.02, 0.02, 0.02, 8), chrome, 0.2, 1.04, 0.48));
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
  const black = mat('#1d1d22');
  for (const s of [-1, 1]) {
    for (let i = 0; i < 8; i++) {                   // chunky tread on the big wheels
      const a = (i / 8) * Math.PI * 2, lug = mesh(box(0.36, 0.12, 0.16), black, s * 0.72, 0.62 + Math.sin(a) * 0.6, -0.5 + Math.cos(a) * 0.6);
      lug.rotation.x = -a;
      g.add(lug);
    }
    const guard = mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.4, 18, 1, true, 0, Math.PI), paint, s * 0.72, 0.62, -0.5);
    guard.material = paint.clone();
    guard.material.side = THREE.DoubleSide;
    guard.rotation.set(0, 0, Math.PI / 2);                 // an arch over the top of the big wheel
    g.add(guard, mesh(ball(0.07), glow('#fff3b0', 1.2), s * 0.3, 1.2, 1.31));
  }
  put(g, mesh(new THREE.TorusGeometry(0.14, 0.02, 6, 16), black, 0, 1.55, -0.15)).rotation.x = -1.0;   // steering wheel
  g.add(mesh(rbox(0.4, 0.1, 0.35, 0.04), black, 0, 1.35, -0.75), mesh(cyl(0.08, 0.06, 0.08, 8), black, 0.3, 2.14, 0.9));
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
  const black = mat('#2b2e35');
  g.add(mesh(cyl(0.12, 0.12, 0.12, 10), black, 0, 2.25, 0), mesh(rbox(0.7, 0.4, 0.9, 0.12), paint, 0, 1.75, -0.35));   // rotor hub, engine
  for (const s of [-1, 1]) {
    g.add(mesh(rbox(0.04, 0.5, 0.45, 0.04), mat('#9fc4dc', { roughness: 0.1 }), s * 0.66, 1.25, 0.1), mesh(ball(0.05), glow(s > 0 ? '#34c759' : '#ff3b30', 2), s * 0.7, 1.1, -0.2));
    put(g, mesh(cyl(0.05, 0.05, 0.3, 8), black, s * 0.25, 1.6, -0.95)).rotation.x = Math.PI / 2;
    g.add(mesh(box(0.02, 0.06, 1.2), mat('#ffffff'), s * 0.69, 0.95, -0.2), mesh(box(0.25, 0.04, 0.12), black, s * 0.45, 0.6, 0.3));
  }
  put(g, mesh(slab([[0, 0], [0.5, 0.1], [0.4, 0.3], [0, 0.25]], 0.04), paint, 0, 1.35, -3.15)).rotation.y = Math.PI / 2;
  put(g, mesh(new THREE.TorusGeometry(0.45, 0.025, 4, 16), mat('#2b2e35'), 0.12, 1.7, -3.2)).rotation.y = Math.PI / 2;   // tail-rotor guard
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
  const black = mat('#24272d');
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) put(g, mesh(cyl(0.08, 0.08, 0.04, 12), mat('#bfe0f2', { roughness: 0.1 }), s * 1.31, 0.45, 2.2 - i * 1.2)).rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) g.add(mesh(capsule(0.18, 0.9), mat('#f28c1a'), s * 1.2, 1.95, -1.2));
  g.children[g.children.length - 1].rotation.x = Math.PI / 2;
  g.children[g.children.length - 2].rotation.x = Math.PI / 2;
  g.add(mesh(tube([[0.9, 0.9, 4.0], [1.0, 0.4, 4.1], [0.9, 0.1, 4.0]], 0.04, 8, 5), black), mesh(ball(0.06), glow('#fff3b0', 2), 0, 4.0, 1.3));
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
  const tread = mat('#24262a');
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) g.add(mesh(box(0.52, 0.06, 0.18), tread, s * 0.8, 0.64, -1.4 + i * 0.56));
  g.add(mesh(cyl(0.25, 0.25, 0.08, 14), olive, -0.25, 1.6, -0.25), mesh(cyl(0.03, 0.03, 0.5, 6), dark, 0.25, 1.85, -0.3));
  put(g, mesh(cyl(0.03, 0.03, 0.4, 6), dark, -0.25, 1.75, 0.0)).rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) put(g, mesh(cyl(0.06, 0.06, 0.2, 8), dark, s * 0.4, 0.95, -1.62)).rotation.x = Math.PI / 2;
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
  ['#e63946', '#2a9d8f', '#f2c230', '#8d5fd3'].forEach((c, i) => {
    g.add(mesh(rbox(0.22, 0.22, 0.22, 0.03), mat(c), (i - 1.5) * 0.24, 1.05 + (i % 2) * 0.12, 0.25));
  });
  for (const s of [-1, 1]) {
    g.add(mesh(ball(0.06), gold, s * 0.56, 0.75, 0.6), mesh(box(0.04, 0.3, 0.04), red, s * 0.56, 1.2, 0.9));
    put(g, mesh(new THREE.TorusGeometry(0.12, 0.02, 6, 12, Math.PI), gold, s * 0.5, 0.2, 1.3)).rotation.y = Math.PI / 2;
  }
  g.add(mesh(cyl(0.03, 0.03, 0.4, 6), gold, 0.6, 1.4, 0.95), mesh(ball(0.07), glow('#ffd98a', 1.6), 0.6, 1.62, 0.95));
  for (const s of [-1, 1]) g.add(mesh(ball(0.05), gold, s * 0.56, 1.32, 0.9));   // finials
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
  for (let i = 0; i < 4; i++) g.add(mesh(box(1.1, 0.02, 0.06), dark, 0, 0.78, -0.95 + i * 0.6));
  g.add(mesh(cyl(0.03, 0.03, 0.9, 6), dark, 0, 0.7, 2.3), mesh(box(1.0, 0.04, 0.04), dark, 0, 0.7, 2.3));
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
  for (const y of [0.6, 2.3]) put(g, mesh(new THREE.TorusGeometry(0.425, 0.03, 6, 24), red, 0, y, 0)).rotation.x = Math.PI / 2;
  g.add(mesh(ball(0.13), mat('#6ec5ff', { roughness: 0.15 }), 0, 1.4, 0.38), mesh(lathe([[0.2, 0], [0.32, 0.25], [0.36, 0.5]], 14), mat('#3a3d44', { metalness: 0.7, roughness: 0.3 }), 0, 0.0, 0));
  g.children[g.children.length - 1].rotation.x = Math.PI;
  g.children[g.children.length - 1].position.y = 0.5;
  for (let i = 0; i < 3; i++) { const a = (i * Math.PI * 2) / 3; g.add(mesh(ball(0.05), red, Math.sin(a) * 0.98, 0.3, Math.cos(a) * 0.98)); }
  g.add(mesh(cyl(0.012, 0.012, 0.35, 4), red, 0, 3.4, 0));
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
  const black = mat('#30343c');
  put(g, mesh(dome(0.22, 0.5), mat('#9fc4dc', { roughness: 0.1 }), 0, 0.62, 0.45)).scale.z = 1.6;
  for (const s of [-1, 1]) {
    put(g, mesh(cyl(0.11, 0.09, 0.5, 12), white, s * 1.0, 0.3, 0.35)).rotation.x = Math.PI / 2;
    g.add(mesh(cyl(0.02, 0.02, 0.3, 6), black, s * 0.4, 0.15, 0.3), mesh(cyl(0.08, 0.08, 0.06, 12), black, s * 0.4, 0.0, 0.3));
  }
  g.add(mesh(cyl(0.02, 0.02, 0.25, 6), black, 0, 0.18, -0.9), mesh(cyl(0.06, 0.06, 0.05, 10), black, 0, 0.05, -0.9));
  g.add(mesh(box(3.62, 0.072, 0.1), white, 0, 0.4, 0.05), mesh(cyl(0.07, 0.07, 0.1, 10), black, 0, 0.4, 1.33));
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
  const steel = mat('#8a94a0', { metalness: 0.8, roughness: 0.3 });
  put(g, mesh(new THREE.TorusGeometry(1.25, 0.06, 8, 32), steel, 0, 0.45, 0)).rotation.x = Math.PI / 2;
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3, leg = mesh(cyl(0.03, 0.04, 0.55, 6), steel, Math.cos(a) * 0.7, 0.18, Math.sin(a) * 0.7);
    leg.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
    g.add(leg, mesh(cyl(0.12, 0.12, 0.04, 10), steel, Math.cos(a) * 0.8, -0.08, Math.sin(a) * 0.8));
  }
  g.add(mesh(cyl(0.01, 0.01, 0.4, 4), steel, 0, 1.4, 0), mesh(ball(0.05), glow('#ff5d8f', 2), 0, 1.6, 0));
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
  for (let i = 0; i < 6; i++) {                     // painted gores down the envelope
    const band = mesh(new THREE.SphereGeometry(1.61, 16, 12, (i * Math.PI) / 3, 0.18), mat('#fbfbf7'), 0, 3.6, 0);
    band.scale.y = 1.2;
    g.add(band);
  }
  g.add(mesh(cyl(0.38, 0.38, 0.05, 16), mat('#5d3b22'), 0, 0.5, 0), mesh(cyl(0.08, 0.1, 0.25, 10), mat('#3a3d44', { metalness: 0.7, roughness: 0.3 }), 0, 1.3, 0));
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
  const keep = new Set([ud.head, ud.lips, ud.breath, ud.flame, ud.prop, ud.spin, ud.tailRotor, ...(ud.smoke || [])].filter(Boolean));
  bakeStatic(g, keep);
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
  // Measure the body before anything is put in its hands: how far it reaches forward and back.
  wrap.updateMatrixWorld(true);
  const flame = ud.breath, flameParent = flame && flame.parent;
  if (flameParent) flameParent.remove(flame);
  const bounds = new THREE.Box3().setFromObject(scaled);
  if (flameParent) flameParent.add(flame);
  const hands = ud.arms && ud.arms[0].userData.hand ? ud.arms.map((a) => a.userData.hand) : null;
  const item = spec.holding;
  let carried = null;
  if (item && item.kind !== 'sword' && stage) {     // something carried in a hand or a mouth
    const make = item.food ? () => buildFood(item.kind) : PROP_BUILDERS[item.base];
    const thing = make && (item.food ? make() : make(stage.R, stage.night, item.base === 'beachball' ? [] : stage.anims, true));
    if (thing) {
      thing.scale.setScalar((item.food ? 1.3 : item.scale) / (ud.arms ? 1 : Math.max(0.6, s)));
      if (hands) { thing.position.set(0, -0.04, 0.05); hands[1].add(thing); carried = thing; }
      else if (ud.head && ud.mouth) { thing.position.set(...ud.mouth); ud.head.add(thing); }
      else { thing.position.set(0, ud.height, 0); g.add(thing); }
    }
  }
  // Fighters on two legs fight with whatever suits them; anyone told to hold a sword carries one.
  const weaponKind = hands && (FIGHTING.has(spec.action) ? (o.weapon || 'fist') : item && item.kind === 'sword' ? 'sword' : null);
  const weapon = weaponKind && weaponKind !== 'fist' ? buildWeapon(weaponKind) : null;
  if (weapon) hands[1].add(weapon);
  // Food for eating: in the hand (or a bowl and spoon), or on the ground for animals.
  const meal = spec.food;
  let food = null, spoon = null;
  const crumbs = [];
  if (meal) {
    food = buildFood(meal.kind);
    if (hands) {
      food.scale.setScalar(1.45);
      g.add(food);
      if (food.userData.bowl) { spoon = buildSpoon(); g.add(spoon); }
    } else {
      const at = ud.grazeAt || [0, 0, (ud.height || 0.6) * 0.75];
      const k = clamp(s, 0.6, 1.8) / s * (ud.quad ? 1.6 : 1.2);
      food.scale.setScalar(k);
      food.position.set(at[0], at[1] > 0.3 ? at[1] : 0, at[2]);
      if (at[1] > 0.3) {                           // a trough for animals whose heads stay high
        const trough = mesh(box(0.55 * k, at[1], 0.45 * k), mat('#8b5a36'), at[0], at[1] / 2, at[2]);
        g.add(trough);
      }
      g.add(food);
    }
    const crumbColor = meal.drink ? '#bfe6fb' : '#d9a35a';
    for (let i = 0; i < 6; i++) {
      const c = mesh(box(0.018, 0.018, 0.018), mat(crumbColor), 0, -9, 0);
      c.castShadow = false;
      crumbs.push(c);
      g.add(c);
    }
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
    side: spec.side || 0, passive: !!spec.passive, fs: null, flash: 0, food: meal, n,
    front: Math.max(0.15, bounds.max.z), back: Math.max(0.15, -bounds.min.z),
    tall: Math.max(0.3, bounds.max.y), ud, weapon, weaponKind,
  };
  actor.fight = fighterStats(actor, o, s);

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
        setArm(arm, pose === 'stand' ? 0 : -0.75, pose === 'stand' ? -0.12 : -0.6, 0, arm.userData.side * 0.12);
        if (act === 'wave' && i) setArm(arm, 0, -0.5, 0, arm.userData.side * (2.4 + Math.sin(t * 9) * 0.35));
      });
      const f = m.fs;
      if (f && f.mode === 'attack' && weapon) {     // swing from the saddle when the mount attacks
        setArm(ud.arms[1], lerp(lerp(-0.8, -2.9, f.wind), -1.0, f.strike), lerp(lerp(-0.8, -0.4, f.wind), -0.1, f.strike));
      } else if (weapon) setArm(ud.arms[1], -0.8, -0.8);
    }
    if (ud.tail) ud.tail.rotation.y = Math.sin(t * 6 + ph) * 0.4;
    if (ud.head) ud.head.rotation.set(0, Math.sin(t * 0.8 + ph) * 0.3, 0);
    if (ud.wings) ud.wings.forEach((w) => { w.rotation.z = -w.userData.side * 0.5; });
    actor.focus.copy(m.focus);
  }

  const tmp = new THREE.Vector3(), mouth = new THREE.Vector3(...(ud.mouthAt || [0, 1.5, 0.25]));
  function crumbsAt(t, start, from, spread, dir = 0) {   // little bits that fall from a bite or a toss
    crumbs.forEach((c, i) => {
      const age = t - start;
      if (age < 0 || age > 0.75) { c.position.y = -9; return; }
      const a = i * 2.39 + start;
      c.position.set(from.x + Math.cos(a) * spread * age, from.y + (0.6 + (i % 3) * 0.3) * age - 4.5 * age * age,
        from.z + (Math.sin(a) * 0.5 + dir) * spread * age);
      c.rotation.set(age * 9, age * 7, 0);
    });
  }
  function eat(t) {
    const drink = actor.food.drink, C = drink ? 3.2 : 2.6, tt = t + n * 0.83, q = (tt % C) / C;
    const done = Math.max(0, Math.floor(tt / C - (drink ? 0.6 : 0.3)) + 1);     // bites (or sips) taken
    if (act === 'feed') {
      // Holding food out to the animals and tossing a bit every couple of seconds.
      const toss = q < 0.25 ? Math.sin(Math.PI * q / 0.25) : 0;
      armTo(ud.arms[0], ud.arms[0].userData.side * 0.06, 0.95 + 0.12 * toss, 0.5 + 0.12 * toss);
      handAt(ud.arms[0], tmp);
      food.position.copy(tmp);
      food.rotation.set(0, 0, 0);
      crumbsAt(t, tt - (tt % C) - n * 0.83 + 0.2 * C, tmp, 1.6, 1.4);
      return;
    }
    if (!hands) {
      // Head down to the food, a few chomps, head up, chew.
      const down = q < 0.22 ? ease(q / 0.22) : q < 0.62 ? 1 : q < 0.8 ? 1 - 0.6 * ease((q - 0.62) / 0.18) : 0.4 - 0.4 * ease((q - 0.8) / 0.2);
      const chomp = q > 0.22 && q < 0.62 ? Math.sin(tt * 18) : 0;
      if (ud.neck) {
        ud.neck.rotation.x = ud.grazeAngle * down + 0.05 * chomp;
        if (ud.head) ud.head.rotation.x = q > 0.62 ? Math.sin(tt * 12) * 0.06 : 0.08 * chomp;
      } else if (base === 'bird') {
        g.rotation.x = 0.85 * Math.max(0, Math.sin(tt * 7)) ** 2;     // peck, peck
      }
      if (food.userData.part) food.userData.part.scale.setScalar(Math.max(0.35, 1 - 0.12 * done));
      return;
    }
    // Hands: lift to the mouth, bite (or sip), lower, chew.
    let lift, open = 0, chew = 0;
    if (drink) {
      lift = q < 0.25 ? ease(q / 0.25) : q < 0.6 ? 1 : q < 0.8 ? 1 - ease((q - 0.6) / 0.2) : 0;
    } else {
      lift = q < 0.22 ? ease(q / 0.22) : q < 0.34 ? 1 : q < 0.55 ? 1 - ease((q - 0.34) / 0.21) : 0;
      open = q > 0.2 && q < 0.31 ? Math.sin(Math.PI * (q - 0.2) / 0.11) : 0;
      chew = q > 0.34 ? Math.abs(Math.sin((q - 0.34) * C * 7)) : 0;
    }
    const arm = ud.arms[0], sx = arm.userData.side, bowl = food.userData.bowl;
    const rest = actor.plate ? actor.plate.slice() : [sx * 0.15, 1.02, 0.32];   // a copy: never move the plate itself
    if (bowl && actor.plate) {        // at the table the bowl stays on the plate
      food.position.set(0, actor.plate[1] - 0.04, actor.plate[2]);
      food.rotation.set(0, 0, 0);
      rest[0] = 0; rest[1] = actor.plate[1] + 0.1; rest[2] = actor.plate[2];
    } else if (bowl) {                // bowl in one hand, spoon in the other
      armTo(ud.arms[1], 0.08, 1.06, 0.3);
      handAt(ud.arms[1], tmp);
      food.position.set(tmp.x - 0.06, tmp.y - 0.05, tmp.z);
      food.rotation.set(0, 0, 0);
      rest[0] = food.position.x; rest[1] = food.position.y + 0.1; rest[2] = food.position.z;
    }
    if (actor.plate && !bowl) armTo(ud.arms[1], -sx * 0.22, actor.plate[1] + 0.02, actor.plate[2] - 0.05);
    const mx = lerp(rest[0], mouth.x + sx * 0.03, lift), my = lerp(rest[1], mouth.y - (bowl ? 0.02 : 0.03), lift);
    const mz = lerp(rest[2], mouth.z + (drink ? 0.06 : 0.03), lift);
    armTo(arm, mx, my, mz);
    handAt(arm, tmp);
    const item = bowl ? spoon : food;
    item.position.copy(tmp);
    if (drink) {
      const sip = q > 0.25 && q < 0.6 ? 1 : lift * 0.4;
      item.rotation.set(-1.15 * sip, 0, 0);                    // tip the cup toward the mouth
      if (food.userData.liquid) food.userData.liquid.scale.y = Math.max(0.15, 1 - 0.18 * done);
    } else {
      item.rotation.set(bowl ? 0.2 : -0.35 * lift, 0, bowl ? 0 : sx * 0.3);
      if (food.userData.part) food.userData.part.scale.setScalar(Math.max(0.3, 1 - 0.17 * done));
      const lastBite = tt - (tt % C) + 0.3 * C - n * 0.83 - (q < 0.3 ? C : 0);
      crumbsAt(t, lastBite, mouth, 0.5);
    }
    if (ud.head) ud.head.rotation.x = 0.1 * open + (chew ? Math.sin(tt * 14) * 0.03 : 0) + (drink ? -0.25 * (q > 0.25 && q < 0.6 ? 1 : 0) : 0);
    if (ud.lips) ud.lips.scale.y *= 1 + 3.2 * open + 1.6 * chew;
  }
  let tint = null, tinted = false;
  const FLASH = new THREE.Color('#ff2a2a');
  function flashBody(k) {                // a red flash when struck
    if (!tint) {
      tint = [];
      const seen = new Set();
      g.traverse((m) => {
        if (!m.isMesh || seen.has(m.material)) return;
        seen.add(m.material);
        tint.push({ m: m.material, c: m.material.color.clone(), e: m.material.emissive ? m.material.emissive.clone() : null });
      });
    }
    tint.forEach(({ m, c, e }) => {
      if (e) m.emissive.copy(e).lerp(FLASH, k * 0.85);
      else m.color.copy(c).lerp(FLASH, k * 0.75);
    });
    tinted = k > 0;
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
    if (ud.neck) ud.neck.rotation.set(0, 0, 0);
    if (ud.lips) ud.lips.scale.y = ud.lips.geometry.type === 'BoxGeometry' ? 1 : 0.25;
    if (ud.arms) ud.arms.forEach((arm) => { arm.rotation.y = 0; if (arm.userData.elbow) arm.userData.elbow.rotation.set(-0.12, 0, 0); });
    let legsHeld = false;
    actor.flash = 0;
    if (ud.flame) ud.flame.visible = false;

    if (act === 'walk' || act === 'run') {
      const fast = act === 'run';
      const v0 = (fast ? 4.2 : 1.5) * (o.speed || 1);
      const v = actor.maxTravel ? Math.min(v0, actor.maxTravel / Math.max(dur, 1)) : v0;
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
      if (ud.lips && mine) ud.lips.scale.y *= 1 + Math.abs(Math.sin(t * 11)) * 2.6;
      if (ud.arms && mine) ud.arms[0].rotation.x = -0.6 - Math.sin(t * 6) * 0.35;
      y += mine ? Math.abs(Math.sin(t * 9)) * 0.02 : 0;
    } else if ((act === 'fight' || act === 'slay' || act === 'die') && actor.fs) {
      // Choreographed by the shot's fight director: where to stand, who is striking whom.
      const f = actor.fs, fm = actor.fight;
      x = f.x + Math.sin(f.heading) * f.adv;
      z = f.z + Math.cos(f.heading) * f.adv;
      heading = f.heading;
      y += f.hop * s;
      actor.flash = f.flash;
      legsHeld = !!ud.legs;
      held[0] = held[1] = !!ud.arms;
      const arms = ud.arms, legs = ud.legs, humanoid = !!hands;
      const stance = (k) => { if (legs && legs.length === 2) { legs[0].rotation.x = -0.3 - k; legs[1].rotation.x = 0.3 + k * 0.4; } };
      if (f.mode === 'down') {
        g.rotation.z = f.down * Math.PI / 2 * f.fallDir;
        g.position.y = f.down * 0.25;
        flap = lerp(0.3, -1.35, f.down);
        if (arms) arms.forEach((arm) => setArm(arm, -0.3 * f.down, -0.3, 0, arm.userData.side * 0.8 * f.down));
        if (legs) legs.forEach((leg) => { leg.rotation.x = 0; });
      } else if (f.mode === 'cheer') {
        const b = Math.abs(Math.sin(t * 4.5 + ph));
        y += b * 0.35 * s;
        if (humanoid) {
          setArm(arms[0], -0.2, -0.3, 0, arms[0].userData.side * 2.6 * (0.8 + 0.2 * b));
          setArm(arms[1], weapon ? -3.0 : -0.2, -0.15, 0, weapon ? 0 : arms[1].userData.side * 2.6);
        } else if (ud.quad) {
          g.rotation.x = -0.25 * b;                       // rears up and roars
          if (ud.neck) ud.neck.rotation.x = -0.6;
          if (legs) { legs[0].rotation.x = legs[1].rotation.x = -0.8 * b; }
        }
        flap = Math.sin(t * 12) * 0.7;
        stance(0);
      } else if (f.mode === 'approach') {
        swing = Math.sin(t * 11 + ph) * 0.9;
        if (legs) legs.forEach((leg, i) => { leg.rotation.x = swing * (ud.quad ? [1, -1, -1, 1][i] : i ? -1 : 1); });
        if (humanoid) { setArm(arms[1], weapon ? -0.8 : -0.5, weapon ? -0.8 : -2.0); setArm(arms[0], -0.5 + swing * 0.4, -1.6); }
        y += Math.abs(Math.sin(t * 11 + ph)) * 0.08 * s;
        flap = Math.sin(t * 10) * 0.6;
      } else if (humanoid) {
        const bob = Math.sin(t * 6 + ph) * 0.03;
        y += bob * s;
        const guardW = () => setArm(arms[1], -0.8 + bob, -0.8);
        const guardFist = (arm) => setArm(arm, -0.45 + bob, -2.2, arm.userData.side * -0.3);
        if (weapon) guardW(); else guardFist(arms[1]);
        guardFist(arms[0]);
        stance(0);
        if (f.mode === 'attack') {
          const { wind, strike, rec } = f;
          const lean = -0.15 * wind * (1 - strike) + 0.28 * strike * (1 - rec);
          g.rotation.x = lean;
          if (f.move === 'slash') {
            setArm(arms[1], lerp(lerp(lerp(-0.8, -2.9, wind), -1.1, strike), -0.8, rec),
              lerp(lerp(lerp(-0.8, -0.45, wind), -0.1, strike), -0.8, rec));
            stance(0.45 * strike * (1 - rec));
          } else if (f.move === 'zap') {
            setArm(arms[1], lerp(lerp(-0.8, -1.55, wind), -1.8, strike * (1 - rec)), lerp(-0.8, -0.05, wind * (1 - rec)));
            g.rotation.x = -0.1 * strike * (1 - rec);
          } else if (f.move === 'kick') {
            if (legs && legs.length === 2) { legs[0].rotation.x = -1.4 * strike * (1 - rec) - 0.3 * (1 - strike); legs[1].rotation.x = 0.25; }
            g.rotation.x = -0.25 * strike * (1 - rec);
            arms.forEach((arm) => setArm(arm, -0.6, -1.2, 0, arm.userData.side * 0.7 * strike * (1 - rec)));
          } else {                                         // punch with the lead hand
            const lead = arms[0];
            setArm(lead, lerp(lerp(-0.45, -0.3, wind), -1.55, strike * (1 - rec)) + 0.0,
              lerp(lerp(-2.2, -2.4, wind), -0.05, strike * (1 - rec)), lead.userData.side * -0.18 * strike);
            stance(0.35 * strike * (1 - rec));
          }
        } else if (f.mode === 'block') {
          const k = f.guard;
          if (weapon) { setArm(arms[1], lerp(-0.8, -1.95, k), lerp(-0.8, -1.25, k)); setArm(arms[0], lerp(-0.45, -1.2, k), lerp(-2.2, -1.7, k)); }
          else arms.forEach((arm) => setArm(arm, lerp(-0.45, -0.95, k), lerp(-2.2, -2.45, k), arm.userData.side * -0.35 * k));
          g.rotation.x = -0.12 * f.flinch;
        } else if (f.mode === 'hit') {
          g.rotation.x = -0.38 * f.flinch;
          if (ud.head) ud.head.rotation.x = -0.45 * f.flinch;
          arms.forEach((arm) => setArm(arm, lerp(-0.6, -0.3, f.flinch), lerp(-1.4, -0.4, f.flinch), 0, arm.userData.side * 0.9 * f.flinch));
          stance(-0.2 * f.flinch);
        } else if (f.mode === 'dodge') {
          g.rotation.x = -0.2 * f.flinch;
          arms.forEach((arm) => setArm(arm, -0.5, -1.0, 0, arm.userData.side * 0.6 * f.flinch));
        }
      } else {
        // four legs, wings, fins, wheels: they bite, peck, ram or breathe fire
        const { wind, strike, rec } = f;
        if (ud.quad) {
          if (ud.neck) ud.neck.rotation.x = 0.12;
          g.position.y = -0.03 * s;
        }
        if (ud.tail) ud.tail.rotation.x = 0.2;
        if (f.mode === 'attack') {
          if (ud.quad) {
            if (ud.neck) ud.neck.rotation.x = -0.5 * wind * (1 - strike) + 0.45 * strike * (1 - rec);
            g.rotation.x = -0.2 * wind * (1 - strike) + 0.08 * strike * (1 - rec);
            if (legs) { legs[0].rotation.x = legs[1].rotation.x = -0.7 * wind * (1 - strike); }
            if (ud.breath && f.move === 'breath') {
              ud.breath.visible = f.fire > 0;
              const len0 = ud.breath.userData.len, k = Math.max(0.2, f.fireLen / (len0 * s)) * (1 + Math.sin(t * 40) * 0.04);
              const w = 0.6 + 0.4 * f.fire;
              ud.breath.scale.set(w, k, w);                       // the cone's length runs along its own y
              ud.breath.position.set(0, 0, len0 * k / 2);
              ud.breath.parent.rotation.x = -(ud.neck.rotation.x + g.rotation.x);   // aim level at the foe, however it rears
            }
          } else if (base === 'bird') {
            g.rotation.x = 0.7 * strike * (1 - rec) - 0.2 * wind;
          } else {
            g.rotation.x = 0.06 * strike * (1 - rec);
            g.rotation.z = Math.sin(t * 50) * 0.02 * strike * (1 - rec);
          }
          flap = Math.sin(t * 16) * 0.8;
        } else if (f.mode === 'hit' || f.mode === 'block' || f.mode === 'dodge') {
          if (ud.neck) ud.neck.rotation.x = -0.4 * f.flinch;
          g.rotation.x = -0.14 * f.flinch;
          g.rotation.z = Math.sin(t * 38) * 0.06 * f.flinch;
          flap = 0.3 + f.flinch * 0.6;
        } else {
          flap = 0.45 + Math.sin(t * 3) * 0.15;
          if (ud.neck) ud.neck.rotation.x = 0.12 + Math.sin(t * 5 + ph) * 0.05;
        }
        if (legs && f.mode !== 'attack') legs.forEach((leg, i) => { leg.rotation.x = Math.sin(t * 6 + i) * 0.08; });
      }
    } else if (act === 'fight' || act === 'slay' || act === 'die') {
      // On their own: shadow-boxing, or a death with nobody to blame.
      const over = act !== 'fight';
      if (!over) {
        const k = Math.floor(t / BEAT), p = t / BEAT - k;
        const wind = clamp(p / 0.3, 0, 1), hit = ease(clamp((p - 0.3) / 0.14, 0, 1));
        const back = ease(clamp((p - 0.55) / 0.45, 0, 1));
        const reach = 0.7 + 0.25 * s;
        x += Math.sin(heading) * (-0.25 * wind + (0.25 + reach) * hit - reach * back);
        z += Math.cos(heading) * (-0.25 * wind + (0.25 + reach) * hit - reach * back);
        g.rotation.x = (-0.3 * wind + 0.75 * hit - 0.45 * back) * (ud.quad ? 0.45 : 1);
        if (ud.arms) { setArm(ud.arms[1], -2.7 * wind + 2.3 * hit - 0.6 * back - 0.4, -0.3); held[1] = true; }
        if (ud.breath) { ud.breath.visible = p > 0.3 && p < 0.72; ud.breath.scale.z = 0.7 + Math.sin(t * 40) * 0.3; }
        flap = Math.sin(t * 14) * 0.6;
      } else if (act === 'slay') {
        armsUp = 1;
        y += Math.abs(Math.sin(t * 4.5 + ph)) * 0.45;
      } else {
        const u = ease(clamp((t - dur * 0.4) / 0.55, 0, 1));
        g.rotation.z = u * Math.PI / 2;
        g.position.y = u * 0.25;
        flap = lerp(flap, -1.35, u);
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
    const folded = base === 'bird' && act !== 'fly' && !FIGHTING.has(act);
    if (folded) flap = Math.sin(t * 2 + ph) * 0.05 - 0.12;
    const pair = [1, -1, -1, 1];
    if (ud.legs && act !== 'fly' && !legsHeld) {
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
        const elbow = arm.userData.elbow;
        if (elbow) {
          elbow.rotation.x = act === 'run' ? -1.3 : act === 'walk' ? -0.35 : arm.userData.raise ? -0.6 + Math.sin(t * 9) * 0.3
            : act === 'talk' && i === 0 ? -0.9 : -0.12;
          if (i === 1 && weapon && !armsUp) setArm(arm, -1.2, -2.4);         // sword resting on the shoulder
          else if (i === 1 && carried && !armsUp && !arm.userData.raise) {   // carrying something in front
            setArm(arm, -0.25 + swing * 0.15, -1.1);
          }
        }
        arm.userData.raise = 0;
      });
    }
    if (carried && ud.arms) carried.rotation.x = -(ud.arms[1].rotation.x + ud.arms[1].userData.elbow.rotation.x);   // keep it upright
    if (sitting && ud.arms && !actor.food) ud.arms.forEach((arm) => { if (!held[ud.arms.indexOf(arm)]) setArm(arm, -0.55, -0.9, 0, arm.userData.side * 0.1); });
    if (actor.food) eat(t);
    if (ud.wings) ud.wings.forEach((w) => { w.rotation.z = w.userData.side * flap; if (base === 'bird') w.scale.x = folded ? 0.42 : 1; });
    if (ud.tail) ud.tail.rotation.y = Math.sin(t * 5 + ph) * 0.35;
    if (ud.fishTail) ud.fishTail.rotation.y = Math.sin(t * 9 + ph) * 0.5;

    if (actor.flash > 0 || tinted) flashBody(actor.flash);
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
  const h = 1.4 + R() * 1.4, bark = mat('#6b4a2b', { roughness: 1 });
  const green = snowy ? '#e9f1f5' : mix('#3e8b3a', '#7cb342', R());
  if (palm) {
    const lean = 0.25 + R() * 0.2;
    const trunk = mesh(tube([[0, 0, 0], [lean * 0.3, h * 0.4, 0], [lean, h, 0]], 0.13, 16, 8), bark);
    g.add(trunk);
    for (let i = 1; i < 7; i++) {                       // the ringed bark of a palm
      const u = i / 7, ring = mesh(new THREE.TorusGeometry(0.14, 0.035, 6, 12), mat('#7d5a3a'), lean * u * u, h * u, 0);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    }
    for (let i = 0; i < 3; i++) g.add(mesh(ball(0.11), mat('#5a3d22'), lean + Math.cos(i * 2.1) * 0.13, h - 0.12, Math.sin(i * 2.1) * 0.13));
    const frond = slab([[0, 0], [0.18, 0.5], [0.12, 1.1], [0, 1.8], [-0.12, 1.1], [-0.18, 0.5]], 0.03);
    for (let i = 0; i < 7; i++) {
      const leaf = mesh(frond, mat(i % 2 ? '#4c9a4a' : '#5fae4f', { side: THREE.DoubleSide }), lean, h, 0);
      leaf.rotation.set(0, (i * Math.PI * 2) / 7, 0, 'YXZ');
      leaf.rotateX(-Math.PI / 2 + 0.55);
      g.add(leaf);
    }
  } else {
    g.add(mesh(lathe([[0.32, 0], [0.22, 0.15], [0.17, h * 0.5], [0.13, h]], 10), bark));      // trunk with a flared foot
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + R(), root = mesh(cone(0.09, 0.45, 6), bark, Math.cos(a) * 0.2, 0.06, Math.sin(a) * 0.2);
      root.rotation.set(Math.sin(a) * 1.3, 0, -Math.cos(a) * 1.3);
      g.add(root);
    }
    const crown = 1.0 + R() * 0.4;
    for (let i = 0; i < 3; i++) {                       // boughs reaching into the canopy
      const a = i * 2.1 + R();
      g.add(mesh(tube([[0, h * 0.7, 0], [Math.cos(a) * 0.35, h * 0.9, Math.sin(a) * 0.35], [Math.cos(a) * crown * 0.6, h + crown * 0.4, Math.sin(a) * crown * 0.6]], 0.05, 8, 5), bark));
    }
    g.add(mesh(blob(crown), mat(green, { roughness: 1 }), 0, h + crown * 0.7, 0));
    for (let i = 0; i < 8; i++) {                       // a clumpy canopy rather than one ball
      const a = (i / 8) * 6.28 + R(), k = crown * (0.5 + R() * 0.25), up = i % 2 ? 0.95 : 0.45;
      const shade = snowy ? '#e9f1f5' : mix(green, i % 3 === 0 ? '#2f6b2c' : i % 3 === 1 ? '#9ccc65' : green, 0.3);
      g.add(mesh(blob(k), mat(shade, { roughness: 1 }), Math.cos(a) * crown * 0.72, h + crown * (up + R() * 0.3), Math.sin(a) * crown * 0.72));
    }
    if (!snowy && R() < 0.35) for (let i = 0; i < 4; i++) {   // some trees carry fruit
      const a = i * 1.7 + R();
      g.add(mesh(ball(0.08), mat(R() < 0.5 ? '#d62828' : '#f28c1a'), Math.cos(a) * crown * 0.95, h + crown * (0.4 + R() * 0.5), Math.sin(a) * crown * 0.95));
    }
  }
  g.scale.setScalar(1 + R() * 0.8);
  return g;
}
function pine(R, snowy) {
  const g = new THREE.Group();
  const green = snowy ? '#eaf2f6' : mix('#1f5c3a', '#2f7d4a', R()), dark = mix(green, '#0f3a22', 0.35);
  g.add(mesh(lathe([[0.26, 0], [0.18, 0.12], [0.13, 1.1], [0.09, 1.4]], 8), mat('#5b3d24', { roughness: 1 })));
  for (let i = 0; i < 2; i++) put(g, mesh(cone(0.07, 0.35, 5), mat('#5b3d24'), (i ? -1 : 1) * 0.2, 0.05, i ? 0.1 : -0.1)).rotation.z = (i ? 1 : -1) * 1.2;
  for (let i = 0; i < 5; i++) {
    const r = 1.3 - i * 0.22, y = 1.25 + i * 0.62;
    g.add(mesh(cone(r, 1.1, 9), mat(i % 2 ? green : dark), 0, y, 0));
    if (snowy || i % 2 === 0) g.add(mesh(cone(r * 0.72, 0.3, 9), mat(snowy ? '#ffffff' : mix(green, '#5fa35f', 0.4)), 0, y + 0.42, 0));
  }
  g.add(mesh(cone(0.18, 0.5, 6), mat(dark), 0, 4.45, 0));
  g.scale.setScalar(1 + R() * 0.9);
  return g;
}
function rock(R, color = '#8a8d93') {
  const g = new THREE.Group();
  const main = mesh(R() < 0.5 ? ico(0.5 + R() * 0.9, 1) : dodeca(0.5 + R() * 0.9), flat(color));
  main.scale.set(1 + R() * 0.6, 0.6 + R() * 0.4, 1 + R() * 0.6);
  main.rotation.y = R() * 6;
  g.add(main);
  for (let i = 0; i < 3; i++) {                        // loose stones round the foot
    const a = R() * 6.28, p = mesh(ico(0.12 + R() * 0.12, 0), flat(mix(color, '#5e6066', R() * 0.5)), Math.cos(a) * 1.1, -0.08, Math.sin(a) * 1.1);
    p.rotation.set(R() * 3, R() * 3, 0);
    g.add(p);
  }
  if (color === '#8a8d93') {                           // moss on the top
    const moss = mesh(dome(0.45 + R() * 0.3, 0.35), mat('#5f8a3a', { roughness: 1 }), 0, 0.25, 0);
    moss.scale.y = 0.4;
    g.add(moss);
  }
  g.position.y = 0.15;
  return g;
}
function flowers(R) {
  const g = new THREE.Group();
  const colors = ['#ff6b8b', '#ffd166', '#c084fc', '#ffffff', '#ff8c42'];
  const leaf = slab([[0, 0], [0.04, 0.05], [0, 0.12], [-0.04, 0.05]], 0.006);
  for (let i = 0; i < 6; i++) {
    const x = (R() - 0.5) * 1.6, z = (R() - 0.5) * 1.6, h = 0.25 + R() * 0.25;
    g.add(mesh(cyl(0.015, 0.015, h, 4), mat('#3f8f3f'), x, h / 2, z));
    const petals = mesh(ball(0.08, 0), mat(colors[Math.floor(R() * colors.length)]), x, h, z);
    petals.scale.y = 0.55;
    g.add(petals, mesh(ball(0.035, 0), mat('#f6c02e'), x, h + 0.035, z));
    put(g, mesh(leaf, mat('#4c9a4a', { side: THREE.DoubleSide }), x, h * 0.4, z)).rotation.set(0.5, R() * 6, 0.6);
  }
  return g;
}
function cactus(R) {
  const g = new THREE.Group(), m = mat('#4f9a5a'), spine = mat('#f4efe2');
  const h = 1.6 + R() * 1.4;
  g.add(mesh(capsule(0.26, h - 0.3), m, 0, h / 2, 0));
  for (const s of [-1, 1]) {
    const y = h * (0.45 + R() * 0.2);
    g.add(mesh(tube([[0, y, 0], [s * 0.45, y, 0], [s * 0.6, y + 0.15, 0], [s * 0.6, y + 0.6, 0]], 0.1, 12, 8), m));
    g.add(mesh(ball(0.1), m, s * 0.6, y + 0.6, 0));
  }
  for (let i = 0; i < 6; i++) {                        // ribs and spines
    const a = (i / 6) * 6.28;
    g.add(mesh(box(0.012, h * 0.75, 0.012), spine, Math.cos(a) * 0.265, h * 0.48, Math.sin(a) * 0.265));
  }
  if (R() < 0.6) g.add(mesh(ball(0.09, 0), mat('#ff5d8f'), 0, h + 0.02, 0));   // a flower on top
  return g;
}
function house(R, night) {
  const g = new THREE.Group();
  const wall = ['#f2e2c4', '#e8c9a0', '#d9d4c7', '#f0d9d0'][Math.floor(R() * 4)];
  const roofC = ['#a23e3e', '#7a4a2f', '#4f6a7d'][Math.floor(R() * 3)], trim = mat('#f7f3ea'), wood = mat('#6b4226');
  g.add(mesh(box(3.2, 2.2, 2.8), mat(wall), 0, 1.1, 0));
  g.add(mesh(box(3.3, 0.25, 2.9), mat(mix(wall, '#6d6a66', 0.35)), 0, 0.12, 0));                     // stone footing
  const roof = mesh(cone(2.7, 1.6, 4), mat(roofC), 0, 3.0, 0);
  roof.rotation.y = Math.PI / 4;
  g.add(roof, mesh(box(0.12, 0.12, 2.0), mat(mix(roofC, '#000000', 0.3)), 0, 3.75, 0));          // ridge
  g.add(mesh(box(0.66, 1.2, 0.08), trim, 0, 0.6, 1.42), mesh(box(0.56, 1.1, 0.1), wood, 0, 0.58, 1.43));
  g.add(mesh(ball(0.04), mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), 0.18, 0.6, 1.5), mesh(box(0.9, 0.12, 0.35), mat('#9a9da3'), 0, 0.06, 1.55));
  const win = night ? glow('#ffd98a', 1.6) : mat('#a8d4f0', { roughness: 0.2 });
  for (const s of [-1, 1]) {
    g.add(mesh(box(0.62, 0.62, 0.06), trim, s * 1.0, 1.35, 1.42), mesh(box(0.52, 0.52, 0.08), win, s * 1.0, 1.35, 1.43));
    g.add(mesh(box(0.04, 0.52, 0.1), trim, s * 1.0, 1.35, 1.44), mesh(box(0.52, 0.04, 0.1), trim, s * 1.0, 1.35, 1.44));
    for (const k of [-1, 1]) g.add(mesh(box(0.2, 0.6, 0.05), mat(roofC), s * 1.0 + k * 0.43, 1.35, 1.44));   // shutters
    g.add(mesh(box(0.6, 0.12, 0.18), wood, s * 1.0, 1.0, 1.5));                                                // flower box
    for (let i = 0; i < 3; i++) g.add(mesh(ball(0.06, 0), mat(['#ff6b8b', '#ffd166', '#c084fc'][i]), s * 1.0 + (i - 1) * 0.18, 1.1, 1.52));
  }
  g.add(mesh(box(0.4, 0.9, 0.4), mat('#8a6f5a'), 0.8, 3.2, -0.3), mesh(box(0.5, 0.08, 0.5), mat('#6d5a4a'), 0.8, 3.68, -0.3));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const stoneC = mat('#a5a8af');
  for (let k = 0; k < 4; k++) for (let i = 0; i < 5; i++) {                // battlements along the walls
    const t = (i - 2) * 1.5, merlon = mesh(box(0.7, 0.7, 0.7), stoneC, 0, 4.35, 0);
    if (k === 0) merlon.position.set(t, 4.35, 4.5); else if (k === 1) merlon.position.set(t, 4.35, -4.5);
    else if (k === 2) merlon.position.set(4.5, 4.35, t); else merlon.position.set(-4.5, 4.35, t);
    g.add(merlon);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(mesh(cyl(0.04, 0.04, 1.2, 4), mat('#5d3b22'), sx * 4.5, 10.0, sz * 4.5));
    put(g, mesh(slab([[0, 0], [0.7, 0.2], [0, 0.45]], 0.02), mat('#e63946', { side: THREE.DoubleSide }), sx * 4.5, 10.1, sz * 4.5)).rotation.y = Math.PI / 2;
  }
  put(g, mesh(box(1.8, 0.1, 2.6), mat('#6b4a2b'), 0, 0.05, 5.8)).rotation.x = 0.0;
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (let i = 0; i < 3; i++) g.add(mesh(rbox(0.3, 0.45, 0.06, 0.03), mat('#2a2f3a'), 0, 2.2 + i * 1.8, 1.0 - i * 0.12));
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.add(mesh(cyl(0.03, 0.03, 0.4, 6), mat('#30343c'), Math.cos(a) * 0.9, 8.3, Math.sin(a) * 0.9)); }
  g.add(mesh(rbox(0.5, 0.9, 0.08, 0.04), mat('#5d3b22'), 0, 0.45, 1.08));
  return g;
}
function tent() {
  const g = new THREE.Group();
  const t = mesh(cone(2, 2.4, 4), mat('#d98032'), 0, 1.2, 0);
  t.rotation.y = Math.PI / 4;
  g.add(t);
  g.add(mesh(box(0.7, 1.2, 0.05), mat('#3a2a1c'), 0, 0.6, 1.0));
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  g.add(mesh(cyl(0.04, 0.04, 2.6, 6), _w, 0, 1.3, 0), mesh(cyl(0.02, 0.02, 0.3, 4), _w, 0, 2.55, 0));
  for (const s of [-1, 1]) {
    put(g, mesh(cyl(0.008, 0.008, 2.2, 4), mat('#e9e4d8'), s * 1.9, 1.0, 0)).rotation.z = s * 0.9;
    g.add(mesh(cone(0.04, 0.2, 4), _w, s * 2.7, 0.05, 0));
  }
  put(g, mesh(slab([[0, 0], [0.35, 0], [0, 1.2]], 0.03), mat('#e0904a', { side: THREE.DoubleSide }), 0.35, 0, 1.0)).rotation.y = -0.6;
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.add(mesh(ico(0.1, 0), flat('#6d7078'), Math.cos(a) * 0.55, 0.05, Math.sin(a) * 0.55)); }
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const goldB = mat('#f5c542', { metalness: 0.8, roughness: 0.3 });
  for (const x of [-0.3, 0.3]) g.add(mesh(box(0.06, 0.52, 0.62), goldB, x, 0.25, 0));
  g.add(mesh(rbox(0.12, 0.14, 0.04, 0.02), goldB, 0, 0.38, 0.31));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(box(0.08, 0.08, 0.08), goldB, sx * 0.43, 0.04, sz * 0.28));
  g.add(mesh(gem(0.06), mat('#e0242c', { roughness: 0.1 }), -0.1, 0.66, 0.05), mesh(gem(0.05), mat('#2e86ab', { roughness: 0.1 }), 0.15, 0.66, -0.05));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (let i = 0; i < 4; i++) {
    const a = i * 1.6, c = mesh(gem(0.15 + (i % 2) * 0.08), mat('#7ae7ff', { emissive: '#7ae7ff', emissiveIntensity: 1.2, flatShading: true }), Math.cos(a) * 0.45, 0.2, Math.sin(a) * 0.45);
    c.scale.y = 1.8;
    c.rotation.z = Math.cos(a) * 0.4;
    g.add(c);
  }
  return g;
}
function lamp(R, night) {
  const g = new THREE.Group();
  g.add(mesh(cyl(0.05, 0.07, 2.4, 6), mat('#2d3038'), 0, 1.2, 0));
  g.add(mesh(ball(0.2, 1), glow('#ffe7a3', night ? 3 : 0.8), 0, 2.5, 0));
  const light = new THREE.PointLight('#ffe7a3', night ? 25 : 3, 20);
  light.position.y = 2.5;
  g.add(light);
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  g.add(mesh(cyl(0.16, 0.2, 0.15, 10), _d, 0, 0.08, 0), mesh(cone(0.26, 0.2, 8), _d, 0, 2.78, 0));
  for (const y of [0.6, 2.25]) g.add(mesh(cyl(0.08, 0.08, 0.06, 8), _d, 0, y, 0));
  put(g, mesh(cyl(0.02, 0.02, 0.4, 4), _d, 0.15, 2.2, 0)).rotation.z = 0.7;
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const woodB = mat('#8b5a36');
  g.children.slice().forEach((c) => {
    if (c.geometry && c.geometry.type === 'BoxGeometry' && Math.abs(c.geometry.parameters.height - 0.7) < 0.01) g.add(mesh(cone(0.07, 0.12, 4), woodB, c.position.x, c.position.y + 0.41, c.position.z));
  });
  for (const s of [-1, 1]) g.add(mesh(cyl(0.02, 0.02, 0.3, 4), _d, s * 2.8, 1.75, 0.95), mesh(ball(0.08), glow('#ffd98a', 1.4), s * 2.8, 1.55, 0.95));
  put(g, mesh(box(7, 0.04, 2.4), mat('#4aa3d8', { transparent: true, opacity: 0.75, roughness: 0.15 }), 0, -0.02, 0)).rotation.y = 0;
  for (let i = 0; i < 8; i++) g.add(mesh(ico(0.25 + (i % 3) * 0.08, 0), flat('#8a8d93'), (i < 4 ? -1 : 1) * (3.0 + (i % 4) * 0.3), 0.1, (i % 4 - 1.5) * 0.6));
  return g;
}
function fence() {
  const g = new THREE.Group(), wood = mat('#b08a5a');
  for (let i = -4; i <= 4; i++) g.add(mesh(box(0.12, 0.95, 0.12), wood, i * 0.9, 0.47, 0));
  for (const y of [0.35, 0.72]) g.add(mesh(box(7.4, 0.09, 0.06), wood, 0, y, 0));
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (let i = -4; i <= 4; i++) g.add(mesh(cone(0.09, 0.14, 4), mat('#b08a5a'), i * 0.9, 1.02, 0).rotateY(Math.PI / 4));
  for (const s of [-1, 1]) g.add(mesh(box(0.06, 0.8, 0.06), mat('#9a7448'), s * 3.6, 0.5, 0.05));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; g.add(mesh(rbox(0.36, 0.2, 0.2, 0.05), mat(i % 2 ? '#8d9096' : '#a3a6ac'), Math.cos(a) * 0.82, 0.8, Math.sin(a) * 0.82).rotateY(-a)); }
  put(g, mesh(cyl(0.05, 0.05, 1.5, 8), _w, 0, 2.0, 0)).rotation.z = Math.PI / 2;
  g.add(mesh(box(0.05, 0.3, 0.05), _w, 0.8, 1.85, 0), mesh(cyl(0.006, 0.006, 0.9, 4), mat('#d9c38a'), 0, 1.5, 0));
  g.add(mesh(cyl(0.12, 0.09, 0.18, 10), _w, 0, 1.0, 0), mesh(new THREE.TorusGeometry(0.1, 0.008, 4, 10, Math.PI), _fe, 0, 1.12, 0));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const stoneS = mat('#b9bcc2');
  g.add(mesh(box(1.42, 0.12, 1.42), stoneS, 0, 0.92, 0), mesh(box(1.42, 0.12, 1.42), stoneS, 0, 0.06, 0));
  put(g, mesh(box(0.14, 0.8, 0.14), stoneS, -0.38, 2.0, 0)).rotation.z = 0.25;
  g.add(mesh(rbox(0.6, 0.1, 0.02, 0.02), _au, 0, 0.6, 0.66), mesh(cone(0.18, 0.3, 5), stoneS, 0, 3.05, 0));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  g.add(mesh(rbox(0.8, 1.25, 0.08, 0.05), mat('#efe6d3'), 0, 0.62, 1.48), mesh(rbox(0.4, 0.5, 0.06, 0.04), mat('#a8d4f0'), 0, 2.6, 1.32));
  g.add(mesh(rbox(0.35, 0.45, 0.06, 0.04), mat('#a8d4f0'), 0.6, 1.6, 1.25).rotateY(0.4));
  put(g, mesh(new THREE.TorusGeometry(1.25, 0.04, 4, 24), mat('#6b4226'), 0, 3.6, 0)).rotation.x = Math.PI / 2;
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.add(mesh(cyl(0.025, 0.025, 0.4, 4), mat('#6b4226'), Math.cos(a) * 1.25, 3.8, Math.sin(a) * 1.25)); }
  g.add(mesh(cyl(1.75, 1.8, 0.2, 10), mat('#9a9da3'), 0, 0.1, 0));
  return g;
}
function bench() {
  const g = new THREE.Group(), wood = mat('#8b5a36');
  g.add(mesh(box(1.8, 0.1, 0.5), wood, 0, 0.5, 0));
  g.add(mesh(box(1.8, 0.5, 0.08), wood, 0, 0.85, -0.22));
  for (const s of [-1, 1]) g.add(mesh(box(0.1, 0.5, 0.45), mat('#33363d'), s * 0.75, 0.25, 0));
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (let i = 0; i < 3; i++) g.add(mesh(rbox(1.8, 0.06, 0.12, 0.02), mat('#9a6a3c'), 0, 0.57, -0.15 + i * 0.15));
  for (const y of [0.75, 0.95]) g.add(mesh(rbox(1.8, 0.1, 0.06, 0.02), mat('#9a6a3c'), 0, y, -0.18));
  for (const s of [-1, 1]) g.add(mesh(rbox(0.08, 0.06, 0.5, 0.02), mat('#33363d'), s * 0.85, 0.72, 0), mesh(box(0.06, 0.2, 0.06), mat('#33363d'), s * 0.85, 0.62, 0.2));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const stoneF = mat('#a8abb1');
  put(g, mesh(new THREE.TorusGeometry(1.72, 0.1, 8, 32), stoneF, 0, 0.52, 0)).rotation.x = Math.PI / 2;
  put(g, mesh(new THREE.TorusGeometry(0.7, 0.06, 6, 20), stoneF, 0, 1.8, 0)).rotation.x = Math.PI / 2;
  g.add(mesh(lathe([[0.25, 0], [0.12, 0.2], [0.06, 0.45], [0.001, 0.5]], 12), stoneF, 0, 1.8, 0), mesh(cyl(0.04, 0.04, 0.12, 6), stoneF, 0, 2.3, 0));
  g.add(mesh(cyl(2.0, 2.05, 0.12, 20), mat('#9a9da3'), 0, 0.06, 0));
  for (let i = 0; i < 4; i++) g.add(mesh(cyl(0.04, 0.04, 0.01, 10), mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), Math.cos(i * 1.7) * 0.9, 0.48, Math.sin(i * 1.7) * 0.9));
  for (let i = 0; i < 3; i++) g.add(mesh(cyl(0.2, 0.2, 0.015, 12), mat('#4c9a4a'), Math.cos(i * 2.3 + 0.5) * 1.15, 0.54, Math.sin(i * 2.3 + 0.5) * 1.15));
  for (const s of [-1, 1]) g.add(mesh(rbox(0.6, 0.3, 0.3, 0.06), mat('#9a9da3'), s * 2.2, 0.15, 0.9));   // benches beside it
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const stoneD = mat('#6d7076');
  g.children.slice().forEach((c, i) => {
    if (i >= 8) return;
    if (c.geometry && c.geometry.type === 'BoxGeometry' && c.geometry.parameters.height > 0.8) {
      g.add(mesh(box(0.3, 0.03, 0.02), stoneD, c.position.x, 0.55, c.position.z + 0.09));
      g.add(mesh(ball(0.06, 0), mat(BRIGHT[i % 7]), c.position.x + 0.2, 0.06, c.position.z + 0.3));
    }
  });
  for (let i = 0; i < 4; i++) g.add(mesh(box(0.5, 0.04, 0.9), mat('#5a7a3a'), (i - 1.5) * 1.5, 0.02, 0.5));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (let i = 0; i < 3; i++) g.add(mesh(ball(0.045), mat('#15151a'), 0, 1.25 + i * 0.16, 0.41 - i * 0.02));
  put(g, mesh(new THREE.TorusGeometry(0.3, 0.07, 8, 20), mat('#e63946'), 0, 1.78, 0)).rotation.x = Math.PI / 2;
  g.add(mesh(box(0.12, 0.4, 0.04), mat('#e63946'), 0.15, 1.6, 0.28));
  for (const s of [-1, 1]) g.add(mesh(tube([[s * 0.4, 1.5, 0], [s * 0.7, 1.75, 0], [s * 0.85, 1.95, 0.05]], 0.02, 8, 4), mat('#5d3b22')));
  g.add(mesh(new THREE.TorusGeometry(0.08, 0.015, 4, 10, Math.PI), mat('#15151a'), 0, 1.95, 0.27).rotateZ(Math.PI));
  return g;
}
function table(R, night, anims, held, spec) {
  const g = new THREE.Group(), wood = mat('#9a6a3c'), top = new THREE.Group();
  top.add(mesh(box(2.2, 0.1, 1.1), wood, 0, 0.8, 0), mesh(box(1.9, 0.02, 0.8), mat('#f4f1ea'), 0, 0.86, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(box(0.1, 0.8, 0.1), wood, sx * 1.0, 0.4, sz * 0.45));
  g.add(top);
  const decor = new THREE.Group();
  const items = (spec && spec.items) || ['drumstick', 'apple', 'bread', 'cake'];
  items.forEach((kind, i) => {
    const dish = plate();
    const food = buildFood(kind);
    food.position.y = FOOD_MAKERS[kind] && food.userData.bowl ? 0 : 0.02;
    dish.add(food);
    dish.scale.setScalar(1.6);
    dish.position.set((i - (items.length - 1) / 2) * 0.48, 0.87, (i % 2) * 0.2 - 0.1);
    decor.add(dish);
  });
  g.add(decor);
  g.userData = { top, decor };
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const linen = mat('#fbfbf7');
  for (const s of [-1, 1]) g.add(mesh(box(2.0, 0.25, 0.02), linen, 0, 0.75, s * 0.56));
  for (let i = 0; i < 4; i++) {
    const x = -0.75 + i * 0.5;
    g.add(mesh(box(0.12, 0.01, 0.12), mat(BRIGHT[i % 7]), x, 0.875, 0.32).rotateY(0.4));
    g.add(mesh(box(0.015, 0.005, 0.18), mat('#d9dee6', { metalness: 0.8, roughness: 0.25 }), x - 0.14, 0.875, 0.2), mesh(box(0.015, 0.005, 0.2), mat('#d9dee6', { metalness: 0.8, roughness: 0.25 }), x + 0.14, 0.875, 0.2));
    g.add(mesh(cyl(0.035, 0.03, 0.12, 10), mat('#dff1fb', { transparent: true, opacity: 0.5 }), x + 0.18, 0.93, -0.25));
  }
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (const s of [-1, 1]) g.add(mesh(ball(0.09), _au, s * 3, 3.65, 0));
  for (let i = 0; i < 9; i++) {
    const u = (i + 0.5) / 9, x = -3 + u * 6, y = 2.6 - Math.sin(u * Math.PI) * 0.5;
    const f = mesh(cone(0.16, 0.36, 3), mat(BRIGHT[(i + 3) % 7]), x, y - 0.18, 0.05);
    f.rotation.x = Math.PI;
    f.scale.z = 0.15;
    g.add(f);
  }
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  g.children.slice(0, 3).forEach((b) => b.add(mesh(cyl(0.33, 0.33, 0.02, 10), mat('#a8744a'), 0, 0.455, 0)));
  for (let i = 0; i < 4; i++) g.add(mesh(box(0.82, 0.03, 0.82), mat('#9a7448'), 1.7, 0.1 + i * 0.2, -0.2));
  g.add(mesh(new THREE.TorusGeometry(0.15, 0.04, 6, 14), mat('#d9c38a'), 1.7, 0.84, -0.2).rotateX(Math.PI / 2));
  for (let i = 0; i < 2; i++) g.add(mesh(ball(0.09), mat('#d62828'), -0.85 + i * 0.15, 0.95, 0.05));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  g.children.filter((c) => c.geometry && c.geometry.type === 'SphereGeometry').forEach((cap) => {
    const r = cap.geometry.parameters.radius;
    for (const a of [0.5, 2.6]) g.add(mesh(ball(r * 0.18), mat('#fbfbf7'), cap.position.x + Math.cos(a) * r * 0.5, cap.position.y + r * 0.4, cap.position.z + Math.sin(a) * r * 0.5));
  });
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  g.add(mesh(rbox(1.4, 0.35, 0.06, 0.04), mat('#f4f1e1'), 0, 2.75, 0.85), mesh(box(1.1, 0.08, 0.07), mat('#d1495b'), 0, 2.75, 0.86));
  for (let i = 0; i < 4; i++) g.add(mesh(rbox(0.14, 0.1, 0.01, 0.01), mat('#ffffff'), -0.9 + i * 0.6, 0.98, 0.56));
  for (let i = 0; i < 5; i++) g.add(mesh(cone(0.2, 0.18, 3), mat(i % 2 ? '#f4f1ea' : '#d1495b'), (i - 2) * 0.56, 2.08, 0.92).rotateX(Math.PI));
  for (const s of [-1, 1]) g.add(mesh(box(0.45, 0.35, 0.45), mat('#b08a5a'), s * 1.6, 0.18, 0.6));
  g.add(mesh(cyl(0.12, 0.12, 0.02, 12), mat('#d9dee6', { metalness: 0.8, roughness: 0.25 }), 1.0, 0.92, -0.2), mesh(box(0.04, 0.1, 0.04), _d, 1.0, 0.86, -0.2));
  g.add(mesh(cyl(0.015, 0.015, 0.4, 4), _d, -1.25, 2.0, 0.4), mesh(ball(0.1), glow('#ffd98a', 1.4), -1.25, 1.75, 0.4));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const cap = mesh(cone(1.3, 1.5, 4), _au, 0, 14.3, 0);
  cap.rotation.y = Math.PI / 4;
  g.add(cap, mesh(box(2.4, 3, 1), mat('#3a2a1c'), 0, 1.5, 9.2));
  for (let i = 1; i < 4; i++) { const w = 2 * 9.2 * (1 - (i * 3.4) / 15) + 0.25; g.add(mesh(box(w, 0.15, w), mat('#c9a25a'), 0, i * 3.4, 0)); }   // courses of stone
  return g;
}
function igloo() {
  const g = new THREE.Group();
  const dome = mesh(new THREE.SphereGeometry(2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat('#f4f8fb'));
  g.add(dome);
  g.add(mesh(box(1.1, 1.0, 1.0), mat('#e6eef4'), 0, 0.5, 1.9));
  g.add(mesh(box(0.6, 0.7, 0.1), mat('#27303d'), 0, 0.35, 2.41));
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (let i = 1; i <= 3; i++) {
    const y = i * 0.45, r = Math.sqrt(4 - y * y);
    put(g, mesh(new THREE.TorusGeometry(r, 0.03, 4, 28), mat('#dbe6ee'), 0, y, 0)).rotation.x = Math.PI / 2;
  }
  for (let i = 0; i < 4; i++) put(g, mesh(new THREE.TorusGeometry(2.0, 0.03, 4, 20, Math.PI / 2), mat('#dbe6ee'), 0, 0, 0)).rotation.set(0, i * Math.PI / 2 + 0.4, Math.PI / 2);
  return g;
}
function bush(R) {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const b = mesh(blob(0.5 + R() * 0.3), mat(mix('#3e8b3a', '#5fa346', R())), (i - 1.5) * 0.8, 0.4, (R() - 0.5) * 0.6);
    b.scale.y = 0.8;
    g.add(b);
    if (i % 2) g.add(mesh(ball(0.07, 0), mat('#d1495b'), (i - 1.5) * 0.8 + 0.2, 0.75, 0.3));
  }
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (let i = 0; i < 5; i++) g.add(mesh(ball(0.06, 0), mat(i % 2 ? '#7d3cff' : '#d1495b'), (i - 2) * 0.55, 0.55 + (i % 2) * 0.2, 0.42));
  const lf = slab([[0, 0], [0.08, 0.1], [0, 0.22], [-0.08, 0.1]], 0.01);
  for (let i = 0; i < 4; i++) put(g, mesh(lf, mat('#5fae4f', { side: THREE.DoubleSide }), (i - 1.5) * 0.8, 0.85, 0.2)).rotation.set(-0.6, i, 0);
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  g.add(mesh(cone(0.1, 0.15, 6), _w, 0, 2.47, 0));
  put(g, mesh(cone(0.13, 0.25, 3), mat('#c9a063'), 1.13, 2.19, 0.06)).rotation.z = -Math.PI / 2 + 0.15;
  put(g, mesh(cone(0.13, 0.25, 3), mat('#c9a063'), -1.13, 1.58, 0.06)).rotation.z = Math.PI / 2 - 0.2;
  for (let i = 0; i < 2; i++) g.add(mesh(ico(0.12, 0), flat('#8a8d93'), (i ? 0.18 : -0.15), 0.06, 0.12));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  g.children.filter((c) => c.geometry && c.geometry.type === 'SphereGeometry').forEach((p) => {
    const r = p.geometry.parameters.radius;
    for (const a of [0.6, -0.6, Math.PI]) {
      const rib = mesh(ball(r * 0.98), mat('#e07b10'), p.position.x + Math.sin(a) * r * 0.12, p.position.y, p.position.z + Math.cos(a) * r * 0.12);
      rib.scale.set(0.55, 0.78, 0.55);
      g.add(rib);
    }
  });
  for (let i = 0; i < 2; i++) put(g, mesh(slab([[0, 0], [0.12, 0.06], [0.2, 0], [0.1, -0.05]], 0.01), mat('#3f6b2a', { side: THREE.DoubleSide }), -0.9 + i * 1.8, 0.05, 0.3)).rotation.x = -Math.PI / 2;
  return g;
}
// ---- food and drink ----------------------------------------------------------
// Each model is about hand-sized, with its origin where a hand or a plate holds it.
// userData.part is what shrinks bite by bite; liquid drains instead for drinks.
function wedge(r, h, angle, material, y = 0) {   // a slice: pizza, cake, pie, watermelon
  const m = mesh(new THREE.CylinderGeometry(r, r, h, 16, 1, false, -angle / 2, angle), material, 0, y, 0);
  m.rotation.y = Math.PI;                        // tip toward the eater
  return m;
}
function plate(r = 0.16) {
  const g = new THREE.Group();
  g.add(mesh(cyl(r, r * 0.8, 0.02, 24), mat('#fbfbfb', { roughness: 0.3 }), 0, 0.01, 0));
  return g;
}
function glassOf(color, h = 0.16, r = 0.045, straw = false) {
  const g = new THREE.Group();
  const liquid = mesh(cyl(r * 0.88, r * 0.78, h * 0.8, 16), mat(color, { roughness: 0.3 }), 0, h * 0.42, 0);
  g.add(liquid, mesh(cyl(r, r * 0.85, h, 16, 1), mat('#dff1fb', { transparent: true, opacity: 0.35, roughness: 0.05, depthWrite: false }), 0, h / 2, 0));
  if (straw) put(g, mesh(cyl(0.006, 0.006, h * 1.2, 6), mat('#ff5d8f'), r * 0.3, h * 0.85, 0)).rotation.z = -0.25;
  put(g, mesh(new THREE.TorusGeometry(r, 0.004, 4, 20), mat('#e8f4fa', { roughness: 0.05 }), 0, h, 0)).rotation.x = Math.PI / 2;
  g.add(mesh(cyl(r * 1.4, r * 1.4, 0.006, 18), mat('#c98b4a'), 0, -0.004, 0));
  g.userData = { liquid, drink: true };
  return g;
}
const FOOD_MAKERS = {
  hamburger() {
    const g = new THREE.Group(), bun = mat('#d99a4e');
    g.add(mesh(cyl(0.1, 0.095, 0.035, 20), bun, 0, 0.018, 0), mesh(cyl(0.105, 0.105, 0.03, 20), mat('#5a3420'), 0, 0.05, 0));
    put(g, mesh(box(0.17, 0.008, 0.17), mat('#f6c02e'), 0, 0.068, 0)).rotation.y = Math.PI / 4;
    g.add(mesh(cyl(0.112, 0.112, 0.012, 20), mat('#5db04a'), 0, 0.076, 0), mesh(cyl(0.085, 0.085, 0.012, 16), mat('#e2412f'), 0, 0.087, 0));
    const top = mesh(new THREE.SphereGeometry(0.1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), bun, 0, 0.093, 0);
    top.scale.y = 0.6;
    g.add(top);
    for (let i = 0; i < 7; i++) g.add(mesh(ball(0.006), mat('#fff7e0'), Math.cos(i * 2.4) * 0.05, 0.14 - (i % 3) * 0.006, Math.sin(i * 2.4) * 0.05));
    return g;
  },
  pizza() {
    const g = new THREE.Group();
    g.add(wedge(0.2, 0.016, 0.7, mat('#f2c14e')));
    put(g, mesh(cyl(0.02, 0.02, 0.15, 8), mat('#c98a3c'), 0, 0.006, -0.19)).rotation.z = Math.PI / 2;
    [[0, -0.06], [0.04, -0.13], [-0.04, -0.12]].forEach(([x, z]) => g.add(mesh(cyl(0.02, 0.02, 0.006, 12), mat('#b3261e'), x, 0.012, z)));
    g.position.z = 0.1;
    const w = new THREE.Group();
    w.add(g);
    return w;
  },
  hotdog() {
    const g = new THREE.Group();
    const bun = mesh(capsule(0.035, 0.15), mat('#d99a4e'), 0, 0.03, 0);
    bun.rotation.z = Math.PI / 2;
    bun.scale.set(1, 1, 0.75);
    const dog = mesh(capsule(0.022, 0.2), mat('#a33b26'), 0, 0.05, 0);
    dog.rotation.z = Math.PI / 2;
    g.add(bun, dog, put(new THREE.Group(), mesh(box(0.16, 0.006, 0.012), mat('#f2c230'), 0, 0.074, 0)));
    return g;
  },
  sandwich() {
    const g = new THREE.Group(), bread = mat('#f0d9a6');
    const layer = (c, y, h) => put(g, mesh(cyl(0.1, 0.1, h, 3), mat(c), 0, y, 0));
    layer('#f0d9a6', 0.012, 0.024); layer('#5db04a', 0.03, 0.01); layer('#f29e8e', 0.04, 0.012); layer('#f6c02e', 0.05, 0.008);
    put(g, mesh(cyl(0.1, 0.1, 0.024, 3), bread, 0, 0.066, 0));
    g.rotation.y = Math.PI / 6;
    return g;
  },
  taco() {
    const g = new THREE.Group();
    const shell = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.16, 16, 1, true, 0, Math.PI), mat('#e6b04a', { side: THREE.DoubleSide }), 0, 0.06, 0);
    shell.rotation.z = Math.PI / 2;
    shell.rotation.y = Math.PI / 2;
    g.add(shell);
    ['#5db04a', '#a3482e', '#f6c02e', '#e2412f'].forEach((c, i) => g.add(mesh(ball(0.03), mat(c), (i - 1.5) * 0.035, 0.1, 0)));
    return g;
  },
  fries() {
    const g = new THREE.Group();
    g.add(mesh(cyl(0.06, 0.045, 0.1, 4), mat('#d62828'), 0, 0.05, 0));
    for (let i = 0; i < 9; i++) {
      const f = mesh(box(0.014, 0.12, 0.014), mat('#f6c94a'), ((i % 3) - 1) * 0.025, 0.11, (Math.floor(i / 3) - 1) * 0.02);
      f.rotation.z = (i - 4) * 0.05;
      g.add(f);
    }
    return g;
  },
  icecream() {
    const g = new THREE.Group();
    put(g, mesh(cone(0.045, 0.14, 16), mat('#d9a35a'), 0, -0.02, 0)).rotation.x = Math.PI;
    g.add(mesh(ball(0.05), mat('#f7b7c9'), 0, 0.075, 0), mesh(ball(0.045), mat('#fff3e0'), 0, 0.14, 0), mesh(ball(0.014), mat('#c1121f'), 0, 0.19, 0));
    return g;
  },
  cookie() {
    const g = new THREE.Group();
    put(g, mesh(cyl(0.07, 0.07, 0.016, 20), mat('#c98b4a'), 0, 0, 0)).rotation.x = Math.PI / 2;
    for (let i = 0; i < 6; i++) g.add(mesh(ball(0.009), mat('#3b2412'), Math.cos(i * 2.2) * 0.04, Math.sin(i * 2.2) * 0.04, 0.009));
    return g;
  },
  donut() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.TorusGeometry(0.055, 0.028, 12, 24), mat('#d39b55')));
    const icing = mesh(new THREE.TorusGeometry(0.055, 0.03, 12, 24, Math.PI * 2), mat('#f78fb3'), 0, 0, 0.008);
    icing.scale.z = 0.6;
    g.add(icing);
    for (let i = 0; i < 10; i++) g.add(mesh(box(0.012, 0.004, 0.004), mat(BRIGHT[i % 7]), Math.cos(i * 0.63) * 0.055, Math.sin(i * 0.63) * 0.055, 0.03));
    return g;
  },
  cake() {
    const g = new THREE.Group();
    g.add(wedge(0.14, 0.04, 0.8, mat('#f4e3c3'), 0.02), wedge(0.14, 0.012, 0.8, mat('#c2457a'), 0.046), wedge(0.14, 0.04, 0.8, mat('#f4e3c3'), 0.072));
    g.add(wedge(0.14, 0.012, 0.8, mat('#ffffff'), 0.098), mesh(ball(0.016), mat('#c1121f'), 0, 0.115, -0.09));
    return g;
  },
  cupcake() {
    const g = new THREE.Group();
    g.add(mesh(cyl(0.045, 0.035, 0.05, 16), mat('#7ec8e3'), 0, 0.025, 0));
    const top = mesh(cone(0.05, 0.08, 16), mat('#f7c9d4'), 0, 0.085, 0);
    g.add(top, mesh(ball(0.014), mat('#c1121f'), 0, 0.13, 0));
    return g;
  },
  pie() {
    const g = new THREE.Group();
    g.add(wedge(0.14, 0.04, 0.8, mat('#7a1f3d'), 0.02), wedge(0.145, 0.012, 0.8, mat('#d9a35a'), 0.046));
    return g;
  },
  apple() {
    const g = new THREE.Group();
    const a = mesh(ball(0.045), mat('#d62828', { roughness: 0.35 }), 0, 0.045, 0);
    a.scale.y = 0.9;
    g.add(a, mesh(cyl(0.004, 0.004, 0.03, 6), mat('#5d3b22'), 0, 0.095, 0));
    put(g, mesh(ball(0.016), mat('#4c9a4a'), 0.014, 0.1, 0)).scale.set(1.4, 0.3, 0.8);
    return g;
  },
  banana() {
    const g = new THREE.Group();
    put(g, mesh(new THREE.TorusGeometry(0.08, 0.018, 8, 16, 2.1), mat('#f7d84a'), 0, -0.05, 0)).rotation.z = 0.5;
    return g;
  },
  carrot() {
    const g = new THREE.Group();
    put(g, mesh(cone(0.025, 0.17, 12), mat('#f28c1a'), 0, -0.04, 0)).rotation.x = Math.PI;
    for (let i = 0; i < 3; i++) put(g, mesh(cone(0.012, 0.07, 6), mat('#4c9a4a'), (i - 1) * 0.01, 0.075, 0)).rotation.z = (i - 1) * 0.4;
    return g;
  },
  orange() {
    const g = new THREE.Group();
    g.add(mesh(ball(0.045), mat('#f28c1a', { roughness: 0.6 }), 0, 0.045, 0), mesh(ball(0.008), mat('#4c9a4a'), 0, 0.09, 0));
    return g;
  },
  strawberry() {
    const g = new THREE.Group();
    const b = mesh(ball(0.03), mat('#e0242c', { roughness: 0.4 }), 0, 0.03, 0);
    b.scale.y = 1.3;
    g.add(b, put(new THREE.Group(), mesh(cone(0.025, 0.02, 6), mat('#4c9a4a'), 0, 0.07, 0)));
    return g;
  },
  watermelon() {
    const g = new THREE.Group();
    const s = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 16, 1, false, 0, Math.PI), mat('#ef3e4a'), 0, 0, 0);
    s.rotation.set(Math.PI / 2, 0, 0);
    const rind = mesh(new THREE.TorusGeometry(0.13, 0.012, 6, 16, Math.PI), mat('#3f8f3f'));
    g.add(s, rind);
    for (let i = 0; i < 5; i++) g.add(mesh(ball(0.006), mat('#1b1b1f'), (i - 2) * 0.035, 0.05 + (i % 2) * 0.02, 0.016));
    return g;
  },
  grapes() {
    const g = new THREE.Group(), m = mat('#6a2c91', { roughness: 0.3 });
    [[0, 0], [-1, 0], [1, 0], [-0.5, -1], [0.5, -1], [0, -2], [-1.5, 1], [1.5, 1], [0, 1]].forEach(([x, y]) => g.add(mesh(ball(0.02), m, x * 0.026, y * 0.03, 0)));
    g.add(mesh(cyl(0.004, 0.004, 0.05, 4), mat('#5d3b22'), 0, 0.055, 0));
    return g;
  },
  corn() {
    const g = new THREE.Group();
    g.add(mesh(capsule(0.028, 0.12), mat('#f6cf3e'), 0, 0, 0));
    for (const s of [-1, 1]) put(g, mesh(box(0.03, 0.16, 0.01), mat('#7cb342'), s * 0.03, -0.03, 0)).rotation.z = s * 0.3;
    return g;
  },
  bread() {
    const g = new THREE.Group();
    const loaf = mesh(capsule(0.05, 0.12), mat('#c98a3c'), 0, 0.04, 0);
    loaf.rotation.z = Math.PI / 2;
    loaf.scale.set(1, 1, 0.8);
    g.add(loaf);
    return g;
  },
  cheese() {
    const g = new THREE.Group();
    put(g, mesh(cyl(0.08, 0.08, 0.05, 3), mat('#f6c94a'), 0, 0.025, 0)).rotation.y = Math.PI / 6;
    for (let i = 0; i < 3; i++) g.add(mesh(ball(0.01), mat('#d9a32e'), (i - 1) * 0.025, 0.04, 0.03));
    return g;
  },
  egg() {
    const g = new THREE.Group();
    const e = mesh(ball(0.03), mat('#fbf4e6'), 0, 0.035, 0);
    e.scale.y = 1.3;
    g.add(e);
    return g;
  },
  drumstick() {
    const g = new THREE.Group();
    const meat = mesh(ball(0.05), mat('#9c5a2a', { roughness: 0.5 }), 0, 0.05, 0);
    meat.scale.set(0.9, 1.3, 0.9);
    g.add(meat, mesh(cyl(0.012, 0.012, 0.08, 8), mat('#f4efe2'), 0, -0.04, 0));
    for (const s of [-1, 1]) g.add(mesh(ball(0.014), mat('#f4efe2'), s * 0.012, -0.085, 0));
    return g;
  },
  steak() {
    const g = new THREE.Group();
    const m = mesh(ball(0.08), mat('#7a3a24', { roughness: 0.5 }), 0, 0.02, 0);
    m.scale.set(1.2, 0.25, 0.85);
    g.add(m, put(new THREE.Group(), mesh(box(0.004, 0.004, 0.12), mat('#3b1d12'), 0, 0.04, 0)));
    return g;
  },
  fish() {
    const g = new THREE.Group();
    const b = mesh(ball(0.05), mat('#9fb2c4', { roughness: 0.35 }), 0, 0.03, 0);
    b.scale.set(0.5, 0.6, 1.6);
    const t = mesh(cone(0.035, 0.05, 4), b.material, 0, 0.03, -0.1);
    t.rotation.x = -Math.PI / 2;
    t.scale.x = 0.3;
    g.add(b, t);
    return g;
  },
  sushi() {
    const g = new THREE.Group();
    g.add(mesh(capsule(0.025, 0.05), mat('#fbfbf5'), 0, 0.025, 0), mesh(box(0.06, 0.012, 0.11), mat('#f47c48'), 0, 0.055, 0));
    g.children[0].rotation.x = Math.PI / 2;
    g.add(mesh(box(0.055, 0.06, 0.015), mat('#1d2b1f'), 0, 0.03, 0));
    return g;
  },
  pancakes() {
    const g = plate(0.13);
    for (let i = 0; i < 3; i++) g.add(mesh(cyl(0.09, 0.09, 0.018, 20), mat('#e0a55a'), 0, 0.03 + i * 0.02, 0));
    g.add(mesh(box(0.03, 0.012, 0.03), mat('#fff3a8'), 0, 0.09, 0), mesh(cyl(0.07, 0.06, 0.004, 16), mat('#8a4a12', { roughness: 0.2 }), 0, 0.085, 0));
    return g;
  },
  popcorn() {
    const g = new THREE.Group();
    for (let i = 0; i < 8; i++) g.add(mesh(box(0.02, 0.12, 0.01), mat(i % 2 ? '#ffffff' : '#d62828'), Math.cos(i * 0.785) * 0.05, 0.06, Math.sin(i * 0.785) * 0.05)).children;
    g.children.forEach((c, i) => { c.rotation.y = -i * 0.785; });
    for (let i = 0; i < 9; i++) g.add(mesh(ball(0.018), mat('#fff8dc'), (i % 3 - 1) * 0.025, 0.125 + (i % 2) * 0.012, (Math.floor(i / 3) - 1) * 0.025));
    return g;
  },
  candy() {
    const g = new THREE.Group();
    g.add(mesh(cyl(0.005, 0.005, 0.12, 6), mat('#ffffff'), 0, -0.04, 0));
    put(g, mesh(cyl(0.045, 0.045, 0.012, 20), mat('#ff5d8f', { roughness: 0.2 }), 0, 0.045, 0)).rotation.x = Math.PI / 2;
    put(g, mesh(new THREE.TorusGeometry(0.025, 0.006, 6, 16), mat('#ffffff'), 0, 0.045, 0.007));
    return g;
  },
  chocolate() {
    const g = new THREE.Group();
    g.add(mesh(box(0.06, 0.12, 0.012), mat('#4a2412', { roughness: 0.4 }), 0, 0.03, 0), mesh(box(0.062, 0.06, 0.014), mat('#c62828'), 0, -0.01, 0));
    return g;
  },
  bone() {
    const g = new THREE.Group(), w = mat('#f4efe2');
    put(g, mesh(cyl(0.015, 0.015, 0.14, 8), w, 0, 0.02, 0)).rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) for (const z of [-1, 1]) g.add(mesh(ball(0.022), w, s * 0.075, 0.02, z * 0.014));
    return g;
  },
  honey() {
    const g = new THREE.Group();
    g.add(mesh(cyl(0.06, 0.05, 0.1, 16), mat('#e8a317', { roughness: 0.25 }), 0, 0.05, 0), mesh(cyl(0.065, 0.065, 0.02, 16), mat('#b5651d'), 0, 0.105, 0));
    put(g, mesh(cyl(0.006, 0.006, 0.14, 6), mat('#8b5a2b'), 0.02, 0.13, 0)).rotation.z = -0.3;
    return g;
  },
  nut() {
    const g = new THREE.Group();
    const n = mesh(ball(0.025), mat('#a0662c'), 0, 0.025, 0);
    n.scale.y = 1.3;
    g.add(n, mesh(new THREE.SphereGeometry(0.027, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat('#6b4423'), 0, 0.04, 0));
    return g;
  },
  seeds() {
    const g = new THREE.Group();
    for (let i = 0; i < 14; i++) g.add(mesh(ball(0.012), mat(i % 3 ? '#d8b24a' : '#8a5a2b'), Math.cos(i * 2.4) * 0.05 * Math.sqrt(i / 14), 0.008, Math.sin(i * 2.4) * 0.05 * Math.sqrt(i / 14)));
    return g;
  },
  grass() {
    const g = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const b = mesh(cone(0.03, 0.22 + (i % 3) * 0.05, 5), mat(i % 2 ? '#5a9e3d' : '#7cb342'), Math.cos(i * 0.7) * 0.07, 0.12, Math.sin(i * 0.7) * 0.07);
      b.rotation.set(Math.sin(i) * 0.3, 0, Math.cos(i) * 0.3);
      g.add(b);
    }
    return g;
  },
  bamboo() {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) g.add(mesh(cyl(0.018, 0.018, 0.1, 10), mat('#8bbf4a'), 0, i * 0.105 - 0.05, 0), mesh(cyl(0.021, 0.021, 0.01, 10), mat('#5a8a2a'), 0, i * 0.105, 0));
    put(g, mesh(box(0.03, 0.002, 0.12), mat('#4c9a4a'), 0.03, 0.2, 0)).rotation.z = -0.6;
    return g;
  },
  pretzel() {
    const g = new THREE.Group();
    put(g, mesh(new THREE.TorusKnotGeometry(0.04, 0.012, 48, 8, 2, 3), mat('#a0581e', { roughness: 0.4 }), 0, 0.04, 0)).scale.z = 0.4;
    return g;
  },
  croissant() {
    const g = new THREE.Group();
    put(g, mesh(new THREE.TorusGeometry(0.06, 0.03, 10, 16, 2.4), mat('#d99a4e'), 0, -0.03, 0)).rotation.set(Math.PI / 2, 0, 0.4);
    return g;
  },
  noodles() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.SphereGeometry(0.09, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat('#e9edf2', { side: THREE.DoubleSide, roughness: 0.3 }), 0, 0.08, 0));
    const food = mesh(cyl(0.08, 0.08, 0.02, 20), mat('#f2c76b'), 0, 0.07, 0);
    for (let i = 0; i < 6; i++) food.add(mesh(new THREE.TorusGeometry(0.02, 0.005, 6, 12), mat('#f6d27a'), Math.cos(i) * 0.04, 0.012, Math.sin(i) * 0.04));
    g.add(food);
    g.userData = { bowl: true, part: food };
    return g;
  },
  soup() {
    const g = FOOD_MAKERS.noodles();
    g.userData.part.material = mat('#d9772e', { roughness: 0.2 });
    g.userData.part.clear();
    return g;
  },
  cereal() {
    const g = FOOD_MAKERS.noodles();
    g.userData.part.material = mat('#fbfbf5', { roughness: 0.3 });
    g.userData.part.clear();
    for (let i = 0; i < 9; i++) g.userData.part.add(mesh(new THREE.TorusGeometry(0.01, 0.004, 4, 8), mat(BRIGHT[i % 7]), Math.cos(i * 1.7) * 0.05, 0.012, Math.sin(i * 1.7) * 0.05));
    return g;
  },
  salad() {
    const g = FOOD_MAKERS.noodles();
    g.userData.part.material = mat('#5db04a');
    g.userData.part.clear();
    for (let i = 0; i < 8; i++) g.userData.part.add(mesh(ball(0.02), mat(i % 3 ? '#7cb342' : '#e2412f'), Math.cos(i * 0.8) * 0.045, 0.015, Math.sin(i * 0.8) * 0.045));
    return g;
  },
  soda() {
    const g = new THREE.Group();
    g.add(mesh(cyl(0.035, 0.035, 0.12, 18), mat('#d62828', { metalness: 0.6, roughness: 0.3 }), 0, 0.06, 0), mesh(cyl(0.03, 0.035, 0.01, 18), mat('#c3c8cf', { metalness: 0.8, roughness: 0.3 }), 0, 0.125, 0));
    g.add(mesh(box(0.071, 0.03, 0.02), mat('#ffffff'), 0, 0.06, 0.028));
    g.userData = { drink: true };
    return g;
  },
  juice: () => glassOf('#f6a02c', 0.15, 0.045, true),
  milk: () => glassOf('#fbfbfb', 0.15),
  water: () => glassOf('#bfe6fb', 0.15),
  lemonade() { const g = glassOf('#f7e463', 0.15, 0.045, true); g.add(mesh(cyl(0.03, 0.03, 0.006, 12), mat('#f7d84a'), 0.04, 0.15, 0)); return g; },
  milkshake() {
    const g = glassOf('#f7b7c9', 0.2, 0.045, true);
    g.add(mesh(ball(0.045), mat('#ffffff'), 0, 0.2, 0), mesh(ball(0.012), mat('#c1121f'), 0, 0.245, 0));
    return g;
  },
  coffee() {
    const g = new THREE.Group();
    g.add(mesh(cyl(0.045, 0.04, 0.09, 18), mat('#f4f4f4', { roughness: 0.3 }), 0, 0.045, 0));
    const liquid = mesh(cyl(0.04, 0.04, 0.005, 18), mat('#5a3420', { roughness: 0.15 }), 0, 0.085, 0);
    g.add(liquid, mesh(new THREE.TorusGeometry(0.025, 0.008, 6, 12), mat('#f4f4f4'), 0.05, 0.05, 0));
    g.userData = { drink: true, liquid, cup: true };
    return g;
  },
  tea() { const g = FOOD_MAKERS.coffee(); g.userData.liquid.material = mat('#b5651d', { roughness: 0.15 }); return g; },
  potion() {
    const g = new THREE.Group();
    const liquid = mesh(ball(0.05), mat('#b388ff', { emissive: '#8d5fd3', emissiveIntensity: 1.2, roughness: 0.2 }), 0, 0.05, 0);
    g.add(liquid, mesh(ball(0.055), mat('#e6e0ff', { transparent: true, opacity: 0.3, depthWrite: false }), 0, 0.05, 0));
    g.add(mesh(cyl(0.015, 0.02, 0.05, 10), mat('#e6e0ff', { transparent: true, opacity: 0.4 }), 0, 0.12, 0), mesh(cyl(0.017, 0.015, 0.025, 10), mat('#8b5a2b'), 0, 0.15, 0));
    g.userData = { drink: true, liquid };
    return g;
  },
};
// Finishing touches for each food: toppings, seeds, garnish, crumbs.
const dot = (g, c, r, x, y, z, k = 1) => { const m = mesh(ball(r, k ? 1 : 0), mat(c), x, y, z); g.add(m); return m; };
const FOOD_DETAIL = {
  banana(g) {
    // points along the curved peel: centre (0, -0.05), radius 0.08, turned by 0.5
    const at = (a) => [0.08 * Math.cos(a + 0.5), -0.05 + 0.08 * Math.sin(a + 0.5)];
    const [sx, sy] = at(0.02), [tx, ty] = at(2.08), [ax, ay] = at(0.8), [bx, by] = at(1.4);
    g.add(mesh(cyl(0.008, 0.01, 0.03, 6), mat('#6b5a2a'), sx, sy + 0.01, 0), mesh(ball(0.011), mat('#4a3a1a'), tx, ty, 0));
    dot(g, '#a07a2a', 0.007, ax, ay, 0.015); dot(g, '#a07a2a', 0.006, bx, by, 0.016);
  },
  bread(g) { for (let i = 0; i < 3; i++) put(g, mesh(box(0.012, 0.004, 0.07), mat('#e9c27a'), (i - 1) * 0.05, 0.088, 0)).rotation.y = 0.5; },
  croissant(g) { for (const s of [-1, 1]) g.add(mesh(cone(0.02, 0.05, 8), mat('#c98b4a'), s * 0.06, -0.06, 0.02).rotateZ(s * 2.2)); for (let i = 0; i < 2; i++) g.add(mesh(new THREE.TorusGeometry(0.06, 0.006, 4, 12, 2.0), mat('#b8783a'), 0, -0.03, 0.025 * (i ? 1 : -1)).rotateX(Math.PI / 2)); },
  egg(g) { g.add(mesh(lathe([[0.001, 0], [0.025, 0.002], [0.012, 0.02], [0.03, 0.045]], 14), mat('#3d5a80'), 0, -0.012, 0), mesh(cyl(0.028, 0.028, 0.006, 14), mat('#3d5a80'), 0, -0.012, 0)); },
  pretzel(g) { for (let i = 0; i < 6; i++) dot(g, '#ffffff', 0.004, Math.cos(i * 1.1) * 0.035, 0.05, Math.sin(i * 1.1) * 0.01 + 0.004, 0); },
  chocolate(g) { for (let i = 0; i < 2; i++) g.add(mesh(box(0.062, 0.003, 0.014), mat('#3a1a0a'), 0, 0.045 + i * 0.03, 0)); for (let i = 0; i < 2; i++) g.add(mesh(box(0.003, 0.06, 0.014), mat('#3a1a0a'), (i ? 0.012 : -0.012), 0.06, 0)); },
  fish(g) { dot(g, '#101014', 0.006, 0.02, 0.045, 0.06); for (let i = 0; i < 3; i++) g.add(mesh(box(0.05, 0.004, 0.006), mat('#3a2a1a'), 0, 0.058, -0.03 + i * 0.03).rotateY(0.6)); },
  nut(g) { g.add(mesh(cyl(0.004, 0.004, 0.02, 4), mat('#3b2a1a'), 0, 0.075, 0)); for (const y of [0.048, 0.056]) g.add(mesh(new THREE.TorusGeometry(0.024, 0.002, 4, 12), mat('#4a2e12'), 0, y, 0).rotateX(Math.PI / 2)); },
  orange(g) { put(g, mesh(ball(0.014), mat('#4c9a4a'), 0.012, 0.095, 0)).scale.set(1.4, 0.3, 0.7); dot(g, '#d9771a', 0.006, 0, 0.005, 0.0); },
  pie(g) { for (let i = 0; i < 3; i++) g.add(mesh(box(0.012, 0.006, 0.12), mat('#e0b066'), (i - 1) * 0.035, 0.055, -0.06).rotateY(0.2)); },
  steak(g) { for (let i = 0; i < 3; i++) g.add(mesh(box(0.11, 0.004, 0.008), mat('#3b1d12'), 0, 0.042, -0.03 + i * 0.03).rotateY(0.5)); put(g, mesh(slab([[0, 0], [0.02, 0.03], [0, 0.06], [-0.02, 0.03]], 0.003), mat('#4c9a4a')), 0.06, 0.045, 0.03).rotation.x = -Math.PI / 2; },
  strawberry(g) { for (let i = 0; i < 6; i++) dot(g, '#f6d27a', 0.0035, Math.cos(i * 1.05) * 0.028, 0.02 + (i % 3) * 0.012, Math.sin(i * 1.05) * 0.028, 0); },
  apple(g) { put(g, mesh(ball(0.012), mat('#4c9a4a'), -0.012, 0.1, 0)).scale.set(1.4, 0.3, 0.8); dot(g, '#7a1a1a', 0.008, 0, 0.004, 0); dot(g, '#ff8a8a', 0.012, 0.025, 0.06, 0.03); },
  candy(g) { for (const s of [-1, 1]) g.add(mesh(cone(0.012, 0.025, 6), mat('#ff5d8f', { transparent: true, opacity: 0.7 }), s * 0.05, 0.045, 0).rotateZ(s * Math.PI / 2)); g.add(mesh(new THREE.TorusGeometry(0.035, 0.004, 4, 16), mat('#ffd166'), 0, 0.045, 0.007)); },
  coffee(g) { g.add(mesh(cyl(0.07, 0.06, 0.008, 18), mat('#f4f4f4', { roughness: 0.3 }), 0, 0.0, 0)); for (let i = 0; i < 2; i++) g.add(mesh(ball(0.015 + i * 0.006), mat('#ffffff', { transparent: true, opacity: 0.4 }), 0.01 * i, 0.12 + i * 0.04, 0)); dot(g, '#c98b4a', 0.012, 0.03, 0.088, 0.01); },
  tea(g) { FOOD_DETAIL.coffee(g); g.add(mesh(cyl(0.002, 0.002, 0.06, 4), mat('#e9e9e9'), 0.03, 0.1, 0), mesh(box(0.02, 0.025, 0.002), mat('#e63946'), 0.05, 0.07, 0)); },
  corn(g) { for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; g.add(mesh(box(0.004, 0.13, 0.004), mat('#e0b42a'), Math.cos(a) * 0.028, 0, Math.sin(a) * 0.028)); } },
  cupcake(g) { for (let i = 0; i < 4; i++) g.add(mesh(box(0.012, 0.004, 0.004), mat(BRIGHT[i]), Math.cos(i * 1.6) * 0.03, 0.09 + (i % 2) * 0.012, Math.sin(i * 1.6) * 0.03).rotateY(i)); },
  honey(g) { g.add(mesh(cyl(0.061, 0.061, 0.04, 16, 1, true), mat('#fbf4e6', { side: THREE.DoubleSide }), 0, 0.05, 0)); for (let i = 0; i < 2; i++) g.add(mesh(capsule(0.006, 0.02), mat('#e8a317', { roughness: 0.15 }), (i ? 0.03 : -0.02), 0.085, 0.058)); },
  hotdog(g) { g.add(mesh(box(0.15, 0.005, 0.01), mat('#d62828'), 0, 0.077, 0.012)); for (let i = 0; i < 3; i++) dot(g, '#5db04a', 0.006, -0.04 + i * 0.04, 0.078, -0.008, 0); },
  soda(g) { g.add(mesh(rbox(0.02, 0.003, 0.012, 0.002), mat('#c3c8cf', { metalness: 0.8 }), 0.01, 0.131, 0), mesh(cyl(0.004, 0.004, 0.08, 6), mat('#ffffff'), -0.01, 0.16, 0), mesh(cyl(0.0355, 0.0355, 0.008, 18), mat('#ffffff'), 0, 0.09, 0)); },
  sushi(g) { const two = FOOD_MAKERS.sushi(); two.position.set(0.075, 0, 0.02); g.add(two); g.add(mesh(ball(0.012), mat('#7cb342'), -0.06, 0.01, 0.05)); },
  juice(g) { put(g, mesh(cyl(0.035, 0.035, 0.006, 12, 1, false, 0, Math.PI), mat('#f6a02c'), 0.045, 0.15, 0)).rotation.x = Math.PI / 2; },
  lemonade(g) { for (let i = 0; i < 2; i++) g.add(mesh(rbox(0.025, 0.025, 0.025, 0.005), mat('#e8f6fb', { transparent: true, opacity: 0.7 }), (i ? 0.012 : -0.01), 0.13, (i ? -0.01 : 0.01))); },
  milkshake(g) { for (let i = 0; i < 2; i++) g.add(mesh(new THREE.TorusGeometry(0.03 - i * 0.01, 0.012, 6, 14), mat('#ffffff'), 0, 0.22 + i * 0.015, 0).rotateX(Math.PI / 2)); for (let i = 0; i < 2; i++) g.add(mesh(box(0.008, 0.003, 0.003), mat(BRIGHT[i]), (i - 0.5) * 0.02, 0.245, 0.01)); },
  milk(g) { g.add(mesh(cyl(0.039, 0.039, 0.006, 16), mat('#ffffff'), 0, 0.135, 0)); },
  carrot(g) { for (let i = 0; i < 4; i++) g.add(mesh(new THREE.TorusGeometry(0.02 - i * 0.004, 0.002, 4, 10), mat('#d9771a'), 0, 0.02 - i * 0.03, 0).rotateX(Math.PI / 2)); },
  cheese(g) { for (let i = 0; i < 4; i++) dot(g, '#d9a32e', 0.008, (i - 1.5) * 0.02, 0.015 + (i % 2) * 0.012, -0.03 + i * 0.012); },
  drumstick(g) { for (let i = 0; i < 3; i++) dot(g, '#b86f35', 0.014, Math.cos(i * 2) * 0.035, 0.06 + (i - 1) * 0.02, Math.sin(i * 2) * 0.035); put(g, mesh(slab([[0, 0], [0.012, 0.02], [0, 0.04], [-0.012, 0.02]], 0.003), mat('#4c9a4a')), 0, 0.12, 0.02).rotation.x = -0.4; },
  icecream(g) { [[0.032, 0.015], [0.022, -0.02], [0.012, -0.05]].forEach(([r, y]) => g.add(mesh(new THREE.TorusGeometry(r, 0.003, 4, 16), mat('#b98340'), 0, y, 0).rotateX(Math.PI / 2))); g.add(mesh(capsule(0.008, 0.02), mat('#f7b7c9'), 0.04, 0.045, 0.02)); },
  potion(g) { g.add(mesh(rbox(0.05, 0.03, 0.005, 0.005), mat('#f4efe2'), 0, 0.05, 0.053)); for (let i = 0; i < 3; i++) dot(g, '#e6d8ff', 0.008 - i * 0.002, (i - 1) * 0.015, 0.06 + i * 0.015, 0.02); },
  bone(g) { for (let i = 0; i < 5; i++) dot(g, '#e2d8c2', 0.004, -0.05 + i * 0.025, 0.035, 0.012, 0); },
  cake(g) { for (let i = 0; i < 3; i++) dot(g, '#ffffff', 0.012, -0.04 + i * 0.04, 0.108, -0.06); for (let i = 0; i < 2; i++) g.add(mesh(box(0.012, 0.004, 0.004), mat('#4a2412'), -0.02 + i * 0.04, 0.106, -0.03).rotateY(i)); },
  pizza(g) {
    // the slice's tip is at z = 0.1 and it widens toward the crust at z = -0.1
    [[0.0, -0.06], [0.025, 0.0], [-0.035, -0.04]].forEach(([x, z]) => g.add(mesh(cyl(0.017, 0.017, 0.006, 12), mat('#b3261e'), x, 0.012, z)));
    [[0.0, -0.01], [-0.02, -0.07]].forEach(([x, z]) => g.add(mesh(new THREE.TorusGeometry(0.008, 0.003, 4, 8), mat('#1b1b1f'), x, 0.014, z).rotateX(Math.PI / 2)));
    put(g, mesh(slab([[0, 0], [0.01, 0.012], [0, 0.024], [-0.01, 0.012]], 0.002), mat('#2f8a3a'), 0.005, 0.015, 0.05)).rotation.x = -Math.PI / 2;
  },
  sandwich(g) { g.add(mesh(cyl(0.003, 0.003, 0.12, 4), mat('#e9d6a8'), 0, 0.09, 0), mesh(ball(0.01), mat('#3a6b2a'), 0, 0.15, 0)); for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.5; g.add(mesh(box(0.1, 0.03, 0.008), mat('#c98a3c'), Math.cos(a) * 0.05, 0.04, Math.sin(a) * 0.05).rotateY(-a + Math.PI / 2)); } },
  taco(g) { for (let i = 0; i < 3; i++) g.add(mesh(box(0.04, 0.004, 0.004), mat('#f6c02e'), (i - 1) * 0.03, 0.12, 0.01).rotateY(i)); g.add(mesh(ball(0.015), mat('#fbfbf7'), 0.02, 0.12, -0.01)); for (let i = 0; i < 2; i++) dot(g, '#7cb342', 0.012, (i ? 0.05 : -0.05), 0.11, 0.01); },
  pancakes(g) { for (let i = 0; i < 4; i++) dot(g, i % 2 ? '#3d5a80' : '#c1121f', 0.012, Math.cos(i * 1.6) * 0.05, 0.1, Math.sin(i * 1.6) * 0.05); for (let i = 0; i < 2; i++) g.add(mesh(capsule(0.006, 0.02), mat('#8a4a12', { roughness: 0.2 }), (i ? 0.07 : -0.065), 0.06, 0.02)); },
  bamboo(g) { for (let i = 0; i < 4; i++) put(g, mesh(box(0.025, 0.002, 0.1), mat('#4c9a4a'), 0.02 * (i % 2 ? 1 : -1), 0.12 + i * 0.03, 0)).rotation.set(0.3, i, (i % 2 ? -0.6 : 0.6)); for (let i = 0; i < 3; i++) g.add(mesh(new THREE.TorusGeometry(0.02, 0.003, 4, 10), mat('#6a9a3a'), 0, i * 0.105 - 0.1, 0).rotateX(Math.PI / 2)); },
  cookie(g) { for (let i = 0; i < 5; i++) dot(g, '#3b2412', 0.008, Math.cos(i * 1.3 + 0.4) * 0.025, Math.sin(i * 1.3 + 0.4) * 0.025, 0.009); for (let i = 0; i < 2; i++) dot(g, '#c98b4a', 0.006, 0.07 + i * 0.01, -0.02, 0, 0); },
  watermelon(g) { for (let i = 0; i < 5; i++) dot(g, '#1b1b1f', 0.005, (i - 2) * 0.03, 0.08 + (i % 2) * 0.015, 0.016); g.add(mesh(new THREE.TorusGeometry(0.115, 0.004, 4, 16, Math.PI), mat('#a7d36a')), mesh(new THREE.TorusGeometry(0.1, 0.003, 4, 16, Math.PI), mat('#f9a3a8'))); },
  noodles(g) {
    for (const s of [-1, 1]) put(g, mesh(cyl(0.004, 0.003, 0.24, 6), mat('#8b5a36'), 0.03 + s * 0.012, 0.15, 0.03)).rotation.z = 0.5;
    const part = g.userData.part;
    part.add(mesh(ball(0.022), mat('#fbfbf7'), 0.03, 0.012, -0.02), mesh(ball(0.012), mat('#f6c02e'), 0.03, 0.02, -0.012));
    for (let i = 0; i < 4; i++) part.add(mesh(cyl(0.006, 0.006, 0.004, 8), mat('#5db04a'), -0.03 + i * 0.015, 0.012, 0.03));
  },
  soup(g) { const part = g.userData.part; for (let i = 0; i < 3; i++) part.add(mesh(slab([[0, 0], [0.008, 0.01], [0, 0.02], [-0.008, 0.01]], 0.002), mat('#4c9a4a'), (i - 1) * 0.025, 0.012, 0.01).rotateX(-Math.PI / 2)); for (let i = 0; i < 2; i++) part.add(mesh(rbox(0.015, 0.015, 0.015, 0.003), mat('#e0b066'), (i ? 0.02 : -0.03), 0.014, -0.02)); },
  grass(g) { for (let i = 0; i < 6; i++) { const b = mesh(cone(0.025, 0.2 + (i % 3) * 0.04, 5), mat(i % 2 ? '#6aae45' : '#4c9a3a'), Math.cos(i * 1.1 + 0.3) * 0.04, 0.1, Math.sin(i * 1.1 + 0.3) * 0.04); b.rotation.set(Math.sin(i) * 0.2, 0, Math.cos(i) * 0.2); g.add(b); } g.add(mesh(cyl(0.004, 0.004, 0.2, 4), mat('#3f8f3f'), 0.05, 0.1, 0.03)); put(g, mesh(ball(0.025, 0), mat('#ffffff'), 0.05, 0.2, 0.03)).scale.y = 0.4; dot(g, '#f6c02e', 0.01, 0.05, 0.205, 0.03); },
  fries(g) { dot(g, '#d62828', 0.01, 0.09, 0.04, 0.02); for (let i = 0; i < 6; i++) { const f = mesh(box(0.013, 0.11, 0.013), mat('#f6c94a'), ((i % 3) - 1) * 0.022 + 0.01, 0.13, (i < 3 ? 0.012 : -0.012)); f.rotation.z = (i - 2.5) * 0.08; g.add(f); } g.add(mesh(rbox(0.03, 0.03, 0.002, 0.005), mat('#f2c230'), 0, 0.06, 0.026)); g.add(mesh(cyl(0.025, 0.02, 0.03, 12), mat('#fbfbfb'), 0.09, 0.015, 0.02), mesh(cyl(0.023, 0.023, 0.004, 12), mat('#d62828'), 0.09, 0.03, 0.02)); },
  grapes(g) { put(g, mesh(slab([[0, 0], [0.03, 0.02], [0.02, 0.05], [0, 0.04], [-0.02, 0.05], [-0.03, 0.02]], 0.003), mat('#4c9a4a'), 0.02, 0.06, 0)).rotation.x = -0.3; [[-0.5, 0.5], [0.5, 0.5], [-1, -0.5], [1, -0.5], [-0.5, -1.5], [0.5, -1.5], [0, -0.5], [-1.5, 0], [1.5, 0]].forEach(([x, y]) => dot(g, '#7b3aa5', 0.019, x * 0.026, y * 0.03, -0.018)); },
  salad(g) { const part = g.userData.part; for (let i = 0; i < 4; i++) part.add(mesh(cyl(0.015, 0.015, 0.004, 10), mat('#e2412f'), Math.cos(i * 1.6) * 0.03, 0.025, Math.sin(i * 1.6) * 0.03)); for (let i = 0; i < 3; i++) part.add(mesh(rbox(0.012, 0.012, 0.012, 0.003), mat('#e0b066'), (i - 1) * 0.025, 0.03, 0.04)); for (let i = 0; i < 3; i++) part.add(mesh(cyl(0.012, 0.012, 0.004, 10), mat('#b5d98a'), (i - 1) * 0.03, 0.028, -0.04)); },
  cereal(g) { const part = g.userData.part; for (let i = 0; i < 8; i++) part.add(mesh(new THREE.TorusGeometry(0.009, 0.004, 4, 8), mat(BRIGHT[(i + 3) % 7]), Math.cos(i * 0.9 + 0.3) * 0.035, 0.014, Math.sin(i * 0.9 + 0.3) * 0.035)); g.add(buildSpoon()); g.children[g.children.length - 1].position.set(0.05, 0.1, 0); for (let i = 0; i < 2; i++) dot(g, '#ffffff', 0.006, (i ? 0.06 : -0.06), 0.09, 0.02); },
  donut(g) { for (let i = 0; i < 12; i++) g.add(mesh(box(0.012, 0.004, 0.004), mat(BRIGHT[(i + 2) % 7]), Math.cos(i * 0.52 + 0.26) * 0.065, Math.sin(i * 0.52 + 0.26) * 0.065, 0.032).rotateZ(i)); },
  hamburger(g) {
    for (let i = 0; i < 2; i++) g.add(mesh(cyl(0.025, 0.025, 0.006, 12), mat('#6a9a3a'), (i ? 0.04 : -0.035), 0.094, (i ? 0.02 : -0.03)));
    g.add(mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 16), mat('#fbf4e6'), 0, 0.092, 0).rotateX(Math.PI / 2));
    for (let i = 0; i < 5; i++) dot(g, '#fff7e0', 0.006, Math.cos(i * 1.3 + 0.7) * 0.07, 0.125, Math.sin(i * 1.3 + 0.7) * 0.07);
    for (let i = 0; i < 2; i++) g.add(mesh(capsule(0.006, 0.015), mat('#d62828'), (i ? 0.05 : -0.06), 0.05, 0.085));
    g.add(mesh(cyl(0.003, 0.003, 0.12, 4), mat('#e9d6a8'), 0, 0.16, 0), mesh(ball(0.01), mat('#3a6b2a'), 0, 0.22, 0));
    g.add(mesh(new THREE.TorusGeometry(0.11, 0.008, 4, 20), mat('#7cc356'), 0, 0.078, 0).rotateX(Math.PI / 2));
  },
  seeds(g) { for (let i = 0; i < 14; i++) dot(g, i % 2 ? '#c9a24a' : '#6b4a2b', 0.01, Math.cos(i * 2.4 + 1) * 0.06 * Math.sqrt((i + 0.5) / 14), 0.008, Math.sin(i * 2.4 + 1) * 0.06 * Math.sqrt((i + 0.5) / 14), 0); },
  popcorn(g) { for (let i = 0; i < 12; i++) dot(g, '#fff8dc', 0.016, Math.cos(i * 0.9) * 0.035, 0.14 + (i % 3) * 0.012, Math.sin(i * 0.9) * 0.035, 0); for (let i = 0; i < 5; i++) dot(g, '#f6c02e', 0.008, Math.cos(i * 1.3) * 0.02, 0.16, Math.sin(i * 1.3) * 0.02); },
  water(g) { g.add(mesh(cyl(0.039, 0.039, 0.004, 16), mat('#e8f6fb', { transparent: true, opacity: 0.6 }), 0, 0.125, 0)); },
};
function buildFood(kind) {
  const g = (FOOD_MAKERS[kind] || FOOD_MAKERS.sandwich)();
  if (FOOD_DETAIL[kind]) FOOD_DETAIL[kind](g);
  g.userData.kind = kind;
  if (!g.userData.part && !g.userData.drink) {             // shrink the whole thing as it is eaten
    const inner = new THREE.Group();
    while (g.children.length) inner.add(g.children[0]);
    g.add(inner);
    g.userData.part = inner;
  }
  g.traverse((m) => { if (m.isMesh) m.castShadow = false; });
  return g;
}
function buildSpoon() {
  const g = new THREE.Group(), steel = mat('#d9dee6', { metalness: 0.85, roughness: 0.25 });
  g.add(mesh(box(0.012, 0.004, 0.13), steel, 0, 0, -0.06));
  const bowl = mesh(ball(0.022), steel, 0, 0, 0.02);
  bowl.scale.set(1, 0.35, 1.4);
  g.add(bowl);
  return g;
}

// ---- weapons ---------------------------------------------------------------
// Held in the hand and pointing along the forearm; userData.marker sits at the tip.
function buildWeapon(kind) {
  const g = new THREE.Group();
  const steel = mat('#d9dee6', { metalness: 0.85, roughness: 0.25 }), wood = mat('#6b4a2b');
  const gold = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 });
  let tip = 1.0;
  if (kind === 'sword') {
    g.add(mesh(cyl(0.022, 0.022, 0.16, 8), wood, 0, 0.03, 0), mesh(box(0.24, 0.04, 0.06), gold, 0, -0.06, 0));
    g.add(mesh(box(0.085, 0.86, 0.025), steel, 0, -0.5, 0));
    put(g, mesh(cone(0.043, 0.12, 4), steel, 0, -0.99, 0)).rotation.x = Math.PI;
    tip = 1.03;
  } else if (kind === 'axe') {
    g.add(mesh(cyl(0.024, 0.024, 0.95, 8), wood, 0, -0.42, 0), mesh(box(0.03, 0.2, 0.24), steel, 0, -0.82, 0.1));
    tip = 0.9;
  } else if (kind === 'club') {
    g.add(mesh(cyl(0.12, 0.035, 0.85, 10), mat('#7a5230'), 0, -0.4, 0));
    for (let i = 0; i < 5; i++) put(g, mesh(cone(0.03, 0.08, 6), mat('#c3c8cf'), Math.cos(i * 1.3) * 0.1, -0.6 - (i % 3) * 0.08, Math.sin(i * 1.3) * 0.1)).rotation.z = Math.cos(i * 1.3) * -1.4;
    tip = 0.85;
  } else if (kind === 'staff') {
    g.add(mesh(cyl(0.02, 0.025, 1.4, 8), wood, 0, -0.42, 0), mesh(ball(0.075), glow('#b388ff', 2.2), 0, -1.15, 0));
    tip = 1.15;
  } else if (kind === 'blaster') {
    g.add(mesh(box(0.07, 0.07, 0.12), mat('#3a3d44', { metalness: 0.6, roughness: 0.4 }), 0, -0.04, -0.04));
    g.add(mesh(cyl(0.025, 0.03, 0.26, 10), mat('#c3c8cf', { metalness: 0.8, roughness: 0.3 }), 0, -0.18, 0), mesh(ball(0.03), glow('#ff4d4d', 2), 0, -0.32, 0));
    tip = 0.33;
  }
  const marker = new THREE.Object3D();
  marker.position.y = -tip;
  g.add(marker);
  g.userData = { marker, length: tip, kind };
  return g;
}

// ---- reaching --------------------------------------------------------------
// Two-bone reach: put an arm's hand at (tx, ty, tz) in the body's own space.
function armTo(arm, tx, ty, tz) {
  const P = arm.position, u = arm.userData, L1 = u.L1, L2 = u.L2;
  const dx = tx - P.x, dy = ty - P.y, dz = tz - P.z;
  const h = Math.hypot(dx, dz), r = clamp(Math.hypot(h, dy), 0.08, L1 + L2 - 1e-3);
  const line = Math.atan2(-h, -dy);
  const beta = Math.acos(clamp((L1 * L1 + r * r - L2 * L2) / (2 * L1 * r), -1, 1));
  const gamma = Math.acos(clamp((L1 * L1 + L2 * L2 - r * r) / (2 * L1 * L2), -1, 1));
  arm.rotation.set(line + beta, Math.atan2(dx, dz), 0);
  u.elbow.rotation.set(-(Math.PI - gamma), 0, 0);
}
// Where the hand is, for a pose with no sideways tilt (rotation.z = 0).
function handAt(arm, out) {
  const u = arm.userData, a = arm.rotation.x, e = u.elbow.rotation.x, yaw = arm.rotation.y;
  const y = -u.L1 * Math.cos(a) - u.L2 * Math.cos(a + e);
  const f = -u.L1 * Math.sin(a) - u.L2 * Math.sin(a + e);
  return out.set(arm.position.x + f * Math.sin(yaw), arm.position.y + y, arm.position.z + f * Math.cos(yaw));
}
function setArm(arm, x, elbow, yaw = 0, z = 0) {
  arm.rotation.set(x, yaw, z);
  if (arm.userData.elbow) arm.userData.elbow.rotation.set(elbow, 0, 0);
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const bb = g.children[0];
  ['#2a9d8f', '#f28c38', '#8d5fd3'].forEach((c, i) => bb.add(mesh(new THREE.SphereGeometry(0.456, 16, 12, i * 2.1 + 1.05, 0.5), mat(c))));
  bb.add(mesh(cyl(0.03, 0.03, 0.04, 8), mat('#ffffff'), 0, 0.45, 0));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const kk = g.children[0], tl = g.children[2];
  kk.add(mesh(box(0.02, 1.3, 20), _w), mesh(box(1.0, 0.02, 20), _w));
  for (let i = 0; i < 3; i++) put(tl, mesh(box(0.22, 0.08, 0.02), mat(BRIGHT[i]), 0, 0.3 - i * 0.35, 0)).rotation.z = 0.4;
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const pole = g.children[0];
  g.add(mesh(cone(0.04, 0.15, 8), mat('#e9e9e9'), 0, 2.68, 0));
  for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; put(g, mesh(cyl(0.008, 0.008, 1.55, 4), mat('#e9e9e9'), Math.sin(a) * 0.75, 2.3, Math.cos(a) * 0.75)).rotation.set(Math.cos(a) * 1.22, 0, -Math.sin(a) * 1.22); }
  g.add(mesh(new THREE.TorusGeometry(1.5, 0.015, 4, 32), mat('#ffffff'), 0, 2.08, 0).rotateX(Math.PI / 2));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  ['#e63946', '#2a9d8f'].forEach((c, i) => g.add(mesh(box(0.02, 0.005, 0.2), mat(c), 0.12 + i * 0.05, 0.03 + 4 * 0.115, 0.14)));
  const open = new THREE.Group();
  for (const s of [-1, 1]) put(open, mesh(box(0.28, 0.02, 0.38), mat('#f4efe2'), s * 0.14, 0.02, 0)).rotation.z = s * 0.12;
  open.add(mesh(box(0.6, 0.01, 0.42), mat('#3d5a80'), 0, 0, 0));
  open.position.set(0.8, 0, 0.2);
  g.add(open);
  for (const s of [-1, 1]) g.add(mesh(new THREE.TorusGeometry(0.05, 0.008, 4, 12), _d, 0.75 + s * 0.06, 0.04, -0.3).rotateX(Math.PI / 2));
  g.add(mesh(box(0.06, 0.006, 0.006), _d, 0.75, 0.04, -0.3));
  g.add(mesh(box(0.03, 0.12, 0.03), mat('#f2c230'), 0.35, 0.06, -0.1), mesh(cone(0.02, 0.04, 6), mat('#e8a3a3'), 0.35, 0.14, -0.1));   // a pencil
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(box(0.1, 0.2, 0.1), mat('#5d3b22'), sx * 0.7, 0.1, sz * 1.1));
  const p2 = mesh(ball(0.28), mat('#fbfbfb'), 0.35, 0.74, -0.8);
  p2.scale.set(1.3, 0.38, 0.75);
  g.add(p2, mesh(rbox(1.44, 0.06, 0.2, 0.03), mat('#f4f4f4'), 0, 0.74, -0.25));
  return g;
}
function sofa(R) {
  const g = new THREE.Group(), c = mat(BRIGHT[Math.floor(R() * 7)], { roughness: 0.95 });
  g.add(mesh(box(2.2, 0.4, 0.9), c, 0, 0.4, 0));
  g.add(mesh(box(2.2, 0.7, 0.25), c, 0, 0.85, -0.35));
  for (const s of [-1, 1]) g.add(mesh(box(0.25, 0.55, 0.9), c, s * 1.1, 0.6, 0));
  for (const s of [-1, 1]) g.add(mesh(box(0.9, 0.14, 0.7), mat('#f4efe2'), s * 0.5, 0.66, 0.05));
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const fabric = mat(mix('#8d5fd3', '#ffffff', 0.15), { roughness: 0.95 });
  for (const s of [-1, 1]) g.add(mesh(rbox(0.95, 0.5, 0.18, 0.08), fabric, s * 0.5, 0.95, -0.22));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(cyl(0.04, 0.03, 0.2, 8), _w, sx * 1.0, 0.1, sz * 0.35));
  return g;
}
function tv() {
  const g = new THREE.Group(), dark = mat('#1b1d22');
  g.add(mesh(box(1.6, 0.5, 0.45), mat('#7a5230'), 0, 0.25, 0));
  g.add(mesh(box(1.5, 0.9, 0.07), dark, 0, 1.05, 0));
  g.add(mesh(box(1.4, 0.8, 0.02), glow('#6ec5ff', 1.3), 0, 1.05, 0.04));
  g.add(mesh(box(0.4, 0.12, 0.2), dark, 0, 0.56, 0));
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (const s of [-1, 1]) put(g, mesh(cyl(0.01, 0.01, 0.6, 4), _d, s * 0.15, 1.75, -0.02)).rotation.z = s * 0.5;
  for (let i = 0; i < 2; i++) g.add(mesh(cyl(0.02, 0.02, 0.02, 8), _d, 0.55 + i * 0.08, 0.62, 0.04).rotateX(Math.PI / 2));
  for (const s of [-1, 1]) g.add(mesh(box(0.06, 0.2, 0.06), mat('#5d3b22'), s * 0.7, -0.08, 0.15));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2; g.add(mesh(box(0.025, 0.025, 0.01), _d, Math.sin(a) * 0.19, 1.8 + Math.cos(a) * 0.19, 0.235)); }
  g.add(mesh(cone(0.38, 0.2, 4), mat('#6b4226'), 0, 2.4, 0).rotateY(Math.PI / 4), mesh(rbox(0.5, 0.5, 0.02, 0.02), mat('#d9c38a', { transparent: true, opacity: 0.4 }), 0, 1.0, 0.21));
  for (const s of [-1, 1]) g.add(mesh(ball(0.05), _w, s * 0.25, 0.0, 0.15));
  return g;
}
function door(R) {
  const g = new THREE.Group();
  g.add(mesh(box(1.3, 2.3, 0.14), mat('#e9e4d8'), 0, 1.15, 0));
  const leaf = pivot(g, -0.5, 0, 0.08);
  leaf.add(mesh(box(1.0, 2.05, 0.07), mat(BRIGHT[Math.floor(R() * 7)]), 0.5, 1.03, 0));
  leaf.add(mesh(ball(0.05), metal('#d9b23a'), 0.88, 1.0, 0.06));
  leaf.rotation.y = -0.5;
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const leafP = g.children[1];
  for (const y of [0.55, 1.5]) leafP.add(mesh(rbox(0.75, 0.7, 0.03, 0.02), mat('#ffffff', { transparent: true, opacity: 0.25 }), 0.5, y, 0.05));
  for (const y of [0.3, 1.8]) g.add(mesh(cyl(0.025, 0.025, 0.15, 6), _au, -0.5, y, 0.1));
  g.add(mesh(box(1.4, 0.1, 0.4), _st, 0, 0.05, 0.2), mesh(box(0.25, 0.05, 0.02), _au, 0, 1.4, 0.12));
  return g;
}
function ladder() {
  const g = new THREE.Group(), wood = mat('#b08a5a');
  for (const s of [-1, 1]) g.add(mesh(box(0.07, 3.2, 0.07), wood, s * 0.3, 1.6, 0));
  for (let i = 0; i < 8; i++) g.add(mesh(box(0.6, 0.05, 0.05), wood, 0, 0.3 + i * 0.38, 0));
  g.rotation.x = -0.25;
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const woodL = mat('#b08a5a');
  for (let i = 0; i < 4; i++) g.add(mesh(cyl(0.02, 0.02, 0.62, 6), woodL, 0, 0.49 + i * 0.76, 0).rotateZ(Math.PI / 2));
  for (const s of [-1, 1]) g.add(mesh(box(0.09, 0.05, 0.09), _d, s * 0.3, 0.02, 0));
  g.add(mesh(cyl(0.12, 0.1, 0.22, 12), mat('#2a9d8f'), 0.0, 3.3, -0.2), mesh(cyl(0.12, 0.12, 0.02, 12), mat('#f2c230'), 0.0, 3.41, -0.2));
  for (const s of [-1, 1]) put(g, mesh(box(0.04, 1.4, 0.04), woodL, s * 0.3, 0.9, -0.35)).rotation.x = 0.35;
  return g;
}
function mailbox() {
  const g = new THREE.Group();
  g.add(mesh(box(0.1, 1.1, 0.1), mat('#6b4a2b'), 0, 0.55, 0));
  const b = mesh(cyl(0.2, 0.2, 0.55, 14), mat('#c62828', { roughness: 0.4 }), 0, 1.25, 0);
  b.rotation.x = Math.PI / 2;
  g.add(b, mesh(box(0.4, 0.2, 0.55), mat('#c62828', { roughness: 0.4 }), 0, 1.15, 0));
  g.add(mesh(box(0.03, 0.3, 0.12), mat('#f2c230'), 0.22, 1.4, 0.1));
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  g.add(mesh(cyl(0.22, 0.22, 0.02, 14), mat('#a51f1f'), 0, 1.25, 0.28).rotateX(Math.PI / 2));
  g.add(mesh(box(0.25, 0.08, 0.25), _w, 0, 0.04, 0), mesh(rbox(0.12, 0.08, 0.01, 0.01), mat('#ffffff'), 0, 1.1, 0.29));
  g.add(mesh(box(0.1, 0.1, 0.1), _w, 0, 0.7, 0));
  return g;
}
function trashcan() {
  const g = new THREE.Group();
  g.add(mesh(cyl(0.36, 0.3, 0.95, 16), metal('#8a9099'), 0, 0.48, 0));
  g.add(mesh(cyl(0.39, 0.39, 0.08, 16), metal('#6d737c'), 0, 1.0, 0));
  g.add(mesh(box(0.2, 0.06, 0.06), metal('#6d737c'), 0, 1.07, 0));
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (const y of [0.25, 0.55, 0.85]) put(g, mesh(new THREE.TorusGeometry(0.34 - y * 0.05, 0.015, 4, 20), _fe, 0, y, 0)).rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) put(g, mesh(new THREE.TorusGeometry(0.06, 0.012, 4, 10, Math.PI), _fe, s * 0.37, 0.8, 0)).rotation.y = Math.PI / 2;
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.18, 12, 1, true, -Math.PI / 2, Math.PI), mat('#24272d', { side: THREE.DoubleSide }), 0, 3.82 - i * 0.35, 0.25).rotateX(Math.PI / 2));
  g.add(mesh(rbox(0.6, 1.3, 0.05, 0.04), mat('#f2c230'), 0, 3.4, -0.2), mesh(cyl(0.18, 0.22, 0.12, 12), mat('#24272d'), 0, 0.06, 0));
  return g;
}
function stopsign() {
  const g = new THREE.Group();
  g.add(mesh(cyl(0.05, 0.05, 2.4, 8), metal(), 0, 1.2, 0));
  const sign = mesh(cyl(0.42, 0.42, 0.05, 8), mat('#d62828', { roughness: 0.5 }), 0, 2.5, 0.04);
  sign.rotation.set(Math.PI / 2, Math.PI / 8, 0);
  g.add(sign, mesh(box(0.5, 0.12, 0.02), mat('#ffffff'), 0, 2.5, 0.08));
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  put(g, mesh(new THREE.TorusGeometry(0.4, 0.02, 4, 8), mat('#ffffff'), 0, 2.5, 0.07)).rotation.z = Math.PI / 8;
  for (const y of [2.3, 2.7]) g.add(mesh(cyl(0.02, 0.02, 0.03, 6), _fe, 0, y, 0.08).rotateX(Math.PI / 2));
  g.add(mesh(cyl(0.12, 0.14, 0.1, 10), _fe, 0, 0.05, 0));
  return g;
}
function hydrant() {
  const g = new THREE.Group(), red = mat('#d62828', { roughness: 0.45 });
  g.add(mesh(cyl(0.2, 0.24, 0.75, 14), red, 0, 0.38, 0), mesh(ball(0.21), red, 0, 0.78, 0));
  g.add(mesh(cyl(0.28, 0.28, 0.07, 14), red, 0, 0.05, 0));
  const arm = mesh(cyl(0.08, 0.08, 0.6, 10), red, 0, 0.5, 0);
  arm.rotation.z = Math.PI / 2;
  g.add(arm);
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (const s of [-1, 1]) put(g, mesh(cyl(0.07, 0.07, 0.06, 10), _au, s * 0.32, 0.5, 0)).rotation.z = Math.PI / 2;
  for (let i = 0; i < 3; i++) { const a = i * 2.1; g.add(mesh(cyl(0.02, 0.02, 0.05, 6), _au, Math.cos(a) * 0.12, 0.98, Math.sin(a) * 0.12)); }
  g.add(mesh(lathe([[0.001, 0], [0.08, 0.02], [0.05, 0.1], [0.001, 0.12]], 10), mat('#d62828'), 0, 0.95, 0));
  put(g, mesh(new THREE.TorusGeometry(0.08, 0.008, 4, 10, Math.PI), _fe, 0.2, 0.42, 0)).rotation.x = Math.PI / 2;
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const steelS = mat('#3d5a80', { metalness: 0.75, roughness: 0.3 });
  for (const s of [-1, 1]) g.add(mesh(ball(0.08), steelS, s * 1.4, 2.7, 0), mesh(box(0.05, 0.05, 1.1), steelS, s * 1.32, 0.6, 0));
  g.add(mesh(box(2.4, 0.05, 1.2), mat('#c2a272', { roughness: 1 }), 0, 0.02, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(cyl(0.09, 0.09, 0.05, 8), _d, sx * 1.3 + sx * 0.25, 0.03, sz * 1.0));
  for (const x of [-0.6, 0.6]) for (const k of [-1, 1]) g.add(mesh(cyl(0.025, 0.025, 0.06, 6), steelS, x + k * 0.22, 2.7, 0));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const steelL = mat('#3d5a80', { metalness: 0.75, roughness: 0.3 });
  for (const s of [-1, 1]) g.add(mesh(cyl(0.03, 0.03, 0.8, 6), steelL, s * 0.38, 2.45, -0.6), mesh(tube([[s * 0.3, 1.2, -0.62], [s * 0.36, 2.1, -0.62], [s * 0.36, 2.4, -0.3]], 0.02, 8, 4), steelL));
  g.add(mesh(box(1.4, 0.04, 3.2), mat('#c2a272', { roughness: 1 }), 0, 0.02, 0.4));
  g.add(mesh(cone(0.6, 0.5, 4), mat('#e63946'), 0, 3.15, -0.4).rotateY(Math.PI / 4));
  for (const s of [-1, 1]) g.add(mesh(cyl(0.025, 0.025, 0.9, 6), steelL, s * 0.38, 2.5, -0.15));
  for (const s of [-1, 1]) g.add(mesh(box(0.06, 0.06, 0.4), steelL, s * 0.36, 0.25, 1.95));
  g.add(mesh(rbox(0.7, 0.06, 0.25, 0.03), mat('#f2c230'), 0, 0.15, 2.05));
  g.add(mesh(ball(0.05), mat('#e63946'), 0, 3.42, -0.4));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const dk = mat('#c9a96a');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(box(0.08, 0.14, 0.02), dk, sx * 0.8, 0.55, sz * 0.8 + sz * 0.3));
  g.add(mesh(rbox(0.25, 0.3, 0.05, 0.05), dk, 0, 0.18, 0.81));
  for (let i = 0; i < 4; i++) g.add(mesh(dome(0.07, 0.5), mat(['#fbe3d6', '#f7c9a9', '#ffffff', '#e8c3d6'][i]), -1.3 + i * 0.25, 0, 1.2));
  put(g, mesh(new THREE.TorusGeometry(1.5, 0.12, 4, 24), mat('#6cb4d9', { roughness: 0.2 }), 0, 0.02, 0)).rotation.x = Math.PI / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(g, mesh(slab([[0, 0], [0.18, 0.06], [0, 0.12]], 0.01), mat(BRIGHT[(sx + sz + 4) % 7], { side: THREE.DoubleSide }), sx * 0.8, 1.4, sz * 0.8)).rotation.y = 0.5;
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  g.add(mesh(dome(0.6, 0.5), mat('#e2c58a'), 0, -0.05, 0));
  for (const x of [-0.4, 0.4]) g.add(mesh(slab([[0, 0], [0.1, 0], [0, 0.14]], 0.01), _d, x, 0.2, -0.05), mesh(box(0.04, 1.6, 0.04), mat('#ffffff'), x, 1.1, 0.06));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const steelW = mat('#d9dee6', { metalness: 0.75, roughness: 0.3 }), wv = g.children.find((c) => c.isGroup && c.children.length > 10);
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 + Math.PI / 10;
    const spoke = mesh(cyl(0.03, 0.03, 6, 6), steelW, Math.cos(a) * 3, Math.sin(a) * 3, 0.5);
    spoke.rotation.z = a - Math.PI / 2;
    wv.add(spoke, mesh(ball(0.12), glow(BRIGHT[i % 7], 1.6), Math.cos(a) * 6, Math.sin(a) * 6, 0.55));
    wv.add(mesh(ball(0.1), glow('#fff3b0', 1.6), Math.cos(a) * 4, Math.sin(a) * 4, 0.55));
  }
  g.add(mesh(rbox(2.5, 0.3, 2.2, 0.08), mat('#9a9da3'), 0, 0.15, 0));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  g.add(mesh(cyl(0.035, 0.035, 0.12, 8), _d, 0, 2.1, -0.15), mesh(ball(0.08), _d, 0, 1.6, 0.2));
  put(g, mesh(new THREE.TorusGeometry(0.11, 0.015, 6, 14), _au, 0, 1.95, 0.75)).rotation.x = 0.97;
  put(g, mesh(cyl(0.025, 0.025, 0.45, 8), mat('#f4f4f4'), 0.12, 1.72, 0.25)).rotation.x = Math.PI / 2 - 0.6;
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  g.add(mesh(cyl(0.75, 0.75, 0.03, 24), mat('#fbfbfb', { roughness: 0.3 }), 0, 0.77, 0));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.add(mesh(ball(0.035), mat('#fff3e0'), Math.cos(a) * 0.45, 1.1, Math.sin(a) * 0.45)); }
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; g.add(mesh(ball(0.04), mat('#c1121f'), Math.cos(a) * 0.3, 1.36, Math.sin(a) * 0.3)); }
  g.add(mesh(box(0.06, 0.01, 0.35), mat('#d9dee6', { metalness: 0.8, roughness: 0.25 }), 0.55, 0.8, 0.45), mesh(box(0.05, 0.02, 0.12), mat('#5d3b22'), 0.55, 0.8, 0.68));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  g.children.filter((c) => c.geometry && c.geometry.type === 'BoxGeometry' && c.geometry.parameters.width === c.geometry.parameters.height).forEach((bx, i) => {
    const k = bx.geometry.parameters.width;
    g.add(mesh(rbox(k * 0.25, k * 0.15, 0.01, 0.01), mat('#fbfbf7'), bx.position.x + k * 0.25, bx.position.y, bx.position.z + k / 2 + 0.006));
    for (const s of [-1, 1]) put(g, mesh(new THREE.TorusGeometry(k * 0.12, k * 0.03, 4, 10), mat(i % 2 ? '#f5c542' : '#ffffff'), bx.position.x + s * k * 0.12, bx.position.y + k / 2 + k * 0.08, bx.position.z)).rotation.y = Math.PI / 2;
  });
  for (let i = 0; i < 4; i++) g.add(mesh(box(0.04, 0.005, 0.04), mat(BRIGHT[i + 2]), -0.6 + i * 0.4, 0.01, 0.8).rotateY(i));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.TorusGeometry(1.15 - i * 0.3, 0.025, 4, 28), mat(i % 2 ? '#f5c542' : '#e9e9e9', { metalness: 0.6, roughness: 0.3 }), 0, 1.2 + i * 0.8, 0).rotateX(Math.PI / 2 - 0.15));
  ['#e63946', '#2a9d8f', '#f2c230', '#8d5fd3'].forEach((c, i) => g.add(mesh(rbox(0.35, 0.3, 0.35, 0.04), mat(c), Math.cos(i * 1.6) * 1.2, 0.15, Math.sin(i * 1.6) * 1.2)));
  for (let i = 0; i < 22; i++) {
    const y = 0.8 + (i / 22) * 2.6, r = (1.25 - (y - 0.5) * 0.33) * 1.0, a = i * 2.4 + 0.7;
    g.add(mesh(ball(0.06), mat(BRIGHT[(i + 3) % 7], { metalness: 0.5, roughness: 0.2 }), Math.cos(a) * r, y, Math.sin(a) * r));
  }
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (const y of [0.08, 0.2, 0.32]) put(g, mesh(new THREE.TorusGeometry(0.47 - y * 0.25, 0.015, 4, 20), mat('#a07740'), 0, y, 0)).rotation.x = Math.PI / 2;
  g.add(mesh(rbox(0.5, 0.02, 0.5, 0.01), mat('#e63946'), 0, 0.46, 0).rotateY(0.6));
  for (let i = 0; i < 4; i++) put(g, mesh(slab([[0, 0], [0.04, 0.05], [0, 0.1], [-0.04, 0.05]], 0.005), mat('#4c9a4a'), Math.cos(i) * 0.2, 0.58, Math.sin(i) * 0.2)).rotation.x = -0.8;
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (let i = 0; i < 6; i++) {
    const st = mesh(box(0.01, 0.01, 0.4), mat('#e6c25a'), (R() - 0.3) * 1.6, 0.03, (R() - 0.5) * 1.2);
    st.rotation.y = R() * 3;
    g.add(st);
  }
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(box(0.06, 0.25, 0.06), mat('#5d3b22'), sx * 0.38, -0.05, sz * 0.38));
  for (let i = 0; i < 4; i++) { const a = i * 1.6 + 0.4; g.add(mesh(cyl(0.01, 0.01, 0.3, 4), mat('#3f8f3f'), Math.cos(a) * 1.0, 0.15, Math.sin(a) * 1.0), mesh(ball(0.06, 0), mat(BRIGHT[i]), Math.cos(a) * 1.0, 0.3, Math.sin(a) * 1.0)); }
  for (let i = 0; i < 2; i++) g.add(mesh(capsule(0.02, 0.06), mat('#e8a317', { roughness: 0.2 }), -0.15 + i * 0.3, 0.6, 0.38));
  g.add(mesh(box(0.25, 0.03, 0.12), mat('#8b5a36'), 0, 0.78, 0.45), mesh(dome(0.18, 0.5), mat('#c99a3a'), 0, 1.55, 0), mesh(cyl(0.02, 0.02, 0.15, 6), mat('#8b5a36'), 0, 1.7, 0));
  return g;
}
function piano() {
  const g = new THREE.Group(), black = mat('#15161a', { roughness: 0.2, metalness: 0.3 });
  g.add(mesh(box(1.7, 1.1, 0.6), black, 0, 0.75, -0.15), mesh(box(1.7, 0.1, 0.4), black, 0, 0.72, 0.3));
  g.add(mesh(box(1.55, 0.04, 0.3), mat('#fbfbf5'), 0, 0.79, 0.32));
  for (let i = 0; i < 10; i++) g.add(mesh(box(0.07, 0.05, 0.18), black, -0.68 + i * 0.15 + (i % 3 === 2 ? 0.04 : 0), 0.82, 0.27));
  for (const s of [-1, 1]) g.add(mesh(box(0.1, 0.7, 0.1), black, s * 0.78, 0.35, 0.42));
  g.add(mesh(box(0.7, 0.08, 0.35), black, 0, 0.5, 0.95), mesh(box(0.08, 0.5, 0.08), black, 0, 0.25, 0.95));
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const ivory = mat('#fbfbf5'), ebony = mat('#15161a', { roughness: 0.2, metalness: 0.3 });
  for (let i = 0; i < 10; i++) g.add(mesh(box(0.13, 0.02, 0.28), ivory, -0.7 + i * 0.155, 0.805, 0.32));
  for (let i = 0; i < 3; i++) g.add(mesh(box(0.06, 0.02, 0.12), mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), (i - 1) * 0.12, 0.05, 0.35));
  g.add(mesh(box(0.9, 0.04, 0.12), ebony, 0, 1.25, 0.12).rotateX(-0.3), mesh(box(0.7, 0.4, 0.01), ivory, 0, 1.43, 0.16).rotateX(-0.3));
  for (const s of [-1, 1]) g.add(mesh(cyl(0.02, 0.03, 0.2, 8), mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), s * 0.6, 1.4, 0.05), mesh(ball(0.03), glow('#ffcc66', 2), s * 0.6, 1.53, 0.05));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const chromeD = mat('#d9dee6', { metalness: 0.85, roughness: 0.2 });
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; g.add(mesh(box(0.04, 0.4, 0.04), chromeD, Math.cos(a) * 0.5, 0.5, Math.sin(a) * 0.5 * 0.1 + 0.0)); }
  for (const s of [-1, 1]) put(g, mesh(cyl(0.012, 0.008, 0.4, 6), mat('#e9d6a8'), s * 0.15, 1.3, 0.2)).rotation.z = s * 0.6;
  g.add(mesh(cyl(0.2, 0.2, 0.015, 16), chromeD, -0.9, 1.0, 0.3), mesh(cyl(0.2, 0.2, 0.015, 16), chromeD, -0.9, 1.03, 0.3), mesh(cyl(0.015, 0.015, 1.0, 6), chromeD, -0.9, 0.5, 0.3));
  g.add(mesh(rbox(0.5, 0.06, 0.5, 0.03), mat('#2b2e35'), 0, 0.03, -0.6));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (let i = 0; i < 4; i++) g.add(mesh(box(0.004, 1.15, 0.004), mat('#e9e9e9'), (i - 1.5) * 0.016, 1.05, 0.05));
  for (let i = 0; i < 4; i++) g.add(mesh(cyl(0.012, 0.012, 0.05, 6), _au, (i % 2 ? 0.07 : -0.07), 1.76 + (i < 2 ? 0 : 0.07), 0.02).rotateZ(Math.PI / 2));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (let i = 0; i < 3; i++) put(g, mesh(cyl(0.008, 0.008, 0.22, 6), _w, -0.2 + i * 0.12, 0.98, 0.12)).rotation.z = 1.4;
  const pal = mesh(cyl(0.18, 0.18, 0.015, 16), mat('#d9b38a'), 0.7, 0.9, 0.3);
  pal.rotation.x = -0.6;
  g.add(pal);
  for (let i = 0; i < 4; i++) g.add(mesh(ball(0.025), mat(BRIGHT[i]), 0.7 + Math.cos(i * 1.5) * 0.1, 0.92 + Math.sin(i * 1.5) * 0.06, 0.3 - Math.sin(i * 1.5) * 0.06));
  g.add(mesh(cyl(0.18, 0.18, 0.04, 12), _w, -0.8, 0.5, 0.3));
  for (let i = 0; i < 2; i++) g.add(mesh(cyl(0.02, 0.02, 0.5, 6), _w, -0.8 + (i ? 0.1 : -0.1), 0.25, 0.3));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const wv = g.children[2];
  for (let i = 0; i < 4; i++) { const land = mesh(ball(0.1 + i * 0.02), mat('#4f9a4a')); land.position.setFromSphericalCoords(0.42, 1 + i * 0.4, i * 1.6 + 0.8); wv.add(land); }
  put(g, mesh(new THREE.TorusGeometry(0.52, 0.015, 6, 28, Math.PI), _au, 0, 1.4, 0)).rotation.z = 0.4 - Math.PI / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(ball(0.06), mat('#5d3b22'), sx * 0.35, 0.0, sz * 0.35));
  g.add(mesh(rbox(0.3, 0.08, 0.02, 0.01), _au, 0, 0.5, 0.41));
  return g;
}
function trophy() {
  const g = new THREE.Group(), gold = mat('#f5c542', { metalness: 0.9, roughness: 0.2 });
  g.add(mesh(box(0.7, 0.9, 0.7), mat('#e9e4d8'), 0, 0.45, 0), mesh(box(0.4, 0.15, 0.4), mat('#24272d'), 0, 0.98, 0));
  g.add(mesh(cyl(0.05, 0.12, 0.3, 12), gold, 0, 1.2, 0), mesh(cyl(0.28, 0.1, 0.45, 16), gold, 0, 1.55, 0));
  for (const s of [-1, 1]) g.add(mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 14), gold, s * 0.3, 1.58, 0));
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  g.add(mesh(rbox(0.5, 0.12, 0.02, 0.02), _au, 0, 0.5, 0.36), mesh(gem(0.1), _au, 0, 1.95, 0));
  for (const y of [0.05, 0.88]) g.add(mesh(box(0.74, 0.04, 0.74), mat('#cfc9bc'), 0, y, 0));
  g.add(mesh(ball(0.06), _au, 0, 1.33, 0), put(new THREE.Group(), mesh(new THREE.TorusGeometry(0.28, 0.02, 6, 20), _au, 0, 1.78, 0)));
  g.children[g.children.length - 1].rotation.x = Math.PI / 2;
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(ball(3 + i, 1), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, fog: false }));
    c.position.set(s * (31 + i * 3), 1 + (i % 2), 0);
    c.scale.y = 0.6;
    g.add(c);
  }
  return g;
}
function swordstone() {
  const g = new THREE.Group();
  const stone = mesh(ico(0.8, 0), flat('#8a8d93'), 0, 0.4, 0);
  stone.scale.set(1.3, 0.8, 1.1);
  g.add(stone, mesh(box(0.09, 1.1, 0.03), metal('#d9dee6'), 0, 1.35, 0), mesh(box(0.42, 0.07, 0.07), metal('#d9b23a'), 0, 1.9, 0));
  g.add(mesh(cyl(0.035, 0.035, 0.3, 8), mat('#5d3b22'), 0, 2.08, 0), mesh(ball(0.06), metal('#d9b23a'), 0, 2.26, 0));
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (let i = 0; i < 2; i++) { const mo = mesh(dome(0.3, 0.4), mat('#5f8a3a'), (i ? 0.5 : -0.6), 0.45, (i ? 0.2 : -0.1)); mo.scale.y = 0.4; g.add(mo); }
  for (let i = 0; i < 3; i++) g.add(mesh(box(0.06, 0.12, 0.02), glow('#7ae7ff', 1.2), -0.25 + i * 0.25, 0.35, 0.82));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  g.add(mesh(cyl(0.45, 0.5, 0.12, 16), _fe, 0, 0.06, 0), mesh(ball(0.1), _d, 0, 1.7, 0));
  put(g, mesh(new THREE.TorusGeometry(0.85, 0.03, 6, 28), mat('#dcdcdc'), 0, 2.45, 0.1)).rotation.x = -0.9 + Math.PI / 2;
  for (const s of [-1, 1]) put(g, mesh(cyl(0.015, 0.015, 1.0, 4), _d, s * 0.3, 2.1, 0.3)).rotation.set(0.9, 0, s * 0.3);
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (const s of [-1, 1]) g.add(mesh(capsule(0.03, 0.12), mat('#e63946'), s * 0.35, 0.5, -1.4).rotateX(Math.PI / 2), mesh(box(0.08, 0.04, 0.12), _d, s * 0.3, 0.02, -0.5));
  for (let i = 0; i < 3; i++) g.add(mesh(ico(0.07, 0), flat('#5a3d22'), (i - 1) * 0.15, 0.98, -0.1 + (i % 2) * 0.1));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(ball(0.08), _au, sx * 0.6, 0.08, sz * 0.32));
  g.add(mesh(ball(0.08), mat('#f2c230'), -0.3, 0.98, 0.1), mesh(ball(0.05), mat('#f2c230'), -0.25, 1.08, 0.13), mesh(cone(0.025, 0.05, 6), mat('#f28c1a'), -0.2, 1.08, 0.14).rotateZ(-Math.PI / 2));
  for (const s of [-1, 1]) g.add(mesh(cyl(0.035, 0.035, 0.04, 8), mat('#d9dee6', { metalness: 0.8, roughness: 0.25 }), 0.85, 1.25, s * 0.1));
  g.add(mesh(cyl(0.004, 0.004, 0.3, 4), _fe, 0.75, 0.8, 0.0));
  return g;
}
function fridge() {
  const g = new THREE.Group(), white = mat('#eef0f2', { roughness: 0.25, metalness: 0.2 });
  g.add(mesh(box(0.9, 1.9, 0.8), white, 0, 0.95, 0), mesh(box(0.86, 0.02, 0.02), mat('#9aa0a8'), 0, 1.3, 0.41));
  for (const y of [1.55, 1.0]) g.add(mesh(box(0.04, 0.35, 0.05), metal(), 0.34, y, 0.43));
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  g.add(mesh(box(0.88, 0.015, 0.02), mat('#9aa0a8'), 0, 1.32, 0.41));
  for (const s of [-1, 1]) g.add(mesh(cyl(0.04, 0.04, 0.05, 8), _d, s * 0.35, 0.0, 0.3));
  ['#e63946', '#2a9d8f', '#f2c230'].forEach((c, i) => g.add(mesh(rbox(0.1, 0.1, 0.02, 0.02), mat(c), -0.25 + i * 0.13, 1.6 - (i % 2) * 0.15, 0.42)));
  g.add(mesh(rbox(0.2, 0.26, 0.01, 0.01), mat('#ffffff'), -0.15, 0.95, 0.41));
  return g;
}
function computer() {
  const g = new THREE.Group(), wood = mat('#9a6a3c'), dark = mat('#1b1d22');
  g.add(mesh(box(1.7, 0.08, 0.8), wood, 0, 0.78, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(box(0.08, 0.78, 0.08), wood, sx * 0.78, 0.39, sz * 0.34));
  g.add(mesh(box(0.85, 0.52, 0.05), dark, 0, 1.25, -0.15), mesh(box(0.78, 0.45, 0.01), glow('#7cc4ff', 1.3), 0, 1.25, -0.12));
  g.add(mesh(box(0.08, 0.2, 0.06), dark, 0, 0.92, -0.15), mesh(box(0.6, 0.03, 0.22), dark, 0, 0.84, 0.15));
  g.add(mesh(box(0.5, 0.5, 0.5), mat('#3d5a80'), 0, 0.5, 0.75), mesh(box(0.5, 0.6, 0.08), mat('#3d5a80'), 0, 0.9, 0.98));
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  g.add(mesh(rbox(0.07, 0.03, 0.11, 0.015), _d, 0.45, 0.83, 0.15), mesh(cyl(0.05, 0.045, 0.1, 12), mat('#f4f4f4'), -0.6, 0.87, 0.1));
  g.add(mesh(new THREE.TorusGeometry(0.03, 0.008, 4, 10, Math.PI), mat('#f4f4f4'), -0.55, 0.88, 0.1));
  g.add(mesh(cyl(0.08, 0.1, 0.03, 12), _d, 0.6, 0.83, -0.25), mesh(cyl(0.01, 0.01, 0.4, 4), _d, 0.6, 1.03, -0.25).rotateZ(-0.3), mesh(cone(0.1, 0.12, 12, true), mat('#f2c230'), 0.67, 1.22, -0.2));
  for (let i = 0; i < 3; i++) g.add(mesh(box(0.54, 0.008, 0.04), mat('#3a3d44'), 0, 0.86, 0.09 + i * 0.06));
  g.add(mesh(rbox(0.3, 0.02, 0.15, 0.01), _d, 0, 0.83, -0.15), mesh(box(0.22, 0.005, 0.3), mat('#ffffff'), -0.4, 0.83, -0.15).rotateY(0.3));
  return g;
}
function phonebooth(R, night) {
  const g = new THREE.Group(), red = mat('#c62828', { roughness: 0.4 });
  g.add(mesh(box(1.0, 0.15, 1.0), red, 0, 0.08, 0), mesh(box(1.0, 0.25, 1.0), red, 0, 2.5, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(box(0.1, 2.4, 0.1), red, sx * 0.45, 1.25, sz * 0.45));
  g.add(mesh(box(0.85, 2.2, 0.85), night ? glow('#ffe7a3', 0.7) : mat('#bfe0f2', { transparent: true, opacity: 0.45, roughness: 0.1 }), 0, 1.25, 0));
  g.add(mesh(cyl(0.5, 0.5, 0.1, 4), red, 0, 2.68, 0));
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  g.add(mesh(rbox(0.8, 0.15, 0.05, 0.02), mat('#1d1d22'), 0, 2.35, 0.48), mesh(box(0.6, 0.08, 0.04), glow('#ffffff', 1), 0, 2.35, 0.51));
  for (const y of [0.7, 1.2, 1.7]) g.add(mesh(box(0.85, 0.03, 0.03), red, 0, y, 0.46));
  g.add(mesh(rbox(0.18, 0.28, 0.08, 0.02), mat('#1d1d22'), 0, 1.4, -0.38), mesh(gem(0.12), red, 0, 2.86, 0));
  g.add(mesh(rbox(0.3, 0.3, 0.02, 0.02), mat('#f4f1e1'), 0, 1.0, -0.43));
  return g;
}
function busstop() {
  const g = new THREE.Group(), steel = metal('#6d737c');
  for (const s of [-1, 1]) g.add(mesh(box(0.08, 2.3, 0.08), steel, s * 1.4, 1.15, -0.5));
  g.add(mesh(box(3.1, 0.08, 1.3), steel, 0, 2.35, 0), mesh(box(2.8, 1.6, 0.04), mat('#bfe0f2', { transparent: true, opacity: 0.45, roughness: 0.1 }), 0, 1.3, -0.5));
  g.add(mesh(box(2.2, 0.08, 0.4), mat('#8b5a36'), 0, 0.5, -0.2));
  for (const s of [-1, 1]) g.add(mesh(box(0.08, 0.5, 0.35), steel, s * 0.9, 0.25, -0.2));
  g.add(mesh(cyl(0.04, 0.04, 2.6, 8), steel, 2.0, 1.3, 0.3), mesh(box(0.5, 0.5, 0.04), mat('#1c7ed6'), 2.0, 2.4, 0.33));
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  g.add(mesh(rbox(0.9, 1.2, 0.04, 0.03), mat('#f4f1e1'), -0.9, 1.35, -0.48), mesh(rbox(0.5, 0.6, 0.03, 0.02), mat('#2e86ab'), 0.8, 1.5, -0.47));
  for (const z of [-0.3, -0.1]) g.add(mesh(box(2.2, 0.04, 0.12), mat('#9a6a3c'), 0, 0.55, z));
  for (const s of [-1, 1]) g.add(mesh(box(3.1, 0.06, 0.04), _fe, 0, 2.4, s * 0.64));
  g.add(mesh(cyl(0.2, 0.18, 0.6, 12), mat('#2a9d8f'), 1.5, 0.3, 0.3), mesh(cyl(0.21, 0.21, 0.04, 12), _d, 1.5, 0.62, 0.3), mesh(rbox(0.5, 0.18, 0.02, 0.02), mat('#ffffff'), 2.0, 2.4, 0.35));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (let i = 0; i < 5; i++) {
    const b = mesh(ball(0.22), mat(BRIGHT[(i + 2) % 7], { roughness: 0.25 }), Math.cos(i * 1.3) * 0.5, 2.0 + (i % 2) * 0.3, Math.sin(i * 1.3) * 0.3);
    b.scale.y = 1.2;
    g.add(b, mesh(cyl(0.005, 0.005, 1.9, 4), mat('#f4f4f4'), Math.cos(i * 1.3) * 0.25, 1.1, Math.sin(i * 1.3) * 0.15));
  }
  for (const s of [-1, 1]) g.add(mesh(new THREE.TorusGeometry(0.05, 0.015, 4, 10), mat('#e63946'), s * 0.06, 0.32, 0.15));
  for (let i = 0; i < 3; i++) g.add(mesh(box(0.04, 0.005, 0.04), mat(BRIGHT[i]), (i - 1) * 0.4, 0.01, 0.4).rotateY(i));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  const w = mat('#f4efe2');
  const third = new THREE.Group();
  third.add(mesh(cyl(0.05, 0.05, 0.6, 8), w).rotateZ(Math.PI / 2));
  for (const s of [-1, 1]) for (const z of [-1, 1]) third.add(mesh(ball(0.08), w, s * 0.32, 0, z * 0.06));
  third.position.set(-0.6, 0.08, 0.5);
  third.rotation.y = 2.2;
  g.add(third, mesh(cyl(0.22, 0.18, 0.1, 18), mat('#d62828'), 0.7, 0.05, -0.3), mesh(cyl(0.17, 0.17, 0.02, 14), mat('#8a5a2b'), 0.7, 0.09, -0.3));
  const mound = mesh(dome(0.3, 0.5), mat('#7a5a3a'), -0.2, 0, -0.5);
  mound.scale.y = 0.4;
  g.add(mound, mesh(rbox(0.12, 0.05, 0.01, 0.01), mat('#ffffff'), 0.7, 0.06, -0.12));
  g.add(mesh(box(0.15, 0.005, 0.15), mat('#f4efe2'), 0.2, 0.002, 0.7));
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
  const _w = mat('#6b4a2b'), _d = mat('#2b2e35'), _st = mat('#9a9da3'), _au = mat('#d9b23a', { metalness: 0.8, roughness: 0.3 }), _fe = mat('#8a9099', { metalness: 0.8, roughness: 0.3 });

  for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2 + 0.78; g.add(mesh(ball(0.035), _au, -0.3 + Math.cos(a) * 0.32, 0.85 + Math.sin(a) * 0.32, 0.15)); }
  g.add(mesh(box(0.08, 0.6, 0.02), mat('#f2c230'), -0.3, 0.85, 0.15), mesh(box(0.45, 0.08, 0.02), mat('#f2c230'), -0.3, 0.9, 0.15));
  g.add(mesh(dome(0.18, 0.55), _fe, 0, 1.4, 0));
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
    if (obj) { obj.position.x = x; obj.position.z = z; obj.rotation.y = R() * 6.28; bakeInPlace(obj); }
  }
}

// ---------------------------------------------------------------- fights
// The director pairs fighters into bouts, stands them a lunge apart (measured from
// their actual bodies and weapons), and scripts each exchange: wind-up, strike,
// and a real reaction from the one on the receiving end.
const APPROACH = 1.1;          // seconds spent charging in
const HIT = 0.44;              // point in an exchange where the blow lands
const SLOTS = [[-1, 0], [1, 0], [0, 1], [0, -1]];     // where extra attackers stand round one foe
const WORDS = { hit: ['POW!', 'BAM!', 'WHAM!', 'THWACK!', 'BONK!'], bite: ['CHOMP!', 'SNAP!', 'CHOMP!'],
  block: ['CLANG!', 'CLINK!'], thud: ['THUD!', 'WHUMP!'], clash: ['CLASH!', 'KLANG!'], zap: ['ZAP!', 'ZZZAP!'], breath: ['FWOOSH!'],
  finish: ['KAPOW!', 'K.O.!'] };
const bump = (p, at, w) => (p < at || p > at + w ? 0 : Math.sin(Math.PI * (p - at) / w));
const lerpAng = (a, b, u) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * u;

function fighterStats(a, o, s) {
  const ud = a.ud, humanoid = !!(ud.arms && ud.arms[0].userData.hand), w = a.weaponKind;
  const wl = a.weapon ? a.weapon.userData.length : 0;
  const st = { humanoid, armed: !!a.weapon && w !== 'staff' && w !== 'blaster', ranged: w === 'staff' || w === 'blaster',
    moves: [], reach: {}, height: {}, mass: Math.max(0.15, a.tall * (a.front + a.back)) };
  if (humanoid) {
    if (st.ranged) { st.moves = ['zap']; st.height.zap = 1.3 * s; }
    else if (st.armed) {
      st.moves = ['slash'];
      st.reach.slash = s * (0.28 + (0.3 + 0.72 * wl) * 0.95);   // where the blade meets the body
      st.height.slash = s * (1.2 - 0.3 * wl);
    } else {
      st.moves = ['punch', 'punch', 'kick'];
      st.reach.punch = 0.66 * s; st.height.punch = 1.3 * s;
      st.reach.kick = 0.86 * s; st.height.kick = 0.62 * s;
    }
  } else if (ud.quad) {
    st.moves = ud.breath ? ['bite', 'breath', 'bite'] : ['bite'];
    st.reach.bite = a.front + 0.18 * s;
    st.height.bite = st.height.breath = (ud.headH || 0.6) * s * 0.85;
  } else if (a.base === 'bird') {
    st.moves = ['peck']; st.reach.peck = a.front + 0.06; st.height.peck = 0.35 * s;
  } else if (['tank', 'ufo', 'heli', 'rocket', 'plane'].includes(a.base)) {
    st.moves = ['zap']; st.ranged = true; st.height.zap = a.tall * 0.6;
  } else {
    st.moves = ['ram']; st.reach.ram = a.front; st.height.ram = a.tall * 0.5;
  }
  return st;
}

// Centre-to-centre distance two fighters keep between blows.
function pairGap(a, b) {
  let need = a.front + b.front + 0.7;
  if (a.fight.ranged && b.fight.ranged) need = Math.max(need, 4.5);   // room for bolts to fly
  for (const [x, y] of [[a, b], [b, a]]) {
    for (const m of x.fight.moves) if (x.fight.reach[m] !== undefined) need = Math.max(need, x.fight.reach[m] + y.front + 0.8);
  }
  return Math.min(need, 7);
}

// Diners sit on stools at the table with a plate each; animals being fed gather round.
function stageMeals(cast, propObjects, root) {
  const tableObj = propObjects.table;
  const diners = cast.filter((a) => (a.action === 'eat' || a.action === 'drink') && a.ud.arms
    && a.ud.arms[0].userData.hand && !a.seated && !a.moving);
  if (tableObj && diners.length) {
    const n = diners.length, gapX = 0.8, width = Math.max(2.2, n * gapX + 0.5);
    const cx = diners.reduce((sum, a) => sum + a.x0, 0) / n;
    tableObj.position.set(cx, 0, 0.3);
    tableObj.rotation.y = 0;
    tableObj.scale.x = width / 2.2;
    if (tableObj.userData.decor) tableObj.userData.decor.visible = false;
    diners.forEach((a, i) => {
      a.x0 = cx + (i - (n - 1) / 2) * gapX;
      a.z0 = -0.42;
      a.facing = 0;
      const h = 0.5 + (1 - a.scale) * 0.35;           // taller stools for children
      a.perch = ['sit', h];
      a.seated = true;
      root.add(mesh(cyl(0.2, 0.17, h, 16), mat('#7a5230'), a.x0, h / 2, a.z0 - 0.02));
      const dish = plate(0.15);
      dish.position.set(a.x0, 0.87, -0.02);
      if (a.food && !FOOD_MAKERS[a.food.kind]().userData.bowl && !a.food.drink) {
        const side = buildFood(a.food.kind === 'drumstick' ? 'bread' : 'drumstick');   // something else on the plate
        side.scale.setScalar(0.9);
        side.position.set(0.05, 0.02, 0);
        dish.add(side);
      }
      root.add(dish);
      const gy = h - 0.8 * a.scale;                    // where the body's own origin sits
      a.plate = [-0.06, (0.93 - gy) / a.scale, (-0.02 - a.z0) / a.scale];
    });
  }
  const feeder = cast.find((a) => a.action === 'feed');
  if (feeder) {
    const fed = cast.filter((a) => a.action === 'eat' && !(a.ud.arms && a.ud.arms[0].userData.hand));
    feeder.facing = Math.PI / 2;
    fed.forEach((a, i) => {
      const ang = (i - (fed.length - 1) / 2) * 0.6, r = 1.4 + a.front + (i % 2) * 0.5;
      a.x0 = feeder.x0 + Math.cos(ang) * r;
      a.z0 = feeder.z0 + Math.sin(ang) * r;
      a.facing = Math.atan2(feeder.x0 - a.x0, feeder.z0 - a.z0);
    });
  }
}

function stageFights(cast, R, dur) {
  const fighters = cast.filter((a) => FIGHTING.has(a.action) && !a.seated);
  if (fighters.length < 2) return null;
  let A = fighters.filter((a) => a.side !== 1), B = fighters.filter((a) => a.side === 1);
  if (!A.length || !B.length) { A = fighters.filter((_, i) => i % 2 === 0); B = fighters.filter((_, i) => i % 2 === 1); }
  const rank = (a) => (a.action === 'die' ? 2 : a.action === 'slay' ? 1 : 0);
  A.sort((p, q) => rank(q) - rank(p));
  B.sort((p, q) => rank(q) - rank(p));
  const targets = A.length < B.length ? A : B, foes = targets === A ? B : A;
  const nb = Math.min(targets.length, 3), maxFoes = FLAT ? 2 : 4;
  const bouts = [];
  for (let i = 0; i < nb; i++) bouts.push({ target: targets[i], foes: [], waiting: [] });
  foes.forEach((a, i) => { const b = bouts[i % nb]; (b.foes.length < maxFoes ? b.foes : b.waiting).push(a); });
  targets.slice(nb).forEach((a, i) => bouts[i % nb].waiting.push(a));

  // geometry
  let cursor = 0;
  bouts.forEach((b, i) => {
    b.D = b.foes.map((f) => pairGap(f, b.target));
    b.phi0 = FLAT ? Math.PI / 2 : Math.PI / 2 + (R() - 0.5) * 0.5;
    b.spin = FLAT ? 0 : (R() < 0.5 ? -1 : 1) * 0.09;            // the pair slowly circles
    b.half = b.foes.length === 1 ? b.D[0] / 2 + Math.max(b.foes[0].back, b.target.back)
      : Math.max(...b.D.map((d, j) => d + b.foes[j].back));
    b.tall = Math.max(...[b.target, ...b.foes].map((a) => a.tall));
    b.cx = cursor + b.half;
    b.cz = FLAT ? 0 : (i % 2 ? -3 : 0);
    cursor += b.half * 2 + 1.8 + b.waiting.length * 1.2;
  });
  const shift = cursor / 2 - 0.9;
  bouts.forEach((b) => {
    b.cx -= shift;
    b.waiting.forEach((a, k) => {
      const mine = targets.includes(a) ? 1 : -1;
      a.spot = [b.cx + Math.sin(b.phi0) * mine * (b.half + 1.4 + k * 1.3), b.cz - 1.2 - (k % 2) * 0.6];
    });
  });

  // the script: exchanges, and the finishing blow when someone dies here
  const pickType = (att, def) => {
    const r = R();
    if (r < 0.48) return 'hit';
    if (r < 0.72) return def.fight.humanoid ? 'block' : 'dodge';
    if (r < 0.88) return 'dodge';
    return att.fight.armed && def.fight.armed ? 'clash' : 'hit';
  };
  const wordFor = (type, move, seed, armed) => {
    const list = type === 'finish' ? WORDS.finish : type === 'block' ? (armed ? WORDS.block : WORDS.thud) : type === 'clash' ? WORDS.clash
      : type === 'dodge' ? null : WORDS[move] || (move === 'peck' ? WORDS.bite : WORDS.hit);
    return list ? list[seed % list.length] : null;
  };
  bouts.forEach((b) => {
    const people = [b.target, ...b.foes];
    const victim = people.find((a) => a.action === 'die');
    const killTime = victim ? Math.max(APPROACH + 1.4, dur * DUEL_END) : Infinity;
    b.beats = [];
    let t = APPROACH + R() * 0.15, e = 0;
    const foeFirst = R() < 0.65;
    while (t < dur + 3) {
      const foe = b.foes[Math.floor(e / 2) % b.foes.length];
      let foeAttacks = (e % 2 === 0) === foeFirst;
      if (e > 1 && R() < 0.22) foeAttacks = !foeAttacks;
      if (foe.passive) foeAttacks = false;              // a boat or a car only takes the blows
      else if (b.target.passive) foeAttacks = true;
      const att = foeAttacks ? foe : b.target, def = foeAttacks ? b.target : foe;
      const len = (0.95 + R() * 0.3) * (1 + 0.1 * (Math.max(att.scale, def.scale) - 1));
      const seed = Math.floor(R() * 1000);
      if (victim && t + len * 1.25 >= killTime) {
        const killer = victim === b.target ? b.foes.find((f) => f.action === 'slay') || b.foes[0] : b.target;
        const move = killer.fight.moves[0];
        b.beats.push({ start: t, len: len * 1.25, att: killer, def: victim, type: 'finish', move, seed, word: wordFor('finish', move, seed) });
        b.killAt = t + len * 1.25 * HIT;
        b.killer = killer;
        b.victim = victim;
        break;
      }
      const move = att.fight.moves[Math.floor(R() * att.fight.moves.length)];
      let type = e === 0 ? 'hit' : pickType(att, def);
      if (type === 'clash' && move !== 'slash') type = 'hit';
      b.beats.push({ start: t, len, att, def, type, move, seed, word: wordFor(type, move, seed, def.fight.armed) });
      t += len;
      e++;
    }
  });

  const members = new Set();
  bouts.forEach((b) => [b.target, ...b.foes, ...b.waiting].forEach((a) => members.add(a)));
  const cheerSide = (b) => (b.killer ? (b.killer === b.target ? [b.target] : b.foes.filter((f) => f !== b.victim)) : []);

  function play(b, bt, p, impacts, projectiles) {
    const { att, def, type, move } = bt, A = att.fs, Dd = def.fs, F = att.fight, G = def.fight;
    const gap = Math.hypot(A.x - Dd.x, A.z - Dd.z);
    const ranged = move === 'zap' || move === 'breath';
    const reachA = F.reach[move] || 0;
    let lunge = ranged ? -0.12 : Math.max(0, gap - (reachA + def.front - 0.05) - (type === 'block' ? 0.22 : 0) + (type === 'finish' ? 0.1 : 0));
    if (move === 'breath') lunge = 0.15;
    const wind = ease(clamp(p / 0.3, 0, 1)), strike = ease(clamp((p - 0.3) / 0.14, 0, 1)), rec = ease(clamp((p - 0.6) / 0.4, 0, 1));
    Object.assign(A, { mode: 'attack', move, wind, strike, rec, adv: -0.18 * wind * (1 - strike) + lunge * strike * (1 - rec) });
    if (!ranged && !F.humanoid && att.base !== 'fish') A.hop = 0.2 * Math.sin(Math.PI * clamp((p - 0.24) / 0.26, 0, 1));
    if (move === 'breath') {
      A.fire = clamp((p - 0.28) / 0.05, 0, 1) * (1 - clamp((p - 0.8) / 0.08, 0, 1));
      A.fireLen = Math.max(0.6, gap - att.front * 0.92 - def.front * 0.4);
    }
    const kb = clamp(0.35 * Math.pow(F.mass / G.mass, 0.35), 0.18, 0.75) * (type === 'finish' ? 2.2 : 1);
    const after = ease(clamp((p - HIT) / 0.1, 0, 1));
    if (type === 'hit' || type === 'finish') {
      if (p >= HIT) {
        Dd.mode = 'hit';
        Dd.adv = -kb * after * (type === 'finish' ? 1 : 1 - ease(clamp((p - 0.62) / 0.38, 0, 1)));
        Dd.flinch = type === 'finish' ? Math.min(1, after * 1.5) : bump(p, HIT, 0.3);
        Dd.flash = bump(p, HIT, 0.2);
        b.finalKnock = kb;
      }
      if (type === 'finish' && p >= HIT + 0.05) {
        Dd.mode = 'down';
        Dd.down = ease(clamp((p - HIT - 0.05) * bt.len / 0.6, 0, 1));
      }
    } else if (type === 'block') {
      Dd.mode = 'block';
      Dd.guard = ease(clamp((p - 0.1) / 0.18, 0, 1)) * (1 - ease(clamp((p - 0.7) / 0.3, 0, 1)));
      Dd.adv = -0.16 * bump(p, HIT, 0.3);
      Dd.flinch = 0.5 * bump(p, HIT, 0.25);
    } else if (type === 'dodge') {
      Dd.mode = 'dodge';
      Dd.adv = -0.95 * ease(clamp((p - 0.24) / 0.15, 0, 1)) * (1 - ease(clamp((p - 0.62) / 0.38, 0, 1)));
      Dd.hop = 0.32 * bump(p, 0.24, 0.3);
      Dd.flinch = bump(p, 0.24, 0.4);
    } else if (type === 'clash') {
      const cl = Math.max(0.1, (gap - reachA - (G.reach.slash || 0)) / 2 + 0.12);
      A.adv = -0.18 * wind * (1 - strike) + cl * strike * (1 - rec);
      Object.assign(Dd, { mode: 'attack', move: 'slash', wind, strike, rec, adv: A.adv });
    }
    // where the blow lands
    const ax = A.x + Math.sin(A.heading) * A.adv, az = A.z + Math.cos(A.heading) * A.adv;
    const dx = Dd.x + Math.sin(Dd.heading) * Dd.adv, dz = Dd.z + Math.cos(Dd.heading) * Dd.adv;
    const span = Math.hypot(ax - dx, az - dz) || 1, nx = (ax - dx) / span, nz = (az - dz) / span;
    const chest = [dx + nx * def.front * 0.6, def.tall * 0.55, dz + nz * def.front * 0.6];
    const age = (p - HIT) * bt.len;
    if (age >= 0 && age < 0.6 && type !== 'dodge') {
      let x = dx + nx * (def.front * 0.9 + (type === 'block' ? 0.22 : 0)), z = dz + nz * (def.front * 0.9 + (type === 'block' ? 0.22 : 0));
      let y = clamp(F.height[move] || def.tall * 0.5, 0.25, def.tall * 0.85);
      if (ranged && type !== 'block') [x, y, z] = chest;
      if (type === 'clash') { x = (ax + dx) / 2; z = (az + dz) / 2; y = Math.min(F.height.slash || y, G.height.slash || y); }
      impacts.push({ x, y, z, age, k: bump(p, HIT, 0.16), big: type === 'finish', seed: bt.seed, word: bt.word,
        type: type === 'finish' ? 'finish' : move === 'zap' ? 'zap' : move === 'breath' ? 'fire' : type });
    }
    if (move === 'zap' && p >= 0.3 && p < HIT) {
      const color = att.weaponKind === 'blaster' ? '#ff4d4d' : att.weaponKind === 'staff' ? '#b388ff' : '#ffb347';
      projectiles.push({ u: (p - 0.3) / (HIT - 0.3), to: chest, color,
        from: (out) => (att.weapon ? att.weapon.userData.marker.getWorldPosition(out)
          : out.set(ax - nx * att.front, F.height.zap || 1, az - nz * att.front)) });
    }
  }

  return {
    members, bouts, single: bouts.length === 1,
    tall: Math.max(...bouts.map((b) => b.tall)),
    span: cursor,
    back: Math.min(...bouts.map((b) => b.cz)) - Math.max(...bouts.map((b) => b.half)) * 0.5 - 1.5,
    focus(out) {                                    // middle of the action
      out.set(0, 0, 0);
      let n = 0;
      bouts.forEach((b) => [b.target, ...b.foes].forEach((a) => { out.x += a.fs.x; out.z += a.fs.z; n += 1; }));
      out.multiplyScalar(1 / n);
      out.y = clamp(Math.max(...bouts.map((b) => b.tall)) * 0.42, 0.8, 3.2);
      return out;
    },
    update(t) {
      const impacts = [], projectiles = [];
      bouts.forEach((b) => {
        const T = b.target, phi = b.phi0 + b.spin * t;
        const ux = Math.sin(phi), uz = Math.cos(phi), px = -uz, pz = ux, single = b.foes.length === 1;
        const tx = b.cx + (single ? ux * b.D[0] / 2 : 0), tz = b.cz + (single ? uz * b.D[0] / 2 : 0);
        const charge = 2.6 * (1 - ease(clamp(t / APPROACH, 0, 1)));
        const pos = new Map([[T, [tx + (single ? ux * charge : 0), tz + (single ? uz * charge : 0)]]]);
        b.foes.forEach((f, j) => {
          const [su, sp] = SLOTS[j], dx = ux * su + px * sp, dz = uz * su + pz * sp;
          pos.set(f, [tx + dx * (b.D[j] + charge), tz + dz * (b.D[j] + charge)]);
        });
        const angTo = (a, o) => { const [ax, az] = pos.get(a), [ox, oz] = pos.get(o); return Math.atan2(ox - ax, oz - az); };
        const bt = b.beats.find((x) => t >= x.start && t < x.start + x.len);
        const cur = bt || (t < b.beats[0].start ? b.beats[0] : b.beats[b.beats.length - 1]);
        const prev = b.beats[Math.max(0, b.beats.indexOf(cur) - 1)];
        const foeOf = (x) => (x.att === T ? x.def : x.att);
        const turn = bt ? ease(clamp((t - bt.start) / (bt.len * 0.25), 0, 1)) : 1;
        const lookT = lerpAng(angTo(T, foeOf(prev)), angTo(T, foeOf(cur)), turn);
        [T, ...b.foes].forEach((a) => {
          const [x, z] = pos.get(a);
          a.fs = { x, z, heading: a === T ? lookT : angTo(a, T), adv: 0, hop: 0, mode: t < APPROACH * 0.9 ? 'approach' : 'guard',
            wind: 0, strike: 0, rec: 0, flinch: 0, flash: 0, guard: 0, down: 0, fallDir: 1, fire: 0, fireLen: 0, move: null };
        });
        const over = b.killAt !== undefined && t >= b.killAt;
        b.waiting.forEach((a) => {
          const [x, z] = a.spot;
          a.fs = { x, z, heading: Math.atan2(b.cx - x, b.cz - z), adv: 0, hop: 0, mode: over && cheerSide(b).length && (targets.includes(a) === targets.includes(b.killer)) ? 'cheer' : 'guard',
            wind: 0, strike: 0, rec: 0, flinch: 0, flash: 0, guard: 0, down: 0, fallDir: 1, fire: 0, fireLen: 0, move: null };
        });
        if (bt) play(b, bt, (t - bt.start) / bt.len, impacts, projectiles);
        if (over) {
          const v = b.victim.fs, fin = b.beats[b.beats.length - 1];
          if (!bt) {
            v.mode = 'down';
            v.down = ease(clamp((t - b.killAt - 0.05) / 0.6, 0, 1));
            v.adv = -(b.finalKnock || 0.6);
            v.flinch = 1;
          }
          if (t > fin.start + fin.len * 0.85) cheerSide(b).forEach((a) => { a.fs.mode = 'cheer'; a.fs.adv = 0; });
        }
      });
      return { impacts, projectiles };
    },
  };
}

function comicSprite(word) {
  const px = 110, pad = 26;
  const c = document.createElement('canvas');
  let ctx = c.getContext('2d');
  const font = `italic 900 ${px}px Impact, "Arial Black", system-ui, sans-serif`;
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(word).width) + pad * 2;
  c.height = px + pad * 2;
  ctx = c.getContext('2d');
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 18;
  ctx.strokeStyle = '#8b0000';
  ctx.strokeText(word, pad, c.height / 2);
  ctx.fillStyle = '#ffd23f';
  ctx.fillText(word, pad, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  const h = 0.62;
  sprite.userData.size = new THREE.Vector3(h * c.width / c.height, h, 1);
  sprite.renderOrder = 20;
  sprite.visible = false;
  return sprite;
}

// Sparks, comic words and magic bolts for whatever the director reports this frame.
function fightEffects(root) {
  const bursts = [0, 1, 2].map(() => {
    const g = new THREE.Group();
    const hot = new THREE.MeshBasicMaterial({ color: '#fff3b0', transparent: true, depthWrite: false, fog: false });
    const warm = new THREE.MeshBasicMaterial({ color: '#ff9f1c', transparent: true, depthWrite: false, fog: false });
    for (let i = 0; i < 12; i++) {
      const arm = new THREE.Group();
      arm.rotation.set(i * 2.1, i * 1.37, i * 0.71);
      const ray = new THREE.Mesh(box(0.045, 0.045, 0.55), i % 2 ? hot : warm);
      ray.position.z = 0.32;
      arm.add(ray);
      g.add(arm);
    }
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#fff3c4', transparent: true,
      depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    g.add(flash);
    g.visible = false;
    g.renderOrder = 10;
    root.add(g);
    return { g, hot, warm, flash };
  });
  const words = new Map();
  const wordSprite = (w) => {
    if (!words.has(w)) { const sp = comicSprite(w); root.add(sp); words.set(w, sp); }
    return words.get(w);
  };
  const orbs = [0, 1].map(() => {
    const g = new THREE.Group();
    const core = new THREE.Mesh(ball(0.1), new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#b388ff', transparent: true,
      depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(1.0);
    g.add(core, halo);
    g.visible = false;
    root.add(g);
    return { g, halo };
  });
  const v = new THREE.Vector3(), to = new THREE.Vector3();
  const warmFor = { hit: '#ff6a2a', finish: '#ff3b1f', zap: '#b388ff', fire: '#ff8a1c', block: '#ffd166', clash: '#ffe08a' };
  return (state) => {
    bursts.forEach((b) => { b.g.visible = false; });
    words.forEach((w) => { w.visible = false; });
    orbs.forEach((o) => { o.g.visible = false; });
    let shake = 0;
    state.impacts.slice(0, 3).forEach((im, i) => {
      const b = bursts[i], k = clamp(1 - im.age / 0.32, 0, 1);
      shake = Math.max(shake, im.k * (im.big ? 1.7 : 1));
      if (k > 0) {
        const grow = (im.type === 'block' || im.type === 'clash' ? 0.75 : 1.05) * (im.big ? 1.6 : 1) * (0.45 + (1 - k) * 0.95);
        b.g.visible = true;
        b.g.position.set(im.x, im.y, im.z);
        b.g.scale.setScalar(grow);
        b.g.rotation.set(im.seed * 1.7, im.seed * 0.9, 0);
        b.hot.opacity = b.warm.opacity = k;
        b.warm.color.set(warmFor[im.type] || '#ff9f1c');
        b.flash.material.opacity = k;
        b.flash.scale.setScalar(1.7);
      }
      if (im.word && im.age < 0.6) {
        const sp = wordSprite(im.word), u = im.age / 0.6;
        sp.visible = true;
        sp.position.set(im.x + 0.25, im.y + 0.75 + u * 0.35, im.z);
        sp.scale.copy(sp.userData.size).multiplyScalar((im.big ? 1.45 : 1) * (u < 0.15 ? lerp(0.45, 1.15, u / 0.15) : lerp(1.15, 1, u)));
        sp.material.opacity = 1 - clamp((u - 0.7) / 0.3, 0, 1);
      }
    });
    state.projectiles.slice(0, 2).forEach((pr, i) => {
      const o = orbs[i];
      pr.from(v);
      to.set(pr.to[0], pr.to[1], pr.to[2]);
      o.g.visible = true;
      o.g.position.copy(v).lerp(to, ease(pr.u));
      o.halo.material.color.set(pr.color);
    });
    return shake;
  };
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
    const h = add(mesh(soft(26 + R() * 18), mat(color)));
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
      const d = add(mesh(soft(18 + R() * 16), mat('#dcb86c')));
      d.scale.y = 0.22; d.castShadow = false; d.position.y = -1.5;
      return d;
    });
  } else if (setting === 'snow') {
    scatter(R, 34, 11, 85, () => add(pine(R, true)));
    scatter(R, 16, 9, 70, () => {
      const m = add(mesh(blob(2 + R() * 3), mat('#ffffff')));
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
      const h = add(mesh(soft(24 + R() * 14), mat('#4f8a4a')));
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
        const puff = new THREE.Mesh(blob(3 + R() * 3), cm);
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
    const obj = add(build(R, night, anims, false, p));
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
      a.maxTravel = 9;                   // ...and do not leave them behind, out of the shot
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
  const fights = stageFights(cast, R, sc.duration);
  const facing = sc.actors.some((s) => !s.ambient && s.action === 'talk') && cast.length > 1;
  const mid = (cast.length - 1) / 2;
  cast.forEach((a, j) => { if (a.seated) { a.facing = 0; return; } a.facing = facing ? (j <= mid ? Math.PI / 2 : -Math.PI / 2) : (j - mid) * -0.12; });
  const effects = fights ? fightEffects(root) : null;
  if (fights) {
    // Anyone not fighting watches from behind the fight.
    const watchers = cast.filter((a) => !fights.members.has(a) && !a.seated && !a.moving && !a.flying && !a.aquatic);
    watchers.forEach((a, j) => {
      a.x0 = (j - (watchers.length - 1) / 2) * 1.7;
      a.z0 = fights.back - 1.2 - (j % 2) * 0.9;
      a.facing = Math.atan2(-a.x0, -a.z0);
    });
  }
  stageMeals(cast, propObjects, root);

  const biggest = cast.reduce((m, a) => Math.max(m, a.scale), 1);
  // The camera follows the grounded cast when there is one, otherwise whoever is on screen.
  let leads = cast.filter((a) => !a.flying && !(a.aquatic && centreIsland));
  const allFlying = cast.length > 0 && !leads.length;
  if (!leads.length) leads = cast;
  const overhead = !allFlying && cast.some((a) => a.flying);       // something circling above the ones we follow
  const dist = cast.length ? clamp(6.5 + total * 0.5 + (biggest - 1) * 2.5 + (allFlying ? 5 : 0) + (overhead ? 6 : 0), 7, 26)
    : FLAT ? 13 : sc.props.length ? 16 : extras.length ? 19 : 24;
  const quiet = cast.length > 0 && cast.length <= 4 && !fights
    && cast.every((a) => ['eat', 'drink', 'feed', 'talk'].includes(a.action) || a.seated);
  const shotDist = quiet ? clamp(2.4 + total * 0.38 + (biggest - 1) * 2, 3.2, 9) : dist;
  const shotMode = quiet && sc.camera === 'crane' ? 'orbit' : sc.camera;
  let cam = FLAT ? flatRig(shotMode, shotDist * (quiet ? 1.25 : 1)) : cameraRig(shotMode, R() * 1.2 - 0.6, shotDist, sc.mood === 'tense');
  if (fights && !fights.single) {
    const d = clamp(fights.span * 0.55 + 4, 8, 30);
    cam = FLAT ? flatRig('static', Math.max(d, fights.tall * 1.9)) : cameraRig('orbit', R() * 0.6 - 0.3, d, false);
  } else if (fights && FLAT) {
    const b = fights.bouts[0];
    cam = flatRig('static', Math.max((2 * b.half + 3) / (1.78 * 0.92), b.tall * 1.75 / 0.92, 6.5));
  }
  const focus = new THREE.Vector3(0, 2, 0);

  if (FLAT) flatten(root, env);
  return {
    root, env, dome, duration: sc.duration,
    update(t, camera) {
      anims.forEach((fn) => fn(t));
      const fightNow = fights ? fights.update(t) : null;
      actors.forEach((a) => a.update(t, sc.duration));
      if (cast.length) {
        focus.set(0, 0, 0);
        leads.forEach((a) => focus.add(a.focus));
        focus.multiplyScalar(1 / leads.length);
      } else if (sc.props.length) {
        focus.set(0, 2.2, -Math.min(sc.props[0].r, 12) * 0.6);
      } else if (extras.length) {
        focus.set(0, 1.8, -4);
      }
      let impact = 0;
      if (fightNow) {
        impact = effects(fightNow);
        fights.focus(focus);
      }
      if (fights && fights.single && !FLAT) {
        // Side-on to the pair, so both fighters are always in frame, drifting round as they circle.
        const b = fights.bouts[0], phi = b.phi0 + b.spin * t;
        const a = phi - Math.PI / 2 + 0.38 + Math.sin(t * 0.35) * 0.16;
        const d = Math.max(5, (b.half + 1.2) / 0.62, b.tall * 1.75) * (1 - 0.07 * impact);
        camera.position.set(focus.x + Math.sin(a) * d, focus.y + d * 0.2 + 0.3, focus.z + Math.cos(a) * d);
        camera.lookAt(focus);
      } else {
        cam(t, sc.duration, focus, camera);
      }
      if (impact) {                                   // the camera feels each hit
        camera.position.x += Math.sin(t * 95) * 0.08 * impact;
        camera.position.y += Math.cos(t * 80) * 0.06 * impact;
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
  let galleryOn = false;
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
  window.story3d.census = census;
  window.story3d.info = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
  // Every model of one family laid out in a grid, for checking detail by eye.
  window.story3d.gallery = (family, page = 0, per = 20, close = false) => {
    const R = mulberry(5), items = [];
    if (family === 'actors') {
      Object.entries(BUILDERS).forEach(([k, b]) => { if (k !== 'quad') items.push(b({ color: '#c77d4a' }, 'gallery' + k)); });
      [{ color: '#b0793f', len: 0.9, leg: 0.4, ears: 'round', tail: 0.5 }, { color: '#7b4a2a', len: 1.7, leg: 0.95, width: 0.55, neck: 0.55, ears: 'up', tail: 0.7, mane: true },
        { color: '#b5342b', len: 2.6, leg: 0.8, width: 0.9, neck: 0.8, ears: 'up', tail: 1.8, wings: true, breath: true }].forEach((o) => items.push(buildQuad(o)));
    } else if (family === 'props') Object.values(PROP_BUILDERS).forEach((b) => items.push(b(mulberry(3), false, [], false, {})));
    else if (family === 'food') Object.keys(FOOD_MAKERS).forEach((k) => items.push(buildFood(k)));
    else items.push(tree(R, false), tree(R, false, true), pine(R, false), rock(R), flowers(R), cactus(R), house(R, false));
    const shown = items.slice(page * per, page * per + per), cols = close ? per : 5, grid = new THREE.Group();
    shown.forEach((o, i) => {
      const box3 = new THREE.Box3().setFromObject(o), size = box3.getSize(new THREE.Vector3()), k = 1.6 / Math.max(size.x, size.y, size.z, 0.01);
      const holder = new THREE.Group();
      holder.add(o);
      o.position.sub(box3.getCenter(new THREE.Vector3())).multiplyScalar(1);
      holder.scale.setScalar(k);
      holder.position.set((i % cols - (cols - 1) / 2) * 2.1, -Math.floor(i / cols) * 2.1 + 3, 0);
      holder.rotation.y = -0.5;
      grid.add(holder);
    });
    scene.children.filter((c) => c.userData.gallery || (shot && c === shot.root)).forEach((c) => scene.remove(c));
    grid.userData.gallery = true;
    scene.add(grid);
    scene.background = new THREE.Color('#dfe6ee');
    scene.fog.near = 500; scene.fog.far = 900;
    sun.intensity = 2.4; hemi.intensity = 1.3;
    sun.position.set(20, 40, 30); sun.target.position.set(0, 0, 0);
    camera.fov = 48; camera.updateProjectionMatrix();
    camera.position.set(0, close ? 3 : 0.2, close ? per * 1.15 + 1 : 13.5);
    camera.lookAt(0, close ? 3 : 0.2, 0);
    playing = false;
    galleryOn = true;
    $('fade').style.opacity = 0;
    $('caption').textContent = '';
    $('bar').style.display = 'none';
    renderer.render(scene, camera);
    return shown.length;
  };

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      T += dt;
      if (T >= total) { T = total; setPlaying(false); stopRecording(); }
    }
    if (!galleryOn) draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// How many parts every model is made of (used by the tests to keep detail up).
function census() {
  const count = (o) => { let n = 0, tris = 0; o.traverse((m) => { if (m.isMesh) { n += 1; const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } }); return [n, Math.round(tris)]; };
  const R = mulberry(5), out = { actors: {}, props: {}, food: {}, scenery: {} };
  const quads = { dog: { color: '#b0793f', len: 0.9, leg: 0.4, ears: 'round', tail: 0.5 },
    horse: { color: '#7b4a2a', len: 1.7, leg: 0.95, width: 0.55, neck: 0.55, ears: 'up', tail: 0.7, mane: true },
    dragon: { color: '#b5342b', len: 2.6, leg: 0.8, width: 0.9, neck: 0.8, ears: 'up', tail: 1.8, wings: true, breath: true } };
  Object.entries(BUILDERS).forEach(([k, b]) => { if (k !== 'quad') out.actors[k] = count(b({ color: '#888888' }, 'census')); });
  Object.entries(quads).forEach(([k, o]) => { out.actors['quad:' + k] = count(buildQuad(o)); });
  Object.entries(PROP_BUILDERS).forEach(([k, b]) => { out.props[k] = count(b(mulberry(3), false, [], false, {})); });
  Object.keys(FOOD_MAKERS).forEach((k) => { out.food[k] = count(buildFood(k)); });
  out.scenery = { tree: count(tree(R, false)), palm: count(tree(R, false, true)), pine: count(pine(R, false)),
    rock: count(rock(R)), flowers: count(flowers(R)), cactus: count(cactus(R)), house: count(house(R, false)) };
  return out;
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
