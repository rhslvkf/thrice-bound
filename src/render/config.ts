/**
 * Presentation constants. Values that affect gameplay balance belong in
 * `src/data`, not here — this file is strictly about how things look.
 */
export const RENDER = {
  /** Canvas clear colour, matching the page background in `index.html`. */
  backgroundColor: 0x0b0d13,
  /** Upper bound on `devicePixelRatio`, to protect mobile fill rate. */
  maxResolution: 2,
} as const;
