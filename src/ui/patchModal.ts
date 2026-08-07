/** A popup for saving/loading patches -- replaces the always-visible
 * name/select/Save/Load row that used to sit permanently below the grid.
 * Opened from the header's "Patch: <name>" button (see main.ts), which
 * refreshes the patch list immediately before opening so the popup never
 * shows a stale list. Save and Load are independent actions sharing one
 * status line; Save leaves the popup open (so "save, then immediately
 * tweak the name and save again" or "save, then load something else"
 * both stay one popup session), Load closes it on success since loading
 * replaces the whole grid -- there's nothing left to keep editing here
 * once that happens. */

import type { PatchSummary } from "../patchApi";
import { type Field, renderFields } from "bruit-kit/ui";

export interface PatchModalCallbacks {
  onSave: (
    name: string,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Confirmed already (see the Load button's own window.confirm below)
   * by the time this is called -- throws on failure, same as every
   * other modal's save/load callback in this app. */
  onLoad: (id: string) => Promise<void>;
  /** Confirmed already (see the New button's own window.confirm below)
   * by the time this is called -- clears every row and the master bus's
   * own Effects chain, leaving tempo/columns/send-bus/scale untouched
   * (this only does what the button says: clear tracks -- and the
   * master effects riding on top of them -- not reset the whole patch).
   * Synchronous and can't fail the way Save/Load can (no network round
   * trip), so unlike those two this has no return value to report back. */
  onNew: () => void;
}

export function openPatchModal(
  currentName: string,
  isDirty: boolean,
  patches: PatchSummary[],
  callbacks: PatchModalCallbacks,
): void {
  // Local, not just the passed-in params -- a successful Save inside this
  // same popup session (possibly under a new name) flips it clean and
  // renames it without needing to close and reopen, so the title and the
  // Load button's confirm message both stay accurate for whatever's true
  // *right now*, not just at open time.
  let dirty = isDirty;
  let displayName = currentName;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const modal = document.createElement("div");
  modal.className = "modal patch-modal";
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
  function updateTitle(): void {
    title.textContent = `Patch: ${displayName}${dirty ? " *" : ""}`;
  }
  updateTitle();
  const closeButton = document.createElement("button");
  closeButton.textContent = "×";
  closeButton.className = "modal-close-button";
  closeButton.addEventListener("click", close);
  header.append(title, closeButton);
  modal.appendChild(header);

  const body = document.createElement("div");
  body.className = "modal-body";
  modal.appendChild(body);

  let saveName = currentName;
  let selectedId = patches.find((p) => p.name === currentName)?.id ?? "";

  const saveFieldsEl = document.createElement("div");
  const loadFieldsEl = document.createElement("div");
  body.append(saveFieldsEl, loadFieldsEl);

  const nameField: Field = {
    key: "save-name",
    label: "Name",
    kind: "text",
    value: saveName,
    onChange: (v) => {
      saveName = v;
    },
  };
  renderFields(saveFieldsEl, [nameField]);

  const loadGroupLabel = document.createElement("p");
  loadGroupLabel.className = "panel-section-title";
  loadGroupLabel.textContent = "Load a saved patch";
  loadFieldsEl.appendChild(loadGroupLabel);

  const loadSelectEl = document.createElement("div");
  loadFieldsEl.appendChild(loadSelectEl);
  const loadField: Field = {
    key: "load-select",
    label: "Patch",
    kind: "select",
    value: selectedId,
    options: patches.map((p) => ({ value: p.id, label: p.name })),
    onChange: (v) => {
      selectedId = v;
    },
  };
  renderFields(loadSelectEl, [loadField]);

  const statusEl = document.createElement("p");
  statusEl.className = "status-text";
  body.appendChild(statusEl);

  const footer = document.createElement("div");
  footer.className = "modal-footer";

  // Leftmost -- "start fresh" reads first, same left-to-right ordering as
  // a File menu's own New/Open/Save. Closes the modal on success like
  // Load does (not Save's "leave it open"): both replace the whole grid,
  // so there's nothing left in this popup session to keep editing after.
  const newButton = document.createElement("button");
  newButton.textContent = "New";
  newButton.addEventListener("click", () => {
    const confirmMessage = dirty
      ? `"${displayName}" has unsaved changes that will be lost. Clear all tracks and start a new patch?`
      : "Clear all tracks and start a new patch?";
    if (!window.confirm(confirmMessage)) return;
    callbacks.onNew();
    close();
  });
  footer.appendChild(newButton);

  const loadButton = document.createElement("button");
  loadButton.textContent = "Load";
  loadButton.disabled = patches.length === 0;
  loadButton.addEventListener("click", async () => {
    if (!selectedId) return;
    const confirmMessage = dirty
      ? `"${displayName}" has unsaved changes that will be lost. Load a different patch anyway?`
      : "Loading will replace the current grid. Continue?";
    if (!window.confirm(confirmMessage)) return;
    statusEl.textContent = "Loading…";
    try {
      await callbacks.onLoad(selectedId);
      close();
    } catch (err) {
      statusEl.textContent = "Load failed — try again";
      console.error(err);
    }
  });
  footer.appendChild(loadButton);

  const saveButton = document.createElement("button");
  saveButton.textContent = "Save";
  saveButton.addEventListener("click", async () => {
    const name = saveName.trim();
    if (!name) {
      statusEl.textContent = "Enter a name first";
      return;
    }
    statusEl.textContent = "Saving…";
    const result = await callbacks.onSave(name);
    statusEl.textContent = result.ok ? "Saved" : result.message;
    if (result.ok) {
      dirty = false;
      displayName = name;
      updateTitle();
    }
  });
  footer.appendChild(saveButton);

  modal.appendChild(footer);

  document.body.appendChild(overlay);
}
