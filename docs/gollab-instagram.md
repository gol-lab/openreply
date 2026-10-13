# GOL LAB — comentário → DM com confirmação de seguidor

Adaptação do OpenReply para o @gollab.com.br: a pessoa comenta uma palavra,
recebe uma DM, segue o perfil e só então recebe o link ou vídeo. Conexão
direta com a API oficial da Meta (Instagram API com login do Instagram), sem
Zernio e sem IA paga.

## O fluxo

1. Campanha ligada a um post ou Reel, com palavra-chave e URL do conteúdo.
2. A pessoa comenta `ANALISE` (acentos e maiúsculas não importam).
3. Resposta privada (a única que a Meta permite por comentário, até 7 dias):
   a DM de abertura com o botão **Me envie a análise**.
4. A resposta pública ("Te mandei os próximos passos no direct.") só sai
   **depois** que essa DM foi confirmada pela Meta.
5. O toque no botão é a primeira resposta da pessoa: abre a janela de 24 h e
   dá o consentimento que a Meta exige para ler o perfil dela. O servidor
   consulta `is_user_follow_business`:
   - **segue** → entrega na hora ("Tudo certo!…" + botão **Acessar conteúdo**);
   - **não segue / não deu para saber** → pede para seguir, com os botões
     **Já estou seguindo** e **Abrir perfil** (que só abre o perfil).
6. **Já estou seguindo** → nova consulta, decidida no servidor:
   - segue → entrega;
   - não segue → "Ainda não consegui confirmar…", com o botão de novo;
   - erro, timeout ou campo ausente → "Não consegui verificar agora…",
     conteúdo continua bloqueado, sem acusar a pessoa.
7. Depois de um "não segue" ou "desconhecido", o servidor ainda re-checa em
   silêncio após 20 s e 60 s: o Instagram pode levar até ~1 min para reportar
   um follow novo. Se a pessoa seguiu, o link chega sozinho.

Tocar no botão só **pede** a verificação; nunca vale como prova.

## O que mudou no código

| Arquivo | O quê |
| --- | --- |
| `lib/follow-gate/decision.ts` | Regra de liberação (pura, testada), textos padrão, botões |
| `lib/meta/client.ts` | `checkUserFollowsBusiness` (3 estados + motivo, timeout 8 s); `sendButtonTemplate` (postback + link); assina `messaging_postbacks` |
| `lib/queue/dm-worker.ts` | `runStrictGate`: vínculo usuário↔conta↔campanha, intervalo entre consultas, re-checagens, entrega única, enviado / falhou / incerto |
| `prisma/migrations/20261013170000_strict_follow_gate` | Campos da campanha + tabela `FollowCheck` |
| `app/api/automations/*` | Campos novos; não deixa ativar sem URL e sem post; `gate-stats` |
| Painel (`campaign-builder`, detalhe da campanha) | Campos editáveis em pt-BR e funil da trava |
| `scripts/criar-campanha-gollab.ts` | Cria a campanha "GOL LAB \| Conteúdo exclusivo" pausada |
| `scripts/verificar-seguidor-real.ts` | Consulta real de uma pessoa (só imprime o resultado) |
| `scripts/e2e-trava-seguidor.ts` | Teste ponta a ponta com banco, Redis e worker reais |
| `scripts/windows/*.ps1` | Iniciar, parar, atualizar, túnel HTTPS |
| `deploy/` | Produção: Docker Compose + Caddy (HTTPS) |

Com a opção desligada, a trava antiga (que libera quando não sabe) continua igual.

## Rodar no Windows (local)

