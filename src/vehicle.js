import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';
import { HALF_WORLD, PHOTO_URL, ROAD_POSITIONS } from './config.js';
import { clamp, pick } from './utils.js';

const trafficColors = [0xff4747, 0x3f87ff, 0xffffff, 0x131313, 0xf0c230, 0x58d26d, 0xaf6cff];

export class PlayerVehicle {
  constructor(scene, physicsWorld, textureLoader, worldMaterial) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.textureLoader = textureLoader;
    this.worldMaterial = worldMaterial;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.wheelMeshes = [];
    this.speedKmh = 0;
    this.cameraMode = 0;
    this.steerVisual = 0;
    this.photoTexture = null;
  }

  async init() {
    this.photoTexture = await new Promise(resolve => {
      this.textureLoader.load(PHOTO_URL, tex => { tex.colorSpace = THREE.SRGBColorSpace; resolve(tex); }, undefined, () => resolve(null));
    });

    const chassisShape = new CANNON.Box(new CANNON.Vec3(1.8, 0.55, 3.6));
    this.chassisBody = new CANNON.Body({
      mass: 1250,
      material: this.worldMaterial,
      position: new CANNON.Vec3(0, 2.2, 0),
      angularDamping: 0.45,
      linearDamping: 0.05,
    });
    this.chassisBody.addShape(chassisShape, new CANNON.Vec3(0, 0.35, 0));
    this.physicsWorld.addBody(this.chassisBody);

    this.vehicle = new CANNON.RaycastVehicle({
      chassisBody: this.chassisBody,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2,
    });

    const wheelOptions = {
      radius: 0.46,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      suspensionStiffness: 38,
      suspensionRestLength: 0.34,
      frictionSlip: 3.8,
      dampingRelaxation: 2.8,
      dampingCompression: 4.4,
      maxSuspensionForce: 100000,
      rollInfluence: 0.02,
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      chassisConnectionPointLocal: new CANNON.Vec3(-1, 0, 1),
      maxSuspensionTravel: 0.34,
      customSlidingRotationalSpeed: -30,
      useCustomSlidingRotationalSpeed: true,
    };

    const positions = [
      new CANNON.Vec3(-1.2, 0.1, 2.25),
      new CANNON.Vec3( 1.2, 0.1, 2.25),
      new CANNON.Vec3(-1.2, 0.1,-2.1),
      new CANNON.Vec3( 1.2, 0.1,-2.1),
    ];
    positions.forEach((p, i) => {
      wheelOptions.chassisConnectionPointLocal = p;
      if (i >= 2) wheelOptions.frictionSlip = 4.2;
      this.vehicle.addWheel(wheelOptions);
    });
    this.vehicle.addToWorld(this.physicsWorld);

    this.buildVisuals();
  }

  buildVisuals() {
    const bodyMat = this.photoTexture ? new THREE.MeshLambertMaterial({ map: this.photoTexture }) : new THREE.MeshLambertMaterial({ color: 0xe6e6e6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.15, 8.8), [bodyMat, bodyMat, bodyMat, bodyMat, bodyMat, bodyMat]);
    body.position.y = 1.45;
    this.group.add(body);
    const hood = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.2), this.photoTexture ? new THREE.MeshLambertMaterial({ map: this.photoTexture }) : new THREE.MeshLambertMaterial({ color: 0xffffff }));
    hood.rotation.x = -Math.PI / 2;
    hood.position.set(0, 2.05, 1.2);
    this.group.add(hood);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 3.4), new THREE.MeshLambertMaterial({ color: 0x9bc8ff, transparent: true, opacity: 0.75 }));
    cabin.position.set(0, 2.25, -0.2);
    this.group.add(cabin);
    const rear = new THREE.Mesh(new THREE.BoxGeometry(4, 0.72, 1.8), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    rear.position.set(0, 1.85, -2.9);
    this.group.add(rear);

    const wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.38, 14);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(wheelGeo, wheelMat);
      m.rotation.z = Math.PI / 2;
      this.scene.add(m);
      this.wheelMeshes.push(m);
    }
  }

  updateFromPhysics() {
    this.group.position.copy(this.chassisBody.position);
    this.group.quaternion.copy(this.chassisBody.quaternion);
    this.speedKmh = Math.abs(this.vehicle.currentVehicleSpeedKmHour);

    for (let i = 0; i < this.vehicle.wheelInfos.length; i++) {
      this.vehicle.updateWheelTransform(i);
      const t = this.vehicle.wheelInfos[i].worldTransform;
      this.wheelMeshes[i].position.copy(t.position);
      this.wheelMeshes[i].quaternion.copy(t.quaternion);
    }
  }

  applyControls(keys) {
    const maxSteerVal = 0.42;
    const maxForce = 1600;
    const brakeForce = 42;
    const handBrakeForce = 70;
    const forward = keys['w'] || keys['arrowup'];
    const backward = keys['s'] || keys['arrowdown'];
    const left = keys['a'] || keys['arrowleft'];
    const right = keys['d'] || keys['arrowright'];
    const handbrake = keys[' '];

    let engineForce = 0;
    let brake = 0;
    if (forward) engineForce = -maxForce;
    else if (backward) engineForce = maxForce * 0.7;
    else brake = 8;
    if (handbrake) brake = handBrakeForce;

    const steerTarget = left ? maxSteerVal : right ? -maxSteerVal : 0;
    this.steerVisual += (steerTarget - this.steerVisual) * 0.15;

    this.vehicle.setSteeringValue(this.steerVisual, 0);
    this.vehicle.setSteeringValue(this.steerVisual, 1);
    this.vehicle.applyEngineForce(engineForce, 2);
    this.vehicle.applyEngineForce(engineForce, 3);
    this.vehicle.setBrake(brake, 0); this.vehicle.setBrake(brake, 1); this.vehicle.setBrake(brake, 2); this.vehicle.setBrake(brake, 3);
    if (!handbrake) {
      this.vehicle.setBrake(forward || backward ? 0 : brakeForce * 0.2, 0);
      this.vehicle.setBrake(forward || backward ? 0 : brakeForce * 0.2, 1);
    }

    // mild anti-roll / upright assist
    this.chassisBody.angularVelocity.x *= 0.96;
    this.chassisBody.angularVelocity.z *= 0.96;
    if (this.chassisBody.position.y < -10) this.reset();
  }

  reset() {
    this.chassisBody.position.set(0, 2.2, 0);
    this.chassisBody.velocity.setZero();
    this.chassisBody.angularVelocity.setZero();
    this.chassisBody.quaternion.setFromEuler(0, 0, 0);
  }
}

