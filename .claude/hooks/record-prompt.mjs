// UserPromptSubmit: remembers what the user asked so the PMO can judge the answer against it.
import { isChildSession, readHookInput, saveState, workTreeFingerprint } from './team-state.mjs';

if (isChildSession()) process.exit(0);

const input = await readHookInput();
if (input.session_id) {
  saveState(input.session_id, { prompt: input.prompt ?? '', rounds: 0, fingerprint: workTreeFingerprint() });
}
