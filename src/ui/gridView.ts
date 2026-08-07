import type { EffectSpec } from "bruit-kit/audio";
import {
  EFFECT_TABLE,
  type Field,
  activeRangeFor,
  createDragPaint,
  effectsFields,
  renderFields,
} from "bruit-kit/ui";
import type { EnvelopeParams } from "../grid/config";
import { startDriftEngine } from "../grid/driftEngine";
import type { GridModel, Row } from "../grid/gridModel";
import { SOURCE_TYPE_LABELS, type SourceType } from "../grid/sourceFactory";
import {
  TRIGGER_MODE_LABELS,
  type TriggerModeKind,
} from "../grid/triggerModes";

/** The "+" cell's own popup (see render()'s grid-corner-column cell
 * appended right after the last row) -- collects a source type + name
 * for a new row, same two fields the old always-visible add-row form
 * used to keep permanently on screen below the grid. */
function openAddRowModal(
  onAdd: (sourceType: SourceType, name: string) => void,
): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const modal = document.createElement("div");
  modal.className = "modal param-range-modal";
  overlay.appendChild(modal);

  function close(): void {
    overlay.remove();
  }
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  const header = document.createElement("div");
  header.className = "modal-header";
  const title = document.createElement("span");
  title.className = "modal-title";
  title.textContent = "Add row";
  const closeButton = document.createElement("button");
  closeButton.textContent = "×";
  closeButton.className = "modal-close-button";
  closeButton.addEventListener("click", close);
  header.append(title, closeButton);
  modal.appendChild(header);

  const body = document.createElement("div");
  body.className = "modal-body";
  modal.appendChild(body);

  const sourceTypes = Object.keys(SOURCE_TYPE_LABELS) as SourceType[];
  let sourceType: SourceType = sourceTypes[0];
  let name = "";

  renderFields(body, [
    {
      key: "sourceType",
      label: "Type",
      kind: "select",
      value: sourceType,
      options: sourceTypes.map((type) => ({
        value: type,
        label: SOURCE_TYPE_LABELS[type],
      })),
      onChange: (v) => {
        sourceType = v as SourceType;
      },
    },
    {
      key: "name",
      label: "Name",
      kind: "text",
      value: name,
      onChange: (v) => {
        name = v;
      },
    },
  ]);

  const footer = document.createElement("div");
  footer.className = "modal-footer";
  const addButton = document.createElement("button");
  addButton.textContent = "Add";
  addButton.addEventListener("click", () => {
    onAdd(sourceType, name.trim() || SOURCE_TYPE_LABELS[sourceType]);
    close();
  });
  footer.appendChild(addButton);
  modal.appendChild(footer);

  document.body.appendChild(overlay);
}

/** Sidechain-style ducking (see RowConfig.duck's own doc): the target-row
 * select is the only enable/disable gate -- "(None)" clears the whole
 * relationship, any other row sets one up (creating it with sensible
 * defaults if this is the first time). No section-level toggle the way
 * Envelope/Effects use one: a second on/off control alongside "(None)"
 * would just be two ways to say the same thing. Amount/attack/release
 * stay visible and interactive even at "(None)" (this file's usual "never
 * conditionally hide a field based on another field's value" rule --
 * see the Filter effect's own gain param for the same reasoning) --
 * adjusting them pre-selects values a target choice will pick up, rather
 * than being disabled dead weight until one exists. None of these four
 * fields call render(): none of them change *which* fields exist, just
 * their values (same reasoning as e.g. Playback mode's own select just
 * above in rowPanel), so fields.ts's own local live-readout is enough. */
function duckFields(row: Row, model: GridModel): Field[] {
  const defaults = {
    targetRowName: "",
    amount: 0.6,
    attackMs: 5,
    releaseMs: 200,
  };
  // For the fields' own initial displayed values only -- render() isn't
  // called after any of these fields commit (see this function's own
  // top doc), so `current` here would otherwise go stale the moment a
  // sibling field's own update() ran, e.g. picking a target then
  // dragging Amount with no render in between would still close over
  // "no target" and silently clear the very selection just made. update()
  // re-reads model.getRow fresh instead, same reasoning as effectsFields'
  // own getEffects()-called-inside-every-handler.
  const current = row.config.duck ?? defaults;
  const update = (patch: Partial<typeof defaults>): void => {
    const latest = model.getRow(row.id)?.config.duck ?? defaults;
    const next = { ...latest, ...patch };
    model.setRowDuck(row, next.targetRowName ? next : undefined);
  };

  return [
    {
      key: "duck-target",
      label: "Duck target row",
      kind: "select",
      value: current.targetRowName,
      options: [
        { value: "", label: "(None)" },
        ...model
          .getRows()
          .filter((r) => r.id !== row.id)
          .map((r) => ({ value: r.config.name, label: r.config.name })),
      ],
      onChange: (v) => update({ targetRowName: v }),
    },
    {
      key: "duck-amount",
      label: "Amount",
      kind: "range",
      value: current.amount,
      min: 0,
      max: 1,
      step: 0.01,
      indented: true,
      onChange: (v) => update({ amount: v }),
    },
    {
      key: "duck-attack",
      label: "Attack (ms)",
      kind: "range",
      value: current.attackMs,
      min: 0,
      max: 50,
      step: 1,
      indented: true,
      onChange: (v) => update({ attackMs: v }),
    },
    {
      key: "duck-release",
      label: "Release (ms)",
      kind: "range",
      value: current.releaseMs,
      min: 10,
      max: 1000,
      step: 10,
      indented: true,
      onChange: (v) => update({ releaseMs: v }),
    },
  ];
}

