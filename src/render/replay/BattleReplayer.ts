/**
 * Battle playback.
 *
 * The battle is already over. `runBattle` simulated it to completion in
 * `src/core`, and what arrives here is the event log it produced. This class
 * walks that log along a timeline and maintains a view model the scene can
 * draw.
 *
 * **The replayer cannot change the outcome.** It never calls the simulation,
 * holds no `BattleState`, and has no way to write back — it reads a finished
 * log. Playing at 4x, skipping to the end, or dropping frames changes how the
 * battle looks and nothing about what happened. That separation is why the
 * headless simulator and the game agree on results.
 *
 * The log's completeness is what makes this possible: `move` carries both
 * endpoints and a duration to interpolate over, `damage` carries the resulting
 * HP, `statMod` carries the resulting maximum. Nothing here recomputes
 * anything.
 */

import type { BattleEvent, BattleOutcome, BattleResult, Team } from '../../core/battle/index';
import { BATTLE } from '../../core/config';
import type { GameData, UnitTag } from '../../data/schema';
import { ANIM, REPLAY } from '../config';

export type ReplaySpeed = number;

/** Everything the scene needs to draw one unit, updated in place each frame. */
export interface UnitVisual {
  instanceId: number;
  defId: string;
  name: string;
  team: Team;
  tier: number;
  tags: readonly UnitTag[];

  /** Cell the unit logically occupies. */
  col: number;
  row: number;
  /** Cell it is moving from, and the window to interpolate across. */
  fromCol: number;
  fromRow: number;
  moveStartMs: number;
  moveEndMs: number;
  /** Interpolated position in cell space. What the scene actually draws. */
  renderCol: number;
  renderRow: number;

  hp: number;
  maxHp: number;
  /** Health bar chases `hp` rather than snapping, so a big hit is legible. */
  hpDisplay: number;
  shield: number;

  alive: boolean;
  spawnAtMs: number;
  deathAtMs: number;

  /** Attack lunge window and the cell it lunges toward. */
  attackStartMs: number;
  attackEndMs: number;
  attackTargetCol: number;
  attackTargetRow: number;
  /** Cooldown ring window, derived from the gap to this unit's next attack. */
  cooldownStartMs: number;
  cooldownEndMs: number;

  flashUntilMs: number;
  healUntilMs: number;
  /** `false` once the death fade has finished and the view can be released. */
  present: boolean;
}

export interface TeamStrength {
  readonly player: number;
  readonly enemy: number;
}

