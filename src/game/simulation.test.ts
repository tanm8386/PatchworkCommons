import { describe, expect, it } from 'vitest';
import { calendar, POIS, START_POSITION, tilePosition, WATER_CAPACITY } from './catalog';
import { advanceDay, buySeeds, completeCommons, createGame, reclaimShipping, sellProduce, shipProduce, tendPlot } from './simulation';
import { parseSave } from './persistence';
import { findPath, followPath, isWalkable, lineClear, slideMove } from './navigation';

describe('care and deterministic daily growth', () => {
  it('only grows watered, in-season crops and leaves ripe crops ready', () => {
    const state = createGame();
    tendPlot(state, 2, 'water', 'dewturnip');
    const report = advanceDay(state);
    expect(state.plots[0].crop?.remaining).toBe(0);
    expect(state.plots[2].crop?.remaining).toBe(0);
    expect(state.plots[3].crop?.remaining).toBe(1);
    expect(report).toMatchObject({ ready: 3, grew: 1, paused: 1 });
  });
  it('uses the old season for the final growth night, then preserves the harvest', () => {
    const state = createGame(); state.day = 27;
    state.plots[2].wet = true;
    advanceDay(state);
    expect(calendar(state.day).season).toBe('Summer');
    expect(state.plots[2].crop?.remaining).toBe(0);
    expect(tendPlot(state, 2, 'harvest', 'dewturnip').ok).toBe(true);
  });
  it('pauses out-of-season crops even when watered and recovers unused seeds', () => {
    const state = createGame(); state.day = 28; state.plots[2].wet = true;
    advanceDay(state);
    expect(state.plots[2].crop?.remaining).toBe(1);
    const seeds = state.seeds.dewturnip;
    expect(tendPlot(state, 2, 'lift', 'dewturnip').ok).toBe(true);
    expect(state.seeds.dewturnip).toBe(seeds + 1);
    expect(state.plots[2].crop).toBeNull();
  });
  it('rejects wrong-season planting without consuming seeds', () => {
    const state = createGame(); state.day = 28;
    expect(tendPlot(state, 4, 'seed', 'dewturnip').ok).toBe(false);
    expect(state.seeds.dewturnip).toBe(12);
  });
  it('consumes water once, blocks empty cans, and supports pre-watering', () => {
    const state = createGame();
    tendPlot(state, 4, 'water', 'dewturnip');
    expect(state.water).toBe(WATER_CAPACITY - 1);
    expect(tendPlot(state, 4, 'water', 'dewturnip').ok).toBe(false);
    tendPlot(state, 4, 'seed', 'dewturnip'); advanceDay(state);
    expect(state.plots[4].crop?.remaining).toBe(2);
    state.water = 0; state.plots[4].wet = false;
    expect(tendPlot(state, 4, 'water', 'dewturnip').ok).toBe(false);
  });
  it('regrows beans without reseeding and cannot refund a previously harvested seed', () => {
    const state = createGame(); state.plots[3].crop!.remaining = 0;
    const seeds = state.seeds.ribbonbean;
    tendPlot(state, 3, 'harvest', 'ribbonbean');
    expect(state.produce.ribbonbean).toBe(1);
    expect(state.plots[3].crop).toMatchObject({ remaining: 3, harvests: 1 });
    tendPlot(state, 3, 'lift', 'ribbonbean');
    expect(state.seeds.ribbonbean).toBe(seeds);
  });
  it('rejects a second harvest of the same root crop', () => {
    const state = createGame();
    expect(tendPlot(state, 0, 'harvest', 'dewturnip').ok).toBe(true);
    expect(tendPlot(state, 0, 'harvest', 'dewturnip').ok).toBe(false);
    expect(state.produce.dewturnip).toBe(1);
  });
});

