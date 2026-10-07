// Stop: before the coder's answer reaches the user, the project checks run and the PMO reviews it.
// During a phase (autopilot), an approved task is committed here and the coder is handed the next one.
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
import { autopilotContext, git, phaseBranch, saveRoadmap, taskBrief, tasksFinishedSinceHead } from '../scripts/roadmap.mjs';

const PMO_TOOLS = 'Read,Grep,Glob,Bash(git status:*),Bash(git diff:*),Bash(git log:*),Bash(git show:*)';
const OUTPUT_TAIL = 3000;

if (isChildSession()) process.exit(0);

const input = await readHookInput();
const config = loadConfig();
const gate = { enabled: true, model: 'sonnet', maxRounds: 3, onlyWhenFilesChanged: true, timeoutSeconds: 240, claudeCommand: 'claude', ...config.pmoGate };
const autopilot = { maxTasksPerRun: 5, ...config.autopilot };
const checks = config.checks ?? [];
if (!input.session_id) process.exit(0);

const state = loadState(input.session_id);
let ctx;
try {
  ctx = autopilotContext();
} catch (error) {
  respond({ systemMessage: `.claude/roadmap.json ilegível, o modo fase ficou parado: ${error.message}` });
  process.exit(0);
}
if (!gate.enabled && !ctx && checks.length === 0) process.exit(0);

// A finished task that is not committed yet must be retried on every stop, or the phase stalls for good.
const commitPending = Boolean(ctx && !ctx.task && phaseHasWorkToClose(ctx.phase));
if (gate.onlyWhenFilesChanged && !commitPending && workTreeFingerprint() === state.fingerprint) process.exit(0);

if (state.rounds >= gate.maxRounds) {
  respond({ systemMessage: `PMO: limite de ${gate.maxRounds} rodadas atingido. A decisão volta para você.` });
  process.exit(0);
}

// A task still in progress means the coder stopped to ask something; half-done work is expected to fail checks.
const failedCheck = ctx?.task ? null : runChecks();
if (failedCheck) sendBack(`As verificações do projeto falharam:\n${failedCheck}`);

const review = gate.enabled
  ? runPmo(buildPrompt(state.prompt, input.last_assistant_message ?? ''))
  : { verdict: 'approve', feedback: 'revisão do PMO desligada no team.json' };

// A broken review must never trap the user in a loop, so failures let the answer through with a warning.
if (!review) {
  respond({ systemMessage: 'PMO: não consegui revisar esta resposta (veja .claude/state/last-pmo-error.json).' });
  process.exit(0);
}

if (review.verdict === 'revise') sendBack(`PMO pediu ajustes antes de entregar ao usuário:\n${review.feedback}`);

const checksNote = ctx?.task ? 'verificações ficam para quando a task for marcada como done' : 'verificações passaram';
const approval = gate.enabled ? `PMO aprovou: ${review.feedback}` : `Revisão do PMO desligada no team.json; ${checksNote}.`;
if (ctx) advancePhase();
else respond({ systemMessage: approval });

function phaseHasWorkToClose(phase) {
  return tasksFinishedSinceHead(phase).length > 0 || phase.tasks.every((t) => t.status === 'done');
}

function sendBack(reason) {
  state.rounds += 1;
  saveState(input.session_id, state);
  respond({ decision: 'block', reason: `(rodada ${state.rounds}/${gate.maxRounds}) ${reason}` });
  process.exit(0);
}

