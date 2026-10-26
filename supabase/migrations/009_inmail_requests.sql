-- LinkedIn InMail requests: managers request, only admins send ------------------

create table if not exists public.inmail_requests (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references public.jobs(id) on delete cascade,
  requested_by       uuid not null references public.profiles(id),
  requested_by_name  text,
  note               text,
  status             text not null default 'pending' check (status in ('pending','completed')),
  handled_by         uuid references public.profiles(id),
  handled_by_name    text,
  handled_at         timestamptz,
  created_at         timestamptz not null default now()
);

create table if not exists public.inmail_request_items (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references public.inmail_requests(id) on delete cascade,
  job_candidate_id uuid not null references public.job_candidates(id) on delete cascade,
  status           text not null default 'pending' check (status in ('pending','sent','skipped')),
  sent_at          timestamptz,
  unique (request_id, job_candidate_id)
);
create index if not exists inmail_items_jc_idx on public.inmail_request_items (job_candidate_id);
create index if not exists inmail_items_req_idx on public.inmail_request_items (request_id);
create index if not exists inmail_requests_status_idx on public.inmail_requests (status, created_at desc);

alter table public.inmail_requests enable row level security;
alter table public.inmail_request_items enable row level security;
drop policy if exists "team reads inmail requests" on public.inmail_requests;
create policy "team reads inmail requests" on public.inmail_requests
  for select to authenticated using ((select current_app_role()) is not null);
drop policy if exists "team reads inmail items" on public.inmail_request_items;
create policy "team reads inmail items" on public.inmail_request_items
  for select to authenticated using ((select current_app_role()) is not null);
-- no write policies: writes go through the RPCs below

-- Managers (or admins) request InMails for candidates ----------------------------
create or replace function public.request_inmails(p_job_candidate_ids uuid[], p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role app_role := current_app_role();
  v_name text := (select full_name from profiles where id = auth.uid());
  v_job record; v_ids uuid[]; v_req uuid; v_added int := 0; v_skipped int := 0; v_n int; v_reqs int := 0; v_code text;
begin
  if v_role is null then raise exception 'Not allowed'; end if;
  if coalesce(array_length(p_job_candidate_ids,1),0) = 0 then raise exception 'Select at least one candidate'; end if;
  if array_length(p_job_candidate_ids,1) > 500 then raise exception 'Request at most 500 candidates at a time'; end if;

  for v_job in
    select distinct jc.job_id from job_candidates jc
     where jc.id = any(p_job_candidate_ids)
       and (v_role in ('super_admin','admin') or jc.call_assigned_to = auth.uid())
  loop
    -- eligible: not already sent / not already waiting in a pending request
    select coalesce(array_agg(jc.id), '{}') into v_ids from job_candidates jc
     where jc.job_id = v_job.job_id and jc.id = any(p_job_candidate_ids)
       and (v_role in ('super_admin','admin') or jc.call_assigned_to = auth.uid())
       and jc.linkedin_status in ('not_started','queued')
       and not exists (select 1 from inmail_request_items i where i.job_candidate_id = jc.id and i.status = 'pending');
    v_n := coalesce(array_length(v_ids,1),0);
    if v_n = 0 then continue; end if;
    insert into inmail_requests (job_id, requested_by, requested_by_name, note)
    values (v_job.job_id, auth.uid(), v_name, nullif(trim(coalesce(p_note,'')), '')) returning id into v_req;
    insert into inmail_request_items (request_id, job_candidate_id) select v_req, unnest(v_ids);
    v_added := v_added + v_n; v_reqs := v_reqs + 1;
    select job_code into v_code from jobs where id = v_job.job_id;
    perform notify_admins('inmail_request', v_name || ' requested ' || v_n || ' InMail' || case when v_n > 1 then 's' else '' end,
      v_code || coalesce(' · ' || nullif(trim(coalesce(p_note,'')), ''), ''), '/inmails',
      jsonb_build_object('request_id', v_req), auth.uid());
  end loop;

  v_skipped := array_length(p_job_candidate_ids,1) - v_added;
  return jsonb_build_object('requests', v_reqs, 'added', v_added, 'skipped', v_skipped);
end $$;
revoke execute on function public.request_inmails(uuid[], text) from anon, public;
grant execute on function public.request_inmails(uuid[], text) to authenticated;

-- Admins only: mark items sent / skipped ------------------------------------------
create or replace function public.resolve_inmail_items(p_item_ids uuid[], p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := (select full_name from profiles where id = auth.uid());
  v_req record; v_done int := 0; v_left int;
begin
  if current_app_role() not in ('super_admin','admin') then raise exception 'Only admins can send InMails'; end if;
  if p_action not in ('sent','skipped') then raise exception 'Invalid action'; end if;

  if p_action = 'sent' then
    perform set_config('app.activity_note', coalesce(nullif(trim(coalesce(p_note,'')), ''), 'InMail sent'), true);
    update job_candidates jc set linkedin_status = 'sent'
      from inmail_request_items i
     where i.id = any(p_item_ids) and i.status = 'pending' and i.job_candidate_id = jc.id
       and jc.linkedin_status in ('not_started','queued');
  end if;

  update inmail_request_items set status = p_action, sent_at = case when p_action = 'sent' then now() end
   where id = any(p_item_ids) and status = 'pending';
  get diagnostics v_done = row_count;

  for v_req in
    select distinct r.id, r.requested_by, r.job_id,
           (select count(*) from inmail_request_items x where x.id = any(p_item_ids) and x.request_id = r.id and x.status = p_action) n
      from inmail_requests r join inmail_request_items i on i.request_id = r.id
     where i.id = any(p_item_ids)
  loop
    select count(*) into v_left from inmail_request_items where request_id = v_req.id and status = 'pending';
    if v_left = 0 then
      update inmail_requests set status = 'completed', handled_by = auth.uid(), handled_by_name = v_name, handled_at = now() where id = v_req.id;
    end if;
    if v_req.n > 0 and v_req.requested_by <> auth.uid() then
      insert into notifications (user_id, kind, title, body, link, meta)
      values (v_req.requested_by, case p_action when 'sent' then 'inmail_sent' else 'inmail_skipped' end,
              v_req.n || ' InMail' || case when v_req.n > 1 then 's ' else ' ' end || case p_action when 'sent' then 'sent' else 'skipped' end,
              (select job_code from jobs where id = v_req.job_id) || ' · by ' || v_name, '/inmails',
              jsonb_build_object('request_id', v_req.id));
    end if;
  end loop;
  return jsonb_build_object('updated', v_done);
end $$;
revoke execute on function public.resolve_inmail_items(uuid[], text, text) from anon, public;
grant execute on function public.resolve_inmail_items(uuid[], text, text) to authenticated;

-- Pending InMail counts for dashboards / nav badge ----------------------------------
create or replace function public.inmail_pending_count()
returns int language sql stable security invoker set search_path = public as $$
  select count(*)::int from inmail_request_items where status = 'pending'
$$;
revoke execute on function public.inmail_pending_count() from anon, public;
grant execute on function public.inmail_pending_count() to authenticated;