Tudo fica em `C:\Users\joaoi\gollab-openreply-infra` (PostgreSQL portátil na
porta 5433, Memurai/Redis na 6380, logs em `logs\`). Nada é instalado no
sistema e nada inicia sozinho com o Windows.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\iniciar.ps1
powershell -ExecutionPolicy Bypass -File scripts\windows\parar.ps1
powershell -ExecutionPolicy Bypass -File scripts\windows\atualizar.ps1
```

- Painel: http://localhost:3000. Saúde: http://localhost:3000/api/health
  (`worker.healthy: true` = o worker está enviando).
- O worker roda com supervisor: se cair, volta em 5 s.
- Login local: o link mágico não vai por e-mail; ele é gravado em
  `.dev-login-link.txt` na pasta do projeto. Abra o link do arquivo no navegador.

## Meta Developers — o que você faz (não cole nada disso no chat)

1. Em developers.facebook.com/apps, crie um app do tipo **Business** com o caso
   de uso **Gerenciar mensagens e conteúdo no Instagram** (login do Instagram,
   não o do Facebook).
2. Em *Instagram › Configuração da API com login do Instagram*, copie o
   **ID do app do Instagram** e a **chave secreta do app do Instagram**. Em
   *Configurações do app › Básico*, copie a **chave secreta do app**.
3. Em *Funções do app › Testadores do Instagram*, convide `gollab.com.br`, depois
   aceite no app do Instagram (Configurações › Apps e sites › Convites de testador).
4. Abra o túnel (`scripts\windows\tunel.ps1`) ou use o domínio de produção e
   cadastre:
   - Redirecionamento OAuth: `https://SEU-ENDERECO/api/instagram/callback`
   - Webhook: `https://SEU-ENDERECO/api/webhook`, com o `WEBHOOK_VERIFY_TOKEN`
     do seu `.env`. Assine **comments**, **messages** e **messaging_postbacks**.
5. Publique o app (Live): sem isso, os webhooks reais não chegam. As páginas
   `/privacy`, `/terms` e `/data-deletion` já existem.
6. Migrando do ManyChat: desconecte o ManyChat do Instagram e, no Meta Business
   Suite › Configurações › Integrações › Roteamento de conversas, dê ao app
   **Acessar todas as conversas** e **Assumir o controle das conversas**. Senão
   o toque no botão falha com "not the thread owner".

Permissões: `instagram_business_basic`, `instagram_business_manage_comments`,
`instagram_business_manage_messages`. Para a sua própria conta (testador), o
Acesso Padrão basta; não precisa de App Review.

### Valores no `.env` (você preenche localmente)

| Variável | De onde vem |
| --- | --- |
| `INSTAGRAM_APP_ID` | ID do app do Instagram (passo 2) |
| `INSTAGRAM_APP_SECRET` | Chave secreta do app do Instagram (passo 2) |
| `FACEBOOK_APP_SECRET` | Configurações do app › Básico › Chave secreta |
| `NEXTAUTH_URL` | URL do túnel ou do domínio de produção |
| `WEBHOOK_VERIFY_TOKEN` | Já gerado no `.env`; cole o mesmo valor na Meta |

Depois de salvar: `parar.ps1`, `iniciar.ps1`, entre no painel e clique em
**Conectar Instagram** em Configurações.

## Primeira campanha

```powershell
npx tsx --env-file=.env scripts/criar-campanha-gollab.ts
```

Isso cria **GOL LAB | Conteúdo exclusivo** pausada (ANALISE, ANÁLISE, analise,
verificação obrigatória ligada, todos os textos já preenchidos). No painel:
Campanhas › a campanha › **Editar** › escolha o post/Reel › cole a URL do
conteúdo › Salvar. A API recusa ativar sem URL e sem post.

Para vídeo: use a URL de onde ele está hospedado (YouTube não listado, Drive,
página do site). O botão abre essa URL. A trava controla a entrega pelo bot;
ela não impede quem recebeu de repassar o link.

## Teste real (antes de ativar de vez)

Use duas contas pessoais suas, diferentes de @gollab.com.br:

1. **Conta A, que já segue**: comente `ANALISE` → DM de abertura → toque
   **Me envie a análise** → deve chegar o link na hora.
2. **Conta B, que não segue**: comente → toque → deve chegar o pedido para
   seguir. Toque **Já estou seguindo** sem seguir → "Ainda não consegui confirmar".
3. **Conta B começa a seguir no meio**: siga @gollab.com.br e toque
   **Já estou seguindo**. O link pode chegar na hora ou até ~1 min depois
   (re-checagem). Anote quanto demorou.
4. Confira no detalhe da campanha: Entradas, Seguidor confirmado, Não segue,
   Desconhecido (com motivo), Entregues e Cliques no link.
5. Para ver a resposta crua da API de uma pessoa:
   `npx tsx --env-file=.env scripts/verificar-seguidor-real.ts` (lista os IDs)
   e depois `... verificar-seguidor-real.ts <IGSID>`.

Se a etapa 1 der **Desconhecido** com motivo `meta_error_…`, a Meta não está
liberando o campo depois do toque no botão. Nesse caso o conteúdo continua
bloqueado (correto), e o próximo passo é testar pedindo para a pessoa
**escrever** uma mensagem, que é o consentimento citado na documentação.
Só depois de A e B passarem a campanha deve ficar ativa.

## Produção (servidor com HTTPS)

1. Um VPS Linux pequeno (2 vCPU / 4 GB basta) com Docker.
2. DNS: registro A de `bot.gollab.com.br` → IP do servidor.
3. No servidor, com o código:
   ```bash
   cp deploy/.env.prod.example deploy/.env.prod   # preencha
   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
   ```
   Sobe Postgres, Redis (com AOF), migração, painel, worker, cron (renova o
   token do Instagram todo dia) e Caddy (certificado HTTPS automático). Tudo com
   `restart: unless-stopped`.
4. Atualizar: `git pull` e o mesmo comando `up -d --build`. Parar:
   `docker compose -f deploy/docker-compose.prod.yml down` (os dados ficam nos volumes).
5. Troque as URLs do Meta para o domínio de produção.

## Segurança

- `.env` e `deploy/.env.prod` são ignorados pelo Git e pela imagem Docker.
- Tokens do Instagram ficam criptografados (AES-256-GCM, `ENCRYPTION_KEY`).
- A consulta de seguidor manda o token só no cabeçalho; os registros guardam
  apenas o código do erro (`meta_error_230`, `timeout`…), nunca token ou resposta.
- `ALLOWED_EMAILS` restringe quem entra no painel.
