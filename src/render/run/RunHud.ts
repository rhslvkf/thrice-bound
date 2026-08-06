/**
 * The run header.
 *
 * Round, lives, gold, relics — the four numbers that decide what the player
 * does next, on one line above the board. Read-only: it renders run state and
 * never changes it.
 *
 * Everything is drawn from the atlas or as `Text`, so the header adds no draw
 * calls beyond the one text batch.
 */

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { GameData } from '../../data/schema';
import type { RunState } from '../../core/run/index';
import type { Atlas } from '../atlas';
import { COLORS } from '../config';
import type { Layout } from '../layout';

/** Header geometry, as fractions of a cell. */
const HUD = {
  labelRatio: 0.17,
  valueRatio: 0.23,
  relicRatio: 0.15,
  relicGapRatio: 0.06,
  /** Distance above the board to the header's baseline, in cells. */
  offsetRatio: 0.62,
  pipRatio: 0.09,
} as const;

/** One labelled number. */
class Stat {
  readonly root = new Container();
  private readonly label: Text;
  private readonly value: Text;

  constructor(label: string, colour: number) {
    this.label = new Text({
      text: label,
      style: { fill: COLORS.textDim, fontSize: 12, fontFamily: 'system-ui', letterSpacing: 1.5 },
    });
    this.value = new Text({
      text: '0',
      style: { fill: colour, fontSize: 18, fontFamily: 'system-ui', fontWeight: 'bold' },
    });
    this.label.anchor.set(0.5, 1);
    this.value.anchor.set(0.5, 0);
    this.root.addChild(this.label, this.value);
  }

  set(text: string): void {
    this.value.text = text;
  }

  setColour(colour: number): void {
    this.value.style.fill = colour;
  }

  resize(cell: number): void {
    this.label.style.fontSize = cell * HUD.labelRatio;
    this.value.style.fontSize = cell * HUD.valueRatio;
    this.label.position.set(0, 0);
    this.value.position.set(0, cell * 0.04);
  }
}

export class RunHud {
  readonly root = new Container();

  private readonly round = new Stat('ROUND', COLORS.text);
  private readonly lives = new Stat('LIVES', COLORS.lives);
  private readonly gold = new Stat('GOLD', COLORS.gold);
  private readonly encounter: Text;
  private readonly bossFlag = new Graphics();
  private readonly relicRow = new Container();
  private readonly relicIcons: Sprite[] = [];

  private layout: Layout;

  constructor(
    private readonly data: GameData,
    private readonly atlas: Atlas,
    layout: Layout,
  ) {
    this.layout = layout;
    this.encounter = new Text({
      text: '',
      style: { fill: COLORS.textDim, fontSize: 13, fontFamily: 'system-ui' },
    });
    // Right-aligned so a long encounter name grows leftward into empty space
    // rather than off the edge.
    this.encounter.anchor.set(1, 0);
    this.root.addChild(
      this.bossFlag,
      this.round.root,
      this.lives.root,
      this.gold.root,
      this.encounter,
      this.relicRow,
    );
  }

  /**
   * Rebuilds from run state.
   *
   * Called on every state change rather than every frame — the header only
   * moves when something the player did moved it, and re-laying out text per
   * frame would re-rasterise it per frame.
   */
  sync(state: RunState): void {
    const rules = this.data.run.rules;
    const boss = rules.bossRounds.includes(state.round);

    this.round.set(`${state.round}/${rules.rounds}`);
    this.lives.set(String(state.lives));
    this.gold.set(String(state.gold));
    // The purse turns dim when it cannot buy the cheapest thing on the shelf,
    // which is the moment "reroll" stops being an option.
    this.gold.setColour(state.gold > 0 ? COLORS.gold : COLORS.textDim);

    const encounter = this.data.encounters.find((entry) => entry.round === state.round);
    this.encounter.text =
      encounter === undefined ? '' : boss ? `${encounter.name}  ·  BOSS` : encounter.name;
    this.encounter.style.fill = boss ? COLORS.boss : COLORS.textDim;

    this.syncRelics(state);
    this.resize(this.layout);
  }

  private syncRelics(state: RunState): void {
    while (this.relicIcons.length < state.relicIds.length) {
      const icon = new Sprite(this.atlas.shapes[1] ?? this.atlas.pixel);
      icon.anchor.set(0.5);
      this.relicRow.addChild(icon);
      this.relicIcons.push(icon);
    }
    for (let i = 0; i < this.relicIcons.length; i += 1) {
      const icon = this.relicIcons[i];
      if (icon === undefined) continue;
      const relicId = state.relicIds[i];
      icon.visible = relicId !== undefined;
      if (relicId === undefined) continue;
      // Rarity is the only thing a shape can carry without art, and it is the
      // part a player actually tracks at a glance.
      const relic = this.data.relics.get(relicId);
      icon.tint = relic === undefined ? COLORS.textDim : COLORS.rarity[relic.rarity];
    }
  }

  resize(layout: Layout): void {
    this.layout = layout;
    const cell = layout.cellSize;
    // Clamped into the safe area: on a short viewport the board can sit high
    // enough that the header would run off the top edge, and a clipped life
    // total is worse than a slightly crowded board.
    const y = Math.max(layout.safe.y + cell * 0.5, layout.board.y - cell * HUD.offsetRatio);
    const columnGap = Math.min(layout.safe.width / 5, cell * 1.5);
    const centre = layout.width / 2;

    // One line, not three. There is barely a cell of room above the board, so
    // the numbers take the centre, the relics run out from the left edge and
    // the encounter name is pinned to the right — nothing stacks, nothing
    // overlaps the top row of cells.
    for (const stat of [this.round, this.lives, this.gold]) stat.resize(cell);
    this.round.root.position.set(centre - columnGap, y);
    this.lives.root.position.set(centre, y);
    this.gold.root.position.set(centre + columnGap, y);

    this.encounter.style.fontSize = cell * HUD.labelRatio;
    this.encounter.position.set(layout.safe.x + layout.safe.width, y - cell * 0.06);

    const size = cell * HUD.relicRatio;
    const gap = cell * HUD.relicGapRatio;
    const shown = this.relicIcons.filter((icon) => icon.visible);
    shown.forEach((icon, index) => {
      icon.width = size;
      icon.height = size;
      icon.position.set(size / 2 + index * (size + gap), 0);
    });
    this.relicRow.position.set(layout.safe.x, y + cell * 0.06);

    this.bossFlag.clear();
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
