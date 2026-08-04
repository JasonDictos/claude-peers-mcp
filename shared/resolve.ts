/**
 * Target resolution: turn a user-supplied target string (peer ID, peer name,
 * or directory path) into a peer. Pure function over a peer list so it can
 * be unit-tested without a broker.
 */

import type { Peer } from "./types.ts";

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

export function resolveTarget(peers: Peer[], target: string, home: string): Resolution {
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

    const matches = exact.length > 0 ? exact : contained;
    if (matches.length === 1) return { kind: "match", peer: matches[0]! };
    if (matches.length > 1) return { kind: "ambiguous", candidates: matches };
  }

  return { kind: "none" };
}
