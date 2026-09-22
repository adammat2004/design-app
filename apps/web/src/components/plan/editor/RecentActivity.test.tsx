import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DesignElement } from '@garden-studio/schema';
import { layoutFingerprint } from '@/lib/concepts';
import { resetAiRunStoreForTests, useAiRunStore } from '@/state/ai-run-store';
import { resetAssistantStoreForTests, useAssistantStore } from '@/state/assistant-store';
import { resetBoundaryStoreForTests, useBoundaryStore } from '@/state/boundary-store';
import { resetPlanEditorStoreForTests, usePlanEditorStore } from '@/state/plan-editor-store';
import { EditorInspector } from './EditorInspector';

/**
 * The way back to a redesign this session did not do.
 *
 * `layout.revision` was persisted and autosaved and **nothing could reach it**: the undo stack does
 * not survive a reload by design, and the in-message controls read the run store, which is empty on
 * a fresh page. So the record sat in the document unreachable, which made "a misread request is
 * recoverable after a reload" untrue — and that promise is half of what made removing the
 * approve-first review step defensible.
 */

vi.mock('@/lib/plan-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/plan-api')>('@/lib/plan-api');
  return { ...actual, assistantAvailability: vi.fn(async () => ({ model: true })) };
});

function patio(over: Partial<DesignElement> = {}): DesignElement {
  return {
    id: 'e-1',
    category: 'paved-area',
    role: 'feature',
    name: 'Seating patio',
    zone: 'back',
    material: 'porcelain',
    shape: { kind: 'rect', centre: { x: 8, y: 8 }, width: 4, depth: 3, rotation: 0 },
    ...over,
  } as DesignElement;
}

/** The garden before the redesign, and the garden the redesign left. */
const before = [patio()];
const after = [patio({ shape: { kind: 'rect', centre: { x: 8, y: 8 }, width: 6, depth: 5, rotation: 0 } })];

function record(over: Partial<Parameters<ReturnType<typeof usePlanEditorStore.getState>['recordRevision']>[0]> = {}) {
  return {
    id: 'r-1',
    request: 'make the terrace bigger',
    createdAt: Date.now() - 60_000,
    before,
    afterFingerprint: layoutFingerprint(after),
    ...over,
  };
}

beforeEach(() => {
  resetBoundaryStoreForTests();
  resetPlanEditorStoreForTests();
  resetAiRunStoreForTests();
  resetAssistantStoreForTests();

  const boundary = useBoundaryStore.getState();
  for (const point of [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ])
    boundary.addVertexAt(point);
  boundary.closeShape();
});

/** A plan reloaded with a redesign on it, exactly as `hydratePlanEditorStore` leaves one. */
function reloadedWithRedesign(elements: DesignElement[] = after) {
  usePlanEditorStore.setState((state) => ({
    present: { ...state.present, elements },
    revision: record(),
  }));
}

