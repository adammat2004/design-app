import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DesignElement } from '@garden-studio/schema';
import { resetAiRunStoreForTests } from '@/state/ai-run-store';
import { resetAssistantStoreForTests, useAssistantStore } from '@/state/assistant-store';
import { resetBoundaryStoreForTests, useBoundaryStore } from '@/state/boundary-store';
import { resetPlanEditorStoreForTests, usePlanEditorStore } from '@/state/plan-editor-store';
import { EditorInspector } from './EditorInspector';

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

function withPatio(over: Partial<DesignElement> = {}) {
  usePlanEditorStore.setState((state) => ({
    present: { ...state.present, elements: [patio(over)] },
  }));
}

/**
 * What the request will be about, shown on the inspector header.
 *
 * A *view* of the canvas selection rather than a second piece of state, which is the whole design:
 * there is one selected element, the sheet below shows the same one, and the × here is the same
 * `select(null)` that clicking bare canvas performs. Pinned independently it would be a second
 * answer to "what is selected", and the two would disagree the first time somebody clicked the plan.
 */
describe('the element the request is about', () => {
  it('says Garden when nothing is selected', () => {
    withPatio();
    render(<EditorInspector />);

    expect(screen.queryByTestId('agent-focus')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Garden' })).toBeInTheDocument();
  });

  it('names what is selected on the canvas', () => {
    withPatio();
    usePlanEditorStore.getState().select('e-1');
    render(<EditorInspector />);

    expect(screen.getByTestId('agent-focus')).toBeInTheDocument();
    expect(screen.getByTestId('element-name')).toHaveValue('Seating patio');
  });

  /* The composer says what "this" will mean, so the short sentence is the obvious one to type. */
  it('offers to change that element by name', () => {
    withPatio();
    usePlanEditorStore.getState().select('e-1');
    render(<EditorInspector />);

    expect(screen.getByTestId('assistant-input')).toHaveAttribute(
      'placeholder',
      'Ask for a change to Seating patio…',
    );
  });

  /* One selection, so clearing it here clears it on the plan and in the sheet too. */
  it('deselects the element rather than keeping a second opinion', () => {
    withPatio();
    usePlanEditorStore.getState().select('e-1');
    render(<EditorInspector />);

    fireEvent.click(screen.getByTestId('agent-focus-clear'));

    expect(usePlanEditorStore.getState().selectedId).toBeNull();
    expect(screen.queryByTestId('agent-focus')).toBeNull();
    expect(screen.queryByTestId('selected-element')).toBeNull();
  });

  /*
   * While a run is on, `selectedId` is the designer's own cursor — the run sets it, which is how the
   * canvas follows the work. Showing it as the user's context would claim something they did not
   * choose. The sheet hides, and the header names what the request was *about* — here nothing,
   * so the subject is the garden being updated.
   */
  it('stands aside while the designer is working', () => {
    withPatio();
    usePlanEditorStore.getState().select('e-1');
    useAssistantStore.setState({ phase: 'performing' });
    render(<EditorInspector />);

    expect(screen.queryByTestId('agent-focus')).toBeNull();
    expect(screen.queryByTestId('selected-element')).toBeNull();
    expect(screen.getByTestId('inspector-working')).toHaveTextContent('Garden');
    expect(screen.getByTestId('inspector-working')).toHaveTextContent('Updating…');
    expect(screen.getByTestId('assistant-input')).toBeDisabled();
  });

  /*
   * The same inspector, still about the patio: the subject of a live request is the element the
   * request was sent about, captured at send time, not whatever the run has selected since.
   */
  it('keeps the request\'s subject in the header while it is being worked on', () => {
    withPatio();
    useAssistantStore.setState({
      phase: 'performing',
      messages: [
        {
          id: 'm1',
          role: 'user',
          text: 'make it bigger',
          at: Date.now(),
          about: { id: 'e-1', label: 'Seating patio' },
        },
      ],
    });
    render(<EditorInspector />);

    const header = screen.getByTestId('inspector-working');
    expect(header).toHaveTextContent('Seating patio');
    expect(header).toHaveTextContent('Updating…');
    expect(screen.getByTestId('inspector-working-request')).toHaveTextContent('make it bigger');
  });

  it('shows the compact sheet for the selected element, with the area in the header', () => {
    withPatio();
    usePlanEditorStore.getState().select('e-1');
    render(<EditorInspector />);

    expect(screen.getByTestId('selected-element')).toBeInTheDocument();
    expect(screen.getByTestId('element-material')).toBeInTheDocument();
    expect(screen.getByTestId('element-width')).toBeInTheDocument();
    expect(screen.getByTestId('agent-focus')).toContainElement(screen.getByTestId('element-area'));
    expect(screen.getByTestId('element-area')).toHaveTextContent('12');
  });
});

/**
 * One subject, three ways to change it. A swatch, a suggestion and a chip are three handles on the
 * same patio, and the inspector renders them as one continuum rather than a form and a chat.
 */
describe('three ways to change the selected element', () => {
  it('changes the material directly from a swatch', () => {
    withPatio();
    usePlanEditorStore.getState().select('e-1');
    render(<EditorInspector />);

    fireEvent.click(screen.getByTestId('material-swatch-timber-decking'));

    expect(usePlanEditorStore.getState().present.elements[0]!.material).toBe('timber-decking');
  });

  /* A suggestion may be a direct edit — no model, no key, no run. */
  it('applies a material suggestion as a direct edit', () => {
    withPatio({ material: 'concrete' });
    usePlanEditorStore.getState().select('e-1');
    render(<EditorInspector />);

    const suggestion = screen.getByTestId('smart-suggestion-porcelain');
    expect(suggestion).toHaveAttribute('data-action', 'material');
    fireEvent.click(suggestion);

    expect(usePlanEditorStore.getState().present.elements[0]!.material).toBe('porcelain');
    expect(useAssistantStore.getState().messages).toHaveLength(0);
  });

  /* Or a request, sent through the same composer path a typed sentence takes. */
  it('sends a request suggestion to the designer', () => {
    withPatio();
    usePlanEditorStore.getState().select('e-1');
    const send = vi.fn(async () => {});
    useAssistantStore.setState({ send });
    render(<EditorInspector />);

    fireEvent.click(screen.getByTestId('smart-suggestion-lighting'));

    expect(send).toHaveBeenCalledWith('Add lighting around Seating patio');
  });

  it('offers quick commands about "it" beside the composer', () => {
    withPatio();
    usePlanEditorStore.getState().select('e-1');
    const send = vi.fn(async () => {});
    useAssistantStore.setState({ send });
    render(<EditorInspector />);

    fireEvent.click(screen.getByTestId('quick-command-make-it-bigger'));

    expect(send).toHaveBeenCalledWith('Make it bigger');
  });

  /* Without a key a request card would be a control that does nothing, so it is not offered. */
  it('keeps only the direct suggestions when there is no key', () => {
    withPatio({ material: 'concrete' });
    usePlanEditorStore.getState().select('e-1');
    useAssistantStore.setState({ available: false });
    render(<EditorInspector />);

    expect(screen.getByTestId('smart-suggestion-porcelain')).toBeInTheDocument();
    expect(screen.queryByTestId('smart-suggestion-lighting')).toBeNull();
    expect(screen.queryByTestId('quick-command-make-it-bigger')).toBeNull();
  });
});

/** The garden is a subject like any other, with the same header, actions, suggestions and composer. */
describe('the garden as the subject', () => {
  it('offers actions and suggestions for the whole garden', () => {
    withPatio();
    render(<EditorInspector />);

    expect(screen.getByRole('heading', { name: 'Garden' })).toBeInTheDocument();
    expect(screen.getByTestId('garden-action-ideas')).toBeInTheDocument();
    expect(screen.getByTestId('smart-suggestions')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-input')).toHaveAttribute(
      'placeholder',
      'Ask the designer about your garden…',
    );
  });

  it('sends a garden action as a request', () => {
    withPatio();
    const send = vi.fn(async () => {});
    useAssistantStore.setState({ send });
    render(<EditorInspector />);

    fireEvent.click(screen.getByTestId('garden-action-modern'));

    expect(send).toHaveBeenCalledWith('Make the garden more modern');
  });
});
