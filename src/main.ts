import './style.css';
import { CROP_IDS, CROPS, DAY_END, DAY_START, GRID_SIZE, POIS, START_POSITION, TOOLS, WATER_CAPACITY, distance, tileAt, tilePosition } from './game/catalog';
import type { CropId, PoiId, Point, Tool } from './game/catalog';
import { advanceDay, buyRowTools, buySeeds, completeCommons, createGame, reclaimShipping, sellProduce, shipProduce, starterHelp, tendPlot } from './game/simulation';
import type { ActionResult, GameState } from './game/simulation';
import { loadGame, parseSave, saveGame } from './game/persistence';
import { findPath, followPath, isWalkable, slideMove } from './game/navigation';
import { FarmWorld } from './render/world';
import { FarmInterface } from './ui/interface';
import type { Command, Panel } from './ui/interface';
import { FarmAudio } from './audio';

type Destination = { kind: 'plot'; index: number; tool: Tool; seed: CropId } | { kind: 'poi'; id: PoiId };

class FarmGame {
  state: GameState;
  world: FarmWorld;
  ui: FarmInterface;
  private audio = new FarmAudio();
  private tool: Tool = 'care';
  private seed: CropId = 'dewturnip';
  private keys = new Set<string>();
  private path: Point[] = [];
  private queue: Destination[] = [];
  private facing = 0;
  private target: number | null = null;
  private mouse: { x: number; y: number } | null = null;
  private pointerMode = true;
  private pointerDown: { x: number; y: number } | null = null;
  private sleeping = false;
  private lastFrame = performance.now();
  private uiElapsed = 0;
  private saveElapsed = 0;
  private actionCooldown = 0;
  private saved = true;
  private gamepadButtons: boolean[] = [];
  private capturePaused = false;

