import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostHome, firstExisting } from "./config.ts";

const originalHome = process.env.HOME;
const madeDirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "peers-cfg-"));
  madeDirs.push(dir);
  return dir;
}

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const d of madeDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("hostHome", () => {
  test("follows a symlinked ~/.claude to the host home (container case)", () => {
    // /home/jason (host, bind-mounted) and /home/dev_jason (container user)
    const root = scratch();
    const host = join(root, "jason");
    const container = join(root, "dev_jason");
    mkdirSync(join(host, ".claude"), { recursive: true });
    mkdirSync(container);
    symlinkSync(join(host, ".claude"), join(container, ".claude"));

    process.env.HOME = container;
    expect(hostHome()).toBe(host);
  });

  test("falls back to the dev_<user> naming convention", () => {
    const root = scratch();
    mkdirSync(join(root, "jason"));
    const container = join(root, "dev_jason");
    mkdirSync(container); // no ~/.claude symlink at all

    process.env.HOME = container;
    expect(hostHome()).toBe(join(root, "jason"));
  });

  test("null on a normal host home", () => {
    const root = scratch();
    const home = join(root, "jason");
    mkdirSync(join(home, ".claude"), { recursive: true }); // real dir, not a link
    process.env.HOME = home;
    expect(hostHome()).toBeNull();
  });

  test("null when dev_<user> has no matching host home", () => {
    const root = scratch();
    const container = join(root, "dev_nobody");
    mkdirSync(container);
    process.env.HOME = container;
    expect(hostHome()).toBeNull();
  });
});

describe("firstExisting", () => {
  test("returns the first path that exists", () => {
    const dir = scratch();
    const real = join(dir, "there.json");
    writeFileSync(real, "{}");
    expect(firstExisting([join(dir, "missing.json"), real])).toBe(real);
  });

  test("falls back to the first candidate as the write target", () => {
    const dir = scratch();
    const target = join(dir, "a.json");
    expect(firstExisting([target, join(dir, "b.json")])).toBe(target);
  });
});