function createVisual(): UnitVisual {
  return {
    instanceId: -1,
    defId: '',
    name: '',
    team: 'player',
    tier: 1,
    tags: [],
    col: 0,
    row: 0,
    fromCol: 0,
    fromRow: 0,
    moveStartMs: 0,
    moveEndMs: 0,
    renderCol: 0,
    renderRow: 0,
    hp: 0,
    maxHp: 1,
    hpDisplay: 0,
    shield: 0,
    alive: false,
    spawnAtMs: 0,
    deathAtMs: -1,
    attackStartMs: -1,
    attackEndMs: -1,
    attackTargetCol: 0,
    attackTargetRow: 0,
    cooldownStartMs: -1,
    cooldownEndMs: -1,
    flashUntilMs: -1,
    healUntilMs: -1,
    present: false,
  };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export class BattleReplayer {
  private readonly events: readonly BattleEvent[];
  private readonly data: GameData;

  /** Reused view models, keyed by instance id. Never reallocated mid-battle. */
  private readonly visuals = new Map<number, UnitVisual>();
  /** Retired view models, kept for the next battle rather than collected. */
  private readonly spare: UnitVisual[] = [];
  /** Stable iteration order for the scene, so draw order does not flicker. */
  private readonly order: UnitVisual[] = [];

  /**
   * For each `attack` event, how long until that unit attacks again.
   *
   * Precomputed in one pass. The log does not carry attack speed — it does not
   * need to, because the answer is already in it: the gap to the same unit's
   * next attack *is* the cooldown, including every modifier that applied.
   * Reading it from the log rather than recomputing from stats keeps the ring
   * honest and keeps this file out of the balance business.
   */
  private readonly attackCooldownMs: Float64Array;

  private cursor = 0;
  private elapsedMs = 0;
  private speed: ReplaySpeed = 1;
  private shakeRequest = 0;

  private readonly startHp: Record<Team, number> = { player: 0, enemy: 0 };
  private readonly currentHp: Record<Team, number> = { player: 0, enemy: 0 };

  constructor(result: BattleResult, data: GameData) {
    this.events = result.events;
    this.data = data;
    this.attackCooldownMs = this.precomputeAttackCooldowns();
  }

  /** Total playback length, including the lead-in and the hold at the end. */
  get durationMs(): number {
    const last = this.events[this.events.length - 1];
    return REPLAY.leadInMs + (last?.tick ?? 0) * BATTLE.tickMs + REPLAY.holdEndMs;
  }

  get timeMs(): number {
    return this.elapsedMs;
  }

  get finished(): boolean {
    return this.cursor >= this.events.length && this.elapsedMs >= this.durationMs;
  }

  get units(): readonly UnitVisual[] {
    return this.order;
  }

  setSpeed(speed: ReplaySpeed): void {
    this.speed = Math.max(0, speed);
  }

  getSpeed(): ReplaySpeed {
    return this.speed;
  }

  /**
   * Team health as a fraction of what each side started with.
   *
   * The scene draws this as a single bar, which is the fastest way to read who
   * is winning without counting bodies.
   */
  teamStrength(): TeamStrength {
    return {
      player: this.startHp.player > 0 ? this.currentHp.player / this.startHp.player : 0,
      enemy: this.startHp.enemy > 0 ? this.currentHp.enemy / this.startHp.enemy : 0,
    };
  }

  /** Screen shake accumulated since the last read, in cell fractions. */
  takeShake(): number {
    const shake = this.shakeRequest;
    this.shakeRequest = 0;
    return shake;
  }

  /** Plays the whole log at once and lands on the final frame. */
  skipToEnd(): void {
    this.applyEventsUpTo(Number.POSITIVE_INFINITY);
    this.elapsedMs = this.durationMs;
    for (const visual of this.order) {
      visual.renderCol = visual.col;
      visual.renderRow = visual.row;
      visual.hpDisplay = visual.hp;
      visual.attackStartMs = -1;
      visual.flashUntilMs = -1;
      visual.present = visual.alive;
    }
    this.shakeRequest = 0;
  }

  /** Advances playback. `deltaMs` is real frame time; speed is applied here. */
  update(deltaMs: number): void {
    // A backgrounded tab hands back one enormous delta on return. Clamping it
    // keeps the battle from teleporting forward.
    const step = Math.min(deltaMs, REPLAY.maxFrameMs) * this.speed;
    this.elapsedMs += step;
    this.applyEventsUpTo(this.elapsedMs - REPLAY.leadInMs);
    this.interpolate(step);
  }

  // -------------------------------------------------------------------------

  private precomputeAttackCooldowns(): Float64Array {
    const cooldowns = new Float64Array(this.events.length).fill(-1);
    const lastAttackIndex = new Map<number, number>();

    this.events.forEach((event, index) => {
      if (event.kind !== 'attack') return;
      const previous = lastAttackIndex.get(event.instanceId);
      if (previous !== undefined) {
        const previousEvent = this.events[previous];
        if (previousEvent !== undefined) {
          cooldowns[previous] = (event.tick - previousEvent.tick) * BATTLE.tickMs;
        }
      }
      lastAttackIndex.set(event.instanceId, index);
    });
    return cooldowns;
  }

  private acquireVisual(): UnitVisual {
    return this.spare.pop() ?? createVisual();
  }

  private applyEventsUpTo(logTimeMs: number): void {
    while (this.cursor < this.events.length) {
      const event = this.events[this.cursor];
      if (event === undefined) break;
      if (event.tick * BATTLE.tickMs > logTimeMs) break;
      this.apply(event, this.cursor);
      this.cursor += 1;
    }
  }

  private apply(event: BattleEvent, index: number): void {
    const at = REPLAY.leadInMs + event.tick * BATTLE.tickMs;

    switch (event.kind) {
      case 'spawn': {
        const def = this.data.units.get(event.defId);
        const visual = this.acquireVisual();
        visual.instanceId = event.instanceId;
        visual.defId = event.defId;
        visual.name = def?.name ?? event.defId;
        visual.team = event.team;
        visual.tier = def?.tier ?? 1;
        visual.tags = def?.tags ?? [];
        visual.col = event.col;
        visual.row = event.row;
        visual.fromCol = event.col;
        visual.fromRow = event.row;
        visual.renderCol = event.col;
        visual.renderRow = event.row;
        visual.moveStartMs = 0;
        visual.moveEndMs = 0;
        visual.hp = event.hp;
        visual.maxHp = event.maxHp;
        visual.hpDisplay = event.hp;
        visual.shield = 0;
        visual.alive = true;
        visual.spawnAtMs = at;
        visual.deathAtMs = -1;
        visual.attackStartMs = -1;
        visual.cooldownStartMs = -1;
        visual.flashUntilMs = -1;
        visual.healUntilMs = -1;
        visual.present = true;

        this.visuals.set(event.instanceId, visual);
        this.order.push(visual);
        this.startHp[event.team] += event.maxHp;
        this.currentHp[event.team] += event.hp;
        break;
      }

      case 'move': {
        const visual = this.visuals.get(event.instanceId);
        if (visual === undefined) break;
        visual.fromCol = event.fromCol;
        visual.fromRow = event.fromRow;
        visual.col = event.toCol;
        visual.row = event.toRow;
        visual.moveStartMs = at;
        // The step duration comes from the log, so a slowed unit visibly
        // crawls without the renderer knowing what a slow is.
        visual.moveEndMs = at + event.durationMs;
        break;
      }

      case 'attack': {
        const visual = this.visuals.get(event.instanceId);
        if (visual === undefined) break;
        visual.attackStartMs = at;
        visual.attackEndMs = at + ANIM.attackMs;
        visual.attackTargetCol = event.targetCol;
        visual.attackTargetRow = event.targetRow;

        const cooldown = this.attackCooldownMs[index] ?? -1;
        if (cooldown > 0) {
          visual.cooldownStartMs = at;
          visual.cooldownEndMs = at + cooldown;
        } else {
          // No next attack in the log: this was the unit's last swing.
          visual.cooldownStartMs = -1;
        }
        break;
      }

      case 'damage': {
        const visual = this.visuals.get(event.targetId);
        if (visual === undefined) break;
        this.currentHp[visual.team] -= visual.hp - event.hpAfter;
        visual.hp = event.hpAfter;
        visual.shield = event.shieldAfter;
        visual.flashUntilMs = at + ANIM.flashMs;
        if (event.lethal) this.requestShake(ANIM.shakeOnKill);
        break;
      }

      case 'heal': {
        const visual = this.visuals.get(event.targetId);
        if (visual === undefined) break;
        this.currentHp[visual.team] += event.hpAfter - visual.hp;
        visual.hp = event.hpAfter;
        visual.healUntilMs = at + ANIM.healFlashMs;
        break;
      }

      case 'shield': {
        const visual = this.visuals.get(event.targetId);
        if (visual !== undefined) visual.shield = event.shieldAfter;
        break;
      }

      case 'statMod': {
        // Carries the resulting HP and maximum, because an `hp` modifier grants
        // the difference and the renderer could not work that out itself.
        const visual = this.visuals.get(event.targetId);
        if (visual === undefined) break;
        this.currentHp[visual.team] += event.hpAfter - visual.hp;
        this.startHp[visual.team] += event.maxHpAfter - visual.maxHp;
        visual.hp = event.hpAfter;
        visual.maxHp = event.maxHpAfter;
        break;
      }

      case 'death': {
        const visual = this.visuals.get(event.instanceId);
        if (visual === undefined) break;
        this.currentHp[visual.team] -= visual.hp;
        visual.hp = 0;
        visual.shield = 0;
        visual.alive = false;
        visual.deathAtMs = at;
        break;
      }

      default:
        // battleStart, battleEnd, ability, status, synergyApplied carry nothing
        // this view draws yet. They stay in the log for the effects layer.
        break;
    }
  }

  private requestShake(amount: number): void {
    this.shakeRequest = Math.min(ANIM.shakeMax, this.shakeRequest + amount);
  }

  /**
   * Advances everything that moves between events.
   *
   * Runs over a plain array of view models that were allocated on spawn, so a
   * frame here allocates nothing.
   */
  private interpolate(stepMs: number): void {
    const now = this.elapsedMs;

    for (let i = this.order.length - 1; i >= 0; i -= 1) {
      const visual = this.order[i];
      if (visual === undefined) continue;

      // Position between the cell left and the cell arrived at.
      if (visual.moveEndMs > visual.moveStartMs && now < visual.moveEndMs) {
        const t = clamp01((now - visual.moveStartMs) / (visual.moveEndMs - visual.moveStartMs));
        visual.renderCol = lerp(visual.fromCol, visual.col, t);
        visual.renderRow = lerp(visual.fromRow, visual.row, t);
      } else {
        visual.renderCol = visual.col;
        visual.renderRow = visual.row;
      }

      // Health bar chases the true value instead of snapping to it.
      if (visual.hpDisplay !== visual.hp) {
        const rate = (ANIM.hpBarSpeed * visual.maxHp * stepMs) / 1000;
        const gap = visual.hp - visual.hpDisplay;
        visual.hpDisplay =
          Math.abs(gap) <= rate ? visual.hp : visual.hpDisplay + Math.sign(gap) * rate;
      }

      // Retire a unit once its death fade has run, returning the view model.
      if (!visual.alive && visual.deathAtMs >= 0 && now > visual.deathAtMs + ANIM.deathMs) {
        visual.present = false;
      }
    }
  }

  /** Releases view models for units whose death fade has finished. */
  collectRetired(onRetire: (visual: UnitVisual) => void): void {
    for (let i = this.order.length - 1; i >= 0; i -= 1) {
      const visual = this.order[i];
      if (visual === undefined || visual.present) continue;
      onRetire(visual);
      this.visuals.delete(visual.instanceId);
      this.order.splice(i, 1);
      this.spare.push(visual);
    }
  }

  get outcome(): BattleOutcome {
    return this.result.outcome;
  }

  private get result(): { outcome: BattleOutcome } {
    const end = this.events[this.events.length - 1];
    return { outcome: end?.kind === 'battleEnd' ? end.outcome : 'draw' };
  }
}
