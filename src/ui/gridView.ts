import type { EffectSpec, EffectType } from "../grid/config";
import type { GridModel, Row } from "../grid/gridModel";
import { SOURCE_TYPE_LABELS } from "../grid/sourceFactory";
import {
  TRIGGER_MODE_LABELS,
  type TriggerModeKind,
} from "../grid/triggerModes";
import { type MenuField, openContextMenu } from "./contextMenu";

/** filter/distortion/delay are the 3 persistent-chain effect types this UI
 * exposes (see effectsChain.ts's `EffectSpec` for the general shape any
 * project could add more of) -- enough to prove per-row and per-cell
 * chains are genuinely distinct without a full effect-chain builder UI
 * (reordering, multiple instances of one type, etc.), which is its own
 * project-specific surface PLAN.md leaves open. An effect is "on" purely
 * by being present in the array -- see effectsChain.ts's instantiateEffect,
 * which always forces wet:1 for whatever's present, so there's no separate
 * enabled flag to keep in sync. */
const EFFECT_TOGGLES: Array<{
  type: EffectType;
  label: string;
  paramKey: string;
  paramLabel: string;
  min: number;
  max: number;
  step: number;
  default: number;
}> = [
  {
    type: "filter",
    label: "Filter",
    paramKey: "frequency",
    paramLabel: "Cutoff (Hz)",
    min: 200,
    max: 8000,
    step: 50,
    default: 8000,
  },
  {
    type: "distortion",
    label: "Distortion",
    paramKey: "amount",
    paramLabel: "Amount",
    min: 0,
    max: 100,
    step: 1,
    default: 20,
  },
  {
    type: "delay",
    label: "Delay",
    paramKey: "delayMs",
    paramLabel: "Time (ms)",
    min: 10,
    max: 1000,
    step: 10,
    default: 180,
  },
];

/** Builds the enable-checkbox + param-slider pair for each of
 * filter/distortion/delay, reused by the row menu, the cell menu (sample
 * rows only), and main.ts's master-bus panel -- same shape everywhere, a
 * plain EffectSpec[] in, an updated one out via `onUpdate`. Toggling a
 * checkbox only reveals its param slider the next time the menu is
 * reopened, same as this UI's other conditionally-shown fields (e.g. the
 * explicit-duration seconds field) -- rebuilding the already-open menu
 * live isn't something this popup supports. */
export function effectsToggleFields(
  effects: EffectSpec[],
  onUpdate: (next: EffectSpec[]) => void,
): MenuField[] {
  const fields: MenuField[] = [];
  for (const toggle of EFFECT_TOGGLES) {
    const spec = effects.find((e) => e.type === toggle.type);
    fields.push({
      key: `${toggle.type}-enabled`,
      label: `${toggle.label} enabled`,
      kind: "checkbox",
      value: spec !== undefined,
      onChange: (enabled) => {
        onUpdate(
          enabled
            ? [
                ...effects,
                {
                  type: toggle.type,
                  params: { [toggle.paramKey]: toggle.default },
                },
              ]
            : effects.filter((e) => e.type !== toggle.type),
        );
      },
    });
    if (spec) {
      const value =
        typeof spec.params[toggle.paramKey] === "number"
          ? (spec.params[toggle.paramKey] as number)
          : toggle.default;
      fields.push({
        key: `${toggle.type}-param`,
        label: toggle.paramLabel,
        kind: "range",
        value,
        min: toggle.min,
        max: toggle.max,
        step: toggle.step,
        onChange: (v) => {
          onUpdate(
            effects.map((e) =>
              e.type === toggle.type
                ? { ...e, params: { ...e.params, [toggle.paramKey]: v } }
                : e,
            ),
          );
        },
      });
    }
  }
  return fields;
}

export interface GridViewHandle {
  render(): void;
  refreshPlayhead(): void;
}

