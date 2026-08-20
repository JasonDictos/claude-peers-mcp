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

import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";

export interface PeersConfig {
  /** Remote broker URL. Unset = this machine hosts the broker. */
  broker: string | null;
  /** Shared secret for non-loopback requests. Unset = local-only broker. */
  token: string | null;
  /** Address the broker listens on. Non-loopback requires a token. */
  bind: string;
}

export const CONFIG_PATH =
  process.env.CLAUDE_PEERS_CONFIG ?? `${process.env.HOME}/.claude-peers.json`;

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

export function generateToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}
