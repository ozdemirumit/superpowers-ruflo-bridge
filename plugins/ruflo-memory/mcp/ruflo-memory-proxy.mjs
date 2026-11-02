#!/usr/bin/env node
// ruflo-memory-proxy
// Exposes ONLY Ruflo's memory tools to Claude Code. Every other Ruflo tool
// (swarm, hive-mind, agent, hooks, task, claims, ...) is hidden and refused.
//
// Startup is decoupled from Ruflo: the proxy answers `initialize` and
// `tools/list` immediately from static schemas, starts Ruflo in the
// background (first run downloads it with npx, which can take ~1 minute) and
// queues tool calls until Ruflo is ready. This keeps Claude Code's MCP
// connection timeout from firing on a cold start.
// Zero dependencies: newline-delimited JSON-RPC over stdio.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const VERSION = '0.2.0';
const RUFLO_VERSION = process.env.RUFLO_VERSION || '3.71.0';
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const log = (...a) => process.stderr.write('[ruflo-memory] ' + a.join(' ') + '\n');

// ---------------------------------------------------------------- tool schemas
const ns = { type: 'string', description: 'Namespace (default: "default"). Suggested: decisions, bugs, environment, patterns.' };
const TOOLS = [
  {
    name: 'memory_store',
    description: 'Store a durable project memory (decision, root cause, environment quirk, pattern) in the persistent Ruflo store. Searchable later by meaning. Upserts by (namespace, key).',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key, unique within the namespace' },
        value: { description: 'Value to store (string or object)' },
        namespace: ns,
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for filtering' },
        ttl: { type: 'number', description: 'Time-to-live in seconds (optional)' },
        upsert: { type: 'boolean', description: 'Update an existing key (default: true)' },
        provenance_type: {
          type: 'string',
          enum: ['user_claim', 'agent_output', 'system_observation', 'tool_result', 'unknown'],
          description: 'Who produced the value (default: "unknown")',
        },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'memory_search',
    description: 'Find stored memories by meaning (vector similarity) across sessions. Use before brainstorming, planning or debugging to recall earlier decisions and known issues.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, in natural language' },
        namespace: { type: 'string', description: 'Namespace to search (omit to search all)' },
        limit: { type: 'number', description: 'Maximum results (default: 10)' },
        threshold: { type: 'number', description: 'Minimum relevance 0-1 (default: 0.2; 0 returns every match)' },
        smart: { type: 'boolean', description: 'Query expansion, fusion and recency ranking (default: false)' },
        provenance_filter: {
          type: 'array',
          items: { type: 'string', enum: ['user_claim', 'agent_output', 'system_observation', 'tool_result', 'unknown'] },
          description: 'Only return entries with these provenance types',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_retrieve',
    description: 'Read a stored memory by exact (namespace, key), including metadata.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string', description: 'Memory key' }, namespace: ns },
      required: ['key'],
    },
  },
  {
    name: 'memory_list',
    description: 'List stored memories, optionally filtered by namespace and tags, without semantic search.',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Filter by namespace' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Entries must have all of these tags' },
        limit: { type: 'number', description: 'Maximum results (default: 50)' },
        offset: { type: 'number', description: 'Pagination offset (default: 0)' },
      },
    },
  },
  {
    name: 'memory_delete',
    description: 'Delete a stored memory by exact (namespace, key), e.g. when a decision is overturned or data is stale.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string', description: 'Memory key' }, namespace: ns },
      required: ['key'],
    },
  },
  {
    name: 'memory_stats',
    description: 'Memory store statistics: entry counts per namespace and embedding coverage (0% means semantic search is falling back to text matching).',
    inputSchema: { type: 'object', properties: {} },
  },
];

const allowedFromEnv = process.env.RUFLO_MEMORY_TOOLS
  ? new Set(process.env.RUFLO_MEMORY_TOOLS.split(',').map((s) => s.trim()).filter(Boolean))
  : null;
const EXPOSED = TOOLS.filter((t) => !allowedFromEnv || allowedFromEnv.has(t.name));
const ALLOWED = new Set(EXPOSED.map((t) => t.name));

// ---------------------------------------------------------------- io helpers
const out = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => out({ jsonrpc: '2.0', id, result });
const toolError = (id, text) => reply(id, { isError: true, content: [{ type: 'text', text }] });

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

// ---------------------------------------------------------------- ruflo child
function findOnPath(name) {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    for (const ext of exts) {
      const p = join(dir, name + ext);
      if (dir && existsSync(p)) return p;
    }
  }
  return null;
}

function rufloCommand() {
  if (process.env.RUFLO_CMD) return { cmd: process.env.RUFLO_CMD, args: ['mcp', 'start'], how: 'RUFLO_CMD' };
  const installed = findOnPath('claude-flow');
  if (installed) return { cmd: installed, args: ['mcp', 'start'], how: 'installed claude-flow' };
  return {
    cmd: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['-y', `@claude-flow/cli@${RUFLO_VERSION}`, 'mcp', 'start'],
    how: `npx @claude-flow/cli@${RUFLO_VERSION}`,
  };
}

