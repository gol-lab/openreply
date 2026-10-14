/**
 * Publica as perguntas prontas da DM (icebreakers) de config/icebreakers.json
 * na conta conectada, pela API oficial (POST /me/messenger_profile), e lê de
 * volta o que ficou salvo. Não imprime token.
 *
 *   npx tsx --env-file=.env scripts/publicar-icebreakers.ts [usuario] [--remover]
 */
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { getMetaGraphApiVersion } from "@/lib/env";
import { iceBreakersFor, iceBreakersProfileBody } from "@/lib/icebreakers";

async function main() {
  const username = (process.argv.find((a, i) => i > 1 && !a.startsWith("--")) ?? "gollab.com.br").replace(/^@/, "");
  const remover = process.argv.includes("--remover");
  const account = await prisma.instagramAccount.findFirst({ where: { username, provider: "META" } });
  if (!account) throw new Error(`Conta @${username} não conectada pela Meta.`);
  const token = decryptToken(account.accessToken);
  const base = `https://graph.instagram.com/${getMetaGraphApiVersion()}/me/messenger_profile`;

  if (remover) {
    const res = await fetch(base, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields: ["ice_breakers"], platform: "instagram" }),
    });
    console.log(`Remover: HTTP ${res.status}`, await res.text());
    return;
  }

  const items = iceBreakersFor(username);
  if (items.length === 0) throw new Error(`Nenhuma pergunta para @${username} em config/icebreakers.json.`);
  const res = await fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(iceBreakersProfileBody(username)),
  });
  console.log(`Publicar: HTTP ${res.status}`, await res.text());

  const check = await fetch(`${base}?fields=ice_breakers&platform=instagram`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const saved = (await check.json()) as {
    data?: { ice_breakers?: { call_to_actions?: { question: string; payload: string }[] }[] }[];
  };
  const ctas = saved.data?.[0]?.ice_breakers?.[0]?.call_to_actions ?? [];
  console.log(`Salvo no Instagram (${ctas.length}):`);
  for (const c of ctas) console.log(`  - ${c.question}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
