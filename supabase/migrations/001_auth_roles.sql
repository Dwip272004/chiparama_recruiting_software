-- Auth + roles for Chiparama Recruiting (already applied to the Supabase project)
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

create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;
revoke execute on function public.current_app_role() from public, anon;
grant execute on function public.current_app_role() to authenticated;

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
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create policy "own profile" on public.profiles
  for select to authenticated using (id = auth.uid());

create policy "admins read all profiles" on public.profiles
  for select to authenticated using (public.current_app_role() in ('super_admin', 'admin'));

create policy "super admin manages profiles" on public.profiles
  for all to authenticated using (public.current_app_role() = 'super_admin')
  with check (public.current_app_role() = 'super_admin');

create policy "super admin manages assignments" on public.role_assignments
  for all to authenticated using (public.current_app_role() = 'super_admin')
  with check (public.current_app_role() = 'super_admin');

-- Seed role_assignments with real work emails (run separately, not committed):
--   insert into public.role_assignments (email, full_name, role) values
--     ('<dwip email>',     'Dwip',     'super_admin'),
--     ('<prashant email>', 'Prashant', 'admin'),
--     ('<deepak email>',   'Deepak',   'recruiting_manager'),
--     ('<iti email>',      'Iti',      'recruiting_manager');
