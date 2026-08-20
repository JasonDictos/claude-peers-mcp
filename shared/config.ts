/**
 * Network configuration, shared by broker, MCP server, and CLI.
 *
 * Peers on other machines talk to one broker over TCP, so both sides need to
 * agree on a URL and a shared token. Config comes from the environment or
 * ~/.claude-peers.json (env wins), so a shell without the env vars — a slash
 * command, a cron job — still finds the remote broker.
 *
 *   { "broker": "http://jason-desktop:7899", "token": "…", "bind": "0.0.0.0" }
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { dirname } from "node:path";
import { hostname } from "node:os";

/**
 * The real user home when running inside a dev container.
 *
 * Dev containers (the een-ports `run_as` pattern) run as `dev_<user>` with
 * the host home bind-mounted at `/home/<user>`, and symlink `~/.claude` into
 * it. Both the network config and the broker socket live in the host home, so
 * a session inside a container has to look there — otherwise it finds no
 * config, falls back to localhost, and silently sees an empty network.
 */
export function hostHome(): string | null {
  const home = process.env.HOME;
  if (!home) return null;

  // A symlinked ~/.claude points straight at the host home
  try {
    const claudeDir = `${home}/.claude`;
    if (lstatSync(claudeDir).isSymbolicLink()) {
      const parent = dirname(realpathSync(claudeDir));
      if (parent && parent !== home) return parent;
    }
  } catch {
    // No ~/.claude, or unreadable — try the naming convention instead
  }

  // run_as names the container user dev_<user>: /home/dev_jason -> /home/jason
  const m = home.match(/^(.*)\/dev_([^/]+)$/);
  if (m && existsSync(`${m[1]}/${m[2]}`)) return `${m[1]}/${m[2]}`;

  return null;
}

/** First path that exists, else the first candidate (the write target). */
export function firstExisting(candidates: string[]): string {
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

export interface PeersConfig {
  /** Remote broker URL. Unset = this machine hosts the broker. */
  broker: string | null;
  /** Shared secret for non-loopback requests. Unset = local-only broker. */
  token: string | null;
  /** Address the broker listens on. Non-loopback requires a token. */
  bind: string;
}

export const CONFIG_PATH =
  process.env.CLAUDE_PEERS_CONFIG ??
  firstExisting(
    [`${process.env.HOME}/.claude-peers.json`, hostHome() && `${hostHome()}/.claude-peers.json`]
      .filter(Boolean) as string[]
  );

function readConfigFile(): Partial<PeersConfig> {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<PeersConfig>;
  } catch {
    // Unreadable or malformed — fall back to env/defaults rather than failing
    return {};
  }
}

export function loadConfig(): PeersConfig {
  const file = readConfigFile();
  return {
    broker: process.env.CLAUDE_PEERS_BROKER ?? file.broker ?? null,
    token: process.env.CLAUDE_PEERS_TOKEN ?? file.token ?? null,
    bind: process.env.CLAUDE_PEERS_BIND ?? file.bind ?? "127.0.0.1",
  };
}

/** Merge values into ~/.claude-peers.json, keeping the file owner-only. */
export function saveConfig(patch: Partial<PeersConfig>): void {
  const merged = { ...readConfigFile(), ...patch };
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2) + "\n");
  chmodSync(CONFIG_PATH, 0o600);
}

export function isLoopbackBind(bind: string): boolean {
  return bind === "127.0.0.1" || bind === "::1" || bind === "localhost";
}

/** True for requests that arrived from this machine (token not required). */
export function isLoopbackAddress(addr: string | null | undefined): boolean {
  if (!addr) return false;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

/**
 * The machine a session belongs to, which is NOT always its hostname: a dev
 * container reports its own container hostname (archiverdev), but it runs on
 * the same machine, in the same bind-mounted directory, as the host session.
 * Treating those as different machines gave the same work two identities —
 * different sticky names and separate mailboxes — so a session that moved
 * into the container lost its name and its queued mail.
 *
 * Host sessions drop a marker in the home directory; containers read it
 * through the same mount they already use to find the config.
 */
export const MACHINE_MARKER = ".claude-peers-host";

export function machineName(): string {
  if (process.env.CLAUDE_PEERS_MACHINE) return process.env.CLAUDE_PEERS_MACHINE;
  const hh = hostHome();
  if (hh) {
    try {
      const marker = readFileSync(`${hh}/${MACHINE_MARKER}`, "utf8").trim();
      if (marker) return marker;
    } catch {
      // No marker yet — fall back to this runtime's own hostname
    }
  }
  return hostname();
}

/**
 * Record this machine's name for containers to find. Only a real host writes
 * it: a container must never overwrite the marker with its own hostname.
 */
export function writeMachineMarker(): void {
  if (hostHome() !== null) return; // we are inside a container
  const path = `${process.env.HOME}/${MACHINE_MARKER}`;
  try {
    const current = existsSync(path) ? readFileSync(path, "utf8").trim() : "";
    if (current !== hostname()) writeFileSync(path, hostname() + "\n");
  } catch {
    // Unwritable home — machineName() falls back to hostname()
  }
}

export function generateToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}
