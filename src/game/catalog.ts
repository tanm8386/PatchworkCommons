export const CROP_IDS = ['dewturnip', 'ribbonbean', 'puffradish', 'pearloat'] as const;
export type CropId = (typeof CROP_IDS)[number];
export type Season = 'Spring' | 'Summer' | 'Autumn' | 'Winter';
export type Weather = 'sunny' | 'cloudy' | 'rain';
export type Tool = 'care' | 'hoe' | 'seed' | 'water' | 'harvest' | 'lift';
export type Point = { x: number; z: number };
export type PoiId = 'home' | 'market' | 'well' | 'shipping' | 'commons';

export interface CropDefinition {
  name: string;
  plural: string;
  grow: number;
  regrow: number | null;
  buy: number;
  sell: number;
  seasons: Season[];
  color: string;
  description: string;
}

export const CROPS: Record<CropId, CropDefinition> = {
  dewturnip: { name: 'Dewturnip', plural: 'Dewturnips', grow: 3, regrow: null, buy: 8, sell: 20, seasons: ['Spring', 'Autumn'], color: '#b69cc5', description: 'A little purple crown, a wonderfully sweet root. Your dependable first harvest.' },
  ribbonbean: { name: 'Ribbon Bean', plural: 'Ribbon Beans', grow: 4, regrow: 3, buy: 16, sell: 14, seasons: ['Spring', 'Summer'], color: '#8daf6c', description: 'Climbing leaves and curly pods. Keeps giving a new harvest every three growing nights.' },
  puffradish: { name: 'Puffradish', plural: 'Puffradishes', grow: 2, regrow: null, buy: 6, sell: 14, seasons: ['Summer', 'Winter'], color: '#dc8e97', description: 'Round, rosy, and ready in a hurry. A cheerful crop for warm and snowy days.' },
  pearloat: { name: 'Pearl Oat', plural: 'Pearl Oats', grow: 4, regrow: null, buy: 10, sell: 28, seasons: ['Autumn', 'Winter'], color: '#d5b865', description: 'Golden little stems that feel at home in the cooler half of the year.' },
};

export const SEASONS: Season[] = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const GRID_SIZE = 6;
export const TILE_SIZE = 1.12;
export const FIELD_ORIGIN = { x: -3.25, z: -1.65 };
export const START_POSITION = { x: 0.4, z: 6 };
export const DAY_START = 360;
export const DAY_END = 1320;
export const WATER_CAPACITY = 24;
export const SAVE_KEY = 'patchwork-commons.farm.v1';

export const TOOLS: { id: Tool; name: string; key: string; help: string }[] = [
  { id: 'care', name: 'Care', key: '1', help: 'Pick, water, sow, or till—whatever this patch needs.' },
  { id: 'hoe', name: 'Till', key: '2', help: 'Turn grass into a little growing patch.' },
  { id: 'seed', name: 'Sow', key: '3', help: 'Plant your selected seeds in prepared soil.' },
  { id: 'water', name: 'Water', key: '4', help: 'A drink today means a little growth overnight.' },
  { id: 'harvest', name: 'Pick', key: '5', help: 'Bring ripe crops into your satchel.' },
  { id: 'lift', name: 'Lift', key: '6', help: 'Recover an unfinished seed, or clear a spent plant.' },
];

export const POIS: Record<PoiId, { name: string; hint: string; position: Point; approach: Point; labelHeight: number }> = {
  home: { name: 'Your cottage', hint: 'Rest & begin a new day', position: { x: -6.2, z: -5.5 }, approach: { x: -6.2, z: -3.15 }, labelHeight: 3.9 },
  market: { name: 'Seed stall', hint: 'Little seeds, big possibilities', position: { x: 5.8, z: -4.4 }, approach: { x: 5.8, z: -2.75 }, labelHeight: 2.9 },
  well: { name: 'The well', hint: 'Refill your watering can', position: { x: -5.7, z: 1.4 }, approach: { x: -5.7, z: 2.75 }, labelHeight: 2.0 },
  shipping: { name: 'Shipping box', hint: 'A harvest on its way', position: { x: 5.4, z: 3 }, approach: { x: 5.4, z: 4.2 }, labelHeight: 1.3 },
  commons: { name: 'Welcome Nook', hint: 'Make a place for everyone', position: { x: -5.3, z: 6.1 }, approach: { x: -3.65, z: 6.1 }, labelHeight: 1.4 },
};

export function tilePosition(index: number): Point {
  return { x: FIELD_ORIGIN.x + (index % GRID_SIZE) * TILE_SIZE, z: FIELD_ORIGIN.z + Math.floor(index / GRID_SIZE) * TILE_SIZE };
}

export function tileAt(point: Point): number | null {
  const col = Math.round((point.x - FIELD_ORIGIN.x) / TILE_SIZE);
  const row = Math.round((point.z - FIELD_ORIGIN.z) / TILE_SIZE);
  if (col < 0 || col >= GRID_SIZE || row < 0 || row >= GRID_SIZE) return null;
  return row * GRID_SIZE + col;
}

export function calendar(day: number) {
  return { season: SEASONS[Math.floor(day / 28) % 4], day: day % 28 + 1, year: Math.floor(day / 112) + 1 };
}

export function weatherFor(day: number): Weather {
  if (day === 0) return 'sunny';
  const pattern = (day * 13 + 7) % 11;
  return pattern < 3 ? 'rain' : pattern < 5 ? 'cloudy' : 'sunny';
}

export function distance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.z - b.z); }
