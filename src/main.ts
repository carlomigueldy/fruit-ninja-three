import * as THREE from 'three';
import './styles.css';

type FruitSpec = {
  name: string;
  skin: number;
  flesh: number;
  accent: number;
  scale: THREE.Vector3;
  stripes?: boolean;
};

type TargetKind = 'fruit' | 'bomb';

type GameTarget = {
  id: number;
  kind: TargetKind;
  group: THREE.Group;
  radius: number;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  sliced: boolean;
  fruit?: FruitSpec;
};

type FlyingObject = {
  object: THREE.Object3D;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  ttl: number;
  fade: boolean;
};

type SwipePoint = {
  x: number;
  y: number;
  world: THREE.Vector3;
  time: number;
};

function qs<T extends HTMLElement>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Fruit Ninja UI failed to initialize: missing ${selector}`);
  return element;
}

const app = qs<HTMLElement>('#app');
const scoreValue = qs<HTMLElement>('#scoreValue');
const livesValue = qs<HTMLElement>('#livesValue');
const highValue = qs<HTMLElement>('#highValue');
const comboBadge = qs<HTMLElement>('#comboBadge');
const overlay = qs<HTMLElement>('#overlay');
const overlayTitle = qs<HTMLElement>('#overlayTitle');
const overlayText = qs<HTMLElement>('#overlayText');
const startButton = qs<HTMLButtonElement>('#startButton');
const toast = qs<HTMLElement>('#toast');
const muteButton = qs<HTMLButtonElement>('#muteButton');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x16091f);
scene.fog = new THREE.Fog(0x16091f, 12, 24);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 80);
camera.position.set(0, 0.7, 11.4);
camera.lookAt(0, 0.55, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const gamePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const pointerWorld = new THREE.Vector3();

const targetGroup = new THREE.Group();
const effectGroup = new THREE.Group();
const trailGroup = new THREE.Group();
scene.add(targetGroup, effectGroup, trailGroup);

const gravity = 7.85;
const sphereGeometry = new THREE.SphereGeometry(1, 36, 24);
const lowSphereGeometry = new THREE.SphereGeometry(1, 18, 12);
const stemGeometry = new THREE.CylinderGeometry(0.055, 0.085, 0.38, 9);
const leafGeometry = new THREE.SphereGeometry(1, 16, 8);
const dropletGeometry = new THREE.SphereGeometry(1, 8, 6);
const cutFaceGeometry = new THREE.CircleGeometry(1, 32);
const halfForwardGeometry = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI);
const halfBackwardGeometry = new THREE.SphereGeometry(1, 32, 16, Math.PI, Math.PI);
const bombFuseCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0.42, 0),
  new THREE.Vector3(0.12, 0.66, 0.02),
  new THREE.Vector3(-0.04, 0.86, 0.04),
]);
const bombFuseGeometry = new THREE.TubeGeometry(bombFuseCurve, 10, 0.025, 6);

// Every geometry that is shared across many meshes must NOT be disposed when a
// single transient effect object dies — otherwise the next fruit that reuses it
// renders with a disposed (empty) GPU buffer. Track them explicitly.
const sharedGeometries = new Set<THREE.BufferGeometry>([
  sphereGeometry,
  lowSphereGeometry,
  stemGeometry,
  leafGeometry,
  dropletGeometry,
  cutFaceGeometry,
  halfForwardGeometry,
  halfBackwardGeometry,
  bombFuseGeometry,
]);

// ---------------------------------------------------------------------------
// Audio: procedural WebAudio SFX. No asset files needed — every sound is
// synthesised. The AudioContext is created lazily on the first user gesture
// (the Start button) so browsers permit playback.
// ---------------------------------------------------------------------------
let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let audioMuted = loadMuted();
let noiseBuffer: AudioBuffer | null = null;

function loadMuted() {
  try {
    return localStorage.getItem('fruit-ninja-three-muted') === '1';
  } catch {
    return false;
  }
}

function ensureAudio() {
  if (audioCtx) return audioCtx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = audioMuted ? 0 : 0.85;
  masterGain.connect(audioCtx.destination);
  return audioCtx;
}

function resumeAudio() {
  const ctx = ensureAudio();
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

function applyMuteUi() {
  muteButton.classList.toggle('muted', audioMuted);
  muteButton.setAttribute('aria-pressed', String(audioMuted));
  muteButton.setAttribute('aria-label', audioMuted ? 'Unmute sound' : 'Mute sound');
  muteButton.setAttribute('title', audioMuted ? 'Unmute sound (M)' : 'Mute sound (M)');
  const icon = muteButton.querySelector('.mute-icon');
  if (icon) icon.textContent = audioMuted ? '🔇' : '🔊';
}

function setMuted(next: boolean) {
  audioMuted = next;
  if (masterGain) masterGain.gain.value = audioMuted ? 0 : 0.85;
  try {
    localStorage.setItem('fruit-ninja-three-muted', audioMuted ? '1' : '0');
  } catch {
    // Storage disabled (private mode) should not break muting.
  }
  applyMuteUi();
}

function toggleMute() {
  // A click/keypress is a user gesture, so it is safe to unlock audio here too.
  if (!audioMuted) resumeAudio();
  setMuted(!audioMuted);
}

function getNoiseBuffer(ctx: AudioContext) {
  if (noiseBuffer) return noiseBuffer;
  const length = Math.floor(ctx.sampleRate * 0.5);
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

function playSlice(intensity = 1) {
  const ctx = ensureAudio();
  if (!ctx || !masterGain || audioMuted) return;
  const now = ctx.currentTime;
  // Whoosh: a rising band-passed noise burst.
  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(850 + intensity * 550, now);
  bp.frequency.exponentialRampToValueAtTime(2600, now + 0.12);
  bp.Q.value = 0.9;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, now);
  ng.gain.exponentialRampToValueAtTime(0.3, now + 0.008);
  ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  noise.connect(bp).connect(ng).connect(masterGain);
  noise.start(now);
  noise.stop(now + 0.18);
  // Squish: a short descending body tone.
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(430, now);
  osc.frequency.exponentialRampToValueAtTime(170, now + 0.14);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, now);
  og.gain.exponentialRampToValueAtTime(0.16, now + 0.012);
  og.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  osc.connect(og).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.17);
}

function playCombo(step: number) {
  const ctx = ensureAudio();
  if (!ctx || !masterGain || audioMuted) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  const base = 520 + Math.min(step, 8) * 85;
  osc.frequency.setValueAtTime(base, now);
  osc.frequency.exponentialRampToValueAtTime(base * 1.5, now + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  osc.connect(g).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.24);
}

function playBomb() {
  const ctx = ensureAudio();
  if (!ctx || !masterGain || audioMuted) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(165, now);
  osc.frequency.exponentialRampToValueAtTime(38, now + 0.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.5, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
  osc.connect(g).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.72);
  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1800, now);
  lp.frequency.exponentialRampToValueAtTime(200, now + 0.4);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.5, now);
  ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
  noise.connect(lp).connect(ng).connect(masterGain);
  noise.start(now);
  noise.stop(now + 0.45);
}

function playGameOver() {
  const ctx = ensureAudio();
  if (!ctx || !masterGain || audioMuted) return;
  const now = ctx.currentTime;
  const notes = [523.25, 415.3, 311.13, 233.08];
  notes.forEach((f, i) => {
    const t = now + i * 0.14;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(g).connect(masterGain as GainNode);
    osc.start(t);
    osc.stop(t + 0.32);
  });
}

function playStart() {
  const ctx = ensureAudio();
  if (!ctx || !masterGain || audioMuted) return;
  const now = ctx.currentTime;
  const notes = [392.0, 523.25, 659.25];
  notes.forEach((f, i) => {
    const t = now + i * 0.09;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    osc.connect(g).connect(masterGain as GainNode);
    osc.start(t);
    osc.stop(t + 0.26);
  });
}

// ---------------------------------------------------------------------------
// Blade trail: the signature Fruit Ninja swoosh. A dynamic tapered ribbon mesh
// rebuilt each frame from the most recent swipe points, sitting just in front
// of the fruit plane. Replaces the previously-unused `trailGroup`.
// ---------------------------------------------------------------------------
const MAX_TRAIL = 22;
const trailPositions = new Float32Array(MAX_TRAIL * 2 * 3);
const trailGeometry = new THREE.BufferGeometry();
trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
const trailIndices: number[] = [];
for (let i = 0; i < MAX_TRAIL - 1; i += 1) {
  const a = i * 2;
  const b = i * 2 + 1;
  const c = (i + 1) * 2;
  const d = (i + 1) * 2 + 1;
  trailIndices.push(a, b, c, b, d, c);
}
trailGeometry.setIndex(trailIndices);
const trailMaterial = new THREE.MeshBasicMaterial({
  color: 0xc4f7ff,
  transparent: true,
  opacity: 0.82,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const trailMesh = new THREE.Mesh(trailGeometry, trailMaterial);
trailMesh.frustumCulled = false;
trailMesh.visible = false;
trailGroup.add(trailMesh);

const trailPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -1.2);
const trailHead = new THREE.Vector3();
const trailA = new THREE.Vector3();
const trailB = new THREE.Vector3();
const trailC = new THREE.Vector3();

function worldOnTrailPlane(clientX: number, clientY: number, out: THREE.Vector3) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  raycaster.ray.intersectPlane(trailPlane, out);
  return out;
}

function updateTrail() {
  if (gameOver || activePointerId === null || swipePoints.length < 2) {
    if (trailMesh.visible) trailMesh.visible = false;
    return;
  }
  const recent = swipePoints.slice(-MAX_TRAIL);
  const n = recent.length;
  worldOnTrailPlane(recent[n - 1].x, recent[n - 1].y, trailHead);

  for (let i = 0; i < MAX_TRAIL; i += 1) {
    const o = i * 6;
    if (i >= n) {
      // Collapse unused slots onto the head → degenerate (invisible) triangles.
      trailPositions[o] = trailPositions[o + 3] = trailHead.x;
      trailPositions[o + 1] = trailPositions[o + 4] = trailHead.y;
      trailPositions[o + 2] = trailPositions[o + 5] = trailHead.z;
      continue;
    }
    const p = recent[i];
    const prev = recent[Math.max(0, i - 1)];
    const next = recent[Math.min(n - 1, i + 1)];
    worldOnTrailPlane(p.x, p.y, trailA);
    worldOnTrailPlane(prev.x, prev.y, trailB);
    worldOnTrailPlane(next.x, next.y, trailC);
    trailC.sub(trailB); // travel direction
    if (trailC.lengthSq() < 1e-8) trailC.set(1, 0, 0);
    trailC.normalize();
    const nx = -trailC.y;
    const ny = trailC.x;
    const tt = n > 1 ? i / (n - 1) : 1; // 0 at tail, 1 at blade head
    const halfW = 0.02 + 0.2 * tt;
    trailPositions[o] = trailA.x + nx * halfW;
    trailPositions[o + 1] = trailA.y + ny * halfW;
    trailPositions[o + 2] = trailA.z;
    trailPositions[o + 3] = trailA.x - nx * halfW;
    trailPositions[o + 4] = trailA.y - ny * halfW;
    trailPositions[o + 5] = trailA.z;
  }
  trailGeometry.attributes.position.needsUpdate = true;
  trailMesh.visible = true;
}

const fruitSpecs: FruitSpec[] = [
  { name: 'watermelon', skin: 0x2fc35a, flesh: 0xff4268, accent: 0x0b7d3b, scale: new THREE.Vector3(1.12, 0.86, 1.02), stripes: true },
  { name: 'orange', skin: 0xff9c22, flesh: 0xffc44c, accent: 0xffe07c, scale: new THREE.Vector3(0.98, 0.98, 0.98) },
  { name: 'apple', skin: 0xe73345, flesh: 0xffefd2, accent: 0x9b1628, scale: new THREE.Vector3(1.02, 0.96, 1.02) },
  { name: 'lime', skin: 0x8ee840, flesh: 0xd8ff85, accent: 0x3ea51b, scale: new THREE.Vector3(0.92, 0.92, 0.92) },
  { name: 'lemon', skin: 0xffe34d, flesh: 0xfff7a2, accent: 0xe5aa1a, scale: new THREE.Vector3(1.18, 0.78, 0.78) },
  { name: 'plum', skin: 0x7e42d8, flesh: 0xff8bd8, accent: 0x43177d, scale: new THREE.Vector3(0.92, 1.02, 0.92) },
];

let targets: GameTarget[] = [];
let flyingObjects: FlyingObject[] = [];
let swipePoints: SwipePoint[] = [];
let score = 0;
let lives = 3;
let highScore = loadHighScore();
let gameOver = true;
let spawnTimer = 0;
let nextId = 1;
let activePointerId: number | null = null;
let swipeKillCount = 0;
let lastComboAt = 0;
let toastTimeout: number | undefined;

function loadHighScore() {
  try {
    return Number.parseInt(localStorage.getItem('fruit-ninja-three-best') ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveHighScore(value: number) {
  try {
    localStorage.setItem('fruit-ninja-three-best', String(value));
  } catch {
    // Private browsing/storage-disabled mode should not break play.
  }
}

function makeTexture(base: number, accent: number, stripes = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create fruit texture.');

  const baseColor = `#${base.toString(16).padStart(6, '0')}`;
  const accentColor = `#${accent.toString(16).padStart(6, '0')}`;
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.08, baseColor);
  gradient.addColorStop(0.55, baseColor);
  gradient.addColorStop(1, accentColor);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.globalAlpha = stripes ? 0.42 : 0.16;
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = stripes ? 9 : 2;
  for (let x = -40; x < canvas.width + 40; x += stripes ? 34 : 26) {
    ctx.beginPath();
    ctx.moveTo(x, -8);
    ctx.bezierCurveTo(x + 34, 28, x - 22, 58, x + 26, canvas.height + 8);
    ctx.stroke();
  }

  ctx.globalAlpha = 0.22;
  for (let i = 0; i < 90; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const r = 0.6 + Math.random() * 1.8;
    ctx.fillStyle = Math.random() > 0.5 ? '#ffffff' : accentColor;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.8, 1);
  return texture;
}

