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
- **Branch `criativos`** (órfã): imagens antigas de anúncios (`dg-growth/`). As do Instagram agora ficam no repo `instagram-autopost`.

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

### 1b. WhatsApp real via Evolution API (no ar desde 01/11/2026)
Decisão: a coexistência oficial da Meta foi descartada (exige BSP). O **número real da DG Growth**
(+55 15 99807-9816) está pareado numa **Evolution API v2.3.7** (open source, não oficial, custo zero).
O Carlos continua respondendo pelo celular no mesmo número; a IA atende site e anúncios.
- Fluxo: WhatsApp → Evolution (VM GCP) → webhook `supabase/functions/messaging-webhook-evolution`
  → contato/conversa/negócio → `POST /api/messaging/ai/process` → agente responde pela Evolution.
- Infra: VM GCP e2-micro `evolution-api` (us-east1-b, projeto `project-46257211-fa68-4fc0-9ae`),
  Docker (evolution + cloudflared), Cloudflare Tunnel em `https://evolution.dggrowth.com.br`.
  Banco: schema `evolution` no Supabase (role `evolution_app`). Instância `dggrowth`.
- Canal no CRM: `messaging_channels.id = c6618546-0438-45ca-b7cb-3668d08a7251` (provider `evolution`,
  status `connected`; **só `connected`/`active` são aceitos pelo webhook**). Regra em `lead_routing_rules`
  leva novos contatos ao board principal, etapa "Novo lead".
- Edge function `messaging-webhook-evolution`: publicada no Supabase (versão 3, verify_jwt **desligado**).
  Autenticação: header `apikey` do webhook = `credentials.apiKey` do canal.
- **Segredos** ficam no GCP Secret Manager (`evolution-api-key`, `evolution-db-password`,
  `cloudflared-token`), lidos no boot por um serviço systemd (`evolution-stack`) que grava
  `/run/evolution/secrets.env` em tmpfs; não há `.env` com segredos no disco. A VM usa a conta de
  serviço `evolution-vm` (só lê esses 3). Valores nunca vão para o repo.
  Rotacionar a API key: nova versão do secret → `sudo systemctl restart evolution-stack` →
  atualizar `credentials.apiKey` do canal (via SQL) e o header `apikey` do webhook (`POST /webhook/set/dggrowth`).
- Configurações que importam: `DATABASE_SAVE_DATA_NEW_MESSAGE=true` e webhook com `base64:true`
  (sem isso o áudio falha com "Message not found").
- Comportamentos implementados:
  - Eco de mensagens enviadas (`fromMe`) é reivindicado, sem duplicar.
  - Resposta humana pelo celular **pausa a IA** da conversa (`metadata.ai_paused`).
  - Contato já existente reaproveita o negócio aberto (trigger do banco proíbe 2 negócios do mesmo
    contato na mesma etapa); sem negócio, `autoCreateDeal` cria um. Conversa sem `metadata.deal_id` = IA muda ("No deal associated").
  - Áudio: a edge function manda o base64 ao `/api/messaging/ai/process`, que transcreve com o Gemini da org
    (`lib/ai/agent/transcribe-audio.ts`), salva `content.transcription` e o agente responde ao texto.
- Segurança: WAF da Cloudflare bloqueia `/manager`; SSH só via IAP; orçamento de R$ 10/mês com alerta.
- Testado em produção: texto, áudio, pausa por resposta humana, reinício da VM (sessão reconecta sozinha).
  Contato totalmente novo (número que nunca falou com o CRM): testado pelo Carlos em 03/11/2026.
- Risco inerente da API não oficial: banimento. Evitar disparos em massa e mensagens a quem não escreveu primeiro.
- PRs: #6 (pausa por humano), #7 (negócio existente + áudio), #8 (sincroniza áudio via base64). Todos mergeados.

## 2. Instagram orgânico automático (projeto separado)
Não faz mais parte do CRM. Vive em https://github.com/DGGrowth/instagram-autopost
(Vercel `instagram-autopost`, banco Firestore no projeto GCP `dg-ig-autopost`).
O CRM não compartilha código, banco nem credenciais com ele.

## 3. Meta Ads
- Conta de anúncios **CTA-DGGrowth** `861163187945684` (BM DGGrowth `152108020129648`).
- Campanha de mensagens para WhatsApp, R$ 10/dia, São Paulo capital, IG + FB:
  **pausada de propósito**; o Carlos a reativa manualmente (o número agora é o real, via Evolution).

## Pendências
1. ~~Testar contato novo~~ — feito em 03/11/2026; anúncios podem ser reativados pelo Carlos.
2. Trocar o **App Secret** do app Meta (foi exposto); só relevante se voltar ao canal oficial
   (senão, desativar o canal antigo `e7ea38c6-…`).
2b. Erro não fatal: `ai_conversation_log.context_snapshot` nulo ao registrar tokens.
2c. Monitorar o tamanho do schema `evolution` no Supabase (free ~500 MB; mensagens agora são salvas).
3. Ativar faturamento do Gemini (Google AI Studio) para estabilidade; depois testar modelo maior.
4. Aviso de lead qualificado para o Carlos: Telegram (já suportado no CRM) ou WhatsApp (exige código).
5. Ajustes finos do agente que a UI não expõe (palavras de handoff, delay, máx. mensagens) via SQL.