/** Duck's sibling section -- same shape and same stale-closure fix as
 * duckFields (see its own top comment): update() re-reads
 * model.getRow fresh instead of trusting the `current` snapshot, since
 * no render() happens between two fields committed back to back. */
function callResponseFields(row: Row, model: GridModel): Field[] {
  const defaults = {
    targetRowName: "",
    probability: 0.5,
    delaySeconds: 0,
  };
  const current = row.config.callResponse ?? defaults;
  const update = (patch: Partial<typeof defaults>): void => {
    const latest = model.getRow(row.id)?.config.callResponse ?? defaults;
    const next = { ...latest, ...patch };
    model.setRowCallResponse(row, next.targetRowName ? next : undefined);
  };

  return [
    {
      key: "call-response-target",
      label: "Response target row",
      kind: "select",
      value: current.targetRowName,
      options: [
        { value: "", label: "(None)" },
        ...model
          .getRows()
          .filter((r) => r.id !== row.id)
          .map((r) => ({ value: r.config.name, label: r.config.name })),
      ],
      onChange: (v) => update({ targetRowName: v }),
    },
    {
      key: "call-response-probability",
      label: "Probability",
      kind: "range",
      value: current.probability,
      min: 0,
      max: 1,
      step: 0.01,
      indented: true,
      onChange: (v) => update({ probability: v }),
    },
    {
      key: "call-response-delay",
      label: "Delay (ms)",
      kind: "range",
      value: current.delaySeconds * 1000,
      min: 0,
      max: 1000,
      step: 5,
      indented: true,
      onChange: (v) => update({ delaySeconds: v / 1000 }),
    },
  ];
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

/** Everything about "what does this row sound like" -- source-specific
 * params, samplePlayer's own playback-mode toggles, envelope, sample
 * assignment/trim, and the pre-effects default-gain cascade fallback --
 * all of which apply to (or inside) the source's own voice before this
 * row's effects chain ever sees the signal. Launched from a button
 * labeled with the row's own source type (see rowPanel); everything
 * else about a row (sequencing, effects, output level, cross-row
 * interactions) stays in the main panel behind it.
 *
 * Re-reads model.getRow(row.id) fresh at the top of every renderBody()
 * call rather than trusting the `row` param across the popup's whole
 * lifetime -- same staleness reasoning as duckFields' own update(): this
 * row's config can already be stale by the time the button that opened
 * this popup was clicked (a continuous control edited just before with
 * no render() in between), and once open, every toggle inside the popup
 * itself re-renders the same way. If the row's gone by the time a
 * refresh happens (removed from behind the popup -- can't happen through
 * this app's own UI today since the modal overlay blocks the row's own
 * trash-icon button, but cheap to guard anyway), the popup just closes
 * instead of rendering a stale/broken body. */
function openInstrumentModal(
  row: Row,
  model: GridModel,
  options: GridViewOptions,
): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const modal = document.createElement("div");
  modal.className = "modal instrument-modal";
  overlay.appendChild(modal);

  function close(): void {
    overlay.remove();
  }
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  const header = document.createElement("div");
  header.className = "modal-header";
  const title = document.createElement("span");
  title.className = "modal-title";
  title.textContent = `Instrument: ${SOURCE_TYPE_LABELS[row.config.sourceType]}`;
  const closeButton = document.createElement("button");
  closeButton.textContent = "×";
  closeButton.className = "modal-close-button";
  closeButton.addEventListener("click", close);
  header.append(title, closeButton);
  modal.appendChild(header);

  const body = document.createElement("div");
  body.className = "modal-body";
  modal.appendChild(body);

  const footer = document.createElement("div");
  footer.className = "modal-footer";
  // Leftmost -- "try it" reads before "commit it", same left-to-right
  // ordering as patchModal's own New/Load/Save. Fires one voice with
  // whatever's currently set (source params, envelope, effects) right
  // now, independent of the sequencer -- see GridModel.previewRow's own
  // doc for why it always fires regardless of this row's mute/solo state.
  const previewButton = document.createElement("button");
  previewButton.textContent = "Preview";
  previewButton.addEventListener("click", () => {
    const current = model.getRow(row.id);
    if (current) model.previewRow(current);
  });
  footer.appendChild(previewButton);
  if (row.source.needsSample && options.onSwapSample) {
    const swapButton = document.createElement("button");
    swapButton.textContent = "Swap sample";
    swapButton.title = "Assign a random other sample from the same category";
    swapButton.addEventListener("click", async () => {
      const current = model.getRow(row.id);
      if (!current) return;
      await options.onSwapSample?.(current);
      renderBody();
    });
    footer.appendChild(swapButton);
  }
  const savePresetButton = document.createElement("button");
  savePresetButton.textContent = "Save as instrument preset…";
  savePresetButton.addEventListener("click", () => {
    const current = model.getRow(row.id);
    if (!current) return;
    const name = window.prompt("Name this instrument preset:");
    if (!name?.trim()) return;
    options.onSaveInstrumentPreset?.(current, name.trim());
  });
  footer.appendChild(savePresetButton);
  modal.appendChild(footer);

  function renderBody(): void {
    const current = model.getRow(row.id);
    if (!current) {
      close();
      return;
    }

    const fields: Field[] = [];

    if (current.config.sourceType === "samplePlayer") {
      fields.push({
        key: "playbackMode",
        label: "Playback",
        kind: "select",
        value: current.config.playbackMode,
        options: ["direct", "pitched"],
        onChange: (v) => {
          model.setRowPlaybackMode(current, v as "direct" | "pitched");
          renderBody();
        },
      });
      // Non-destructive -- flips playback direction of whatever sample's
      // loaded (or the next one assigned), leaves the library file alone.
      // See the Manage Library page's own "Reverse" for the permanent,
      // destructive version.
      fields.push({
        key: "reversed",
        label: "Reverse playback",
        kind: "checkbox",
        value: current.config.reversed,
        onChange: (v) => model.setRowReversed(current, v),
      });
      // Every hit starts from wherever a virtual scan position has
      // advanced to since this row's last one -- see
      // RowConfig.continuePlayback's own doc. No renderBody() needed:
      // toggling this doesn't change which fields exist, just future
      // firing behavior.
      fields.push({
        key: "continuePlayback",
        label: "Continue from last position",
        kind: "checkbox",
        value: current.config.continuePlayback,
        onChange: (v) => model.setRowContinuePlayback(current, v),
      });
    }

    const sourceParams = current.source.getParams();
    for (const field of current.source.paramFields) {
      const value = sourceParams[field.key] ?? field.default;
      if (field.kind === "select") {
        fields.push({
          key: field.key,
          label: field.label,
          kind: "select",
          value: String(value),
          options: field.options ?? [],
          onChange: (v) => current.source.setParams({ [field.key]: v }),
        });
      } else {
        fields.push({
          key: field.key,
          label: field.label,
          kind: "range",
          value: Number(value),
          min: field.min ?? 0,
          max: field.max ?? 1,
          step: field.step ?? 0.01,
          onChange: (v) => current.source.setParams({ [field.key]: v }),
        });
      }
    }

    if (current.source.needsSample) {
      // Sample assignment happens via the main-page Sample Library panel
      // now (select this row, click a sample there) -- this just shows
      // what's already loaded. See GridViewOptions.getCurrentSampleName.
      fields.push({
        key: "currentSample",
        label: "Sample",
        kind: "text",
        value: options.getCurrentSampleName?.(current) ?? "(none)",
        readOnly: true,
        onChange: () => {},
      });
    }

    if (current.config.sourceType === "samplePlayer") {
      const buffer = model.getRowSampleBuffer(current);
      if (buffer) {
        fields.push({
          key: "sampleRange",
          label: "Playback range (drag handles to trim)",
          kind: "waveformRange",
          buffer,
          range: current.config.sampleRange,
          onChange: (range) => model.setRowSampleRange(current, range),
        });
      }
    }

    body.innerHTML = "";
    renderPanelSections(body, fields, [
      {
        title: "Envelope",
        toggle: {
          // Disabled (and forced on) while this row already wins the
          // global Row/column precedence race -- see
          // RowConfig.defaultsOverride's own doc for why toggling a
          // winning side's own Override can't change an outcome it
          // already controls; only the column's own Override (in the
          // column panel) can flip this row's envelope in that case.
          active: model.precedence === "row" || current.config.envelopeOverride,
          disabled: model.precedence === "row",
          onClick: () => {
            model.setRowEnvelopeOverride(
              current,
              !current.config.envelopeOverride,
            );
            renderBody();
          },
        },
        fields: envelopeFields(current.config.envelope, (points) =>
          model.setRowEnvelope(current, points),
        ),
      },
      {
        // Scales envelopeGain, the same pre-effects node Envelope above
        // drives -- see RowConfig.defaultGainOverride's own doc for why
        // this lives here instead of the main panel's Output section
        // alongside Send/Pan/Level.
        title: "Default gain",
        toggle: {
          active: model.precedence === "row" || current.config.defaultGainOverride,
          disabled: model.precedence === "row",
          onClick: () => {
            model.setRowDefaultGainOverride(
              current,
              !current.config.defaultGainOverride,
            );
            renderBody();
          },
        },
        fields: [
          {
            key: "defaultGain",
            label: "Default gain",
            kind: "range",
            value: current.config.defaultGain,
            min: 0,
            max: 1,
            step: 0.01,
            onChange: (v) => model.setRowDefaultGain(current, v),
          },
        ],
      },
    ]);
  }

  renderBody();
  document.body.appendChild(overlay);
}

