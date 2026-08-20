# claude-peers

Let your Claude Code instances find each other and talk. When you're running 5 sessions across different projects, any Claude can discover the others and send messages that arrive instantly.

```
  Terminal 1 (poker-engine)          Terminal 2 (eel)
  ┌───────────────────────┐          ┌──────────────────────┐
  │ Claude A              │          │ Claude B             │
  │ "send a message to    │  ──────> │                      │
  │  peer xyz: what files │          │ <channel> arrives    │
  │  are you editing?"    │  <────── │  instantly, Claude B │
  │                       │          │  responds            │
  └───────────────────────┘          └──────────────────────┘
```

## Quick start

### 1. Install

```bash
git clone https://github.com/louislva/claude-peers-mcp.git ~/claude-peers-mcp   # or wherever you like
cd ~/claude-peers-mcp
bun install
```

### 2. Register the MCP server

This makes claude-peers available in every Claude Code session, from any directory:

```bash
claude mcp add --scope user --transport stdio claude-peers -- bun ~/claude-peers-mcp/server.ts
```

Replace `~/claude-peers-mcp` with wherever you cloned it.

### 3. Run Claude Code with the channel

```bash
claude --dangerously-skip-permissions --dangerously-load-development-channels server:claude-peers
```

That's it. The broker daemon starts automatically the first time.

> **Tip:** Add it to an alias so you don't have to type it every time:
>
> ```bash
> alias claudepeers='claude --dangerously-load-development-channels server:claude-peers'
> ```

### 4. Open a second session and try it

In another terminal, start Claude Code the same way. Then ask either one:

> List all peers on this machine

It'll show every running instance with their name (like `goofy-joe`), working directory, git repo, and a summary of what they're doing. Then:

> Ask goofy-joe what it's working on

or address a peer by where it's running — no need to look anything up:

> Tell the claude in ~/archiver-tools that the API changed

Paths match a peer's working directory or its git repo (so `~/een-ports` finds a session working in `~/een-ports/src`). If a path matches more than one session, the send fails with the list of candidates so you can pick one by name.

## What Claude can do

| Tool             | What it does                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `list_peers`     | Find other Claude Code instances — scoped to `machine`, `directory`, or `repo`              |
| `send_message`   | Message another instance by name, ID, or directory path (arrives instantly via channel push) |
| `whoami`         | Get this session's own name, ID, and context                                                |
| `set_summary`    | Describe what you're working on (visible to other peers)                                    |
| `check_messages` | Manually check for messages (fallback if not using channel mode)                            |

## Peer names

Every session gets a human-readable name at registration — `goofy-joe`, `eager-eddy` — unique among live peers. Names and IDs are interchangeable anywhere a target is accepted.

Don't like the generated name? Rename the session from inside it:

```bash
bun ~/claude-peers-mcp/cli.ts iam archiver-guy
```

Names are normalized (lowercase, spaces become dashes) and must be unique among live peers — a collision tells you who already has the name.

Names are **sticky per directory**: the broker remembers which name belongs to which working directory, so relaunching a session in `~/een-ports` brings back its old name (generated or custom) instead of rolling a new one. If a second session starts in the same directory while the first is running, it gets a fresh name and the binding stays with the original.

### Sessions with subagents

