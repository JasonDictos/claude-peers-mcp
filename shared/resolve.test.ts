import { test, expect, describe } from "bun:test";
import { resolveTarget } from "./resolve.ts";
import type { Peer } from "./types.ts";

const HOME = "/home/jason";

function peer(overrides: Partial<Peer> & { id: string }): Peer {
  return {
    pid: 1000,
    cwd: "/home/jason/somewhere",
    git_root: null,
    tty: null,
    name: "",
    claude_pid: null,
    claude_key: null,
    runtime: null,
    summary: "",
    registered_at: "2026-08-04T00:00:00Z",
    last_seen: "2026-08-04T00:00:00Z",
    ...overrides,
  };
}

const archiver = peer({
  id: "aaaa1111",
  name: "goofy-joe",
  cwd: "/home/jason/archiver-tools",
  git_root: "/home/jason/archiver-tools",
});
const ports = peer({
  id: "bbbb2222",
  name: "eager-eddy",
  cwd: "/home/jason/een-ports/src",
  git_root: "/home/jason/een-ports",
});
const peers = [archiver, ports];

describe("resolveTarget by id", () => {
  test("exact id match", () => {
    const r = resolveTarget(peers, "aaaa1111", HOME);
    expect(r).toEqual({ kind: "match", peer: archiver });
  });
});

describe("resolveTarget by name", () => {
  test("exact name match", () => {
    const r = resolveTarget(peers, "eager-eddy", HOME);
    expect(r).toEqual({ kind: "match", peer: ports });
  });

  test("name match is case-insensitive", () => {
    const r = resolveTarget(peers, "Goofy-Joe", HOME);
    expect(r).toEqual({ kind: "match", peer: archiver });
  });
});

describe("resolveTarget by path", () => {
  test("exact cwd match", () => {
    const r = resolveTarget(peers, "/home/jason/archiver-tools", HOME);
    expect(r).toEqual({ kind: "match", peer: archiver });
  });

  test("tilde expansion", () => {
    const r = resolveTarget(peers, "~/archiver-tools", HOME);
    expect(r).toEqual({ kind: "match", peer: archiver });
  });

  test("trailing slash ignored", () => {
    const r = resolveTarget(peers, "~/archiver-tools/", HOME);
    expect(r).toEqual({ kind: "match", peer: archiver });
  });

  test("path that is the git root finds peer running in a subdirectory", () => {
    const r = resolveTarget(peers, "~/een-ports", HOME);
    expect(r).toEqual({ kind: "match", peer: ports });
  });

  test("subdirectory of a peer's git root finds that peer", () => {
    const r = resolveTarget(peers, "~/een-ports/docs", HOME);
    expect(r).toEqual({ kind: "match", peer: ports });
  });

  test("exact cwd match beats containment match", () => {
    const parent = peer({
      id: "cccc3333",
      name: "mellow-max",
      cwd: "/home/jason",
      git_root: null,
    });
    // "~/archiver-tools" is inside mellow-max's cwd, but exactly goofy-joe's cwd
    const r = resolveTarget([...peers, parent], "~/archiver-tools", HOME);
    expect(r).toEqual({ kind: "match", peer: archiver });
  });

  test("ambiguous path returns all candidates", () => {
    const twin = peer({
      id: "dddd4444",
      name: "zippy-zed",
      cwd: "/home/jason/archiver-tools",
      git_root: "/home/jason/archiver-tools",
    });
    const r = resolveTarget([...peers, twin], "~/archiver-tools", HOME);
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") {
      expect(r.candidates.map((p) => p.id).sort()).toEqual(["aaaa1111", "dddd4444"]);
    }
  });

  test("no match", () => {
    const r = resolveTarget(peers, "~/nonexistent", HOME);
    expect(r).toEqual({ kind: "none" });
  });

  test("prefix that is not a path component does not match", () => {
    // /home/jason/een-ports-backup is not inside /home/jason/een-ports
    const r = resolveTarget(peers, "~/een-ports-backup", HOME);
    expect(r).toEqual({ kind: "none" });
  });
});

describe("resolveTarget agent groups (shared claude_pid)", () => {
  const primary = peer({
    id: "eeee5555",
    name: "goofy-joe",
    cwd: "/home/jason/dproxy",
    claude_pid: 777,
    registered_at: "2026-08-04T10:00:00Z",
  });
  const agent1 = peer({
    id: "ffff6666",
    name: "goofy-joe-1",
    cwd: "/home/jason/dproxy",
    claude_pid: 777,
    registered_at: "2026-08-04T10:05:00Z",
  });
  const agent2 = peer({
    id: "gggg7777",
    name: "goofy-joe-2",
    cwd: "/home/jason/dproxy",
    claude_pid: 777,
    registered_at: "2026-08-04T10:06:00Z",
  });

  test("path matching a session with agents resolves to the primary (earliest registered)", () => {
    const r = resolveTarget([agent2, primary, agent1], "~/dproxy", HOME);
    expect(r).toEqual({ kind: "match", peer: primary });
  });

  test("an agent is still reachable by its suffixed name", () => {
    const r = resolveTarget([primary, agent1, agent2], "goofy-joe-2", HOME);
    expect(r).toEqual({ kind: "match", peer: agent2 });
  });

  test("two distinct sessions in one dir are still ambiguous, candidates are the primaries", () => {
    const other = peer({
      id: "hhhh8888",
      name: "eager-eddy",
      cwd: "/home/jason/dproxy",
      claude_pid: 888,
      registered_at: "2026-08-04T11:00:00Z",
    });
    const otherAgent = peer({
      id: "iiii9999",
      name: "eager-eddy-1",
      cwd: "/home/jason/dproxy",
      claude_pid: 888,
      registered_at: "2026-08-04T11:01:00Z",
    });
    const r = resolveTarget([primary, agent1, agent2, other, otherAgent], "~/dproxy", HOME);
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") {
      expect(r.candidates.map((p) => p.name).sort()).toEqual(["eager-eddy", "goofy-joe"]);
    }
  });

  test("same claude_pid number in different namespaces (distinct claude_key) is not grouped", () => {
    // Host session and container session both have claude pid 1234 — the
    // start-time suffix in claude_key keeps them apart
    const host = peer({
      id: "llll2222",
      name: "host-guy",
      cwd: "/home/jason/dproxy",
      claude_pid: 1234,
      claude_key: "1234:100",
      runtime: "desktop:100",
    });
    const container = peer({
      id: "mmmm3333",
      name: "docker-guy",
      cwd: "/home/jason/dproxy",
      claude_pid: 1234,
      claude_key: "1234:99999",
      runtime: "desktop:99999",
    });
    const r = resolveTarget([host, container], "~/dproxy", HOME);
    expect(r.kind).toBe("ambiguous");
  });

  test("peers without claude_pid are never grouped", () => {
    const a = peer({ id: "jjjj0000", name: "old-one", cwd: "/home/jason/dproxy", claude_pid: null });
    const b = peer({ id: "kkkk1111", name: "old-two", cwd: "/home/jason/dproxy", claude_pid: null });
    const r = resolveTarget([a, b], "~/dproxy", HOME);
    expect(r.kind).toBe("ambiguous");
  });
});

describe("resolveTarget misc", () => {
  test("unknown bare word returns none", () => {
    const r = resolveTarget(peers, "not-a-peer", HOME);
    expect(r).toEqual({ kind: "none" });
  });

  test("empty peer list returns none", () => {
    const r = resolveTarget([], "~/archiver-tools", HOME);
    expect(r).toEqual({ kind: "none" });
  });
});