describe('the redesign carried over from a previous session', () => {
  it('offers a way back, naming what was asked for', () => {
    reloadedWithRedesign();
    render(<EditorInspector />);

    expect(screen.getByTestId('ai-carried-revision')).toHaveTextContent('make the terrace bigger');
    expect(screen.getByTestId('ai-undo-carried')).toBeEnabled();
  });

  it('puts the garden back when it is taken', () => {
    reloadedWithRedesign();
    render(<EditorInspector />);

    fireEvent.click(screen.getByTestId('ai-undo-carried'));

    expect(usePlanEditorStore.getState().present.elements).toEqual(before);
    /* Spent: the record is gone, so the offer does not stand a second time. */
    expect(usePlanEditorStore.getState().revision).toBeNull();
    expect(screen.queryByTestId('ai-carried-revision')).toBeNull();
  });

  /* It commits like any other edit, so the ordinary toolbar Undo can take the undo back. */
  it('is itself undoable', () => {
    reloadedWithRedesign();
    render(<EditorInspector />);

    fireEvent.click(screen.getByTestId('ai-undo-carried'));
    usePlanEditorStore.getState().undo();

    expect(usePlanEditorStore.getState().present.elements).toEqual(after);
  });

  it('says nothing on a plan nobody has asked anything of', () => {
    usePlanEditorStore.setState((state) => ({ present: { ...state.present, elements: after } }));
    render(<EditorInspector />);

    expect(screen.queryByTestId('ai-carried-revision')).toBeNull();
  });

  /*
   * Two Undos a few inches apart, acting through different mechanisms, is two controls for one
   * intention. The message that produced the redesign already carries its own.
   */
  it('stays out of the way when this session did the redesign', () => {
    reloadedWithRedesign();
    useAiRunStore.setState({
      revision: {
        id: 'run-1',
        request: 'make the terrace bigger',
        createdAt: Date.now(),
        prepared: { initial: before, result: after } as never,
        initial: before,
        result: after,
        refused: [],
        summary: null,
        complete: true,
      },
    });

    render(<EditorInspector />);

    expect(screen.queryByTestId('ai-carried-revision')).toBeNull();
  });

  /*
   * `undoRevision` refuses once the plan has moved on, so offering it would be a control that looks
   * available and does nothing — the fault the Replay gate exists to avoid. An edit since the
   * redesign is also a real answer: they kept it and carried on.
   */
  it('withdraws the offer once the plan has been edited since', () => {
    reloadedWithRedesign([...after, patio({ id: 'e-2', name: 'Fire pit' })]);
    render(<EditorInspector />);

    expect(screen.queryByTestId('ai-carried-revision')).toBeNull();
  });
});

/**
 * The composer still names the selection, even though the header is what shows it.
 *
 * The placeholder is how a sentence with no noun in it ("use porcelain instead") resolves: the
 * composer says what "this" will mean, so the short sentence is the obvious one to type.
 */
describe('the composer names the selection', () => {
  it('offers to change the selected element by name', () => {
    usePlanEditorStore.setState((state) => ({
      present: { ...state.present, elements: [patio()] },
    }));
    usePlanEditorStore.getState().select('e-1');
    render(<EditorInspector />);

    expect(screen.getByTestId('assistant-input')).toHaveAttribute(
      'placeholder',
      'Ask for a change to Seating patio…',
    );
  });
});

/**
 * What a past request was about, recorded in the transcript.
 *
 * "Make it bigger" is unreadable a minute later, which is the cost of letting the canvas supply the
 * subject — so the bubble carries the subject with it, under the name it had at the time.
 */
describe('what a request was about', () => {
  function asked(about: { id: string; label: string } | null) {
    useAssistantStore.setState({
      messages: [{ id: 'm1', role: 'user', text: 'make it bigger', at: Date.now(), about }],
    });
  }

  it('names it under the question', () => {
    usePlanEditorStore.setState((state) => ({
      present: { ...state.present, elements: [patio()] },
    }));
    asked({ id: 'e-1', label: 'Seating patio' });
    render(<EditorInspector />);

    expect(screen.getByTestId('chat-about-m1')).toHaveTextContent('about Seating patio');
  });

  it('selects it again when taken', () => {
    usePlanEditorStore.setState((state) => ({
      present: { ...state.present, elements: [patio()] },
    }));
    asked({ id: 'e-1', label: 'Seating patio' });
    render(<EditorInspector />);

    fireEvent.click(screen.getByTestId('chat-about-m1'));

    expect(usePlanEditorStore.getState().selectedId).toBe('e-1');
  });

  /*
   * A control that looks available and does nothing is the fault this codebase keeps catching. The
   * record still reads, because what the request was about is true whether the thing survived.
   */
  it('still says what it was about once the element has gone, without offering to select it', () => {
    asked({ id: 'e-1', label: 'Seating patio' });
    render(<EditorInspector />);

    const tag = screen.getByTestId('chat-about-m1');
    expect(tag).toHaveTextContent('about Seating patio');
    expect(tag.tagName).not.toBe('BUTTON');
  });

  it('says nothing about a request that named no element', () => {
    asked(null);
    render(<EditorInspector />);

    expect(screen.queryByTestId('chat-about-m1')).toBeNull();
  });
});