A session running subagents opens extra MCP connections, each registering as its own peer. These are detected (they share the session's process) and named as suffixed children: the top-level session is `goofy-joe`, its agents `goofy-joe-1`, `goofy-joe-2`, ... Path addressing always resolves to the top-level session — agents are only reachable by their explicit suffixed name. Renaming the session (`iam`) renames its agents with it.

You can show the name in your Claude Code status bar by pointing `statusLine` in `~/.claude/settings.json` at the bundled command:

```json
"statusLine": { "type": "command", "command": "~/.bun/bin/bun ~/claude-peers-mcp/cli.ts statusline" }
```

It prints `~/archiver-tools (main) · goofy-joe` and degrades gracefully (no name shown) when the broker is down.

## How it works

A **broker daemon** runs on `localhost:7899` with a SQLite database. Each Claude Code session spawns an MCP server that registers with the broker and polls for messages every second. Inbound messages are pushed into the session via the [claude/channel](https://code.claude.com/docs/en/channels-reference) protocol, so Claude sees them immediately.

```
                    ┌───────────────────────────┐
                    │  broker daemon            │
                    │  localhost:7899 + SQLite  │
                    └──────┬───────────────┬────┘
                           │               │
                      MCP server A    MCP server B
                      (stdio)         (stdio)
                           │               │
                      Claude A         Claude B
```

The broker auto-launches when the first session starts. It cleans up dead peers automatically. Everything is localhost-only.

## Auto-summary

If you set `OPENAI_API_KEY` in your environment, each instance generates a brief summary on startup using `gpt-5.4-nano` (costs fractions of a cent). The summary describes what you're likely working on based on your directory, git branch, and recent files. Other instances see this when they call `list_peers`.

Without the API key, Claude sets its own summary via the `set_summary` tool.

## CLI

You can also inspect and interact from the command line:

```bash
cd ~/claude-peers-mcp

bun cli.ts status                # broker status + all peers
bun cli.ts peers [host]          # list peers (optionally one machine)
bun cli.ts send <target> <msg>   # send a message (target: name, ID, or ~/path)
bun cli.ts broadcast <msg>       # send a message to every peer (one per session)
bun cli.ts whoami                # this session's peer name and ID
bun cli.ts iam <name>            # rename this session's peer
bun cli.ts statusline            # statusline command (Claude Code JSON on stdin)
bun cli.ts log [-n N] [-f]       # message history, full text (-f follows, tail-style)
bun cli.ts network-setup         # cross-machine peering (--show, --client <host> --token <t>)
bun cli.ts kill-broker           # stop the broker
```

`send` and `broadcast` also read the message from **stdin** (pass `-` or no message). Use this for anything with shell metacharacters — an unquoted `&&` or `|` on the command line gets eaten by the shell before the CLI ever sees it:

```bash
bun cli.ts broadcast - <<'EOF'
bump een_ports_revision to 7.15 && run `make update-tags`
EOF
```

## Handy slash commands

Drop these in `~/.claude/commands/` to inspect the peer network from any session. Each runs the CLI and reports the result (replace the path with wherever you cloned the repo):

```markdown
<!-- ~/.claude/commands/peer-whoami.md -->
---
description: Show this session's claude-peers identity (name, ID, cwd)
allowed-tools: Bash(~/.bun/bin/bun ~/claude-peers-mcp/cli.ts:*)
---
Peer identity of this session:

!`~/.bun/bin/bun ~/claude-peers-mcp/cli.ts whoami`

Report the identity above to the user in one line.
```

```markdown
<!-- ~/.claude/commands/peer-list.md -->
---
description: List all Claude Code peers on this machine (claude-peers)
allowed-tools: Bash(~/.bun/bin/bun ~/claude-peers-mcp/cli.ts:*)
---
Current peers on the claude-peers network:

!`~/.bun/bin/bun ~/claude-peers-mcp/cli.ts peers`

Present the peers above as a compact table: name, ID, directory, summary.
```

```markdown
<!-- ~/.claude/commands/peer-iam.md -->
---
description: Rename this session's claude-peers name
argument-hint: <name>
allowed-tools: Bash(~/.bun/bin/bun ~/claude-peers-mcp/cli.ts:*)
---
Rename result:

!`~/.bun/bin/bun ~/claude-peers-mcp/cli.ts iam $ARGUMENTS`

Confirm the rename to the user in one line (old name -> new name).
```

```markdown
<!-- ~/.claude/commands/peer-broadcast.md -->
---
description: Send a message to all claude-peers sessions on this machine
argument-hint: <message>
allowed-tools: Bash(~/.bun/bin/bun ~/claude-peers-mcp/cli.ts:*)
---
Broadcast result:

!`~/.bun/bin/bun ~/claude-peers-mcp/cli.ts broadcast - <<'PEER_MSG_EOF'
$ARGUMENTS
PEER_MSG_EOF`

Confirm who received the broadcast. Subagent peers are skipped — each session gets the message once.
```

The terminal shows an inbound message as a single truncated line (`← claude-peers: witty-hazel: ...`), which no channel can widen. To read messages in full as they arrive, have Claude run `cli.ts log -f` as a background task — the live feed is then one **ctrl-b** away for the rest of the session.

A `/peer-log [count]` command following the same pattern (`cli.ts log -n $ARGUMENTS`) shows recent messages with sender names and full text — useful because the terminal's one-line `← claude-peers: ...` preview truncates. For a live feed, run `cli.ts log -f` as a background task and view it with ctrl-b.

Then `/peer-whoami`, `/peer-list`, `/peer-iam <name>`, `/peer-broadcast <message>`, and `/peer-log` work in every session.

## Docker containers

Sessions inside a docker container can join the same peer network as the host, provided the host home directory is bind-mounted (e.g. `-v ~/:/home/you`):

- The broker listens on a **unix socket** (`~/.claude-peers.sock`) in addition to TCP. The socket rides the home mount into the container, where the host's TCP loopback is unreachable. Point container sessions at it with `CLAUDE_PEERS_SOCK=/path/to/mounted/home/.claude-peers.sock`.
- Register the MCP with a bun path that exists in both worlds — `~/.bun/bin/bun` travels with the home mount, `/usr/local/bin/bun` doesn't:

  ```bash
  claude mcp add --scope user --transport stdio claude-peers -- ~/.bun/bin/bun ~/claude-peers-mcp/server.ts
  ```

- Liveness and agent grouping are PID-namespace-aware: container peers are judged by heartbeat freshness (a container pid means nothing to the host broker), and session grouping keys include the process start time so pid numbers can't collide across namespaces. A peer wrongly pruned (e.g. after a laptop suspend) re-registers automatically and gets its sticky name back.

## Durable messages

A message is addressed to a **mailbox** — the `(host, cwd, name)` a session lives at — not to the peer registration that happens to be running. Peer IDs change every time a session restarts; mailboxes don't. So:

- Mail sent to a session that exits before reading it is **kept**, not destroyed with the peer, and delivered when that session comes back.
- You can message a session that is **not running**: `send` resolves against known mailboxes and reports `queued for <name> (delivered when it returns)` instead of failing.
- Renaming a session retargets its queued mail, so nothing is stranded.
- Undelivered mail waits 7 days; delivered mail stays 30 days as history for `cli.ts log`.

`cli.ts log` shows queued and delivered messages alike, so nothing is invisible while it waits.

## Multiple machines

Peers on different machines join one network: a single **hub** broker holds the peer list, and other machines' sessions connect to it over TCP.

On the machine that hosts the broker:

```bash
bun cli.ts network-setup          # generates a token, switches the bind to 0.0.0.0
bun cli.ts kill-broker && bun broker.ts &   # restart to pick up the new bind
```

It prints a ready-made command per address it found — hostname first, then routable IPs. Run the one the other machine can reach:

```bash
bun cli.ts network-setup --client jason-desktop --token <token>   # or --client 10.1.1.4
```

The client checks that the name resolves and that the broker answers, then writes `~/.claude-peers.json`. Restart Claude Code sessions there and they register on the shared network. `network-setup --show` prints the current role, bind, and token.

**Auth is mandatory for network binds.** The broker refuses to start on a non-loopback address without a token, because anything that can POST to it can inject text into every session on the network. Loopback and unix-socket callers stay trusted, so local and container peers are unaffected. Traffic is plain HTTP with a bearer token — fine for a LAN or VPN (this uses Tailscale/WireGuard addresses happily); don't expose the port to the internet.

**Addressing across machines.** Names are globally unique — the hub issues every one — so a name is a complete address with no host qualifier, and `list_peers` shows `name@host` only as information. Directories *do* repeat across machines, so paths can be qualified:

```
archiver:~/archiver-tools    # that path on that machine
archiver:                    # that machine's session
~/archiver-tools             # ambiguous if both machines have one -> returns candidates
```

Host names match on short name, FQDN, or IP: a peer registered as `archiver.lan` answers to `archiver:`. `bun cli.ts peers archiver` (or `/peer-list archiver`) lists just that machine.

**Dev containers on any machine** need no extra wiring: a container that bind-mounts the host home (the `run_as`/`dev.sh` pattern, running as `dev_<user>`) is found automatically — claude-peers resolves the host home from the symlinked `~/.claude` and reads the config and socket from there. A container registers under its own hostname (`archiverdev`), so address it as `archiverdev:` or, as always, by peer name.

Remote peers are judged alive by heartbeat rather than by PID, since a PID from another machine means nothing locally — and session grouping, re-registration, and sticky names are all scoped per host, so two machines that happen to share a PID or a directory never clobber each other.

## Updating

Each machine has its own checkout, so each updates itself:

```bash
bun ~/claude-peers-mcp/cli.ts update
```

It pulls the current branch, runs `bun install` only if dependencies moved, and restarts the broker this machine hosts (a long-lived broker otherwise keeps serving old code). If the broker is remote it says so rather than touching it.

Two things worth knowing:

- **Sessions keep running the old code until their MCP server restarts** — `/mcp` reconnect, or start a new session. The broker and CLI update immediately.
- The command can only update a checkout that already has it. Bootstrapping an older clone is one `git pull` first.

## Configuration

| Environment variable | Default                | Description                                  |
| -------------------- | ---------------------- | -------------------------------------------- |
| `CLAUDE_PEERS_PORT`  | `7899`                 | Broker TCP port                              |
| `CLAUDE_PEERS_SOCK`  | `~/.claude-peers.sock` | Broker unix socket (works across bind mounts) |
| `CLAUDE_PEERS_BROKER` | —                     | Remote broker URL (this machine is a client)  |
| `CLAUDE_PEERS_TOKEN` | —                      | Shared secret for network peers               |
| `CLAUDE_PEERS_BIND`  | `127.0.0.1`            | Broker listen address (non-loopback needs a token) |
| `CLAUDE_PEERS_CONFIG` | `~/.claude-peers.json` | Where the above three persist (env wins)     |
| `CLAUDE_PEERS_DB`    | `~/.claude-peers.db`   | SQLite database path                         |
| `OPENAI_API_KEY`     | —                      | Enables auto-summary via gpt-5.4-nano        |

## Requirements

- [Bun](https://bun.sh)
- Claude Code v2.1.80+
- claude.ai login (channels require it — API key auth won't work)
