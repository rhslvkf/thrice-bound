/**
 * The tuning panel.
 *
 * Game feel is not arrived at by reasoning. It is arrived at by moving a
 * slider while the thing is running and stopping when it feels right — and
 * that loop only works if it is *fast*. Rebuilding to try a 20ms change means
 * you will try three values; a slider means you will try thirty, and the
 * thirtieth is the one that feels good.
 *
 * Built from the DOM rather than PixiJS on purpose: a browser range input is
 * already accessible, already handles touch and keyboard, and costs nothing to
 * draw. Rendering sliders on the canvas would be a day's work to arrive
 * somewhere worse.
 *
 * **Dev builds only.** `Game` imports this dynamically behind
 * `import.meta.env.DEV`, so the whole module — panel, styles and all — is
 * dropped from the production bundle rather than shipped and hidden.
 */

import {
  MERGE_SEQUENCE_BUDGET_MS,
  TUNING_FIELDS,
  mergeSequenceMs,
  readTuning,
  resetTuning,
  tuningToJson,
  writeTuning,
} from '../tuning';
import type { TuningField, TuningGroup } from '../tuning';

const PANEL_ID = 'thricebound-tuning';

const STYLES = `
#${PANEL_ID} {
  position: fixed; top: 0; right: 0; z-index: 9999;
  width: 310px; max-height: 100vh; overflow-y: auto;
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #cfd6e4; background: rgba(10,13,20,.94);
  border-left: 1px solid #2b3346; box-sizing: border-box;
  transition: transform .16s ease;
}
#${PANEL_ID}.collapsed { transform: translateX(calc(100% - 30px)); }
#${PANEL_ID} header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; background: #141a26; border-bottom: 1px solid #2b3346;
  position: sticky; top: 0;
}
#${PANEL_ID} h2 { margin: 0; font-size: 11px; letter-spacing: 1.5px; color: #f0c46a; flex: 1; }
#${PANEL_ID} button {
  font: inherit; color: #cfd6e4; background: #24304a;
  border: 1px solid #3a465e; border-radius: 4px; padding: 3px 7px; cursor: pointer;
}
#${PANEL_ID} button:hover { border-color: #f0c46a; }
#${PANEL_ID} .group {
  padding: 6px 10px 2px; color: #f0c46a; letter-spacing: 1px;
  border-top: 1px solid #1e2635; margin-top: 4px;
}
#${PANEL_ID} .row { display: grid; grid-template-columns: 1fr auto; gap: 2px 6px; padding: 2px 10px; }
#${PANEL_ID} .row label { color: #8b93a5; }
#${PANEL_ID} .row output { color: #e8ecf4; font-variant-numeric: tabular-nums; }
#${PANEL_ID} input[type=range] { grid-column: 1 / -1; width: 100%; height: 14px; accent-color: #f0c46a; }
#${PANEL_ID} .budget { padding: 6px 10px; border-top: 1px solid #1e2635; }
#${PANEL_ID} .budget.over { color: #e05a5a; }
#${PANEL_ID} .budget.ok { color: #6fd08c; }
`;

export interface TuningPanelHandle {
  destroy(): void;
}

/** Builds the panel and attaches it to the document. */
export function mountTuningPanel(): TuningPanelHandle {
  const existing = document.getElementById(PANEL_ID);
  if (existing !== null) existing.remove();

  const style = document.createElement('style');
  style.textContent = STYLES;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = PANEL_ID;

  const header = document.createElement('header');
  const title = document.createElement('h2');
  title.textContent = 'FEEL';
  const copyButton = document.createElement('button');
  copyButton.textContent = 'copy';
  const resetButton = document.createElement('button');
  resetButton.textContent = 'reset';
  const toggleButton = document.createElement('button');
  toggleButton.textContent = '»';
  header.append(title, copyButton, resetButton, toggleButton);
  panel.appendChild(header);

  const budget = document.createElement('div');
  budget.className = 'budget';
  panel.appendChild(budget);

  const rows: { field: TuningField; input: HTMLInputElement; output: HTMLOutputElement }[] = [];
  let lastGroup: TuningGroup | null = null;

  for (const field of TUNING_FIELDS) {
    if (field.group !== lastGroup) {
      const heading = document.createElement('div');
      heading.className = 'group';
      heading.textContent = field.group;
      panel.appendChild(heading);
      lastGroup = field.group;
    }

    const row = document.createElement('div');
    row.className = 'row';

    const label = document.createElement('label');
    label.textContent = field.label;
    const output = document.createElement('output');

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(field.min);
    input.max = String(field.max);
    input.step = String(field.step);
    input.value = String(readTuning(field));

    const render = (): void => {
      output.textContent = `${readTuning(field)}${field.unit}`;
    };
    render();

    input.addEventListener('input', () => {
      // Written straight into the live store: the next frame already uses it,
      // which is the entire point of the panel.
      writeTuning(field, Number(input.value));
      render();
      refreshBudget();
    });

    row.append(label, output, input);
    panel.appendChild(row);
    rows.push({ field, input, output });
  }

  /**
   * The merge budget, live.
   *
   * Shown here rather than only enforced by a test, because the person moving
   * the sliders is the one who needs to know they have spent the budget — and
   * needs to know while they are spending it.
   */
  function refreshBudget(): void {
    const total = Math.round(mergeSequenceMs());
    const over = total > MERGE_SEQUENCE_BUDGET_MS;
    budget.className = `budget ${over ? 'over' : 'ok'}`;
    budget.textContent = `merge sequence ${total}ms / ${MERGE_SEQUENCE_BUDGET_MS}ms${over ? '  OVER BUDGET' : ''}`;
  }
  refreshBudget();

  copyButton.addEventListener('click', () => {
    const json = tuningToJson();
    void navigator.clipboard?.writeText(json).catch(() => {
      // Clipboard needs a secure context and permission. Falling back to the
      // console still gets the values out, which is what matters.
      console.log(json);
    });
    copyButton.textContent = 'copied';
    globalThis.setTimeout(() => (copyButton.textContent = 'copy'), 900);
  });

  resetButton.addEventListener('click', () => {
    resetTuning();
    for (const row of rows) {
      row.input.value = String(readTuning(row.field));
      row.output.textContent = `${readTuning(row.field)}${row.field.unit}`;
    }
    refreshBudget();
  });

  toggleButton.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    toggleButton.textContent = collapsed ? '«' : '»';
  });

  // Pointer events on the panel must not reach the canvas, or dragging a
  // slider would also drag a unit.
  for (const type of ['pointerdown', 'pointerup', 'pointermove'] as const) {
    panel.addEventListener(type, (event) => event.stopPropagation());
  }

  document.body.appendChild(panel);

  return {
    destroy(): void {
      panel.remove();
      style.remove();
    },
  };
}
