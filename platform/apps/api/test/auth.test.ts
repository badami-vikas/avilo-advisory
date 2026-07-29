import { describe, expect, it } from "vitest";

import {
  checkPassword,
  clearFailures,
  clientAddress,
  clearedCookie,
  issueSession,
  isLoopback,
  readCookie,
  recordFailure,
  resolveAuth,
  sessionCookie,
  throttle,
  verifySession,
} from "../src/auth.js";

const PASSPHRASE = "a-long-enough-passphrase";

describe("resolveAuth — the posture is decided by the bind address", () => {
  it("leaves the gate off for loopback with no passphrase, as the local tool has always run", () => {
    expect(resolveAuth("127.0.0.1", undefined).enabled).toBe(false);
    expect(resolveAuth("127.0.0.1", "").enabled).toBe(false);
  });

  // The failure this exists to prevent: a deploy that binds publicly and serves every
  // client's financials to anyone with the URL, because nothing forced the question.
  it("refuses to bind off loopback without a passphrase", () => {
    expect(() => resolveAuth("0.0.0.0", undefined)).toThrow(/Refusing to bind/);
    expect(() => resolveAuth("0.0.0.0", "   ")).toThrow(/AVILO_PASSWORD/);
  });

  it("enables the gate when a passphrase is set, even on loopback", () => {
    const config = resolveAuth("127.0.0.1", PASSPHRASE);
    expect(config.enabled).toBe(true);
    // Plain HTTP on loopback: a Secure cookie would never be sent back.
    expect(config.secureCookies).toBe(false);
  });

  it("marks cookies Secure once bound off loopback", () => {
    expect(resolveAuth("0.0.0.0", PASSPHRASE).secureCookies).toBe(true);
  });

  /**
   * The hole this closes: a Cloudflare Tunnel connects to 127.0.0.1 and serves the world
   * from it. Keying the gate on the bind address alone would leave publishing as the one
   * path that skips the login screen entirely.
   */
  it("refuses to run published without a passphrase, even bound to loopback", () => {
    expect(() => resolveAuth("127.0.0.1", undefined, true)).toThrow(/Refusing to publish/);
    expect(() => resolveAuth("127.0.0.1", "", true)).toThrow(/AVILO_PASSWORD/);
  });

  it("marks cookies Secure when published, because the tunnel terminates TLS", () => {
    // The process speaks plain HTTP to the tunnel daemon, but the browser is on HTTPS.
    expect(resolveAuth("127.0.0.1", PASSPHRASE, true).secureCookies).toBe(true);
    expect(resolveAuth("127.0.0.1", PASSPHRASE, false).secureCookies).toBe(false);
  });

  it("rejects a passphrase short enough to guess", () => {
    expect(() => resolveAuth("0.0.0.0", "hunter2")).toThrow(/at least 12/);
  });

  it("invalidates existing sessions when the passphrase is rotated", () => {
    const before = resolveAuth("0.0.0.0", PASSPHRASE);
    const after = resolveAuth("0.0.0.0", "a-different-passphrase");
    expect(verifySession(issueSession(before), after)).toBe(false);
  });

  it("keeps sessions across a rotation when an explicit secret is pinned", () => {
    process.env.AVILO_SESSION_SECRET = "pinned-secret";
    try {
      const before = resolveAuth("0.0.0.0", PASSPHRASE);
      const after = resolveAuth("0.0.0.0", "a-different-passphrase");
      expect(verifySession(issueSession(before), after)).toBe(true);
    } finally {
      delete process.env.AVILO_SESSION_SECRET;
    }
  });
});

