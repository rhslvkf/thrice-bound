import { describe, expect, it } from 'vitest';
import { loadBundledGameData } from '../data/loader';
import { BATTLE } from '../core/config';
import { PACING } from './config';
import { estimateDuration, formatDuration, playbackSeconds } from './pacing';
import { playRun } from './runplayer';
import type { RunActivity } from './runplayer';
import { TARGET_BAND_SECONDS, sampleRun, simulateRuns } from './runsim';

const data = loadBundledGameData();

const empty: RunActivity = {
  shopsVisited: 0,
  purchases: 0,
  rerolls: 0,
  sells: 0,
  merges: 0,
  rewardChoices: 0,
  battles: 0,
  battleTicks: 0,
};

describe('playbackSeconds', () => {
  it('converts ticks to the seconds the renderer will actually play', () => {
    expect(playbackSeconds(0)).toBe(0);
    expect(playbackSeconds(20)).toBeCloseTo((20 * BATTLE.tickMs) / 1000, 9);
    // The tick size is the contract between the sim and the replayer; if it
    // changes, this number changes with it rather than silently drifting.
    expect(playbackSeconds(BATTLE.msPerSecond / BATTLE.tickMs)).toBe(1);
  });
});

describe('estimateDuration', () => {
  it('is zero for a run in which nothing happened', () => {
    expect(estimateDuration(empty)).toEqual({
      battleSeconds: 0,
      decisionSeconds: 0,
      totalSeconds: 0,
    });
  });

  it('separates measured battle time from estimated decision time', () => {
    const activity: RunActivity = { ...empty, battleTicks: 200, merges: 3 };
    const duration = estimateDuration(activity);
    expect(duration.battleSeconds).toBe(playbackSeconds(200));
    expect(duration.decisionSeconds).toBe(3 * PACING.mergeSeconds);
    expect(duration.totalSeconds).toBe(duration.battleSeconds + duration.decisionSeconds);
  });

  it('charges each action its own rate', () => {
    const one = (key: keyof RunActivity, seconds: number): void => {
      expect(estimateDuration({ ...empty, [key]: 1 }).decisionSeconds).toBeCloseTo(
        seconds,
        9,
      );
    };
    one('shopsVisited', PACING.shopReadSeconds + PACING.arrangeSeconds);
    one('purchases', PACING.purchaseSeconds);
    one('rerolls', PACING.rerollSeconds);
    one('sells', PACING.sellSeconds);
    one('merges', PACING.mergeSeconds);
    one('rewardChoices', PACING.rewardSeconds);
    one('battles', PACING.battleStartSeconds + PACING.postBattleSeconds);
  });

  it('scales linearly, so doubling the actions doubles the estimate', () => {
    const single = estimateDuration({ ...empty, purchases: 5, merges: 2, battleTicks: 100 });
    const double = estimateDuration({ ...empty, purchases: 10, merges: 4, battleTicks: 200 });
    expect(double.totalSeconds).toBeCloseTo(single.totalSeconds * 2, 9);
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [9, '0:09'],
    [60, '1:00'],
    [509, '8:29'],
    [600, '10:00'],
  ])('renders %ss as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it('never renders a negative clock', () => {
    expect(formatDuration(-5)).toBe('0:00');
  });
});

describe('the scripted player', () => {
  it('plays a run to a conclusion', () => {
    const { state, activity } = playRun(data, 12_345);
    expect(state.phase).toBe('over');
    expect(state.result).not.toBeNull();
    expect(activity.battles).toBeGreaterThan(0);
    expect(state.history.length).toBe(activity.battles);
  });

  it('reaches the last round when it wins', () => {
    for (let seed = 0; seed < 25; seed += 1) {
      const { state } = playRun(data, seed);
      if (state.result !== 'victory') continue;
      expect(state.history.length).toBe(data.run.rules.rounds);
      expect(state.lives).toBeGreaterThan(0);
    }
  });

  it('actually merges rather than hoarding singles', () => {
    // A run that never merges is a run that loses, and it would also mean the
    // pacing model is charging for a decision nobody makes.
    const { activity } = playRun(data, 999);
    expect(activity.merges).toBeGreaterThan(0);
  });

  it('replays a whole run identically from the same seed', () => {
    const first = playRun(data, 555_555);
    const second = playRun(data, 555_555);
    expect(second.state).toEqual(first.state);
    expect(second.activity).toEqual(first.activity);
  });

  it('never spends gold it does not have', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      expect(playRun(data, seed).state.gold, `seed ${seed}`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('aggregation', () => {
  const aggregate = simulateRuns(data, 1, 40);

  it('counts every sample once', () => {
    expect(aggregate.samples).toHaveLength(40);
    expect(aggregate.victories + aggregate.defeats).toBe(40);
  });

  it('only counts a round for the runs that reached it', () => {
    for (const round of aggregate.perRound) {
      expect(round.played).toBeLessThanOrEqual(40);
      expect(round.wins).toBeLessThanOrEqual(round.played);
      // Reach can only fall as rounds go on.
      const earlier = aggregate.perRound[round.round - 2];
      if (earlier !== undefined) expect(round.played).toBeLessThanOrEqual(earlier.played);
    }
  });

  it('lands inside the design target', () => {
    // The completion criterion for this phase, as a test rather than a claim in
    // a report: if a content change pushes runs out of the band, this fails.
    expect(aggregate.duration.medianSeconds).toBeGreaterThan(TARGET_BAND_SECONDS.min);
    expect(aggregate.duration.medianSeconds).toBeLessThan(TARGET_BAND_SECONDS.max);
    expect(aggregate.duration.inTargetBand).toBeGreaterThan(0.8);
  });

  it('gives the same aggregate for the same base seed', () => {
    expect(simulateRuns(data, 1, 10).samples.map((s) => s.duration.totalSeconds)).toEqual(
      simulateRuns(data, 1, 10).samples.map((s) => s.duration.totalSeconds),
    );
  });

  it('samples one run consistently with playing it directly', () => {
    const sample = sampleRun(data, 42);
    const { state } = playRun(data, 42);
    expect(sample.result).toBe(state.result);
    expect(sample.roundsReached).toBe(state.history.length);
    expect(sample.livesLeft).toBe(state.lives);
  });
});
