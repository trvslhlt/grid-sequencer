export type MenuField =
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
      onChange: (value: number) => void;
    }
  | {
      key: string;
      label: string;
      kind: "select";
      value: string;
      options: string[];
      onChange: (value: string) => void;
    }
  | {
      key: string;
      label: string;
      kind: "text";
      value: string;
      onChange: (value: string) => void;
    }
  | { key: string; label: string; kind: "button"; onClick: () => void };

let openMenuEl: HTMLDivElement | null = null;

function closeMenu(): void {
  openMenuEl?.remove();
  openMenuEl = null;
  document.removeEventListener("click", onOutsideClick, true);
  document.removeEventListener("keydown", onKeyDown, true);
}

function onOutsideClick(event: MouseEvent): void {
  if (openMenuEl && !openMenuEl.contains(event.target as Node)) closeMenu();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") closeMenu();
}

function renderField(container: HTMLElement, field: MenuField): void {
  const row = document.createElement("div");
  row.className = "menu-field";

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
  } else {
    const input = document.createElement("input");
    input.type = field.kind === "range" ? "range" : "number";
    // min/max/step *before* value: a range/number input's value-setting
    // algorithm clamps to whatever min/max/step are in effect at that
    // moment, and the browser defaults (min 0, max 100, step 1) are still
    // active until these are set -- assigning value first would silently
    // snap any fractional value (e.g. a 0-1 gain) to the nearest whole
    // number before this field's real constraints ever apply.
    if (field.min !== undefined) input.min = String(field.min);
    if (field.max !== undefined) input.max = String(field.max);
    if (field.step !== undefined) input.step = String(field.step);
    input.value = String(field.value);
    input.addEventListener("input", () => field.onChange(Number(input.value)));
    row.appendChild(input);
  }

  container.appendChild(row);
}

/** A single generic popup menu -- cell/row-master/column-master all reuse
 * this with different field lists rather than three bespoke menu
 * components (see PLAN.md's "Remaining open question": the grid UI's exact
 * shape is intentionally not toolkit-owned, so it's built plainly here). */
export function openContextMenu(
  x: number,
  y: number,
  title: string,
  fields: MenuField[],
): void {
  closeMenu();

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const heading = document.createElement("div");
  heading.className = "menu-title";
  heading.textContent = title;
  menu.appendChild(heading);

  for (const field of fields) renderField(menu, field);

  document.body.appendChild(menu);
  openMenuEl = menu;

  // Safe to attach immediately, no deferral needed: this runs synchronously
  // inside whatever handler opened the menu (a cell/row/column's
  // "contextmenu", or the Master button's plain "click"). By the time that
  // handler is running, the current event's capture phase at `document`
  // has already completed, so a capture-phase listener added here won't
  // be invoked for the very click/contextmenu that's still in flight --
  // only for the next one. Verified via the Master button specifically
  // (a same-type "click" open), not just the different-event-type case.
  document.addEventListener("click", onOutsideClick, true);
  document.addEventListener("keydown", onKeyDown, true);
}
