/**
 * Target resolution: turn a user-supplied target string (peer ID, peer name,
 * or directory path) into a peer. Pure function over a peer list so it can
 * be unit-tested without a broker.
 */

import type { Peer } from "./types.ts";
import { hostMatches } from "./hosts.ts";

export type Resolution =
  | { kind: "match"; peer: Peer }
  | { kind: "ambiguous"; candidates: Peer[] }
  | { kind: "none" };

/** Expand ~, strip trailing slashes. Does not touch relative paths. */
function normalizePath(input: string, home: string): string {
  let p = input;
  if (p === "~") p = home;
  else if (p.startsWith("~/")) p = home + p.slice(1);
  while (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/** True if `child` is `parent` or a path inside it. */
function isSameOrInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + "/");
}

function looksLikePath(target: string): boolean {
  return target.startsWith("~") || target.includes("/") || target === ".";
}

/**
 * Session grouping key: machine + process. Prefers the namespace-safe
 * claude_key (pid + start time), falling back to the bare claude_pid for
 * peers registered before claude_key existed. The host is part of the key
 * because pid numbers — and even pid+starttime — can coincide on two
 * machines, and merging those would swallow one machine's peer. Null =
 * ungroupable standalone peer.
 */
export function sessionKeyOf(
  host: string | null,
  claudeKey: string | null,
  claudePid: number | null
): string | null {
  const scope = host ?? "local";
  if (claudeKey) return `${scope}/${claudeKey}`;
  if (claudePid != null) return `${scope}/pid:${claudePid}`;
  return null;
}

export function sessionKey(p: Peer): string | null {
  return sessionKeyOf(p.host, p.claude_key, p.claude_pid);
}

/**
 * A session running subagents registers several peers sharing one session
 * key. Collapse each such group to its primary (earliest registered) so a
 * path targets the top-level session, not its agents. Peers without a
 * session key stay standalone.
 */
function collapseAgentGroups(matches: Peer[]): Peer[] {
  const standalone: Peer[] = [];
  const groups = new Map<string, Peer[]>();
  for (const p of matches) {
    const key = sessionKey(p);
    if (key == null) {
      standalone.push(p);
    } else {
      const group = groups.get(key) ?? [];
      group.push(p);
      groups.set(key, group);
    }
  }
  const primaries = [...groups.values()].map((group) =>
    group.reduce((a, b) => (a.registered_at <= b.registered_at ? a : b))
  );
  return [...standalone, ...primaries];
}

export function resolveTarget(peers: Peer[], target: string, home: string): Resolution {
  // 0. Host-qualified ("archiver:~/tools", "archiver:goofy-joe", "archiver:").
  //    The same directory exists on several machines, so the host prefix is
  //    how you disambiguate. Only treated as a host if a peer actually lives
  //    there — otherwise it falls through as a plain target.
  const colon = target.indexOf(":");
  if (colon > 0) {
    const host = target.slice(0, colon);
    const rest = target.slice(colon + 1);
    const onHost = peers.filter((p) => hostMatches(p.host, host));
    if (onHost.length > 0) {
      if (!rest) {
        // Bare "archiver:" means that machine's session
        const matches = collapseAgentGroups(onHost);
        if (matches.length === 1) return { kind: "match", peer: matches[0]! };
        return { kind: "ambiguous", candidates: matches };
      }
      return resolveTarget(onHost, rest, home);
    }
  }

  // 1. Exact ID
  const byId = peers.find((p) => p.id === target);
  if (byId) return { kind: "match", peer: byId };

  // 2. Exact name (case-insensitive; names are unique among live peers)
  const lower = target.toLowerCase();
  const byName = peers.find((p) => p.name && p.name.toLowerCase() === lower);
  if (byName) return { kind: "match", peer: byName };

  // 3. Path
  if (looksLikePath(target)) {
    const path = normalizePath(target, home);

    const exact = peers.filter((p) => p.cwd === path || p.git_root === path);
    const contained = peers.filter(
      (p) =>
        isSameOrInside(p.cwd, path) ||
        isSameOrInside(path, p.cwd) ||
        (p.git_root !== null &&
          (isSameOrInside(p.git_root, path) || isSameOrInside(path, p.git_root)))
    );

    const matches = collapseAgentGroups(exact.length > 0 ? exact : contained);
    if (matches.length === 1) return { kind: "match", peer: matches[0]! };
    if (matches.length > 1) return { kind: "ambiguous", candidates: matches };
  }

  return { kind: "none" };
}
