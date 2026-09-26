import type { ARScene } from '@garden-studio/ar-contract';
import { sampleGarden } from './sample-garden';

/**
 * Every scene the app can open without a server. Add generated scenes here (as imported JSON)
 * once the web/API side can export them — see docs/ar/ar-architecture.md, "Scene sources".
 */
export const FIXTURES: Record<string, unknown> = {
  'sample-garden': sampleGarden satisfies ARScene,
};
