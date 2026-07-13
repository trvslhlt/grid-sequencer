import type { EffectSpec, EffectType, EnvelopeParams } from "../grid/config";
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

const ENVELOPE_FIELD_SPECS: Array<{
  key: keyof EnvelopeParams;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: "attackMs", label: "Attack (ms)", min: 0, max: 500, step: 1 },
  { key: "decayMs", label: "Decay (ms)", min: 0, max: 1000, step: 5 },
  { key: "sustainLevel", label: "Sustain level", min: 0, max: 1, step: 0.01 },
  { key: "releaseMs", label: "Release (ms)", min: 0, max: 1000, step: 1 },
];

/** Envelope is always a single consolidated override (like row/column
 * Defaults, unlike note/gain/gate/time-shift's per-field checkboxes) --
 * all 4 ADSR fields are plain always-interactive controls, gated by one
 * section-level toggle the caller supplies via `onChange`'s wiring. */
function envelopeFields(
  envelope: EnvelopeParams,
  onChange: (patch: Partial<EnvelopeParams>) => void,
): Field[] {
  return ENVELOPE_FIELD_SPECS.map((spec) => ({
    key: spec.key,
    label: spec.label,
    kind: "range",
    value: envelope[spec.key],
    min: spec.min,
    max: spec.max,
    step: spec.step,
    onChange: (v) => onChange({ [spec.key]: v }),
  }));
}

interface PanelSection {
  title: string;
  fields: Field[];
  toggle?: { active: boolean; disabled?: boolean; onClick: () => void };
}

interface PanelContent {
  title: string;
  fields: Field[];
  sections: PanelSection[];
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

  function rowPanel(row: Row): PanelContent {
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

    fields.push({
      key: "reverbSend",
      label: "Reverb send",
      kind: "range",
      value: row.config.reverbSend,
      min: 0,
      max: 1,
      step: 0.01,
      onChange: (v) => model.setRowReverbSend(row, v),
    });

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

    // The winning side's Defaults/Envelope override is disabled: with
    // global precedence already deciding this row vs. any column it
    // shares a field with, an explicit override here can't change the
    // outcome -- it's the *losing* side that needs one to make its own
    // values matter at all.
    const defaultsDisabled = model.precedence === "row";

    return {
      title: `Row: ${row.config.name}`,
      fields,
      sections: [
        {
          title: "Defaults",
          toggle: {
            active: row.config.defaultsOverride,
            disabled: defaultsDisabled,
            onClick: () => {
              model.setRowDefaultsOverride(row, !row.config.defaultsOverride);
              render();
            },
          },
          fields: [
            {
              key: "defaultNote",
              label: "Default note",
              kind: "number",
              value: row.config.defaultNote,
              min: 0,
              max: 127,
              step: 1,
              onChange: (v) => model.setRowDefaultNote(row, v),
            },
            {
              key: "defaultGain",
              label: "Default gain",
              kind: "range",
              value: row.config.defaultGain,
              min: 0,
              max: 1,
              step: 0.01,
              onChange: (v) => model.setRowDefaultGain(row, v),
            },
            {
              key: "timeShift",
              label: "Default nudge (ms)",
              kind: "range",
              value: row.config.defaultTimeShiftSeconds * 1000,
              min: -100,
              max: 100,
              step: 5,
              onChange: (v) => model.setRowDefaultTimeShift(row, v / 1000),
            },
          ],
        },
        {
          title: "Envelope",
          toggle: {
            active: row.config.envelopeOverride,
            disabled: defaultsDisabled,
            onClick: () => {
              model.setRowEnvelopeOverride(row, !row.config.envelopeOverride);
              render();
            },
          },
          fields: envelopeFields(row.config.envelope, (patch) =>
            model.setRowEnvelope(row, patch),
          ),
        },
        {
          title: "Effects",
          fields: effectsFields(
            () => model.getRow(row.id)?.config.effects ?? [],
            (next) => model.setRowEffects(row, next),
          ),
        },
      ],
    };
  }

  function columnPanel(columnIndex: number): PanelContent {
    const column = model.columns[columnIndex];
    const defaultsDisabled = model.precedence === "column";

    return {
      title: `Column ${columnIndex + 1}`,
      fields: [
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
      ],
      sections: [
        {
          title: "Defaults",
          toggle: {
            active: column.defaultsOverride,
            disabled: defaultsDisabled,
            onClick: () => {
              model.setColumn(columnIndex, {
                defaultsOverride: !column.defaultsOverride,
              });
              render();
            },
          },
          fields: [
            {
              key: "defaultNote",
              label: "Default note",
              kind: "number",
              value: column.defaultNote,
              min: 0,
              max: 127,
              step: 1,
              onChange: (v) => model.setColumn(columnIndex, { defaultNote: v }),
            },
            {
              key: "defaultGain",
              label: "Default gain",
              kind: "range",
              value: column.defaultGain,
              min: 0,
              max: 1,
              step: 0.01,
              onChange: (v) => model.setColumn(columnIndex, { defaultGain: v }),
            },
            {
              key: "defaultGate",
              label: "Default gate",
              kind: "range",
              value: column.defaultGate,
              min: 0,
              max: 4,
              step: 0.05,
              onChange: (v) => model.setColumn(columnIndex, { defaultGate: v }),
            },
            {
              key: "defaultShift",
              label: "Default nudge (ms)",
              kind: "range",
              value: column.defaultTimeShiftSeconds * 1000,
              min: -100,
              max: 100,
              step: 5,
              onChange: (v) =>
                model.setColumn(columnIndex, {
                  defaultTimeShiftSeconds: v / 1000,
                }),
            },
          ],
        },
        {
          title: "Envelope",
          toggle: {
            active: column.envelopeOverride,
            disabled: defaultsDisabled,
            onClick: () => {
              model.setColumn(columnIndex, {
                envelopeOverride: !column.envelopeOverride,
              });
              render();
            },
          },
          fields: envelopeFields(column.envelope, (patch) =>
            model.setColumn(columnIndex, {
              envelope: { ...column.envelope, ...patch },
            }),
          ),
        },
      ],
    };
  }

