import type { EffectSpec, EffectType } from "../grid/config";
import { BUILT_INS } from "../grid/gridModel";
import type { GridModel, Row } from "../grid/gridModel";
import { SOURCE_TYPE_LABELS } from "../grid/sourceFactory";
import {
  TRIGGER_MODE_LABELS,
  type TriggerModeKind,
} from "../grid/triggerModes";
import { type Field, renderFields } from "./fields";

/** filter/distortion/delay are the 3 persistent-chain effect types this UI
 * exposes (see effectsChain.ts's `EffectSpec` for the general shape any
 * project could add more of). An effect is "on" purely by being present
 * in the array -- effectsFields below renders that as a single override
 * field (checkbox + always-visible param), same as every other
 * overridable value in this panel. */
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

/** `getEffects` is called fresh inside every handler, not just once up
 * front: none of this panel's continuous controls trigger a rebuild on
 * their own "input" events (see fields.ts's top comment for why), so a
 * checkbox toggle followed by a value drag with no render in between
 * would otherwise have the value handler still closing over the
 * pre-toggle array and silently reverting the toggle when it fires. */
export function effectsFields(
  getEffects: () => EffectSpec[],
  onUpdate: (next: EffectSpec[]) => void,
  options: { alwaysInteractive?: boolean } = {},
): Field[] {
  const effects = getEffects();
  return EFFECT_TOGGLES.map((toggle) => {
    const spec = effects.find((e) => e.type === toggle.type);
    const value =
      typeof spec?.params[toggle.paramKey] === "number"
        ? (spec.params[toggle.paramKey] as number)
        : toggle.default;
    return {
      key: toggle.type,
      label: `${toggle.label}: ${toggle.paramLabel}`,
      kind: "override",
      overridden: spec !== undefined,
      alwaysInteractive: options.alwaysInteractive,
      value,
      min: toggle.min,
      max: toggle.max,
      step: toggle.step,
      onToggle: (on) => {
        const current = getEffects();
        onUpdate(
          on
            ? [
                ...current,
                { type: toggle.type, params: { [toggle.paramKey]: value } },
              ]
            : current.filter((e) => e.type !== toggle.type),
        );
      },
      onChange: (v) => {
        const current = getEffects();
        onUpdate(
          current.map((e) =>
            e.type === toggle.type
              ? { ...e, params: { ...e.params, [toggle.paramKey]: v } }
              : e,
          ),
        );
      },
    };
  });
}

type Selection =
  | { kind: "row"; rowId: string }
  | { kind: "column"; columnIndex: number }
  | { kind: "cell"; rowId: string; columnIndex: number }
  | { kind: "master" }
  | null;

export interface GridViewOptions {
  buildMasterFields: () => Field[];
}

export interface GridViewHandle {
  render(): void;
  refreshPlayhead(): void;
  selectMaster(): void;
}

