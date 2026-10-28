import { CROP_IDS, CROPS, DAY_START, GRID_SIZE, START_POSITION, WATER_CAPACITY, calendar, weatherFor } from './catalog';
import type { CropId, Point, Tool } from './catalog';

export type Stock = Record<CropId, number>;
export interface Plot {
  tilled: boolean;
  wet: boolean;
  crop: { kind: CropId; remaining: number; harvests: number } | null;
}
export interface GameState {
  version: 1;
  day: number;
  minutes: number;
  coins: number;
  water: number;
  seeds: Stock;
  produce: Stock;
  shipping: Stock;
  plots: Plot[];
  player: Point;
  stats: { harvested: number; planted: number; watered: number; shipped: number; earned: number; slept: number };
  commons: 'garden' | 'ribbons' | null;
  rowTools: boolean;
  settings: { sound: boolean; relaxed: boolean; reducedMotion: boolean };
  welcomed: boolean;
}
export interface ActionResult { ok: boolean; message: string; effect?: 'soil' | 'plant' | 'water' | 'harvest' | 'coin' | 'celebrate'; }
export interface MorningReport { earned: number; ready: number; grew: number; paused: number; }

export function emptyStock(): Stock { return { dewturnip: 0, ribbonbean: 0, puffradish: 0, pearloat: 0 }; }
export function createGame(): GameState {
  const plots: Plot[] = Array.from({ length: GRID_SIZE ** 2 }, (_, i) => ({ tilled: i < 12, wet: false, crop: null }));
  plots[0].crop = { kind: 'dewturnip', remaining: 0, harvests: 0 };
  plots[1].crop = { kind: 'dewturnip', remaining: 0, harvests: 0 };
  plots[2].crop = { kind: 'dewturnip', remaining: 1, harvests: 0 };
  plots[3].crop = { kind: 'ribbonbean', remaining: 1, harvests: 0 };
  return {
    version: 1, day: 0, minutes: 480, coins: 160, water: WATER_CAPACITY,
    seeds: { dewturnip: 12, ribbonbean: 6, puffradish: 0, pearloat: 0 },
    produce: emptyStock(), shipping: emptyStock(), plots, player: { ...START_POSITION },
    stats: { harvested: 0, planted: 0, watered: 0, shipped: 0, earned: 0, slept: 0 },
    commons: null, rowTools: false,
    settings: { sound: true, relaxed: false, reducedMotion: false }, welcomed: false,
  };
}

const fail = (message: string): ActionResult => ({ ok: false, message });
const success = (message: string, effect?: ActionResult['effect']): ActionResult => ({ ok: true, message, effect });

export function contextualTool(plot: Plot): Tool {
  if (plot.crop?.remaining === 0) return 'harvest';
  if (plot.crop) return 'water';
  return plot.tilled ? 'seed' : 'hoe';
}

export function tendPlot(state: GameState, index: number, selected: Tool, seed: CropId): ActionResult {
  const plot = state.plots[index];
  if (!plot) return fail('Choose a growing patch inside the field.');
  const tool = selected === 'care' ? contextualTool(plot) : selected;
  const season = calendar(state.day).season;
  if (tool === 'hoe') {
    if (plot.tilled) return fail('This little patch is already prepared.');
    plot.tilled = true;
    return success('A fresh patch, ready for a seed.', 'soil');
  }
  if (tool === 'seed') {
    if (!plot.tilled) return fail('Till this patch before planting.');
    if (plot.crop) return fail('Something is already growing here.');
    if (!CROP_IDS.includes(seed)) return fail('Choose a seed from your satchel.');
    const definition = CROPS[seed];
    if (!definition.seasons.includes(season)) return fail(`${definition.name} grows in ${definition.seasons.join(' and ')}. Try another seed.`);
    if (state.seeds[seed] < 1) return fail(`You’re out of ${definition.name} seeds. Visit the seed stall.`);
    state.seeds[seed]--;
    plot.crop = { kind: seed, remaining: definition.grow, harvests: 0 };
    state.stats.planted++;
    return success(`${definition.name} planted. ${definition.grow} watered nights until harvest.`, 'plant');
  }
  if (tool === 'water') {
    if (!plot.tilled) return fail('Prepare this patch before watering.');
    if (plot.wet) return fail('Already watered. This patch has everything it needs.');
    if (state.water <= 0) return fail('Your watering can is empty. The well has plenty to share.');
    state.water--;
    plot.wet = true;
    state.stats.watered++;
    return success('A little drink. A little growth tonight.', 'water');
  }
  if (tool === 'harvest') {
    if (!plot.crop) return fail('Nothing is growing on this patch yet.');
    if (plot.crop.remaining > 0) return fail(`${CROPS[plot.crop.kind].name} needs ${plot.crop.remaining} more growing ${plot.crop.remaining === 1 ? 'night' : 'nights'}.`);
    const definition = CROPS[plot.crop.kind];
    state.produce[plot.crop.kind]++;
    state.stats.harvested++;
    if (definition.regrow) {
      plot.crop.harvests++;
      plot.crop.remaining = definition.regrow;
    } else plot.crop = null;
    return success(`One ${definition.name}, grown with care.`, 'harvest');
  }
  if (tool === 'lift') {
    if (!plot.crop) return fail('This patch is already empty.');
    if (plot.crop.remaining === 0) return fail('Pick this ripe crop before lifting the plant.');
    const { kind, harvests } = plot.crop;
    if (harvests === 0) state.seeds[kind]++;
    plot.crop = null;
    return success(harvests === 0 ? `${CROPS[kind].name} seed returned to your satchel.` : 'The spent plant is cleared. A fresh start.', 'soil');
  }
  return fail('Choose a tool.');
}

