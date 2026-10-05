import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

const claudeDir = join(projectDir, '.claude');
const stateDir = join(claudeDir, 'state');

// The PMO runs as a child `claude -p` that loads these same hooks; this flag keeps it from reviewing itself.
export const CHILD_ROLE_ENV = 'AGENT_TEAM_ROLE';

export function isChildSession() {
  return Boolean(process.env[CHILD_ROLE_ENV]);
}

export async function readHookInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function loadConfig() {
  const file = join(claudeDir, 'team.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

function stateFile(sessionId) {
  return join(stateDir, `${sessionId}.json`);
}

export function loadState(sessionId) {
  const file = stateFile(sessionId);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { prompt: '', rounds: 0, fingerprint: '' };
}

export function saveState(sessionId, state) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile(sessionId), JSON.stringify(state, null, 2));
}

export function readAgentPrompt(name) {
  const text = readFileSync(join(claudeDir, 'agents', `${name}.md`), 'utf8');
  return text.replace(/^---[\s\S]*?---\s*/, '');
}

// Lets the gate tell whether this turn touched files, so pure Q&A turns skip the review.
export function workTreeFingerprint() {
  const git = (args) => {
    try {
      return execSync(`git ${args}`, { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return '';
    }
  };
  const snapshot = git('status --porcelain') + git('diff') + git('diff --cached');
  return createHash('sha256').update(snapshot).digest('hex');
}

export function respond(output) {
  process.stdout.write(JSON.stringify(output));
}
