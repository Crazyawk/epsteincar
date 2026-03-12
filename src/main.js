import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';
import { HALF_WORLD, MAX_POLICE_HITS, MINIMAP_RADIUS, ROAD_HALF, ROAD_POSITIONS } from './config.js';
import { dist2, isOnRoad } from './utils.js';
import { WorldBuilder } from './world.js';
import { PlayerVehicle, TrafficManager, PoliceManager } from './vehicle.js';

const loading = document.getElementById('loading');
const speedEl = document.getElementById('speed');
const wantedEl = document.getElementById('wanted');
const hitsEl = document.getElementById('hits');
const lightEl = document.getElementById('light');
const trafficEl = document.getElementById('traffic');
const policeEl = document.getElementById('police');
const messageEl = document.getElementById('message');
const flashEl = document.getElementById('flash');
const minimap = document.getElementById('minimap');
const mm = minimap.getContext('2d');

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc4e4ff, 400, 2400);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 4000);
const ambient = new THREE.HemisphereLight(0xffffff, 0x6f8f58, 1.18);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(180, 280, 120);
scene.add(sun);

const textureLoader = new THREE.TextureLoader();
const physicsWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
physicsWorld.broadphase = new CANNON.SAPBroadphase(physicsWorld);
physicsWorld.defaultContactMaterial.friction = 0.45;
physicsWorld.defaultContactMaterial.restitution = 0.0;
physicsWorld.solver.iterations = 8;
const roadMaterial = new CANNON.Material('road');
physicsWorld.defaultContactMaterial = new CANNON.ContactMaterial(roadMaterial, roadMaterial, { friction: 0.5, restitution: 0.0 });

const state = {
  keys: {},
  wanted: 0,
  policeHits: 0,
  lightState: { nsGreen: true, timer: 0 },
  prevInsideIntersection: false,
  offenseCooldown: 0,
  crashCooldown: 0,
  busted: false,
};

function showMsg(text, ms = 900) {
  messageEl.textContent = text;
  messageEl.style.opacity = '1';
  clearTimeout(showMsg.t);
  showMsg.t = setTimeout(() => (messageEl.style.opacity = '0'), ms);
}
function bustedFlash() {
  let n = 0;
  clearInterval(bustedFlash.t);
  bustedFlash.t = setInterval(() => {
    flashEl.style.opacity = n % 2 === 0 ? '0.9' : '0';
    flashEl.style.background = n % 4 < 2 ? 'rgba(255,0,0,.95)' : 'rgba(0,0,0,1)';
    n += 1;
    if (n > 10) {
      clearInterval(bustedFlash.t);
      flashEl.style.opacity = '0';
    }
  }, 70);
}

const worldBuilder = new WorldBuilder(scene, physicsWorld, textureLoader);
const worldData = await worldBuilder.build();
const player = new PlayerVehicle(scene, physicsWorld, textureLoader, roadMaterial);
await player.init();
const traffic = new TrafficManager(scene, ROAD_POSITIONS);
traffic.init(34);
const police = new PoliceManager(scene, ROAD_POSITIONS);

trafficEl.textContent = traffic.cars.length;
policeEl.textContent = police.cars.length;

function updateTrafficLights(dt) {
  state.lightState.timer += dt;
  if (state.lightState.timer > 8) {
    state.lightState.timer = 0;
    state.lightState.nsGreen = !state.lightState.nsGreen;
  }
  for (const l of worldData.trafficLights) {
    const greenOn = l.isNS ? state.lightState.nsGreen : !state.lightState.nsGreen;
    l.red.material.color.setHex(greenOn ? 0x330000 : 0xff2020);
    l.yellow.material.color.setHex(0x332900);
    l.green.material.color.setHex(greenOn ? 0x26ff5e : 0x003300);
  }
  lightEl.textContent = state.lightState.nsGreen ? 'NS green' : 'EW green';
}

function nearestIntersection(x, z) {
  let best = null;
  let bestD = 1e18;
  for (const it of worldData.intersections) {
    const d = dist2(x, z, it.x, it.z);
    if (d < bestD) {
      bestD = d;
      best = it;
    }
  }
  return { intersection: best, d2: bestD };
}

function laneAxisAtPoint(x, z) {
  for (const r of ROAD_POSITIONS) {
    if (Math.abs(z - r) <= 8) return 'x';
    if (Math.abs(x - r) <= 8) return 'z';
  }
  return null;
}

