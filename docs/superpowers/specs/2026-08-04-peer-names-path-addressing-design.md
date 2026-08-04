# Peer names, path addressing, and statusline identity

**Date:** 2026-08-04
**Status:** Approved

## Goal

Let Claude Code sessions address each other by something human — a directory
path ("the one in ~/archiver-tools") or a generated name ("goofy-joe") —
instead of opaque 8-char peer IDs, and let each session know and display its
own identity in the status bar.

## Decisions (made with Jason)

1. **Ambiguous path target → error with candidates.** If a path matches more
   than one live peer, the send fails and returns the matching peers (name,
   id, cwd, summary) so the sender re-targets explicitly. No broadcast, no
   "most recent wins".
2. **Name is an alias, not the primary key.** The 8-char ID remains the
   `peers` primary key and message `from_id`/`to_id` foreign key. The name is
   an extra unique column accepted anywhere a target is accepted. ID and
   alias are fully interchangeable as addresses.
3. **Statusline: full wiring.** Ship a `cli.ts statusline` command and wire it
   into `~/.claude/settings.json`, preserving the current cwd + git-branch
   output and replacing the raw `[session_id]` suffix with the peer name.

## Components

### shared/names.ts (new)

- Word lists (adjectives + first names) and `generateName(taken: Set<string>): string`.
- Format: `adjective-noun`, e.g. `goofy-joe`, `eager-eddy`.
- Uniqueness among *live* peers only; a name frees up when its peer dies.
  After exhausting a bounded number of random attempts, append a numeric
  suffix (`goofy-joe-2`) rather than looping forever.

### shared/resolve.ts (new)

Pure function, unit-testable without a broker:

```ts
type Resolution =
  | { kind: "match"; peer: Peer }
  | { kind: "ambiguous"; candidates: Peer[] }
  | { kind: "none" };

resolveTarget(peers: Peer[], target: string, home: string): Resolution
```

Resolution order:
1. Exact ID match.
2. Exact name match (case-insensitive).
3. Path match: expand leading `~` using `home`, normalize (strip trailing
   slash, resolve to absolute). A peer matches if the path equals its `cwd`,
   equals its `git_root`, or is a parent of / equal to either (so
   `~/archiver-tools` finds a session whose cwd is a subdirectory of that
   repo, and vice versa: a peer whose git_root contains the given path).
   Exact cwd matches rank above containment matches; if any exact matches
   exist, only they are considered.

### broker.ts

- Schema: add `name TEXT` and `claude_pid INTEGER` columns via guarded
  `ALTER TABLE` (catch duplicate-column errors) — `~/.claude-peers.db`
  already exists in the wild.
- `/register`: accepts `claude_pid`; assigns a unique name via
  `generateName` over live peers; response becomes `{ id, name }`.
- `/send-message`: `to` field (ID, name, or path) resolved via
  `resolveTarget` over live peers. Legacy `to_id` still honored (treated as
  `to`). Errors:
  - none: `{ ok: false, error: "no peer matches …", peers: [...] }`
  - ambiguous: `{ ok: false, error: "ambiguous …", candidates: [...] }`
- `/list-peers` responses include `name` and `claude_pid` (via `SELECT *`,
  automatic once columns exist).

### server.ts (MCP)

- Registers with `claude_pid: process.ppid`; remembers own `name` from the
  register response.
- `send_message` tool: parameter `to` — "peer ID, peer name, or directory
  path (e.g. ~/archiver-tools)". `to_id` kept as an accepted alias for
  compatibility. Ambiguity/none errors are surfaced verbatim with candidates.
- `whoami` tool (new): returns own `id`, `name`, `cwd`, `git_root`, and
  current summary. Answers locally (no broker round-trip needed for id/name).
- `list_peers` output lines include `Name:`.
- Channel notification meta gains `from_name`.
- `instructions` string updated: mention names, path addressing, `whoami`,
  and that ID and name are interchangeable.

### cli.ts

- `peers` / `status`: show name first (`goofy-joe  a1b2c3d4  PID:… ~/dir`).
- `send <target> <msg>`: target may be ID, name, or path (broker resolves;
  print candidates on ambiguity).
- `whoami`: finds "my" peer by walking this process's ancestor PIDs and
  matching `claude_pid` (the CLI run from inside a Claude session shares an
  ancestor with the MCP server). Fallback: unique cwd match. Prints name + id.
- `statusline`: reads Claude Code statusline JSON on stdin (uses `.cwd`),
  resolves identity the same way as `whoami`, and prints:
  `~/dir (branch) · goofy-joe` with the existing ANSI colors. Any failure
  (broker down, peer not found) degrades to the current output without the
  name — the statusline must never break or block noticeably (short fetch
  timeout, ~300ms).

### settings wiring

Replace the inline jq one-liner in `~/.claude/settings.json`
`statusLine.command` with `bun /home/jason/claude-peers-mcp/cli.ts statusline`.

## Testing

`bun test`:
- `resolveTarget`: id hit, name hit (case-insensitive), exact cwd, tilde
  expansion, trailing slash, git-root containment both directions, exact
  beats containment, ambiguous, none.
- `generateName`: format, uniqueness against taken set, suffix fallback when
  exhausted.

Manual: two registered peers; `cli.ts send` by path and by name; ambiguity
error with two sessions in one dir; `whoami`; statusline output piped a fake
JSON payload.

## Out of scope

Renaming peers, persisting names across peer restarts, broadcast/group
addressing, remote (cross-machine) peers.
