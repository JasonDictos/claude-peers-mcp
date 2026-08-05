/**
 * Broker client transport shared by server.ts and cli.ts.
 *
 * Prefers the unix domain socket (~/.claude-peers.sock): it rides bind mounts
 * into docker containers where the host's TCP loopback is unreachable. Falls
 * back to TCP on localhost when the socket doesn't exist or nothing listens
 * on it. Inside a container, CLAUDE_PEERS_SOCK points at the socket within
 * the mounted host home (the container's own $HOME differs).
 */

import { existsSync } from "node:fs";

export const BROKER_PORT = parseInt(process.env.CLAUDE_PEERS_PORT ?? "7899", 10);
export const BROKER_URL = `http://127.0.0.1:${BROKER_PORT}`;
export const SOCKET_PATH =
  process.env.CLAUDE_PEERS_SOCK ?? `${process.env.HOME}/.claude-peers.sock`;

function isConnectionFailure(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.message} ${(e as { code?: string }).code ?? ""}` : String(e);
  return /ECONNREFUSED|ECONNRESET|ENOENT|ENOTSOCK|failed to connect|unable to connect/i.test(msg);
}

export async function brokerFetch<T>(path: string, body?: unknown, timeoutMs = 3000): Promise<T> {
  const init: RequestInit = {
    signal: AbortSignal.timeout(timeoutMs),
    ...(body !== undefined
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  };

  let res: Response;
  if (existsSync(SOCKET_PATH)) {
    try {
      res = await fetch(`http://localhost${path}`, { ...init, unix: SOCKET_PATH });
    } catch (e) {
      // Stale socket file (no listener) — fall back to TCP. Anything else
      // (timeout, abort) propagates.
      if (!isConnectionFailure(e)) throw e;
      res = await fetch(`${BROKER_URL}${path}`, init);
    }
  } else {
    res = await fetch(`${BROKER_URL}${path}`, init);
  }

  if (!res.ok) {
    throw new Error(`${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}
