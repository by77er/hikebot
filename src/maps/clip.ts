/**
 * Clips tile geometry to a rectangle. Vector tiles carry a buffer of
 * geometry beyond their edges; clipping each tile to its own square keeps
 * neighbours from drawing the same strip twice, which would darken
 * see-through fills. It is done here rather than with SVG clip paths, which
 * cost the rasterizer several times the drawing itself.
 */
import type { Point } from "./projection";

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * A polygon ring clipped to `rect` (Sutherland-Hodgman). The result follows
 * the rectangle's edge where the ring left it, so it fills the same area
 * inside it; an empty array when nothing is inside.
 */
export function clipRing(ring: Point[], rect: Rect): Point[] {
  let points = ring;
  const edges: [(p: Point) => boolean, (a: Point, b: Point) => Point][] = [
    [(p) => p.x >= rect.left, (a, b) => atX(a, b, rect.left)],
    [(p) => p.x <= rect.right, (a, b) => atX(a, b, rect.right)],
    [(p) => p.y >= rect.top, (a, b) => atY(a, b, rect.top)],
    [(p) => p.y <= rect.bottom, (a, b) => atY(a, b, rect.bottom)],
  ];
  for (const [inside, cross] of edges) {
    if (points.length === 0) break;
    const out: Point[] = [];
    let previous = points[points.length - 1] as Point;
    for (const point of points) {
      if (inside(point)) {
        if (!inside(previous)) out.push(cross(previous, point));
        out.push(point);
      } else if (inside(previous)) {
        out.push(cross(previous, point));
      }
      previous = point;
    }
    points = out;
  }
  return points;
}

/** The parts of a line inside `rect` (Liang-Barsky on each segment). */
export function clipLine(line: Point[], rect: Rect): Point[][] {
  const parts: Point[][] = [];
  let current: Point[] = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as Point;
    const b = line[i] as Point;
    const segment = clipSegment(a, b, rect);
    if (!segment) {
      if (current.length > 1) parts.push(current);
      current = [];
      continue;
    }
    const [from, to] = segment;
    const last = current[current.length - 1];
    if (!last || last.x !== from.x || last.y !== from.y) {
      if (current.length > 1) parts.push(current);
      current = [from];
    }
    current.push(to);
    if (to !== b) {
      parts.push(current);
      current = [];
    }
  }
  if (current.length > 1) parts.push(current);
  return parts;
}

function clipSegment(
  a: Point,
  b: Point,
  rect: Rect,
): [Point, Point] | undefined {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const checks: [number, number][] = [
    [-dx, a.x - rect.left],
    [dx, rect.right - a.x],
    [-dy, a.y - rect.top],
    [dy, rect.bottom - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return undefined;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return undefined;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return undefined;
      if (t < t1) t1 = t;
    }
  }
  const from = t0 === 0 ? a : { x: a.x + t0 * dx, y: a.y + t0 * dy };
  const to = t1 === 1 ? b : { x: a.x + t1 * dx, y: a.y + t1 * dy };
  return [from, to];
}

function atX(a: Point, b: Point, x: number): Point {
  return { x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) };
}

function atY(a: Point, b: Point, y: number): Point {
  return { x: a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y), y };
}
