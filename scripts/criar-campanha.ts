/**
 * Cria uma campanha PAUSADA a partir de um arquivo em config/campanhas/*.json.
 * Idempotente: se já existir campanha com o mesmo nome na conta, não cria outra.
 *
 *   npx tsx --env-file=.env scripts/criar-campanha.ts config/campanhas/yamal-messi.json
 *
 * Campos do arquivo (só nome, palavras e entrega são obrigatórios):
 *   nome, conta, palavras[], abertura, botaoAbertura, entrega,
 *   url, botaoEntrega, url2, botaoEntrega2, respostaPublica, respostasPublicas[] (sorteadas),
 *   exigirSeguir,
 *   qualquerPost (vale em todos os posts), tambemNaDM (também quando mandam
 *   a palavra no direct)
 * Os textos da trava de seguidor seguem o padrão aprovado da ANALISE.
 * O post/Reel fica pendente: escolha no painel (Editar) antes de ativar.
 */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db/client";
import { generateReportShareSlug } from "@/lib/reports/share";
import { generateTrackedLinkSlug } from "@/lib/tracking/server";

interface Spec {
  nome: string;
  conta?: string;
  palavras: string[];
  abertura?: string;
  botaoAbertura?: string;
  entrega: string;
  url?: string;
  botaoEntrega?: string;
  url2?: string;
  botaoEntrega2?: string;
  respostaPublica?: string | null;
  respostasPublicas?: string[];
  exigirSeguir?: boolean;
  qualquerPost?: boolean;
  tambemNaDM?: boolean;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Uso: criar-campanha.ts config/campanhas/<arquivo>.json");
  const spec = JSON.parse(readFileSync(file, "utf8")) as Spec;
  if (!spec.nome || !spec.palavras?.length || !spec.entrega)
    throw new Error("O arquivo precisa de nome, palavras e entrega.");

  const username = (spec.conta ?? "gollab.com.br").replace(/^@/, "");
  const account = await prisma.instagramAccount.findFirst({
    where: { username },
    select: { id: true, workspaceId: true, username: true },
  });
  if (!account) throw new Error(`Nenhuma conta @${username} conectada.`);

  const existing = await prisma.automation.findFirst({
    where: { instagramAccountId: account.id, name: spec.nome },
    select: { id: true, isActive: true },
  });
  if (existing) {
    console.log(`Campanha já existe (${existing.id}), ativa: ${existing.isActive}.`);
    return;
  }

  const gate = spec.exigirSeguir !== false;
  const publicReply = spec.respostaPublica === undefined
    ? "Te mandei os próximos passos no direct."
    : spec.respostaPublica;

  const created = await prisma.automation.create({
    data: {
      workspaceId: account.workspaceId,
      instagramAccountId: account.id,
      name: spec.nome,
      postId: null,
      postUrl: null,
      matchAnyPost: spec.qualquerPost === true,
      pendingNextReel: false,
      keywords: spec.palavras,
      matchAnyWord: false,
      wholeWordMatch: true,
      dmTriggerEnabled: spec.tambemNaDM === true,
      openingDmEnabled: true,
      openingDmMessage:
        spec.abertura ?? "Vi que você comentou. Toque no botão abaixo que eu te mando o conteúdo.",
      openingDmButtonLabel: spec.botaoAbertura ?? "Me envie o conteúdo",
      requireFollow: gate,
      followGateStrict: gate,
      followPromptMessage: gate
        ? `Para receber o conteúdo, siga @${account.username} e depois toque em ‘Já estou seguindo’ aqui embaixo.`
        : null,
      followPromptButtonLabel: gate ? "Já estou seguindo" : null,
      profileButtonLabel: gate ? "Abrir perfil" : null,
      followNotFollowingMessage: gate
        ? `Ainda não consegui confirmar que você segue @${account.username}. Siga o perfil e toque no botão para verificar novamente.`
        : null,
      followUnknownMessage: gate
        ? "Não consegui verificar agora. Aguarde um pouco e toque no botão para tentar novamente."
        : null,
      dmMessage: spec.entrega,
      linkButtonLabel: spec.url ? spec.botaoEntrega ?? "Acessar conteúdo" : null,
      publicReplyEnabled: Boolean(publicReply),
      publicReplyMessage: publicReply || null,
      publicReplyMessages: spec.respostasPublicas?.length
        ? spec.respostasPublicas
        : publicReply ? [publicReply] : [],
      publicReplyAfterDm: true,
      followUpEnabled: false,
      isActive: false,
      reportShareSlug: generateReportShareSlug(),
      ...(spec.url
        ? {
            trackedLinks: {
              create: [
                {
                  workspaceId: account.workspaceId,
                  slug: generateTrackedLinkSlug(),
                  destinationUrl: spec.url,
                  label: spec.botaoEntrega ?? "Acessar conteúdo",
                  position: 0,
                },
                ...(spec.url2
                  ? [
                      {
                        workspaceId: account.workspaceId,
                        slug: generateTrackedLinkSlug(),
                        destinationUrl: spec.url2,
                        label: spec.botaoEntrega2 ?? "Abrir link",
                        position: 1,
                      },
                    ]
                  : []),
              ],
            },
          }
        : {}),
    },
    select: { id: true },
  });
  console.log(`Campanha criada PAUSADA: ${created.id}`);
  console.log(
    spec.qualquerPost
      ? "Vale em qualquer post. Falta só ativar no painel."
      : "Falta no painel: escolher o post/Reel (Editar) e ativar."
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
