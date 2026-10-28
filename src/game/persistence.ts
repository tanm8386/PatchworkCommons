import { CROP_IDS, CROPS, DAY_END, DAY_START, GRID_SIZE, SAVE_KEY, WATER_CAPACITY } from './catalog';
import { createGame } from './simulation';
import type { GameState } from './simulation';

export function parseSave(raw: string): GameState {
  if (raw.length > 200_000) throw new Error('This save file is larger than expected.');
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('This is not a farm save.');
  const s = data as GameState;
  const number = (value: unknown, max = 1_000_000_000, min = 0) => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  if (s.version !== 1) throw new Error('This save uses an unsupported version.');
  if (!number(s.day, 100_000) || !number(s.coins) || !number(s.water, WATER_CAPACITY) || typeof s.minutes !== 'number' || !Number.isFinite(s.minutes) || s.minutes < DAY_START || s.minutes > DAY_END) throw new Error('The farm calendar or resources are invalid.');
  for (const stock of [s.seeds, s.produce, s.shipping]) {
    if (!object(stock) || !CROP_IDS.every(kind => number(stock[kind]))) throw new Error('The inventory is invalid.');
  }
  if (!Array.isArray(s.plots) || s.plots.length !== GRID_SIZE ** 2) throw new Error('The farm field is incomplete.');
  for (const plot of s.plots) {
    if (!object(plot) || typeof plot.tilled !== 'boolean' || typeof plot.wet !== 'boolean') throw new Error('A growing patch is invalid.');
    if (plot.crop !== null) {
      const crop = plot.crop;
      if (!object(crop) || !CROP_IDS.includes(crop.kind as never)) throw new Error('A crop type is unknown.');
      const definition = CROPS[crop.kind as keyof typeof CROPS];
      if (!plot.tilled || !number(crop.remaining, definition.grow) || !number(crop.harvests)) throw new Error('A crop growth stage is invalid.');
    }
  }
  if (!object(s.player) || !Number.isFinite(s.player.x) || !Number.isFinite(s.player.z) || Math.abs(s.player.x as number) > 11 || Math.abs(s.player.z as number) > 9) throw new Error('The player position is invalid.');
  if (!object(s.stats) || !['harvested', 'planted', 'watered', 'shipped', 'earned', 'slept'].every(key => number((s.stats as unknown as Record<string, unknown>)[key]))) throw new Error('The farm milestones are invalid.');
  if (![null, 'garden', 'ribbons'].includes(s.commons) || typeof s.rowTools !== 'boolean' || typeof s.welcomed !== 'boolean') throw new Error('The farm progress is invalid.');
  if (!object(s.settings) || !['sound', 'relaxed', 'reducedMotion'].every(key => typeof (s.settings as unknown as Record<string, unknown>)[key] === 'boolean')) throw new Error('The settings are invalid.');
  // Copy only recognized fields rather than keeping unknown imported properties.
  const clean = createGame();
  for (const key of Object.keys(clean) as (keyof GameState)[]) Object.assign(clean, { [key]: structuredClone(s[key]) });
  return clean;
}

export function loadGame(): { state: GameState; recovered: boolean; storageAvailable: boolean } {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { state: createGame(), recovered: false, storageAvailable: true };
    try { return { state: parseSave(raw), recovered: false, storageAvailable: true }; }
    catch {
      localStorage.setItem(`${SAVE_KEY}.recovery`, raw);
      return { state: createGame(), recovered: true, storageAvailable: true };
    }
  } catch { return { state: createGame(), recovered: false, storageAvailable: false }; }
}

export function saveGame(state: GameState): boolean {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); return true; }
  catch { return false; }
}
