/** A generic snapshot-based undo/redo history: a stack of whatever opaque
 * string `serialize()` produces, polled on an interval (see `checkpoint`)
 * rather than hooked into every mutation site -- the same reasoning as
 * main.ts's own dirty-tracking poll: an app with dozens of mutation sites
 * (many entirely internal to some other module's own closure) is better
 * served by a snapshot comparison that can't miss one than by threading a
 * "record this" call through every setter. Nothing here is audio- or even
 * grid-sequencer-specific -- any app with a serializable state shape and a
 * way to restore it from that same shape can reuse this outright. */

export interface UndoHistoryOptions {
  /** Produces the current state as an opaque, comparable string -- called
   * on every `checkpoint()` tick and once by `reset()`. Two calls that
   * produce the same string are treated as "nothing changed," so this
   * should be stable/deterministic for an unchanged state (e.g. JSON with
   * a fixed key order), not something like including a fresh timestamp. */
  serialize: () => string;
  /** Rebuilds live state from a string this same `serialize` once
   * produced. Awaited before the next undo/redo can start (see the
   * reentrancy guard on `undo`/`redo`), so a rapid double-click or a held
   * hotkey's own key-repeat can't fire a second restore while this one is
   * still in flight and corrupt the stacks with overlapping pop/push
   * pairs. */
  restore: (snapshot: string) => Promise<void> | void;
  /** Oldest entries are dropped once the undo stack exceeds this. Default
   * 100. */
  limit?: number;
  /** Called after every stack mutation (reset/checkpoint/undo/redo) with
   * the freshly current canUndo/canRedo -- wire this straight to whatever
   * UI (button disabled state, menu item, ...) reflects them, instead of
   * re-reading the history's own state after every call site. */
  onChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
}

export interface UndoHistory {
  /** Clears both stacks and seeds the undo stack with the current state --
   * call this whenever "undo" should no longer be able to reach back past
   * this point (e.g. after loading a different document; undoing into a
   * document you've since navigated away from would be more confusing
   * than useful). */
  reset(): void;
  /** Records the current state as a new undo step if it differs from the
   * top of the stack, and clears the redo stack (a fresh edit invalidates
   * whatever was undone). A no-op mid-restore (see `restore`'s own doc) so
   * the poll driving this doesn't see a just-restored state as a brand
   * new edit and push it right back onto the stack it was popped from. */
  checkpoint(): void;
  /** Steps back one recorded state, if any beyond the current one exists.
   * No-ops (rather than queuing) if a restore is already in flight. */
  undo(): Promise<void>;
  /** Steps forward one state undone via `undo`, if any. Same reentrancy
   * no-op as `undo`. */
  redo(): Promise<void>;
}

export function createUndoHistory(options: UndoHistoryOptions): UndoHistory {
  const limit = options.limit ?? 100;
  let undoStack: string[] = [];
  let redoStack: string[] = [];
  // Set only while a restore() call from undo/redo is in flight.
  let isRestoring = false;

  function notify(): void {
    options.onChange?.({
      canUndo: undoStack.length >= 2,
      canRedo: redoStack.length > 0,
    });
  }

  function reset(): void {
    undoStack = [options.serialize()];
    redoStack = [];
    notify();
  }

  function checkpoint(): void {
    if (isRestoring) return;
    const snapshot = options.serialize();
    if (snapshot === undoStack[undoStack.length - 1]) return;
    undoStack.push(snapshot);
    if (undoStack.length > limit) undoStack.shift();
    redoStack = [];
    notify();
  }

  async function restoreEntry(snapshot: string): Promise<void> {
    isRestoring = true;
    try {
      await options.restore(snapshot);
    } finally {
      isRestoring = false;
    }
    notify();
  }

  async function undo(): Promise<void> {
    if (isRestoring || undoStack.length < 2) return;
    const current = undoStack.pop();
    if (current === undefined) return;
    redoStack.push(current);
    await restoreEntry(undoStack[undoStack.length - 1]);
  }

  async function redo(): Promise<void> {
    if (isRestoring) return;
    const next = redoStack.pop();
    if (next === undefined) return;
    undoStack.push(next);
    await restoreEntry(next);
  }

  return { reset, checkpoint, undo, redo };
}
