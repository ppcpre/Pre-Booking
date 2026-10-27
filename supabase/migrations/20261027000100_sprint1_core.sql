-- Sprint 1: team access (Google sign-in allowlist), business settings, properties,
-- room types, units, rate plans, utility rates and meters.
-- Money is stored in satang (bigint). Dates of stay are DATE in Asia/Bangkok.

create extension if not exists citext;
create extension if not exists btree_gist;
create extension if not exists pgcrypto;

create schema if not exists app;

-- ---------------------------------------------------------------- enums
create type public.user_role     as enum ('ADMIN', 'MANAGER', 'FRONT_DESK', 'ACCOUNTANT');
create type public.rental_mode   as enum ('DAILY', 'YEARLY');
create type public.property_type as enum ('APARTMENT', 'HOTEL', 'HOUSE', 'CONDO', 'OTHER');
create type public.property_status as enum ('DRAFT', 'ACTIVE', 'ARCHIVED');
create type public.unit_status   as enum ('ACTIVE', 'MAINTENANCE', 'INACTIVE');
create type public.utility_kind  as enum ('WATER', 'ELECTRIC');

-- ---------------------------------------------------------------- team
-- Who may sign in. A row is created by an admin before the person's first Google sign-in.
create table public.team_members (
  email        citext primary key,
  full_name    text,
  role         public.user_role not null default 'FRONT_DESK',
  is_active    boolean not null default true,
  user_id      uuid unique references auth.users (id) on delete set null,
  added_by     uuid references auth.users (id) on delete set null,
  added_at     timestamptz not null default now(),
  last_sign_in timestamptz
);

-- One row per signed-in person, created automatically on first sign-in.
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      citext unique not null references public.team_members (email) on update cascade,
  full_name  text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- business
create table public.business_settings (
  id            boolean primary key default true check (id),
  legal_name    text not null default 'My Company',
  address       text,
  tax_id        text,
  phone         text,
  hold_hours    int not null default 24 check (hold_hours between 1 and 720),
  front_desk_discount_limit_pct numeric(5,2) not null default 10 check (front_desk_discount_limit_pct between 0 and 100),
  updated_at    timestamptz not null default now()
);
insert into public.business_settings (id) values (true);

