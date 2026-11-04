-- Descarte de leads sem qualificação (aprovado pelo Carlos em 2026-11-04)
-- Regra: lead que só mandou a mensagem automática (1 inbound) e não respondeu à IA em N minutos
-- sai do funil (exclusão lógica) e vira uma linha em lead_descartados_log. Se responder depois,
-- o webhook chama reativar_lead_descartado() e tudo volta.

create table if not exists public.meta_anuncios_nomes (
  ad_id text primary key,
  nome text not null
);
alter table public.meta_anuncios_nomes enable row level security;
insert into public.meta_anuncios_nomes (ad_id, nome) values
  ('120250209283910716', '1x1_ia-aplicada_v1'),
  ('120250209281980716', '4x5_ia-solta_v1')
on conflict (ad_id) do nothing;

create table if not exists public.lead_descartados_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  deal_id uuid,
  contact_id uuid,
  telefone text,
  nome text,
  anuncio_id text,
  anuncio_nome text,
  ctwa_clid text,
  motivo text not null default 'sem_resposta',
  descricao text not null,
  clicou_em timestamptz,
  descartado_em timestamptz not null default now(),
  reativado_em timestamptz
);
alter table public.lead_descartados_log enable row level security;
create index if not exists lead_descartados_log_conv_idx on public.lead_descartados_log (conversation_id);
create index if not exists lead_descartados_log_data_idx on public.lead_descartados_log (descartado_em);

drop function if exists public.descartar_leads_sem_resposta(int);

create or replace function public.descartar_leads_sem_resposta(p_minutos int default 5, p_horas int default 12)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_ad_id text;
  v_ad_nome text;
  v_origem text;
  n int := 0;
begin
  for r in
    select * from (
      select c.id conv_id, c.organization_id, c.contact_id, c.external_contact_id phone,
             c.external_contact_name nome, c.metadata, c.created_at, d.id deal_id, d.custom_fields,
             case
               when (select count(*) from messaging_messages m where m.conversation_id = c.id and m.direction = 'inbound') = 1
                    and (select count(*) from messaging_messages m where m.conversation_id = c.id and m.direction = 'outbound') >= 1
                    and (select max(m.created_at) from messaging_messages m where m.conversation_id = c.id)
                        < now() - make_interval(mins => p_minutos)
                 then 'sem_resposta'
               when (select count(*) from messaging_messages m where m.conversation_id = c.id and m.direction = 'inbound') >= 2
                    and not exists (select 1 from messaging_messages m where m.conversation_id = c.id
                                    and m.direction = 'outbound' and m.sender_type is distinct from 'ai')
                    and (select max(m.created_at) from messaging_messages m where m.conversation_id = c.id)
                        < now() - make_interval(hours => p_horas)
                 then 'sem_interesse'
             end as motivo
      from messaging_conversations c
      join deals d on d.id = (c.metadata->>'deal_id')::uuid
      where c.status = 'open'
        and d.deleted_at is null
        and coalesce(c.metadata->>'ai_paused', 'false') <> 'true'
        and coalesce(c.metadata->>'lead_descartado', 'false') <> 'true'
        and d.stage_id = (select s.id from board_stages s where s.board_id = d.board_id order by s."order" limit 1)
    ) x
    where x.motivo is not null
  loop
    v_ad_id := coalesce(r.metadata->'ad_attribution'->>'ad_source_id', r.custom_fields->>'ad_source_id');
    select nome into v_ad_nome from meta_anuncios_nomes where ad_id = v_ad_id;
    v_origem := case when v_ad_id is not null
                  then 'Clicou no anúncio ' || coalesce(v_ad_nome, v_ad_id)
                  else 'Entrou em contato (sem anúncio identificado)' end;

    insert into lead_descartados_log
      (organization_id, conversation_id, deal_id, contact_id, telefone, nome,
       anuncio_id, anuncio_nome, ctwa_clid, motivo, descricao, clicou_em)
    values
      (r.organization_id, r.conv_id, r.deal_id, r.contact_id, r.phone, r.nome,
       v_ad_id, v_ad_nome,
       coalesce(r.metadata->'ad_attribution'->>'ctwa_clid', r.custom_fields->>'ctwa_clid'),
       r.motivo,
       v_origem || case r.motivo
         when 'sem_resposta' then ' e não respondeu'
         else ', respondeu, mas não demonstrou interesse (' || p_horas || 'h sem mensagem)' end,
       r.created_at);

    update deals set deleted_at = now() where id = r.deal_id;
    update contacts set deleted_at = now()
      where id = r.contact_id and deleted_at is null
        and not exists (select 1 from deals d2 where d2.contact_id = r.contact_id
                        and d2.deleted_at is null and d2.id <> r.deal_id);
    update messaging_conversations
      set status = 'resolved',
          metadata = coalesce(metadata, '{}'::jsonb)
                     || jsonb_build_object('lead_descartado', true, 'descartado_em', now())
      where id = r.conv_id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.reativar_lead_descartado(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal uuid;
  v_contact uuid;
begin
  select (metadata->>'deal_id')::uuid, contact_id into v_deal, v_contact
  from messaging_conversations
  where id = p_conversation_id and coalesce(metadata->>'lead_descartado', 'false') = 'true';
  if not found then return; end if;

  update deals set deleted_at = null where id = v_deal;
  update contacts set deleted_at = null where id = v_contact;
  update messaging_conversations
    set metadata = metadata || jsonb_build_object('lead_descartado', false, 'reativado_em', now())
    where id = p_conversation_id;
  update lead_descartados_log set reativado_em = now()
    where conversation_id = p_conversation_id and reativado_em is null;
end;
$$;

revoke execute on function public.descartar_leads_sem_resposta(int, int) from public, anon, authenticated;
revoke execute on function public.reativar_lead_descartado(uuid) from public, anon, authenticated;

create or replace view public.v_leads_descartados with (security_invoker = true) as
select descartado_em, clicou_em, coalesce(anuncio_nome, anuncio_id, '(sem anúncio)') as anuncio,
       motivo, descricao, telefone, nome, reativado_em
from public.lead_descartados_log
order by descartado_em desc;

-- Reativação automática: mensagem recebida numa conversa descartada restaura o lead
create or replace function public.trg_reativar_lead_descartado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'inbound' then perform public.reativar_lead_descartado(new.conversation_id); end if;
  return new;
end; $$;
revoke execute on function public.trg_reativar_lead_descartado() from public, anon, authenticated;
drop trigger if exists reativar_lead_descartado_on_inbound on public.messaging_messages;
create trigger reativar_lead_descartado_on_inbound
  after insert on public.messaging_messages
  for each row execute function public.trg_reativar_lead_descartado();

-- Agendamento (ativo desde 2026-11-04; usa os padrões: 5 min e 12 h)
-- create extension if not exists pg_cron;
-- select cron.schedule('descartar-leads-sem-resposta', '30 seconds', $$select public.descartar_leads_sem_resposta(5)$$);
-- Desligar: select cron.unschedule('descartar-leads-sem-resposta');