let state = 'starting'; // starting | ready | failed
let failure = '';
const queue = [];
const INIT_ID = '__ruflo_memory_init__';
const STARTUP_LIMIT_MS = Number(process.env.RUFLO_STARTUP_TIMEOUT_MS || 300000);

const { cmd, args, how } = rufloCommand();
log(`starting Ruflo via ${how} in ${projectDir}`);
const startedAt = Date.now();
const child = spawn(cmd, args, {
  cwd: projectDir,
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});
child.stderr.on('data', (d) => process.stderr.write(d));

const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');

function fail(reason) {
  if (state === 'failed') return;
  state = 'failed';
  failure = reason;
  log('Ruflo unavailable:', reason);
  while (queue.length) toolError(queue.shift().id, unavailableText());
}

const unavailableText = () =>
  `ruflo-memory is not available: ${failure}. Continue without memory. ` +
  'To fix: install Node.js 18+ with npm access, or pre-install Ruflo with ' +
  `"npm install -g @claude-flow/cli@${RUFLO_VERSION}", then start a new session.`;

child.on('error', (e) => fail(`could not start ${how} (${e.message})`));
child.on('exit', (code) => {
  if (state !== 'ready') fail(`Ruflo exited during startup (code ${code})`);
  else {
    log(`Ruflo exited (code ${code})`);
    state = 'failed';
    failure = 'the Ruflo process stopped';
  }
});

const startupTimer = setTimeout(
  () => state === 'starting' && fail(`Ruflo did not start within ${STARTUP_LIMIT_MS / 1000}s`),
  STARTUP_LIMIT_MS,
);

lineReader(child.stdout, (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // Ruflo banner / log lines
  }
  if (msg.id === INIT_ID) {
    if (msg.error) return fail(`Ruflo initialize failed: ${msg.error.message}`);
    clearTimeout(startupTimer);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    state = 'ready';
    log(`Ruflo ready after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    while (queue.length) send(queue.shift());
    return;
  }
  // Only responses to forwarded calls go back to Claude Code. Ruflo's own
  // notifications (e.g. tools/list_changed) are dropped: the tool list is static.
  if (msg.id === undefined || (msg.result === undefined && msg.error === undefined)) return;
  const errText = msg.error?.message || (msg.result?.isError ? msg.result.content?.[0]?.text : '') || '';
  if (/policy-(anchor|ledger)-/.test(errText)) return toolError(msg.id, policyHelp(errText));
  out(msg);
});

function policyHelp(errText) {
  const trust = join(process.env.XDG_CONFIG_HOME || join(process.env.HOME || process.env.USERPROFILE || '~', '.config'), 'ruflo', 'policy-trust');
  return (
    `Ruflo refused the call (${errText.match(/policy-[a-z-]+/)?.[0]}). This happens when the project's ` +
    '.claude-flow/ folder was deleted or reset while Ruflo still holds its tamper-protection record for this ' +
    `project under ${trust}/<sha256 of project path>. Continue without memory and tell the user. Fix (user): ` +
    'run "node <plugin>/mcp/reset-ruflo-trust.mjs" in the project root (it removes only this project\'s record and ' +
    'the local .claude-flow/policy folder; stored memories in .swarm/ are kept), then start a new session.'
  );
}

send({
  jsonrpc: '2.0',
  id: INIT_ID,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ruflo-memory-proxy', version: VERSION } },
});

// ---------------------------------------------------------------- claude side
lineReader(process.stdin, (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  const isRequest = id !== undefined && method;

  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: params?.protocolVersion || '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'ruflo-memory', version: VERSION },
      instructions:
        'Persistent project memory backed by Ruflo. Only memory tools are available; ' +
        'orchestration (plans, subagents, parallel work) is handled by Superpowers.',
    });
  }
  if (!isRequest) return; // notifications from Claude Code are handled locally
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: EXPOSED });
  if (method === 'resources/list') return reply(id, { resources: [] });
  if (method === 'prompts/list') return reply(id, { prompts: [] });

  if (method === 'tools/call') {
    if (!ALLOWED.has(params?.name)) {
      return toolError(
        id,
        `Tool "${params?.name}" is disabled by ruflo-memory. Only memory tools are exposed; ` +
          'orchestration (subagents, plans, parallel work) is handled by Superpowers.',
      );
    }
    if (state === 'failed') return toolError(id, unavailableText());
    const call = { jsonrpc: '2.0', id, method, params };
    return state === 'ready' ? send(call) : queue.push(call);
  }

  out({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not supported: ${method}` } });
});

process.stdin.on('end', () => {
  child.stdin.end();
  setTimeout(() => process.exit(0), 2000).unref();
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { child.kill(sig); process.exit(0); });