const textureCache = new Map<string, THREE.CanvasTexture>();
function getFruitTexture(spec: FruitSpec) {
  const key = `${spec.name}-${spec.skin}-${spec.accent}-${spec.stripes ? 1 : 0}`;
  const existing = textureCache.get(key);
  if (existing) return existing;
  const texture = makeTexture(spec.skin, spec.accent, spec.stripes);
  textureCache.set(key, texture);
  return texture;
}

function createFruit(spec: FruitSpec, radius: number) {
  const group = new THREE.Group();
  group.name = spec.name;

  const material = new THREE.MeshStandardMaterial({
    color: spec.skin,
    map: getFruitTexture(spec),
    roughness: 0.58,
    metalness: 0.03,
    emissive: spec.skin,
    emissiveIntensity: 0.035,
  });
  const body = new THREE.Mesh(sphereGeometry, material);
  body.scale.copy(spec.scale).multiplyScalar(radius);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const stem = new THREE.Mesh(
    stemGeometry,
    new THREE.MeshStandardMaterial({ color: 0x6b3a1d, roughness: 0.82 }),
  );
  stem.position.set(0.08 * radius, radius * spec.scale.y + 0.13, 0.02);
  stem.rotation.set(0.38, 0.12, -0.24);
  stem.castShadow = true;
  group.add(stem);

  const leaf = new THREE.Mesh(
    leafGeometry,
    new THREE.MeshStandardMaterial({ color: 0x65db5a, roughness: 0.7, side: THREE.DoubleSide }),
  );
  leaf.scale.set(radius * 0.22, radius * 0.075, radius * 0.13);
  leaf.position.set(radius * 0.28, radius * spec.scale.y + 0.12, 0.02);
  leaf.rotation.set(0.1, 0.0, -0.72);
  leaf.castShadow = true;
  group.add(leaf);

  if (spec.name === 'watermelon') {
    const ringMaterial = new THREE.MeshStandardMaterial({ color: spec.accent, roughness: 0.8, emissive: spec.accent, emissiveIntensity: 0.05 });
    for (let i = -1; i <= 1; i += 1) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * (0.72 + Math.abs(i) * 0.1), radius * 0.018, 6, 52), ringMaterial);
      ring.rotation.set(Math.PI / 2, 0.18 * i, 0);
      ring.scale.y = 1.8;
      ring.position.y = i * radius * 0.18;
      group.add(ring);
    }
  }

  return group;
}

