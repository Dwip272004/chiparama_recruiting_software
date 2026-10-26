-- Fields from the outreach list template (phones 1-3, personal email, recruiter profile,
-- open to work, experience years). Already applied.
alter table public.candidates
  add column phone_2 text,
  add column phone_3 text,
  add column alt_email text,
  add column recruiter_profile_url text,
  add column open_to_work boolean,
  add column experience_years numeric(4,1);
create index candidates_recruiter_idx on public.candidates (lower(recruiter_profile_url));

create or replace function public.add_candidates_to_batch(p_batch_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_job uuid;
  r jsonb;
  v_name text; v_email text; v_alt text; v_phone text; v_p2 text; v_p3 text;
  v_li text; v_rec text; v_digits text; v_otw boolean; v_exp numeric;
  v_title text; v_company text; v_loc text;
  v_cid uuid; v_added int := 0; v_dup int := 0; v_new int := 0; v_skipped int := 0; v_n int;
begin
  if public.current_app_role() not in ('super_admin','admin') then raise exception 'Not allowed'; end if;
  select job_id into v_job from public.candidate_batches where id = p_batch_id;
  if v_job is null then raise exception 'Lot not found'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_name    := nullif(trim(coalesce(r->>'full_name','')), '');
    v_email   := nullif(lower(trim(coalesce(r->>'email',''))), '');
    v_alt     := nullif(lower(trim(coalesce(r->>'alt_email',''))), '');
    v_phone   := nullif(trim(coalesce(r->>'phone','')), '');
    v_p2      := nullif(trim(coalesce(r->>'phone_2','')), '');
    v_p3      := nullif(trim(coalesce(r->>'phone_3','')), '');
    v_rec     := nullif(trim(coalesce(r->>'recruiter_profile_url','')), '');
    v_title   := nullif(trim(coalesce(r->>'current_title','')), '');
    v_company := nullif(trim(coalesce(r->>'current_company','')), '');
    v_loc     := nullif(trim(coalesce(r->>'location','')), '');
    v_li := null;
    if nullif(trim(coalesce(r->>'linkedin_url','')), '') is not null then
      v_li := regexp_replace(regexp_replace(lower(trim(r->>'linkedin_url')), '^https?://(www\.)?', ''), '[?#].*$', '');
      v_li := regexp_replace(v_li, '/+$', '');
    end if;
    v_otw := case
      when lower(trim(coalesce(r->>'open_to_work',''))) in ('yes','true','y','1') then true
      when lower(trim(coalesce(r->>'open_to_work',''))) in ('no','false','n','0') then false
      else null end;
    v_exp := case
      when trim(coalesce(r->>'experience_years','')) ~ '^\d+(\.\d+)?$' and trim(r->>'experience_years')::numeric < 100
      then trim(r->>'experience_years')::numeric else null end;
    v_digits := regexp_replace(coalesce(v_phone,''), '\D', '', 'g');

    if v_name is null or (v_email is null and v_alt is null and v_li is null and v_rec is null and length(v_digits) < 7) then
      v_skipped := v_skipped + 1; continue;
    end if;

    v_cid := null;
    if v_email is not null then
      select id into v_cid from public.candidates where lower(email) = v_email or lower(alt_email) = v_email limit 1;
    end if;
    if v_cid is null and v_alt is not null then
      select id into v_cid from public.candidates where lower(email) = v_alt or lower(alt_email) = v_alt limit 1;
    end if;
    if v_cid is null and v_rec is not null then
      select id into v_cid from public.candidates where lower(recruiter_profile_url) = lower(v_rec) limit 1;
    end if;
    if v_cid is null and v_li is not null then
      select id into v_cid from public.candidates where lower(linkedin_url) = v_li limit 1;
    end if;
    if v_cid is null and length(v_digits) >= 7 then
      select id into v_cid from public.candidates
      where phone_digits = v_digits
         or regexp_replace(coalesce(phone_2,''), '\D', '', 'g') = v_digits
         or regexp_replace(coalesce(phone_3,''), '\D', '', 'g') = v_digits
      limit 1;
    end if;

    if v_cid is null then
      insert into public.candidates (full_name, email, alt_email, phone, phone_2, phone_3, linkedin_url, recruiter_profile_url,
                                     current_title, current_company, location, open_to_work, experience_years, created_by)
      values (v_name, v_email, v_alt, v_phone, v_p2, v_p3, v_li, v_rec, v_title, v_company, v_loc, v_otw, v_exp, auth.uid())
      returning id into v_cid;
      v_new := v_new + 1;
    else
      update public.candidates set
        email = coalesce(email, v_email), alt_email = coalesce(alt_email, v_alt),
        phone = coalesce(phone, v_phone), phone_2 = coalesce(phone_2, v_p2), phone_3 = coalesce(phone_3, v_p3),
        linkedin_url = coalesce(linkedin_url, v_li), recruiter_profile_url = coalesce(recruiter_profile_url, v_rec),
        current_title = coalesce(current_title, v_title), current_company = coalesce(current_company, v_company),
        location = coalesce(location, v_loc), open_to_work = coalesce(open_to_work, v_otw),
        experience_years = coalesce(experience_years, v_exp)
      where id = v_cid;
    end if;

    insert into public.job_candidates (job_id, candidate_id, batch_id)
    values (v_job, v_cid, p_batch_id) on conflict (job_id, candidate_id) do nothing;
    get diagnostics v_n = row_count;
    if v_n = 1 then v_added := v_added + 1; else v_dup := v_dup + 1; end if;
  end loop;

  return jsonb_build_object('added', v_added, 'already_on_job', v_dup, 'new_people', v_new, 'skipped', v_skipped);
end $$;
