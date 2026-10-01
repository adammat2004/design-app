/**
 * Which editor command a key press means, decided without touching a store or the DOM.
 *
 * The shortcuts used to be read by the canvas wrapper's own `onKeyDown`, so they worked only while
 * that `div` had focus — and it rarely did, because clicking a Konva shape does not focus it and
 * clicking a palette tile or a Layers row moves focus somewhere else entirely. Delete after picking
 * a row did nothing. The editor now listens on the window, and this function is the rule for when a
 * key press belongs to the editor rather than to whatever has focus.
 *
 * Pure so the rule can be tested row by row: a shortcut layer's bugs are almost all "it fired while
 * I was typing a name" or "the arrow keys stopped moving between tabs", and both are questions about
 * the target, not about the store.
 */

export type EditorShortcut =
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'duplicate' }
  | { kind: 'selectAll' }
  | { kind: 'delete' }
  | { kind: 'escape' }
  | { kind: 'nudge'; dx: number; dy: number };

export interface ShortcutKey {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface ShortcutTarget {
  /** Upper-case tag name, as `Element.tagName` reports it. */
  tagName: string;
  role: string | null;
  isContentEditable: boolean;
}

/**
 * Widgets that use the arrow keys themselves. An arrow pressed on one of these is the widget's —
 * moving between the inspector's tabs must not also slide the patio a decimetre.
 */
const ARROW_ROLES = new Set([
  'tab',
  'tablist',
  'slider',
  'radio',
  'radiogroup',
  'menu',
  'menuitem',
  'menuitemradio',
  'menuitemcheckbox',
  'option',
  'listbox',
  'combobox',
  'spinbutton',
  'grid',
  'gridcell',
]);

/** Arrow-key nudge in metres; Shift makes it a whole metre. Matches step 2. */
export const NUDGE_STEP = 0.1;
export const NUDGE_STEP_LARGE = 1;

function isTyping(target: ShortcutTarget | null): boolean {
  if (!target) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

export function editorShortcut(
  event: ShortcutKey,
  target: ShortcutTarget | null,
): EditorShortcut | null {
  /*
   * Anything typed into a field is the field's, including ⌘Z: a text box has its own undo, and
   * taking it away to rewind the garden while somebody is renaming a bed would be the most
   * surprising thing this layer could do.
   */
  if (isTyping(target)) return null;

  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  if (mod && !event.altKey) {
    if (key === 'z') return event.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
    if (key === 'y' && !event.shiftKey) return { kind: 'redo' };
    if (key === 'd' && !event.shiftKey) return { kind: 'duplicate' };
    if (key === 'a' && !event.shiftKey) return { kind: 'selectAll' };
    return null;
  }

  if (event.altKey) return null;

  if (key === 'Escape') return { kind: 'escape' };
  if (key === 'Delete' || key === 'Backspace') return { kind: 'delete' };

  const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
  const arrows: Record<string, [number, number]> = {
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
  };
  const move = arrows[key];
  if (!move) return null;
  if (target?.role && ARROW_ROLES.has(target.role)) return null;
  return { kind: 'nudge', dx: move[0], dy: move[1] };
}

/** Reads what `editorShortcut` needs off a real event target. */
export function shortcutTarget(target: EventTarget | null): ShortcutTarget | null {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return null;
  const element = target as HTMLElement;
  return {
    tagName: element.tagName.toUpperCase(),
    role: element.getAttribute?.('role') ?? null,
    isContentEditable: element.isContentEditable === true,
  };
}