  constructor(root: HTMLElement) {
    const loaded = loadGame();
    this.state = loaded.state;
    this.saved = loaded.storageAvailable;
    if (!this.state.welcomed) this.state.settings.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!isWalkable(this.state.player)) this.state.player = { ...START_POSITION };
    this.ui = new FarmInterface(root, this.state, command => this.command(command));
    this.world = new FarmWorld(this.ui.canvas);
    this.world.sync(this.state);
    this.world.setPlayer(this.state.player, this.facing, false);
    this.audio.enabled = this.state.settings.sound;
    this.bindEvents(root);
    this.refresh();
    if (!this.state.welcomed) this.open('welcome');
    if (loaded.recovered) this.ui.toast('The previous save could not be read. Its original contents are kept in browser recovery storage.', false);
    requestAnimationFrame(this.frame);
    if (import.meta.env.DEV) {
      Object.assign(window, { __PATCHWORK__: {
        state: () => structuredClone(this.state),
        screenForPlot: (index: number, height = 0) => this.world.project(tilePosition(index), height),
        screenForPoi: (id: PoiId) => this.world.project(POIS[id].approach),
        debug: () => ({ calls: this.world.renderer.info.render.calls, triangles: this.world.renderer.info.render.triangles, queue: structuredClone(this.queue), path: structuredClone(this.path), target: this.target, sleeping: this.sleeping }),
        capture: () => { this.world.render(0, this.state); this.capturePaused = true; },
      } });
    }
  }

  private bindEvents(root: HTMLElement) {
    window.addEventListener('resize', () => this.world.resize());
    root.addEventListener('pointerdown', () => this.audio.unlock());
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('visibilitychange', () => { this.keys.clear(); this.save(); this.lastFrame = performance.now(); });
    window.addEventListener('pagehide', () => this.save());
    window.addEventListener('beforeunload', () => this.save());
    this.ui.canvas.addEventListener('pointermove', event => {
      this.mouse = { x: event.clientX, y: event.clientY }; this.pointerMode = true;
    });
    this.ui.canvas.addEventListener('pointerleave', () => { if (!this.pointerDown) this.mouse = null; });
    this.ui.canvas.addEventListener('pointerdown', event => { this.pointerDown = { x: event.clientX, y: event.clientY }; });
    this.ui.canvas.addEventListener('pointerup', event => {
      if (this.ui.panel || this.sleeping || !this.pointerDown) return;
      const moved = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y);
      this.pointerDown = null;
      if (moved > 10) return;
      const point = this.world.groundAt(event.clientX, event.clientY);
      if (!point) return;
      this.ui.canvas.focus({ preventScroll: true });
      const index = this.world.pickPlot(event.clientX, event.clientY) ?? tileAt(point);
      if (event.button !== 2 && index !== null) this.queuePlot(index, event.shiftKey);
      else this.walkTo(point);
    });
    this.ui.canvas.addEventListener('pointercancel', () => { this.pointerDown = null; });
    this.ui.canvas.addEventListener('contextmenu', event => event.preventDefault());
    this.ui.canvas.addEventListener('wheel', event => { event.preventDefault(); if (!this.ui.panel) this.world.zoom(event.deltaY); }, { passive: false });
    document.addEventListener('keydown', event => {
      if (event.defaultPrevented || this.sleeping) return;
      this.audio.unlock();
      if (this.ui.panel) return;
      if ((event.target as HTMLElement)?.matches('input,textarea,select')) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
        event.preventDefault(); this.keys.add(event.code); this.pointerMode = false;
        if (!event.code.startsWith('Shift')) this.cancelWalk();
      }
      if (event.repeat) return;
      const digit = Number(event.key);
      if (digit >= 1 && digit <= TOOLS.length) { this.selectTool(TOOLS[digit - 1].id); return; }
      if (event.code === 'KeyE' || event.code === 'Space') {
        if (event.code === 'Space' && (event.target as HTMLElement).closest('button')) return;
        event.preventDefault(); this.interact();
      }
      if (event.code === 'KeyI') this.open('satchel');
      if (event.code === 'KeyJ') this.open('journal');
      if (event.code === 'KeyN') this.open('sleep');
      if (event.code === 'Escape') this.open('settings');
    });
    document.addEventListener('keyup', event => this.keys.delete(event.code));
    document.getElementById('save-import')!.addEventListener('change', async event => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0]; if (!file) return;
      try {
        const imported = parseSave(await file.text());
        this.cancelWalk(); this.state = imported;
        if (!isWalkable(this.state.player)) this.state.player = { ...START_POSITION };
        this.ui.close(); this.save(); this.refresh();
        this.ui.toast('Welcome back. Your farm is just as you left it.');
      } catch (error) { this.ui.toast(error instanceof Error ? error.message : 'That save could not be read.', false); }
      input.value = '';
    });
  }

  private open(panel: Panel) {
    if (this.sleeping) return;
    this.cancelWalk(); this.keys.clear(); this.refresh(); this.ui.open(panel);
  }

  private command(command: Command) {
    if (this.sleeping) return;
    this.audio.unlock();
    const crop = command.crop as CropId, qty = Number(command.qty);
    switch (command.action) {
      case 'panel': this.open(command.panel as Panel); break;
      case 'close':
      case 'begin':
        if (this.ui.panel === 'welcome') { this.state.welcomed = true; this.save(); }
        this.ui.close(); this.refresh(); break;
      case 'tool': this.selectTool(command.tool as Tool); break;
      case 'select-seed':
        if (!CROP_IDS.includes(crop)) return;
        this.seed = crop; this.tool = 'seed'; this.ui.close(); this.refresh();
        this.ui.toast(`${CROPS[crop].name} selected. Choose a prepared patch.`); break;
      case 'visit': this.visit(command.poi as PoiId); break;
      case 'buy': this.result(buySeeds(this.state, crop, qty)); break;
      case 'sell': this.result(sellProduce(this.state, crop, qty)); break;
      case 'ship': this.result(shipProduce(this.state, crop, qty)); break;
      case 'unship': this.result(reclaimShipping(this.state)); break;
      case 'upgrade': this.result(buyRowTools(this.state)); break;
      case 'seed-help': this.result(starterHelp(this.state)); break;
      case 'donate': {
        const result = completeCommons(this.state, command.theme as 'garden' | 'ribbons');
        if (result.ok) { this.ui.close(); this.world.burst(POIS.commons.position, 'celebrate'); }
        this.result(result); break;
      }
      case 'restyle':
        if (this.state.commons && (command.theme === 'garden' || command.theme === 'ribbons')) { this.state.commons = command.theme; this.result({ ok: true, message: 'A fresh look for a familiar little place.', effect: 'plant' }); }
        break;
      case 'sleep': this.sleep(); break;
      case 'tend': this.ui.close(); this.queuePlot(Number(command.index), false); break;
      case 'setting': {
        const key = command.setting as keyof GameState['settings'];
        if (['sound', 'relaxed', 'reducedMotion'].includes(key)) {
          this.state.settings[key] = !this.state.settings[key]; this.audio.enabled = this.state.settings.sound;
          this.save(); this.refresh(); this.ui.refreshPanel();
        }
        break;
      }
      case 'export': this.exportSave(); break;
      case 'import': (document.getElementById('save-import') as HTMLInputElement).click(); break;
      case 'reset':
        this.cancelWalk(); this.state = createGame(); this.tool = 'care'; this.seed = 'dewturnip'; this.ui.close();
        this.save(); this.refresh(); this.open('welcome'); break;
    }
  }

  private selectTool(tool: Tool) {
    if (!TOOLS.some(entry => entry.id === tool)) return;
    this.tool = tool; this.cancelWalk(); this.refresh(); this.audio.play('select');
    this.ui.canvas.focus({ preventScroll: true });
  }

  private save() { this.saved = saveGame(this.state); this.saveElapsed = 0; }
  private refresh() {
    this.audio.enabled = this.state.settings.sound;
    this.world?.sync(this.state); this.ui.render(this.state, this.tool, this.seed, this.saved);
    this.ui.inspect(this.state, this.target);
  }

  private result(result: ActionResult, point?: Point) {
    this.ui.toast(result.message, result.ok);
    if (result.ok) {
      if (result.effect) { this.audio.play(result.effect); if (point && !this.state.settings.reducedMotion) this.world.burst(point, result.effect); }
      this.save(); this.refresh(); this.ui.refreshPanel();
    }
  }

  private exportSave() {
    this.save();
    const url = URL.createObjectURL(new Blob([JSON.stringify(this.state, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `patchwork-commons-day-${this.state.day + 1}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.ui.toast('A little copy of your farm, ready to keep.');
  }

  private cancelWalk() { this.path = []; this.queue = []; }
  private walkTo(point: Point) {
    this.cancelWalk();
    const path = findPath(this.state.player, point);
    if (!path) { this.ui.toast('That spot is out of reach. Try the path nearby.', false); return; }
    this.path = path; this.world.markDestination(point);
  }

  private queuePlot(index: number, batch: boolean) {
    if (!Number.isInteger(index) || !this.state.plots[index]) return;
    this.cancelWalk();
    const indexes = [index];
    if (batch && this.state.rowTools) {
      const column = index % GRID_SIZE;
      if (column + 1 < GRID_SIZE) indexes.push(index + 1);
      if (column + 2 < GRID_SIZE) indexes.push(index + 2);
    }
    this.queue = indexes.map(index => ({ kind: 'plot', index, tool: this.tool, seed: this.seed }));
    this.beginDestination();
  }

  private visit(id: PoiId) {
    if (!POIS[id]) return;
    this.cancelWalk(); this.queue.push({ kind: 'poi', id }); this.beginDestination();
  }

  private beginDestination() {
    const destination = this.queue[0]; if (!destination) return;
    const point = destination.kind === 'plot' ? tilePosition(destination.index) : POIS[destination.id].approach;
    const path = findPath(this.state.player, point);
    if (!path) { this.cancelWalk(); this.ui.toast('Let’s try that from the path.', false); return; }
    this.path = path; this.world.markDestination(point);
  }

  private interact() {
    if (this.target !== null && distance(this.state.player, tilePosition(this.target)) < 1.7) {
      this.queuePlot(this.target, this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')); return;
    }
    const closest = (Object.keys(POIS) as PoiId[]).sort((a, b) => distance(this.state.player, POIS[a].approach) - distance(this.state.player, POIS[b].approach))[0];
    if (distance(this.state.player, POIS[closest].approach) < 2) { this.visit(closest); return; }
    const front = { x: this.state.player.x + Math.sin(this.facing) * .9, z: this.state.player.z + Math.cos(this.facing) * .9 };
    const index = tileAt(front);
    if (index !== null) this.queuePlot(index, this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));
    else this.ui.toast('Face a growing patch or visit a marked spot to interact.');
  }

  private executeDestination() {
    const destination = this.queue.shift(); if (!destination) return;
    this.path = []; this.actionCooldown = .3;
    if (destination.kind === 'plot') {
      this.result(tendPlot(this.state, destination.index, destination.tool, destination.seed), tilePosition(destination.index));
      if (this.queue.length) this.beginDestination();
    } else if (destination.id === 'well') {
      this.state.water = WATER_CAPACITY;
      this.result({ ok: true, message: 'Fresh water, all filled up. The well is always here.', effect: 'water' }, POIS.well.position);
    } else {
      this.open(({ home: 'sleep', market: 'market', shipping: 'shipping', commons: 'commons' } as const)[destination.id]);
    }
  }

  private sleep() {
    if (this.sleeping) return;
    this.sleeping = true; this.cancelWalk(); this.keys.clear(); this.ui.close(); this.ui.transition(true);
    const duration = this.state.settings.reducedMotion ? 30 : 550;
    window.setTimeout(() => {
      const report = advanceDay(this.state);
      this.save(); this.refresh(); this.world.setPlayer(this.state.player, 0, false);
      window.setTimeout(() => {
        this.ui.transition(false); this.sleeping = false; this.audio.play('celebrate'); this.ui.open('morning', report);
      }, duration);
    }, duration);
  }

  private gamepad(): Point {
    const pad = navigator.getGamepads?.().find(pad => pad?.connected);
    if (!pad) { this.gamepadButtons = []; return { x: 0, z: 0 }; }
    const pressed = pad.buttons.map(button => button.pressed);
    const edge = (index: number) => pressed[index] && !this.gamepadButtons[index];
    if (!this.sleeping) {
      if (this.ui.panel) {
        if (edge(12) || edge(14)) this.ui.moveFocus(-1);
        if (edge(13) || edge(15)) this.ui.moveFocus(1);
        if (edge(0)) (document.activeElement as HTMLElement)?.click();
        if (edge(1)) this.command({ action: 'close' });
      } else {
        if (edge(0) || edge(2)) this.interact();
        if (edge(3)) this.open('satchel');
        if (edge(9)) this.open('journal');
        if (edge(1)) this.cancelWalk();
        if (edge(4) || edge(5)) { const index = TOOLS.findIndex(entry => entry.id === this.tool); this.selectTool(TOOLS[(index + (edge(4) ? -1 : 1) + TOOLS.length) % TOOLS.length].id); }
      }
    }
    this.gamepadButtons = pressed;
    return { x: Math.abs(pad.axes[0] ?? 0) > .18 ? pad.axes[0] : 0, z: Math.abs(pad.axes[1] ?? 0) > .18 ? -pad.axes[1] : 0 };
  }

  private frame = () => {
    // Simulation follows elapsed active time, not the renderer's frame rate.
    // Collision movement is sub-stepped; hidden-tab time is reset separately.
    const now = performance.now();
    const dt = Math.max(0, Math.min((now - this.lastFrame) / 1000, 2)); this.lastFrame = now;
    const pad = this.gamepad();
    let moving = false;
    const paused = !!this.ui.panel || this.sleeping || document.hidden || this.capturePaused;
    if (!paused) {
      this.state.minutes = Math.min(DAY_END, this.state.minutes + dt * (DAY_END - DAY_START) / ((this.state.settings.relaxed ? 30 : 18) * 60));
      this.actionCooldown = Math.max(0, this.actionCooldown - dt);
      const horizontal = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')) + pad.x;
      const vertical = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) + pad.z;
      if (Math.abs(horizontal) + Math.abs(vertical) > .01) {
        this.cancelWalk(); this.pointerMode = false;
        const length = Math.max(1, Math.hypot(horizontal, vertical));
        const dx = (horizontal - vertical) / Math.SQRT2 / length, dz = (-horizontal - vertical) / Math.SQRT2 / length;
        const old = this.state.player;
        this.state.player = slideMove(old, { x: dx * dt * 3.1, z: dz * dt * 3.1 });
        moving = distance(old, this.state.player) > .0001; this.facing = Math.atan2(dx, dz);
      } else if (this.path.length) {
        const travel = followPath(this.state.player, this.path, dt);
        this.state.player = travel.position; this.path = travel.path; moving = travel.moving;
        if (travel.facing !== null) this.facing = travel.facing;
        if (travel.blocked) { this.cancelWalk(); this.ui.toast('The path is blocked. Choose a nearby spot.', false); }
      }
      const destination = this.queue[0];
      if (destination && this.actionCooldown === 0) {
        const point = destination.kind === 'plot' ? tilePosition(destination.index) : POIS[destination.id].approach;
        if (distance(this.state.player, point) < (destination.kind === 'plot' ? 1.05 : .25)) this.executeDestination();
      }
      this.saveElapsed += dt; if (this.saveElapsed > 8) this.save();
    }
    if (this.pointerMode && this.mouse && !paused) {
      const point = this.world.groundAt(this.mouse.x, this.mouse.y);
      this.target = this.world.pickPlot(this.mouse.x, this.mouse.y) ?? (point ? tileAt(point) : null);
    } else if (!this.pointerMode && !paused) {
      this.target = tileAt({ x: this.state.player.x + Math.sin(this.facing) * .8, z: this.state.player.z + Math.cos(this.facing) * .8 });
    } else this.target = null;
    this.world.setTarget(this.target);
    this.world.setPlayer(this.state.player, this.facing, moving);
    if (!this.capturePaused && !document.hidden) this.world.render(dt, this.state);
    for (const [id, element] of this.ui.labels) {
      const point = this.world.project(POIS[id].position, POIS[id].labelHeight);
      element.style.left = `${point.x}px`; element.style.top = `${point.y}px`;
    }
    this.uiElapsed += dt;
    if (this.uiElapsed > .18) { this.uiElapsed = 0; this.ui.render(this.state, this.tool, this.seed, this.saved); this.ui.inspect(this.state, this.target); }
    requestAnimationFrame(this.frame);
  };
}

try { new FarmGame(document.getElementById('app')!); }
catch (error) {
  console.error(error);
  const root = document.getElementById('app')!;
  root.innerHTML = '<main class="error-screen"><h1>Your little farm needs WebGL.</h1><p>Please use a recent browser with hardware acceleration enabled, then reload. Your existing local farm save is preserved.</p><button class="primary" id="retry">Try again</button></main>';
  document.getElementById('retry')!.addEventListener('click', () => location.reload());
}
