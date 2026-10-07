// UserPromptSubmit: remembers what the user asked so the PMO can judge the answer against it, and
// resets the per-request limits (review rounds, tasks run in a phase).
import { isChildSession, readHookInput, saveState, workTreeFingerprint } from './team-state.mjs';

if (isChildSession()) process.exit(0);

const input = await readHookInput();
if (input.session_id) {
  saveState(input.session_id, { prompt: input.prompt ?? '', rounds: 0, tasksThisRun: 0, fingerprint: workTreeFingerprint() });
}