function advancePhase() {
  const { roadmap, phase } = ctx;
  const blocked = phase.tasks.find((t) => t.status === 'blocked');

  // A task still in progress means the coder stopped to ask the user something: let the answer through.
  if (blocked || ctx.task || !phaseHasWorkToClose(phase)) {
    const why = blocked ? `\nTask ${blocked.id} bloqueada, precisa de você: ${blocked.note}` : '';
    respond({ systemMessage: `${approval}${why}` });
    return;
  }

  const finished = tasksFinishedSinceHead(phase);
  const ids = finished.map((t) => t.id).join(', ');
  const before = structuredClone(roadmap);
  const next = phase.tasks.find((t) => t.status === 'todo');
  if (next) next.status = 'doing';
  else phase.status = 'review';
  saveRoadmap(roadmap);

  const subject = finished.length ? `task(${ids}): ${finished.map((t) => t.title).join('; ')}` : `fase(${phase.id}): concluída`;
  try {
    git(['add', '-A']);
    git(['commit', '-m', subject, '-m', approval]);
  } catch (error) {
    // Put the roadmap back so the next stop sees the same pending task and retries the commit.
    saveRoadmap(before);
    sendBack(`${approval}\nMas o commit de ${ids || phase.id} falhou (ex.: hook de pre-commit). Corrija e encerre a resposta para tentar de novo:\n${String(error.stderr ?? error.message).trim().slice(-OUTPUT_TAIL)}`);
  }

  state.rounds = 0;
  state.tasksThisRun = (state.tasksThisRun ?? 0) + 1;
  state.fingerprint = workTreeFingerprint();
  saveState(input.session_id, state);

  if (!next) {
    respond({ systemMessage: `Fase ${phase.id} concluída. ${openPullRequest(roadmap, phase)}` });
    return;
  }
  if (state.tasksThisRun >= autopilot.maxTasksPerRun) {
    respond({
      systemMessage: `Task ${ids} commitada. Limite de ${autopilot.maxTasksPerRun} tasks por execução atingido; diga "continue" para seguir com ${next.id}.`,
    });
    return;
  }
  respond({
    decision: 'block',
    reason: [
      `Task ${ids} aprovada pelo PMO e commitada. Siga para a próxima, sem esperar o usuário:`,
      taskBrief(phase, next),
      `Ao terminar, rode \`node .claude/scripts/roadmap.mjs done ${next.id}\` e encerre a resposta.`,
    ].join('\n\n'),
  });
}

function openPullRequest(roadmap, phase) {
  const branch = phaseBranch(phase);
  const base = phase.baseBranch ?? roadmap.baseBranch ?? 'main';
  try {
    git(['push', '-u', 'origin', branch]);
  } catch (error) {
    return `O push de ${branch} falhou, abra o PR à mão: ${String(error.stderr ?? error.message).trim()}`;
  }
  const result = spawnSync(
    'gh',
    ['pr', 'create', '--base', base, '--head', branch, '--title', `${phase.id}: ${phase.title}`, '--body-file', '-'],
    { cwd: projectDir, input: pullRequestBody(phase, base), encoding: 'utf8' },
  );
  if (result.status !== 0) return `Branch ${branch} enviada, mas o gh não abriu o PR: ${(result.stderr || String(result.error)).trim()}`;
  return `PR para revisão: ${result.stdout.trim()}`;
}

function pullRequestBody(phase, base) {
  const tasks = phase.tasks.map((t) => [`- [x] **${t.id}** ${t.title}`, ...t.acceptance.map((a) => `  - ${a}`)].join('\n'));
  let commits;
  try {
    commits = git(['log', '--oneline', `${base}..HEAD`]);
  } catch {
    commits = `(não consegui listar os commits desde ${base})`;
  }
  return [
    phase.goal ?? '',
    '## Tasks',
    ...tasks,
    '## Commits',
    'Cada commit é uma task aprovada pelo PMO, depois das verificações do projeto passarem.',
    '```',
    commits,
    '```',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ].join('\n\n');
}

function runChecks() {
  for (const check of checks) {
    const result = spawnSync(check.command, {
      cwd: projectDir,
      shell: true,
      encoding: 'utf8',
      timeout: (check.timeoutSeconds ?? 300) * 1000,
    });
    if (result.status !== 0) {
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ?? ''}`.slice(-OUTPUT_TAIL);
      return `\`${check.command}\` (${check.name ?? 'check'}) saiu com código ${result.status}:\n${output}`;
    }
  }
  return null;
}

function buildPrompt(userRequest, coderAnswer) {
  const reviewed = ctx && (ctx.task ?? tasksFinishedSinceHead(ctx.phase).at(-1));
  return [
    readAgentPrompt('pmo'),
    ...(reviewed ? ['## Task em revisão (modo fase)', taskBrief(ctx.phase, reviewed), `Status no roadmap: ${reviewed.status}`] : []),
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