export interface PanelSection {
  title: string;
  fields: Field[];
  toggle?: { active: boolean; disabled?: boolean; onClick: () => void };
}

interface PanelContent {
  title: string;
  fields: Field[];
  sections: PanelSection[];
  /** Only rowPanel sets this -- master/column/cell selections have no
   * equivalent single "delete the thing I'm looking at" action (a column
   * or cell isn't a discrete object to remove, and Master isn't
   * removable at all). Rendered as a trash-icon button at the far right
   * of the panel's own title row (see render()). */
  onRemove?: () => void;
  /** Only rowPanel sets this too, same reasoning as onRemove -- "make an
   * independent copy of the thing I'm looking at" is meaningless for
   * Master/a column/a cell (a cell's own copy-elsewhere concept, if it
   * ever existed, wouldn't be this). Rendered as a second title-row icon
   * button, left of Remove. Async since it goes through model.addRow
   * (awaits a source's own init, see GridModel's doc) via main.ts's
   * duplicateRow, same as the "+" row's onAddRow. */
  onDuplicate?: () => Promise<void>;
}

/** Renders a flat fields body (if any) followed by every titled,
 * optionally toggle-gated section -- shared by render()'s own row/column/
 * cell/master panel and openInstrumentModal's popup body, which needs the
 * exact same fields-then-sections shape (Envelope, Default gain) inside a
 * modal instead of the side panel. Appends into `container`, doesn't clear
 * it first -- callers own their own container's lifecycle (render() tears
 * down and rebuilds the whole panel every call; the modal's own
 * renderBody() clears its body div before calling this). */
