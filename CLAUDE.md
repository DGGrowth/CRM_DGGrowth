@AGENTS.md

# Contexto DG Growth (leia antes de trabalhar)

Este repositório é o **CRM da DG Growth** (fork do NossoCRM: Next.js na Vercel + Supabase).
Dono: Carlos Dias (Brasil, America/Sao_Paulo). Responda sempre em **português**.
Este repositório é **público**: nunca commitar tokens, App Secret, chaves ou senhas.

## O negócio
- DG Growth vende implantação de IA (atendimento, vendas, operação).
- Porta de entrada: **Diagnóstico de IA — 30 min, R$ 130 (Pix)**. Projetos a partir de R$ 2.500.
- Público: fábricas e negócios que faturam **mais de R$ 70 mil/mês**, foco em São Paulo capital.
- Roteiros completos do agente SDR/Closer, objeções e decisões: Claude Doc
  https://claude.ai/artifact/P3mJp1F3wgpSTseMTQHjrw

## Onde as coisas rodam
- **App (Vercel)**: https://crm-dg-growth.vercel.app — projeto `dg-growths-projects/crm-dg-growth`.
  Merge na `main` = deploy de produção. Funções com `maxDuration` 60s (ver `vercel.json`).
- **Supabase**: Postgres + edge functions. Edge functions são publicadas pelo editor do painel
  (não há CLI configurada); depois de mudar `supabase/functions/*`, publicar no painel.
  `messaging-webhook-meta` roda **com verificação de JWT desligada**.
- **Branch `criativos`** (órfã): imagens públicas usadas em anúncios e Instagram
  (`dg-growth/`, `instagram/`), servidas via `raw.githubusercontent.com`.

## 1. WhatsApp + agente de IA (funcionando)
Fluxo: Meta WhatsApp Cloud API → `supabase/functions/messaging-webhook-meta` → cria contato,
conversa e negócio (etapa "Novo lead") → `POST /api/messaging/ai/process` → agente responde.
- Hoje usa o **número de teste da Meta**. WABA `260427900485810` (assinada ao app via
  `POST /{waba}/subscribed_apps`). Canal no CRM: `messaging_channels.id = e7ea38c6-4894-4b77-a15d-192419c7dc5b`.
- App Meta: **DG Growth Atendimento CRM** (publicado/Live). Token permanente do usuário do
  sistema **dggrowthauto**, guardado em `messaging_channels.credentials->>'accessToken'`
  (a UI do CRM não edita credenciais; atualizar via SQL com `jsonb_set`).
- IA: Gemini, modelo em `organization_settings.ai_model` = `gemini-3.5-flash-lite`
  (modelos maiores deram 503 "high demand" no plano gratuito e estouraram os 60s da Vercel).
- Agentes por etapa em `stage_ai_config`: **Novo lead = SDR** (qualifica segmento, faturamento,
  dor, urgência, decisor) e **Qualificado = Closer** (agenda Diagnóstico, cobra Pix, pede e-mail).
  Atenção: ligar/desligar a IA da etapa pela UI **sobrescreve o prompt com o padrão** — reaplicar.
  Manter `notify_team = false` nas etapas de IA (true causa handoff imediato).
- Correções já feitas (PR #1): `sourceLabel` duplicado, `messageId` deve ser o UUID interno,
  negócio automático usa `custom_fields` (não existe `deals.source/metadata`),
  `deal_activities` usa `type/description/metadata`, migração `contacts.metadata`.

## 2. Instagram orgânico automático (funcionando)
- Tabelas: `instagram_posts` (fila) e `instagram_autopost_config` (linha única: `ig_user_id`,
  `access_token`, `enabled`, `trigger_key`). Migração `20261028000000_instagram_autopost.sql`.
- Rota `app/api/cron/instagram-autopost/route.ts`: publica **1 post vencido por execução**
  (container → status → `media_publish`), até 3 tentativas, erro gravado na linha.
- Cron Vercel `15 0 * * *` UTC = **21:15 Brasília**. Disparo manual:
  `https://crm-dg-growth.vercel.app/api/cron/instagram-autopost?key=<trigger_key>`
  (a chave está na tabela de config; não colocar aqui).
- Conta IG **@dggrowth** id `17841455803827460`; token do usuário do sistema no app **Ap postagens**.
- Imagens: JPEG 1080×1350 em `criativos:instagram/post-NN.jpg`. Lote 1 = 12 posts
  (seg/qua/sex, 27/10 a 23/11/2026); o 1º já foi publicado. Para um novo lote: gerar JPEGs,
  subir na branch `criativos`, inserir linhas em `instagram_posts` com `scheduled_at` às 21:15-03.
- Identidade visual: fundo `#0E1116`, texto `#F2F1EC`, destaque `#C6F432`, cartões `#1A1F27`,
  títulos Space Grotesk 700, corpo Inter.

## 3. Meta Ads
- Conta de anúncios **CTA-DGGrowth** `861163187945684` (BM DGGrowth `152108020129648`).
- Campanha de mensagens para WhatsApp, R$ 10/dia, São Paulo capital, IG + FB:
  **pausada de propósito** até o número oficial estar ativo.

## Pendências
1. **Chip/número oficial**: registrar na WABA de produção, atualizar `phone_number_id` e token do
   canal, configurar webhook + `subscribed_apps`, apontar o anúncio para o número e reativar a campanha.
2. Trocar o **App Secret** do app Meta (foi exposto) e atualizar nas credenciais do canal.
3. Ativar faturamento do Gemini (Google AI Studio) para estabilidade; depois testar modelo maior.
4. Aviso de lead qualificado para o Carlos: Telegram (já suportado no CRM) ou WhatsApp (exige código).
5. Ajustes finos do agente que a UI não expõe (palavras de handoff, delay, máx. mensagens) via SQL.

## Ferramentas no repositório
- `scripts/instagram/`: gerador dos posts (conteúdo em `posts.py`, render com Playwright).
