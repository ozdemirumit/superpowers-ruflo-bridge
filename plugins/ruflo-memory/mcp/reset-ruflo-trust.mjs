#!/usr/bin/env node
// Repairs "policy-anchor-log-missing" / "policy-ledger-truncated" errors.
//
// Ruflo keeps a tamper-protection record for each project outside the project,
// in <XDG_CONFIG_HOME or ~/.config>/ruflo/policy-trust/<sha256(project path)>.
// If the project's .claude-flow/ folder is deleted or reset (git clean, fresh
// checkout in the same path, manual cleanup) Ruflo refuses every call.
//
// This script removes ONLY that project's record and its .claude-flow/policy
// folder. Stored memories in .swarm/ are kept.
//
// Usage (in the project root):  node <path-to-plugin>/mcp/reset-ruflo-trust.mjs [projectDir]

import { createHash } from 'node:crypto';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const project = realpathSync(process.argv[2] || process.cwd());
const id = createHash('sha256').update(project).digest('hex');
const roots = [
  process.env.XDG_CONFIG_HOME && join(process.env.XDG_CONFIG_HOME, 'ruflo', 'policy-trust'),
  join(homedir(), '.config', 'ruflo', 'policy-trust'),
].filter(Boolean);

let removed = 0;
for (const target of [...roots.map((r) => join(r, id)), join(project, '.claude-flow', 'policy')]) {
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    console.log('removed', target);
    removed++;
  }
}
console.log(removed ? `Done for ${project}. Start a new Claude Code session.` : `Nothing to reset for ${project}.`);
