-- Feedback: everyone submits, only super_admin (Dwip) serves
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  user_name text,
  category text not null default 'idea' check (category in ('bug','idea','question','praise')),
  area text,
  message text not null check (char_length(trim(message)) between 3 and 4000),
  status text not null default 'new' check (status in ('new','in_progress','done','wont_do')),
  response text,
  handled_by_name text,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists feedback_user_idx on public.feedback (user_id, created_at desc);
create index if not exists feedback_status_idx on public.feedback (status, created_at desc);
alter table public.feedback enable row level security;

drop policy if exists "feedback read own or owner" on public.feedback;
create policy "feedback read own or owner" on public.feedback for select to authenticated
  using (user_id = (select auth.uid()) or (select current_app_role()) = 'super_admin');
drop policy if exists "feedback insert own" on public.feedback;
create policy "feedback insert own" on public.feedback for insert to authenticated
  with check (user_id = (select auth.uid()) and (select current_app_role()) is not null);
drop policy if exists "feedback owner updates" on public.feedback;
create policy "feedback owner updates" on public.feedback for update to authenticated
  using ((select current_app_role()) = 'super_admin') with check ((select current_app_role()) = 'super_admin');

create or replace function public.trg_feedback_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
    new.user_name := (select coalesce(full_name, email) from profiles where id = auth.uid());
    new.status := 'new'; new.response := null;
  else
    new.updated_at := now();
    if new.status is distinct from old.status or new.response is distinct from old.response then
      new.handled_by_name := (select coalesce(full_name, email) from profiles where id = auth.uid());
      new.handled_at := now();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists feedback_before on public.feedback;
create trigger feedback_before before insert or update on public.feedback
  for each row execute function public.trg_feedback_before();

create or replace function public.trg_feedback_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into notifications (user_id, kind, title, body, link, meta)
    select id, 'feedback_new', 'New feedback from ' || coalesce(new.user_name, 'a user'),
           initcap(new.category) || ' · ' || left(new.message, 80), '/feedback', jsonb_build_object('feedback_id', new.id)
      from profiles where role = 'super_admin' and id <> new.user_id;
  elsif new.status is distinct from old.status or new.response is distinct from old.response then
    if new.user_id <> auth.uid() then
      insert into notifications (user_id, kind, title, body, link, meta)
      values (new.user_id, 'feedback_update',
        case new.status when 'done' then 'Your feedback was completed' when 'in_progress' then 'Your feedback is being worked on'
             when 'wont_do' then 'Update on your feedback' else 'Reply to your feedback' end,
        coalesce(left(new.response, 90), left(new.message, 90)), '/feedback', jsonb_build_object('feedback_id', new.id));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists feedback_after on public.feedback;
create trigger feedback_after after insert or update on public.feedback
  for each row execute function public.trg_feedback_after();

create or replace function public.feedback_new_count()
returns int language sql stable security invoker set search_path = public as $$
  select count(*)::int from feedback where status = 'new'
$$;
revoke execute on function public.feedback_new_count() from anon, public;
grant execute on function public.feedback_new_count() to authenticated;

-- Job notes: any team member can add notes on a job
create table if not exists public.job_notes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id),
  author_name text,
  author_role text,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists job_notes_job_idx on public.job_notes (job_id, created_at desc);
alter table public.job_notes enable row level security;
drop policy if exists "team reads job notes" on public.job_notes;
create policy "team reads job notes" on public.job_notes for select to authenticated
  using ((select current_app_role()) is not null);
drop policy if exists "team adds job notes" on public.job_notes;
create policy "team adds job notes" on public.job_notes for insert to authenticated
  with check (author_id = (select auth.uid()) and (select current_app_role()) is not null);
drop policy if exists "author or owner deletes job notes" on public.job_notes;
create policy "author or owner deletes job notes" on public.job_notes for delete to authenticated
  using (author_id = (select auth.uid()) or (select current_app_role()) = 'super_admin');

create or replace function public.trg_job_note_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.author_id := auth.uid();
  select coalesce(full_name, email), role::text into new.author_name, new.author_role from profiles where id = auth.uid();
  return new;
end $$;
drop trigger if exists job_notes_before on public.job_notes;
create trigger job_notes_before before insert on public.job_notes
  for each row execute function public.trg_job_note_before();

create or replace function public.trg_job_note_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text; v_sub uuid;
begin
  select job_code, submitted_by into v_code, v_sub from jobs where id = new.job_id;
  insert into notifications (user_id, kind, title, body, link, meta)
  select p.id, 'job_note', new.author_name || ' added a note on ' || v_code, left(new.body, 90), '/jobs/' || v_code,
         jsonb_build_object('job_id', new.job_id)
    from profiles p
   where p.id <> new.author_id and (p.role in ('super_admin','admin') or p.id = v_sub);
  return new;
end $$;
drop trigger if exists job_notes_after on public.job_notes;
create trigger job_notes_after after insert on public.job_notes
  for each row execute function public.trg_job_note_after();