function validQuantity(kind: CropId, quantity: number) {
  return CROP_IDS.includes(kind) && Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 100_000;
}

export function buySeeds(state: GameState, kind: CropId, quantity: number): ActionResult {
  if (!validQuantity(kind, quantity)) return fail('Choose a valid seed quantity.');
  const cost = CROPS[kind].buy * quantity;
  if (state.coins < cost) return fail('A few more coins will cover these seeds.');
  state.coins -= cost;
  state.seeds[kind] += quantity;
  return success(`${quantity} ${CROPS[kind].name} ${quantity === 1 ? 'seed' : 'seeds'} tucked away.`, 'coin');
}

export function shipProduce(state: GameState, kind: CropId, quantity: number): ActionResult {
  if (!validQuantity(kind, quantity) || state.produce[kind] < quantity) return fail('That harvest isn’t in your satchel.');
  state.produce[kind] -= quantity;
  state.shipping[kind] += quantity;
  return success(`${quantity} ${CROPS[kind].plural} set aside. Paid at the next dawn.`, 'plant');
}

export function reclaimShipping(state: GameState): ActionResult {
  for (const kind of CROP_IDS) { state.produce[kind] += state.shipping[kind]; state.shipping[kind] = 0; }
  return success('Your shipment is back in your satchel.');
}

export function sellProduce(state: GameState, kind: CropId, quantity: number): ActionResult {
  if (!validQuantity(kind, quantity) || state.produce[kind] < quantity) return fail('That harvest isn’t available to sell.');
  const earnings = CROPS[kind].sell * quantity;
  state.produce[kind] -= quantity;
  state.coins += earnings;
  state.stats.earned += earnings;
  state.stats.shipped += quantity;
  return success(`A lovely harvest. ${earnings} coins earned.`, 'coin');
}

export function shipmentValue(state: GameState): number {
  return CROP_IDS.reduce((sum, kind) => sum + CROPS[kind].sell * state.shipping[kind], 0);
}

export function advanceDay(state: GameState): MorningReport {
  const report: MorningReport = { earned: shipmentValue(state), ready: 0, grew: 0, paused: 0 };
  const oldSeason = calendar(state.day).season;
  for (const plot of state.plots) {
    if (plot.crop && plot.crop.remaining > 0) {
      if (plot.wet && CROPS[plot.crop.kind].seasons.includes(oldSeason)) { plot.crop.remaining--; report.grew++; }
      else report.paused++;
    }
    if (plot.crop?.remaining === 0) report.ready++;
  }
  state.coins += report.earned;
  state.stats.earned += report.earned;
  state.stats.shipped += CROP_IDS.reduce((sum, kind) => sum + state.shipping[kind], 0);
  state.shipping = emptyStock();
  state.day++;
  state.minutes = DAY_START;
  state.stats.slept++;
  const rain = weatherFor(state.day) === 'rain';
  for (const plot of state.plots) plot.wet = rain;
  state.player = { x: -6.2, z: -3.15 };
  return report;
}

export function completeCommons(state: GameState, theme: 'garden' | 'ribbons'): ActionResult {
  if (state.commons) return fail('The Welcome Nook is already part of your village.');
  if (theme !== 'garden' && theme !== 'ribbons') return fail('Choose a valid contribution.');
  const kind = theme === 'garden' ? 'dewturnip' : 'ribbonbean';
  const quantity = theme === 'garden' ? 6 : 9;
  if (state.produce[kind] < quantity) return fail(`This little gathering needs ${quantity} ${CROPS[kind].plural}.`);
  state.produce[kind] -= quantity;
  state.commons = theme;
  return success('A little place to sit. A bigger place to belong. The Welcome Nook is open!', 'celebrate');
}

export function buyRowTools(state: GameState): ActionResult {
  if (state.rowTools) return fail('Your row attachments are already fitted.');
  if (state.coins < 600) return fail('Row attachments cost 600 coins.');
  state.coins -= 600;
  state.rowTools = true;
  return success('Room to grow. Hold Shift when tending a patch to work a row of three.', 'celebrate');
}

export function starterHelp(state: GameState): ActionResult {
  const suitable = CROP_IDS.find(kind => CROPS[kind].seasons.includes(calendar(state.day).season))!;
  if (state.coins >= CROPS[suitable].buy || state.plots.some(plot => plot.crop !== null) || CROP_IDS.some(kind => state.produce[kind] > 0 || state.shipping[kind] > 0 || (state.seeds[kind] > 0 && CROPS[kind].seasons.includes(calendar(state.day).season)))) {
    return fail('You have the makings of a new harvest already. Come back if you need a fresh start.');
  }
  state.seeds[suitable] += 3;
  return success(`From the village seed library: 3 ${CROPS[suitable].name} seeds. Everyone starts somewhere.`, 'plant');
}

export function plotDescription(state: GameState, index: number): { title: string; detail: string } {
  const plot = state.plots[index];
  if (!plot.crop) return { title: plot.tilled ? 'A little possibility' : 'Room to grow', detail: plot.tilled ? 'Prepared soil · ready for a seed' : 'Untilled earth · make a new patch' };
  const definition = CROPS[plot.crop.kind];
  if (!plot.crop.remaining) return { title: definition.name, detail: 'Ready to pick · stays fresh until you do' };
  if (!definition.seasons.includes(calendar(state.day).season)) return { title: definition.name, detail: `Resting · grows in ${definition.seasons.join(' / ')} · lift an unused seed to recover it` };
  return { title: definition.name, detail: `${plot.wet ? 'Watered' : 'Needs water'} · ${plot.crop.remaining} growing ${plot.crop.remaining === 1 ? 'night' : 'nights'} to go` };
}