function renderPanelSections(
  container: HTMLElement,
  fields: Field[],
  sections: PanelSection[],
): void {
  if (fields.length > 0) {
    const body = document.createElement("div");
    body.className = "panel-body";
    renderFields(body, fields);
    container.appendChild(body);
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
        ? "Already wins by the global row/column precedence setting, so its values apply automatically -- to use the other side's values instead, turn on its own Override there."
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

    container.appendChild(sectionEl);
  }
}

type Selection =
  | { kind: "row"; rowId: string }
  | { kind: "column"; columnIndex: number }
  | { kind: "cell"; rowId: string; columnIndex: number }
  | { kind: "master" }
  | null;

export interface GridViewOptions {
  buildMasterFields: () => Field[];
  /** Titled sections for the Master panel -- currently just "Effects"
   * (the master bus's own insert chain, applied to everything) and "Send
   * Bus" (an arbitrary chain fed by each row's own Send level, see
   * config.ts's RowConfig.sendLevel doc). Kept as titled PanelSections
   * rather than flat fields specifically so the two chains' "Add
   * effect…"/param blocks read as visually distinct groups instead of
   * one confusing run-on list. */
  buildMasterSections: () => PanelSection[];
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
  /** The "+" cell's own popup (see openAddRowModal) -- main.ts owns
   * actually creating the row (model.addRow, auto-loading a placeholder
   * sample, its own view.render()), this file just collects sourceType/
   * name and hands them off. */
  onAddRow?: (sourceType: SourceType, name: string) => Promise<void>;
  /** Row panel's own Duplicate button (see PanelContent.onDuplicate) --
   * same "this file collects the request, main.ts owns actually doing
   * it" split as onAddRow. main.ts builds the copy (config, cells,
   * source params, loaded sample -- see patch.ts's duplicateRow) and
   * selects it afterward via selectRow so the new copy is what's open
   * for editing next, not left on the original. */
  onDuplicateRow?: (row: Row) => Promise<void>;
  /** Instrument popup's "Swap sample" button (samplePlayer rows only) --
   * this file has no notion of the sample library itself (see
   * getCurrentSampleName's own doc), so main.ts picks a random other
   * sample sharing the row's current category and assigns it. */
  onSwapSample?: (row: Row) => Promise<void>;
}

