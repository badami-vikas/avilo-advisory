#!/usr/bin/env node
/**
 * One command starts everything: the local API and the web client.
 *
 * Both bind to 127.0.0.1. Nothing in this application reaches the network.
 */
import { spawn } from "node:child_process";

const targets = [
  { name: "api", filter: "@avilo/api", color: "[36m" },
  { name: "web", filter: "@avilo/web", color: "[35m" },
];

const children = [];
let shuttingDown = false;

for (const target of targets) {
  const child = spawn("pnpm", ["--filter", target.filter, "dev"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  const prefix = `${target.color}[${target.name}][0m `;
  const relay = (stream, out) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) out.write(prefix + line + "\n");
      }
    });
  };

  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);

  child.on("exit", (code) => {
    if (shuttingDown) return;
    process.stderr.write(`${prefix}exited with code ${code}\n`);
    shutdown(code ?? 1);
  });

  children.push(child);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 200);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

process.stdout.write(
  "\n  Avilo Advisory\n  web  http://127.0.0.1:5177\n  api  http://127.0.0.1:5178\n\n",
);
