-- Email outreach via Outlook (Microsoft Graph) -- Dwip only ------------------------

create table if not exists public.mail_accounts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  provider     text not null default 'outlook',
  email        text not null,
  display_name text,
  status       text not null default 'connected' check (status in ('connected','needs_reconnect')),
  connected_at timestamptz not null default now(),
  unique (user_id, email)
);
-- tokens live apart, with RLS on and NO policies: only the service role (edge functions) can read them
create table if not exists public.mail_tokens (
  account_id    uuid primary key references public.mail_accounts(id) on delete cascade,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null
);
create table if not exists public.oauth_states (
  state      text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  return_to  text,
  created_at timestamptz not null default now()
);
alter table public.mail_accounts enable row level security;
alter table public.mail_tokens enable row level security;
alter table public.oauth_states enable row level security;
drop policy if exists "own mail accounts" on public.mail_accounts;
create policy "own mail accounts" on public.mail_accounts for select to authenticated
  using (user_id = (select auth.uid()) and (select current_app_role()) = 'super_admin');

create table if not exists public.email_campaigns (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  job_id     uuid not null references public.jobs(id) on delete cascade,
  batch_id   uuid references public.candidate_batches(id) on delete set null,
  account_id uuid not null references public.mail_accounts(id),
  subject    text not null,
  body       text not null,
  lot_size   int not null default 20 check (lot_size between 1 and 50),
  status     text not null default 'active' check (status in ('active','done','cancelled')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.email_sends (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references public.email_campaigns(id) on delete cascade,
  job_candidate_id uuid not null references public.job_candidates(id) on delete cascade,
  to_email         text not null,
  to_name          text,
  lot_no           int not null,
  seq              bigint generated always as identity,
  status           text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped')),
  error            text,
  claimed_at       timestamptz,
  sent_at          timestamptz,
  unique (campaign_id, job_candidate_id)
);
create index if not exists email_sends_camp_idx on public.email_sends (campaign_id, lot_no, status, seq);
create index if not exists email_sends_jc_idx on public.email_sends (job_candidate_id);
alter table public.email_campaigns enable row level security;
alter table public.email_sends enable row level security;
drop policy if exists "owner reads campaigns" on public.email_campaigns;
create policy "owner reads campaigns" on public.email_campaigns for select to authenticated
  using ((select current_app_role()) = 'super_admin');
drop policy if exists "owner reads sends" on public.email_sends;
create policy "owner reads sends" on public.email_sends for select to authenticated
  using ((select current_app_role()) = 'super_admin');

create or replace function public._require_owner() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if current_app_role() is distinct from 'super_admin' then raise exception 'Only Dwip can use email outreach'; end if;
end $$;
revoke execute on function public._require_owner() from anon, public, authenticated;

-- How many people in this lot can actually be emailed?
create or replace function public.email_lot_preview(p_job_id uuid, p_batch_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform _require_owner();
  select jsonb_build_object(
    'total', count(*),
    'with_email', count(*) filter (where coalesce(nullif(trim(c.email),''), nullif(trim(c.alt_email),'')) is not null),
    'eligible', count(*) filter (where coalesce(nullif(trim(c.email),''), nullif(trim(c.alt_email),'')) is not null
                                   and jc.email_status in ('not_started','queued')
                                   and not exists (select 1 from email_sends s join email_campaigns k on k.id = s.campaign_id
                                                    where s.job_candidate_id = jc.id and s.status in ('queued','sending') and k.status = 'active')),
    'already_emailed', count(*) filter (where jc.email_status not in ('not_started','queued'))
  ) into r
  from job_candidates jc join candidates c on c.id = jc.candidate_id
  where jc.job_id = p_job_id and (p_batch_id is null or jc.batch_id = p_batch_id);
  return r;
end $$;

create or replace function public.create_email_campaign(p_job_id uuid, p_batch_id uuid, p_account_id uuid, p_name text, p_subject text, p_body text, p_lot_size int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int;
begin
  perform _require_owner();
  if not exists (select 1 from mail_accounts where id = p_account_id and user_id = auth.uid() and status = 'connected') then
    raise exception 'Connect your Outlook mailbox first';
  end if;
  if length(trim(coalesce(p_subject,''))) = 0 or length(trim(coalesce(p_body,''))) = 0 then raise exception 'Subject and body are required'; end if;
  insert into email_campaigns (name, job_id, batch_id, account_id, subject, body, lot_size)
  values (coalesce(nullif(trim(p_name),''), 'Email campaign'), p_job_id, p_batch_id, p_account_id, trim(p_subject), p_body, p_lot_size)
  returning id into v_id;

  insert into email_sends (campaign_id, job_candidate_id, to_email, to_name, lot_no)
  select v_id, x.id, x.addr, x.full_name, ((row_number() over (order by x.created_at, x.id) - 1) / p_lot_size)::int + 1
    from (
      select jc.id, jc.created_at, c.full_name, coalesce(nullif(trim(c.email),''), nullif(trim(c.alt_email),'')) addr
        from job_candidates jc join candidates c on c.id = jc.candidate_id
       where jc.job_id = p_job_id and (p_batch_id is null or jc.batch_id = p_batch_id)
         and jc.email_status in ('not_started','queued')
         and not exists (select 1 from email_sends s join email_campaigns k on k.id = s.campaign_id
                          where s.job_candidate_id = jc.id and s.status in ('queued','sending') and k.status = 'active')
    ) x where x.addr is not null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'No one in this lot can be emailed (missing email, already emailed, or already queued)';
  end if;
  return jsonb_build_object('campaign_id', v_id, 'queued', v_n, 'lots', ((v_n - 1) / p_lot_size) + 1);
end $$;

-- Claim the next queued email of a lot (one at a time; the UI paces the calls)
create or replace function public.claim_next_email(p_campaign_id uuid, p_lot_no int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_send email_sends; v_camp email_campaigns; v_today int; v_left int; v_out jsonb;
begin
  perform _require_owner();
  select * into v_camp from email_campaigns where id = p_campaign_id and status = 'active';
  if not found then return null; end if;
  -- put emails stuck in 'sending' for >5 min back in the queue
  update email_sends set status = 'queued' where campaign_id = p_campaign_id and status = 'sending' and claimed_at < now() - interval '5 minutes';
  select count(*) into v_today from email_sends s join email_campaigns k on k.id = s.campaign_id
   where k.account_id = v_camp.account_id and s.status = 'sent' and s.sent_at >= date_trunc('day', now());
  if v_today >= 150 then raise exception 'Daily cap of 150 emails reached for this mailbox'; end if;

  select * into v_send from email_sends
   where campaign_id = p_campaign_id and lot_no = p_lot_no and status = 'queued'
   order by seq limit 1 for update skip locked;
  if not found then return null; end if;
  update email_sends set status = 'sending', claimed_at = now() where id = v_send.id;
  select count(*) into v_left from email_sends where campaign_id = p_campaign_id and lot_no = p_lot_no and status = 'queued';

  select jsonb_build_object(
    'send_id', v_send.id, 'to_email', v_send.to_email, 'to_name', v_send.to_name, 'account_id', v_camp.account_id,
    'subject', v_camp.subject, 'body', v_camp.body, 'left_in_lot', v_left,
    'full_name', c.full_name, 'company', c.current_company, 'title', c.current_title,
    'job_title', j.title, 'client', j.client_name, 'location', j.location)
  into v_out
  from job_candidates jc join candidates c on c.id = jc.candidate_id join jobs j on j.id = jc.job_id
  where jc.id = v_send.job_candidate_id;
  return v_out;
end $$;

create or replace function public.finish_email(p_send_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_send email_sends; v_subject text; v_left int;
begin
  perform _require_owner();
  select * into v_send from email_sends where id = p_send_id;
  if not found then return; end if;
  select subject into v_subject from email_campaigns where id = v_send.campaign_id;
  if p_ok then
    update email_sends set status = 'sent', sent_at = now(), error = null where id = p_send_id;
    perform set_config('app.activity_note', 'Email sent: ' || v_subject, true);
    update job_candidates set email_status = 'sent' where id = v_send.job_candidate_id and email_status in ('not_started','queued');
  else
    update email_sends set status = 'failed', error = left(p_error, 500) where id = p_send_id;
    perform set_config('app.activity_note', 'Email failed: ' || left(coalesce(p_error,''), 120), true);
    update job_candidates set email_status = 'failed' where id = v_send.job_candidate_id and email_status in ('not_started','queued');
  end if;
  select count(*) into v_left from email_sends where campaign_id = v_send.campaign_id and status in ('queued','sending');
  if v_left = 0 then update email_campaigns set status = 'done' where id = v_send.campaign_id and status = 'active'; end if;
end $$;

create or replace function public.cancel_email_campaign(p_campaign_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_owner();
  update email_sends set status = 'skipped' where campaign_id = p_campaign_id and status in ('queued','sending');
  update email_campaigns set status = 'cancelled' where id = p_campaign_id and status = 'active';
end $$;

create or replace function public.disconnect_mail_account(p_account_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_owner();
  if exists (select 1 from email_campaigns where account_id = p_account_id and status = 'active') then
    raise exception 'Cancel or finish the active campaigns first';
  end if;
  begin
    delete from mail_accounts where id = p_account_id and user_id = auth.uid();
  exception when foreign_key_violation then
    delete from mail_tokens where account_id = p_account_id;
    update mail_accounts set status = 'needs_reconnect' where id = p_account_id and user_id = auth.uid();
  end;
end $$;

do $$ declare f text; begin
  foreach f in array array['email_lot_preview(uuid,uuid)','create_email_campaign(uuid,uuid,uuid,text,text,text,int)','claim_next_email(uuid,int)','finish_email(uuid,boolean,text)','cancel_email_campaign(uuid)','disconnect_mail_account(uuid)']
  loop
    execute format('revoke execute on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
