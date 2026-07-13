import type { EffectSpec, EffectType, EnvelopeParams } from "../grid/config";
import type { GridModel, Row } from "../grid/gridModel";
import { SOURCE_TYPE_LABELS } from "../grid/sourceFactory";
import {
  TRIGGER_MODE_LABELS,
  type TriggerModeKind,
} from "../grid/triggerModes";
import { type Field, renderFields } from "./fields";

interface EffectRangeParamSpec {
  key: string;
  label: string;
  kind: "range";
  min: number;
  max: number;
  step: number;
  default: number;
  /** `default`/the stored value are in the underlying effect class's own
   * native unit (e.g. compressor attack/release are seconds, the
   * DynamicsCompressorNode's own unit) -- `min`/`max`/`step` above are
   * already authored in whatever unit is actually UI-friendly (e.g.
   * milliseconds), so only the value itself needs converting: displayed
   * as `stored * scale`, written back as `display / scale`. Omitted (1)
   * for every param whose native unit is already UI-friendly. */
  scale?: number;
}

interface EffectSelectParamSpec {
  key: string;
  label: string;
  kind: "select";
  options: string[];
  default: string;
}

type EffectParamSpec = EffectRangeParamSpec | EffectSelectParamSpec;

/** Every persistent-chain effect type this UI exposes, and *all* of each
 * one's params -- not just the single headline param each used to get
 * (see effectsChain.ts's `instantiateEffect` and bruit-kit's individual
 * effect classes for the full param lists this mirrors). `wet` (dry/wet
 * mix) is included for every type: previously fixed at instantiation time
 * (1 for most, 0.35 for delay -- see the comment on delay's entry below)
 * and never user-adjustable at all. */
