-- 015: delete an upload lot (admins only). Two modes:
--   'unassign' -> keep the lot and candidates, just clear the calling assignment for the lot
--   'delete'   -> remove the lot and its candidates from the job (people stay in the master candidate list)
create or replace function public.delete_candidate_lot(p_batch_id uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_job uuid; v_tag text; v_n int;
begin
  if current_app_role() not in ('super_admin','admin') then raise exception 'Only admins can do this'; end if;
  if p_mode not in ('unassign','delete') then raise exception 'Invalid mode'; end if;
  select job_id, tag into v_job, v_tag from candidate_batches where id = p_batch_id;
  if not found then raise exception 'Lot not found'; end if;
  if p_mode = 'unassign' then
    update job_candidates set call_assigned_to = null where batch_id = p_batch_id and call_assigned_to is not null;
    get diagnostics v_n = row_count;
  else
    delete from job_candidates where batch_id = p_batch_id;
    get diagnostics v_n = row_count;
    delete from candidate_batches where id = p_batch_id;
  end if;
  return jsonb_build_object('mode', p_mode, 'tag', v_tag, 'affected', v_n);
end $$;
grant execute on function public.delete_candidate_lot(uuid, text) to authenticated;
revoke execute on function public.delete_candidate_lot(uuid, text) from anon, public;
grant execute on function public.delete_candidate_lot(uuid, text) to authenticated;
