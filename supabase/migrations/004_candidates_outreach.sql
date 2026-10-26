-- Step 2: candidates, tagged upload lots (batches), 4-channel outreach status, calling workflow.
-- Already applied to the Supabase project.

-- Candidates (master list, one row per person)
create table public.candidates (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  email           text,
  phone           text,
  phone_digits    text generated always as (regexp_replace(coalesce(phone, ''), '\D', '', 'g')) stored,
  linkedin_url    text,
  current_title   text,
  current_company text,
  location        text,
  notes           text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index candidates_email_uq on public.candidates (lower(email)) where email is not null and email <> '';
create unique index candidates_linkedin_uq on public.candidates (lower(linkedin_url)) where linkedin_url is not null and linkedin_url <> '';
create index candidates_phone_idx on public.candidates (phone_digits);
create index candidates_created_by_idx on public.candidates (created_by);

-- Upload lots ("batches"), tagged at upload time
create table public.candidate_batches (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs(id) on delete cascade,
  tag             text not null check (length(trim(tag)) > 0),
  source          text,
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now()
);
create unique index candidate_batches_job_tag_uq on public.candidate_batches (job_id, lower(tag));
create index candidate_batches_created_by_idx on public.candidate_batches (created_by);

-- A candidate on a job, with the status of each of the 4 outreach channels
create table public.job_candidates (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.jobs(id) on delete cascade,
  candidate_id      uuid not null references public.candidates(id) on delete cascade,
  batch_id          uuid references public.candidate_batches(id) on delete set null,
  rcs_status        text not null default 'not_started'
    check (rcs_status in ('not_started','queued','sent','delivered','replied','interested','not_interested','failed','opted_out')),
  email_status      text not null default 'not_started'
    check (email_status in ('not_started','queued','sent','delivered','replied','interested','not_interested','failed','opted_out')),
  linkedin_status   text not null default 'not_started'
    check (linkedin_status in ('not_started','queued','sent','delivered','replied','interested','not_interested','failed','opted_out')),
  call_status       text not null default 'not_called'
    check (call_status in ('not_called','no_answer','voicemail','busy','call_back_later','connected_interested','connected_not_interested','wrong_number','do_not_call')),
  call_assigned_to  uuid references auth.users(id) on delete set null,
  call_attempts     int not null default 0,
  last_called_at    timestamptz,
  next_follow_up_at timestamptz,
  call_notes        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (job_id, candidate_id)
);
create index job_candidates_job_idx on public.job_candidates (job_id);
create index job_candidates_batch_idx on public.job_candidates (batch_id);
create index job_candidates_candidate_idx on public.job_candidates (candidate_id);
create index job_candidates_caller_idx on public.job_candidates (call_assigned_to, call_status);

-- History of every status change / call note
create table public.candidate_activity (
  id               uuid primary key default gen_random_uuid(),
  job_candidate_id uuid not null references public.job_candidates(id) on delete cascade,
  channel          text not null,
  from_status      text,
  to_status        text,
  note             text,
  actor            uuid references auth.users(id) on delete set null,
  actor_name       text,
  created_at       timestamptz not null default now()
);
create index candidate_activity_jc_idx on public.candidate_activity (job_candidate_id, created_at desc);
create index candidate_activity_actor_idx on public.candidate_activity (actor);

-- Triggers
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create trigger candidates_touch before update on public.candidates for each row execute function public.touch_updated_at();
create trigger job_candidates_touch before update on public.job_candidates for each row execute function public.touch_updated_at();

create or replace function public.job_candidates_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_note text := nullif(current_setting('app.activity_note', true), '');
  v_name text;
begin
  select full_name into v_name from public.profiles where id = auth.uid();
  if new.rcs_status is distinct from old.rcs_status then
    insert into public.candidate_activity (job_candidate_id, channel, from_status, to_status, note, actor, actor_name)
    values (new.id, 'rcs', old.rcs_status, new.rcs_status, v_note, auth.uid(), v_name);
  end if;
  if new.email_status is distinct from old.email_status then
    insert into public.candidate_activity (job_candidate_id, channel, from_status, to_status, note, actor, actor_name)
    values (new.id, 'email', old.email_status, new.email_status, v_note, auth.uid(), v_name);
  end if;
  if new.linkedin_status is distinct from old.linkedin_status then
    insert into public.candidate_activity (job_candidate_id, channel, from_status, to_status, note, actor, actor_name)
    values (new.id, 'linkedin', old.linkedin_status, new.linkedin_status, v_note, auth.uid(), v_name);
  end if;
  if new.call_status is distinct from old.call_status then
    insert into public.candidate_activity (job_candidate_id, channel, from_status, to_status, note, actor, actor_name)
    values (new.id, 'call', old.call_status, new.call_status, v_note, auth.uid(), v_name);
  end if;
  if new.call_assigned_to is distinct from old.call_assigned_to then
    insert into public.candidate_activity (job_candidate_id, channel, from_status, to_status, note, actor, actor_name)
    values (new.id, 'assignment', old.call_assigned_to::text, new.call_assigned_to::text, v_note, auth.uid(), v_name);
  end if;
  return new;
end $$;
revoke execute on function public.job_candidates_log() from public, anon, authenticated;
create trigger job_candidates_log after update on public.job_candidates
  for each row execute function public.job_candidates_log();

-- RPC: create a tagged lot (admins only)
create or replace function public.create_candidate_batch(p_job_id uuid, p_tag text, p_source text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if public.current_app_role() not in ('super_admin','admin') then raise exception 'Not allowed'; end if;
  insert into public.candidate_batches (job_id, tag, source, created_by, created_by_name)
  values (p_job_id, trim(p_tag), nullif(trim(coalesce(p_source,'')), ''), auth.uid(),
          (select full_name from public.profiles where id = auth.uid()))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'A lot with the tag "%" already exists on this job', p_tag;
end $$;

-- RPC: add rows to a lot. Matches existing people by email, then LinkedIn, then phone.
create or replace function public.add_candidates_to_batch(p_batch_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_job uuid;
  r jsonb;
  v_name text; v_email text; v_phone text; v_li text; v_digits text;
  v_cid uuid; v_added int := 0; v_dup int := 0; v_new int := 0; v_skipped int := 0; v_n int;
begin
  if public.current_app_role() not in ('super_admin','admin') then raise exception 'Not allowed'; end if;
  select job_id into v_job from public.candidate_batches where id = p_batch_id;
  if v_job is null then raise exception 'Lot not found'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_name  := nullif(trim(coalesce(r->>'full_name','')), '');
    v_email := nullif(lower(trim(coalesce(r->>'email',''))), '');
    v_phone := nullif(trim(coalesce(r->>'phone','')), '');
    v_li    := nullif(regexp_replace(regexp_replace(lower(trim(coalesce(r->>'linkedin_url',''))), '^https?://(www\.)?', ''), '[/?#].*$', ''), '');
    -- keep /in/<handle>
    if nullif(trim(coalesce(r->>'linkedin_url','')), '') is not null then
      v_li := regexp_replace(regexp_replace(lower(trim(r->>'linkedin_url')), '^https?://(www\.)?', ''), '[?#].*$', '');
      v_li := regexp_replace(v_li, '/+$', '');
    end if;
    v_digits := regexp_replace(coalesce(v_phone,''), '\D', '', 'g');

    if v_name is null or (v_email is null and v_li is null and length(v_digits) < 7) then
      v_skipped := v_skipped + 1; continue;
    end if;

    v_cid := null;
    if v_email is not null then select id into v_cid from public.candidates where lower(email) = v_email; end if;
    if v_cid is null and v_li is not null then select id into v_cid from public.candidates where lower(linkedin_url) = v_li; end if;
    if v_cid is null and length(v_digits) >= 7 then select id into v_cid from public.candidates where phone_digits = v_digits limit 1; end if;

    if v_cid is null then
      insert into public.candidates (full_name, email, phone, linkedin_url, current_title, current_company, location, created_by)
      values (v_name, v_email, v_phone, v_li,
              nullif(trim(coalesce(r->>'current_title','')), ''),
              nullif(trim(coalesce(r->>'current_company','')), ''),
              nullif(trim(coalesce(r->>'location','')), ''), auth.uid())
      returning id into v_cid;
      v_new := v_new + 1;
    else
      update public.candidates set
        email = coalesce(email, v_email), phone = coalesce(phone, v_phone), linkedin_url = coalesce(linkedin_url, v_li),
        current_title = coalesce(current_title, nullif(trim(coalesce(r->>'current_title','')), '')),
        current_company = coalesce(current_company, nullif(trim(coalesce(r->>'current_company','')), '')),
        location = coalesce(location, nullif(trim(coalesce(r->>'location','')), ''))
      where id = v_cid;
    end if;

    insert into public.job_candidates (job_id, candidate_id, batch_id)
    values (v_job, v_cid, p_batch_id) on conflict (job_id, candidate_id) do nothing;
    get diagnostics v_n = row_count;
    if v_n = 1 then v_added := v_added + 1; else v_dup := v_dup + 1; end if;
  end loop;

  return jsonb_build_object('added', v_added, 'already_on_job', v_dup, 'new_people', v_new, 'skipped', v_skipped);
end $$;

-- RPC: log a call (recruiting managers for their own assigned rows; admins for any)
create or replace function public.log_call(p_id uuid, p_status text, p_note text default null, p_follow_up timestamptz default null)
returns public.job_candidates language plpgsql security definer set search_path = public as $$
declare
  v_role public.app_role := public.current_app_role();
  v_old public.job_candidates;
  v_new public.job_candidates;
begin
  if v_role is null or v_role not in ('super_admin','admin','recruiting_manager') then raise exception 'Not allowed'; end if;
  select * into v_old from public.job_candidates where id = p_id;
  if not found then raise exception 'Candidate not found'; end if;
  if v_role = 'recruiting_manager' and v_old.call_assigned_to is distinct from auth.uid() then
    raise exception 'This candidate is not assigned to you';
  end if;
  if p_status not in ('not_called','no_answer','voicemail','busy','call_back_later','connected_interested','connected_not_interested','wrong_number','do_not_call') then
    raise exception 'Invalid call status';
  end if;
  perform set_config('app.activity_note', coalesce(p_note, ''), true);
  update public.job_candidates set
    call_status = p_status,
    call_attempts = call_attempts + case when p_status <> 'not_called' then 1 else 0 end,
    last_called_at = case when p_status <> 'not_called' then now() else last_called_at end,
    next_follow_up_at = p_follow_up,
    call_notes = coalesce(nullif(trim(coalesce(p_note,'')), ''), call_notes)
  where id = p_id returning * into v_new;
  if v_old.call_status = v_new.call_status and nullif(trim(coalesce(p_note,'')), '') is not null then
    insert into public.candidate_activity (job_candidate_id, channel, from_status, to_status, note, actor, actor_name)
    values (p_id, 'call', v_old.call_status, v_new.call_status, p_note, auth.uid(),
            (select full_name from public.profiles where id = auth.uid()));
  end if;
  return v_new;
end $$;

revoke execute on function public.create_candidate_batch(uuid, text, text) from public, anon;
revoke execute on function public.add_candidates_to_batch(uuid, jsonb) from public, anon;
revoke execute on function public.log_call(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.create_candidate_batch(uuid, text, text) to authenticated;
grant execute on function public.add_candidates_to_batch(uuid, jsonb) to authenticated;
grant execute on function public.log_call(uuid, text, text, timestamptz) to authenticated;

-- RLS: admins manage everything; recruiting managers only see rows assigned to them for calling
alter table public.candidates enable row level security;
alter table public.candidate_batches enable row level security;
alter table public.job_candidates enable row level security;
alter table public.candidate_activity enable row level security;

create policy "candidates select" on public.candidates for select to authenticated using (
  (select public.current_app_role()) in ('super_admin','admin')
  or exists (select 1 from public.job_candidates jc where jc.candidate_id = candidates.id and jc.call_assigned_to = (select auth.uid()))
);
create policy "candidates insert" on public.candidates for insert to authenticated
  with check ((select public.current_app_role()) in ('super_admin','admin'));
create policy "candidates update" on public.candidates for update to authenticated
  using ((select public.current_app_role()) in ('super_admin','admin'))
  with check ((select public.current_app_role()) in ('super_admin','admin'));
create policy "candidates delete" on public.candidates for delete to authenticated
  using ((select public.current_app_role()) = 'super_admin');

create policy "batches select" on public.candidate_batches for select to authenticated using (
  (select public.current_app_role()) in ('super_admin','admin')
  or exists (select 1 from public.job_candidates jc where jc.batch_id = candidate_batches.id and jc.call_assigned_to = (select auth.uid()))
);
create policy "batches update" on public.candidate_batches for update to authenticated
  using ((select public.current_app_role()) in ('super_admin','admin'))
  with check ((select public.current_app_role()) in ('super_admin','admin'));
create policy "batches delete" on public.candidate_batches for delete to authenticated
  using ((select public.current_app_role()) = 'super_admin');

create policy "job_candidates select" on public.job_candidates for select to authenticated using (
  (select public.current_app_role()) in ('super_admin','admin') or call_assigned_to = (select auth.uid())
);
create policy "job_candidates insert" on public.job_candidates for insert to authenticated
  with check ((select public.current_app_role()) in ('super_admin','admin'));
create policy "job_candidates update" on public.job_candidates for update to authenticated
  using ((select public.current_app_role()) in ('super_admin','admin'))
  with check ((select public.current_app_role()) in ('super_admin','admin'));
create policy "job_candidates delete" on public.job_candidates for delete to authenticated
  using ((select public.current_app_role()) in ('super_admin','admin'));

create policy "activity select" on public.candidate_activity for select to authenticated using (
  (select public.current_app_role()) in ('super_admin','admin')
  or exists (select 1 from public.job_candidates jc where jc.id = candidate_activity.job_candidate_id and jc.call_assigned_to = (select auth.uid()))
);
