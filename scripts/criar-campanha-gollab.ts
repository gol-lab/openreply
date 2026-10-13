/**
 * Cria a campanha "GOL LAB | Conteúdo exclusivo", PAUSADA, na conta do
 * Instagram já conectada. Idempotente: se já existir, não cria outra.
 *
 *   npx tsx --env-file=.env scripts/criar-campanha-gollab.ts [usuario]
 *
 * O post/Reel e a URL do conteúdo ficam pendentes de propósito: a API não
 * deixa ativar uma campanha com verificação obrigatória sem os dois.
 */
import { prisma } from "@/lib/db/client";
import { generateReportShareSlug } from "@/lib/reports/share";

const NAME = "GOL LAB | Conteúdo exclusivo";

async function main() {
  const username = (process.argv[2] ?? "gollab.com.br").replace(/^@/, "");
  const account = await prisma.instagramAccount.findFirst({
    where: { username },
    select: { id: true, workspaceId: true, username: true },
  });
  if (!account) {
    console.error(
      `Nenhuma conta @${username} conectada. Conecte o Instagram em Configurações e rode de novo.`
    );
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.automation.findFirst({
    where: { instagramAccountId: account.id, name: NAME },
    select: { id: true, isActive: true },
  });
  if (existing) {
    console.log(`Campanha já existe (${existing.id}), ativa: ${existing.isActive}.`);
    return;
  }

  const created = await prisma.automation.create({
    data: {
      workspaceId: account.workspaceId,
      instagramAccountId: account.id,
      name: NAME,
      // Post/Reel pendente: escolha no painel (Editar) antes de ativar.
      postId: null,
      postUrl: null,
      matchAnyPost: false,
      pendingNextReel: false,
      keywords: ["ANALISE", "ANÁLISE", "analise"],
      matchAnyWord: false,
      wholeWordMatch: true,
      dmTriggerEnabled: false,
      openingDmEnabled: true,
      openingDmMessage:
        "Vi que você comentou ANALISE. Toque no botão abaixo que eu te mando o conteúdo.",
      openingDmButtonLabel: "Me envie a análise",
      requireFollow: true,
      followGateStrict: true,
      followPromptMessage: `Para receber o conteúdo, siga @${account.username} e depois toque em ‘Já estou seguindo’ aqui embaixo.`,
      followPromptButtonLabel: "Já estou seguindo",
      profileButtonLabel: "Abrir perfil",
      followNotFollowingMessage: `Ainda não consegui confirmar que você segue @${account.username}. Siga o perfil e toque no botão para verificar novamente.`,
      followUnknownMessage:
        "Não consegui verificar agora. Aguarde um pouco e toque no botão para tentar novamente.",
      dmMessage: "Tudo certo! Aqui está o conteúdo que você pediu.",
      linkButtonLabel: "Acessar conteúdo",
      publicReplyEnabled: true,
      publicReplyMessage: "Te mandei os próximos passos no direct.",
      publicReplyMessages: ["Te mandei os próximos passos no direct."],
      publicReplyAfterDm: true,
      followUpEnabled: false,
      isActive: false,
      reportShareSlug: generateReportShareSlug(),
    },
    select: { id: true },
  });
  console.log(`Campanha criada PAUSADA: ${created.id}`);
  console.log("Falta no painel: escolher o post/Reel e colar a URL do conteúdo.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
