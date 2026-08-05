/**
 * Colour helpers.
 *
 * PixiJS takes packed 24-bit RGB, and the renderer needs to blend between such
 * values in a few places — board depth shading, hit flashes. Small enough to
 * keep here rather than reach for a colour library.
 */

/** Blends two packed RGB colours. `t` of 0 gives `a`, 1 gives `b`. */
export function mixColor(a: number, b: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return (
    ((ar + (br - ar) * clamped) << 16) |
    ((ag + (bg - ag) * clamped) << 8) |
    (ab + (bb - ab) * clamped)
  );
}
