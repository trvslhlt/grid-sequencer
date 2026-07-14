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
      // Only audible for lowshelf/highshelf/peaking -- BiquadFilterNode
      // ignores it for every other type -- but shown unconditionally like
      // every other param here (see effectsFields' own doc: nothing
      // conditionally shows/hides based on another field's value).
      {
        key: "gain",
        label: "Gain (dB, shelf/peaking only)",
        kind: "range",
        min: -40,
        max: 40,
        step: 1,
        default: 0,
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
        key: "knee",
        label: "Knee (dB)",
        kind: "range",
        min: 0,
        max: 40,
        step: 1,
        default: 30,
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
        options: ["sine", "square", "sawtooth", "triangle"],
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
        options: ["sine", "square", "sawtooth", "triangle"],
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

// Shared across every effectsFields call (row/cell/master alike) rather
// than scoped per-chain -- effectsFields is a plain module-level function
// called fresh from 3 different places, with no closure of its own that
// would survive across renders the way rowPanel's per-row Maps used to.
// A single "what to add next" pick leaking between panels is a harmless
// cosmetic quirk (a freshly-opened panel might show the last-picked type
// pre-selected instead of the first one) worth accepting for how much
// simpler it keeps this over threading a unique key through every caller.
let pendingEffectType: EffectType = EFFECT_TABLE[0].type;

/** A chain is a plain ordered list now, not six fixed on/off slots: each
 * entry already in `getEffects()` renders as its own removable block (a
 * "Remove" button doubling as that instance's own heading, same
 * "no separate label needed" reasoning the old checkbox-as-heading had),
 * followed by "+ Add effect" (append a fresh default instance of the
 * chosen type -- nothing stops the same type being added twice, unlike
 * before) and, once there's anything to save, "Save chain as preset...".
 *
 * `getEffects` is called fresh inside every handler, not just once up
 * front: none of this panel's continuous controls trigger a rebuild on
 * their own "input" events (see fields.ts's top comment for why), so a
 * remove followed by a value drag with no render in between would
 * otherwise have the value handler still closing over the pre-removal
 * array and silently undoing the removal when it fires. */
export function effectsFields(
  getEffects: () => EffectSpec[],
  onUpdate: (next: EffectSpec[]) => void,
  onSaveAsPreset?: (effects: EffectSpec[], name: string) => void,
): Field[] {
  const effects = getEffects();
  const fields: Field[] = [];

  effects.forEach((spec, index) => {
    const table = EFFECT_TABLE.find((e) => e.type === spec.type);
    if (!table) return;
    fields.push({
      key: `${index}-remove`,
      label: `${table.label} — Remove`,
      kind: "button",
      onClick: () => {
        const current = getEffects();
        onUpdate(current.filter((_, i) => i !== index));
      },
    });
    for (const param of table.params) {
      // No "Effect: " prefix -- the Remove button above already reads as
      // this instance's own heading (see table.label there), so repeating
      // the effect's name on every param below it is redundant. Right-
      // aligning the row (see fields.ts's `indented`) is what gives the
      // group its visual separation from the heading instead.
      const key = `${index}-${param.key}`;
      const stored = spec.params[param.key];
      const onChange = (v: number | string) => {
        const current = getEffects();
        onUpdate(
          current.map((e, i) =>
            i === index ? { ...e, params: { ...e.params, [param.key]: v } } : e,
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
  });

  fields.push({
    key: "add-effect-type",
    label: "Add effect…",
    kind: "select",
    value: pendingEffectType,
    options: EFFECT_TABLE.map((e) => ({ value: e.type, label: e.label })),
    onChange: (v) => {
      pendingEffectType = v as EffectType;
    },
  });
  fields.push({
    key: "add-effect-button",
    label: "Add",
    kind: "button",
    onClick: () => {
      const table = EFFECT_TABLE.find((e) => e.type === pendingEffectType);
      if (!table) return;
      const current = getEffects();
      onUpdate([
        ...current,
        {
          type: table.type,
          params: Object.fromEntries(
            table.params.map((p) => [p.key, p.default]),
          ),
        },
      ]);
    },
  });

  if (effects.length > 0 && onSaveAsPreset) {
    fields.push({
      key: "save-chain-preset",
      label: "Save chain as preset…",
      kind: "button",
      onClick: () => {
        const name = window.prompt("Name this effect chain preset:");
        if (!name?.trim()) return;
        onSaveAsPreset(getEffects(), name.trim());
      },
    });
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
  /** Sample assignment now happens entirely through the main-page Sample
   * Library panel (select a row, click a sample there) -- this file no
   * longer does any loading/browsing UI itself, just shows what's already
   * loaded. Synchronous, mirrors getSelectedRow's own "render is sync,
   * can't await here" reasoning. */
  getCurrentSampleName?: (row: Row) => string | undefined;
  /** Row panel's "Save as instrument preset..." button -- prompts for a
   * name itself (a row-panel-local UI action, same as the old "Load
   * sample..." button opening its own file picker), then hands the
   * row's current sourceType/params/envelope to main.ts to persist. */
  onSaveInstrumentPreset?: (row: Row, name: string) => Promise<void>;
  /** effectsFields' own "Save chain as preset..." button, for the row
   * and cell panels' Effects sections -- same reasoning as
   * onSaveInstrumentPreset, just for a chain instead of a source's
   * params/envelope. The master panel's own Effects section is built
   * directly in main.ts, which already has its own save function in
   * scope with no need for this indirection. */
  onSaveEffectChainPreset?: (
    effects: EffectSpec[],
    name: string,
  ) => Promise<void>;
  /** Fired whenever the selection changes (including to/from null) --
   * main.ts's own library panels need to know when to re-render their
   * "does this match the selected row" state, which nothing else here
   * tells them about. */
  onSelectionChange?: (row: Row | null) => void;
}

export interface GridViewHandle {
  render(): void;
  refreshPlayhead(): void;
  selectMaster(): void;
  /** The currently-selected row, if any -- main.ts's own library panels
   * (outside this file entirely) need this to know which row a library
   * click should target. */
  getSelectedRow(): Row | null;
  /** Read/write access to whatever's currently selected own effects
   * chain, if it has one -- unlike samples/instrument presets (row-only),
   * effect chains apply uniformly at row/cell/master, so the Effect
   * Library panel needs this broader accessor instead of getSelectedRow.
   * null for a column selection or nothing selected (columns have no
   * effects chain), and for a cell selection on a non-samplePlayer row
   * (cell effect overrides only exist for sample rows, see cellPanel). */
  getSelectedEffectsTarget(): {
    getEffects: () => EffectSpec[];
    setEffects: (next: EffectSpec[]) => void;
  } | null;
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
    options.onSelectionChange?.(getSelectedRow());
  }

  function getSelectedRow(): Row | null {
    if (selection?.kind !== "row") return null;
    return model.getRow(selection.rowId) ?? null;
  }

  function getSelectedEffectsTarget(): {
    getEffects: () => EffectSpec[];
    setEffects: (next: EffectSpec[]) => void;
  } | null {
    if (selection?.kind === "row") {
      const row = model.getRow(selection.rowId);
      if (!row) return null;
      return {
        getEffects: () => model.getRow(row.id)?.config.effects ?? [],
        setEffects: (next) => model.setRowEffects(row, next),
      };
    }
    if (selection?.kind === "cell") {
      const row = model.getRow(selection.rowId);
      if (!row || row.config.sourceType !== "samplePlayer") return null;
      const columnIndex = selection.columnIndex;
      return {
        getEffects: () => row.cells[columnIndex]?.effects ?? [],
        setEffects: (next) => {
          // Applying a chain preset to a cell whose own override is off
          // would otherwise change nothing visible -- it'd just sit
          // unused under the row's own chain until someone remembers to
          // flip the override separately, which reads as "nothing
          // happened" from the library panel's own click.
          model.setCell(row, columnIndex, {
            effects: next,
            effectsOverride: true,
          });
        },
      };
    }
    if (selection?.kind === "master") {
      return {
        getEffects: () => model.getMasterEffects(),
        setEffects: (next) => model.setMasterEffects(next),
      };
    }
    return null;
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
      // Sample assignment happens via the main-page Sample Library panel
      // now (select this row, click a sample there) -- this just shows
      // what's already loaded. See GridViewOptions.getCurrentSampleName.
      fields.push({
        key: "currentSample",
        label: "Sample",
        kind: "text",
        value: options.getCurrentSampleName?.(row) ?? "(none)",
        readOnly: true,
        onChange: () => {},
      });
    }

    fields.push({
      key: "saveInstrumentPreset",
      label: "Save as instrument preset…",
      kind: "button",
      onClick: () => {
        const name = window.prompt("Name this instrument preset:");
        if (!name?.trim()) return;
        options.onSaveInstrumentPreset?.(row, name.trim());
      },
    });

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

    return {
      title: `Row: ${row.config.name}`,
      fields,
      sections: [
        {
          title: "Defaults",
          toggle: {
            active: row.config.defaultsOverride,
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
            // Unlike a checkbox/range's own value, adding or removing a
            // whole effect instance changes *which fields exist at all*
            // -- fields.ts's controls only echo their own value locally
            // (see its own top comment), so this needs an explicit
            // render() to show the new/removed block, not just update it.
            (next) => {
              model.setRowEffects(row, next);
              render();
            },
            options.onSaveEffectChainPreset,
          ),
        },
      ],
    };
  }

  function columnPanel(columnIndex: number): PanelContent {
    const column = model.columns[columnIndex];
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
          (next) => {
            model.setCell(row, columnIndex, { effects: next });
            render();
          },
          options.onSaveEffectChainPreset,
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
    // "selection-panel", not just "config-panel" -- the latter is a
    // shared *styling* class (background/border/padding) the new Sample/
    // Instrument Library panels also reuse (see index.html), so it alone
    // no longer uniquely identifies this one dynamic row/column/cell/
    // master panel.
    panel.className = "config-panel selection-panel";
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
    getSelectedRow,
    getSelectedEffectsTarget,
  };
}
