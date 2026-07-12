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
    input.value = String(field.value);
    if (field.min !== undefined) input.min = String(field.min);
    if (field.max !== undefined) input.max = String(field.max);
    if (field.step !== undefined) input.step = String(field.step);
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

  // Safe to attach immediately, no deferral needed: menus only ever open
  // via a "contextmenu" event, and these listeners close on "click" /
  // "keydown" -- different event types, so there's no same-tick collision
  // with the event that opened this menu.
  document.addEventListener("click", onOutsideClick, true);
  document.addEventListener("keydown", onKeyDown, true);
}
