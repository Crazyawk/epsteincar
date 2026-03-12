import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';
import { BLOCK, GRID_MIN, GRID_MAX, HALF_WORLD, PHOTO_URL, ROAD_HALF, ROAD_POSITIONS, ROAD_WIDTH, WORLD_SIZE } from './config.js';
import { pick, rand } from './utils.js';

const buildingColors = [0x6f7782, 0x817468, 0x788490, 0x8d8277, 0x62707d, 0x85706b];
const awningColors = [0xdc4d4d, 0x3f7fe1, 0x4caf50, 0xf0b530];
const glassColors = [0x95c0ec, 0x7facdd, 0xaed2f4];

export class WorldBuilder {
  constructor(scene, physicsWorld, textureLoader) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.textureLoader = textureLoader;
    this.collisionBodies = [];
    this.intersections = [];
    this.trafficLights = [];
    this.billboards = [];
    this.photoTexture = null;
    this.cityGroup = new THREE.Group();
    this.scene.add(this.cityGroup);
  }

  async build() {
    this.photoTexture = await this.loadTexture(PHOTO_URL).catch(() => null);
    this.buildSkyDome();
    this.buildGround();
    this.buildRoads();
    this.buildCityLots();
    this.buildBillboards();
    this.buildRamps();
    this.buildDecor();
    return {
      collisionBodies: this.collisionBodies,
      intersections: this.intersections,
      trafficLights: this.trafficLights,
      billboards: this.billboards,
      photoTexture: this.photoTexture,
      ramps: this.ramps,
    };
  }

  loadTexture(url) {
    return new Promise((resolve, reject) => {
      this.textureLoader.load(
        url,
        tex => {
          tex.colorSpace = THREE.SRGBColorSpace;
          resolve(tex);
        },
        undefined,
        reject,
      );
    });
  }

  buildSkyDome() {
    const geo = new THREE.SphereGeometry(3200, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor: { value: new THREE.Color(0x5caeff) },
        bottomColor: { value: new THREE.Color(0xeef6ff) },
      },
      vertexShader: `varying vec3 vWorldPosition; void main(){ vec4 worldPosition = modelMatrix * vec4(position,1.0); vWorldPosition = worldPosition.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 topColor; uniform vec3 bottomColor; varying vec3 vWorldPosition; void main(){ float h = normalize(vWorldPosition).y * 0.5 + 0.5; gl_FragColor = vec4(mix(bottomColor, topColor, smoothstep(0.0, 1.0, h)), 1.0); }`
    });
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  buildGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_SIZE * 2.2, WORLD_SIZE * 2.2),
      new THREE.MeshLambertMaterial({ color: 0x5ea350 })
    );
    ground.rotation.x = -Math.PI / 2;
    this.cityGroup.add(ground);

    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: new CANNON.Material('ground') });
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.physicsWorld.addBody(body);
  }

  buildRoads() {
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x2d2d2f });
    const yellowMat = new THREE.MeshLambertMaterial({ color: 0xf0d76a });
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xf7f7f7 });
    const sideMat = new THREE.MeshLambertMaterial({ color: 0xa9a9ad });

    for (const z of ROAD_POSITIONS) {
      const road = new THREE.Mesh(new THREE.BoxGeometry(WORLD_SIZE, 0.18, ROAD_WIDTH), roadMat);
      road.position.set(0, 0.06, z);
      this.cityGroup.add(road);

      const s1 = new THREE.Mesh(new THREE.BoxGeometry(WORLD_SIZE, 0.12, 8), sideMat);
      s1.position.set(0, 0.11, z - ROAD_HALF - 4);
      this.cityGroup.add(s1);
      const s2 = s1.clone(); s2.position.z = z + ROAD_HALF + 4; this.cityGroup.add(s2);

      for (let x = -HALF_WORLD + 25; x < HALF_WORLD - 25; x += 38) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(18, 0.04, 1.0), yellowMat);
        dash.position.set(x, 0.15, z);
        this.cityGroup.add(dash);
      }
      for (let x = -HALF_WORLD + 22; x < HALF_WORLD - 22; x += 28) {
        const edge = new THREE.Mesh(new THREE.BoxGeometry(12, 0.03, 0.35), whiteMat);
        edge.position.set(x, 0.14, z - ROAD_HALF + 1.5);
        this.cityGroup.add(edge);
        const edge2 = edge.clone(); edge2.position.z = z + ROAD_HALF - 1.5; this.cityGroup.add(edge2);
      }
    }

    for (const x of ROAD_POSITIONS) {
      const road = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH, 0.18, WORLD_SIZE), roadMat);
      road.position.set(x, 0.06, 0);
      this.cityGroup.add(road);

      const s1 = new THREE.Mesh(new THREE.BoxGeometry(8, 0.12, WORLD_SIZE), sideMat);
      s1.position.set(x - ROAD_HALF - 4, 0.11, 0);
      this.cityGroup.add(s1);
      const s2 = s1.clone(); s2.position.x = x + ROAD_HALF + 4; this.cityGroup.add(s2);

      for (let z = -HALF_WORLD + 25; z < HALF_WORLD - 25; z += 38) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 18), yellowMat);
        dash.position.set(x, 0.15, z);
        this.cityGroup.add(dash);
      }
      for (let z = -HALF_WORLD + 22; z < HALF_WORLD - 22; z += 28) {
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.03, 12), whiteMat);
        edge.position.set(x - ROAD_HALF + 1.5, 0.14, z);
        this.cityGroup.add(edge);
        const edge2 = edge.clone(); edge2.position.x = x + ROAD_HALF - 1.5; this.cityGroup.add(edge2);
      }
    }

    for (let ix = GRID_MIN + 1; ix <= GRID_MAX - 1; ix++) {
      for (let iz = GRID_MIN + 1; iz <= GRID_MAX - 1; iz++) {
        const x = ix * BLOCK;
        const z = iz * BLOCK;
        const inter = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH, 0.19, ROAD_WIDTH), roadMat);
        inter.position.set(x, 0.065, z);
        this.cityGroup.add(inter);
        this.intersections.push({ x, z, radius: 22 });
        this.addTrafficLightsAt(x, z);
      }
    }
  }

  addTrafficLightsAt(x, z) {
    const make = (px, pz, rotY, isNS) => {
      const poleMat = new THREE.MeshLambertMaterial({ color: 0x4a4a4a });
      const boxMat = new THREE.MeshLambertMaterial({ color: 0x202020 });
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 8, 8), poleMat);
      pole.position.y = 4; g.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.18, 0.18), poleMat);
      arm.position.set(1.4, 7.1, 0); g.add(arm);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.55, 0.68), boxMat);
      box.position.set(2.75, 6.7, 0); g.add(box);
      const red = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshBasicMaterial({ color: 0x330000 }));
      red.position.set(2.75, 7.05, 0.36); g.add(red);
      const yellow = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshBasicMaterial({ color: 0x332900 }));
      yellow.position.set(2.75, 6.7, 0.36); g.add(yellow);
      const green = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshBasicMaterial({ color: 0x003300 }));
      green.position.set(2.75, 6.35, 0.36); g.add(green);
      g.position.set(px, 0, pz);
      g.rotation.y = rotY;
      this.scene.add(g);
      this.trafficLights.push({ x, z, isNS, group: g, red, yellow, green });
    };
    make(x - ROAD_HALF - 6, z - ROAD_HALF - 6, 0, true);
    make(x + ROAD_HALF + 6, z + ROAD_HALF + 6, Math.PI, true);
    make(x - ROAD_HALF - 6, z + ROAD_HALF + 6, Math.PI / 2, false);
    make(x + ROAD_HALF + 6, z - ROAD_HALF - 6, -Math.PI / 2, false);
  }

  buildCityLots() {
    for (let gx = GRID_MIN; gx < GRID_MAX; gx++) {
      for (let gz = GRID_MIN; gz < GRID_MAX; gz++) {
        const cx = gx * BLOCK + BLOCK / 2;
        const cz = gz * BLOCK + BLOCK / 2;
        const lotSize = BLOCK - ROAD_WIDTH - 16;
        const dense = Math.abs(gx) < 5 && Math.abs(gz) < 5;
        const positions = [
          [cx - lotSize * 0.26, cz - lotSize * 0.26],
          [cx + lotSize * 0.26, cz - lotSize * 0.26],
          [cx - lotSize * 0.26, cz + lotSize * 0.26],
          [cx + lotSize * 0.26, cz + lotSize * 0.26],
        ];
        for (const [x, z] of positions) {
          const chooseShop = Math.random() < 0.22;
          if (chooseShop) this.addShopLot(x, z);
          else this.addBuildingLot(x, z, dense);
        }
      }
    }
  }

  addBoxCollider(x, y, z, w, h, d) {
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)) });
    body.position.set(x, y + h / 2, z);
    this.physicsWorld.addBody(body);
    this.collisionBodies.push(body);
  }

  addBuildingLot(x, z, dense) {
    const w = rand(22, 38);
    const d = rand(22, 38);
    const h = dense ? rand(45, 145) : rand(18, 85);
    const color = pick(buildingColors);
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    base.position.set(x, h / 2, z);
    this.cityGroup.add(base);
    this.addBoxCollider(x, 0, z, w, h, d);

    const rows = Math.max(2, Math.floor(h / 13));
    const cols = Math.max(2, Math.floor(w / 7));
    const winMat = new THREE.MeshLambertMaterial({ color: pick(glassColors) });
    for (let ry = 0; ry < rows; ry++) {
      for (let cx = 0; cx < cols; cx++) {
        if (Math.random() < 0.16) continue;
        const ww = w / (cols + 2);
        const win = new THREE.Mesh(new THREE.BoxGeometry(ww, 2.2, 0.26), winMat);
        win.position.set(x - w / 2 + ((cx + 1.5) * w / (cols + 1)), 5 + ry * ((h - 10) / rows), z + d / 2 + 0.14);
        this.cityGroup.add(win);
      }
    }
    if (this.photoTexture && Math.random() < 0.22 && h > 40) {
      const side = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(w * 0.8, 24), Math.min(h * 0.34, 22)),
        new THREE.MeshLambertMaterial({ map: this.photoTexture })
      );
      side.position.set(x + w / 2 + 0.2, h * 0.65, z);
      side.rotation.y = -Math.PI / 2;
      this.cityGroup.add(side);
    }
  }

  addShopLot(x, z) {
    const w = rand(18, 28);
    const d = rand(16, 24);
    const h = rand(8, 14);
    const color = pick(buildingColors);
    const shop = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    shop.position.set(x, h / 2, z);
    this.cityGroup.add(shop);
    this.addBoxCollider(x, 0, z, w, h, d);

    const glass = new THREE.Mesh(new THREE.BoxGeometry(w * 0.74, 3.6, 0.2), new THREE.MeshLambertMaterial({ color: 0x8ec3ef }));
    glass.position.set(x, 3.4, z + d / 2 + 0.14);
    this.cityGroup.add(glass);

    const awning = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.65, 2.0), new THREE.MeshLambertMaterial({ color: pick(awningColors) }));
    awning.position.set(x, 6.1, z + d / 2 + 0.8);
    this.cityGroup.add(awning);

    if (Math.random() < 0.35) this.addStall(x + rand(-9, 9), z + d / 2 + 6.5);
  }

  addStall(x, z) {
    const table = new THREE.Mesh(new THREE.BoxGeometry(7.6, 1.1, 4.8), new THREE.MeshLambertMaterial({ color: 0x8c6a48 }));
    table.position.set(x, 1.0, z);
    this.cityGroup.add(table);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(5.6, 3.2, 4), new THREE.MeshLambertMaterial({ color: pick(awningColors) }));
    roof.position.set(x, 4.0, z);
    roof.rotation.y = Math.PI / 4;
    this.cityGroup.add(roof);
    for (const [ox, oz] of [[-3.1,-1.9],[3.1,-1.9],[-3.1,1.9],[3.1,1.9]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.4, 6), new THREE.MeshLambertMaterial({ color: 0x6b5035 }));
      pole.position.set(x + ox, 2.0, z + oz);
      this.cityGroup.add(pole);
    }
    this.addBoxCollider(x, 0, z, 7.6, 4.0, 4.8);
  }

  buildBillboards() {
    this.ramps = [];
    const positions = [
      [-850, -80, Math.PI / 2], [850, 120, -Math.PI / 2], [90, -980, 0], [-110, 980, Math.PI], [1040, -420, -Math.PI / 2], [-1020, 360, Math.PI / 2]
    ];
    for (const [x, z, rotY] of positions) {
      const poleMat = new THREE.MeshLambertMaterial({ color: 0x777777 });
      const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 12, 8), poleMat);
      const p2 = p1.clone();
      p1.position.set(x - Math.cos(rotY) * 6, 6, z - Math.sin(rotY) * 6);
      p2.position.set(x + Math.cos(rotY) * 6, 6, z + Math.sin(rotY) * 6);
      this.scene.add(p1, p2);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), new THREE.MeshLambertMaterial({ color: 0xffffff, map: this.photoTexture || null }));
      board.position.set(x, 14, z);
      board.rotation.y = rotY;
      this.scene.add(board);
      this.billboards.push(board);
    }
  }

  buildRamps() {
    const positions = [
      [-340, -120, 0], [260, 240, Math.PI / 2], [-620, 360, Math.PI], [560, -300, -Math.PI / 2], [0, -700, Math.PI / 2], [760, 120, 0]
    ];
    const mat = new THREE.MeshLambertMaterial({ color: 0xc18a48 });
    this.ramps = [];
    for (const [x, z, rotY] of positions) {
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(22, 2.4, 10), mat);
      ramp.position.set(x, 1.05, z);
      ramp.rotation.y = rotY;
      ramp.rotation.x = -Math.PI / 8;
      this.cityGroup.add(ramp);
      const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(11, 1.2, 5)) });
      body.position.set(x, 1.05, z);
      body.quaternion.setFromEuler(-Math.PI / 8, rotY, 0, 'XYZ');
      this.physicsWorld.addBody(body);
      this.ramps.push({ x, z, body });
    }
  }

  buildDecor() {
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x75492a });
    const leavesMat = new THREE.MeshLambertMaterial({ color: 0x2d8b3f });
    for (let i = GRID_MIN + 1; i <= GRID_MAX - 1; i++) {
      for (let j = GRID_MIN + 1; j <= GRID_MAX - 1; j++) {
        const treeSpots = [[40, 36], [-42, 24]];
        for (const [ox, oz] of treeSpots) {
          const x = i * BLOCK + ox;
          const z = j * BLOCK + oz;
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 4, 6), trunkMat);
          trunk.position.set(x, 2, z);
          this.cityGroup.add(trunk);
          const leaves = new THREE.Mesh(new THREE.SphereGeometry(2.8, 8, 8), leavesMat);
          leaves.position.set(x, 5, z);
          this.cityGroup.add(leaves);
        }
      }
    }
  }
}