function raiseWanted(amount, why) {
  const prev = state.wanted;
  state.wanted = Math.min(10, state.wanted + amount);
  wantedEl.textContent = state.wanted;
  const targetPolice = Math.min(2 + Math.floor(state.wanted / 2), 8);
  police.setTargetCount(targetPolice, player.chassisBody.position.x, player.chassisBody.position.z);
  policeEl.textContent = police.cars.length;
  if (state.wanted > prev && why) showMsg(why);
}

function checkCrimes(dt) {
  state.offenseCooldown -= dt;
  state.crashCooldown -= dt;
  const px = player.chassisBody.position.x;
  const pz = player.chassisBody.position.z;
  const { intersection, d2 } = nearestIntersection(px, pz);
  const inside = intersection && d2 < 18 * 18;
  const axis = laneAxisAtPoint(px, pz);
  if (inside && !state.prevInsideIntersection && player.speedKmh > 65 && axis && state.offenseCooldown <= 0) {
    let redForPlayer = false;
    if (axis === 'z') redForPlayer = !state.lightState.nsGreen;
    if (axis === 'x') redForPlayer = state.lightState.nsGreen;
    if (redForPlayer) {
      raiseWanted(1, 'RED LIGHT');
      state.offenseCooldown = 1.4;
    }
  }
  state.prevInsideIntersection = inside;
}

function handleTrafficCollisions(dt) {
  const px = player.chassisBody.position.x;
  const pz = player.chassisBody.position.z;
  for (const car of traffic.cars) {
    if (dist2(px, pz, car.group.position.x, car.group.position.z) < 50) {
      if (state.crashCooldown <= 0) {
        raiseWanted(1, 'HIT AND RUN');
        state.crashCooldown = 1.2;
      }
      const dx = px - car.group.position.x;
      const dz = pz - car.group.position.z;
      player.chassisBody.velocity.x += dx * 0.35;
      player.chassisBody.velocity.z += dz * 0.35;
    }
  }
}

function handlePoliceHits(dt) {
  police.hitCooldown -= dt;
  const px = player.chassisBody.position.x;
  const pz = player.chassisBody.position.z;
  for (const car of police.cars) {
    if (dist2(px, pz, car.x, car.z) < 60 && police.hitCooldown <= 0) {
      police.hitCooldown = 0.7;
      state.policeHits += 1;
      hitsEl.textContent = state.policeHits;
      showMsg('POLICE HIT');
      player.chassisBody.velocity.x *= 0.7;
      player.chassisBody.velocity.z *= 0.7;
      if (state.policeHits >= MAX_POLICE_HITS && !state.busted) {
        state.busted = true;
        bustedFlash();
        showMsg('BUSTED', 1400);
        setTimeout(() => {
          player.reset();
          state.policeHits = 0;
          state.wanted = 0;
          state.busted = false;
          hitsEl.textContent = state.policeHits;
          wantedEl.textContent = state.wanted;
          police.setTargetCount(0, 0, 0);
          policeEl.textContent = police.cars.length;
        }, 1000);
      }
    }
  }
}

function decayWanted(dt) {
  if (state.wanted <= 0) return;
  const px = player.chassisBody.position.x;
  const pz = player.chassisBody.position.z;
  const closePolice = police.cars.some(p => dist2(px, pz, p.x, p.z) < 280 * 280);
  decayWanted.acc = decayWanted.acc || 0;
  if (!closePolice) {
    decayWanted.acc += dt;
    if (decayWanted.acc > 14) {
      decayWanted.acc = 0;
      state.wanted -= 1;
      wantedEl.textContent = state.wanted;
      const targetPolice = Math.min(2 + Math.floor(state.wanted / 2), 8);
      police.setTargetCount(targetPolice, px, pz);
      policeEl.textContent = police.cars.length;
      if (state.wanted === 0) showMsg('ESCAPED');
    }
  } else {
    decayWanted.acc = 0;
  }
}