const EFFECT_TABLE: Array<{
  type: EffectType;
  label: string;
  params: EffectParamSpec[];
}> = [
  {
    type: "filter",
    label: "Filter",
    params: [
      {
        key: "type",
        label: "Filter type",
        kind: "select",
        options: [
          "lowpass",
          "highpass",
          "bandpass",
          "lowshelf",
          "highshelf",
          "peaking",
          "notch",
          "allpass",
        ],
        default: "lowpass",
      },
      {
        key: "frequency",
        label: "Cutoff (Hz)",
        kind: "range",
        min: 200,
        max: 8000,
        step: 50,
        default: 8000,
      },
      {
        key: "q",
        label: "Resonance (Q)",
        kind: "range",
        min: 0.1,
        max: 20,
        step: 0.1,
        default: 0.7,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "distortion",
    label: "Distortion",
    params: [
      {
        key: "amount",
        label: "Amount",
        kind: "range",
        min: 0,
        max: 100,
        step: 1,
        default: 20,
      },
      {
        key: "outputGain",
        label: "Output gain",
        kind: "range",
        min: 0,
        max: 2,
        step: 0.05,
        default: 1,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "delay",
    label: "Delay",
    params: [
      {
        key: "delayMs",
        label: "Time (ms)",
        kind: "range",
        min: 10,
        max: 1000,
        step: 10,
        default: 180,
      },
      {
        key: "feedback",
        label: "Feedback",
        kind: "range",
        min: 0,
        max: 0.95,
        step: 0.01,
        default: 0.35,
      },
      // Not default 1 like the others -- see effectsChain.ts's
      // instantiateEffect for why full-wet is actually broken for delay
      // specifically (a short/percussive note can go fully silent until
      // an echo that may never arrive).
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.35,
      },
    ],
  },
  {
    type: "compressor",
    label: "Compressor",
    params: [
      {
        key: "threshold",
        label: "Threshold (dB)",
        kind: "range",
        min: -60,
        max: 0,
        step: 1,
        default: -24,
      },
      {
        key: "ratio",
        label: "Ratio",
        kind: "range",
        min: 1,
        max: 20,
        step: 0.5,
        default: 12,
      },
      {
        key: "attack",
        label: "Attack (ms)",
        kind: "range",
        min: 0,
        max: 200,
        step: 1,
        default: 0.003,
        scale: 1000,
      },
      {
        key: "release",
        label: "Release (ms)",
        kind: "range",
        min: 0,
        max: 1000,
        step: 5,
        default: 0.25,
        scale: 1000,
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "tremolo",
    label: "Tremolo",
    params: [
      {
        key: "rate",
        label: "Rate (Hz)",
        kind: "range",
        min: 0.1,
        max: 20,
        step: 0.1,
        default: 5,
      },
      {
        key: "depth",
        label: "Depth",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
      },
      {
        key: "waveform",
        label: "LFO shape",
        kind: "select",
        options: ["sine", "square"],
        default: "sine",
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
  {
    type: "ringMod",
    label: "Ring Mod",
    params: [
      {
        key: "frequency",
        label: "Frequency (Hz)",
        kind: "range",
        min: 1,
        max: 2000,
        step: 1,
        default: 30,
      },
      {
        key: "waveform",
        label: "Carrier shape",
        kind: "select",
        options: ["sine", "square", "sawtooth"],
        default: "sine",
      },
      {
        key: "wet",
        label: "Wet",
        kind: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 1,
      },
    ],
  },
];

/** One checkbox (is this effect type in the chain at all) followed by
 * *all* of its own params as plain, always-interactive fields -- unlike
 * the old single-param "override" field, there's no one value to pair
 * the checkbox with any more, so params just sit in the panel's normal
 * dimmed-while-off section body (see the callers' `.dimmed-section`
 * wrapping) rather than each disabling itself individually. That's a
 * deliberate unification, not a shortcut: cell-level effects already
 * worked this way (configurable ahead of switching them on), and row/
 * master-level ones now do too.
 *
 * `getEffects` is called fresh inside every handler, not just once up
 * front: none of this panel's continuous controls trigger a rebuild on
 * their own "input" events (see fields.ts's top comment for why), so a
 * checkbox toggle followed by a value drag with no render in between
 * would otherwise have the value handler still closing over the
 * pre-toggle array and silently reverting the toggle when it fires. */
export function effectsFields(
  getEffects: () => EffectSpec[],
  onUpdate: (next: EffectSpec[]) => void,
): Field[] {
  const effects = getEffects();
  const fields: Field[] = [];
  for (const effect of EFFECT_TABLE) {
    const spec = effects.find((e) => e.type === effect.type);
    fields.push({
      key: effect.type,
      label: effect.label,
      kind: "checkbox",
      value: spec !== undefined,
      onChange: (on) => {
        const current = getEffects();
        onUpdate(
          on
            ? [
                ...current,
                {
                  type: effect.type,
                  params: Object.fromEntries(
                    effect.params.map((p) => [p.key, p.default]),
                  ),
                },
              ]
            : current.filter((e) => e.type !== effect.type),
        );
      },
    });
    for (const param of effect.params) {
      // No "Effect: " prefix -- the checkbox field above already reads as
      // this group's own heading (see effect.label there), so repeating
      // the effect's name on every param below it is redundant. Right-
      // aligning the row (see fields.ts's `indented`) is what gives the
      // group its visual separation from the heading instead.
      const key = `${effect.type}-${param.key}`;
      const stored = spec?.params[param.key];
      const onChange = (v: number | string) => {
        const current = getEffects();
        onUpdate(
          current.map((e) =>
            e.type === effect.type
              ? { ...e, params: { ...e.params, [param.key]: v } }
              : e,
          ),
        );
      };
      if (param.kind === "select") {
        fields.push({
          key,
          label: param.label,
          kind: "select",
          value: typeof stored === "string" ? stored : param.default,
          options: param.options,
          indented: true,
          onChange,
        });
      } else {
        // min/max/step are already authored in display units (e.g.
        // compressor attack's 0..200 ms) -- only `default`/`stored` are in
        // the effect class's own native units (seconds), so scale applies
        // to the value conversion alone, not the range bounds.
        const scale = param.scale ?? 1;
        const storedNumber =
          typeof stored === "number" ? stored : param.default;
        fields.push({
          key,
          label: param.label,
          kind: "range",
          value: storedNumber * scale,
          min: param.min,
          max: param.max,
          step: param.step,
          indented: true,
          onChange: (v) => onChange(v / scale),
        });
      }
    }
  }
  return fields;
}

/** Envelope is always a single consolidated override (like row/column
 * Defaults, unlike note/gain/gate/time-shift's per-field checkboxes) -- a
 * single breakpoint-curve editor (see fields.ts's "automation" kind),
 * always interactive, gated by one section-level toggle the caller
 * supplies via the section's own `toggle` wiring. */
function envelopeFields(
  envelope: EnvelopeParams,
  onChange: (points: EnvelopeParams["points"]) => void,
): Field[] {
  return [
    {
      key: "envelope",
      label: "Shape (drag points, double-click to add/remove)",
      kind: "automation",
      points: envelope.points,
      onChange,
    },
  ];
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
            ? { kind, steps: 1, loop: false }
            : { kind },
        );
        render();
      },
    });

    if (row.config.triggerMode.kind === "explicitDuration") {
      fields.push({
        key: "explicitSteps",
        label: "Duration (steps)",
        kind: "number",
        value: row.config.triggerMode.steps,
        min: 0.1,
        max: 32,
        step: 0.1,
        onChange: (v) => {
          if (row.config.triggerMode.kind !== "explicitDuration") return;
          model.setRowTriggerMode(row, {
            ...row.config.triggerMode,
            steps: v,
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
            // The waveform range view below only appears once a buffer
            // exists -- nothing to trim a range against before then.
            render();
          });
          input.click();
        },
      });
    }

    if (row.config.sourceType === "samplePlayer") {
      const buffer = model.getRowSampleBuffer(row);
      if (buffer) {
        fields.push({
          key: "sampleRange",
          label: "Playback range (drag handles to trim)",
          kind: "waveformRange",
          buffer,
          range: row.config.sampleRange,
          onChange: (range) => model.setRowSampleRange(row, range),
        });
      }
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
            active: row.config.defaultsOverride || defaultsDisabled,
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
            active: row.config.envelopeOverride || defaultsDisabled,
            disabled: defaultsDisabled,
            onClick: () => {
              model.setRowEnvelopeOverride(row, !row.config.envelopeOverride);
              render();
            },
          },
          fields: envelopeFields(row.config.envelope, (points) =>
            model.setRowEnvelope(row, points),
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
            active: column.defaultsOverride || defaultsDisabled,
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
            active: column.envelopeOverride || defaultsDisabled,
            disabled: defaultsDisabled,
            onClick: () => {
              model.setColumn(columnIndex, {
                envelopeOverride: !column.envelopeOverride,
              });
              render();
            },
          },
          fields: envelopeFields(column.envelope, (points) =>
            model.setColumn(columnIndex, { envelope: { points } }),
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
        fields: envelopeFields(cell.envelope, (points) =>
          model.setCell(row, columnIndex, { envelope: { points } }),
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
