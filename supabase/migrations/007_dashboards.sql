-- Role dashboards: aggregate functions for admins and for each caller. Already applied.

-- Always record a call attempt in the activity log (even when the status is unchanged and there is no note)
create or replace function public.log_call(p_id uuid, p_status text, p_note text default null)
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
    call_notes = coalesce(nullif(trim(coalesce(p_note,'')), ''), call_notes)
  where id = p_id returning * into v_new;
  if v_old.call_status = v_new.call_status then
    insert into public.candidate_activity (job_candidate_id, channel, from_status, to_status, note, actor, actor_name)
    values (p_id, 'call', v_old.call_status, v_new.call_status, nullif(trim(coalesce(p_note,'')), ''), auth.uid(),
            (select full_name from public.profiles where id = auth.uid()));
  end if;
  return v_new;
end $$;

-- Admin dashboard aggregates
create or replace function public.admin_dashboard(p_day_start timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if public.current_app_role() not in ('super_admin','admin') then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'jobs_by_status', coalesce((select jsonb_object_agg(status, c) from (select status, count(*) c from public.jobs group by status) s), '{}'::jsonb),
    'totals', jsonb_build_object(
      'people', (select count(*) from public.candidates),
      'job_candidates', (select count(*) from public.job_candidates),
      'unassigned_calls', (select count(*) from public.job_candidates where call_assigned_to is null and call_status = 'not_called')
    ),
    'channels', jsonb_build_object(
      'rcs',      coalesce((select jsonb_object_agg(s, c) from (select rcs_status s, count(*) c from public.job_candidates group by 1) x), '{}'::jsonb),
      'email',    coalesce((select jsonb_object_agg(s, c) from (select email_status s, count(*) c from public.job_candidates group by 1) x), '{}'::jsonb),
      'linkedin', coalesce((select jsonb_object_agg(s, c) from (select linkedin_status s, count(*) c from public.job_candidates group by 1) x), '{}'::jsonb),
      'call',     coalesce((select jsonb_object_agg(s, c) from (select call_status s, count(*) c from public.job_candidates group by 1) x), '{}'::jsonb)
    ),
    'callers', coalesce((select jsonb_agg(row_to_json(t)) from (
      select p.id, p.full_name as name,
        count(jc.id) as assigned,
        count(jc.id) filter (where jc.call_status = 'not_called') as not_called,
        count(jc.id) filter (where jc.call_status <> 'not_called') as called,
        count(jc.id) filter (where jc.call_status in ('connected_interested','connected_not_interested')) as connected,
        count(jc.id) filter (where jc.call_status = 'connected_interested') as interested,
        (select count(*) from public.candidate_activity a where a.actor = p.id and a.channel = 'call' and a.created_at >= p_day_start) as calls_today,
        (select count(*) from public.candidate_activity a where a.actor = p.id and a.channel = 'call' and a.created_at >= p_day_start - interval '6 days') as calls_7d
      from public.profiles p
      left join public.job_candidates jc on jc.call_assigned_to = p.id
      where p.role = 'recruiting_manager'
      group by p.id, p.full_name
      order by p.full_name) t), '[]'::jsonb),
    'jobs_progress', coalesce((select jsonb_agg(row_to_json(t)) from (
      select j.id, j.job_code, j.title, j.client_name, j.status,
        count(jc.id) as candidates,
        count(jc.id) filter (where jc.rcs_status <> 'not_started' or jc.email_status <> 'not_started'
                              or jc.linkedin_status <> 'not_started' or jc.call_status <> 'not_called') as contacted,
        count(jc.id) filter (where 'replied' in (jc.rcs_status, jc.email_status, jc.linkedin_status)) as replied,
        count(jc.id) filter (where 'interested' in (jc.rcs_status, jc.email_status, jc.linkedin_status)
                              or jc.call_status = 'connected_interested') as interested
      from public.jobs j
      left join public.job_candidates jc on jc.job_id = j.id
      where j.status <> 'pending_review'
      group by j.id, j.job_code, j.title, j.client_name, j.status, j.created_at
      order by count(jc.id) desc, j.created_at desc
      limit 25) t), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(row_to_json(t)) from (
      select a.id, a.channel, a.from_status, a.to_status, a.note, a.actor_name, a.created_at,
             c.full_name as candidate, j.job_code
      from public.candidate_activity a
      join public.job_candidates jc on jc.id = a.job_candidate_id
      join public.candidates c on c.id = jc.candidate_id
      join public.jobs j on j.id = jc.job_id
      order by a.created_at desc limit 15) t), '[]'::jsonb)
  );
end $$;

-- Dashboard numbers for the signed-in caller
create or replace function public.my_dashboard(p_day_start timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if public.current_app_role() is null then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'queue', (select jsonb_build_object(
        'assigned', count(*),
        'not_called', count(*) filter (where call_status = 'not_called'),
        'callback', count(*) filter (where call_status = 'call_back_later'),
        'retry', count(*) filter (where call_status in ('no_answer','voicemail','busy')),
        'done', count(*) filter (where call_status in ('connected_interested','connected_not_interested','wrong_number','do_not_call')),
        'interested', count(*) filter (where call_status = 'connected_interested'))
      from public.job_candidates where call_assigned_to = auth.uid()),
    'today', (select jsonb_build_object(
        'calls', count(*),
        'connected', count(*) filter (where to_status in ('connected_interested','connected_not_interested')),
        'interested', count(*) filter (where to_status = 'connected_interested'))
      from public.candidate_activity where actor = auth.uid() and channel = 'call' and created_at >= p_day_start),
    'week_calls', (select count(*) from public.candidate_activity
      where actor = auth.uid() and channel = 'call' and created_at >= p_day_start - interval '6 days'),
    'recent', coalesce((select jsonb_agg(row_to_json(t)) from (
      select a.id, a.to_status, a.note, a.created_at, c.full_name as candidate, j.job_code
      from public.candidate_activity a
      join public.job_candidates jc on jc.id = a.job_candidate_id
      join public.candidates c on c.id = jc.candidate_id
      join public.jobs j on j.id = jc.job_id
      where a.actor = auth.uid() and a.channel = 'call'
      order by a.created_at desc limit 8) t), '[]'::jsonb)
  );
end $$;

revoke execute on function public.admin_dashboard(timestamptz) from public, anon;
revoke execute on function public.my_dashboard(timestamptz) from public, anon;
grant execute on function public.admin_dashboard(timestamptz) to authenticated;
grant execute on function public.my_dashboard(timestamptz) to authenticated;