function updateMinimap() {
  const px = player.chassisBody.position.x;
  const pz = player.chassisBody.position.z;
  mm.clearRect(0, 0, 140, 140);
  mm.fillStyle = '#5ab04f';
  mm.fillRect(0, 0, 140, 140);
  const scale = 140 / (MINIMAP_RADIUS * 2);

  mm.save();
  mm.translate(70, 70);
  mm.rotate(player.group.rotation.y);
  mm.translate(-px * scale, -pz * scale);

  mm.fillStyle = '#2f2f31';
  for (const r of ROAD_POSITIONS) {
    mm.fillRect(-HALF_WORLD * scale, r * scale - (ROAD_HALF * scale), HALF_WORLD * 2 * scale, ROAD_HALF * 2 * scale);
    mm.fillRect(r * scale - (ROAD_HALF * scale), -HALF_WORLD * scale, ROAD_HALF * 2 * scale, HALF_WORLD * 2 * scale);
  }

  for (const p of police.cars) {
    mm.fillStyle = '#1e63ff';
    mm.beginPath();
    mm.arc(p.x * scale, p.z * scale, 3.5, 0, Math.PI * 2);
    mm.fill();
    mm.fillStyle = '#fff';
    mm.font = 'bold 6px Arial';
    mm.fillText('P', p.x * scale - 2, p.z * scale + 2);
  }

  for (let i = 0; i < traffic.cars.length; i += 2) {
    const c = traffic.cars[i];
    mm.fillStyle = '#ffd23b';
    mm.fillRect(c.group.position.x * scale - 1.4, c.group.position.z * scale - 1.4, 2.8, 2.8);
  }
  mm.restore();

  mm.strokeStyle = 'rgba(255,255,255,.2)';
  mm.strokeRect(0.5, 0.5, 139, 139);
  mm.fillStyle = '#fff';
  mm.beginPath();
  mm.moveTo(70, 61);
  mm.lineTo(75, 78);
  mm.lineTo(70, 74);
  mm.lineTo(65, 78);
  mm.closePath();
  mm.fill();
}

function updateCamera(dt) {
  const pos = player.group.position;
  const yaw = player.group.rotation.y;
  if (player.cameraMode === 0) {
    const back = new THREE.Vector3(Math.sin(yaw), 0.22, Math.cos(yaw)).multiplyScalar(-13);
    const target = pos.clone().add(back).add(new THREE.Vector3(0, 5.5, 0));
    camera.position.lerp(target, 0.09);
    camera.lookAt(pos.x, pos.y + 1.8, pos.z);
  } else if (player.cameraMode === 1) {
    const side = new THREE.Vector3(Math.cos(yaw) * 8, 4.2, -Math.sin(yaw) * 8);
    const target = pos.clone().add(side);
    camera.position.lerp(target, 0.08);
    camera.lookAt(pos.x, pos.y + 1.5, pos.z);
  } else {
    const target = pos.clone().add(new THREE.Vector3(0, 30, 0.01));
    camera.position.lerp(target, 0.07);
    camera.lookAt(pos.x, pos.y, pos.z);
  }
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  state.keys[k] = true;
  if (k === 'c') player.cameraMode = (player.cameraMode + 1) % 3;
  if (k === 'r') {
    player.reset();
    state.wanted = 0;
    state.policeHits = 0;
    hitsEl.textContent = '0';
    wantedEl.textContent = '0';
    police.setTargetCount(0, 0, 0);
    policeEl.textContent = '0';
  }
});
window.addEventListener('keyup', (e) => {
  state.keys[e.key.toLowerCase()] = false;
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const fixedTimeStep = 1 / 60;
let accumulator = 0;
let last = performance.now() / 1000;

function tick(nowMs) {
  requestAnimationFrame(tick);
  const now = nowMs / 1000;
  let dt = Math.min(now - last, 0.05);
  last = now;
  accumulator += dt;

  updateTrafficLights(dt);
  traffic.update(dt, state.lightState.nsGreen);
  police.update(dt, player.chassisBody.position.x, player.chassisBody.position.z, state.wanted);

  while (accumulator >= fixedTimeStep) {
    player.applyControls(state.keys);
    physicsWorld.step(fixedTimeStep);
    accumulator -= fixedTimeStep;
  }

  // offroad slowdown
  const px = player.chassisBody.position.x;
  const pz = player.chassisBody.position.z;
  if (!isOnRoad(px, pz, ROAD_POSITIONS, ROAD_HALF)) {
    player.chassisBody.velocity.x *= 0.985;
    player.chassisBody.velocity.z *= 0.985;
  }

  // keep in world
  player.chassisBody.position.x = Math.max(-HALF_WORLD + 12, Math.min(HALF_WORLD - 12, player.chassisBody.position.x));
  player.chassisBody.position.z = Math.max(-HALF_WORLD + 12, Math.min(HALF_WORLD - 12, player.chassisBody.position.z));

  checkCrimes(dt);
  handleTrafficCollisions(dt);
  handlePoliceHits(dt);
  decayWanted(dt);

  player.updateFromPhysics();
  updateCamera(dt);
  updateMinimap();

  speedEl.textContent = Math.round(player.speedKmh).toString();
  policeEl.textContent = police.cars.length.toString();

  renderer.render(scene, camera);
}

loading.style.display = 'none';
requestAnimationFrame(tick);