function createBomb(radius: number) {
  const group = new THREE.Group();
  group.name = 'bomb';

  const shell = new THREE.Mesh(
    lowSphereGeometry,
    new THREE.MeshStandardMaterial({
      color: 0x15121b,
      roughness: 0.36,
      metalness: 0.62,
      emissive: 0x09030f,
      emissiveIntensity: 0.5,
    }),
  );
  shell.scale.setScalar(radius);
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.22, radius * 0.28, radius * 0.18, 12),
    new THREE.MeshStandardMaterial({ color: 0x353141, roughness: 0.5, metalness: 0.5 }),
  );
  cap.position.y = radius * 0.83;
  cap.castShadow = true;
  group.add(cap);

  const fuse = new THREE.Mesh(
    bombFuseGeometry,
    new THREE.MeshStandardMaterial({ color: 0x3a2316, roughness: 0.9 }),
  );
  fuse.scale.setScalar(radius / 0.72);
  fuse.castShadow = true;
  group.add(fuse);

  const ember = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.08, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd65a }),
  );
  ember.position.set(-0.05, radius * 1.18, 0.05);
  group.add(ember);

  const glow = new THREE.PointLight(0xff6536, 1.1, 2.8);
  glow.position.copy(ember.position);
  group.add(glow);

  return group;
}