-- ---------------------------------------------------------------- properties
create table public.properties (
  id                   uuid primary key default gen_random_uuid(),
  code                 text unique not null check (code ~ '^[A-Z0-9]{2,6}$'),
  name                 text not null check (length(trim(name)) > 0),
  type                 public.property_type not null default 'APARTMENT',
  status               public.property_status not null default 'DRAFT',
  address              text,
  phone                text,
  photo_path           text,               -- storage path in bucket "property-photos"
  check_in_time        time not null default '14:00',
  check_out_time       time not null default '12:00',
  meter_reading_day    int not null default 25 check (meter_reading_day between 1 and 28),
  grace_days           int not null default 5 check (grace_days between 0 and 60),
  payment_instructions text,
  created_by           uuid default auth.uid() references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.property_staff (
  property_id uuid references public.properties (id) on delete cascade,
  email       citext references public.team_members (email) on update cascade on delete cascade,
  primary key (property_id, email)
);

create table public.room_types (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties (id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  max_occupancy int not null default 2 check (max_occupancy between 1 and 50),
  size_sqm      numeric(7,2) check (size_sqm > 0),
  amenities     text[] not null default '{}',
  sort_order    int not null default 0,
  unique (property_id, name)
);

create table public.units (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties (id) on delete cascade,
  room_type_id  uuid not null references public.room_types (id) on delete restrict,
  code          text not null check (length(trim(code)) > 0),
  floor         text,
  allowed_modes public.rental_mode[] not null default '{DAILY}' check (cardinality(allowed_modes) > 0),
  status        public.unit_status not null default 'ACTIVE',
  unique (property_id, code)
);

-- A unit's room type must belong to the same property.
create function app.check_unit_room_type() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.room_types rt where rt.id = new.room_type_id and rt.property_id = new.property_id) then
    raise exception 'Room type belongs to another property' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger units_room_type_same_property before insert or update on public.units
  for each row execute function app.check_unit_room_type();

-- ---------------------------------------------------------------- pricing
create table public.cancellation_policies (
  id    uuid primary key default gen_random_uuid(),
  name  text unique not null,
  rules jsonb not null  -- [{"days_before":14,"refund_percent":100}, ...]
);
insert into public.cancellation_policies (name, rules) values
  ('Flexible', '[{"days_before":1,"refund_percent":100}]'),
  ('Moderate', '[{"days_before":5,"refund_percent":100},{"days_before":0,"refund_percent":50}]'),
  ('Strict',   '[{"days_before":14,"refund_percent":100},{"days_before":7,"refund_percent":50},{"days_before":0,"refund_percent":0}]');

create table public.rate_plans (
  id               uuid primary key default gen_random_uuid(),
  room_type_id     uuid not null references public.room_types (id) on delete cascade,
  mode             public.rental_mode not null,
  base_amount      bigint not null check (base_amount > 0),  -- DAILY: per night · YEARLY: rent per month
  weekend_amount   bigint check (weekend_amount > 0),         -- DAILY only (Fri, Sat nights)
  min_length       int not null default 1 check (min_length >= 1),  -- nights or years
  max_length       int check (max_length is null or max_length >= min_length),
  deposit_months   numeric(4,2) check (deposit_months >= 0),  -- YEARLY
  advance_months   int check (advance_months >= 0),           -- YEARLY
  cancellation_policy_id uuid references public.cancellation_policies (id),
  is_active        boolean not null default true,
  unique (room_type_id, mode),
  check (mode = 'DAILY' or weekend_amount is null),
  check (mode = 'YEARLY' or (deposit_months is null and advance_months is null))
);

create table public.utility_rates (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references public.properties (id) on delete cascade,
  utility        public.utility_kind not null,
  price_per_unit bigint not null check (price_per_unit >= 0),
  minimum_charge bigint not null default 0 check (minimum_charge >= 0),
  effective_from date not null default current_date,
  unique (property_id, utility, effective_from)
);

create table public.meters (
  id            uuid primary key default gen_random_uuid(),
  unit_id       uuid not null references public.units (id) on delete cascade,
  utility       public.utility_kind not null,
  serial_no     text,
  installed_on  date not null default current_date,
  initial_value numeric(12,2) not null default 0 check (initial_value >= 0),
  retired_on    date
);
create unique index meters_one_active_per_unit on public.meters (unit_id, utility) where retired_on is null;

-- ---------------------------------------------------------------- audit
create table public.audit_logs (
  id         bigserial primary key,
  actor_id   uuid,
  action     text not null,
  entity     text not null,
  entity_id  text not null,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- helpers
-- Current signed-in member (null when not on the team or deactivated).
create function app.current_role() returns public.user_role
language sql stable security definer set search_path = public, pg_temp as $$
  select tm.role from public.team_members tm
  where tm.user_id = auth.uid() and tm.is_active
$$;

create function app.is_member() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.current_role() is not null
$$;

create function app.has_role(variadic roles public.user_role[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(app.current_role() = any (roles), false)
$$;

-- Admins see every property; everyone else sees the properties they are assigned to.
create function app.can_access_property(pid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when app.current_role() is null then false
    when app.current_role() = 'ADMIN' then true
    else exists (
      select 1 from public.property_staff ps
      join public.team_members tm on tm.email = ps.email
      where ps.property_id = pid and tm.user_id = auth.uid() and tm.is_active)
  end
$$;

create function app.can_manage_property(pid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_role('ADMIN', 'MANAGER') and app.can_access_property(pid)
$$;

grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;

-- ---------------------------------------------------------------- sign-in hooks
-- Supabase Auth hook "Before User Created": only emails on the team may create an account.
create function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  em citext := lower(coalesce(event -> 'user' ->> 'email', ''));
begin
  if exists (select 1 from public.team_members where email = em and is_active) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'This Google account is not on the team. Ask your admin to add it.'));
end $$;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
    grant select on public.team_members to supabase_auth_admin;
  end if;
end $$;

-- When an account is created, link it to the team row and create the profile.
create function app.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tm public.team_members;
  nm text;
begin
  select * into tm from public.team_members where email = lower(new.email);
  if not found then
    return new;  -- the hook already blocks this; nothing to link
  end if;
  nm := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', tm.full_name, split_part(new.email, '@', 1));
  update public.team_members set user_id = new.id, full_name = coalesce(full_name, nm) where email = tm.email;
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, tm.email, nm, new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.on_auth_user_created();

-- Called at sign-in: links an account that existed before its email was added to the team.
create function public.link_team_member() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare u auth.users;
begin
  select * into u from auth.users where id = auth.uid();
  if not found then return; end if;
  update public.team_members set user_id = u.id where email = lower(u.email) and user_id is null;
  insert into public.profiles (id, email, full_name, avatar_url)
  select u.id, tm.email,
         coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', tm.full_name, split_part(u.email, '@', 1)),
         u.raw_user_meta_data ->> 'avatar_url'
  from public.team_members tm where tm.user_id = u.id
  on conflict (id) do nothing;
end $$;
grant execute on function public.link_team_member() to authenticated;

-- Called by the app after each sign-in.
create function public.touch_sign_in() returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.team_members set last_sign_in = now() where user_id = auth.uid();
$$;
grant execute on function public.touch_sign_in() to authenticated;

-- Activation checklist for a property (used by the setup wizard).
create function public.property_setup_status(pid uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  with u as (select * from public.units where property_id = pid),
  needs as (
    select distinct u.room_type_id, m.mode
    from u cross join lateral unnest(u.allowed_modes) as m(mode)
  )
  select jsonb_build_object(
    'room_types', (select count(*) from public.room_types where property_id = pid),
    'units', (select count(*) from u),
    'missing_rates', (select count(*) from needs n where not exists (
        select 1 from public.rate_plans rp where rp.room_type_id = n.room_type_id and rp.mode = n.mode and rp.is_active)),
    'needs_utilities', exists (select 1 from needs where mode = 'YEARLY'),
    'utility_rates', (select count(distinct utility) from public.utility_rates where property_id = pid),
    'staff', (select count(*) from public.property_staff where property_id = pid)
  )
$$;
grant execute on function public.property_setup_status(uuid) to authenticated;

-- Whoever creates a property is assigned to it, so a manager can keep working on it.
create function app.assign_property_creator() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare em citext;
begin
  select email into em from public.team_members where user_id = auth.uid();
  if em is not null then
    insert into public.property_staff (property_id, email) values (new.id, em) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger properties_assign_creator after insert on public.properties
  for each row execute function app.assign_property_creator();

-- Keep updated_at fresh.
create function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger properties_touch before update on public.properties for each row execute function app.touch_updated_at();
create trigger business_touch before update on public.business_settings for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- row level security
alter table public.team_members          enable row level security;
alter table public.profiles              enable row level security;
alter table public.business_settings     enable row level security;
alter table public.properties            enable row level security;
alter table public.property_staff        enable row level security;
alter table public.room_types            enable row level security;
alter table public.units                 enable row level security;
alter table public.cancellation_policies enable row level security;
alter table public.rate_plans            enable row level security;
alter table public.utility_rates         enable row level security;
alter table public.meters                enable row level security;
alter table public.audit_logs            enable row level security;

-- team
create policy team_read  on public.team_members for select to authenticated using (app.is_member());
create policy team_write on public.team_members for all    to authenticated
  using (app.has_role('ADMIN')) with check (app.has_role('ADMIN'));
create policy profiles_read on public.profiles for select to authenticated using (app.is_member());
create policy profiles_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- business
create policy business_read  on public.business_settings for select to authenticated using (app.is_member());
create policy business_write on public.business_settings for update to authenticated
  using (app.has_role('ADMIN')) with check (app.has_role('ADMIN'));

-- properties
create policy properties_read   on public.properties for select to authenticated using (app.can_access_property(id));
create policy properties_insert on public.properties for insert to authenticated with check (app.has_role('ADMIN', 'MANAGER'));
create policy properties_update on public.properties for update to authenticated
  using (app.can_manage_property(id)) with check (app.can_manage_property(id));
create policy properties_delete on public.properties for delete to authenticated
  using (app.has_role('ADMIN') and status = 'DRAFT');

create policy staff_read  on public.property_staff for select to authenticated using (app.can_access_property(property_id));
create policy staff_write on public.property_staff for all to authenticated
  using (app.can_manage_property(property_id)) with check (app.can_manage_property(property_id));

-- children of a property
create policy room_types_read  on public.room_types for select to authenticated using (app.can_access_property(property_id));
create policy room_types_write on public.room_types for all to authenticated
  using (app.can_manage_property(property_id)) with check (app.can_manage_property(property_id));

create policy units_read  on public.units for select to authenticated using (app.can_access_property(property_id));
create policy units_write on public.units for all to authenticated
  using (app.can_manage_property(property_id)) with check (app.can_manage_property(property_id));

create policy policies_read  on public.cancellation_policies for select to authenticated using (app.is_member());
create policy policies_write on public.cancellation_policies for all to authenticated
  using (app.has_role('ADMIN', 'MANAGER')) with check (app.has_role('ADMIN', 'MANAGER'));

create policy rates_read on public.rate_plans for select to authenticated
  using (exists (select 1 from public.room_types rt where rt.id = room_type_id and app.can_access_property(rt.property_id)));
create policy rates_write on public.rate_plans for all to authenticated
  using (exists (select 1 from public.room_types rt where rt.id = room_type_id and app.can_manage_property(rt.property_id)))
  with check (exists (select 1 from public.room_types rt where rt.id = room_type_id and app.can_manage_property(rt.property_id)));

create policy utility_read  on public.utility_rates for select to authenticated using (app.can_access_property(property_id));
create policy utility_write on public.utility_rates for all to authenticated
  using (app.can_manage_property(property_id)) with check (app.can_manage_property(property_id));

create policy meters_read on public.meters for select to authenticated
  using (exists (select 1 from public.units u where u.id = unit_id and app.can_access_property(u.property_id)));
create policy meters_write on public.meters for all to authenticated
  using (exists (select 1 from public.units u where u.id = unit_id and app.can_manage_property(u.property_id)))
  with check (exists (select 1 from public.units u where u.id = unit_id and app.can_manage_property(u.property_id)));

create policy audit_read   on public.audit_logs for select to authenticated using (app.has_role('ADMIN'));
create policy audit_insert on public.audit_logs for insert to authenticated with check (app.is_member() and actor_id = auth.uid());

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
