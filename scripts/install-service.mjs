#!/usr/bin/env node
/**
 * Install Avilo Advisory as a background service on this Mac.
 *
 * After this, http://127.0.0.1:5180 is simply always there — it survives logout, reboot
 * and closing every terminal window. Bookmark it and it behaves like any other app.
 *
 * One process serves both the API and the built web bundle, which is why there is a
 * single port here rather than the two that `pnpm dev` uses. It stays bound to loopback,
 * so it is reachable only from this machine and needs no passphrase; publishing it to
 * the internet is a separate, deliberate act (`pnpm share`).
 *
 *   pnpm app:install     install and start
 *   pnpm app:uninstall   stop and remove
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LABEL = "com.avilo.advisory";
// Deliberately not 5178. The installed service runs permanently with KeepAlive, and
// `pnpm dev` also wants 5178 for its API — sharing the port would mean the dev server
// silently failing to bind every time. Both can run at once on separate ports, over the
// same SQLite file, which WAL mode is designed for.
const PORT = "5180";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agentsDir = join(homedir(), "Library", "LaunchAgents");
const plistPath = join(agentsDir, `${LABEL}.plist`);
const logDir = join(homedir(), "Library", "Logs", "Avilo Advisory");

const uninstall = process.argv.includes("--uninstall");

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

function die(message) {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}

/* ------------------------------------------------------------- uninstall */

if (uninstall) {
  // `bootout` is the modern form; `unload` covers older macOS. Either may legitimately
  // fail if the service was never loaded, so neither is treated as fatal.
  run("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`]);
  run("launchctl", ["unload", "-w", plistPath]);
  if (existsSync(plistPath)) unlinkSync(plistPath);
  process.stdout.write(
    "\n  Avilo Advisory service removed. Your data is untouched:\n" +
      `  ${join(homedir(), "Documents", "Bridge", "Avilo Advisory")}\n\n`,
  );
  process.exit(0);
}

/* --------------------------------------------------------------- install */

// launchd starts with a bare environment — no nvm, no Homebrew, no shell profile. The
// interpreter and package manager have to be recorded as absolute paths now, while a
// normal shell is still available to find them.
const pnpmPath = run("which", ["pnpm"]).stdout.trim();
if (!pnpmPath) die("pnpm is not on PATH. Run this from a shell where `pnpm -v` works.");

const nodePath = run("which", ["node"]).stdout.trim();
if (!nodePath) die("node is not on PATH.");
const nodeDir = dirname(nodePath);

process.stdout.write("\n  Building the web bundle…\n");
if (run("pnpm", ["build"], { cwd: repoRoot, stdio: "inherit" }).status !== 0) {
  die("Build failed — service not installed.");
}

mkdirSync(agentsDir, { recursive: true });
mkdirSync(logDir, { recursive: true });

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${pnpmPath}</string>
    <string>--filter</string>
    <string>@avilo/api</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key><string>${repoRoot}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${nodeDir}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>AVILO_PORT</key><string>${PORT}</string>
    <key>AVILO_HOST</key><string>127.0.0.1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(logDir, "out.log")}</string>
  <key>StandardErrorPath</key><string>${join(logDir, "error.log")}</string>
</dict>
</plist>
`;

writeFileSync(plistPath, plist);

// Replace any previous copy rather than layering a second one on the same port.
run("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`]);
run("launchctl", ["unload", "-w", plistPath]);

const loaded = run("launchctl", ["load", "-w", plistPath]);
if (loaded.status !== 0) die(`launchctl load failed:\n${loaded.stderr}`);

process.stdout.write(
  [
    "",
    "  ┌────────────────────────────────────────────────────────────",
    "  │  Avilo Advisory is installed and running",
    "  │",
    `  │  http://127.0.0.1:${PORT}`,
    "  │",
    "  │  Starts automatically at login. No terminal needed.",
    "  │  Bookmark that URL, or drag it to your Dock.",
    "  │",
    `  │  Logs:   ${logDir}`,
    "  │  Remove: pnpm app:uninstall",
    "  └────────────────────────────────────────────────────────────",
    "",
  ].join("\n"),
);
