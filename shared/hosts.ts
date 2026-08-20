/**
 * Hostname handling for cross-machine peers.
 *
 * The same machine answers to several names: the short hostname it reports
 * (`archiver`), an FQDN from DNS or search domains (`archiver.lan`), and its
 * IP. Addressing a peer must not depend on which form you happen to type, and
 * a broker URL must be built from a name the other machine can actually
 * resolve.
 */

import { lookup } from "node:dns/promises";

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function isIpAddress(h: string): boolean {
  return IPV4.test(h) || h.includes(":");
}

/** Canonical comparison form: lowercase, no trailing dot, domain stripped. */
export function shortHost(h: string): string {
  const clean = h.trim().toLowerCase().replace(/\.$/, "");
  if (isIpAddress(clean)) return clean;
  const dot = clean.indexOf(".");
  return dot > 0 ? clean.slice(0, dot) : clean;
}

/**
 * True if `target` names the machine `peerHost` refers to. Matches exactly,
 * or on short names, so "archiver", "archiver.lan", and "ARCHIVER." all hit a
 * peer registered as "archiver.lan".
 */
export function hostMatches(peerHost: string | null | undefined, target: string): boolean {
  if (!peerHost) return false;
  const a = peerHost.trim().toLowerCase().replace(/\.$/, "");
  const b = target.trim().toLowerCase().replace(/\.$/, "");
  if (!b) return false;
  return a === b || shortHost(a) === shortHost(b);
}

/** First address a hostname resolves to, or null when it doesn't resolve. */
export async function resolveHost(host: string): Promise<string | null> {
  if (isIpAddress(host)) return host;
  try {
    const { address } = await lookup(host);
    return address;
  } catch {
    return null;
  }
}

/**
 * Addresses of this machine that a peer elsewhere could connect to, best
 * first: routable LAN/VPN IPv4 only — loopback, link-local, and docker bridge
 * ranges are useless to a remote peer.
 */
export function localAddresses(interfaces: Record<string, { address: string; family: string | number; internal: boolean }[] | undefined>): string[] {
  const out: string[] = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const a of addrs ?? []) {
      const isV4 = a.family === "IPv4" || a.family === 4;
      if (!isV4 || a.internal) continue;
      if (a.address.startsWith("169.254.")) continue;
      // docker0 / br-* bridges are reachable only from this machine's containers
      if (/^(docker|br-)/.test(name)) continue;
      out.push(a.address);
    }
  }
  return out;
}
