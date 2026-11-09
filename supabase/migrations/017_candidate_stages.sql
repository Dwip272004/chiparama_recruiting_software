-- 017: ATS-style pipeline stage per candidate on a job (separate from the 4 outreach channel statuses).
--   sourced -> contacted -> interested -> shortlisted -> submitted -> interview_scheduled -> interview_done -> offered -> joined
--   side exits: rejected, withdrawn, on_hold
alter table public.job_candidates
  add column if not exists stage text not null default 'sourced'
    check (stage in ('sourced','contacted','interested','shortlisted','submitted','interview_scheduled','interview_done','offered','joined','rejected','withdrawn','on_hold')),
  add column if not exists stage_updated_at timestamptz not null default now(),
  add column if not exists interview_at timestamptz;
create index if not exists job_candidates_stage_idx on public.job_candidates (job_id, stage);

-- Backfill from what has already happened (without touching updated_at or writing history)
alter table public.job_candidates disable trigger user;
update public.job_candidates set stage = case
  when call_status = 'connected_interested' or 'interested' in (rcs_status, email_status, linkedin_status) then 'interested'
  when call_status <> 'not_called' or rcs_status <> 'not_started' or email_status <> 'not_started' or linkedin_status <> 'not_started' then 'contacted'
  else 'sourced' end;
alter table public.job_candidates enable trigger user;

-- Auto-advance early stages from outreach results; a manual stage change always wins.
create or replace function public.job_candidates_stage_auto()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_updated_at := now();
    return new;
  end if;
  if new.stage in ('sourced','contacted') and (
       new.rcs_status is distinct from old.rcs_status or new.email_status is distinct from old.email_status
    or new.linkedin_status is distinct from old.linkedin_status or new.call_status is distinct from old.call_status) then
    if new.stage = 'sourced' then new.stage := 'contacted'; end if;
    if (new.call_status = 'connected_interested' and old.call_status <> 'connected_interested')
       or (new.rcs_status = 'interested' and old.rcs_status <> 'interested')
       or (new.email_status = 'interested' and old.email_status <> 'interested')
       or (new.linkedin_status = 'interested' and old.linkedin_status <> 'interested') then
      new.stage := 'interested';
    end if;
    if new.stage is distinct from old.stage then new.stage_updated_at := now(); end if;
  end if;
  return new;
end $$;
revoke execute on function public.job_candidates_stage_auto() from public, anon, authenticated;
drop trigger if exists job_candidates_stage_auto on public.job_candidates;
create trigger job_candidates_stage_auto before update on public.job_candidates
  for each row execute function public.job_candidates_stage_auto();

-- History: also log stage changes and interview (re)scheduling
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
  if new.stage is distinct from old.stage then
    insert into public.candidate_activity (job_candidate_id, channel, from_status, to_status, note, actor, actor_name)
    values (new.id, 'stage', old.stage, new.stage, v_note, auth.uid(), v_name);
  end if;
  if new.interview_at is distinct from old.interview_at then
    insert into public.candidate_activity (job_candidate_id, channel, from_status, to_status, note, actor, actor_name)
    values (new.id, 'interview', old.interview_at::text, new.interview_at::text, v_note, auth.uid(), v_name);
  end if;
  return new;
end $$;
revoke execute on function public.job_candidates_log() from public, anon, authenticated;
