import { test, expect, describe } from "bun:test";
import { generateName, ADJECTIVES, NOUNS } from "./names.ts";

describe("generateName", () => {
  test("produces adjective-noun format", () => {
    const name = generateName(new Set());
    const [adj = "", noun = ""] = name.split("-");
    expect(ADJECTIVES as readonly string[]).toContain(adj);
    expect(NOUNS as readonly string[]).toContain(noun);
  });

  test("avoids taken names", () => {
    // Take everything except one specific combo
    const taken = new Set<string>();
    for (const a of ADJECTIVES) {
      for (const n of NOUNS) {
        if (!(a === ADJECTIVES[0] && n === NOUNS[0])) taken.add(`${a}-${n}`);
      }
    }
    const name = generateName(taken);
    expect(name).toBe(`${ADJECTIVES[0]}-${NOUNS[0]}`);
  });

  test("falls back to numeric suffix when all combos are taken", () => {
    const taken = new Set<string>();
    for (const a of ADJECTIVES) {
      for (const n of NOUNS) {
        taken.add(`${a}-${n}`);
      }
    }
    const name = generateName(taken);
    expect(name).toMatch(/^[a-z]+-[a-z]+-\d+$/);
    expect(taken.has(name)).toBe(false);
  });

  test("successive calls with accumulating taken set never collide", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const name = generateName(taken);
      expect(taken.has(name)).toBe(false);
      taken.add(name);
    }
  });
});
