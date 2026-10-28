import type { Point } from './catalog';

export const TREES = [
  { x: -9.1, z: -6.8, size: 1.2 }, { x: -9.6, z: -2.7, size: 1 },
  { x: -9.1, z: 4.6, size: 1.15 }, { x: -8.5, z: 7.2, size: .85 },
  { x: -2.4, z: -7.8, size: 1.1 }, { x: 1, z: -7.6, size: .9 },
  { x: 8.1, z: -6.9, size: 1.1 }, { x: 8.3, z: 6.8, size: 1 },
];
const BLOCKS = [
  { x: -6.2, z: -5.5, w: 2.08, d: 1.78 },
  { x: 5.8, z: -4.4, w: 1.7, d: .95 },
  { x: -5.7, z: 1.4, w: .67, d: .67 },
  { x: 5.4, z: 3, w: .63, d: .48 },
  { x: -5.3, z: 6.1, w: 1, d: .42 },
];
const RADIUS = .22;
const STEP = .5;
const MIN_X = -10.5;
const MIN_Z = -8.5;
const COLS = 40;
const ROWS = 35;

export function isWalkable(point: Point): boolean {
  if (point.x < MIN_X || point.x > 9 || point.z < MIN_Z || point.z > 8.5) return false;
  if (BLOCKS.some(b => Math.abs(point.x - b.x) < b.w + RADIUS && Math.abs(point.z - b.z) < b.d + RADIUS)) return false;
  if (TREES.some(t => Math.hypot(point.x - t.x, point.z - t.z) < .4 * t.size + RADIUS)) return false;
  return true;
}

export function lineClear(a: Point, b: Point): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .12));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!isWalkable({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false;
  }
  return true;
}

const pointFor = (id: number): Point => ({ x: MIN_X + (id % COLS) * STEP, z: MIN_Z + Math.floor(id / COLS) * STEP });
function nearestCell(point: Point): number | null {
  const col = Math.round((point.x - MIN_X) / STEP);
  const row = Math.round((point.z - MIN_Z) / STEP);
  let result: number | null = null;
  let best = Infinity;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const x = col + dx, z = row + dz;
    if (x < 0 || x >= COLS || z < 0 || z >= ROWS) continue;
    const id = z * COLS + x, candidate = pointFor(id);
    const distance = Math.hypot(candidate.x - point.x, candidate.z - point.z);
    if (distance < best && isWalkable(candidate) && lineClear(point, candidate)) { result = id; best = distance; }
  }
  return result;
}

export function findPath(start: Point, target: Point): Point[] | null {
  if (!isWalkable(target)) return null;
  if (lineClear(start, target)) return [target];
  const from = nearestCell(start), to = nearestCell(target);
  if (from === null || to === null) return null;
  const scores = new Map<number, number>([[from, 0]]);
  const parent = new Map<number, number>();
  const open = new Set([from]);
  const closed = new Set<number>();
  const heuristic = (id: number) => Math.hypot((id % COLS) - (to % COLS), Math.floor(id / COLS) - Math.floor(to / COLS));
  while (open.size) {
    let current = -1, best = Infinity;
    for (const id of open) { const f = scores.get(id)! + heuristic(id); if (f < best) { best = f; current = id; } }
    if (current === to) {
      const path: Point[] = [target];
      let node = to;
      while (node !== from) { path.push(pointFor(node)); node = parent.get(node)!; }
      path.push(pointFor(from));
      path.reverse();
      const smooth: Point[] = [];
      let anchor = start;
      for (let i = 0; i < path.length; i++) {
        let far = i;
        while (far + 1 < path.length && lineClear(anchor, path[far + 1])) far++;
        smooth.push(path[far]); anchor = path[far]; i = far;
      }
      return smooth;
    }
    open.delete(current); closed.add(current);
    const x = current % COLS, z = Math.floor(current / COLS);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dz) || x + dx < 0 || x + dx >= COLS || z + dz < 0 || z + dz >= ROWS) continue;
      const next = (z + dz) * COLS + x + dx;
      if (closed.has(next) || !lineClear(pointFor(current), pointFor(next))) continue;
      const cost = scores.get(current)! + Math.hypot(dx, dz);
      if (cost < (scores.get(next) ?? Infinity)) { scores.set(next, cost); parent.set(next, current); open.add(next); }
    }
  }
  return null;
}

export function slideMove(position: Point, delta: Point): Point {
  const result = { ...position };
  const steps = Math.max(1, Math.ceil(Math.hypot(delta.x, delta.z) / .12));
  for (let i = 0; i < steps; i++) {
    if (isWalkable({ x: result.x + delta.x / steps, z: result.z })) result.x += delta.x / steps;
    if (isWalkable({ x: result.x, z: result.z + delta.z / steps })) result.z += delta.z / steps;
  }
  return result;
}

/** Consume the whole travel budget, including time left after a waypoint. */
export function followPath(position: Point, path: Point[], seconds: number, speed = 3.8) {
  let current = { ...position };
  const remaining = [...path];
  let budget = Math.max(0, seconds) * speed;
  let facing: number | null = null;
  let blocked = false;
  while (remaining.length && budget > 1e-6) {
    const target = remaining[0];
    const dist = Math.hypot(target.x - current.x, target.z - current.z);
    if (dist < 1e-6) { remaining.shift(); continue; }
    const dx = (target.x - current.x) / dist;
    const dz = (target.z - current.z) / dist;
    const step = Math.min(budget, dist);
    const next = slideMove(current, { x: dx * step, z: dz * step });
    if (Math.hypot(next.x - current.x, next.z - current.z) < 1e-7) { blocked = true; break; }
    current = next; facing = Math.atan2(dx, dz); budget -= step;
    if (Math.hypot(target.x - current.x, target.z - current.z) < 1e-6) {
      current = { ...target }; remaining.shift();
    }
  }
  return { position: current, path: remaining, facing, blocked, moving: Math.hypot(current.x - position.x, current.z - position.z) > 1e-7 };
}
