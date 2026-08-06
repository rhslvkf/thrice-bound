/**
 * The relic reward.
 *
 * Three cards after a win, one taken. Drawn as text panels rather than as
 * `UnitCard`s: a relic is what its rule *says*, and a shape with a name on it
 * would tell the player nothing they could act on. The rule text is the art.
 *
 * The panel takes over the screen while it is up — there is nothing else to do
 * until a choice is made, and a dimmed backdrop says so more clearly than
 * disabling six controls would.
 */

import { Container, Graphics, Text } from 'pixi.js';
import type { GameData, RelicDef } from '../../data/schema';
import { COLORS } from '../config';
import type { Layout } from '../layout';

/**
 * Panel geometry.
 *
 * The card box is sized in cells; everything inside it is sized as a fraction
 * of the card's own width, so a card that shrinks to fit a narrow viewport
 * takes its text with it rather than overflowing.
 */
const REWARD = {
  /** Card box, in cells. */
  cardWidthRatio: 2.6,
  cardHeightRatio: 2.7,
  gapRatio: 0.28,
  cornerRatio: 0.09,
  /** Type sizes, as fractions of the card's rendered width. */
  titleRatio: 0.095,
  rarityRatio: 0.055,
  bodyRatio: 0.068,
  /** Heading and skip, in cells. */
  headingRatio: 0.22,
  skipRatio: 0.15,
  /** Vertical centre of the card row, as a fraction of the safe height. */
  anchor: 0.5,
} as const;

interface Card {
  readonly root: Container;
  readonly background: Graphics;
  readonly title: Text;
  readonly rarity: Text;
  readonly body: Text;
  relicId: string | null;
}

export class RewardPanel {
  readonly root = new Container();

  private readonly backdrop = new Graphics();
  private readonly heading: Text;
  private readonly skip: Text;
  private readonly cards: Card[] = [];
  private layout: Layout;

  constructor(
    private readonly data: GameData,
    layout: Layout,
    private readonly onChoose: (relicId: string) => void,
    private readonly onSkip: () => void,
  ) {
    this.layout = layout;
    this.root.visible = false;
    // The backdrop is interactive so a click that misses a card is swallowed
    // rather than reaching the board underneath.
    this.backdrop.eventMode = 'static';

    this.heading = new Text({
      text: 'CLAIM A RELIC',
      style: { fill: COLORS.accent, fontSize: 20, fontFamily: 'system-ui', letterSpacing: 3 },
    });
    this.heading.anchor.set(0.5);

    this.skip = new Text({
      text: 'skip',
      style: { fill: COLORS.textDim, fontSize: 14, fontFamily: 'system-ui' },
    });
    this.skip.anchor.set(0.5);
    this.skip.eventMode = 'static';
    this.skip.cursor = 'pointer';
    this.skip.on('pointerdown', (event) => {
      event.stopPropagation();
      this.onSkip();
    });

    this.root.addChild(this.backdrop, this.heading, this.skip);
  }

  get isOpen(): boolean {
    return this.root.visible;
  }

  /** Shows an offer. An empty offer closes the panel instead. */
  show(relicIds: readonly string[]): void {
    if (relicIds.length === 0) {
      this.hide();
      return;
    }
    this.ensureCards(relicIds.length);

    this.cards.forEach((card, index) => {
      const relicId = relicIds[index];
      card.relicId = relicId ?? null;
      card.root.visible = relicId !== undefined;
      if (relicId === undefined) return;

      const relic = this.data.relics.get(relicId);
      if (relic === undefined) {
        card.root.visible = false;
        return;
      }
      this.bind(card, relic);
    });

    this.root.visible = true;
    this.resize(this.layout);
  }

  hide(): void {
    this.root.visible = false;
  }

  private bind(card: Card, relic: RelicDef): void {
    card.title.text = relic.name;
    card.rarity.text = relic.rarity.toUpperCase();
    card.rarity.style.fill = COLORS.rarity[relic.rarity];
    card.body.text = relic.description;
  }

