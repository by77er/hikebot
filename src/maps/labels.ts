/**
 * Label placement for map pictures: labels are placed greedily, most
 * important first, each at the first of its candidate positions that stays
 * inside the picture and clear of every label already placed and of the
 * obstacles (the pin, the scale bar, the attribution). A label with no free
 * position is left out.
 */

/** A rectangle in picture pixels. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface LabelCandidate<T> {
  /** Higher is placed first; ties keep their input order. */
  priority: number;
  /**
   * The positions to try, preferred first. A position is the boxes it
   * covers (a peak's marker and its text, or the letters of a curved label).
   */
  positions: Box[][];
  /** What the caller draws for the label, given the chosen position. */
  value: T;
}

export interface PlacedLabel<T> {
  value: T;
  /** The index of the chosen position. */
  position: number;
  boxes: Box[];
}

export function placeLabels<T>(
  candidates: LabelCandidate<T>[],
  options: { bounds: Box; obstacles: Box[]; padding: number },
): PlacedLabel<T>[] {
  const { bounds, padding } = options;
  const taken: Box[] = options.obstacles.map((box) => grow(box, padding));
  const placed: PlacedLabel<T>[] = [];
  const order = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (a, b) =>
        b.candidate.priority - a.candidate.priority || a.index - b.index,
    );
  for (const { candidate } of order) {
    for (const [position, boxes] of candidate.positions.entries()) {
      if (!boxes.every((box) => inside(box, bounds))) continue;
      if (boxes.some((box) => taken.some((other) => overlaps(box, other)))) {
        continue;
      }
      for (const box of boxes) taken.push(grow(box, padding));
      placed.push({ value: candidate.value, position, boxes });
      break;
    }
  }
  return placed;
}

export function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

function inside(box: Box, bounds: Box): boolean {
  return (
    box.left >= bounds.left &&
    box.right <= bounds.right &&
    box.top >= bounds.top &&
    box.bottom <= bounds.bottom
  );
}

function grow(box: Box, by: number): Box {
  return {
    left: box.left - by,
    top: box.top - by,
    right: box.right + by,
    bottom: box.bottom + by,
  };
}
