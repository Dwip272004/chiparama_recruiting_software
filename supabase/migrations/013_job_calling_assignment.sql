-- Job-level calling assignment (admins) ----------------------------------------------

create or replace function public.job_calling_summary(p_job_id uuid, p_batch_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
begin
  if current_app_role() not in ('super_admin','admin') then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'total', (select count(*) from job_candidates where job_id = p_job_id),
    'in_scope', (select count(*) from job_candidates where job_id = p_job_id and (p_batch_id is null or batch_id = p_batch_id)),
    'unassigned', (select count(*) from job_candidates where job_id = p_job_id and call_assigned_to is null and (p_batch_id is null or batch_id = p_batch_id)),
    'uncalled', (select count(*) from job_candidates where job_id = p_job_id and call_status = 'not_called' and (p_batch_id is null or batch_id = p_batch_id)),
    'callers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', coalesce(p.full_name, p.email),
        'assigned', (select count(*) from job_candidates jc where jc.job_id = p_job_id and jc.call_assigned_to = p.id),
        'not_called', (select count(*) from job_candidates jc where jc.job_id = p_job_id and jc.call_assigned_to = p.id and jc.call_status = 'not_called')
      ) order by p.full_name)
      from profiles p where p.role = 'recruiting_manager'), '[]'::jsonb));
end $$;

-- scope: 'unassigned' = candidates nobody owns yet; 'uncalled' = every candidate not yet called (re-balances)
-- p_caller_ids empty + 'uncalled' = take the not-yet-called candidates back (unassign)
create or replace function public.assign_job_calling(p_job_id uuid, p_caller_ids uuid[], p_scope text, p_batch_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int := coalesce(array_length(p_caller_ids, 1), 0); v_total int; v_ids uuid[]; v_per jsonb;
begin
  if current_app_role() not in ('super_admin','admin') then raise exception 'Only admins can assign calling'; end if;
  if p_scope not in ('unassigned','uncalled') then raise exception 'Invalid scope'; end if;
  if v_n = 0 and p_scope <> 'uncalled' then raise exception 'Pick at least one caller'; end if;
  if v_n > 0 and exists (select 1 from unnest(p_caller_ids) c where not exists (select 1 from profiles p where p.id = c and p.role = 'recruiting_manager')) then
    raise exception 'Calling can only be assigned to recruiting managers';
  end if;

  select array_agg(id order by created_at, id) into v_ids from job_candidates
   where job_id = p_job_id and (p_batch_id is null or batch_id = p_batch_id)
     and case p_scope when 'unassigned' then call_assigned_to is null else call_status = 'not_called' end;
  v_total := coalesce(array_length(v_ids, 1), 0);
  if v_total = 0 then return jsonb_build_object('assigned', 0, 'per_caller', '[]'::jsonb); end if;

  if v_n = 0 then
    update job_candidates set call_assigned_to = null where id = any(v_ids);
    return jsonb_build_object('assigned', 0, 'unassigned', v_total, 'per_caller', '[]'::jsonb);
  end if;

  -- split into n balanced, contiguous groups
  update job_candidates jc set call_assigned_to = p_caller_ids[g.grp]
    from (select id, ntile(v_n) over (order by ord) grp from unnest(v_ids) with ordinality t(id, ord)) g
   where jc.id = g.id;

  select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.full_name, p.email), 'count', x.cnt))
    into v_per
    from (select c as id, count(*) filter (where jc.id = any(v_ids)) cnt
            from unnest(p_caller_ids) c left join job_candidates jc on jc.call_assigned_to = c and jc.job_id = p_job_id group by c) x
    join profiles p on p.id = x.id;
  return jsonb_build_object('assigned', v_total, 'per_caller', coalesce(v_per, '[]'::jsonb));
end $$;

revoke execute on function public.job_calling_summary(uuid, uuid) from anon, public;
grant execute on function public.job_calling_summary(uuid, uuid) to authenticated;
revoke execute on function public.assign_job_calling(uuid, uuid[], text, uuid) from anon, public;
grant execute on function public.assign_job_calling(uuid, uuid[], text, uuid) to authenticated;