  private ensureCards(count: number): void {
    while (this.cards.length < count) {
      const root = new Container();
      const background = new Graphics();
      const title = new Text({
        text: '',
        style: {
          fill: COLORS.text,
          fontSize: 16,
          fontFamily: 'system-ui',
          fontWeight: 'bold',
          align: 'center',
          wordWrap: true,
          wordWrapWidth: 200,
        },
      });
      const rarity = new Text({
        text: '',
        style: { fill: COLORS.textDim, fontSize: 11, fontFamily: 'system-ui', letterSpacing: 2 },
      });
      const body = new Text({
        text: '',
        style: {
          fill: COLORS.textDim,
          fontSize: 12,
          fontFamily: 'system-ui',
          align: 'center',
          wordWrap: true,
          wordWrapWidth: 200,
        },
      });
      for (const text of [title, rarity, body]) text.anchor.set(0.5);

      root.addChild(background, title, rarity, body);
      root.eventMode = 'static';
      root.cursor = 'pointer';

      const card: Card = { root, background, title, rarity, body, relicId: null };
      root.on('pointerdown', (event) => {
        event.stopPropagation();
        if (card.relicId !== null) this.onChoose(card.relicId);
      });
      root.on('pointerover', () => this.drawCard(card, true));
      root.on('pointerout', () => this.drawCard(card, false));

      this.root.addChild(root);
      this.cards.push(card);
    }
  }

  resize(layout: Layout): void {
    this.layout = layout;
    if (!this.root.visible) return;

    const cell = layout.cellSize;
    const cardWidth = cell * REWARD.cardWidthRatio;
    const cardHeight = cell * REWARD.cardHeightRatio;
    const gap = cell * REWARD.gapRatio;

    const shown = this.cards.filter((card) => card.root.visible);
    // Clamped into the safe area, so a three-card row still fits a phone in
    // portrait rather than running off both edges.
    const scale = Math.min(
      1,
      layout.safe.width / Math.max(1, shown.length * cardWidth + (shown.length - 1) * gap),
    );
    const width = cardWidth * scale;
    const height = cardHeight * scale;
    const spacing = gap * scale;
    const span = shown.length * width + Math.max(0, shown.length - 1) * spacing;
    const centreY = layout.safe.y + layout.safe.height * REWARD.anchor;

    this.backdrop.clear();
    // Nearly opaque: the choice is the only thing to do, and a board showing
    // through behind the heading reads as two screens fighting for attention.
    this.backdrop.rect(0, 0, layout.width, layout.height).fill({ color: 0x05070c, alpha: 0.94 });

    this.heading.style.fontSize = cell * REWARD.headingRatio;
    this.heading.position.set(layout.width / 2, centreY - height / 2 - cell * 0.55);

    this.skip.style.fontSize = cell * REWARD.skipRatio;
    this.skip.position.set(layout.width / 2, centreY + height / 2 + cell * 0.45);

    shown.forEach((card, index) => {
      card.root.position.set(
        layout.width / 2 - span / 2 + width / 2 + index * (width + spacing),
        centreY,
      );
      card.title.style.fontSize = width * REWARD.titleRatio;
      card.title.style.wordWrapWidth = width * 0.86;
      card.rarity.style.fontSize = width * REWARD.rarityRatio;
      card.body.style.fontSize = width * REWARD.bodyRatio;
      card.body.style.wordWrapWidth = width * 0.84;

      card.rarity.position.set(0, -height * 0.4);
      card.title.position.set(0, -height * 0.28);
      // Anchored to the card's own centre so a two-line rule and a four-line
      // rule both sit in the middle of the space left under the title.
      card.body.position.set(0, height * 0.08);
      this.drawCard(card, false, width, height);
    });
  }

  private drawCard(card: Card, hovered: boolean, widthHint?: number, heightHint?: number): void {
    const cell = this.layout.cellSize;
    const width = widthHint ?? cell * REWARD.cardWidthRatio;
    const height = heightHint ?? cell * REWARD.cardHeightRatio;
    const relic = card.relicId === null ? undefined : this.data.relics.get(card.relicId);
    const accent = relic === undefined ? COLORS.cardBorder : COLORS.rarity[relic.rarity];

    card.background.clear();
    card.background
      .roundRect(-width / 2, -height / 2, width, height, width * REWARD.cornerRatio)
      .fill({ color: hovered ? COLORS.buttonFill : COLORS.cardFill })
      .stroke({ width: Math.max(1.5, width * 0.012), color: accent, alpha: hovered ? 1 : 0.6 });
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
