import { create } from 'zustand';

/**
 * Whether the whole-garden 3D preview is open. A view state and nothing more — never in the
 * document, never in the undo history — and its own store rather than a field on the plan editor's,
 * because the review screen opens it too and neither screen's other state has anything to do with it.
 */
interface GardenPreviewState {
  open: boolean;
  openPreview: () => void;
  closePreview: () => void;
}

export const useGardenPreviewStore = create<GardenPreviewState>((set) => ({
  open: false,
  openPreview: () => set({ open: true }),
  closePreview: () => set({ open: false }),
}));