export class TrafficManager {
  constructor(scene, roads) {
    this.scene = scene;
    this.roads = roads;
    this.cars = [];
    this.lanes = [];
    for (const r of roads) {
      this.lanes.push({ axis: 'x', coord: r - 7.5, dir: 1, min: -HALF_WORLD + 30, max: HALF_WORLD - 30 });
      this.lanes.push({ axis: 'x', coord: r + 7.5, dir: -1, min: -HALF_WORLD + 30, max: HALF_WORLD - 30 });
      this.lanes.push({ axis: 'z', coord: r - 7.5, dir: -1, min: -HALF_WORLD + 30, max: HALF_WORLD - 30 });
      this.lanes.push({ axis: 'z', coord: r + 7.5, dir: 1, min: -HALF_WORLD + 30, max: HALF_WORLD - 30 });
    }
  }

  init(count = 36) {
    for (let i = 0; i < count; i++) this.cars.push(this.createTrafficCar());
  }

  createTrafficCar() {
    const lane = pick(this.lanes);
    const group = new THREE.Group();
    const col = pick(trafficColors);
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.1, 1.1, 8), new THREE.MeshLambertMaterial({ color: col }));
    body.position.y = 1.3;
    group.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.9, 2.8), new THREE.MeshLambertMaterial({ color: 0x9bc8ff, transparent: true, opacity: 0.72 }));
    cabin.position.set(0, 2.05, -0.1);
    group.add(cabin);
    this.scene.add(group);
    return { group, lane, t: lane.min + Math.random() * (lane.max - lane.min), speed: 0.18 + Math.random() * 0.18 };
  }

  update(dt, nsGreen) {
    for (const car of this.cars) {
      let move = car.speed;
      if (car.lane.axis === 'x') {
        for (const ix of ROAD_POSITIONS) {
          const diff = ix - car.t;
          const approaching = car.lane.dir > 0 ? diff > 0 && diff < 14 : diff < 0 && diff > -14;
          if (approaching && nsGreen) move = 0.015;
        }
      } else {
        for (const iz of ROAD_POSITIONS) {
          const diff = iz - car.t;
          const approaching = car.lane.dir > 0 ? diff > 0 && diff < 14 : diff < 0 && diff > -14;
          if (approaching && !nsGreen) move = 0.015;
        }
      }
      car.t += move * car.lane.dir * 60 * dt;
      if (car.t > car.lane.max) car.t = car.lane.min;
      if (car.t < car.lane.min) car.t = car.lane.max;
      if (car.lane.axis === 'x') {
        car.group.position.set(car.t, 0.45, car.lane.coord);
        car.group.rotation.y = car.lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        car.group.position.set(car.lane.coord, 0.45, car.t);
        car.group.rotation.y = car.lane.dir > 0 ? 0 : Math.PI;
      }
    }
  }
}