  function cellPanel(row: Row, columnIndex: number): PanelContent {
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

    const sections: PanelSection[] = [
      {
        title: "Envelope",
        toggle: {
          active: cell.envelopeOverride,
          onClick: () => {
            model.setCell(row, columnIndex, {
              envelopeOverride: !cell.envelopeOverride,
            });
            render();
          },
        },
        fields: envelopeFields(cell.envelope, (patch) =>
          model.setCell(row, columnIndex, {
            envelope: { ...cell.envelope, ...patch },
          }),
        ),
      },
    ];

    if (row.config.sourceType === "samplePlayer") {
      sections.push({
        title: "Effects",
        toggle: {
          active: cell.effectsOverride,
          onClick: () => {
            model.setCell(row, columnIndex, {
              effectsOverride: !cell.effectsOverride,
            });
            render();
          },
        },
        // Always shown and always interactive, even while inactive -- so
        // a cell's chain can be dialed in ahead of time, silently, and
        // switched on later with a single click instead of building it
        // from scratch under time pressure. Dimming is purely visual
        // (main.css's .dimmed-section); it never disables the controls.
        fields: effectsFields(
          () => row.cells[columnIndex].effects,
          (next) => model.setCell(row, columnIndex, { effects: next }),
          { alwaysInteractive: true },
        ),
      });
    }

    return {
      title: `Cell: ${row.config.name} × col ${columnIndex + 1}`,
      fields,
      sections,
    };
  }

  function panelContent(rows: Row[]): PanelContent {
    if (selection === null) {
      return { title: "Nothing selected", fields: [], sections: [] };
    }
    if (selection.kind === "master") {
      return {
        title: "Master",
        fields: options.buildMasterFields(),
        sections: [],
      };
    }
    if (selection.kind === "column") {
      return columnPanel(selection.columnIndex);
    }
    const targetRowId = selection.rowId;
    const row = rows.find((r) => r.id === targetRowId);
    if (!row) {
      selection = null;
      return { title: "Nothing selected", fields: [], sections: [] };
    }
    if (selection.kind === "row") {
      return rowPanel(row);
    }
    return cellPanel(row, selection.columnIndex);
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
          cell.envelopeOverride ||
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
    const { title, fields, sections } = panelContent(rows);

    const heading = document.createElement("div");
    heading.className = "panel-title-row";
    const headingTitle = document.createElement("span");
    headingTitle.className = "panel-title";
    headingTitle.textContent = title;
    heading.appendChild(headingTitle);
    panel.appendChild(heading);

    if (fields.length === 0 && sections.length === 0 && selection === null) {
      const hint = document.createElement("p");
      hint.className = "panel-hint";
      hint.textContent =
        "Right-click a cell, a row label, or a column header to edit it here.";
      panel.appendChild(hint);
    } else {
      if (fields.length > 0) {
        const body = document.createElement("div");
        body.className = "panel-body";
        renderFields(body, fields);
        panel.appendChild(body);
      }

      for (const section of sections) {
        const sectionEl = document.createElement("div");
        sectionEl.className = "panel-section";

        const sectionHeading = document.createElement("div");
        sectionHeading.className = "panel-section-title-row";
        const sectionTitle = document.createElement("span");
        sectionTitle.className = "panel-section-title";
        sectionTitle.textContent = section.title;
        sectionHeading.appendChild(sectionTitle);
        if (section.toggle) {
          const button = document.createElement("button");
          button.className = `panel-header-button${section.toggle.active ? " active" : ""}`;
          button.textContent = "Override";
          button.disabled = section.toggle.disabled ?? false;
          button.title = button.disabled
            ? "Already wins by the global row/column precedence setting -- an override here can't change that."
            : "";
          button.addEventListener("click", section.toggle.onClick);
          sectionHeading.appendChild(button);
        }
        sectionEl.appendChild(sectionHeading);

        const sectionBody = document.createElement("div");
        const dimmed = section.toggle ? !section.toggle.active : false;
        sectionBody.className = `panel-body dimmed-section${dimmed ? " dimmed" : ""}`;
        renderFields(sectionBody, section.fields);
        sectionEl.appendChild(sectionBody);

        panel.appendChild(sectionEl);
      }
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
