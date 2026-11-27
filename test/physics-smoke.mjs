// Headless-смоук-тесты физики GORILLA RUSH.
// Извлекает игровой модуль из index.html, подменяет рендер/DOM заглушками
// и проверяет ключевую механику: бег на руках, лазание, гравитацию, шлепки,
// стены, вис на зацепе и ИИ-преследование.
// Запуск: npm install && npm test
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const m = html.match(/<script type="module">\n([\s\S]*?)\n<\/script>/);
if (!m) { console.error('FAIL: игровой модуль не найден в index.html'); process.exit(1); }

const threeUrl = pathToFileURL(path.join(repoRoot, 'node_modules', 'three', 'build', 'three.module.js'));

function flexObj() {
  return new Proxy(function () {}, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'length') return 0;
      if (k === 'then') return undefined;
      return flexObj();
    },
    set: () => true,
    apply: () => flexObj()
  });
}
const flexClass = () => function () { return flexObj(); };

const shim = `
function flexObj() {
  return new Proxy(function () {}, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'length') return 0;
      if (k === 'then') return undefined;
      return flexObj();
    },
    set: () => true,
    apply: () => flexObj()
  });
}
const flexClass = () => function () { return flexObj(); };
import * as T from '${threeUrl}';
${['Vector3','Vector2','Quaternion','Color','Plane','Clock','Raycaster','PCFSoftShadowMap']
  .map(n => `export const ${n} = T.${n};`).join('\n')}
${['WebGLRenderer','Scene','PerspectiveCamera','HemisphereLight','DirectionalLight','Fog',
   'PlaneGeometry','BoxGeometry','CylinderGeometry','ConeGeometry','CircleGeometry',
   'IcosahedronGeometry','SphereGeometry','MeshStandardMaterial','MeshBasicMaterial',
   'Mesh','Group'].map(n => `export const ${n} = flexClass();`).join('\n')}
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gorilla-test-'));
fs.writeFileSync(path.join(dir, 'shim.mjs'), shim);
fs.writeFileSync(path.join(dir, 'game.mjs'),
  m[1].replace("import * as THREE from 'three';", "import * as THREE from './shim.mjs';") +
  `\nexport { players, human, bot, stepPlayer, collideSphere, keys, ANCHOR_GAIN, TRANSFER, TRANSFER_Y, MAX_PUSH, MAX_PUSH_Y, CLIMB_BOOST, UP_DAMP, HAND_R, BODY_R, REACH, GRAV, botLocomotion, updateAI, handLift };\n`);

const elems = {};
const byId = id => elems[id] ||= { style: {}, innerHTML: '', textContent: '', appendChild() {}, onclick: null };
globalThis.document = { getElementById: byId, addEventListener() {}, pointerLockElement: null, exitPointerLock() {} };
globalThis.window = globalThis;
globalThis.innerWidth = 1280; globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;
globalThis.addEventListener = () => {};
globalThis.requestAnimationFrame = () => 0;

const g = await import(pathToFileURL(path.join(dir, 'game.mjs')));
const { players, human, bot, stepPlayer, HAND_R, BODY_R, REACH, ANCHOR_GAIN, CLIMB_BOOST, UP_DAMP, TRANSFER, TRANSFER_Y, MAX_PUSH, MAX_PUSH_Y, GRAV, botLocomotion, handLift } = g;

const DT = 1 / 60, SUB = 3, H = DT / SUB;
function run(frames, onFrame) {
  for (let f = 0; f < frames; f++) {
    if (onFrame) onFrame(f);
    for (let i = 0; i < SUB; i++)
      for (const pl of players) stepPlayer(pl, H);
  }
}
let pass = 0, fail = 0;
const check = (name, cond, info) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  (${info})`); };
const resetHands = () => human.hands.forEach(h => { h.anchored = false; h.v.set(0,0,0); h.p.copy(human.bp); h.target.copy(human.bp); });

// Эмуляция управления мышью (та же математика, что в humanControl)
function humanFrame(aim) {
  for (const hd of human.hands) {
    const nt = aim.clone(); nt.y = Math.max(nt.y, 0.12);
    const off = nt.clone().sub(human.bp);
    const L = off.length();
    if (L > REACH * 0.98) nt.copy(human.bp).addScaledVector(off, REACH * 0.98 / L);
    const delta = nt.sub(hd.target);
    const dl = delta.length();
    if (dl > 1.1) delta.multiplyScalar(1.1 / dl);
    if (hd.anchored && !handLift(hd)) {
      human.bv.x -= delta.x * ANCHOR_GAIN;
      human.bv.z -= delta.z * ANCHOR_GAIN;
      human.bv.y -= delta.y * ANCHOR_GAIN * (delta.y > 0 ? UP_DAMP : CLIMB_BOOST);
    }
    hd.target.add(delta);
  }
}

// A: тело лежит на полу
human.bp.set(0, 0.2, 0); human.bv.set(0,0,0); resetHands();
run(90);
check('A покой на полу', Math.abs(human.bp.y - BODY_R) < 0.02, `bp.y=${human.bp.y.toFixed(3)}`);