function createDojo() {
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 12),
    new THREE.MeshStandardMaterial({
      color: 0x2b1438,
      roughness: 0.92,
      metalness: 0.0,
      emissive: 0x120519,
      emissiveIntensity: 0.22,
    }),
  );
  wall.position.set(0, 0.45, -3.4);
  wall.receiveShadow = true;
  scene.add(wall);

  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(1.35, 48),
    new THREE.MeshBasicMaterial({ color: 0xffd97b, transparent: true, opacity: 0.7 }),
  );
  moon.position.set(4.9, 3.25, -3.32);
  scene.add(moon);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 8),
    new THREE.MeshStandardMaterial({ color: 0x4b2432, roughness: 0.72, metalness: 0.02 }),
  );
  floor.position.set(0, -4.35, 0.4);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const beamMaterial = new THREE.MeshStandardMaterial({ color: 0x6f3b22, roughness: 0.74, metalness: 0.04 });
  const beamGeometry = new THREE.BoxGeometry(0.18, 8.4, 0.18);
  for (const x of [-6.0, -3.0, 0, 3.0, 6.0]) {
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);
    beam.position.set(x, 0, -3.12);
    beam.castShadow = true;
    beam.receiveShadow = true;
    scene.add(beam);
  }

  const shelfMaterial = new THREE.MeshStandardMaterial({ color: 0x8a4b28, roughness: 0.7 });
  for (const y of [-2.72, 3.95]) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(15.5, 0.18, 0.2), shelfMaterial);
    shelf.position.set(0, y, -3.08);
    shelf.castShadow = true;
    scene.add(shelf);
  }

  const basketMaterial = new THREE.MeshStandardMaterial({ color: 0xa66635, roughness: 0.86 });
  for (const x of [-5.35, 5.35]) {
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.95, 0.65, 18, 1, true), basketMaterial);
    basket.position.set(x, -3.83, -0.65);
    basket.rotation.x = 0.04;
    basket.castShadow = true;
    basket.receiveShadow = true;
    scene.add(basket);
  }

  const mat = new THREE.Mesh(
    new THREE.CircleGeometry(2.8, 64),
    new THREE.MeshBasicMaterial({ color: 0xffce52, transparent: true, opacity: 0.07, side: THREE.DoubleSide }),
  );
  mat.position.set(0, -0.35, -0.03);
  scene.add(mat);
}

function setupLights() {
  scene.add(new THREE.AmbientLight(0xffe7b5, 0.92));

  const hemi = new THREE.HemisphereLight(0xffe7ba, 0x1b102a, 1.15);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff0c7, 2.0);
  key.position.set(-4.5, 6.5, 7.5);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 28;
  key.shadow.camera.left = -7;
  key.shadow.camera.right = 7;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.bias = -0.0001;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);

  const rim = new THREE.DirectionalLight(0x6af0ff, 1.1);
  rim.position.set(4.8, 2.8, 4.2);
  scene.add(rim);

  const lanternLeft = new THREE.PointLight(0xff75b8, 1.7, 7.0, 2);
  lanternLeft.position.set(-4.8, 2.6, 1.2);
  const lanternRight = new THREE.PointLight(0xffd86b, 1.6, 7.0, 2);
  lanternRight.position.set(4.8, 2.6, 1.2);
  scene.add(lanternLeft, lanternRight);
}

function getWorldAtScreen(clientX: number, clientY: number, out = new THREE.Vector3()) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  raycaster.ray.intersectPlane(gamePlane, out);
  return out;
}

function getScreenPosition(position: THREE.Vector3) {
  const projected = position.clone().project(camera);
  return {
    x: ((projected.x + 1) / 2) * window.innerWidth,
    y: ((-projected.y + 1) / 2) * window.innerHeight,
    visible: projected.z > -1 && projected.z < 1,
  };
}

