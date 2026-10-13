/**
 * Teste ponta a ponta da trava de seguidor obrigatória com Postgres, Redis e
 * fila REAIS e o worker de verdade. Só a API da Meta é simulada (fetch), já
 * que o teste real com o Instagram depende das credenciais.
 *
 *   npx tsx --env-file=.env scripts/e2e-trava-seguidor.ts [--manter]
 *
 * Usa o banco 1 do Redis para não disputar a fila com o worker local, e apaga
 * tudo o que criou no fim (exceto com --manter, para ver no painel).
 */
const REDIS_DB = "/1";
process.env.REDIS_URL = (process.env.REDIS_URL ?? "redis://127.0.0.1:6380").replace(/\/\d+$/, "") + REDIS_DB;
process.env.FOLLOW_RECHECK_DELAYS_MS = "1500,1500";
process.env.FOLLOW_GATE_COOLDOWN_MS = "800";
process.env.FOLLOW_CHECK_TIMEOUT_MS = "400";

type Answer = "follows" | "not" | "missing" | "error" | "timeout";
const answers = new Map<string, Answer[]>();
const sent: { to: string; kind: string; text: string; buttons: unknown[] }[] = [];
const lookups: string[] = [];
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.hostname !== "graph.instagram.com") return realFetch(input, init);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  if (url.pathname.endsWith("/messages")) {
    const body = JSON.parse(String(init?.body));
    const to = body.recipient.id ?? `comment:${body.recipient.comment_id}`;
    const tpl = body.message.attachment?.payload;
    sent.push({ to, kind: tpl ? "buttons" : "text", text: tpl?.text ?? body.message.text, buttons: tpl?.buttons ?? [] });
    return json(200, { recipient_id: to, message_id: `m_${sent.length}` });
  }
  if (url.pathname.includes("/replies")) {
    sent.push({ to: "public", kind: "public", text: String(init?.body), buttons: [] });
    return json(200, { id: `r_${sent.length}` });
  }
  if (url.searchParams.get("fields") === "is_user_follow_business") {
    const igsid = url.pathname.split("/").pop()!;
    lookups.push(igsid);
    const queue = answers.get(igsid) ?? ["missing"];
    const answer = queue.length > 1 ? queue.shift()! : queue[0];
    if (answer === "timeout")
      return new Promise<Response>((_r, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason))
      );
    if (answer === "error")
      return json(400, { error: { message: "User consent is required", code: 230, type: "IGApiException" } });
    if (answer === "missing") return json(200, { id: igsid });
    return json(200, { id: igsid, is_user_follow_business: answer === "follows" });
  }
  return json(404, { error: { message: "not mocked", code: 100 } });
}) as typeof fetch;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "OK  " : "FALHOU"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const { prisma } = await import("@/lib/db/client");
  const { encryptToken } = await import("@/lib/meta/oauth");
  const { createDMWorker } = await import("@/lib/queue/dm-worker");
  const { getDMQueue, getRedisConnection, POSTBACK_JOB_NAME } = await import("@/lib/queue/client");

  await getRedisConnection().flushdb(); // só o banco 1
  const stamp = Date.now();
  // --email=<login>: grava na área de trabalho desse usuário (para ver no painel).
  const emailArg = process.argv.find((a) => a.startsWith("--email="))?.slice(8);
  const existingUser = emailArg
    ? await prisma.user.findUnique({ where: { email: emailArg } })
    : null;
  if (emailArg && !existingUser) throw new Error(`Usuário ${emailArg} não existe (faça login antes)`);
  const user = existingUser ?? (await prisma.user.create({ data: { email: `e2e-${stamp}@teste.local` } }));
  const ws = existingUser
    ? (await prisma.workspace.findFirst({ where: { members: { some: { userId: user.id } } } }))!
    : await prisma.workspace.create({ data: { name: "E2E trava", ownerId: user.id } });
  if (!existingUser)
    await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: user.id, role: "OWNER" } });
  const account = await prisma.instagramAccount.create({
    data: {
      workspaceId: ws.id,
      instagramId: `ig_e2e_${stamp}`,
      username: "gollab.com.br",
      accessToken: encryptToken("token_falso_e2e"),
    },
  });
  const base = {
    workspaceId: ws.id,
    instagramAccountId: account.id,
    keywords: ["ANALISE", "ANÁLISE", "analise"],
    openingDmEnabled: true,
    openingDmMessage: "Vi que você comentou ANALISE.",
    openingDmButtonLabel: "Me envie a análise",
    requireFollow: true,
    followGateStrict: true,
    followPromptMessage: "SEGUE_E_TOCA",
    followPromptButtonLabel: "Já estou seguindo",
    profileButtonLabel: "Abrir perfil",
    followNotFollowingMessage: "AINDA_NAO_SEGUE",
    followUnknownMessage: "NAO_CONSEGUI_VERIFICAR",
    dmMessage: "Tudo certo! Aqui está o conteúdo que você pediu.",
    linkButtonLabel: "Acessar conteúdo",
    publicReplyEnabled: true,
    publicReplyMessages: ["Te mandei os próximos passos no direct."],
    publicReplyAfterDm: true,
  };
  const live = await prisma.automation.create({
    data: {
      ...base,
      name: "E2E ativa",
      postId: "media_e2e",
      isActive: true,
      trackedLinks: { create: [{ workspaceId: ws.id, slug: `e2e${stamp}`, destinationUrl: "https://gollab.com.br/exclusivo", label: "Acessar conteúdo" }] },
    },
  });
  const paused = await prisma.automation.create({
    data: { ...base, name: "E2E pausada", postId: "media_pausada", isActive: false },
  });

  const worker = createDMWorker();
  const queue = getDMQueue();
  const comment = (user: string, media = "media_e2e", text = "ANÁLISE") =>
    queue.add("process-comment", {
      instagramAccountId: account.instagramId,
      accountConnectionId: account.id,
      commentId: `c_${user}_${media}`,
      commentText: text,
      commenterId: user,
      commenterName: user,
      mediaId: media,
    }, { jobId: `comment_${account.instagramId}_c_${user}_${media}` });
  const tap = (user: string, payload: string, mid: string) =>
    queue.add(POSTBACK_JOB_NAME, {
      instagramAccountId: account.instagramId,
      accountConnectionId: account.id,
      userId: user,
      payload,
      mid,
    }, { jobId: `postback_${account.instagramId}_${user}_${mid}` });
  const toUser = (u: string) => sent.filter((s) => s.to === u);
  const links = (u: string) => toUser(u).filter((s) => JSON.stringify(s.buttons).includes("/r/"));

  answers.set("seguidor", ["follows"]);
  answers.set("naosegue", ["not"]);
  answers.set("comeca", ["not", "not", "follows"]);
  answers.set("semcampo", ["missing"]);
  answers.set("erro", ["error"]);
  answers.set("lento", ["timeout"]);

  const users = ["seguidor", "naosegue", "comeca", "semcampo", "erro", "lento"];
  for (const u of users) await comment(u);
  await comment("pausado", "media_pausada");
  await comment("seguidor"); // webhook duplicado do mesmo comentário
  await sleep(2500);

  check("DM inicial (resposta privada) para cada comentário, 1 por pessoa",
    users.every((u) => sent.filter((s) => s.to === `comment:c_${u}_media_e2e`).length === 1));
  check("resposta pública só depois da DM, 1 por comentário",
    sent.filter((s) => s.kind === "public").length === users.length);
  check("campanha pausada: nada enviado", !sent.some((s) => s.to.includes("pausado")));
  check("nenhuma consulta de seguidor no comentário", lookups.length === 0);

  // Toque em "Me envie a análise".
  for (const u of users) await tap(u, `followcheck:${live.id}:open`, `open_${u}`);
  await sleep(2500);
  check("1. seguidor confirmado recebe o link no 1º toque", links("seguidor").length === 1);
  check("não seguidor recebe o pedido para seguir, sem link",
    links("naosegue").length === 0 && toUser("naosegue").some((s) => s.text === "SEGUE_E_TOCA"));
  check("pedido traz 'Já estou seguindo' e 'Abrir perfil' (só abre o perfil)",
    JSON.stringify(toUser("naosegue")[0]?.buttons).includes("https://www.instagram.com/gollab.com.br/"));

  // Toque em "Já estou seguindo".
  for (const u of users.slice(1)) await tap(u, `followcheck:${live.id}`, `retry_${u}`);
  await tap("naosegue", `followcheck:${live.id}`, "retry_naosegue_dup"); // clique repetido
  await sleep(1500);
  check("2. não seguidor confirmado: mensagem de 'ainda não consegui confirmar', sem link",
    links("naosegue").length === 0 && toUser("naosegue").filter((s) => s.text === "AINDA_NAO_SEGUE").length === 1);
  const retryChecks = await prisma.followCheck.count({
    where: { automationId: live.id, userId: "naosegue", source: "RETRY_TAP" },
  });
  check("5. clique repetido dentro do intervalo: sem 2ª consulta nem 2ª mensagem",
    retryChecks === 1, `${retryChecks} consulta(s) por toque`);
  check("3. campo ausente: 'não consegui verificar', sem link",
    links("semcampo").length === 0 && toUser("semcampo").some((s) => s.text === "NAO_CONSEGUI_VERIFICAR"));
  check("4a. erro da API: 'não consegui verificar', sem link",
    links("erro").length === 0 && toUser("erro").some((s) => s.text === "NAO_CONSEGUI_VERIFICAR"));
  check("4b. timeout: 'não consegui verificar', sem link",
    links("lento").length === 0 && toUser("lento").some((s) => s.text === "NAO_CONSEGUI_VERIFICAR"));

  await sleep(4500); // re-checagens (1,5 s + 1,5 s)
  check("começou a seguir no meio do fluxo: re-checagem entrega o link sozinha", links("comeca").length === 1);
  check("re-checagens não mandam mensagem extra",
    toUser("naosegue").filter((s) => s.text === "AINDA_NAO_SEGUE").length === 1);

  // Toques depois da entrega e webhook duplicado do mesmo toque.
  await tap("seguidor", `followcheck:${live.id}`, "late_1");
  await tap("comeca", `followcheck:${live.id}`, "late_2");
  await tap("seguidor", `followcheck:${live.id}:open`, "open_seguidor");
  await sleep(1500);
  check("5. nenhuma entrega duplicada", links("seguidor").length === 1 && links("comeca").length === 1);

  // Toque vindo de quem não comentou (payload forjado) e em campanha pausada.
  await tap("intruso", `followcheck:${live.id}`, "x1");
  await tap("pausado", `followcheck:${paused.id}`, "x2");
  answers.set("intruso", ["follows"]);
  answers.set("pausado", ["follows"]);
  await sleep(1500);
  check("toque de quem não entrou na campanha é ignorado", toUser("intruso").length === 0);
  check("6. campanha pausada: toque não consulta nem entrega",
    toUser("pausado").length === 0 && !lookups.includes("pausado"));

  const counts = await prisma.followCheck.groupBy({ by: ["result"], where: { automationId: live.id }, _count: { _all: true } });
  const reasons = await prisma.followCheck.findMany({ where: { automationId: live.id, result: "UNKNOWN" }, select: { userId: true, reason: true } });
  const delivered = await prisma.dmLog.count({ where: { automationId: live.id, commentId: { startsWith: "reveal:" }, status: "SENT" } });
  console.log("verificações:", Object.fromEntries(counts.map((c) => [c.result, c._count._all])));
  console.log("motivos desconhecidos:", [...new Set(reasons.map((r) => `${r.userId}:${r.reason}`))].join(", "));
  check("entregas confirmadas registradas = 2 (seguidor + começou a seguir)", delivered === 2, String(delivered));
  const leaked = JSON.stringify(await prisma.followCheck.findMany({ where: { automationId: live.id } })).includes("token_falso");
  check("token nunca aparece nos registros", !leaked);

  await worker.close();
  await queue.close();
  if (!process.argv.includes("--manter")) {
    // A conta falsa leva junto campanhas, registros e verificações (cascade).
    await prisma.instagramAccount.delete({ where: { id: account.id } });
    if (!existingUser) {
      await prisma.workspace.delete({ where: { id: ws.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }
  await getRedisConnection().flushdb();
  getRedisConnection().disconnect();
  await prisma.$disconnect();
  console.log(failures === 0 ? "\nTUDO CERTO" : `\n${failures} FALHA(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
