/**
 * Simulator tuning.
 *
 * These are analysis parameters, not gameplay numbers — gameplay lives in
 * `src/data`. They are named constants for the same reason: a threshold that
 * decides whether a warning fires must be findable and arguable.
 */

export const SIM_DEFAULTS = {
  /** Random matches to run when `--matches` is not given. */
  matches: 2000,
  /** Base seed when `--seed` is not given. */
  seed: 1,
  /** Units deployed per side. */
  teamSize: 4,
  /** Paired battles per merge option when `--merge-samples` is not given. */
  mergeSamples: 300,
  /** Where reports are written. */
  outDir: 'tools/reports',
  /**
   * Matches per work item. Small enough that a slow chunk cannot leave a core
   * idle at the end of the run, large enough that message passing is noise.
   */
  chunkSize: 250,
} as const;

export const THRESHOLDS = {
  /**
   * Win-rate gap, in percentage points, above which a merge choice is flagged.
   *
   * The merge-direction choice is the game's central decision. If one branch
   * reliably wins by more than this, it stops being a choice and becomes the
   * correct answer, and the decision stops being interesting.
   */
  mergePathGapPp: 8,
  /**
   * Win-rate movement, in percentage points, that counts as a regression when
   * compared against the previous report.
   */
  regressionPp: 5,
  /**
   * Sample floor below which a win rate is reported but never used to raise a
   * warning — small samples produce large spurious gaps.
   */
  minSamplesForWarning: 100,
  /** Acceptable band for mean battle length, in ticks. */
  minMeanTicks: 150,
  maxMeanTicks: 700,
  /** Timeout share above which the tick cap is doing too much of the deciding. */
  maxTimeoutRate: 0.1,
  /**
   * How far, in percentage points, a unit may sit from the mean win rate of
   * its own tier before it is called out.
   *
   * Compared within tier, not against 50%: a tier 3 unit is *supposed* to win
   * more than a tier 1 unit, so an absolute band would flag the whole roster
   * for behaving exactly as designed. What matters is whether a unit is an
   * outlier among its peers — the units a player picks between.
   */
  unitTierDeviationPp: 8,
} as const;

/** Percentile marks reported for the battle-length distribution. */
export const DURATION_PERCENTILES = [10, 25, 50, 75, 90] as const;
