#!/usr/bin/env node
// Production launcher: forces NODE_ENV=production, loads .env from repo root,
// then runs the custom server (which serves Next + the upload bypass).
process.env.NODE_ENV = "production";
const { spawn } = require("child_process");
const isWin = process.platform === "win32";
const child = spawn(isWin ? "npx.cmd" : "npx", ["tsx", "src/server/index.ts"], {
  cwd: __dirname,
  stdio: "inherit",
  env: process.env,
  shell: isWin,
});
child.on("exit", (code) => process.exit(code || 0));
