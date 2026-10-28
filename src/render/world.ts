import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CROPS, GRID_SIZE, POIS, TILE_SIZE, calendar, tilePosition, weatherFor } from '../game/catalog';
import type { CropId, Point, PoiId } from '../game/catalog';
import type { GameState } from '../game/simulation';
import { TREES } from '../game/navigation';

type Shape = 'box' | 'round' | 'sphere' | 'ico' | 'cylinder' | 'cone';
type Particle = { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number };
type Actor = { root: THREE.Group; leftLeg: THREE.Group; rightLeg: THREE.Group; leftArm: THREE.Group; rightArm: THREE.Group };

export class FarmWorld {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera();
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private geometry: Record<Shape, THREE.BufferGeometry> = {
    box: new THREE.BoxGeometry(1, 1, 1),
    round: new RoundedBoxGeometry(1, 1, 1, 1, .12),
    sphere: new THREE.SphereGeometry(1, 12, 8),
    ico: new THREE.IcosahedronGeometry(1, 1),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 10),
    cone: new THREE.ConeGeometry(1, 1, 8),
  };
  private materials = new Map<string, THREE.MeshLambertMaterial>();
  private plots: { soil: THREE.Mesh; furrows: THREE.Group; plant: THREE.Group; cropKey: string }[] = [];
  private player: Actor;
  private neri: Actor;
  private cursor = new THREE.Group();
  private destination = new THREE.Mesh(new THREE.RingGeometry(.15, .23, 24), new THREE.MeshBasicMaterial({ color: '#fff7d3', transparent: true, opacity: .8, side: THREE.DoubleSide }));
  private destinationLife = 0;
  private particles: Particle[] = [];
  private commons = new THREE.Group();
  private commonsKey = 'unbuilt';
  private foliage: { position: Point; materials: THREE.MeshLambertMaterial[] }[] = [];
  private chickens: THREE.Group[] = [];
  private butterflies: THREE.Group[] = [];
  private sun = new THREE.DirectionalLight('#fff1d0', 3.1);
  private ambient = new THREE.HemisphereLight('#fff9e6', '#7d9972', 2.6);
  private sky = new THREE.Color('#e8efe4');
  private rain: THREE.LineSegments;
  private rainPositions = new Float32Array(180 * 6);
  private seasonKey = '';
  private grassMaterial: THREE.MeshLambertMaterial;
  private clock = 0;
  private lastLook = 0;
  private walking = false;
  private actionTime = 0;
  private shadowElapsed = 0;
  private renderElapsed = 1;
  private frameInterval = 1 / 60;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    const gl = this.renderer.getContext();
    const rendererInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const softwareGraphics = rendererInfo ? /swiftshader|llvmpipe|software/i.test(String(gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL))) : false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, softwareGraphics ? .65 : 1.5));
    this.renderer.shadowMap.enabled = !softwareGraphics;
    this.frameInterval = softwareGraphics ? 1 / 15 : 1 / 60;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.scene.background = this.sky;
    this.scene.fog = new THREE.Fog('#e8efe4', 48, 85);
    this.camera.position.set(24, 26, 28);
    this.camera.lookAt(0, .5, .8);
    this.camera.near = .1; this.camera.far = 120;
    this.sun.position.set(-8, 18, 9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(softwareGraphics ? 512 : 1024, softwareGraphics ? 512 : 1024);
    Object.assign(this.sun.shadow.camera, { left: -19, right: 19, top: 19, bottom: -19, near: 1, far: 55 });
    this.sun.shadow.bias = -.0005;
    this.sun.shadow.normalBias = .03;
    this.scene.add(this.sun, this.ambient);

    this.mesh('round', '#bca485', [0, -.72, 0], [24, 1.15, 20]);
    const grass = this.mesh('round', '#a9c58b', [0, -.15, 0], [23.8, .24, 19.8]);
    this.grassMaterial = (grass.material as THREE.MeshLambertMaterial).clone(); grass.material = this.grassMaterial;
    this.mesh('round', '#91c6cf', [10.65, -.045, 0], [2.3, .1, 19.4]);
    for (let i = 0; i < 18; i++) {
      const ripple = this.mesh('round', '#c4e3dd', [10.1 + Math.sin(i * 5) * .4, .02, -8.3 + i * .92], [.3 + (i % 3) * .13, .012, .025]);
      ripple.rotation.y = .1;
    }
    this.paths(); this.house(); this.market(); this.well(); this.shipping(); this.fences();
    this.scene.add(this.commons);
    TREES.forEach((t, i) => this.tree(t.x, t.z, t.size, i));
    for (let i = 0; i < 64; i++) {
      const x = -8 + ((i * 7.73) % 16), z = -8 + ((i * 3.87) % 16);
      if (x > -4.1 && x < 3.2 && z > -2.5 && z < 5) continue;
      if ((x > -8.5 && x < -3.8 && z < -3) || (x > 3.7 && z < -2.7)) continue;
      this.flower(x, z, ['#f5d988', '#f4e5b9', '#e5a8ac'][i % 3], .6 + (i % 4) * .13);
    }
    this.batchScenery(grass);
    for (let i = 0; i < GRID_SIZE ** 2; i++) {
      const p = tilePosition(i);
      const soil = this.mesh('round', '#99b67b', [p.x, -.007, p.z], [TILE_SIZE - .085, .11, TILE_SIZE - .085]);
      soil.userData.plotIndex = i;
      const furrows = new THREE.Group();
      for (let f = -1; f <= 1; f++) this.mesh('round', '#98765a', [p.x + f * .25, .055, p.z], [.045, .025, .77], furrows);
      this.scene.add(furrows);
      const plant = new THREE.Group(); plant.position.set(p.x, .07, p.z); plant.userData.plotIndex = i; this.scene.add(plant);
      this.plots.push({ soil, furrows, plant, cropKey: '' });
    }
    this.player = this.actor('#6e9d89', '#744c39', true);
    this.neri = this.actor('#ca8994', '#8b5e51', false);
    this.neri.root.position.set(-6.9, 0, 5.15); this.neri.root.rotation.y = 1.1;
    for (let i = 0; i < 4; i++) {
      const border = this.mesh('box', '#fff5ca', [i < 2 ? (i === 0 ? -.52 : .52) : 0, 0, i < 2 ? 0 : i === 2 ? -.52 : .52], [i < 2 ? .04 : 1.08, .025, i < 2 ? 1.08 : .04], this.cursor);
      border.castShadow = false;
    }
    this.scene.add(this.cursor); this.cursor.visible = false;
    this.destination.rotation.x = -Math.PI / 2; this.destination.visible = false; this.scene.add(this.destination);
    for (let i = 0; i < 3; i++) this.chickens.push(this.chicken());
    for (let i = 0; i < 4; i++) {
      const butterfly = new THREE.Group();
      this.mesh('sphere', i % 2 ? '#ffe9b4' : '#e6b6c2', [-.075, 0, 0], [.1, .025, .12], butterfly);
      this.mesh('sphere', i % 2 ? '#ffe9b4' : '#e6b6c2', [.075, 0, 0], [.1, .025, .12], butterfly);
      this.scene.add(butterfly); this.butterflies.push(butterfly);
    }
    for (let i = 0; i < this.rainPositions.length; i += 6) {
      const x = -11 + Math.random() * 22, y = Math.random() * 11, z = -9 + Math.random() * 18;
      this.rainPositions.set([x, y, z, x - .03, y + .3, z], i);
    }
    const rainGeometry = new THREE.BufferGeometry(); rainGeometry.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
    this.rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: '#d6e6ed', transparent: true, opacity: .45 }));
    this.rain.frustumCulled = false; this.scene.add(this.rain);
    this.resize();
  }

  private material(color: string) {
    if (!this.materials.has(color)) this.materials.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true }));
    return this.materials.get(color)!;
  }

  private batchScenery(seasonalGround: THREE.Mesh) {
    const groups = new Map<string, THREE.Mesh[]>();
    for (const object of this.scene.children) {
      if (!(object instanceof THREE.Mesh) || object === seasonalGround || !(object.material instanceof THREE.MeshLambertMaterial) || object.material.transparent) continue;
      const key = `${object.geometry.uuid}:${object.material.uuid}`;
      const group = groups.get(key) ?? [];
      group.push(object); groups.set(key, group);
    }
    for (const meshes of groups.values()) {
      if (meshes.length < 2) continue;
      const batch = new THREE.InstancedMesh(meshes[0].geometry, meshes[0].material, meshes.length);
      meshes.forEach((mesh, index) => {
        mesh.updateMatrix(); batch.setMatrixAt(index, mesh.matrix); this.scene.remove(mesh);
      });
      batch.castShadow = true; batch.receiveShadow = true;
      batch.computeBoundingSphere(); this.scene.add(batch);
    }
  }

  private mesh(shape: Shape, color: string, position: [number, number, number], scale: [number, number, number], parent: THREE.Object3D = this.scene): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry[shape], this.material(color));
    mesh.position.set(...position); mesh.scale.set(...scale); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }

  private paths() {
    for (let i = 0; i < 28; i++) this.mesh('round', '#d9c8a3', [-8.3 + i * .58, -.011, 5.32 + Math.sin(i * 2) * .035], [.66, .035, .88]);
    for (let i = 0; i < 17; i++) this.mesh('round', '#d9c8a3', [4.22 + Math.sin(i) * .04, -.012, -3.5 + i * .56], [.93, .035, .64]);
    for (let i = 0; i < 12; i++) this.mesh('round', '#d9c8a3', [-6.2 + i * .69, -.015, -3.02], [.76, .035, .85]);
    for (let i = 0; i < 4; i++) this.mesh('round', '#d9c8a3', [-5.7, -.01, 3 + i * .55], [.82, .035, .65]);
  }

  private house() {
    this.mesh('round', '#d9c8ac', [-6.2, .13, -5.5], [4.5, .3, 4]);
    this.mesh('box', '#f2e5c9', [-6.2, 1.28, -5.5], [3.9, 2.45, 3.4]);
    const roofGeo = new THREE.BufferGeometry();
    roofGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -2.25, 0, 2, 2.25, 0, 2, 0, 1.35, 2,
      2.25, 0, -2, -2.25, 0, -2, 0, 1.35, -2,
      -2.25, 0, -2, -2.25, 0, 2, 0, 1.35, 2,
      -2.25, 0, -2, 0, 1.35, 2, 0, 1.35, -2,
      0, 1.35, -2, 0, 1.35, 2, 2.25, 0, 2,
      0, 1.35, -2, 2.25, 0, 2, 2.25, 0, -2,
    ], 3)); roofGeo.computeVertexNormals();
    const roof = new THREE.Mesh(roofGeo, this.material('#c98977')); roof.position.set(-6.2, 2.52, -5.5); roof.castShadow = true; this.scene.add(roof);
    this.mesh('round', '#6a8f7b', [-6.2, .79, -3.78], [.86, 1.58, .1]);
    this.mesh('sphere', '#eac781', [-5.92, .75, -3.68], [.045, .045, .045]);
    for (const x of [-7.45, -4.97]) {
      this.mesh('box', '#ba9875', [x, 1.45, -3.77], [.83, .96, .12]);
      this.mesh('box', '#c5dfd6', [x, 1.45, -3.69], [.65, .76, .05]);
      this.mesh('box', '#fff0cf', [x, 1.45, -3.64], [.055, .8, .04]);
      this.mesh('box', '#fff0cf', [x, 1.45, -3.64], [.68, .055, .04]);
      this.mesh('round', '#9d795b', [x, .91, -3.6], [.95, .2, .3]);
      for (let i = 0; i < 3; i++) this.flower(x - .3 + i * .3, -3.53, '#eab6bf', .6, 1);
    }
    this.mesh('round', '#eee0bd', [-6.2, .075, -3.4], [1.32, .16, .6]);
    this.mesh('box', '#c2a187', [-7.3, 3.35, -5.9], [.48, 1.2, .55]);
    this.mesh('round', '#ab8672', [-7.3, 3.95, -5.9], [.65, .16, .72]);
    this.mesh('sphere', '#f3d9a0', [-6.2, 2.03, -3.57], [.14, .16, .1]);
    const lamp = new THREE.PointLight('#ffce83', 1.1, 5); lamp.position.set(-6.2, 2, -3); this.scene.add(lamp);
  }

  private market() {
    const group = new THREE.Group(); group.position.set(5.8, 0, -4.4); this.scene.add(group);
    for (const x of [-1.5, 1.5]) for (const z of [-.75, .75]) this.mesh('box', '#b58d68', [x, 1.18, z], [.13, 2.35, .13], group);
    this.mesh('round', '#bc966d', [0, .74, .55], [3.25, .22, 1.18], group);
    this.mesh('box', '#d8b58c', [0, .38, .63], [2.9, .6, .08], group);
    for (let i = 0; i < 8; i++) {
      const awning = this.mesh('box', i % 2 ? '#e8ddc3' : '#92b39a', [-1.54 + i * .44, 2.4, 0], [.44, .12, 2.2], group);
      awning.rotation.x = .1;
      this.mesh('round', i % 2 ? '#e8ddc3' : '#92b39a', [-1.54 + i * .44, 2.12, 1.08], [.44, .33, .09], group);
    }
    for (let i = 0; i < 3; i++) {
      this.mesh('box', '#997957', [-1 + i, .96, .6], [.72, .25, .65], group);
      for (let p = 0; p < 3; p++) this.mesh('ico', ['#b49bc2', '#aac081', '#e6bc74'][i], [-1.2 + i + p * .19, 1.15, .61], [.13, .16, .12], group);
    }
  }

  private well() {
    const { x, z } = POIS.well.position;
    this.mesh('cylinder', '#b7b9a3', [x, .38, z], [.69, .7, .69]);
    this.mesh('cylinder', '#698d94', [x, .75, z], [.51, .04, .51]);
    for (const dx of [-.75, .75]) this.mesh('box', '#aa8664', [x + dx, .97, z], [.12, 1.85, .14]);
    this.mesh('round', '#b28d69', [x, 1.86, z], [1.65, .18, .3]);
    this.mesh('cylinder', '#cfb38b', [x, 1.36, z], [.025, .9, .025]);
    this.mesh('cylinder', '#977a5c', [x, .95, z], [.2, .27, .2]);
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const stone = this.mesh('round', i % 2 ? '#cccbb4' : '#c0c2af', [x + Math.sin(angle) * .57, .74, z + Math.cos(angle) * .57], [.4, .21, .29]); stone.rotation.y = angle;
    }
  }

  private shipping() {
    const { x, z } = POIS.shipping.position;
    this.mesh('round', '#b18860', [x, .42, z], [1.3, .81, .98]);
    this.mesh('round', '#d0ab79', [x, .89, z], [1.45, .14, 1.08]);
    for (const dx of [-.48, .48]) this.mesh('box', '#99744f', [x + dx, .43, z + .51], [.09, .72, .055]);
    this.mesh('box', '#eddec0', [x, .48, z + .52], [.55, .36, .035]);
    this.mesh('box', '#7e9c75', [x, .5, z + .55], [.3, .05, .015]);
    this.mesh('cylinder', '#c49a6d', [x + 1, .69, z], [.055, 1.4, .055]);
    this.mesh('round', '#95bba2', [x + 1.19, 1.25, z], [.4, .29, .035]);
  }

  private fences() {
    for (let i = 0; i < 19; i++) {
      const x = -9.7 + i * .95;
      this.mesh('round', '#d6c4a0', [x, .41, -8.7], [.12, .86, .12]);
      if (i < 18) for (const y of [.25, .62]) this.mesh('box', '#e4d4b3', [x + .475, y, -8.7], [.96, .09, .065]);
    }
    for (let i = 0; i < 8; i++) {
      const z = -7.8 + i * 1.05;
      this.mesh('round', '#d6c4a0', [-10.7, .4, z], [.12, .83, .12]);
      for (const y of [.25, .6]) this.mesh('box', '#e4d4b3', [-10.7, y, z + .5], [.06, .085, 1.05]);
    }
  }

  private tree(x: number, z: number, size: number, variant: number) {
    this.mesh('cylinder', '#9c7f5c', [x, 1.1 * size, z], [.24 * size, 2.2 * size, .24 * size]);
    const colors = variant === 3 ? ['#daa4b0', '#e6bbc0', '#cf9cac'] : ['#84a779', '#abc58b', '#94b77d'];
    const materials: THREE.MeshLambertMaterial[] = [];
    for (let i = 0; i < 4; i++) {
      const leaf = this.mesh('ico', colors[i % 3], [x + Math.sin(i * 2.1) * .52 * size, (2.4 + (i === 3 ? .6 : 0)) * size, z + Math.cos(i * 2.1) * .38 * size], [1.05 * size, .94 * size, 1.02 * size]);
      const material = (leaf.material as THREE.MeshLambertMaterial).clone(); material.transparent = true; leaf.material = material; materials.push(material);
    }
    this.foliage.push({ position: { x, z }, materials });
  }

  private flower(x: number, z: number, color: string, size = 1, base = 0, parent: THREE.Object3D = this.scene) {
    this.mesh('cylinder', '#7a9a64', [x, base + .15 * size, z], [.018, .3 * size, .018], parent);
    this.mesh('ico', color, [x, base + .3 * size, z], [.1 * size, .07 * size, .1 * size], parent);
  }

  private actor(clothes: string, hair: string, hat: boolean): Actor {
    const root = new THREE.Group(); this.scene.add(root);
    this.mesh('round', clothes, [0, .66, 0], [.47, .52, .32], root);
    this.mesh('sphere', '#f0c8a6', [0, 1.15, 0], [.34, .35, .31], root);
    this.mesh('sphere', hair, [0, 1.3, -.055], [.35, .24, .29], root);
    for (const x of [-.115, .115]) {
      this.mesh('sphere', '#473d38', [x, 1.15, .284], [.032, .038, .02], root);
      this.mesh('sphere', '#e3a79a', [x * 1.5, 1.07, .26], [.04, .02, .014], root);
    }
    this.mesh('sphere', '#f0c8a6', [0, 1.08, .312], [.038, .032, .027], root);
    this.mesh('round', '#b6cbbb', [0, .68, .173], [.2, .19, .04], root);
    const limbs: THREE.Group[] = [];
    for (let i = 0; i < 4; i++) {
      const limb = new THREE.Group(); const arm = i >= 2;
      limb.position.set((i % 2 ? 1 : -1) * (arm ? .3 : .14), arm ? .86 : .47, 0);
      this.mesh('round', arm ? '#ebdfc2' : '#526a67', [0, -.16, 0], [arm ? .14 : .16, .32, .16], limb);
      this.mesh('round', arm ? '#f0c8a6' : '#866b52', [0, -.33, arm ? 0 : .04], [arm ? .14 : .2, .13, arm ? .14 : .27], limb);
      root.add(limb); limbs.push(limb);
    }
    if (hat) {
      this.mesh('cylinder', '#e0bd7d', [0, 1.47, 0], [.49, .075, .45], root);
      this.mesh('sphere', '#ead097', [0, 1.51, 0], [.32, .19, .29], root);
      this.mesh('cylinder', '#b38960', [0, 1.5, 0], [.329, .065, .299], root);
      this.mesh('sphere', '#ead097', [0, 1.56, 0], [.3, .14, .27], root);
    } else this.mesh('ico', hair, [-.28, 1.33, -.03], [.2, .2, .2], root);
    return { root, leftLeg: limbs[0], rightLeg: limbs[1], leftArm: limbs[2], rightArm: limbs[3] };
  }

  private chicken() {
    const root = new THREE.Group();
    this.mesh('sphere', '#fff0cf', [0, .24, 0], [.23, .22, .3], root);
    this.mesh('sphere', '#fff5da', [0, .46, .2], [.16, .18, .15], root);
    this.mesh('cone', '#dca562', [0, .44, .38], [.085, .13, .07], root).rotation.x = Math.PI / 2;
    this.mesh('ico', '#d99487', [0, .64, .19], [.06, .08, .09], root);
    for (const x of [-.1, .1]) this.mesh('sphere', '#574d40', [x, .48, .3], [.02, .027, .015], root);
    this.mesh('cone', '#e1c8a3', [0, .39, -.23], [.16, .3, .12], root).rotation.x = -.5;
    this.scene.add(root); return root;
  }

  private crop(kind: CropId, remaining: number, group: THREE.Group) {
    const def = CROPS[kind]; const progress = 1 - remaining / def.grow;
    const size = .34 + progress * .66;
    if (kind === 'ribbonbean') {
      this.mesh('cylinder', '#ba9670', [0, .48, 0], [.028, .97, .028], group);
      for (let i = 0; i < 5; i++) {
        const leaf = this.mesh('sphere', i % 2 ? '#a7c47b' : '#759d5e', [(i % 2 ? .17 : -.15) * size, (.16 + i * .14) * size, .035], [.2 * size, .075 * size, .12 * size], group);
        leaf.rotation.z = i % 2 ? .5 : -.5;
        if (remaining === 0 && i % 2) this.mesh('sphere', '#a8be6d', [.12, i * .15, .11], [.05, .17, .045], group).rotation.z = -.2;
      }
    } else if (kind === 'pearloat') {
      for (let i = 0; i < 5; i++) {
        const x = Math.sin(i * 3) * .16, z = Math.cos(i * 3) * .16;
        this.mesh('cylinder', remaining === 0 ? '#c6ae64' : '#8fa66b', [x, .34 * size, z], [.022, .68 * size, .022], group);
        this.mesh('ico', remaining === 0 ? '#ead293' : '#bbcb8b', [x, .73 * size, z], [.075, .16 * size, .08], group);
      }
    } else {
      if (progress > .12) {
        this.mesh('sphere', kind === 'dewturnip' ? '#ede6d2' : '#d9949e', [0, .1, 0], [.28 * size, .24 * size, .27 * size], group);
        if (kind === 'dewturnip') this.mesh('sphere', '#b69bbd', [0, .21 * size, 0], [.26 * size, .14 * size, .25 * size], group);
      }
      for (let i = 0; i < 4; i++) {
        const angle = i * Math.PI / 2 + .4;
        const leaf = this.mesh('sphere', i % 2 ? '#a6c37a' : '#73995d', [Math.sin(angle) * .12 * size, .29 * size, Math.cos(angle) * .12 * size], [.075 * size, .25 * size, .11 * size], group);
        leaf.rotation.z = Math.sin(angle) * -.55; leaf.rotation.x = Math.cos(angle) * .55;
      }
    }
    if (remaining === 0) {
      const sparkle = this.mesh('ico', '#fff2b2', [.28, kind === 'ribbonbean' ? 1.1 : .66, .05], [.045, .075, .045], group);
      sparkle.name = 'sparkle'; sparkle.castShadow = false;
    }
  }

  sync(state: GameState) {
    this.renderer.shadowMap.needsUpdate = true;
    const season = calendar(state.day).season;
    if (season !== this.seasonKey) {
      this.seasonKey = season;
      this.grassMaterial.color.set({ Spring: '#a9c58b', Summer: '#a8bb78', Autumn: '#bfbb8b', Winter: '#d8e0cf' }[season]);
    }
    state.plots.forEach((plot, index) => {
      const view = this.plots[index];
      view.soil.material = this.material(plot.tilled ? plot.wet ? '#826d55' : '#ae8a63' : season === 'Winter' ? '#c8d2b9' : '#9ebd80');
      view.furrows.visible = plot.tilled;
      const key = plot.crop ? `${plot.crop.kind}:${plot.crop.remaining}` : 'empty';
      if (key !== view.cropKey) {
        view.plant.clear(); view.cropKey = key;
        if (plot.crop) this.crop(plot.crop.kind, plot.crop.remaining, view.plant);
      }
    });
    const key = state.commons ?? 'planned';
    if (key !== this.commonsKey) {
      this.commons.clear(); this.commonsKey = key;
      const { x, z } = POIS.commons.position;
      if (!state.commons) {
        this.mesh('round', '#c5b799', [x, .02, z], [2.5, .08, 1.8], this.commons);
        for (const dx of [-.8, .8]) this.mesh('round', '#b3926b', [x + dx, .2, z], [.3, .4, .3], this.commons);
        this.mesh('box', '#ded0ad', [x, .26, z], [1.9, .12, .42], this.commons);
      } else {
        this.mesh('round', '#dfd2ae', [x, .025, z], [3.6, .1, 2.3], this.commons);
        for (const dx of [-.8, .8]) this.mesh('box', '#947c60', [x + dx, .29, z], [.13, .58, .48], this.commons);
        this.mesh('round', '#c4a379', [x, .58, z], [2.1, .15, .63], this.commons);
        this.mesh('round', state.commons === 'garden' ? '#8fa784' : '#c597a4', [x, .89, z - .23], [2.1, .45, .12], this.commons);
        for (const dx of [-1.4, 1.4]) {
          this.mesh('round', '#c49779', [x + dx, .2, z], [.45, .4, .45], this.commons);
          for (let i = 0; i < 4; i++) this.flower(x + dx + Math.sin(i * 2) * .13, z + Math.cos(i * 2) * .13, state.commons === 'garden' ? '#eac5de' : '#f1d58b', 1, .36, this.commons);
        }
        for (const dx of [-1.65, 1.65]) this.mesh('cylinder', '#b2926b', [x + dx, 1.25, z - .6], [.04, 2.5, .04], this.commons);
        this.mesh('box', '#c0a480', [x, 2.38, z - .6], [3.3, .035, .03], this.commons);
        for (let i = 0; i < 7; i++) this.mesh('cone', ['#c8dba0', '#e8b6b2', '#e8d594'][i % 3], [x - 1.4 + i * .47, 2.19, z - .6], [.14, -.32, .035], this.commons);
      }
    }
    this.rain.visible = weatherFor(state.day) === 'rain';
  }

  setPlayer(position: Point, facing: number, moving: boolean) {
    this.player.root.position.x = position.x; this.player.root.position.z = position.z;
    this.player.root.rotation.y = facing; this.walking = moving;
  }

  setTarget(index: number | null) {
    this.cursor.visible = index !== null;
    if (index !== null) { const point = tilePosition(index); this.cursor.position.set(point.x, .08, point.z); }
  }

  markDestination(point: Point) { this.destination.position.set(point.x, .08, point.z); this.destinationLife = 1.3; this.destination.visible = true; }

  burst(point: Point, type: string) {
    this.actionTime = .45;
    const color = type === 'water' ? '#b7deed' : type === 'harvest' || type === 'celebrate' ? '#f4d58e' : '#c8d9a6';
    for (let i = 0; i < (type === 'celebrate' ? 30 : 8); i++) {
      const mesh = this.mesh('ico', color, [point.x, .3, point.z], [.045, .065, .045]); mesh.castShadow = false;
      this.particles.push({ mesh, velocity: new THREE.Vector3((Math.random() - .5) * 1.6, .8 + Math.random() * 1.3, (Math.random() - .5) * 1.6), life: .8 + Math.random() * .4 });
    }
  }

  project(point: Point, height = 0): { x: number; y: number } {
    const vector = new THREE.Vector3(point.x, height, point.z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + (vector.x + 1) * rect.width / 2, y: rect.top + (1 - vector.y) * rect.height / 2 };
  }

  groundAt(clientX: number, clientY: number): Point | null {
    const rect = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1), this.camera);
    const target = this.raycaster.ray.intersectPlane(this.groundPlane, new THREE.Vector3());
    return target ? { x: target.x, z: target.z } : null;
  }

  pickPlot(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1), this.camera);
    const hits = this.raycaster.intersectObjects(this.plots.flatMap(plot => [plot.soil, plot.plant]), true);
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        if (typeof object.userData.plotIndex === 'number') return object.userData.plotIndex;
        object = object.parent;
      }
    }
    return null;
  }

  resize() {
    const width = window.innerWidth, height = window.innerHeight;
    this.renderer.setSize(width, height);
    const aspect = width / height;
    const extent = aspect < 1 ? 17 / aspect : 12.3;
    this.camera.left = -extent * aspect; this.camera.right = extent * aspect;
    this.camera.top = extent; this.camera.bottom = -extent;
    this.camera.updateProjectionMatrix();
  }

  zoom(delta: number) { this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom - delta * .0006, .8, 1.35); this.camera.updateProjectionMatrix(); }

  render(dt: number, state: GameState) {
    this.renderElapsed += dt;
    if (dt > 0 && this.renderElapsed < this.frameInterval) return;
    dt = Math.min(this.renderElapsed, .3); this.renderElapsed = 0;
    const animated = !state.settings.reducedMotion;
    this.clock += animated ? dt : 0;
    const time = this.clock;
    const stride = this.walking && animated ? Math.sin(time * 12) * .48 : 0;
    this.player.leftLeg.rotation.x = stride; this.player.rightLeg.rotation.x = -stride;
    this.player.leftArm.rotation.x = -stride * .7; this.player.rightArm.rotation.x = stride * .7;
    this.player.root.position.y = this.walking && animated ? Math.abs(Math.sin(time * 12)) * .035 : 0;
    if (this.actionTime > 0) { this.actionTime -= dt; this.player.rightArm.rotation.x = -1.2 * Math.sin(Math.max(0, this.actionTime) / .45 * Math.PI); }
    this.neri.rightArm.rotation.z = -.2 + (animated ? Math.sin(time * 1.2) * .12 : 0);
    this.chickens.forEach((chicken, i) => { chicken.position.set(6.8 + Math.sin(time * .19 + i * 2) * .7, animated ? Math.abs(Math.sin(time * 3 + i)) * .018 : 0, .2 + i * .73 + Math.cos(time * .23 + i) * .35); chicken.rotation.y = Math.cos(time * .2 + i) + i; });
    this.butterflies.forEach((butterfly, i) => {
      butterfly.position.set(-4.9 + Math.sin(time * .5 + i * 2) * 1.2, .9 + Math.sin(time * 1.6 + i) * .23, 4 + Math.cos(time * .4 + i * 2) * 2);
      butterfly.children.forEach((wing, j) => { wing.rotation.z = (j ? 1 : -1) * Math.sin(time * 18) * .8; });
      butterfly.visible = !this.rain.visible;
    });
    for (const view of this.plots) {
      const sparkle = view.plant.getObjectByName('sparkle'); if (sparkle && animated) sparkle.rotation.y += dt * 1.6;
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]; p.life -= dt;
      p.mesh.position.addScaledVector(p.velocity, dt); p.velocity.y -= dt * 2;
      p.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * .8));
      if (p.life <= 0) { this.scene.remove(p.mesh); this.particles.splice(i, 1); }
    }
    if (this.destinationLife > 0) { this.destinationLife -= dt; this.destination.visible = this.destinationLife > 0; this.destination.scale.setScalar(1 + Math.sin(time * 5) * .15); }
    if (this.rain.visible && animated) {
      for (let i = 0; i < this.rainPositions.length; i += 6) {
        this.rainPositions[i + 1] -= dt * 5; this.rainPositions[i + 4] -= dt * 5;
        if (this.rainPositions[i + 1] < 0) { this.rainPositions[i + 1] += 11; this.rainPositions[i + 4] += 11; }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    this.lastLook += dt;
    if (this.lastLook > .12) {
      this.lastLook = 0;
      const dusk = THREE.MathUtils.smoothstep(state.minutes, 1020, 1320);
      const wet = this.rain.visible;
      this.sky.set(wet ? '#d4dfe0' : '#e8efe4').lerp(new THREE.Color('#879ba5'), dusk * .8);
      (this.scene.fog as THREE.Fog).color.copy(this.sky);
      this.sun.intensity = (wet ? 1.4 : 3.1) * (1 - dusk * .74);
      this.ambient.intensity = 2.6 - dusk * .65;
      for (const tree of this.foliage) {
        const fade = Math.hypot(tree.position.x - state.player.x, tree.position.z - state.player.z) < 2.2;
        for (const material of tree.materials) { material.opacity = fade ? .27 : 1; material.depthWrite = !fade; }
      }
    }
    this.shadowElapsed += dt;
    if (this.shadowElapsed > .16) {
      this.shadowElapsed = 0;
      if (this.walking || this.actionTime > 0) this.renderer.shadowMap.needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
