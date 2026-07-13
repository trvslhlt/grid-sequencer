/** Renders form fields into the always-visible config panel (see
 * gridView.ts) rather than a popup -- there's no "reopen the menu to see
 * it" step any more, so a field's presence in the layout should never
 * depend on some OTHER field's transient state. The one kind that needs
 * that relationship (an override checkbox gating a value control) is
 * handled as a single compound "override" field instead of two fields one
 * of which conditionally appears: the value control is always present,
 * just disabled while not overriding (see `renderOverrideField`).
 *
 * Continuous controls (kind "range" and the value half of "override")
 * manage their own live-updating text readout locally and never call back
 * into the caller from their "input" handler -- only from a committing
 * event (checkbox change, select change, blur). That split matters
 * mechanically: this panel sits in the same DOM subtree callers rebuild
 * wholesale on structural changes, and rebuilding a slider's own <input>
 * out from under an in-progress drag would abort the drag gesture. Fields
 * that don't need a full rebuild just don't trigger one. */

import {
  type AutomationPoint,
  type WaveformRange,
  createAutomationEditor,
  createWaveformRangeView,
} from "bruit-kit/ui";

export type Field =
  | {
      key: string;
      label: string;
      kind: "checkbox";
      value: boolean;
      onChange: (value: boolean) => void;
    }
  | {
      key: string;
      label: string;
      kind: "number";
      value: number;
      min?: number;
      max?: number;
      step?: number;
      onChange: (value: number) => void;
    }
  | {
      key: string;
      label: string;
      kind: "range";
      value: number;
      min: number;
      max: number;
      step: number;
      /** Right-aligns the whole row (label + control together) instead of
       * the usual label-left/control-right split -- for a group of fields
       * that already reads as visually subordinate to a heading field
       * above them (see gridView.ts's effectsFields), not a general
       * layout option every field needs. */
      indented?: boolean;
      onChange: (value: number) => void;
    }
  | {
      key: string;
      label: string;
      kind: "select";
      value: string;
      options: string[];
      indented?: boolean;
      onChange: (value: string) => void;
    }
  | {
      key: string;
      label: string;
      kind: "text";
      value: string;
      onChange: (value: string) => void;
    }
  | { key: string; label: string; kind: "button"; onClick: () => void }
  | {
      key: string;
      label: string;
      kind: "override";
      /** Whether this level currently sets its own value. This is the
       * *entire* override mechanism -- there's no separate sentinel value
       * (a magic -1, a 0 that can't otherwise occur) standing in for "not
       * set" the way earlier versions of this panel used. */
      overridden: boolean;
      /** Shown in the control either way: the override value when
       * `overridden`, otherwise the resolved/inherited value, so checking
       * the box starts from whatever's already in effect instead of
       * snapping to the control's minimum. */
      value: number;
      min: number;
      max: number;
      step: number;
      /** Normally the value control disables while unchecked -- there's
       * nothing to preview-and-edit if it isn't in effect. Some overrides
       * (a cell's own effects chain) are worth being able to dial in
       * *before* switching them on instead of starting from scratch under
       * time pressure; for those, set this and pair it with a dimmed
       * wrapper around the whole field instead (see gridView.ts's
       * cellFields) -- purely visual, the control stays interactive. */
      alwaysInteractive?: boolean;
      onToggle: (overridden: boolean) => void;
      onChange: (value: number) => void;
    }
  | {
      key: string;
      label: string;
      kind: "automation";
      /** A breakpoint curve (see bruit-kit's createAutomationEditor) --
       * the whole array is handed back on every drag/add/remove, not a
       * single value, so there's no separate "commit" event to split from
       * a live-preview one the way range/override fields do. */
      points: AutomationPoint[];
      onChange: (points: AutomationPoint[]) => void;
    }
  | {
      key: string;
      label: string;
      kind: "waveformRange";
      /** The decoded buffer to draw -- the caller only renders this field
       * once a sample is actually loaded (see gridView.ts's rowPanel),
       * since there's nothing to trim a range against before then. */
      buffer: AudioBuffer;
      range: WaveformRange;
      onChange: (range: WaveformRange) => void;
    };

