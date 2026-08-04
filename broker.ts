#!/usr/bin/env bun
/**
 * claude-peers broker daemon
 *
 * A singleton HTTP server on localhost:7899 backed by SQLite.
 * Tracks all registered Claude Code peers and routes messages between them.
 *
 * Auto-launched by the MCP server if not already running.
 * Run directly: bun broker.ts
 */

import { Database } from "bun:sqlite";
import type {
  RegisterRequest,
  RegisterResponse,
  HeartbeatRequest,
  SetSummaryRequest,
  ListPeersRequest,
  SendMessageRequest,
  PollMessagesRequest,
  PollMessagesResponse,
  SendMessageResponse,
  Peer,
  Message,
} from "./shared/types.ts";
import { generateName } from "./shared/names.ts";
import { resolveTarget } from "./shared/resolve.ts";

const PORT = parseInt(process.env.CLAUDE_PEERS_PORT ?? "7899", 10);
const DB_PATH = process.env.CLAUDE_PEERS_DB ?? `${process.env.HOME}/.claude-peers.db`;

// Refuse to double-start: SO_REUSEPORT on Linux would let two brokers share
// the port and load-balance requests between them (old + new code at once).
try {
  const res = await fetch(`http://127.0.0.1:${PORT}/health`, {
    signal: AbortSignal.timeout(1000),
  });
  if (res.ok) {
    console.error(`[claude-peers broker] another broker is already on port ${PORT}, exiting`);
    process.exit(0);
  }
} catch {
  // Port is free (or whatever is there isn't a broker) — proceed
}

// --- Database setup ---

const db = new Database(DB_PATH);
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA busy_timeout = 3000");

db.run(`
  CREATE TABLE IF NOT EXISTS peers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    pid INTEGER NOT NULL,
    claude_pid INTEGER,
    cwd TEXT NOT NULL,
    git_root TEXT,
    tty TEXT,
    summary TEXT NOT NULL DEFAULT '',
    registered_at TEXT NOT NULL,
    last_seen TEXT NOT NULL
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    text TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    delivered INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (from_id) REFERENCES peers(id),
    FOREIGN KEY (to_id) REFERENCES peers(id)
  )
`);

// Add columns introduced after the first release (the DB may predate them)
function ensureColumn(colDef: string) {
  try {
    db.run(`ALTER TABLE peers ADD COLUMN ${colDef}`);
  } catch {
    // Column already exists
  }
}
ensureColumn("name TEXT NOT NULL DEFAULT ''");
ensureColumn("claude_pid INTEGER");

// Clean up stale peers (PIDs that no longer exist) on startup
function cleanStalePeers() {
  const peers = db.query("SELECT id, pid FROM peers").all() as { id: string; pid: number }[];
  for (const peer of peers) {
    try {
      // Check if process is still alive (signal 0 doesn't kill, just checks)
      process.kill(peer.pid, 0);
    } catch {
      // Process doesn't exist, remove it
      db.run("DELETE FROM peers WHERE id = ?", [peer.id]);
      db.run("DELETE FROM messages WHERE to_id = ? AND delivered = 0", [peer.id]);
    }
  }
}

cleanStalePeers();

// Periodically clean stale peers (every 30s)
setInterval(cleanStalePeers, 30_000);

// Name peers that registered before the name column existed
function nameUnnamedPeers() {
  const unnamed = db.query("SELECT id FROM peers WHERE name = ''").all() as { id: string }[];
  for (const { id } of unnamed) {
    db.run("UPDATE peers SET name = ? WHERE id = ?", [generateName(takenNames()), id]);
  }
}

