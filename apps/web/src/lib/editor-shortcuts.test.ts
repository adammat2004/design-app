import { describe, expect, it } from 'vitest';
import { editorShortcut, type ShortcutKey, type ShortcutTarget } from './editor-shortcuts';

function key(over: Partial<ShortcutKey> & { key: string }): ShortcutKey {
  return { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over };
}

const canvas: ShortcutTarget = { tagName: 'DIV', role: 'application', isContentEditable: false };
const body: ShortcutTarget = { tagName: 'BODY', role: null, isContentEditable: false };
const button: ShortcutTarget = { tagName: 'BUTTON', role: null, isContentEditable: false };
const nameField: ShortcutTarget = { tagName: 'INPUT', role: null, isContentEditable: false };
const tab: ShortcutTarget = { tagName: 'BUTTON', role: 'tab', isContentEditable: false };

describe('editorShortcut', () => {
  it('reads undo and redo on either platform', () => {
    expect(editorShortcut(key({ key: 'z', metaKey: true }), body)).toEqual({ kind: 'undo' });
    expect(editorShortcut(key({ key: 'z', ctrlKey: true }), body)).toEqual({ kind: 'undo' });
    expect(editorShortcut(key({ key: 'Z', metaKey: true, shiftKey: true }), body)).toEqual({ kind: 'redo' });
    expect(editorShortcut(key({ key: 'y', ctrlKey: true }), body)).toEqual({ kind: 'redo' });
  });

  it('reads duplicate and select-all', () => {
    expect(editorShortcut(key({ key: 'd', metaKey: true }), canvas)).toEqual({ kind: 'duplicate' });
    expect(editorShortcut(key({ key: 'a', ctrlKey: true }), body)).toEqual({ kind: 'selectAll' });
    expect(editorShortcut(key({ key: 'a', metaKey: true }), nameField)).toBeNull();
  });

  /** A text box has its own undo, and a name being typed must never delete the patio. */
  it('leaves everything typed into a field to the field', () => {
    expect(editorShortcut(key({ key: 'z', metaKey: true }), nameField)).toBeNull();
    expect(editorShortcut(key({ key: 'Backspace' }), nameField)).toBeNull();
    expect(editorShortcut(key({ key: 'ArrowLeft' }), nameField)).toBeNull();
    expect(
      editorShortcut(key({ key: 'Delete' }), { tagName: 'DIV', role: null, isContentEditable: true }),
    ).toBeNull();
  });

  /** The reason the listener moved to the window: Delete after picking a Layers row. */
  it('deletes from anywhere that is not a field', () => {
    expect(editorShortcut(key({ key: 'Delete' }), button)).toEqual({ kind: 'delete' });
    expect(editorShortcut(key({ key: 'Backspace' }), canvas)).toEqual({ kind: 'delete' });
  });

  it('nudges, a whole metre with Shift', () => {
    expect(editorShortcut(key({ key: 'ArrowRight' }), canvas)).toEqual({ kind: 'nudge', dx: 0.1, dy: 0 });
    expect(editorShortcut(key({ key: 'ArrowUp', shiftKey: true }), body)).toEqual({
      kind: 'nudge',
      dx: 0,
      dy: -1,
    });
  });

  /** Moving between the inspector's tabs must not also slide the patio. */
  it('leaves the arrow keys to widgets that use them', () => {
    expect(editorShortcut(key({ key: 'ArrowRight' }), tab)).toBeNull();
    expect(
      editorShortcut(key({ key: 'ArrowLeft' }), { tagName: 'INPUT', role: 'slider', isContentEditable: false }),
    ).toBeNull();
  });

  it('reads Escape, and ignores keys it does not own', () => {
    expect(editorShortcut(key({ key: 'Escape' }), body)).toEqual({ kind: 'escape' });
    expect(editorShortcut(key({ key: 'a' }), body)).toBeNull();
    expect(editorShortcut(key({ key: 'c', metaKey: true }), body)).toBeNull();
    expect(editorShortcut(key({ key: 'z', metaKey: true, altKey: true }), body)).toBeNull();
  });
});