// B: бег на руках: посадка -> тяга назад -> перекид по воздуху
human.bp.set(0, BODY_R + 0.01, 0); human.bv.set(0,0,0); resetHands();
const z0 = human.bp.z;
const aim = human.bp.clone();
run(240, f => {
  const phase = f % 36;
  if (phase < 6) aim.set(0, 1.0, human.bp.z - 1.0);
  else if (phase < 30) { aim.y = 0.2; aim.z += 6 * DT; }
  else aim.set(0, 1.0, human.bp.z - 1.0);
  humanFrame(aim);
});
const dz = z0 - human.bp.z;
check('B бег на руках', dz > 2 && Math.abs(human.bp.y - BODY_R) < 0.4, `пройдено ${dz.toFixed(2)}м, y=${human.bp.y.toFixed(2)}`);

// C: лазание: ладонь зацеплена выше, мышь тянет прицел вниз
human.bp.set(0, 0.8, 0); human.bv.set(0,0,0);
const hd = human.hands[0];
hd.anchored = true; hd.anchor.set(0.5, 3.0, 0.2); hd.p.copy(hd.anchor); hd.v.set(0,0,0);
hd.n = hd.anchor.clone(); hd.n.set(0, 0, 1);
hd.target.copy(hd.anchor);
const h1 = human.hands[1]; h1.anchored = false; h1.v.set(0,0,0); h1.p.copy(human.bp); h1.target.copy(human.bp);
const y0 = human.bp.y;
const aimC = hd.anchor.clone();
run(40, () => {
  if (hd.anchored && hd.anchor.y - aimC.y < 1.6) aimC.y -= 10 * DT;
  if (!hd.anchored) hd.anchored = true;
  humanFrame(aimC);
});
check('C подтягивание', human.bp.y > y0 + 0.2, `подъём ${(human.bp.y - y0).toFixed(2)}м`);

// D: свободное падение
human.bp.set(0, 5, 0); human.bv.set(0,0,0); resetHands();
run(30);
check('D гравитация', human.bv.y < -8 && human.bp.y < 5, `vy=${human.bv.y.toFixed(1)}`);

// E: шлепок ладонью вниз -> импульс телу вверх
human.bp.set(0, 3, 0); human.bv.set(0,0,0);
human.hands.forEach(h => { h.anchored = false; h.p.set(0.4 * h.side, 2.5, 0); h.v.set(0,-9,0); h.target.set(0.4 * h.side, 0.2, 0); });
let slapV = 0;
run(30, () => { if (!slapV && human.hands.some(h => h.anchored)) slapV = human.bv.y; });
check('E импульс шлепка', slapV > 2, `bv.y=${slapV.toFixed(2)}`);

// F: стены арены удерживают тело
human.bp.set(24.2, 1, 0); human.bv.set(8,0,0); resetHands();
run(60);
check('F стены арены', human.bp.x < 25.0, `bp.x=${human.bp.x.toFixed(2)}`);

// G: вис на зацепе
human.bp.set(0, 1.0, 0); human.bv.set(0,0,0);
const hg = human.hands[0];
hg.anchored = true; hg.anchor.set(0, 4.5, 0); hg.p.copy(hg.anchor); hg.v.set(0,0,0); hg.target.copy(hg.anchor);
hg.n = hg.anchor.clone(); hg.n.set(0, 1, 0);
human.hands[1].anchored = false; human.hands[1].v.set(0,0,0); human.hands[1].p.copy(human.bp); human.hands[1].target.copy(human.bp);
run(120);
check('G вис на зацепе', human.bp.y > 0.6 && human.hands[0].anchored, `y=${human.bp.y.toFixed(2)}`);

// H: бот-охотник догоняет цель, отталкиваясь руками
bot.bp.set(0, 0.6, 0); bot.bv.set(0,0,0);
bot.hands.forEach(h => { h.anchored = false; h.v.set(0,0,0); h.p.copy(bot.bp); h.target.copy(bot.bp); });
const victim = players[2];
victim.bp.set(0, BODY_R + 0.01, -12); victim.bv.set(0,0,0);
victim.hands.forEach(h => { h.anchored = true; h.anchor.set(0.3 * h.side, HAND_R, -12); h.p.copy(h.anchor); h.v.set(0,0,0); h.target.copy(h.anchor); });
const bz0 = bot.bp.z;
const chaseDir = bot.bp.clone();
let nan = false;
for (let f = 0; f < 300; f++) {
  chaseDir.copy(victim.bp).sub(bot.bp);
  botLocomotion(bot, chaseDir, DT);
  for (let i = 0; i < SUB; i++) stepPlayer(bot, H);
  if (![bot.bp.x, bot.bp.y, bot.bp.z].every(isFinite)) { nan = true; break; }
}
const approach = bz0 - bot.bp.z;
check('H бот догоняет', !nan && approach > 1.5, `приблизился на ${approach.toFixed(2)}м, nan=${nan}`);
check('I координаты конечны', players.every(p => [p.bp.x,p.bp.y,p.bp.z,p.bv.x,p.bv.y,p.bv.z].every(isFinite)), 'нет NaN');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

function pathToFileURL(p) { return 'file://' + p.split(path.sep).map(encodeURIComponent).join('/'); }