function takenNames(): Set<string> {
  const rows = db.query("SELECT name FROM peers WHERE name != ''").all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

nameUnnamedPeers();

// --- Prepared statements ---

const insertPeer = db.prepare(`
  INSERT INTO peers (id, name, pid, claude_pid, cwd, git_root, tty, summary, registered_at, last_seen)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateLastSeen = db.prepare(`
  UPDATE peers SET last_seen = ? WHERE id = ?
`);

const updateSummary = db.prepare(`
  UPDATE peers SET summary = ? WHERE id = ?
`);

const deletePeer = db.prepare(`
  DELETE FROM peers WHERE id = ?
`);

const selectAllPeers = db.prepare(`
  SELECT * FROM peers
`);

const insertMessage = db.prepare(`
  INSERT INTO messages (from_id, to_id, text, sent_at, delivered)
  VALUES (?, ?, ?, ?, 0)
`);

const selectUndelivered = db.prepare(`
  SELECT * FROM messages WHERE to_id = ? AND delivered = 0 ORDER BY sent_at ASC
`);

const markDelivered = db.prepare(`
  UPDATE messages SET delivered = 1 WHERE id = ?
`);

// --- Generate peer ID ---

function generateId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// --- Request handlers ---

function handleRegister(body: RegisterRequest): RegisterResponse {
  const id = generateId();
  const now = new Date().toISOString();

  // Remove any existing registration for this PID (re-registration)
  const existing = db.query("SELECT id FROM peers WHERE pid = ?").get(body.pid) as { id: string } | null;
  if (existing) {
    deletePeer.run(existing.id);
  }

  const name = generateName(takenNames());
  insertPeer.run(
    id,
    name,
    body.pid,
    body.claude_pid ?? null,
    body.cwd,
    body.git_root,
    body.tty,
    body.summary,
    now,
    now
  );
  return { id, name };
}

function handleHeartbeat(body: HeartbeatRequest): void {
  updateLastSeen.run(new Date().toISOString(), body.id);
}

function handleSetSummary(body: SetSummaryRequest): void {
  updateSummary.run(body.summary, body.id);
}

function handleSetName(body: { id: string; name: string }): {
  ok: boolean;
  error?: string;
  name?: string;
} {
  // Normalize to the same shape as generated names: lowercase, dash-separated
  const name = (body.name ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  if (!name || name.length > 64) {
    return { ok: false, error: "Name must be 1-64 characters" };
  }
  const peer = db.query("SELECT id FROM peers WHERE id = ?").get(body.id) as { id: string } | null;
  if (!peer) {
    return { ok: false, error: `Peer ${body.id} not found` };
  }
  const clash = livePeers().find((p) => p.id !== body.id && p.name.toLowerCase() === name);
  if (clash) {
    return { ok: false, error: `Name "${name}" is already taken by peer ${clash.id} in ${clash.cwd}` };
  }
  db.run("UPDATE peers SET name = ? WHERE id = ?", [name, body.id]);
  return { ok: true, name };
}

// All registered peers whose process is still alive (dead ones are pruned)
function livePeers(): Peer[] {
  return (selectAllPeers.all() as Peer[]).filter((p) => {
    try {
      process.kill(p.pid, 0);
      return true;
    } catch {
      // Clean up dead peer
      deletePeer.run(p.id);
      return false;
    }
  });
}

function handleListPeers(body: ListPeersRequest): Peer[] {
  let peers = livePeers();

  switch (body.scope) {
    case "directory":
      peers = peers.filter((p) => p.cwd === body.cwd);
      break;
    case "repo":
      if (body.git_root) {
        peers = peers.filter((p) => p.git_root === body.git_root);
      } else {
        // No git root, fall back to directory
        peers = peers.filter((p) => p.cwd === body.cwd);
      }
      break;
  }

  // Exclude the requesting peer
  if (body.exclude_id) {
    peers = peers.filter((p) => p.id !== body.exclude_id);
  }

  return peers;
}

function handleSendMessage(body: SendMessageRequest): SendMessageResponse {
  const target = body.to ?? body.to_id;
  if (!target) {
    return { ok: false, error: "Missing target: pass `to` (peer ID, name, or path)" };
  }

  // Resolve against live peers, excluding the sender (a path can match yourself)
  const peers = livePeers().filter((p) => p.id !== body.from_id);
  const resolution = resolveTarget(peers, target, process.env.HOME ?? "/");

  if (resolution.kind === "none") {
    return {
      ok: false,
      error: `No peer matches "${target}". Live peers are listed in candidates.`,
      candidates: peers,
    };
  }
  if (resolution.kind === "ambiguous") {
    return {
      ok: false,
      error: `"${target}" matches ${resolution.candidates.length} peers — re-send to one of the candidates by name or ID.`,
      candidates: resolution.candidates,
    };
  }

  const peer = resolution.peer;
  insertMessage.run(body.from_id, peer.id, body.text, new Date().toISOString());
  return { ok: true, to: { id: peer.id, name: peer.name } };
}

function handlePollMessages(body: PollMessagesRequest): PollMessagesResponse {
  const messages = selectUndelivered.all(body.id) as Message[];

  // Mark them as delivered
  for (const msg of messages) {
    markDelivered.run(msg.id);
  }

  return { messages };
}

function handleUnregister(body: { id: string }): void {
  deletePeer.run(body.id);
}

// --- HTTP Server ---

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  reusePort: false,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method !== "POST") {
      if (path === "/health") {
        return Response.json({ status: "ok", peers: (selectAllPeers.all() as Peer[]).length });
      }
      return new Response("claude-peers broker", { status: 200 });
    }

    try {
      const body = await req.json();

      switch (path) {
        case "/register":
          return Response.json(handleRegister(body as RegisterRequest));
        case "/heartbeat":
          handleHeartbeat(body as HeartbeatRequest);
          return Response.json({ ok: true });
        case "/set-summary":
          handleSetSummary(body as SetSummaryRequest);
          return Response.json({ ok: true });
        case "/set-name":
          return Response.json(handleSetName(body as { id: string; name: string }));
        case "/list-peers":
          return Response.json(handleListPeers(body as ListPeersRequest));
        case "/send-message":
          return Response.json(handleSendMessage(body as SendMessageRequest));
        case "/poll-messages":
          return Response.json(handlePollMessages(body as PollMessagesRequest));
        case "/unregister":
          handleUnregister(body as { id: string });
          return Response.json({ ok: true });
        default:
          return Response.json({ error: "not found" }, { status: 404 });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return Response.json({ error: msg }, { status: 500 });
    }
  },
});

console.error(`[claude-peers broker] listening on 127.0.0.1:${PORT} (db: ${DB_PATH})`);
