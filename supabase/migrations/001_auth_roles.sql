-- Auth + roles for Chiparama Recruiting
-- Invite-only: a user can only be created in Supabase Auth if their email is
-- listed in role_assignments. Their role is copied into profiles on signup.

create type public.app_role as enum ('super_admin', 'admin', 'recruiting_manager');

create table public.role_assignments (
  email     text primary key check (email = lower(email)),
  full_name text not null,
  role      public.app_role not null
);

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  role       public.app_role not null,
  created_at timestamptz not null default now()
);

alter table public.role_assignments enable row level security;
alter table public.profiles enable row level security;

-- Helper (security definer avoids RLS recursion on profiles)
create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- Block signups for anyone not pre-assigned a role; otherwise create their profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare ra public.role_assignments;
begin
  select * into ra from public.role_assignments where email = lower(new.email);
  if not found then
    raise exception 'Email % is not authorised for this workspace', new.email;
  end if;
  insert into public.profiles (id, email, full_name, role)
  values (new.id, lower(new.email), ra.full_name, ra.role);
  return new;
end $$;

create trigger on_auth_user_created
  before insert on auth.users
  for each row execute function public.handle_new_user();
-- NOTE: trigger is "before insert" so unauthorised emails are rejected; if your
-- project disallows that on auth.users, switch to "after insert" and delete
-- the user inside the function instead.

-- RLS policies
create policy "own profile" on public.profiles
  for select using (id = auth.uid());

create policy "admins read all profiles" on public.profiles
  for select using (public.current_app_role() in ('super_admin', 'admin'));

create policy "super admin manages profiles" on public.profiles
  for all using (public.current_app_role() = 'super_admin')
  with check (public.current_app_role() = 'super_admin');

create policy "super admin manages assignments" on public.role_assignments
  for all using (public.current_app_role() = 'super_admin')
  with check (public.current_app_role() = 'super_admin');

-- Seed: REPLACE the emails below with the real work emails before running.
insert into public.role_assignments (email, full_name, role) values
  ('dwip@REPLACE_ME.com',    'Dwip',    'super_admin'),
  ('prashant@REPLACE_ME.com','Prashant','admin'),
  ('deepak@REPLACE_ME.com',  'Deepak',  'recruiting_manager'),
  ('iti@REPLACE_ME.com',     'Iti',     'recruiting_manager');
