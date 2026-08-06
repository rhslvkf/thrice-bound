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

/**
 * The scripted player's policy.
 *
 * Weights, not rules: the shop scorer sums them, so the relative sizes are what
 * matter. `completesMergeScore` dominates everything else on purpose — a third
 * copy is the only thing that produces a tier 2, and a player who does not
 * chase pairs loses round 7.
 */
export const RUN_POLICY = {
  /** Added when a slot would put a third copy on the board. */
  completesMergeScore: 100,
  /** Added when a slot would put a second copy on the board. */
  pairsUpScore: 40,
  /** Per tier, so a tier 2 on the shelf beats a tier 1 all else equal. */
  tierScore: 12,
  /** Per unit already carrying one of the slot's tags. */
  tagFitScore: 3,
  /** How hard the merge choice leans on tags over raw stats. */
  mergeSynergyWeight: 10,
  /** Gold held back from rerolling, so a bad shop cannot empty the purse. */
  goldReserve: 6,
  maxRerollsPerRound: 3,
  /** Loop guards. Reached only by a policy bug, never by ordinary play. */
  maxShopActions: 40,
  maxMergesPerRound: 12,
  maxStepsPerRound: 8,
} as const;

/**
 * How long a human spends on each kind of decision, in seconds.
 *
 * These are the only estimates in the whole measurement, and they are estimates
 * — everything else (battle length, number of decisions) is counted exactly by
 * playing the run. They are stated here rather than buried in the arithmetic so
 * the number they produce can be argued with.
 *
 * Calibrated against how long these actions take in the built game with the
 * Phase 7 timings: a purchase is a click, a merge is a click plus the 890ms
 * sequence plus reading two cards, a reward is reading three.
 */
export const PACING = {
  /** Opening a shop and reading five cards before touching anything. */
  shopReadSeconds: 6,
  /** One purchase: decide, click. */
  purchaseSeconds: 1.5,
  rerollSeconds: 2.5,
  sellSeconds: 1.5,
  /** Merge: press, watch the 890ms sequence, choose between two cards. */
  mergeSeconds: 4,
  /** Reward: read three relics and pick. The longest single decision. */
  rewardSeconds: 8,
  /** Repositioning units on the board, per round. */
  arrangeSeconds: 4,
  /** Between the last click and the first blow. */
  battleStartSeconds: 1,
  /** Reading the result before the next shop opens. */
  postBattleSeconds: 2,
} as const;