function worldRadiusToPixels(position: THREE.Vector3, radius: number) {
  const center = position.clone().project(camera);
  const edge = position.clone().add(new THREE.Vector3(radius, 0, 0)).project(camera);
  return Math.max(28, Math.abs(edge.x - center.x) * window.innerWidth * 0.5);
}

function getWorldBounds() {
  const a = getWorldAtScreen(0, 0, new THREE.Vector3());
  const b = getWorldAtScreen(window.innerWidth, window.innerHeight, new THREE.Vector3());
  return {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxY: Math.max(a.y, b.y),
  };
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number) {
  return Math.floor(randomBetween(min, max + 1));
}

function chooseFruit() {
  return fruitSpecs[Math.floor(Math.random() * fruitSpecs.length)];
}

function spawnTarget(kind: TargetKind, position?: THREE.Vector3, velocity?: THREE.Vector3) {
  const radius = kind === 'fruit' ? randomBetween(0.42, 0.58) : randomBetween(0.46, 0.56);
  const group = kind === 'fruit' ? createFruit(chooseFruit(), radius) : createBomb(radius);
  const bounds = getWorldBounds();
  const startPosition = position ?? new THREE.Vector3(
    randomBetween(bounds.minX + 0.9, bounds.maxX - 0.9),
    bounds.minY - 0.55,
    randomBetween(-0.25, 0.35),
  );
  const startVelocity = velocity ?? new THREE.Vector3(
    -startPosition.x * randomBetween(0.22, 0.48) + randomBetween(-1.05, 1.05),
    randomBetween(7.25, 10.25) + Math.min(score * 0.018, 1.35),
    randomBetween(-0.08, 0.08),
  );

  group.position.copy(startPosition);
  group.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  targetGroup.add(group);

  const target: GameTarget = {
    id: nextId,
    kind,
    group,
    radius,
    velocity: startVelocity,
    spin: new THREE.Vector3(randomBetween(-3, 3), randomBetween(-5, 5), randomBetween(-3, 3)),
    sliced: false,
    fruit: kind === 'fruit' ? fruitSpecs.find((f) => f.name === group.name) : undefined,
  };
  nextId += 1;
  targets.push(target);
  return target;
}

function spawnWave() {
  const difficulty = Math.min(score / 40, 1.5);
  const count = randomInt(1, 2 + Math.floor(difficulty));
  const bombChance = Math.min(0.1 + score * 0.004, 0.28);

  for (let i = 0; i < count; i += 1) {
    const kind: TargetKind = Math.random() < bombChance && score > 4 ? 'bomb' : 'fruit';
    setTimeout(() => spawnTarget(kind), i * 120);
  }

  spawnTimer = randomBetween(Math.max(0.46, 1.18 - score * 0.012), Math.max(0.72, 1.72 - score * 0.014));
}

function removeTarget(target: GameTarget) {
  targetGroup.remove(target.group);
  disposeObject(target.group);
  targets = targets.filter((candidate) => candidate.id !== target.id);
}

function makeCutHalf(spec: FruitSpec, radius: number, geometry: THREE.BufferGeometry, side: number) {
  const group = new THREE.Group();
  const skinMaterial = new THREE.MeshStandardMaterial({
    color: spec.skin,
    map: getFruitTexture(spec),
    roughness: 0.62,
    metalness: 0.02,
    transparent: true,
  });
  const shell = new THREE.Mesh(geometry, skinMaterial);
  shell.scale.copy(spec.scale).multiplyScalar(radius);
  shell.castShadow = true;
  group.add(shell);

  const faceMaterial = new THREE.MeshStandardMaterial({
    color: spec.flesh,
    roughness: 0.5,
    metalness: 0,
    emissive: spec.flesh,
    emissiveIntensity: 0.08,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const face = new THREE.Mesh(cutFaceGeometry, faceMaterial);
  face.scale.set(radius * spec.scale.x * 0.95, radius * spec.scale.y * 0.95, 1);
  face.position.z = side * 0.005;
  group.add(face);

  return group;
}

function addFlyingObject(object: THREE.Object3D, velocity: THREE.Vector3, spin: THREE.Vector3, ttl: number, fade = true) {
  flyingObjects.push({ object, velocity, spin, age: 0, ttl, fade });
  effectGroup.add(object);
}

function setOpacity(object: THREE.Object3D, opacity: number) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!('material' in mesh)) return;
    const material = mesh.material;
    const materials = Array.isArray(material) ? material : [material];
    for (const mat of materials) {
      mat.transparent = true;
      mat.opacity = opacity;
    }
  });
}

function spawnFruitHalves(target: GameTarget, cutNormal: THREE.Vector3) {
  const spec = target.fruit ?? fruitSpecs[0];
  const pos = target.group.position.clone();
  const tangentAngle = Math.atan2(cutNormal.y, cutNormal.x) + Math.PI * 0.5;
  const baseRotation = new THREE.Euler(randomBetween(-0.5, 0.5), randomBetween(-0.3, 0.3), tangentAngle);

  const halfA = makeCutHalf(spec, target.radius, halfForwardGeometry, 1);
  const halfB = makeCutHalf(spec, target.radius, halfBackwardGeometry, -1);
  halfA.position.copy(pos);
  halfB.position.copy(pos);
  halfA.rotation.copy(baseRotation);
  halfB.rotation.copy(baseRotation);

  const split = cutNormal.clone().multiplyScalar(2.3 + Math.min(swipeKillCount, 4) * 0.12);
  addFlyingObject(
    halfA,
    target.velocity.clone().multiplyScalar(0.32).add(split).add(new THREE.Vector3(0, 1.25, 0.35)),
    new THREE.Vector3(randomBetween(-7, 7), randomBetween(-6, 6), randomBetween(-5, 5)),
    1.8,
  );
  addFlyingObject(
    halfB,
    target.velocity.clone().multiplyScalar(0.32).sub(split).add(new THREE.Vector3(0, 1.0, -0.35)),
    new THREE.Vector3(randomBetween(-7, 7), randomBetween(-6, 6), randomBetween(-5, 5)),
    1.8,
  );
}

