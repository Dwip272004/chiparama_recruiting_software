-- Follow-up dates are no longer entered by hand: last_called_at and the activity log capture every call automatically.
-- Already applied.
drop function if exists public.log_call(uuid, text, text, timestamptz);
alter table public.job_candidates drop column if exists next_follow_up_at;

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
  if v_old.call_status = v_new.call_status and nullif(trim(coalesce(p_note,'')), '') is not null then
    insert into public.candidate_activity (job_candidate_id, channel, from_status, to_status, note, actor, actor_name)
    values (p_id, 'call', v_old.call_status, v_new.call_status, p_note, auth.uid(),
            (select full_name from public.profiles where id = auth.uid()));
  end if;
  return v_new;
end $$;
revoke execute on function public.log_call(uuid, text, text) from public, anon;
grant execute on function public.log_call(uuid, text, text) to authenticated;
