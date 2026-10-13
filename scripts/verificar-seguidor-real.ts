/**
 * Consulta REAL do status de seguidor na API oficial (is_user_follow_business),
 * com o token salvo da conta conectada. Imprime só o resultado; nunca o token.
 *
 *   npx tsx --env-file=.env scripts/verificar-seguidor-real.ts <IGSID> [usuario]
 *
 * Sem IGSID, lista as últimas interações (com o IGSID de cada pessoa).
 */
import { prisma } from "@/lib/db/client";
import { checkFollowStatus, createInstagramContext } from "@/lib/instagram/provider";

async function main() {
  const igsid = process.argv[2];
  const username = (process.argv[3] ?? "gollab.com.br").replace(/^@/, "");
  if (!igsid) {
    // Sem IGSID: lista as últimas interações para achar quem testou.
    const recent = await prisma.dmLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { commenterId: true, commenterName: true, commentText: true, status: true, createdAt: true },
    });
    console.log("Últimas interações (IGSID  @nome  texto  status):");
    for (const r of recent)
      console.log(`${r.commenterId}  @${r.commenterName ?? "?"}  ${r.commentText.slice(0, 30)}  ${r.status}  ${r.createdAt.toISOString()}`);
    console.log("\nUso: verificar-seguidor-real.ts <IGSID> [usuario]");
    return;
  }
  const account = await prisma.instagramAccount.findFirst({ where: { username } });
  if (!account) {
    console.error(`Conta @${username} não conectada.`);
    process.exitCode = 1;
    return;
  }
  const context = await createInstagramContext(account);
  const outcome = await checkFollowStatus({ context, recipientId: igsid, timeoutMs: 10000 });
  const label = {
    FOLLOWS: "SEGUE (liberaria o conteúdo)",
    NOT_FOLLOWING: "NÃO SEGUE (pede para seguir)",
    UNKNOWN: "DESCONHECIDO (mantém bloqueado)",
  }[outcome.state];
  console.log(`@${username} ← ${igsid}: ${label}${outcome.state === "UNKNOWN" ? ` [${outcome.reason}]` : ""}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