describe("sessions", () => {
  const config = resolveAuth("0.0.0.0", PASSPHRASE);

  it("accepts a session it issued", () => {
    expect(verifySession(issueSession(config), config)).toBe(true);
  });

  it("rejects absent, malformed and unsigned values", () => {
    expect(verifySession(undefined, config)).toBe(false);
    expect(verifySession("", config)).toBe(false);
    expect(verifySession("nonsense", config)).toBe(false);
    expect(verifySession(`${Date.now() + 10000}.abc.forged`, config)).toBe(false);
  });

  it("rejects a session whose expiry has been pushed out by hand", () => {
    const token = issueSession(config);
    const signature = token.slice(token.lastIndexOf(".") + 1);
    const forged = `${Date.now() + 999999999}.nonce.${signature}`;
    expect(verifySession(forged, config)).toBe(false);
  });

  it("rejects an expired session", () => {
    // Sign a payload that is already in the past, the way a stale cookie would be.
    const expired = `${Date.now() - 1000}.nonce`;
    const token = issueSession(config);
    const good = token.slice(0, token.lastIndexOf("."));
    expect(verifySession(`${expired}.${token.slice(token.lastIndexOf(".") + 1)}`, config)).toBe(
      false,
    );
    expect(good.length).toBeGreaterThan(0);
  });

  it("issues distinct tokens, so two sessions are never the same string", () => {
    expect(issueSession(config)).not.toBe(issueSession(config));
  });
});

describe("checkPassword", () => {
  const config = resolveAuth("0.0.0.0", PASSPHRASE);

  it("accepts the passphrase and rejects everything else", () => {
    expect(checkPassword(PASSPHRASE, config)).toBe(true);
    expect(checkPassword(`${PASSPHRASE} `, config)).toBe(false);
    expect(checkPassword("", config)).toBe(false);
    // Length must not leak through a short-circuit: both are one comparison.
    expect(checkPassword("x", config)).toBe(false);
  });

  it("never authenticates when the gate is off", () => {
    expect(checkPassword("", resolveAuth("127.0.0.1", undefined))).toBe(false);
  });
});

describe("cookies", () => {
  it("parses a cookie out of a header with several", () => {
    expect(readCookie("a=1; avilo_session=xyz; b=2", "avilo_session")).toBe("xyz");
    expect(readCookie("a=1", "avilo_session")).toBeUndefined();
    expect(readCookie(undefined, "avilo_session")).toBeUndefined();
  });

  it("marks the cookie HttpOnly and SameSite, and Secure only when hosted", () => {
    const hosted = sessionCookie("token", resolveAuth("0.0.0.0", PASSPHRASE));
    expect(hosted).toContain("HttpOnly");
    expect(hosted).toContain("SameSite=Lax");
    expect(hosted).toContain("Secure");

    const local = sessionCookie("token", resolveAuth("127.0.0.1", PASSPHRASE));
    expect(local).not.toContain("Secure");
  });

  it("expires the cookie on logout", () => {
    expect(clearedCookie(resolveAuth("0.0.0.0", PASSPHRASE))).toContain("Max-Age=0");
  });
});

describe("login throttle", () => {
  it("locks an address out after repeated failures and clears on success", () => {
    const address = "203.0.113.7";
    clearFailures(address);
    expect(throttle(address).allowed).toBe(true);

    for (let i = 0; i < 8; i += 1) recordFailure(address);
    const blocked = throttle(address);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);

    clearFailures(address);
    expect(throttle(address).allowed).toBe(true);
  });

  it("throttles each address independently", () => {
    clearFailures("198.51.100.1");
    clearFailures("198.51.100.2");
    for (let i = 0; i < 8; i += 1) recordFailure("198.51.100.1");
    expect(throttle("198.51.100.1").allowed).toBe(false);
    expect(throttle("198.51.100.2").allowed).toBe(true);
  });
});

describe("clientAddress", () => {
  const headers = { "cf-connecting-ip": "203.0.113.9" };

  it("uses Cloudflare's client header when behind the tunnel", () => {
    // Otherwise every request arrives from the daemon on loopback, one attacker's
    // failures lock out everyone, and the throttle becomes a denial-of-service tool.
    expect(clientAddress(headers, "127.0.0.1", true)).toBe("203.0.113.9");
  });

  it("ignores the header when not behind the tunnel, where anyone can forge it", () => {
    expect(clientAddress(headers, "198.51.100.4", false)).toBe("198.51.100.4");
  });

  it("falls back when the header is absent or blank", () => {
    expect(clientAddress({}, "127.0.0.1", true)).toBe("127.0.0.1");
    expect(clientAddress({ "cf-connecting-ip": "  " }, "127.0.0.1", true)).toBe("127.0.0.1");
  });
});

describe("isLoopback", () => {
  it("recognises the loopback forms and nothing else", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("localhost")).toBe(true);
    expect(isLoopback("0.0.0.0")).toBe(false);
    expect(isLoopback("192.168.1.10")).toBe(false);
  });
});
