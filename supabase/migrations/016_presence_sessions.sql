-- 016: record how long each user is online in the app.
-- The app sends a heartbeat every minute; heartbeats within 3 minutes of each other extend the same session.
create table if not exists public.presence_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists presence_sessions_user_seen_idx on public.presence_sessions (user_id, last_seen_at desc);
alter table public.presence_sessions enable row level security; -- no policies: only the functions below touch it

create or replace function public.presence_heartbeat()
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then return; end if;
  select id into v_id from presence_sessions
    where user_id = auth.uid() and last_seen_at > now() - interval '3 minutes'
    order by last_seen_at desc limit 1;
  if v_id is null then
    insert into presence_sessions (user_id) values (auth.uid());
  else
    update presence_sessions set last_seen_at = now() where id = v_id;
  end if;
end $$;

-- Admins only: time online per person (today in the given timezone, last 7 days, all time).
create or replace function public.presence_summary(p_tz text default 'Asia/Kolkata')
returns table (user_id uuid, full_name text, role text, today_secs bigint, week_secs bigint, total_secs bigint, last_seen_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_today timestamptz := date_trunc('day', now() at time zone p_tz) at time zone p_tz;
begin
  if current_app_role() not in ('super_admin','admin') then raise exception 'Only admins can do this'; end if;
  return query
  select s.user_id,
         coalesce(p.full_name, p.email), p.role::text,
         coalesce(sum(greatest(0, extract(epoch from s.last_seen_at - greatest(s.started_at, v_today)))), 0)::bigint,
         coalesce(sum(greatest(0, extract(epoch from s.last_seen_at - greatest(s.started_at, now() - interval '7 days')))), 0)::bigint,
         coalesce(sum(extract(epoch from s.last_seen_at - s.started_at)), 0)::bigint,
         max(s.last_seen_at)
  from presence_sessions s left join profiles p on p.id = s.user_id
  group by s.user_id, p.full_name, p.email, p.role
  order by max(s.last_seen_at) desc;
end $$;

revoke execute on function public.presence_heartbeat() from anon, public;
revoke execute on function public.presence_summary(text) from anon, public;
grant execute on function public.presence_heartbeat() to authenticated;
grant execute on function public.presence_summary(text) to authenticated;
