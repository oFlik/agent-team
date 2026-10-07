// Roadmap of phases and tasks: the JSON is the source of truth for the hooks, ROADMAP.md is the human view.
// Run directly as a CLI (`node .claude/scripts/roadmap.mjs <command>`) or import it from the hooks.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
export const roadmapFile = join(projectDir, '.claude', 'roadmap.json');
const markdownFile = join(projectDir, 'ROADMAP.md');

const TASK_STATUSES = ['todo', 'doing', 'done', 'blocked'];
const PHASE_STATUSES = ['todo', 'doing', 'review', 'done'];
const STATUS_LABEL = { todo: 'a fazer', doing: 'em andamento', done: 'concluída', blocked: 'bloqueada', review: 'em revisão' };

export function git(args) {
  return execFileSync('git', args, { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function loadRoadmap() {
  return existsSync(roadmapFile) ? JSON.parse(readFileSync(roadmapFile, 'utf8')) : null;
}

export function saveRoadmap(roadmap) {
  writeFileSync(roadmapFile, `${JSON.stringify(roadmap, null, 2)}\n`);
  writeFileSync(markdownFile, renderMarkdown(roadmap));
}

export function validateRoadmap(roadmap) {
  const errors = [];
  const ids = new Set();
  // Ids become branch names and commit subjects, so they stay short and case-insensitively unique.
  const claimId = (id, where) => {
    if (!id) errors.push(`${where}: falta "id"`);
    else if (!/^[A-Za-z0-9._-]+$/.test(id)) errors.push(`${where}: id "${id}" só pode ter letras, números, ".", "_" e "-"`);
    else if (ids.has(id.toLowerCase())) errors.push(`${where}: id "${id}" repetido`);
    else ids.add(id.toLowerCase());
  };
  if (!Array.isArray(roadmap?.phases)) return ['"phases" precisa ser uma lista'];
  const malformed = roadmap.phases.some((p) => !p || typeof p !== 'object' || (p.tasks ?? []).some((t) => !t || typeof t !== 'object'));
  if (malformed) return ['toda fase e toda task precisam ser objetos'];
  for (const phase of roadmap.phases) {
    claimId(phase.id, `fase ${phase.id ?? '?'}`);
    if (!PHASE_STATUSES.includes(phase.status)) errors.push(`fase ${phase.id}: status "${phase.status}" inválido`);
    if (!Array.isArray(phase.tasks) || phase.tasks.length === 0) errors.push(`fase ${phase.id}: precisa de tasks`);
    for (const task of phase.tasks ?? []) {
      claimId(task.id, `task ${task.id ?? '?'}`);
      if (!TASK_STATUSES.includes(task.status)) errors.push(`task ${task.id}: status "${task.status}" inválido`);
      if (!Array.isArray(task.acceptance) || task.acceptance.length === 0) errors.push(`task ${task.id}: precisa de critérios de aceite`);
    }
    if ((phase.tasks ?? []).filter((t) => t.status === 'doing').length > 1) errors.push(`fase ${phase.id}: mais de uma task em andamento`);
  }
  if (roadmap.phases.filter((p) => p.status === 'doing').length > 1) errors.push('mais de uma fase em andamento');
  return errors;
}

export function phaseBranch(phase) {
  return `fase/${phase.id.toLowerCase()}`;
}

function currentBranch() {
  try {
    return git(['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch {
    return '';
  }
}

// Autopilot is on only while a phase is "doing" and the repo is checked out on that phase's branch.
export function autopilotContext() {
  const roadmap = loadRoadmap();
  const phase = roadmap?.phases?.find((p) => p.status === 'doing');
  if (!phase || currentBranch() !== phaseBranch(phase)) return null;
  return { roadmap, phase, task: phase.tasks.find((t) => t.status === 'doing') ?? null };
}

// Tasks marked done in the working tree but not yet in HEAD: the work the next commit closes.
export function tasksFinishedSinceHead(phase) {
  let headPhase;
  try {
    headPhase = JSON.parse(git(['show', 'HEAD:.claude/roadmap.json'])).phases.find((p) => p.id === phase.id);
  } catch {
    headPhase = null;
  }
  const doneAtHead = new Set((headPhase?.tasks ?? []).filter((t) => t.status === 'done').map((t) => t.id));
  return phase.tasks.filter((t) => t.status === 'done' && !doneAtHead.has(t.id));
}

export function taskBrief(phase, task) {
  return [
    `Fase ${phase.id}: ${phase.title}`,
    `Task ${task.id}: ${task.title}`,
    task.scope ? `Escopo: ${task.scope}` : '',
    'Critérios de aceite:',
    ...task.acceptance.map((item) => `- ${item}`),
    task.note ? `Nota: ${task.note}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function renderMarkdown(roadmap) {
  const lines = [
    `# Roadmap${roadmap.project ? ` · ${roadmap.project}` : ''}`,
    '',
    '> Gerado a partir de `.claude/roadmap.json`. Não edite este arquivo; ele é reescrito a cada mudança de status.',
    '',
  ];
  for (const phase of roadmap.phases) {
    lines.push(`## ${phase.id} · ${phase.title} (${STATUS_LABEL[phase.status] ?? phase.status})`, '');
    if (phase.goal) lines.push(phase.goal, '');
    for (const task of phase.tasks) {
      const box = task.status === 'done' ? '[x]' : '[ ]';
      const flag = task.status === 'done' || task.status === 'todo' ? '' : ` _(${STATUS_LABEL[task.status]})_`;
      lines.push(`- ${box} **${task.id}** ${task.title}${flag}`);
      if (task.scope) lines.push(`  - Escopo: ${task.scope}`);
      for (const item of task.acceptance ?? []) lines.push(`  - Aceite: ${item}`);
      if (task.note) lines.push(`  - Nota: ${task.note}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function findTask(roadmap, taskId) {
  for (const phase of roadmap.phases) {
    const task = phase.tasks.find((t) => t.id === taskId);
    if (task) return { phase, task };
  }
  throw new Error(`task "${taskId}" não existe no roadmap`);
}

function requireActiveTask(roadmap, taskId) {
  const { phase, task } = findTask(roadmap, taskId);
  if (phase.status !== 'doing') throw new Error(`a fase ${phase.id} não está em andamento`);
  if (task.status !== 'doing') throw new Error(`a task ${task.id} não está em andamento (status: ${task.status})`);
  requirePhaseBranch(phase);
  return { phase, task };
}

function requirePhaseBranch(phase) {
  if (currentBranch() !== phaseBranch(phase)) throw new Error(`mude para a branch ${phaseBranch(phase)} antes de mexer na fase ${phase.id}`);
}

const commands = {
  status(roadmap) {
    const phase = roadmap.phases.find((p) => p.status === 'doing');
    if (!phase) return 'Nenhuma fase em andamento.';
    const task = phase.tasks.find((t) => t.status === 'doing');
    return task ? taskBrief(phase, task) : `Fase ${phase.id} em andamento, sem task ativa.`;
  },

  validate(roadmap) {
    const errors = validateRoadmap(roadmap);
    if (errors.length) throw new Error(`roadmap inválido:\n- ${errors.join('\n- ')}`);
    return 'Roadmap válido.';
  },

  render(roadmap) {
    saveRoadmap(roadmap);
    return 'ROADMAP.md atualizado.';
  },

  'start-phase'(roadmap, [phaseId]) {
    commands.validate(roadmap);
    const phase = roadmap.phases.find((p) => p.id === phaseId);
    if (!phase) throw new Error(`fase "${phaseId}" não existe no roadmap`);
    const running = roadmap.phases.find((p) => p.status === 'doing');
    if (running) throw new Error(`a fase ${running.id} ainda está em andamento`);
    if (phase.status === 'done') throw new Error(`a fase ${phase.id} já foi concluída`);
    if (git(['status', '--porcelain'])) throw new Error('há mudanças não commitadas; commite ou descarte antes de começar a fase');
    if (currentBranch() === 'HEAD') throw new Error('o repositório está em detached HEAD; vá para a branch base da fase antes');
    const task = phase.tasks.find((t) => t.status === 'todo');
    if (!task) throw new Error(`a fase ${phase.id} não tem tasks a fazer`);

    // A phase in review whose PR got merged is the only way to reach this point with it still open.
    for (const other of roadmap.phases) if (other.status === 'review') other.status = 'done';
    phase.baseBranch = currentBranch();
    phase.status = 'doing';
    task.status = 'doing';
    git(['switch', '-c', phaseBranch(phase)]);
    saveRoadmap(roadmap);
    return `Branch ${phaseBranch(phase)} criada a partir de ${phase.baseBranch}.\n\n${taskBrief(phase, task)}`;
  },

  done(roadmap, [taskId]) {
    const { task } = requireActiveTask(roadmap, taskId);
    task.status = 'done';
    saveRoadmap(roadmap);
    return `Task ${task.id} marcada como concluída. Encerre a resposta: o PMO revisa e o hook commita.`;
  },

  block(roadmap, [taskId, ...reason]) {
    if (reason.length === 0) throw new Error('diga o motivo: block <task> <motivo>');
    const { task } = requireActiveTask(roadmap, taskId);
    task.status = 'blocked';
    task.note = reason.join(' ');
    saveRoadmap(roadmap);
    return `Task ${task.id} bloqueada. Encerre a resposta explicando ao usuário o que precisa ser decidido.`;
  },

  resume(roadmap, [taskId]) {
    const { phase, task } = findTask(roadmap, taskId);
    if (phase.status !== 'doing') throw new Error(`a fase ${phase.id} não está em andamento`);
    if (task.status !== 'blocked') throw new Error(`a task ${task.id} não está bloqueada`);
    requirePhaseBranch(phase);
    if (phase.tasks.some((t) => t.status === 'doing')) throw new Error(`já há uma task em andamento na fase ${phase.id}`);
    task.status = 'doing';
    saveRoadmap(roadmap);
    return taskBrief(phase, task);
  },
};

function main([command = 'status', ...args]) {
  const roadmap = loadRoadmap();
  if (!existsSync(roadmapFile)) throw new Error('não existe .claude/roadmap.json (veja .claude/roadmap.example.json)');
  const run = commands[command];
  if (!run) throw new Error(`comando desconhecido "${command}". Use: ${Object.keys(commands).join(', ')}`);
  commands.validate(roadmap);
  return run(roadmap, args);
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  try {
    console.log(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`roadmap: ${error.stderr?.toString().trim() || error.message}`);
    process.exit(1);
  }
}
