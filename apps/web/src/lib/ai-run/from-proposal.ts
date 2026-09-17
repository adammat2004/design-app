/*
 * Moved into `@garden-studio/schema` under `plan/run/`.
 *
 * It only ever imported from the schema package, and putting it there is what lets one test run the
 * server's planner output through the client's executor — the gap CLAUDE.md records as "nothing
 * joins the API half to the web half". This re-export keeps every import path in the web app as it
 * was; the module's own reasoning lives with the file.
 */
export { proposedChangeToOperations, runFromProposal } from '@garden-studio/schema';
