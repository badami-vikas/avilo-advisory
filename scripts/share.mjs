#!/usr/bin/env node
/**
 * Publish this machine's Avilo Advisory over a Cloudflare Tunnel.
 *
 * The database and every uploaded file stay on this computer. Cloudflare terminates TLS
 * at its edge and forwards to the loopback port; nothing is stored there, and no inbound
 * port is opened on the machine or the router.
 *
 * The passphrase check lives here, in the only supported way to publish, rather than in
 * documentation. The server's own guard keys on its bind address, and a tunnel binds to
 * 127.0.0.1 like everything else — so without this, publishing would be the one path
 * that silently skips the login gate. AVILO_BEHIND_CLOUDFLARE tells the server it is
 * reachable, which turns the gate on and makes it refuse to start without a passphrase.
 */
import { spawn, spawnSync } from "node:child_process";

const PORT = process.env.AVILO_PORT ?? "5178";

function die(message) {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}

const password = (process.env.AVILO_PASSWORD ?? "").trim();
if (password === "") {
  die(
    "Set a passphrase before publishing.\n\n" +
      "  AVILO_PASSWORD='your long passphrase' pnpm share\n\n" +
      "A Cloudflare Tunnel puts this application on the public internet. It has no user\n" +
      "accounts and no per-record permissions, so the passphrase is the only thing\n" +
      "standing between that URL and every client's financials.",
  );
}
if (password.length < 12) {
  die("AVILO_PASSWORD must be at least 12 characters.");
}

if (spawnSync("cloudflared", ["--version"], { stdio: "ignore" }).status !== 0) {
  die("cloudflared is not installed. Install it with:\n\n  brew install cloudflared");
}

process.stdout.write("\n  Building the web bundle…\n");
const build = spawnSync("pnpm", ["build"], { stdio: "inherit" });
if (build.status !== 0) die("Build failed — not publishing.");

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// The API serves the built bundle itself here, so the browser sees one origin: the
// session cookie covers the app and its data together, and /trpc stays same-origin.
const api = spawn("pnpm", ["--filter", "@avilo/api", "start"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    AVILO_PORT: PORT,
    AVILO_HOST: "127.0.0.1",
    AVILO_BEHIND_CLOUDFLARE: "1",
  },
});
children.push(api);

api.stdout.on("data", (chunk) => process.stdout.write(chunk));
api.stderr.on("data", (chunk) => process.stderr.write(chunk));
api.on("exit", (code) => {
  if (!shuttingDown) {
    process.stderr.write("\n  The API exited. Stopping the tunnel.\n\n");
    shutdown(code ?? 1);
  }
});

// Give the API a moment to bind and run migrations before the tunnel starts probing it.
setTimeout(() => {
  if (shuttingDown) return;

  const tunnel = spawn(
    "cloudflared",
    ["tunnel", "--url", `http://127.0.0.1:${PORT}`, "--no-autoupdate"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(tunnel);

  let announced = false;
  const watch = (chunk) => {
    const text = chunk.toString();
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && !announced) {
      announced = true;
      process.stdout.write(
        [
          "",
          "  ┌────────────────────────────────────────────────────────────",
          "  │  Avilo Advisory is live",
          "  │",
          `  │  ${match[0]}`,
          "  │",
          "  │  Sign in with AVILO_PASSWORD.",
          "  │  Data stays on this machine. The URL dies when you press Ctrl-C,",
          "  │  and a new one is issued next time.",
          "  └────────────────────────────────────────────────────────────",
          "",
        ].join("\n"),
      );
    }
    // cloudflared writes its banner and progress to stderr; only surface real problems.
    if (/ERR|error/i.test(text)) process.stderr.write(text);
  };

  tunnel.stdout.on("data", watch);
  tunnel.stderr.on("data", watch);
  tunnel.on("exit", (code) => {
    if (!shuttingDown) {
      process.stderr.write("\n  The tunnel exited. Stopping the API.\n\n");
      shutdown(code ?? 1);
    }
  });
}, 2500);
