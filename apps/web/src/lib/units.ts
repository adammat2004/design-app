/**
 * Units live in `@garden-studio/schema` because the server formats text too — the assistant's
 * before/after lines are measured off geometry and written in the user's own unit. Re-exported
 * here so the screens keep importing from one obvious place.
 */
export {
  METRES_PER_FOOT,
  formatArea,
  formatLength,
  formatLengthValue,
  fromDisplay,
  toDisplay,
  type Unit,
} from '@garden-studio/schema';
