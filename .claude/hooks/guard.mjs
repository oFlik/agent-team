// PreToolUse: deterministic guardrails. Unlike a rule in CLAUDE.md, no agent can forget or talk past these.
// Bash commands are matched by text, so this stops mistakes and shortcuts, not a determined adversary.
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { loadConfig, projectDir, readHookInput, respond } from './team-state.mjs';
import { autopilotContext, git } from '../scripts/roadmap.mjs';

// Patterns without "/" match the file name anywhere; a leading "/" anchors them to the project root.
const DEFAULTS = {
  enabled: true,
  secretPaths: ['.env', '.env.*', '**/*.pem', '**/*.key', '**/id_rsa*', '**/id_ed25519*', '**/credentials*.json'],
  allowedPaths: ['.env.example', '.env.sample'],
  blockedCommands: [
    '\\bgit\\b.*\\bpush\\b.*(--force|\\s-f\\b)',
    '\\bgit\\b.*\\bpush\\b.*\\s(\\S+:)?(main|master)\\b',
    '\\brm\\s+(-{1,2}[\\w-]+\\s+)*(/|~|\\*|\\.)(\\s|$)',
    '\\b(curl|wget)\\b[^|]*\\|\\s*(sh|bash|zsh|pwsh|iex)\\b',
    '\\bgh\\s+pr\\s+merge\\b',
  ],
  // During a phase the Stop hook owns commits, pushes and the branch; the coder must not move them.
  autopilotBlockedCommands: [
    '\\bgit(\\s+-[Cc]\\s+\\S+)*\\s+(commit|push|switch|checkout|reset|rebase|merge|stash|cherry-pick|tag|branch\\s+-[dDmM])\\b',
  ],
  autopilotProtectedPaths: ['/.claude/**', '/ROADMAP.md', '/CLAUDE.md'],
};
const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const SAFE_SEGMENT = /^\s*(node\s+\.claude\/scripts\/roadmap\.mjs\b|(cat|head|tail|ls|grep|rg|wc)\b|git\s+(diff|status|log|show)\b)/;
const CASE_FLAG = ['win32', 'darwin'].includes(process.platform) ? 'i' : '';

const input = await readHookInput();
let reason;
try {
  const guard = { ...DEFAULTS, ...loadConfig().guard };
  if (guard.enabled) reason = check(guard);
} catch (error) {
  // A guard that crashes would let everything through, so a broken config blocks instead.
  reason = `o guard não conseguiu avaliar a chamada (${error.message}); corrija .claude/team.json`;
}
if (reason) {
  respond({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Bloqueado pelo guard do time (.claude/team.json): ${reason}`,
    },
  });
}

function check(guard) {
  const autopilot = inPhase();
  const isSecret = (path) => matchesAny(path, guard.secretPaths) && !matchesAny(path, guard.allowedPaths);

  if (input.tool_name !== 'Bash') {
    const tool = input.tool_input ?? {};
    const target = tool.file_path ?? tool.notebook_path ?? tool.path;
    if (!target) return null;
    if (isSecret(target)) return `${target} é um arquivo de segredo`;
    if (autopilot && WRITE_TOOLS.includes(input.tool_name) && matchesAny(target, guard.autopilotProtectedPaths)) {
      return `${target} é configuração do time e não pode ser editado durante uma fase`;
    }
    return null;
  }

  const command = input.tool_input?.command ?? '';
  const hit = (patterns) => patterns.find((p) => new RegExp(p, CASE_FLAG).test(command));
  const blocked = hit(guard.blockedCommands) ?? (autopilot ? hit(guard.autopilotBlockedCommands) : undefined);
  if (blocked) return `o comando casa com a regra /${blocked}/`;

  const tokensOf = (text) => text.split(/[\s'"`=<>|;&()]+/).filter(Boolean);
  const secret = tokensOf(command).find(isSecret);
  if (secret) return `o comando menciona o arquivo de segredo ${secret}`;
  if (!autopilot) return null;

  // Each chained command is judged alone, so a harmless prefix cannot cover a write after it.
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    if (SAFE_SEGMENT.test(segment) && !segment.includes('>')) continue;
    const protectedPath = tokensOf(segment).find((t) => matchesAny(t, guard.autopilotProtectedPaths));
    if (protectedPath) return `o comando mexe em ${protectedPath}, que é configuração do time durante uma fase`;
  }
  return null;
}

// An unreadable roadmap must not switch the phase rules off; the branch name still tells a phase is running.
function inPhase() {
  try {
    return Boolean(autopilotContext());
  } catch {
    try {
      return git(['rev-parse', '--abbrev-ref', 'HEAD']).startsWith('fase/');
    } catch {
      return false;
    }
  }
}

function matchesAny(path, patterns) {
  const absolute = resolve(projectDir, path);
  const rel = relative(projectDir, absolute);
  const inside = !rel.startsWith('..') && !isAbsolute(rel);
  const target = (inside ? rel : absolute).replaceAll('\\', '/');
  return patterns.some((pattern) => {
    if (pattern.startsWith('/')) return inside && globToRegExp(pattern.slice(1)).test(target);
    return globToRegExp(pattern).test(pattern.includes('/') ? target : basename(target));
  });
}

function globToRegExp(glob) {
  // "dir/**" also matches "dir" itself, so `cd .claude` counts as touching it.
  const [body, suffix] = glob.endsWith('/**') ? [glob.slice(0, -3), '(?:/.*)?'] : [glob, ''];
  const source = body
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map((part) => ({ '**/': '(?:.*/)?', '**': '.*', '*': '[^/]*', '?': '[^/]' })[part] ?? part.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
    .join('');
  return new RegExp(`^${source}${suffix}$`, CASE_FLAG);
}