export class PoliceManager {
  constructor(scene, roads) {
    this.scene = scene;
    this.roads = roads;
    this.cars = [];
    this.hitCooldown = 0;
  }

  spawnNear(playerX, playerZ) {
    if (this.cars.length >= 8) return;
    const ang = Math.random() * Math.PI * 2;
    let x = playerX + Math.cos(ang) * (140 + Math.random() * 120);
    let z = playerZ + Math.sin(ang) * (140 + Math.random() * 120);
    let bestRX = this.roads[0], bestRZ = this.roads[0], dxBest = 1e9, dzBest = 1e9;
    for (const r of this.roads) {
      const dx = Math.abs(x - r), dz = Math.abs(z - r);
      if (dx < dxBest) { dxBest = dx; bestRX = r; }
      if (dz < dzBest) { dzBest = dz; bestRZ = r; }
    }
    if (dxBest < dzBest) x = bestRX + (Math.random() < 0.5 ? -7.5 : 7.5);
    else z = bestRZ + (Math.random() < 0.5 ? -7.5 : 7.5);

    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.15, 8.2), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    body.position.y = 1.3; g.add(body);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.9), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    door.position.set(2.12, 1.55, -0.25); door.rotation.y = -Math.PI / 2; g.add(door);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.9, 2.9), new THREE.MeshLambertMaterial({ color: 0xaed4ff, transparent: true, opacity: 0.78 }));
    cabin.position.set(0, 2.05, -0.1); g.add(cabin);
    const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.14, 0.42), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    barBase.position.set(0, 2.72, -0.1); g.add(barBase);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.2, 0.3), new THREE.MeshBasicMaterial({ color: 0x550000 }));
    red.position.set(-0.44, 2.83, -0.1); g.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.2, 0.3), new THREE.MeshBasicMaterial({ color: 0x000055 }));
    blue.position.set(0.44, 2.83, -0.1); g.add(blue);
    this.scene.add(g);
    this.cars.push({ group: g, red, blue, x, z, yaw: 0, speed: 0, blink: 0 });
  }

  setTargetCount(count, playerX, playerZ) {
    while (this.cars.length < count) this.spawnNear(playerX, playerZ);
    while (this.cars.length > count) {
      const car = this.cars.pop();
      this.scene.remove(car.group);
    }
  }

  update(dt, playerX, playerZ, wanted) {
    this.hitCooldown -= dt;
    for (const p of this.cars) {
      const dx = playerX - p.x;
      const dz = playerZ - p.z;
      const targetYaw = Math.atan2(dx, dz);
      let da = targetYaw - p.yaw;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      p.yaw += da * 0.065;
      const targetSpeed = 0.5 + wanted * 0.08;
      p.speed += (targetSpeed - p.speed) * 0.035;
      p.x += Math.sin(p.yaw) * p.speed * 60 * dt;
      p.z += Math.cos(p.yaw) * p.speed * 60 * dt;
      p.group.position.set(p.x, 0.45, p.z);
      p.group.rotation.y = p.yaw;
      p.blink += dt * 12;
      const on = (p.blink % 1) < 0.5;
      p.red.material.color.setHex(on ? 0xff2222 : 0x440000);
      p.blue.material.color.setHex(on ? 0x2a6fff : 0x000044);
    }
  }
}