export interface GridViewHandle {
  render(): void;
  refreshPlayhead(): void;
  selectMaster(): void;
  /** Selects a row by id -- used after onDuplicateRow builds a copy, so
   * the newly duplicated row is what's open in the panel next, not left
   * on whichever row was selected when Duplicate was clicked. A stale/
   * unknown id is the same as any other selection of a since-removed
   * row (see getSelectedRow's own null fallback in panelContent) --
   * silently resolves to nothing selected, not an error. */
  selectRow(rowId: string): void;
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
    /** Same wording as the panel's own title ("Row: Kick", "Cell: Kick ×
     * col 5", "Master") -- so a caller confirming an action against this
     * target (e.g. the Effect Library's replace/add prompt) can name it
     * without re-deriving that format itself. */
    label: string;
    getEffects: () => EffectSpec[];
    setEffects: (next: EffectSpec[]) => void;
  } | null;
  /** Nudges every row's own knobs (defaults, pan/level/send, effect
   * params), a fraction of each row's steps, and the master/send-bus
   * chains -- all a little, all at once, from wherever they currently
   * sit (not fresh random draws) -- see its own doc above
   * createGridView's return statement for exactly what moves and by how
   * much. One click = one small step away from the current patch;
   * clicking repeatedly wanders further, same as nothing stops clicking
   * a "reroll" button twice. No Amount knob -- undo/redo is the walk-
   * back mechanism instead of a dial to get right in advance. */
  moreLikeThis(): void;
}