function spawnJuice(position: THREE.Vector3, color: number, cutNormal: THREE.Vector3, amount = 28) {
  const materialColor = new THREE.Color(color);
  for (let i = 0; i < amount; i += 1) {
    const dropletMaterial = new THREE.MeshBasicMaterial({ color: materialColor, transparent: true, opacity: 1 });
    const droplet = new THREE.Mesh(dropletGeometry, dropletMaterial);
    const size = randomBetween(0.025, 0.085);
    droplet.scale.setScalar(size);
    droplet.position.copy(position).add(new THREE.Vector3(randomBetween(-0.18, 0.18), randomBetween(-0.18, 0.18), randomBetween(-0.08, 0.18)));
    const spray = cutNormal.clone().multiplyScalar(randomBetween(-1.6, 1.6));
    spray.x += randomBetween(-1.6, 1.6);
    spray.y += randomBetween(0.2, 2.8);
    spray.z += randomBetween(0.2, 1.7);
    addFlyingObject(droplet, spray, new THREE.Vector3(), randomBetween(0.45, 0.95), true);
  }
}

function makeTextSprite(text: string, color = '#fff3a6') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 180;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create text sprite.');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '900 68px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 12;
  ctx.strokeStyle = 'rgba(34, 7, 34, 0.86)';
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.9, 0.68, 1);
  return sprite;
}

function spawnFloatingText(text: string, position: THREE.Vector3, color?: string) {
  const sprite = makeTextSprite(text, color);
  sprite.position.copy(position).add(new THREE.Vector3(0, 0.35, 0.55));
  addFlyingObject(sprite, new THREE.Vector3(randomBetween(-0.18, 0.18), 1.25, 0), new THREE.Vector3(), 0.95, true);
}

function spawnExplosion(position: THREE.Vector3) {
  const flash = new THREE.PointLight(0xff6d2f, 4.2, 7);
  flash.position.copy(position).add(new THREE.Vector3(0, 0, 0.6));
  addFlyingObject(flash, new THREE.Vector3(), new THREE.Vector3(), 0.38, false);

  const colors = [0xffd35a, 0xff5b36, 0x23202b, 0xff9f2b];
  for (let i = 0; i < 52; i += 1) {
    const color = colors[i % colors.length];
    const particle = new THREE.Mesh(
      dropletGeometry,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }),
    );
    particle.scale.setScalar(randomBetween(0.045, 0.13));
    particle.position.copy(position).add(new THREE.Vector3(randomBetween(-0.08, 0.08), randomBetween(-0.08, 0.08), randomBetween(-0.04, 0.25)));
    const dir = new THREE.Vector3(randomBetween(-1, 1), randomBetween(-0.2, 1.2), randomBetween(-0.5, 1.0)).normalize();
    addFlyingObject(particle, dir.multiplyScalar(randomBetween(1.6, 5.2)), new THREE.Vector3(), randomBetween(0.5, 1.1), true);
  }
}