describe('transactions and community contributions', () => {
  it('stages shipping, permits unpacking, and pays each shipment only once', () => {
    const state = createGame(); state.produce.dewturnip = 4;
    shipProduce(state, 'dewturnip', 2);
    expect(state.coins).toBe(160); expect(state.produce.dewturnip).toBe(2);
    reclaimShipping(state); expect(state.produce.dewturnip).toBe(4);
    shipProduce(state, 'dewturnip', 3);
    expect(advanceDay(state).earned).toBe(60);
    expect(advanceDay(state).earned).toBe(0);
    expect(state.coins).toBe(220); expect(state.stats.shipped).toBe(3);
  });
  it('rejects negative, fractional, unavailable, and unaffordable transactions', () => {
    const state = createGame(); const before = structuredClone(state);
    expect(buySeeds(state, 'dewturnip', -1).ok).toBe(false);
    expect(buySeeds(state, 'dewturnip', .5).ok).toBe(false);
    expect(buySeeds(state, 'dewturnip', 1000).ok).toBe(false);
    expect(sellProduce(state, 'dewturnip', 1).ok).toBe(false);
    expect(shipProduce(state, 'dewturnip', -1).ok).toBe(false);
    expect(state).toEqual(before);
  });
  it('consumes a project contribution without paying it as a sale or repeating rewards', () => {
    const state = createGame(); state.produce.dewturnip = 8;
    expect(completeCommons(state, 'garden').ok).toBe(true);
    expect(state.produce.dewturnip).toBe(2); expect(state.coins).toBe(160);
    expect(completeCommons(state, 'garden').ok).toBe(false);
    expect(state.produce.dewturnip).toBe(2);
    expect(advanceDay(state).earned).toBe(0);
  });
});

describe('save boundaries', () => {
  it('round-trips state without advancing offline time', () => {
    const state = createGame(); tendPlot(state, 2, 'water', 'dewturnip');
    shipProduce(Object.assign(state, { produce: { ...state.produce, dewturnip: 4 } }), 'dewturnip', 2);
    const saved = JSON.stringify(state);
    expect(parseSave(saved)).toEqual(state);
  });
  it('rejects unsupported saves and impossible resource or growth states', () => {
    for (const patch of [{ version: 2 }, { coins: -1 }, { minutes: 2000 }, { player: { x: null, z: 0 } }, { plots: [] }]) {
      expect(() => parseSave(JSON.stringify({ ...createGame(), ...patch }))).toThrow();
    }
    const state = createGame(); state.plots[0].crop!.remaining = 99;
    expect(() => parseSave(JSON.stringify(state))).toThrow();
    expect(() => parseSave('not json')).toThrow();
  });
});

describe('fixed-camera farm navigation', () => {
  it('travels the same distance at high and low frame rates, including waypoint turns', () => {
    const run = (fps: number) => {
      let player = { x: 0, z: 6 };
      let path = [{ x: 1, z: 6 }, { x: 1, z: 7 }, { x: 6, z: 7 }];
      for (let frame = 0; frame < fps; frame++) {
        const travel = followPath(player, path, 1 / fps);
        expect(travel.blocked).toBe(false);
        player = travel.position; path = travel.path;
      }
      return player;
    };
    for (const fps of [1, 5, 15, 60]) {
      expect(run(fps).x).toBeCloseTo(2.8, 5);
      expect(run(fps).z).toBeCloseTo(7, 5);
    }
  });
  it('finds collision-free routes to every service and every farm tile', () => {
    for (const destination of [...Object.values(POIS).map(poi => poi.approach), ...Array.from({ length: 36 }, (_, i) => tilePosition(i))]) {
      const path = findPath(START_POSITION, destination);
      expect(path, JSON.stringify(destination)).not.toBeNull();
      let from = START_POSITION;
      for (const point of path!) { expect(lineClear(from, point)).toBe(true); from = point; }
    }
  });
  it('rejects buildings, water, and out-of-bounds destinations', () => {
    expect(isWalkable(POIS.home.position)).toBe(false);
    expect(findPath(START_POSITION, { x: 11, z: 2 })).toBeNull();
    expect(findPath(START_POSITION, { x: 0, z: 30 })).toBeNull();
    const moved = slideMove({ x: 8.99, z: 0 }, { x: 1, z: .2 });
    expect(moved.x).toBe(8.99); expect(moved.z).toBeCloseTo(.2);
  });
});
