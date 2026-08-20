import { test, expect, describe } from "bun:test";
import { hostMatches, shortHost, isIpAddress, localAddresses } from "./hosts.ts";

describe("shortHost", () => {
  test("lowercases and strips the domain", () => {
    expect(shortHost("Archiver.Lan")).toBe("archiver");
  });

  test("drops a trailing root dot", () => {
    expect(shortHost("archiver.lan.")).toBe("archiver");
  });

  test("leaves IPs intact", () => {
    expect(shortHost("10.1.1.4")).toBe("10.1.1.4");
  });
});

describe("hostMatches", () => {
  test("exact match", () => {
    expect(hostMatches("archiver", "archiver")).toBe(true);
  });

  test("short name matches an FQDN registration", () => {
    expect(hostMatches("archiver.lan", "archiver")).toBe(true);
  });

  test("FQDN matches a short registration", () => {
    expect(hostMatches("archiver", "archiver.lan")).toBe(true);
  });

  test("case and trailing dot are ignored", () => {
    expect(hostMatches("archiver.lan", "ARCHIVER.")).toBe(true);
  });

  test("different machines do not match", () => {
    expect(hostMatches("archiver", "jason-desktop")).toBe(false);
  });

  test("a prefix is not a match", () => {
    expect(hostMatches("archiver2", "archiver")).toBe(false);
  });

  test("null host never matches", () => {
    expect(hostMatches(null, "archiver")).toBe(false);
  });

  test("empty target never matches", () => {
    expect(hostMatches("archiver", "  ")).toBe(false);
  });
});

describe("localAddresses", () => {
  test("keeps routable IPv4, drops loopback/link-local/docker bridges", () => {
    const addrs = localAddresses({
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      br0: [{ address: "10.1.1.4", family: "IPv4", internal: false }],
      tun0: [{ address: "100.96.4.5", family: "IPv4", internal: false }],
      docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
      "br-9425beec": [{ address: "172.18.0.1", family: "IPv4", internal: false }],
      eth9: [{ address: "169.254.1.1", family: "IPv4", internal: false }],
      eth0: [{ address: "fe80::1", family: "IPv6", internal: false }],
    });
    expect(addrs).toEqual(["10.1.1.4", "100.96.4.5"]);
  });
});

describe("isIpAddress", () => {
  test("v4 and v6", () => {
    expect(isIpAddress("10.1.1.4")).toBe(true);
    expect(isIpAddress("fe80::1")).toBe(true);
    expect(isIpAddress("archiver")).toBe(false);
  });
});
