// Mantém o worker rodando no Windows: carrega o .env, grava o log em UTF-8 e
// reinicia o processo 5 s depois de qualquer queda.
//   node scripts/windows/worker-supervisor.mjs <arquivo-de-log>
import { spawn } from "node:child_process";
import { appendFileSync, createWriteStream } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const logFile = process.argv[2] ?? resolve(app, "worker.log");
const tsxCli = resolve(app, "node_modules", "tsx", "dist", "cli.mjs");
let child = null;
let stopping = false;

function start() {
  const out = createWriteStream(logFile, { flags: "a" });
  child = spawn(process.execPath, ["--env-file=.env", tsxCli, "worker/dm-worker.ts"], {
    cwd: app,
    windowsHide: true,
  });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  child.on("exit", (code) => {
    if (stopping) return;
    appendFileSync(logFile, `[supervisor] worker saiu (codigo ${code}) em ${new Date().toISOString()}, reiniciando em 5 s\n`);
    setTimeout(start, 5000);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    child?.kill();
    process.exit(0);
  });
}

start();