export function createGridView(
  container: HTMLElement,
  model: GridModel,
  options: GridViewOptions,
): GridViewHandle {
  let selection: Selection = null;
  let cellEls: HTMLDivElement[][] = [];

  function select(next: Selection): void {
    selection = next;
    render();
  }

  function rowFields(row: Row): Field[] {
    const fields: Field[] = [
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
        kind: "override",
        overridden: row.config.defaultNote !== undefined,
        value: row.config.defaultNote ?? BUILT_INS.note,
        min: 0,
        max: 127,
        step: 1,
        onToggle: (on) => {
          model.setRowDefaultNote(
            row,
            on ? (row.config.defaultNote ?? BUILT_INS.note) : undefined,
          );
          render();
        },
        onChange: (v) => model.setRowDefaultNote(row, v),
      },
      {
        key: "defaultGain",
        label: "Default gain",
        kind: "override",
        overridden: row.config.defaultGain !== undefined,
        value: row.config.defaultGain ?? BUILT_INS.gain,
        min: 0,
        max: 1,
        step: 0.01,
        onToggle: (on) => {
          model.setRowDefaultGain(
            row,
            on ? (row.config.defaultGain ?? BUILT_INS.gain) : undefined,
          );
          render();
        },
        onChange: (v) => model.setRowDefaultGain(row, v),
      },
      {
        key: "timeShift",
        label: "Default nudge (ms)",
        kind: "override",
        overridden: row.config.defaultTimeShiftSeconds !== undefined,
        value: (row.config.defaultTimeShiftSeconds ?? 0) * 1000,
        min: -100,
        max: 100,
        step: 5,
        onToggle: (on) => {
          model.setRowDefaultTimeShift(
            row,
            on ? (row.config.defaultTimeShiftSeconds ?? 0) : undefined,
          );
          render();
        },
        onChange: (v) => model.setRowDefaultTimeShift(row, v / 1000),
      },
      {
        key: "reverbSend",
        label: "Reverb send",
        kind: "range",
        value: row.config.reverbSend,
        min: 0,
        max: 1,
        step: 0.01,
        onChange: (v) => model.setRowReverbSend(row, v),
      },
      ...effectsFields(
        () => model.getRow(row.id)?.config.effects ?? [],
        (next) => model.setRowEffects(row, next),
      ),
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
        select(null);
      },
    });

    return fields;
  }

  function columnFields(columnIndex: number): Field[] {
    const column = model.columns[columnIndex];
    return [
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
        label: "Default note",
        kind: "override",
        overridden: column.defaultNote !== undefined,
        value: column.defaultNote ?? BUILT_INS.note,
        min: 0,
        max: 127,
        step: 1,
        onToggle: (on) => {
          model.setColumn(columnIndex, {
            defaultNote: on
              ? (column.defaultNote ?? BUILT_INS.note)
              : undefined,
          });
          render();
        },
        onChange: (v) => model.setColumn(columnIndex, { defaultNote: v }),
      },
      {
        key: "defaultGain",
        label: "Default gain",
        kind: "override",
        overridden: column.defaultGain !== undefined,
        value: column.defaultGain ?? BUILT_INS.gain,
        min: 0,
        max: 1,
        step: 0.01,
        onToggle: (on) => {
          model.setColumn(columnIndex, {
            defaultGain: on
              ? (column.defaultGain ?? BUILT_INS.gain)
              : undefined,
          });
          render();
        },
        onChange: (v) => model.setColumn(columnIndex, { defaultGain: v }),
      },
      {
        key: "defaultGate",
        label: "Default gate",
        kind: "override",
        overridden: column.defaultGate !== undefined,
        value: column.defaultGate ?? BUILT_INS.gate,
        min: 0,
        max: 4,
        step: 0.05,
        onToggle: (on) => {
          model.setColumn(columnIndex, {
            defaultGate: on
              ? (column.defaultGate ?? BUILT_INS.gate)
              : undefined,
          });
          render();
        },
        onChange: (v) => model.setColumn(columnIndex, { defaultGate: v }),
      },
      {
        key: "defaultShift",
        label: "Default nudge (ms)",
        kind: "override",
        overridden: column.defaultTimeShiftSeconds !== undefined,
        value: (column.defaultTimeShiftSeconds ?? 0) * 1000,
        min: -100,
        max: 100,
        step: 5,
        onToggle: (on) => {
          model.setColumn(columnIndex, {
            defaultTimeShiftSeconds: on
              ? (column.defaultTimeShiftSeconds ?? 0)
              : undefined,
          });
          render();
        },
        onChange: (v) =>
          model.setColumn(columnIndex, { defaultTimeShiftSeconds: v / 1000 }),
      },
    ];
  }

  interface CellPanel {
    fields: Field[];
    headerButton?: { label: string; active: boolean; onClick: () => void };
    dimmedSection?: { fields: Field[]; dimmed: boolean };
  }

  function cellFields(row: Row, columnIndex: number): CellPanel {
    const cell = row.cells[columnIndex];
    const resolved = model.resolveCell(row, columnIndex);
    const fields: Field[] = [
      {
        key: "on",
        label: "On",
        kind: "checkbox",
        value: cell.on,
        onChange: (v) => {
          model.setCell(row, columnIndex, { on: v });
          render();
        },
      },
      {
        key: "note",
        label: "Note",
        kind: "override",
        overridden: cell.note !== undefined,
        value: cell.note ?? resolved.note,
        min: 0,
        max: 127,
        step: 1,
        onToggle: (on) => {
          model.setCell(row, columnIndex, {
            note: on ? resolved.note : undefined,
          });
          render();
        },
        onChange: (v) => model.setCell(row, columnIndex, { note: v }),
      },
      {
        key: "gain",
        label: "Gain",
        kind: "override",
        overridden: cell.gain !== undefined,
        value: cell.gain ?? resolved.gain,
        min: 0,
        max: 1,
        step: 0.01,
        onToggle: (on) => {
          model.setCell(row, columnIndex, {
            gain: on ? resolved.gain : undefined,
          });
          render();
        },
        onChange: (v) => model.setCell(row, columnIndex, { gain: v }),
      },
      {
        key: "gate",
        label: "Gate",
        kind: "override",
        overridden: cell.gate !== undefined,
        value: cell.gate ?? resolved.gate,
        min: 0,
        max: 4,
        step: 0.05,
        onToggle: (on) => {
          model.setCell(row, columnIndex, {
            gate: on ? resolved.gate : undefined,
          });
          render();
        },
        onChange: (v) => model.setCell(row, columnIndex, { gate: v }),
      },
      {
        key: "shift",
        label: "Time-shift (ms)",
        kind: "override",
        overridden: cell.timeShiftSeconds !== undefined,
        value: (cell.timeShiftSeconds ?? resolved.timeShiftSeconds) * 1000,
        min: -100,
        max: 100,
        step: 5,
        onToggle: (on) => {
          model.setCell(row, columnIndex, {
            timeShiftSeconds: on ? resolved.timeShiftSeconds : undefined,
          });
          render();
        },
        onChange: (v) =>
          model.setCell(row, columnIndex, { timeShiftSeconds: v / 1000 }),
      },
    ];

    if (row.config.sourceType !== "samplePlayer") {
      return { fields };
    }

    return {
      fields,
      headerButton: {
        label: "Override",
        active: cell.effectsOverride,
        onClick: () => {
          model.setCell(row, columnIndex, {
            effectsOverride: !cell.effectsOverride,
          });
          render();
        },
      },
      // Always shown and always interactive, even while inactive -- so a
      // cell's chain can be dialed in ahead of time, silently, and
      // switched on later with a single click instead of building it from
      // scratch under time pressure. `dimmed` is purely visual (see
      // main.css's .dimmed-section); it never disables the controls.
      dimmedSection: {
        fields: effectsFields(
          () => row.cells[columnIndex].effects,
          (next) => model.setCell(row, columnIndex, { effects: next }),
          { alwaysInteractive: true },
        ),
        dimmed: !cell.effectsOverride,
      },
    };
  }

  interface PanelContent extends CellPanel {
    title: string;
  }

  function panelTitleAndFields(rows: Row[]): PanelContent {
    if (selection === null) {
      return { title: "Nothing selected", fields: [] };
    }
    if (selection.kind === "master") {
      return { title: "Master", fields: options.buildMasterFields() };
    }
    if (selection.kind === "column") {
      return {
        title: `Column ${selection.columnIndex + 1}`,
        fields: columnFields(selection.columnIndex),
      };
    }
    const targetRowId = selection.rowId;
    const row = rows.find((r) => r.id === targetRowId);
    if (!row) {
      selection = null;
      return { title: "Nothing selected", fields: [] };
    }
    if (selection.kind === "row") {
      return { title: `Row: ${row.config.name}`, fields: rowFields(row) };
    }
    return {
      title: `Cell: ${row.config.name} × col ${selection.columnIndex + 1}`,
      ...cellFields(row, selection.columnIndex),
    };
  }

  function render(): void {
    container.innerHTML = "";
    const rows = model.getRows();

    const layout = document.createElement("div");
    layout.className = "grid-layout";

    const grid = document.createElement("div");
    grid.className = "grid-table";
    grid.style.gridTemplateColumns = `120px repeat(${model.columnCount}, 34px)`;

    const corner = document.createElement("div");
    corner.className = "grid-corner";
    grid.appendChild(corner);
    model.columns.forEach((column, columnIndex) => {
      const header = document.createElement("div");
      const isSelected =
        selection?.kind === "column" && selection.columnIndex === columnIndex;
      header.className = `master-cell column-master${column.enabled ? "" : " off"}${isSelected ? " selected" : ""}`;
      header.textContent = String(columnIndex + 1);
      header.addEventListener("click", () => {
        model.setColumn(columnIndex, { enabled: !column.enabled });
        render();
      });
      header.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        select({ kind: "column", columnIndex });
      });
      grid.appendChild(header);
    });

    cellEls = [];
    for (const row of rows) {
      const rowMaster = document.createElement("div");
      const rowSelected =
        selection?.kind === "row" && selection.rowId === row.id;
      rowMaster.className = `master-cell row-master${row.config.enabled ? "" : " off"}${rowSelected ? " selected" : ""}`;
      rowMaster.textContent = row.config.name;
      rowMaster.title = SOURCE_TYPE_LABELS[row.config.sourceType];
      rowMaster.addEventListener("click", () => {
        model.setRowEnabled(row, !row.config.enabled);
        render();
      });
      rowMaster.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        select({ kind: "row", rowId: row.id });
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
          cell.effectsOverride;
        const cellSelected =
          selection?.kind === "cell" &&
          selection.rowId === row.id &&
          selection.columnIndex === columnIndex;
        cellEl.className = `cell${cell.on ? " on" : ""}${overridden ? " overridden" : ""}${cellSelected ? " selected" : ""}`;
        cellEl.addEventListener("click", () => {
          model.setCell(row, columnIndex, { on: !cell.on });
          render();
        });
        cellEl.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          select({ kind: "cell", rowId: row.id, columnIndex });
        });
        grid.appendChild(cellEl);
        rowCellEls.push(cellEl);
      });
      cellEls.push(rowCellEls);
    }

    const panel = document.createElement("div");
    panel.className = "config-panel";
    const { title, fields, headerButton, dimmedSection } =
      panelTitleAndFields(rows);

    const heading = document.createElement("div");
    heading.className = "panel-title-row";
    const headingTitle = document.createElement("span");
    headingTitle.className = "panel-title";
    headingTitle.textContent = title;
    heading.appendChild(headingTitle);
    if (headerButton) {
      const button = document.createElement("button");
      button.className = `panel-header-button${headerButton.active ? " active" : ""}`;
      button.textContent = headerButton.label;
      button.addEventListener("click", headerButton.onClick);
      heading.appendChild(button);
    }
    panel.appendChild(heading);

    if (fields.length === 0 && !dimmedSection && selection === null) {
      const hint = document.createElement("p");
      hint.className = "panel-hint";
      hint.textContent =
        "Right-click a cell, a row label, or a column header to edit it here.";
      panel.appendChild(hint);
    } else {
      const body = document.createElement("div");
      body.className = "panel-body";
      renderFields(body, fields);
      panel.appendChild(body);
    }

    if (dimmedSection) {
      const section = document.createElement("div");
      section.className = `panel-body dimmed-section${dimmedSection.dimmed ? " dimmed" : ""}`;
      renderFields(section, dimmedSection.fields);
      panel.appendChild(section);
    }

    layout.appendChild(grid);
    layout.appendChild(panel);
    container.appendChild(layout);
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
  return {
    render,
    refreshPlayhead,
    selectMaster: () => select({ kind: "master" }),
  };
}
