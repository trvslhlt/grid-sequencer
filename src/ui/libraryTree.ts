/** A collapsible-by-group list, reused by both the main page's select-only
 * library panels and the management page's full-CRUD ones -- only the
 * grouping/collapse mechanics are shared, each caller fully owns what a
 * leaf item actually looks like/does via `renderItem`. Groups use native
 * <details>/<summary> (collapsed by default, no manual expand-state
 * tracking needed) rather than a hand-rolled toggle. */

export interface TreeGroup<T> {
  label: string;
  items: T[];
}

export interface LibraryTreeOptions<T> {
  getId: (item: T) => string;
  /** Caller owns the leaf element's full content and interactivity --
   * anything from a plain clickable label (main page) to name + rename/
   * delete controls (management page). */
  renderItem: (item: T, itemEl: HTMLElement) => void;
  /** Shown instead of any groups when there's nothing to browse yet. */
  emptyMessage?: string;
}

export function renderLibraryTree<T>(
  container: HTMLElement,
  groups: TreeGroup<T>[],
  options: LibraryTreeOptions<T>,
): void {
  // A full rebuild (see this app's general "just re-render everything"
  // convention) would otherwise reset every native <details> back to
  // closed on each call -- fine for a one-off render, but every action in
  // the management page's tables (rename/recategorize/delete) triggers a
  // rebuild, so without this a group would visibly snap shut right after
  // whatever row inside it you just edited. Keyed by label, not index,
  // since groups can reorder/shrink as items move between them.
  const openLabels = new Set(
    Array.from(container.querySelectorAll<HTMLDetailsElement>("details[open]"))
      .map((details) => details.dataset.groupLabel)
      .filter((label): label is string => label !== undefined),
  );

  container.innerHTML = "";
  const nonEmptyGroups = groups.filter((group) => group.items.length > 0);

  if (nonEmptyGroups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "library-tree-empty";
    empty.textContent = options.emptyMessage ?? "Nothing here yet.";
    container.appendChild(empty);
    return;
  }

  for (const group of nonEmptyGroups) {
    const details = document.createElement("details");
    details.className = "library-tree-group";
    details.dataset.groupLabel = group.label;
    details.open = openLabels.has(group.label);

    const summary = document.createElement("summary");
    summary.textContent = `${group.label} (${group.items.length})`;
    details.appendChild(summary);

    const list = document.createElement("div");
    list.className = "library-tree-items";
    for (const item of group.items) {
      const itemEl = document.createElement("div");
      itemEl.className = "library-tree-item";
      itemEl.dataset.id = options.getId(item);
      options.renderItem(item, itemEl);
      list.appendChild(itemEl);
    }
    details.appendChild(list);

    container.appendChild(details);
  }
}
