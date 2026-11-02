#!/usr/bin/env node
// ruflo-memory-proxy
// Starts the Ruflo (claude-flow) MCP server as a child process and exposes ONLY
// its memory tools to Claude Code. Every other Ruflo tool (swarm, hive-mind,
// agent, hooks, task, claims, ...) is hidden from tools/list and refused on
// tools/call. Zero dependencies: plain newline-delimited JSON-RPC over stdio.

import { spawn } from 'node:child_process';

const ALLOWED = new Set(
  (process.env.RUFLO_MEMORY_TOOLS ||
    'memory_store,memory_search,memory_retrieve,memory_list,memory_delete,memory_stats')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const RUFLO_VERSION = process.env.RUFLO_VERSION || '3.71.0';
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const log = (...a) => process.stderr.write('[ruflo-memory] ' + a.join(' ') + '\n');

// Ruflo writes .swarm/ and .claude-flow/ into its working directory.
const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['-y', `@claude-flow/cli@${RUFLO_VERSION}`, 'mcp', 'start'],
  { cwd: projectDir, stdio: ['pipe', 'pipe', 'inherit'], shell: process.platform === 'win32' },
);

child.on('error', (e) => {
  log('could not start Ruflo:', e.message);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));

const pendingToolsList = new Set();
const send = (stream, msg) => stream.write(JSON.stringify(msg) + '\n');

function lineReader(stream, onLine) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  });
}

// Claude Code -> Ruflo
lineReader(process.stdin, (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return child.stdin.write(line + '\n');
  }
  if (msg.method === 'tools/list' && msg.id !== undefined) pendingToolsList.add(msg.id);
  if (msg.method === 'tools/call' && !ALLOWED.has(msg.params?.name)) {
    return send(process.stdout, {
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        isError: true,
        content: [{
          type: 'text',
          text: `Tool "${msg.params?.name}" is disabled by ruflo-memory. Only memory tools are exposed; ` +
            'orchestration (subagents, plans, parallel work) is handled by Superpowers.',
        }],
      },
    });
  }
  send(child.stdin, msg);
});
process.stdin.on('end', () => child.stdin.end());

// Ruflo -> Claude Code
lineReader(child.stdout, (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return log('non-JSON output from Ruflo dropped:', line.slice(0, 200));
  }
  if (msg.id !== undefined && pendingToolsList.has(msg.id)) {
    pendingToolsList.delete(msg.id);
    if (msg.result?.tools) {
      msg.result.tools = msg.result.tools.filter((t) => ALLOWED.has(t.name));
      delete msg.result.nextCursor;
    }
  }
  send(process.stdout, msg);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
