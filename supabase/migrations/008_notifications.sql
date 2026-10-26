-- Notifications + activity feed ------------------------------------------------

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text,
  link       text,
  meta       jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists "own notifications" on public.notifications;
create policy "own notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
-- no insert/update/delete policies: rows are written by triggers and marked read via RPC

create or replace function public.notify_admins(p_kind text, p_title text, p_body text, p_link text, p_meta jsonb, p_skip uuid)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, kind, title, body, link, meta)
  select id, p_kind, p_title, p_body, p_link, p_meta
  from profiles
  where role in ('super_admin','admin') and id is distinct from p_skip
$$;
revoke all on function public.notify_admins(text,text,text,text,jsonb,uuid) from public, anon, authenticated;

-- 1. New JD submitted -> admins
create or replace function public.trg_notify_job_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform notify_admins('jd_submitted', 'New JD to review',
    coalesce(new.submitted_by_name, 'Someone') || ' submitted ' || new.job_code,
    '/jobs/' || new.job_code, jsonb_build_object('job_id', new.id), new.submitted_by);
  return new;
end $$;
drop trigger if exists jobs_notify_insert on public.jobs;
create trigger jobs_notify_insert after insert on public.jobs
  for each row execute function public.trg_notify_job_insert();

-- 2. Job status changed -> submitter
create or replace function public.trg_notify_job_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_label text;
begin
  if new.status is distinct from old.status and new.submitted_by is not null
     and new.submitted_by is distinct from auth.uid() then
    select label into v_label from job_statuses where key = new.status;
    insert into notifications (user_id, kind, title, body, link, meta)
    values (new.submitted_by, 'job_status', new.job_code || ' is now ' || coalesce(v_label, new.status),
            coalesce(new.title, 'Your submitted JD') || case when new.reviewed_by_name is not null then ' · by ' || new.reviewed_by_name else '' end,
            '/jobs/' || new.job_code, jsonb_build_object('job_id', new.id));
  end if;
  return new;
end $$;
drop trigger if exists jobs_notify_update on public.jobs;
create trigger jobs_notify_update after update on public.jobs
  for each row execute function public.trg_notify_job_update();

-- 3. Candidates assigned for calling -> caller (collapsed per job per hour)
create or replace function public.trg_notify_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text; v_nid uuid; v_count int;
begin
  if new.call_assigned_to is null
     or new.call_assigned_to is not distinct from auth.uid()
     or (tg_op = 'UPDATE' and new.call_assigned_to is not distinct from old.call_assigned_to) then
    return new;
  end if;
  select job_code into v_code from jobs where id = new.job_id;
  select id, coalesce((meta->>'count')::int, 1) into v_nid, v_count
    from notifications
   where user_id = new.call_assigned_to and kind = 'assigned' and read_at is null
     and meta->>'job_id' = new.job_id::text and created_at > now() - interval '1 hour'
   order by created_at desc limit 1;
  if v_nid is null then
    insert into notifications (user_id, kind, title, body, link, meta)
    values (new.call_assigned_to, 'assigned', '1 candidate assigned to you', 'Job ' || v_code, '/calling',
            jsonb_build_object('job_id', new.job_id, 'count', 1));
  else
    update notifications set
      title = (v_count + 1) || ' candidates assigned to you',
      meta = jsonb_set(meta, '{count}', to_jsonb(v_count + 1)),
      created_at = now()
    where id = v_nid;
  end if;
  return new;
end $$;
drop trigger if exists job_candidates_notify_assign on public.job_candidates;
create trigger job_candidates_notify_assign after insert or update of call_assigned_to on public.job_candidates
  for each row execute function public.trg_notify_assignment();

-- 4. Candidate replied / interested -> admins
create or replace function public.trg_notify_reply()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cand text; v_code text; v_ch text;
begin
  if new.to_status in ('interested','replied') and new.to_status is distinct from new.from_status then
    select c.full_name, j.job_code into v_cand, v_code
      from job_candidates jc join candidates c on c.id = jc.candidate_id join jobs j on j.id = jc.job_id
     where jc.id = new.job_candidate_id;
    v_ch := case new.channel when 'rcs' then 'RCS' when 'email' then 'Email' when 'linkedin' then 'LinkedIn' when 'call' then 'Call' else new.channel end;
    perform notify_admins('candidate_' || new.to_status,
      coalesce(v_cand, 'A candidate') || case new.to_status when 'interested' then ' is interested' else ' replied' end,
      v_ch || ' · ' || coalesce(v_code, '') || case when new.actor_name is not null then ' · ' || new.actor_name else '' end,
      '/jobs/' || coalesce(v_code, '') || '/candidates', jsonb_build_object('job_candidate_id', new.job_candidate_id), new.actor);
  end if;
  return new;
end $$;
drop trigger if exists activity_notify_reply on public.candidate_activity;
create trigger activity_notify_reply after insert on public.candidate_activity
  for each row execute function public.trg_notify_reply();

-- Mark read (null = all)
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void language sql security invoker set search_path = public as $$
  update notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids))
$$;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
revoke execute on function public.mark_notifications_read(uuid[]) from anon, public;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- Unified activity feed (invoker: RLS decides what each role sees) -------------
create or replace function public.activity_feed(p_limit int default 40)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc), '[]'::jsonb) from (
    select * from (
      select a.id::text as id, 'outreach'::text as type, a.created_at as at, a.actor_name as actor,
             c.full_name as subject, j.job_code, a.channel, a.from_status, a.to_status, a.note
        from candidate_activity a
        join job_candidates jc on jc.id = a.job_candidate_id
        join candidates c on c.id = jc.candidate_id
        join jobs j on j.id = jc.job_id
      union all
      select 'js' || j.id::text, 'jd_submitted', j.created_at, j.submitted_by_name, j.title, j.job_code, null, null, null, null
        from jobs j
       where current_app_role() in ('super_admin','admin') or j.submitted_by = auth.uid()
      union all
      select 'jr' || j.id::text, 'jd_reviewed', j.reviewed_at, j.reviewed_by_name, j.title, j.job_code, null, null, j.status, null
        from jobs j
       where j.reviewed_at is not null
         and (current_app_role() in ('super_admin','admin') or j.submitted_by = auth.uid())
    ) u order by at desc limit greatest(1, least(p_limit, 100))
  ) x
$$;
grant execute on function public.activity_feed(int) to authenticated;
revoke execute on function public.activity_feed(int) from anon, public;
grant execute on function public.activity_feed(int) to authenticated;