function createBladeSpark(point: THREE.Vector3, speed: number) {
  const material = new THREE.MeshBasicMaterial({
    color: speed > 1.1 ? 0xfff2a5 : 0x83f3ff,
    transparent: true,
    opacity: 0.68,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const spark = new THREE.Mesh(new THREE.CircleGeometry(0.13 + Math.min(speed * 0.04, 0.13), 18), material);
  spark.position.copy(point).add(new THREE.Vector3(0, 0, 0.82));
  addFlyingObject(spark, new THREE.Vector3(0, 0, 0.08), new THREE.Vector3(0, 0, randomBetween(-5, 5)), 0.22, true);
}

function updateHud() {
  scoreValue.textContent = String(score);
  livesValue.textContent = lives > 0 ? '❤ '.repeat(lives).trim() : '—';
  highValue.textContent = String(highScore);
}

function setComboMessage(message: string, hot = false) {
  comboBadge.textContent = message;
  comboBadge.classList.toggle('hot', hot);
}

function showToast(message: string) {
  toast.textContent = message;
  toast.classList.add('show');
  if (toastTimeout) window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove('show'), 1550);
}

function addScore(points: number) {
  score += points;
  if (score > highScore) {
    highScore = score;
    saveHighScore(highScore);
  }
  updateHud();
}

function loseLives(amount: number, reason: string) {
  if (gameOver) return;
  lives = Math.max(0, lives - amount);
  updateHud();
  showToast(reason);
  if (lives <= 0) {
    endGame(reason);
  }
}

function sliceTarget(target: GameTarget, cutNormal = new THREE.Vector3(1, 0, 0), speed = 1) {
  if (target.sliced || gameOver) return false;
  target.sliced = true;
  const position = target.group.position.clone();

  if (target.kind === 'bomb') {
    removeTarget(target);
    spawnExplosion(position);
    spawnFloatingText('BOMB!', position, '#ff765f');
    playBomb();
    swipeKillCount = 0;
    setComboMessage('Bomb hit! Avoid the black bombs', false);
    loseLives(2, 'Bomb blast! -2 lives');
    return true;
  }

  const spec = target.fruit ?? fruitSpecs[0];
  removeTarget(target);
  spawnFruitHalves(target, cutNormal.normalize());
  spawnJuice(position, spec.flesh, cutNormal, 30 + Math.floor(Math.min(speed, 24)));
  playSlice(speed);

  swipeKillCount += 1;
  lastComboAt = performance.now();
  const comboBonus = swipeKillCount >= 2 ? swipeKillCount : 0;
  if (comboBonus) playCombo(swipeKillCount);
  addScore(1 + comboBonus);
  spawnFloatingText(comboBonus ? `+${1 + comboBonus} COMBO` : '+1', position, comboBonus ? '#ffeb76' : '#d8ff85');

  if (swipeKillCount >= 4) {
    setComboMessage(`${swipeKillCount}x frenzy combo!`, true);
  } else if (swipeKillCount >= 2) {
    setComboMessage(`${swipeKillCount}x combo`, true);
  } else {
    setComboMessage(`${spec.name} sliced`, false);
  }
  return true;
}

function distancePointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function checkSliceSegment(a: SwipePoint, b: SwipePoint) {
  if (gameOver) return 0;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 6) return 0;

  const elapsed = Math.max(16, b.time - a.time);
  const speed = length / elapsed;
  const worldDir = new THREE.Vector3(dx, -dy, 0).normalize();
  const cutNormal = new THREE.Vector3(worldDir.y, -worldDir.x, 0).normalize();
  let sliced = 0;

  for (const target of [...targets]) {
    if (target.sliced) continue;
    const screen = getScreenPosition(target.group.position);
    if (!screen.visible) continue;
    const radiusPixels = worldRadiusToPixels(target.group.position, target.radius) * (target.kind === 'bomb' ? 1.0 : 1.18);
    const dist = distancePointToSegment(screen.x, screen.y, a.x, a.y, b.x, b.y);
    if (dist < radiusPixels + 12) {
      if (sliceTarget(target, cutNormal.clone(), speed)) sliced += 1;
    }
  }

  return sliced;
}

function onPointerDown(event: PointerEvent) {
  if (gameOver) return;
  activePointerId = event.pointerId;
  swipeKillCount = 0;
  swipePoints = [];
  const world = getWorldAtScreen(event.clientX, event.clientY, pointerWorld).clone();
  swipePoints.push({ x: event.clientX, y: event.clientY, world, time: performance.now() });
  createBladeSpark(world, 0.4);
  try {
    renderer.domElement.setPointerCapture(event.pointerId);
  } catch {
    // Some synthetic browser events do not support capture; slicing still works.
  }
}

function onPointerMove(event: PointerEvent) {
  if (gameOver || activePointerId !== event.pointerId) return;
  event.preventDefault();
  const now = performance.now();
  const world = getWorldAtScreen(event.clientX, event.clientY, pointerWorld).clone();
  const point = { x: event.clientX, y: event.clientY, world, time: now };
  const previous = swipePoints[swipePoints.length - 1];
  if (previous) {
    const speed = Math.hypot(point.x - previous.x, point.y - previous.y) / Math.max(16, point.time - previous.time);
    createBladeSpark(world, speed);
    checkSliceSegment(previous, point);
  }
  swipePoints.push(point);
  swipePoints = swipePoints.filter((candidate) => now - candidate.time < 170);
}

function onPointerUp(event: PointerEvent) {
  if (activePointerId !== event.pointerId) return;
  activePointerId = null;
  swipePoints = [];
  if (swipeKillCount <= 1) {
    window.setTimeout(() => {
      if (performance.now() - lastComboAt > 320 && !gameOver) setComboMessage('Keep swiping through fruit', false);
    }, 360);
  }
}

function updateTargets(delta: number) {
  const bounds = getWorldBounds();
  for (const target of [...targets]) {
    target.velocity.y -= gravity * delta;
    target.group.position.addScaledVector(target.velocity, delta);
    target.group.rotation.x += target.spin.x * delta;
    target.group.rotation.y += target.spin.y * delta;
    target.group.rotation.z += target.spin.z * delta;

    if (target.kind === 'bomb') {
      const glow = target.group.children.find((child) => child instanceof THREE.PointLight) as THREE.PointLight | undefined;
      if (glow) glow.intensity = 0.95 + Math.sin(clock.elapsedTime * 16 + target.id) * 0.35;
    }

    if (target.group.position.y < bounds.minY - 0.75 || Math.abs(target.group.position.x) > Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX)) + 2.5) {
      removeTarget(target);
      if (target.kind === 'fruit' && !target.sliced && !gameOver) {
        loseLives(1, 'Fruit dropped! -1 life');
        setComboMessage('Fruit dropped — slice sooner', false);
      }
    }
  }
}

