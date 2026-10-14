// Mantém o worker rodando no Windows: carrega o .env, grava o log em UTF-8,
// reinicia o processo 5 s depois de qualquer queda e roda o cron (token).
//   node scripts/windows/worker-supervisor.mjs <arquivo-de-log>
import { spawn } from "node:child_process";
import { appendFileSync, createWriteStream, readFileSync } from "node:fs";
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

// Fora da Vercel ninguém chama /api/cron: sem isto o token do Instagram vence
// (~60 dias) e tudo para sem erro. A rota só renova quando falta pouco.
function runCron() {
  let secret = "";
  try {
    const env = readFileSync(resolve(app, ".env"), "utf8");
    secret = (env.match(/^CRON_SECRET=(.*)$/m)?.[1] ?? "").trim();
  } catch {}
  if (!secret) return;
  for (const route of ["refresh-tokens", "snapshot-followers"]) {
    fetch(`http://127.0.0.1:3000/api/cron/${route}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(120000),
    })
      .then((res) => appendFileSync(logFile, `[cron] ${new Date().toISOString()} ${route} HTTP ${res.status}
`))
      .catch((error) => appendFileSync(logFile, `[cron] ${new Date().toISOString()} ${route} falhou: ${error.message}
`));
  }
}
setTimeout(runCron, 60_000);
setInterval(runCron, 6 * 60 * 60 * 1000);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    child?.kill();
    process.exit(0);
  });
}

start();
