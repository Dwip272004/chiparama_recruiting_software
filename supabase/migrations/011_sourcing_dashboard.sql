-- Sourcing numbers per job, with upload-lot history (ticker-style) -------------
create or replace function public.sourcing_dashboard(p_day_start timestamptz default date_trunc('day', now()))
returns jsonb language plpgsql stable security invoker set search_path = public as $$
begin
  if current_app_role() not in ('super_admin','admin') then raise exception 'Not allowed'; end if;
  return (
    with lots as (
      select b.job_id, b.id, b.tag, b.created_at, b.created_by_name, count(jc.id)::int as added
        from candidate_batches b left join job_candidates jc on jc.batch_id = b.id
       group by b.id
    ), per_job as (
      select jc.job_id,
        count(*)::int total,
        count(*) filter (where jc.created_at >= p_day_start)::int added_today,
        count(*) filter (where jc.created_at >= now() - interval '7 days')::int added_7d,
        count(*) filter (where jc.rcs_status      not in ('not_started'))::int rcs_touched,
        count(*) filter (where jc.rcs_status      in ('replied','interested'))::int rcs_replied,
        count(*) filter (where jc.rcs_status      = 'interested')::int rcs_interested,
        count(*) filter (where jc.email_status    not in ('not_started'))::int email_touched,
        count(*) filter (where jc.email_status    in ('replied','interested'))::int email_replied,
        count(*) filter (where jc.email_status    = 'interested')::int email_interested,
        count(*) filter (where jc.linkedin_status not in ('not_started'))::int linkedin_touched,
        count(*) filter (where jc.linkedin_status in ('replied','interested'))::int linkedin_replied,
        count(*) filter (where jc.linkedin_status = 'interested')::int linkedin_interested,
        count(*) filter (where jc.call_status     <> 'not_called')::int call_touched,
        count(*) filter (where jc.call_status     in ('connected_interested','connected_not_interested'))::int call_replied,
        count(*) filter (where jc.call_status     = 'connected_interested')::int call_interested
      from job_candidates jc group by jc.job_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', j.id, 'job_code', j.job_code, 'title', j.title, 'client_name', j.client_name, 'status', j.status,
      'total', p.total, 'added_today', p.added_today, 'added_7d', p.added_7d,
      'channels', jsonb_build_object(
        'rcs', jsonb_build_object('touched', p.rcs_touched, 'replied', p.rcs_replied, 'interested', p.rcs_interested),
        'email', jsonb_build_object('touched', p.email_touched, 'replied', p.email_replied, 'interested', p.email_interested),
        'linkedin', jsonb_build_object('touched', p.linkedin_touched, 'replied', p.linkedin_replied, 'interested', p.linkedin_interested),
        'call', jsonb_build_object('touched', p.call_touched, 'replied', p.call_replied, 'interested', p.call_interested)),
      'lots', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'tag', l.tag, 'added', l.added, 'at', l.created_at, 'by', l.created_by_name) order by l.created_at)
                          from lots l where l.job_id = j.id), '[]'::jsonb)
    ) order by p.added_today desc, p.total desc), '[]'::jsonb)
    from per_job p join jobs j on j.id = p.job_id
  );
end $$;
revoke execute on function public.sourcing_dashboard(timestamptz) from anon, public;
grant execute on function public.sourcing_dashboard(timestamptz) to authenticated;