function updateFlyingObjects(delta: number) {
  for (const item of [...flyingObjects]) {
    item.age += delta;
    item.velocity.y -= gravity * 0.78 * delta;
    item.object.position.addScaledVector(item.velocity, delta);
    item.object.rotation.x += item.spin.x * delta;
    item.object.rotation.y += item.spin.y * delta;
    item.object.rotation.z += item.spin.z * delta;

    const life = Math.max(0, 1 - item.age / item.ttl);
    if (item.fade) setOpacity(item.object, life);
    if (item.object instanceof THREE.PointLight) item.object.intensity = 4.2 * life;
    item.object.scale.multiplyScalar(item.object instanceof THREE.Sprite ? 1 + delta * 0.18 : 1);

    if (item.age >= item.ttl) {
      effectGroup.remove(item.object);
      disposeObject(item.object);
      flyingObjects = flyingObjects.filter((candidate) => candidate !== item);
    }
  }
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if ('geometry' in mesh && mesh.geometry instanceof THREE.BufferGeometry && !(child instanceof THREE.Sprite) && !sharedGeometries.has(mesh.geometry)) {
      mesh.geometry.dispose();
    }
    if ('material' in mesh) {
      const material = mesh.material;
      const materials = Array.isArray(material) ? material : [material];
      for (const mat of materials) {
        const maybeMap = (mat as THREE.MeshBasicMaterial).map;
        if (maybeMap && ![...textureCache.values()].includes(maybeMap as THREE.CanvasTexture)) maybeMap.dispose();
        mat.dispose();
      }
    }
  });
}

function updateSpawn(delta: number) {
  if (gameOver) return;
  spawnTimer -= delta;
  if (spawnTimer <= 0) spawnWave();
}

function clearDynamicScene() {
  for (const target of targets) {
    targetGroup.remove(target.group);
    disposeObject(target.group);
  }
  for (const item of flyingObjects) {
    effectGroup.remove(item.object);
    disposeObject(item.object);
  }
  targets = [];
  flyingObjects = [];
  swipePoints = [];
  activePointerId = null;
  trailMesh.visible = false;
}

function startGame(withAudio = true) {
  if (withAudio) resumeAudio();
  clearDynamicScene();
  score = 0;
  lives = 3;
  gameOver = false;
  spawnTimer = 0.15;
  swipeKillCount = 0;
  overlay.classList.remove('visible');
  overlayTitle.textContent = 'Fruit Slash Dojo';
  overlayText.textContent = 'Swipe or drag through flying fruit. Chain combos, avoid bombs, and do not let fruit fall.';
  startButton.textContent = 'Restart';
  setComboMessage('Swipe through fruit to score', false);
  updateHud();
  showToast('Slice fruit. Avoid bombs.');
  if (withAudio) playStart();
}

function endGame(reason: string) {
  if (gameOver) return;
  gameOver = true;
  activePointerId = null;
  swipePoints = [];
  trailMesh.visible = false;
  overlayTitle.textContent = score >= highScore && score > 0 ? 'New Best Score!' : 'Game Over';
  overlayText.textContent = `${reason} Final score: ${score}. Swipe faster, chain fruit, and avoid bombs next run.`;
  startButton.textContent = 'Play again';
  overlay.classList.add('visible');
  setComboMessage('Run finished', false);
  updateHud();
  playGameOver();
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  const delta = Math.min(clock.getDelta(), 0.033);
  updateSpawn(delta);
  updateTargets(delta);
  updateFlyingObjects(delta);
  updateTrail();

  if (!gameOver && performance.now() - lastComboAt > 900 && swipeKillCount > 0) {
    swipeKillCount = 0;
    setComboMessage('Build a combo with one swipe', false);
  }

  camera.position.x += (Math.sin(clock.elapsedTime * 0.23) * 0.08 - camera.position.x) * delta * 0.6;
  camera.lookAt(0, 0.55, 0);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function initDebugApi() {
  window.__fruitNinjaDebug = {
    spawnFruitAtScreen: (x: number, y: number) => {
      if (gameOver) startGame(false);
      const world = getWorldAtScreen(x, y, new THREE.Vector3()).clone();
      const target = spawnTarget('fruit', world, new THREE.Vector3(0, 0, 0));
      return target.id;
    },
    spawnBombAtScreen: (x: number, y: number) => {
      if (gameOver) startGame(false);
      const world = getWorldAtScreen(x, y, new THREE.Vector3()).clone();
      const target = spawnTarget('bomb', world, new THREE.Vector3(0, 0, 0));
      return target.id;
    },
    sliceAtScreen: (x: number, y: number) => {
      if (gameOver) return 0;
      const pointA: SwipePoint = { x: x - 36, y: y - 3, world: getWorldAtScreen(x - 36, y - 3, new THREE.Vector3()).clone(), time: performance.now() };
      const pointB: SwipePoint = { x: x + 36, y: y + 3, world: getWorldAtScreen(x + 36, y + 3, new THREE.Vector3()).clone(), time: performance.now() + 16 };
      return checkSliceSegment(pointA, pointB);
    },
    getState: () => ({ score, lives, gameOver, activeTargets: targets.length, trailVisible: trailMesh.visible, muted: audioMuted }),
    toggleMute,
    restart: () => startGame(false),
  };
}

createDojo();
setupLights();
updateHud();
setComboMessage('Ready to slice', false);
applyMuteUi();
startButton.addEventListener('click', () => startGame(true));
muteButton.addEventListener('click', toggleMute);
window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  const key = event.key.toLowerCase();
  if (key === 'm') {
    toggleMute();
  } else if ((key === 'enter' || key === ' ') && gameOver) {
    event.preventDefault();
    startGame(true);
  }
});
renderer.domElement.addEventListener('pointerdown', onPointerDown);
renderer.domElement.addEventListener('pointermove', onPointerMove, { passive: false });
renderer.domElement.addEventListener('pointerup', onPointerUp);
renderer.domElement.addEventListener('pointercancel', onPointerUp);
window.addEventListener('resize', onResize);
initDebugApi();
animate();