export function createGridView(
  container: HTMLElement,
  model: GridModel,
  options: GridViewOptions,
): GridViewHandle {
  let selection: Selection = null;
  let cellEls: HTMLDivElement[][] = [];

  // Click-and-drag paint across the grid's toggle cells -- see
  // dragPaint.ts's own doc for the gesture this implements.
  const cellDragPaint = createDragPaint<string>();

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
    label: string;
    getEffects: () => EffectSpec[];
    setEffects: (next: EffectSpec[]) => void;
  } | null {
    if (selection?.kind === "row") {
      const row = model.getRow(selection.rowId);
      if (!row) return null;
      return {
        label: `Row: ${row.config.name}`,
        getEffects: () => model.getRow(row.id)?.config.effects ?? [],
        setEffects: (next) => model.setRowEffects(row, next),
      };
    }
    if (selection?.kind === "cell") {
      const row = model.getRow(selection.rowId);
      if (!row || row.config.sourceType !== "samplePlayer") return null;
      const columnIndex = selection.columnIndex;
      return {
        label: `Cell: ${row.config.name} × col ${columnIndex + 1}`,
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
        label: "Master",
        getEffects: () => model.getMasterEffects(),
        setEffects: (next) => model.setMasterEffects(next),
      };
    }
    return null;
  }

  function rowPanel(row: Row): PanelContent {
    // Enabled (mute) and Solo are both already reachable outside this
    // panel -- clicking a row's own header toggles mute, and its "S"
    // button toggles solo (see render()'s rowMaster/soloButton click
    // handlers) -- so they don't need a redundant copy of the same
    // control in here too.
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
    ];

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

    // Everything about what this row actually sounds like (source
    // params, envelope, sample assignment/trim, the pre-effects default-
    // gain fallback) lives behind this button instead of cluttering the
    // main panel -- see openInstrumentModal's own doc. Labeled with the
    // row's own source type so it reads as "configure the instrument,"
    // not a generic settings button -- plus the current sample name for
    // samplePlayer rows, since otherwise there's no way to tell whether
    // one's actually assigned without opening the popup.
    const instrumentLabel = row.source.needsSample
      ? options.getCurrentSampleName?.(row)
      : undefined;
    fields.push({
      key: "openInstrument",
      label: instrumentLabel
        ? `${SOURCE_TYPE_LABELS[row.config.sourceType]}: ${instrumentLabel}…`
        : `${SOURCE_TYPE_LABELS[row.config.sourceType]}…`,
      kind: "button",
      preserveCase: true,
      onClick: () => {
        // Not the `row` param directly -- same staleness reasoning as
        // onDuplicate below (a continuous control edited just before this
        // button was clicked, with no render() in between, would leave
        // `row` stale). openInstrumentModal re-reads model.getRow(row.id)
        // again itself on every internal render too, this first read is
        // just to seed the modal with an id that's confirmed to exist.
        const current = model.getRow(row.id);
        if (current) openInstrumentModal(current, model, options);
      },
    });

    return {
      title: `Row: ${row.config.name}`,
      fields,
      // Rendered as a trash icon at the far right of the panel's own
      // title row (see render()'s heading), not a field in the body --
      // "remove this row" reads as a title-bar action (same place a
      // window's own close button lives), not one more setting in a
      // list of them, and it's now reachable without scrolling down
      // through every section below to find it.
      onRemove: () => {
        model.removeRow(row);
        select(null);
      },
      onDuplicate: options.onDuplicateRow
        ? async () => {
            // Not the `row` param directly -- it's a snapshot from
            // whenever this panel was last rendered, and continuous
            // controls (the envelope editor's drag, every plain slider)
            // deliberately don't re-render on every edit (see fields.ts's
            // own top comment), so `row.config` here can be stale by the
            // time Duplicate is actually clicked. model.getRow re-reads
            // the live current config, same reasoning as effectsFields'
            // own getEffects()-called-fresh-in-every-handler.
            const current = model.getRow(row.id);
            if (current) await options.onDuplicateRow?.(current);
          }
        : undefined,
      sections: [
        {
          // Note/nudge only now -- defaultGain has its own override flag
          // and lives in the Instrument popup instead (see
          // RowConfig.defaultGainOverride's own doc). These two stay here
          // since they're sequencer/cascade concerns, independent of the
          // instrument, same category as Trigger mode above.
          title: "Defaults",
          toggle: {
            // Disabled (and forced on) while this row already wins the
            // global Row/column precedence race -- an override here
            // can't change an outcome it already controls; only the
            // column's own Override (in the column panel) can flip
            // this row's note/nudge default in that case. See
            // RowConfig.defaultsOverride's own doc.
            active: model.precedence === "row" || row.config.defaultsOverride,
            disabled: model.precedence === "row",
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
              key: "timeShift",
              label: "Default nudge (ms)",
              kind: "range",
              value: row.config.defaultTimeShiftSeconds * 1000,
              min: -100,
              max: 100,
              step: 5,
              onChange: (v) => model.setRowDefaultTimeShift(row, v / 1000),
            },
            {
              // Unlike its two siblings above, not gated by this
              // section's own Override toggle -- see
              // RowConfig.probability's own doc for why: it's a per-tick
              // firing gate applied to every armed cell, not a cascade
              // fallback for cells with no value of their own, so tying
              // it to "does my default note/nudge apply" would silently
              // change how often hand-set cells fire. Grouped here
              // visually anyway since it's still a row-level default.
              key: "probability",
              label: "Probability",
              kind: "range",
              value: row.config.probability,
              min: 0,
              max: 1,
              step: 0.01,
              onChange: (v) => model.setRowProbability(row, v),
            },
            {
              // Shuffles which steps are on, not how many -- a Fisher-
              // Yates permutation of this row's own on/off flags, so a
              // busy row stays busy and a sparse one stays sparse, just
              // rearranged. Only touches `on`; a step's own note/gain/
              // gate/time-shift overrides (if any) stay put and travel
              // with their column index, not with wherever their "on"
              // flag ends up.
              key: "rerollPattern",
              label: "Reroll pattern",
              kind: "button",
              onClick: () => {
                const current = model.getRow(row.id);
                if (!current) return;
                const flags = current.cells.map((c) => c.on);
                for (let i = flags.length - 1; i > 0; i--) {
                  const j = Math.floor(Math.random() * (i + 1));
                  [flags[i], flags[j]] = [flags[j], flags[i]];
                }
                flags.forEach((on, i) => model.setCell(current, i, { on }));
                render();
              },
            },
          ],
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
            (next) => model.setRowEffects(row, next),
            options.onSaveEffectChainPreset,
            true,
          ),
        },
        {
          // Everything here is downstream of the effects chain (duckGain
          // -> panNode -> levelNode -> master/send, see addRow) -- a
          // channel-strip mixer group, not an insert effect.
          title: "Output",
          fields: [
            {
              key: "sendLevel",
              label: "Send",
              kind: "range",
              value: row.config.sendLevel,
              min: 0,
              max: 1,
              step: 0.01,
              onChange: (v) => model.setRowSendLevel(row, v),
            },
            {
              key: "pan",
              label: "Pan (L -1 .. 1 R)",
              kind: "range",
              value: row.config.pan,
              min: -1,
              max: 1,
              step: 0.01,
              onChange: (v) => model.setRowPan(row, v),
            },
            {
              key: "level",
              label: "Level",
              kind: "range",
              value: row.config.level,
              min: 0,
              max: 1.5,
              step: 0.01,
              onChange: (v) => model.setRowLevel(row, v),
            },
          ],
        },
        {
          // Duck and Call & Response together -- neither touches this
          // row's own signal or its instrument, both are "when I fire,
          // do something to a different row" behaviors, so they share one
          // section instead of the mixer/instrument split above.
          title: "Interaction",
          fields: [...duckFields(row, model), ...callResponseFields(row, model)],
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
            // Disabled (and forced on) while this column already wins
            // the global Row/column precedence race -- see
            // RowConfig.defaultsOverride's own doc for the row-side
            // equivalent; only a row's own Override (in that row's
            // panel) can flip this column's note/gain/nudge default in
            // that case. Doesn't gate Default gate below -- see
            // ColumnConfig.defaultGateOverride's own doc for why that
            // one's independent of precedence entirely.
            active: model.precedence === "column" || column.defaultsOverride,
            disabled: model.precedence === "column",
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
              // Its own independent toggle, not part of the section's
              // shared one -- a row has no gate default of its own to
              // race against (see ColumnConfig.defaultGateOverride's own
              // doc), so unlike note/gain/nudge above, this is never
              // disabled by precedence and needs its own on/off state
              // instead of inheriting the section's.
              key: "defaultGate",
              label: "Default gate",
              kind: "override",
              overridden: column.defaultGateOverride,
              value: column.defaultGate,
              min: 0,
              max: 4,
              step: 0.05,
              onToggle: (on) =>
                model.setColumn(columnIndex, { defaultGateOverride: on }),
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
            active: model.precedence === "column" || column.envelopeOverride,
            disabled: model.precedence === "column",
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
          (next) => model.setCell(row, columnIndex, { effects: next }),
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
        sections: options.buildMasterSections(),
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
    // Whether *any* row is soloed right now -- drives every non-soloed
    // row's dimmed-by-solo look, distinct from that row's own mute state
    // (see fireTick's identical soloActive check for the audio side).
    const soloActive = rows.some((r) => r.isSoloed());
    for (const row of rows) {
      const rowMaster = document.createElement("div");
      const rowSelected =
        selection?.kind === "row" && selection.rowId === row.id;
      const silencedBySolo = soloActive && !row.isSoloed();
      rowMaster.className = `master-cell row-master source-${row.config.sourceType}${row.config.enabled ? "" : " off"}${silencedBySolo ? " solo-dimmed" : ""}${rowSelected ? " selected" : ""}`;
      rowMaster.title = SOURCE_TYPE_LABELS[row.config.sourceType];
      rowMaster.addEventListener("click", () => {
        model.setRowEnabled(row, !row.config.enabled);
        render();
      });
      rowMaster.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        select({ kind: "row", rowId: row.id });
      });

      const rowMasterName = document.createElement("span");
      rowMasterName.className = "row-master-name";
      rowMasterName.textContent = row.config.name;
      rowMaster.appendChild(rowMasterName);

      const soloButton = document.createElement("button");
      soloButton.className = `solo-button${row.isSoloed() ? " active" : ""}`;
      soloButton.textContent = "S";
      soloButton.title = row.isSoloed() ? "Unsolo" : "Solo (isolate this row)";
      soloButton.addEventListener("click", (event) => {
        // Solo lives in the same cell as the mute-toggle click above --
        // stopPropagation so clicking S doesn't also flip mute.
        event.stopPropagation();
        model.setRowSolo(row, !row.isSoloed());
        render();
      });
      rowMaster.appendChild(soloButton);

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
        const cellKey = `${row.id}:${columnIndex}`;
        cellEl.addEventListener("mousedown", (event) => {
          if (event.button !== 0) return;
          // Not a native drag/text-selection gesture -- this is our own
          // paint gesture, not the browser's.
          event.preventDefault();
          cellDragPaint.start(cellKey, () => {
            model.setCell(row, columnIndex, { on: !cell.on });
            render();
          });
        });
        cellEl.addEventListener("mouseenter", () => {
          cellDragPaint.enter(cellKey, () => {
            model.setCell(row, columnIndex, { on: !cell.on });
            render();
          });
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

    // Grid auto-flow places this straight into column 1 of the next
    // implicit row -- directly under the last row's own label, no
    // manual row/column math needed -- with no cell divs following it,
    // so the rest of that row just stays empty. Replaces the old
    // always-visible add-row form (select + name input + button)
    // permanently on screen below the grid with a single affordance
    // that opens openAddRowModal instead.
    const addRowEl = document.createElement("div");
    addRowEl.className = "master-cell add-row-cell";
    addRowEl.textContent = "+";
    addRowEl.title = "Add row";
    addRowEl.addEventListener("click", () => {
      openAddRowModal((sourceType, name) => {
        options.onAddRow?.(sourceType, name);
      });
    });
    grid.appendChild(addRowEl);

    const panel = document.createElement("div");
    // "selection-panel", not just "config-panel" -- the latter is a
    // shared *styling* class (background/border/padding) the new Sample/
    // Instrument Library panels also reuse (see index.html), so it alone
    // no longer uniquely identifies this one dynamic row/column/cell/
    // master panel.
    panel.className = "config-panel selection-panel";
    const { title, fields, sections, onRemove, onDuplicate } =
      panelContent(rows);

    const heading = document.createElement("div");
    heading.className = "panel-title-row";
    const headingTitle = document.createElement("span");
    headingTitle.className = "panel-title";
    headingTitle.textContent = title;
    heading.appendChild(headingTitle);
    if (onDuplicate || onRemove) {
      // Grouped in their own container -- panel-title-row's own
      // space-between expects exactly two items (title, "everything
      // else"), not one per button spread individually across the row.
      const actions = document.createElement("div");
      actions.className = "panel-title-actions";
      if (onDuplicate) {
        const duplicateButton = document.createElement("button");
        duplicateButton.className = "panel-title-icon-button";
        duplicateButton.textContent = "⧉";
        duplicateButton.title = "Duplicate row";
        duplicateButton.addEventListener("click", () => {
          onDuplicate();
        });
        actions.appendChild(duplicateButton);
      }
      if (onRemove) {
        const removeButton = document.createElement("button");
        removeButton.className =
          "panel-title-icon-button panel-title-remove-button";
        removeButton.textContent = "🗑";
        removeButton.title = "Remove row";
        removeButton.addEventListener("click", onRemove);
        actions.appendChild(removeButton);
      }
      heading.appendChild(actions);
    }
    panel.appendChild(heading);

    if (fields.length === 0 && sections.length === 0 && selection === null) {
      const hint = document.createElement("p");
      hint.className = "panel-hint";
      hint.textContent =
        "Right-click a cell, a row label, or a column header to edit it here.";
      panel.appendChild(hint);
    } else {
      renderPanelSections(panel, fields, sections);
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

  // A fraction of each numeric effect param's own *active* range span
  // (activeRangeFor -- same custom-range-aware bound Drift/Reroll chain
  // already respect), applied as a random ± delta from wherever that
  // param currently sits, clamped back into range -- a nudge, not a
  // fresh draw. Select params (filter type, LFO shape, ...) are left
  // alone entirely: a "little" nudge shouldn't suddenly swap a lowpass
  // for a highpass, unlike Reroll chain's bigger, deliberate jump.
  const MORE_LIKE_THIS_EFFECT_NUDGE_FRACTION = 0.12;

  function nudgeEffects(effects: EffectSpec[]): EffectSpec[] {
    return effects.map((spec) => {
      const table = EFFECT_TABLE.find((e) => e.type === spec.type);
      if (!table) return spec;
      const nextParams: Record<string, number | string> = { ...spec.params };
      for (const param of table.params) {
        if (param.kind === "select") continue;
        const active = activeRangeFor(spec, param);
        const span = active.max - active.min;
        if (span <= 0) continue;
        const scale = param.scale ?? 1;
        const stored = spec.params[param.key];
        const storedDisplay =
          (typeof stored === "number" ? stored : param.default) * scale;
        const delta =
          (Math.random() * 2 - 1) * span * MORE_LIKE_THIS_EFFECT_NUDGE_FRACTION;
        const nextDisplay = Math.min(
          active.max,
          Math.max(active.min, storedDisplay + delta),
        );
        nextParams[param.key] = nextDisplay / scale;
      }
      return { ...spec, params: nextParams };
    });
  }

  // Same ± nudge shape as nudgeEffects above, just against each row-level
  // scalar's own sensible span instead of an effect param's active range
  // (rows have no per-field range concept to reuse the way effects do).
  // Setters that already clamp internally (setRowProbability, setRowPan)
  // are trusted to do that; the rest (no internal clamp -- see each
  // setter's own doc for why, e.g. setRowLevel's "values outside the
  // slider's own range are still musically meaningful") get a defensive
  // bound here instead, generous enough that repeated clicks can't drift
  // a value into something nonsensical (e.g. negative gain) but without
  // re-imposing the exact slider range those setters deliberately don't.
  function nudge(value: number, amount: number): number {
    return value + (Math.random() * 2 - 1) * amount;
  }

  function moreLikeThis(): void {
    for (const row of model.getRows()) {
      const c = row.config;
      model.setRowDefaultNote(
        row,
        Math.min(127, Math.max(0, Math.round(nudge(c.defaultNote, 3)))),
      );
      model.setRowDefaultGain(row, Math.min(1, Math.max(0, nudge(c.defaultGain, 0.12))));
      model.setRowDefaultTimeShift(
        row,
        Math.min(0.1, Math.max(-0.1, nudge(c.defaultTimeShiftSeconds, 0.01))),
      );
      model.setRowProbability(row, nudge(c.probability, 0.15));
      model.setRowPan(row, nudge(c.pan, 0.2));
      model.setRowLevel(row, Math.min(2, Math.max(0, nudge(c.level, 0.12))));
      model.setRowSendLevel(row, Math.min(1, Math.max(0, nudge(c.sendLevel, 0.12))));
      model.setRowEffects(row, nudgeEffects(c.effects));

      // A minority of steps flip -- small enough that a click or two
      // still reads as "the same groove," large enough to actually
      // notice; clicking repeatedly compounds toward something new.
      row.cells.forEach((cell, i) => {
        if (Math.random() < 0.12) model.setCell(row, i, { on: !cell.on });
      });
    }
    model.setMasterGain(
      Math.min(2, Math.max(0, nudge(model.masterGain.gain.value, 0.08))),
    );
    model.setMasterEffects(nudgeEffects(model.getMasterEffects()));
    model.setSendBusEffects(nudgeEffects(model.getSendBusEffects()));
    render();
  }

  render();
  startDriftEngine(model);
  return {
    render,
    refreshPlayhead,
    selectMaster: () => select({ kind: "master" }),
    selectRow: (rowId) => select({ kind: "row", rowId }),
    getSelectedRow,
    getSelectedEffectsTarget,
    moreLikeThis,
  };
}