export function createGridView(
  container: HTMLElement,
  model: GridModel,
): GridViewHandle {
  let cellEls: HTMLDivElement[][] = [];

  function openRowMenu(x: number, y: number, row: Row): void {
    const fields: MenuField[] = [
      {
        key: "name",
        label: "Name",
        kind: "text",
        value: row.config.name,
        onChange: (v) => {
          model.setRowName(row, v);
          render();
        },
      },
      {
        key: "enabled",
        label: "Enabled (unmuted)",
        kind: "checkbox",
        value: row.config.enabled,
        onChange: (v) => {
          model.setRowEnabled(row, v);
          render();
        },
      },
    ];

    if (row.config.sourceType === "samplePlayer") {
      fields.push({
        key: "playbackMode",
        label: "Playback",
        kind: "select",
        value: row.config.playbackMode,
        options: ["direct", "pitched"],
        onChange: (v) => {
          model.setRowPlaybackMode(row, v as "direct" | "pitched");
          render();
        },
      });
    }

    fields.push({
      key: "triggerMode",
      label: "Trigger mode",
      kind: "select",
      value: row.config.triggerMode.kind,
      options: Object.keys(TRIGGER_MODE_LABELS),
      onChange: (v) => {
        const kind = v as TriggerModeKind;
        model.setRowTriggerMode(
          row,
          kind === "explicitDuration"
            ? { kind, seconds: 0.5, loop: false }
            : { kind },
        );
        render();
      },
    });

    if (row.config.triggerMode.kind === "explicitDuration") {
      fields.push({
        key: "explicitSeconds",
        label: "Duration (s)",
        kind: "number",
        value: row.config.triggerMode.seconds,
        min: 0.05,
        max: 4,
        step: 0.05,
        onChange: (v) => {
          if (row.config.triggerMode.kind !== "explicitDuration") return;
          model.setRowTriggerMode(row, {
            ...row.config.triggerMode,
            seconds: v,
          });
          render();
        },
      });
    }

    fields.push(
      {
        key: "defaultNote",
        label: "Default note",
        kind: "number",
        value: row.config.defaultNote ?? 60,
        min: 0,
        max: 127,
        step: 1,
        onChange: (v) => {
          model.setRowDefaultNote(row, v);
          render();
        },
      },
      {
        key: "defaultGain",
        label: "Default gain",
        kind: "range",
        value: row.config.defaultGain,
        min: 0,
        max: 1,
        step: 0.01,
        onChange: (v) => {
          model.setRowDefaultGain(row, v);
          render();
        },
      },
      {
        key: "timeShift",
        label: "Default nudge (ms)",
        kind: "range",
        value: row.config.defaultTimeShiftSeconds * 1000,
        min: -100,
        max: 100,
        step: 5,
        onChange: (v) => {
          model.setRowDefaultTimeShift(row, v / 1000);
          render();
        },
      },
      {
        key: "reverbSend",
        label: "Reverb send",
        kind: "range",
        value: row.config.reverbSend,
        min: 0,
        max: 1,
        step: 0.01,
        onChange: (v) => {
          model.setRowReverbSend(row, v);
          render();
        },
      },
      ...effectsToggleFields(row.config.effects, (next) => {
        model.setRowEffects(row, next);
        render();
      }),
    );

    const sourceParams = row.source.getParams();
    for (const field of row.source.paramFields) {
      const current = sourceParams[field.key] ?? field.default;
      if (field.kind === "select") {
        fields.push({
          key: field.key,
          label: field.label,
          kind: "select",
          value: String(current),
          options: field.options ?? [],
          onChange: (v) => row.source.setParams({ [field.key]: v }),
        });
      } else {
        fields.push({
          key: field.key,
          label: field.label,
          kind: "range",
          value: Number(current),
          min: field.min ?? 0,
          max: field.max ?? 1,
          step: field.step ?? 0.01,
          onChange: (v) => row.source.setParams({ [field.key]: v }),
        });
      }
    }

    if (row.source.needsSample) {
      fields.push({
        key: "loadSample",
        label: "Load sample…",
        kind: "button",
        onClick: () => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "audio/*";
          input.addEventListener("change", async () => {
            const file = input.files?.[0];
            if (!file) return;
            const audioContext = (row.source.output as AudioNode)
              .context as AudioContext;
            const arrayBuffer = await file.arrayBuffer();
            const buffer = await audioContext.decodeAudioData(arrayBuffer);
            await model.loadRowSample(row, buffer);
          });
          input.click();
        },
      });
    }

    fields.push({
      key: "remove",
      label: "Remove row",
      kind: "button",
      onClick: () => {
        model.removeRow(row);
        render();
      },
    });

    openContextMenu(x, y, `Row: ${row.config.name}`, fields);
  }

  function openColumnMenu(x: number, y: number, columnIndex: number): void {
    const column = model.columns[columnIndex];
    const fields: MenuField[] = [
      {
        key: "enabled",
        label: "Enabled (not skipped)",
        kind: "checkbox",
        value: column.enabled,
        onChange: (v) => {
          model.setColumn(columnIndex, { enabled: v });
          render();
        },
      },
      {
        key: "defaultNote",
        label: "Default note (blank = none)",
        kind: "number",
        value: column.defaultNote ?? -1,
        min: -1,
        max: 127,
        step: 1,
        onChange: (v) =>
          model.setColumn(columnIndex, {
            defaultNote: v < 0 ? undefined : v,
          }),
      },
      {
        key: "defaultGain",
        label: "Default gain (below 0 = none)",
        kind: "number",
        value: column.defaultGain ?? -1,
        min: -1,
        max: 1,
        step: 0.05,
        onChange: (v) =>
          model.setColumn(columnIndex, {
            defaultGain: v < 0 ? undefined : v,
          }),
      },
      {
        key: "defaultGate",
        label: "Default gate (0 = none)",
        kind: "number",
        value: column.defaultGate ?? 0,
        min: 0,
        max: 4,
        step: 0.05,
        onChange: (v) =>
          model.setColumn(columnIndex, {
            defaultGate: v <= 0 ? undefined : v,
          }),
      },
      {
        key: "defaultShift",
        label: "Default nudge (ms)",
        kind: "range",
        value: (column.defaultTimeShiftSeconds ?? 0) * 1000,
        min: -100,
        max: 100,
        step: 5,
        onChange: (v) =>
          model.setColumn(columnIndex, { defaultTimeShiftSeconds: v / 1000 }),
      },
    ];
    openContextMenu(x, y, `Column ${columnIndex + 1}`, fields);
  }

  function openCellMenu(
    x: number,
    y: number,
    row: Row,
    columnIndex: number,
  ): void {
    const cell = row.cells[columnIndex];
    const resolved = model.resolveCell(row, columnIndex);
    const fields: MenuField[] = [
      {
        key: "note",
        label: `Note override (inherited: ${resolved.note})`,
        kind: "number",
        value: cell.note ?? -1,
        min: -1,
        max: 127,
        step: 1,
        onChange: (v) => {
          model.setCell(row, columnIndex, { note: v < 0 ? undefined : v });
          render();
        },
      },
      {
        key: "gain",
        label: `Gain override (inherited: ${resolved.gain.toFixed(2)})`,
        kind: "number",
        value: cell.gain ?? -1,
        min: -1,
        max: 1,
        step: 0.05,
        onChange: (v) => {
          model.setCell(row, columnIndex, { gain: v < 0 ? undefined : v });
          render();
        },
      },
      {
        key: "gate",
        label: `Gate override (inherited: ${resolved.gate.toFixed(2)})`,
        kind: "number",
        value: cell.gate ?? 0,
        min: 0,
        max: 4,
        step: 0.05,
        onChange: (v) => {
          model.setCell(row, columnIndex, { gate: v <= 0 ? undefined : v });
          render();
        },
      },
      {
        key: "shift",
        label: "Time-shift override (ms)",
        kind: "range",
        value: (cell.timeShiftSeconds ?? 0) * 1000,
        min: -100,
        max: 100,
        step: 5,
        onChange: (v) => {
          model.setCell(row, columnIndex, { timeShiftSeconds: v / 1000 });
          render();
        },
      },
    ];

    if (row.config.sourceType === "samplePlayer") {
      fields.push({
        key: "effectsOverride",
        label: "Custom chain for this cell (else inherits the row's)",
        kind: "checkbox",
        value: cell.effects !== undefined,
        onChange: (v) => {
          model.setCell(row, columnIndex, {
            effects: v ? [] : undefined,
          });
          render();
        },
      });
      if (cell.effects) {
        fields.push(
          ...effectsToggleFields(cell.effects, (next) => {
            model.setCell(row, columnIndex, { effects: next });
            render();
          }),
        );
      }
    }

    openContextMenu(
      x,
      y,
      `Cell: row ${row.config.name}, col ${columnIndex + 1}`,
      fields,
    );
  }

  function render(): void {
    container.innerHTML = "";
    const rows = model.getRows();

    const grid = document.createElement("div");
    grid.className = "grid-table";
    grid.style.gridTemplateColumns = `120px repeat(${model.columnCount}, 34px)`;

    // Corner + column-master header row.
    const corner = document.createElement("div");
    corner.className = "grid-corner";
    grid.appendChild(corner);
    model.columns.forEach((column, columnIndex) => {
      const header = document.createElement("div");
      header.className = `master-cell column-master${column.enabled ? "" : " off"}`;
      header.textContent = String(columnIndex + 1);
      header.addEventListener("click", () => {
        model.setColumn(columnIndex, { enabled: !column.enabled });
        render();
      });
      header.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        openColumnMenu(event.clientX, event.clientY, columnIndex);
      });
      grid.appendChild(header);
    });

    cellEls = [];
    for (const row of rows) {
      const rowMaster = document.createElement("div");
      rowMaster.className = `master-cell row-master${row.config.enabled ? "" : " off"}`;
      rowMaster.textContent = row.config.name;
      rowMaster.title = SOURCE_TYPE_LABELS[row.config.sourceType];
      rowMaster.addEventListener("click", () => {
        model.setRowEnabled(row, !row.config.enabled);
        render();
      });
      rowMaster.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        openRowMenu(event.clientX, event.clientY, row);
      });
      grid.appendChild(rowMaster);

      const rowCellEls: HTMLDivElement[] = [];
      row.cells.forEach((cell, columnIndex) => {
        const cellEl = document.createElement("div");
        const overridden =
          cell.note !== undefined ||
          cell.gain !== undefined ||
          cell.gate !== undefined ||
          cell.timeShiftSeconds !== undefined ||
          cell.effects !== undefined;
        cellEl.className = `cell${cell.on ? " on" : ""}${overridden ? " overridden" : ""}`;
        cellEl.addEventListener("click", () => {
          model.setCell(row, columnIndex, { on: !cell.on });
          render();
        });
        cellEl.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          openCellMenu(event.clientX, event.clientY, row, columnIndex);
        });
        grid.appendChild(cellEl);
        rowCellEls.push(cellEl);
      });
      cellEls.push(rowCellEls);
    }

    container.appendChild(grid);
  }

  function refreshPlayhead(): void {
    const rawIndex = model.clock.getCurrentStepIndex();
    const active = rawIndex === null ? null : rawIndex % model.columnCount;
    const rows = model.getRows();
    rows.forEach((row, rowIndex) => {
      cellEls[rowIndex]?.forEach((cellEl, columnIndex) => {
        cellEl.classList.toggle(
          "playhead",
          columnIndex === active && row.isActive(),
        );
      });
    });
  }

  render();
  return { render, refreshPlayhead };
}
