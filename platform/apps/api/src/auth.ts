// Access control.
//
// This application was written to bind to loopback, where "no authentication" is a
// correct design: the only reachable client is the person at the keyboard. Hosting it
// changes that premise completely, and nothing else in the codebase would notice — the
// dashboard would render one client's financials to anyone who found the URL.
//
// So the gate is tied to the bind address rather than to a flag someone can forget.
// Binding off loopback without a passphrase is a startup error, not a warning: a
// deployment that is accidentally public should fail loudly at boot, when someone is
// watching, rather than serve quietly.

import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "node:crypto";

const COOKIE_NAME = "avilo_session";
/** Sessions last a working day; a laptop left open overnight re-authenticates. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface AuthConfig {
  /** False when running on loopback with no passphrase set — the local-first default. */
  enabled: boolean;
  passwordHash: Buffer | null;
  secret: string;
  /** Set the Secure cookie flag. Off for plain-HTTP loopback, on for a hosted deploy. */
  secureCookies: boolean;
}

export function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/**
 * Decide the access-control posture from the environment.
 *
 * Throws when the combination is unsafe rather than picking a default, because both
 * plausible defaults are wrong: refusing to run breaks local use, and running open
 * exposes client data.
 */
export function resolveAuth(host: string, password: string | undefined): AuthConfig {
  const trimmed = (password ?? "").trim();
  const loopback = isLoopback(host);

  if (!loopback && trimmed === "") {
    throw new Error(
      `Refusing to bind to ${host} without a passphrase.\n\n` +
        `This application has no user accounts and no per-record permissions — every\n` +
        `client's financials are visible to anyone who can reach it. On loopback that\n` +
        `is safe. On a public address it is not.\n\n` +
        `Set AVILO_PASSWORD to enable the login gate, or leave AVILO_HOST unset to bind\n` +
        `to 127.0.0.1 as before.`,
    );
  }

  if (trimmed === "") {
    return { enabled: false, passwordHash: null, secret: "", secureCookies: false };
  }

  if (trimmed.length < 12) {
    throw new Error(
      "AVILO_PASSWORD must be at least 12 characters. This is the only thing standing " +
        "between a public URL and every client's financials.",
    );
  }

  return {
    enabled: true,
    passwordHash: createHash("sha256").update(trimmed).digest(),
    // Deriving the signing key from the passphrase means changing the passphrase
    // invalidates every outstanding session, which is the behaviour someone rotating it
    // after a leak expects. An explicit secret is honoured when sessions must survive
    // a rotation.
    secret:
      process.env.AVILO_SESSION_SECRET ??
      createHmac("sha256", "avilo-session").update(trimmed).digest("hex"),
    secureCookies: !loopback,
  };
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function issueSession(config: AuthConfig): string {
  const expires = Date.now() + SESSION_TTL_MS;
  // The nonce makes two sessions issued in the same millisecond distinct, so a stolen
  // cookie cannot be confused with a freshly issued one in the audit trail.
  const payload = `${expires}.${randomBytes(9).toString("base64url")}`;
  return `${payload}.${sign(payload, config.secret)}`;
}

export function verifySession(cookie: string | undefined, config: AuthConfig): boolean {
  if (!cookie) return false;
  const index = cookie.lastIndexOf(".");
  if (index <= 0) return false;

  const payload = cookie.slice(0, index);
  const provided = Buffer.from(cookie.slice(index + 1));
  const expected = Buffer.from(sign(payload, config.secret));

  if (provided.length !== expected.length) return false;
  if (!timingSafeEqual(provided, expected)) return false;

  const expires = Number(payload.split(".")[0]);
  return Number.isFinite(expires) && expires > Date.now();
}

export function checkPassword(attempt: string, config: AuthConfig): boolean {
  if (!config.passwordHash) return false;
  const provided = createHash("sha256").update(attempt).digest();
  return timingSafeEqual(provided, config.passwordHash);
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function sessionCookie(value: string, config: AuthConfig): string {
  const attributes = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (config.secureCookies) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearedCookie(config: AuthConfig): string {
  const attributes = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (config.secureCookies) attributes.push("Secure");
  return attributes.join("; ");
}

export { COOKIE_NAME };

/**
 * A crude per-address throttle on the login endpoint.
 *
 * A single shared passphrase is guessable at machine speed, and this endpoint is the
 * whole security boundary. In-memory is proportionate for a single-instance deployment;
 * it resets on restart, which an attacker cannot trigger.
 */
const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

export function throttle(address: string): { allowed: boolean; retryAfter: number } {
  const record = attempts.get(address);
  if (record && record.until > Date.now() && record.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfter: Math.ceil((record.until - Date.now()) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

export function recordFailure(address: string): void {
  const now = Date.now();
  const record = attempts.get(address);
  if (!record || record.until <= now) {
    attempts.set(address, { count: 1, until: now + LOCKOUT_MS });
    return;
  }
  record.count += 1;
  record.until = now + LOCKOUT_MS;
}

export function clearFailures(address: string): void {
  attempts.delete(address);
}
