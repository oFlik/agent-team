// Stop: before the coder's answer reaches the user, the PMO reviews it and may send it back for another round.
import { spawnSync } from 'node:child_process';
import {
  CHILD_ROLE_ENV,
  isChildSession,
  loadConfig,
  loadState,
  projectDir,
  readAgentPrompt,
  readHookInput,
  respond,
  saveState,
  workTreeFingerprint,
} from './team-state.mjs';

const PMO_TOOLS = 'Read,Grep,Glob,Bash(git status:*),Bash(git diff:*),Bash(git log:*),Bash(git show:*)';

if (isChildSession()) process.exit(0);

const input = await readHookInput();
const gate = { enabled: true, model: 'sonnet', maxRounds: 3, onlyWhenFilesChanged: true, timeoutSeconds: 240, claudeCommand: 'claude', ...loadConfig().pmoGate };
if (!gate.enabled || !input.session_id) process.exit(0);

const state = loadState(input.session_id);

if (gate.onlyWhenFilesChanged && workTreeFingerprint() === state.fingerprint) process.exit(0);

if (state.rounds >= gate.maxRounds) {
  respond({ systemMessage: `PMO: limite de ${gate.maxRounds} rodadas atingido. A decisão volta para você.` });
  process.exit(0);
}

const review = runPmo(buildPrompt(state.prompt, input.last_assistant_message ?? ''));

// A broken review must never trap the user in a loop, so failures let the answer through with a warning.
if (!review) {
  respond({ systemMessage: 'PMO: não consegui revisar esta resposta (veja .claude/state/last-pmo-error.json).' });
  process.exit(0);
}

if (review.verdict === 'revise') {
  state.rounds += 1;
  saveState(input.session_id, state);
  respond({
    decision: 'block',
    reason: `PMO (rodada ${state.rounds}/${gate.maxRounds}) pediu ajustes antes de entregar ao usuário:\n${review.feedback}`,
  });
} else {
  respond({ systemMessage: `PMO aprovou: ${review.feedback}` });
}

function buildPrompt(userRequest, coderAnswer) {
  return [
    readAgentPrompt('pmo'),
    '## Pedido do usuário',
    userRequest || '(não registrado)',
    '## Resposta do coder',
    coderAnswer || '(vazia)',
    '## Sua tarefa',
    'Avalie a resposta do coder seguindo as instruções acima e termine com o bloco JSON.',
  ].join('\n\n');
}

function runPmo(prompt) {
  const result = spawnSync(
    gate.claudeCommand,
    ['-p', '--output-format', 'json', '--model', gate.model, '--allowedTools', PMO_TOOLS, '--disallowedTools', 'Edit,Write,NotebookEdit'],
    {
      cwd: projectDir,
      input: prompt,
      encoding: 'utf8',
      timeout: gate.timeoutSeconds * 1000,
      env: { ...process.env, [CHILD_ROLE_ENV]: 'pmo' },
    },
  );
  try {
    const answer = JSON.parse(result.stdout).result;
    const verdicts = [...answer.matchAll(/\{[^{}]*"verdict"[^{}]*\}/g)];
    return JSON.parse(verdicts.at(-1)[0]);
  } catch {
    saveState('last-pmo-error', { status: result.status, error: String(result.error ?? ''), stdout: result.stdout, stderr: result.stderr });
    return null;
  }
}