function formatValue(value: number, step: number): string {
  const decimals = step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;
  return value.toFixed(decimals);
}

function renderRangeInput(
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (value: number) => void,
): { input: HTMLInputElement; valueEl: HTMLSpanElement } {
  const input = document.createElement("input");
  input.type = "range";
  // min/max/step *before* value: a range input's value-setting algorithm
  // clamps to whatever min/max/step are in effect at that moment, and the
  // browser defaults (min 0, max 100, step 1) are still active until
  // these are set -- assigning value first would silently snap any
  // fractional value to the nearest whole number.
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);

  const valueEl = document.createElement("span");
  valueEl.className = "field-value";
  valueEl.textContent = formatValue(value, step);

  input.addEventListener("input", () => {
    const v = Number(input.value);
    valueEl.textContent = formatValue(v, step);
    onInput(v);
  });

  return { input, valueEl };
}

function renderField(container: HTMLElement, field: Field): void {
  const row = document.createElement("div");
  row.className = "panel-field";

  if (field.kind === "button") {
    const button = document.createElement("button");
    button.textContent = field.label;
    button.addEventListener("click", field.onClick);
    row.appendChild(button);
    container.appendChild(row);
    return;
  }

  const label = document.createElement("label");
  label.textContent = field.label;
  row.appendChild(label);

  if (field.kind === "checkbox") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = field.value;
    input.addEventListener("change", () => field.onChange(input.checked));
    row.appendChild(input);
  } else if (field.kind === "select") {
    if (field.indented) row.classList.add("panel-field-indented");
    const select = document.createElement("select");
    for (const option of field.options) {
      const optionEl = document.createElement("option");
      optionEl.value = option;
      optionEl.textContent = option;
      optionEl.selected = option === field.value;
      select.appendChild(optionEl);
    }
    select.addEventListener("change", () => field.onChange(select.value));
    row.appendChild(select);
  } else if (field.kind === "text") {
    const input = document.createElement("input");
    input.type = "text";
    input.value = field.value;
    input.addEventListener("change", () => field.onChange(input.value));
    row.appendChild(input);
  } else if (field.kind === "range") {
    if (field.indented) row.classList.add("panel-field-indented");
    const { input, valueEl } = renderRangeInput(
      field.value,
      field.min,
      field.max,
      field.step,
      field.onChange,
    );
    row.appendChild(input);
    row.appendChild(valueEl);
  } else if (field.kind === "number") {
    const input = document.createElement("input");
    input.type = "number";
    if (field.min !== undefined) input.min = String(field.min);
    if (field.max !== undefined) input.max = String(field.max);
    if (field.step !== undefined) input.step = String(field.step);
    input.value = String(field.value);
    input.addEventListener("input", () => field.onChange(Number(input.value)));
    row.appendChild(input);
  } else if (field.kind === "automation") {
    row.classList.add("panel-field-wide");
    const editorEl = document.createElement("div");
    createAutomationEditor(editorEl, field.points, {
      onChange: field.onChange,
    });
    row.appendChild(editorEl);
  } else if (field.kind === "waveformRange") {
    row.classList.add("panel-field-wide");
    const viewEl = document.createElement("div");
    const view = createWaveformRangeView(viewEl, {
      initialRange: field.range,
      onChange: field.onChange,
    });
    view.setBuffer(field.buffer);
    row.appendChild(viewEl);
  } else {
    row.appendChild(renderOverrideControl(field));
  }

  container.appendChild(row);
}

function renderOverrideControl(
  field: Extract<Field, { kind: "override" }>,
): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "override-control";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = field.overridden;
  checkbox.title = "Override";

  const { input, valueEl } = renderRangeInput(
    field.value,
    field.min,
    field.max,
    field.step,
    field.onChange,
  );
  if (!field.alwaysInteractive) input.disabled = !field.overridden;

  checkbox.addEventListener("change", () => {
    if (!field.alwaysInteractive) input.disabled = !checkbox.checked;
    field.onToggle(checkbox.checked);
  });

  wrap.append(checkbox, input, valueEl);
  return wrap;
}

export function renderFields(container: HTMLElement, fields: Field[]): void {
  container.innerHTML = "";
  for (const field of fields) renderField(container, field);
}
