-- Step 1: JD intake (recruiting managers paste) -> admin review/structuring -> job list.
-- Already applied to the Supabase project.

-- Admin-managed job statuses
create table public.job_statuses (
  key         text primary key check (key ~ '^[a-z0-9_]+$'),
  label       text not null,
  color       text not null default 'gray',
  sort_order  int  not null default 100,
  is_active   boolean not null default true
);

insert into public.job_statuses (key, label, color, sort_order) values
  ('pending_review', 'Pending Review', 'amber',  0),
  ('open',           'Open',           'blue',   10),
  ('active',         'Active',         'green',  20),
  ('on_hold',        'On Hold',        'orange', 30),
  ('filled',         'Filled',         'purple', 40),
  ('closed',         'Closed',         'gray',   50),
  ('cancelled',      'Cancelled',      'red',    60);

create sequence public.job_code_seq start 1001;

-- Jobs: raw JD pasted by recruiting managers, structured by admins
create table public.jobs (
  id                uuid primary key default gen_random_uuid(),
  job_code          text not null unique default ('CHP-' || nextval('public.job_code_seq')::text),
  status            text not null default 'pending_review' references public.job_statuses(key),
  raw_jd            text not null check (length(trim(raw_jd)) > 0),
  intake_note       text,
  title             text,
  client_name       text,
  location          text,
  work_mode         text,
  employment_type   text,
  experience        text,
  compensation      text,
  openings          int default 1 check (openings is null or openings > 0),
  skills            text[] not null default '{}',
  summary           text,
  responsibilities  text,
  requirements      text,
  submitted_by      uuid references auth.users(id) on delete set null,
  submitted_by_name text,
  reviewed_by       uuid references auth.users(id) on delete set null,
  reviewed_by_name  text,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index jobs_status_idx on public.jobs(status);
create index jobs_created_idx on public.jobs(created_at desc);
create index jobs_submitted_by_idx on public.jobs(submitted_by);
create index jobs_reviewed_by_idx on public.jobs(reviewed_by);

create or replace function public.jobs_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.submitted_by := auth.uid();
  select full_name into new.submitted_by_name from public.profiles where id = auth.uid();
  return new;
end $$;
revoke execute on function public.jobs_before_insert() from public, anon, authenticated;
create trigger jobs_before_insert before insert on public.jobs
  for each row execute function public.jobs_before_insert();

create or replace function public.jobs_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if old.status = 'pending_review' and new.status <> 'pending_review' and new.reviewed_by is null then
    new.reviewed_by := auth.uid();
    select full_name into new.reviewed_by_name from public.profiles where id = auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end $$;
revoke execute on function public.jobs_before_update() from public, anon, authenticated;
create trigger jobs_before_update before update on public.jobs
  for each row execute function public.jobs_before_update();

alter table public.job_statuses enable row level security;
alter table public.jobs enable row level security;

create policy "statuses readable" on public.job_statuses
  for select to authenticated using (public.current_app_role() is not null);
create policy "admins manage statuses" on public.job_statuses
  for all to authenticated
  using (public.current_app_role() in ('super_admin','admin'))
  with check (public.current_app_role() in ('super_admin','admin'));

create policy "team reads jobs" on public.jobs
  for select to authenticated using (public.current_app_role() is not null);
create policy "team submits jobs" on public.jobs
  for insert to authenticated with check (
    public.current_app_role() in ('super_admin','admin','recruiting_manager')
    and (status = 'pending_review' or public.current_app_role() in ('super_admin','admin'))
  );
create policy "admins update jobs" on public.jobs
  for update to authenticated
  using (public.current_app_role() in ('super_admin','admin'))
  with check (public.current_app_role() in ('super_admin','admin'));
create policy "super admin deletes jobs" on public.jobs
  for delete to authenticated using (public.current_app_role() = 'super_admin');
