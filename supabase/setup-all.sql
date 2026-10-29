-- Pre-Booking: all database setup in one file (generated from supabase/migrations, in order).
-- Before running: Database → Extensions → enable pg_cron. Paste everything into SQL Editor → Run.


-- ============================================================
-- 20261027000100_sprint1_core.sql
-- ============================================================
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

-- ============================================================
-- 20261027000200_sprint1_storage.sql
-- ============================================================
-- Private bucket for property photos. Files live at "<property_id>/<file name>".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('property-photos', 'property-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "property photos read" on storage.objects for select to authenticated
  using (bucket_id = 'property-photos' and app.can_access_property(((storage.foldername(name))[1])::uuid));

create policy "property photos write" on storage.objects for insert to authenticated
  with check (bucket_id = 'property-photos' and app.can_manage_property(((storage.foldername(name))[1])::uuid));

create policy "property photos update" on storage.objects for update to authenticated
  using (bucket_id = 'property-photos' and app.can_manage_property(((storage.foldername(name))[1])::uuid));

create policy "property photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'property-photos' and app.can_manage_property(((storage.foldername(name))[1])::uuid));

-- ============================================================
-- 20261028000100_sprint2_bookings.sql
-- ============================================================
-- Sprint 2: guests, bookings (daily + yearly), leases, charge periods, payments, refunds, blocks.
-- Rules live here so every client gets the same behaviour inside one transaction:
--   * no double booking (exclusion constraint on unit + date range)
--   * prices and payment schedules come from rate plans (quote_booking)
--   * payments are allocated oldest period first; a reservation confirms itself when paid
-- Writes to booking tables only happen through the security-definer functions below,
-- which check the caller's role and property access themselves.

create type public.booking_status as enum ('HOLD', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW', 'EXPIRED');
create type public.booking_kind   as enum ('RESERVATION', 'BLOCK');
create type public.period_kind    as enum ('STAY', 'MOVE_IN', 'RENT', 'ADJUSTMENT');
create type public.period_state   as enum ('OPEN', 'WAIVED', 'CANCELLED');
create type public.payment_method as enum ('CASH', 'TRANSFER', 'CHEQUE', 'CARD', 'OTHER');

-- Today's date in Bangkok.
create function app.today() returns date language sql stable as $$
  select (now() at time zone 'Asia/Bangkok')::date
$$;

-- ---------------------------------------------------------------- guests
create table public.guests (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null check (length(trim(full_name)) > 0),
  phone           text,
  email           citext,
  line_id         text,
  nationality     text,
  is_company      boolean not null default false,
  company_name    text,
  tax_id          text,
  branch          text,
  billing_address text,
  notes           text,
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index guests_name_idx on public.guests (lower(full_name));
create index guests_phone_idx on public.guests (phone);

-- ---------------------------------------------------------------- bookings
create table public.bookings (
  id               uuid primary key default gen_random_uuid(),
  code             text unique not null,
  property_id      uuid not null references public.properties (id) on delete restrict,
  unit_id          uuid not null references public.units (id) on delete restrict,
  kind             public.booking_kind not null default 'RESERVATION',
  mode             public.rental_mode,
  status           public.booking_status not null,
  stay             daterange not null,                 -- [check-in, check-out)
  check_in         date generated always as (lower(stay)) stored,
  check_out        date generated always as (upper(stay)) stored,
  guest_id         uuid references public.guests (id) on delete restrict,
  adults           int not null default 1 check (adults between 0 and 50),
  children         int not null default 0 check (children between 0 and 50),
  rate_plan_id     uuid references public.rate_plans (id) on delete set null,
  price_snapshot   jsonb,
  policy_snapshot  jsonb,
  total_amount     bigint not null default 0,
  paid_amount      bigint not null default 0,
  credit_balance   bigint not null default 0 check (credit_balance >= 0),
  hold_expires_at  timestamptz,
  source           text not null default 'DIRECT',
  note             text,
  block_reason     text,
  idempotency_key  text unique,
  actual_check_in  timestamptz,
  actual_check_out timestamptz,
  cancelled_at     timestamptz,
  cancel_reason    text,
  version          int not null default 1,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (lower(stay) < upper(stay)),
  check (kind = 'BLOCK' or (mode is not null and guest_id is not null)),
  constraint bookings_no_overlap exclude using gist (unit_id with =, stay with &&)
    where (status in ('HOLD', 'CONFIRMED', 'CHECKED_IN'))
);
create index bookings_property_stay on public.bookings using gist (property_id, stay);
create index bookings_property_dates on public.bookings (property_id, check_in, check_out);
create index bookings_hold_expiry on public.bookings (hold_expires_at) where status = 'HOLD';
create trigger bookings_touch before update on public.bookings for each row execute function app.touch_updated_at();

create table public.booking_status_history (
  id          bigserial primary key,
  booking_id  uuid not null references public.bookings (id) on delete cascade,
  from_status public.booking_status,
  to_status   public.booking_status not null,
  reason      text,
  changed_by  uuid default auth.uid(),
  changed_at  timestamptz not null default now()
);

create table public.leases (
  booking_id     uuid primary key references public.bookings (id) on delete cascade,
  start_date     date not null,
  end_date       date not null,          -- exclusive
  rent_amount    bigint not null check (rent_amount > 0),
  deposit_amount bigint not null default 0,
  deposit_months numeric(4,2) not null default 0,
  advance_months int not null default 0,
  notice_days    int not null default 30,
  check (end_date > start_date)
);

-- ---------------------------------------------------------------- money
create table public.charge_periods (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.bookings (id) on delete cascade,
  seq          int not null,
  kind         public.period_kind not null,
  label        text not null,
  period       daterange,
  due_date     date not null,
  total_amount bigint not null default 0,
  paid_amount  bigint not null default 0 check (paid_amount >= 0),
  state        public.period_state not null default 'OPEN',
  paid_at      date,
  note         text,
  unique (booking_id, seq)
);
create index charge_periods_due on public.charge_periods (due_date) where state = 'OPEN';

create table public.charge_lines (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references public.charge_periods (id) on delete cascade,
  charge_type text not null,               -- NIGHTLY, RENT, DEPOSIT, FEE, DISCOUNT, WATER, ELECTRIC, ...
  description text not null,
  quantity    numeric(12,2) not null default 1,
  unit_price  bigint not null,
  amount      bigint not null,
  meta        jsonb
);

create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references public.bookings (id) on delete restrict,
  amount          bigint not null check (amount > 0),        -- money actually received
  wht_amount      bigint not null default 0 check (wht_amount >= 0),
  wht_cert_no     text,
  paid_at         date not null,
  method          public.payment_method not null,
  reference       text,
  note            text,
  idempotency_key text unique,
  recorded_by     uuid default auth.uid(),
  recorded_at     timestamptz not null default now(),
  voided_at       timestamptz,
  voided_by       uuid,
  void_reason     text
);
create index payments_booking on public.payments (booking_id);

create table public.payment_allocations (
  payment_id uuid references public.payments (id) on delete cascade,
  period_id  uuid references public.charge_periods (id) on delete cascade,
  amount     bigint not null check (amount > 0),
  primary key (payment_id, period_id)
);

create table public.refunds (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings (id) on delete restrict,
  amount      bigint not null check (amount > 0),
  refunded_at date not null,
  method      public.payment_method not null,
  reason      text not null,
  recorded_by uuid default auth.uid(),
  recorded_at timestamptz not null default now()
);

create table public.document_sequences (
  property_id uuid references public.properties (id) on delete cascade,
  prefix      text,
  year        int,
  last_no     int not null default 0,
  primary key (property_id, prefix, year)
);

-- Live status of each period, computed from money and today's date.
create view public.charge_periods_v with (security_invoker = true) as
select cp.*,
  b.property_id, b.code as booking_code, b.status as booking_status, b.mode, b.unit_id, b.guest_id,
  greatest(cp.total_amount - cp.paid_amount, 0) as balance,
  case
    when cp.state = 'CANCELLED' then 'CANCELLED'
    when cp.state = 'WAIVED' then 'WAIVED'
    when cp.paid_amount >= cp.total_amount then 'PAID'
    when cp.due_date + (case when cp.kind = 'RENT' then p.grace_days else 0 end) < app.today() then 'OVERDUE'
    when cp.paid_amount > 0 then 'PARTIAL'
    when cp.due_date <= app.today() then 'DUE'
    else 'UPCOMING'
  end as status,
  greatest(app.today() - cp.due_date, 0) as days_late
from public.charge_periods cp
join public.bookings b on b.id = cp.booking_id
join public.properties p on p.id = b.property_id;

-- ---------------------------------------------------------------- helpers
create function app.can_book(pid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_role('ADMIN', 'MANAGER', 'FRONT_DESK') and app.can_access_property(pid)
$$;

create function app.can_take_payment(pid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.is_member() and app.can_access_property(pid)
$$;

create function app.fail(msg text) returns void language plpgsql as $$
begin
  raise exception using message = msg, errcode = 'P0001';
end $$;

-- Next document number, e.g. SKV-BK-2026-000123. Gap-free because it runs in the caller's transaction.
create function app.next_doc_no(pid uuid, p_prefix text, width int default 6) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare yr int := extract(year from app.today()); n int; pcode text;
begin
  insert into public.document_sequences as s (property_id, prefix, year, last_no) values (pid, p_prefix, yr, 1)
  on conflict (property_id, prefix, year) do update set last_no = s.last_no + 1
  returning last_no into n;
  select code into pcode from public.properties where id = pid;
  return format('%s-%s-%s-%s', pcode, p_prefix, yr, lpad(n::text, width, '0'));
end $$;

create function app.log_status(bid uuid, from_s public.booking_status, to_s public.booking_status, why text) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.booking_status_history (booking_id, from_status, to_status, reason) values (bid, from_s, to_s, why);
$$;

-- Recomputes booking totals from its periods (cancelled periods don't count toward what is owed).
create function app.refresh_booking_totals(bid uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.bookings b set
    total_amount = coalesce((select sum(total_amount) from public.charge_periods where booking_id = bid and state = 'OPEN'), 0)
                 + coalesce((select sum(paid_amount) from public.charge_periods where booking_id = bid and state <> 'OPEN'), 0),
    paid_amount  = coalesce((select sum(paid_amount) from public.charge_periods where booking_id = bid), 0),
    version = b.version + 1
  where b.id = bid;
$$;

-- Releases reservations whose pay-by time has passed. Safe to call any time (pg_cron runs it every 5 minutes).
create function public.expire_holds() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  with x as (
    update public.bookings set status = 'EXPIRED'
    where status = 'HOLD' and hold_expires_at is not null and hold_expires_at < now()
    returning id
  ), h as (
    insert into public.booking_status_history (booking_id, from_status, to_status, reason)
    select id, 'HOLD', 'EXPIRED', 'Not paid by the pay-by time' from x
  )
  select count(*) into n from x;
  update public.charge_periods cp set state = 'CANCELLED'
  from public.bookings b where b.id = cp.booking_id and b.status = 'EXPIRED' and cp.state = 'OPEN' and cp.paid_amount = 0;
  return n;
end $$;
grant execute on function public.expire_holds() to authenticated;

-- ---------------------------------------------------------------- quote
-- Price and payment schedule for a stay, without saving anything.
--   DAILY : p_end is the check-out date. One STAY period due on check-in. Fri and Sat nights use the weekend rate.
--   YEARLY: p_years sets the term. MOVE_IN period (deposit) + one RENT period per month, rent in advance due on move-in.
-- p_extras: [{"description": "Cleaning", "amount": 30000}]  p_discount: satang off the stay (daily) or off each month (yearly).
create function public.quote_booking(
  p_unit uuid, p_mode public.rental_mode, p_start date, p_end date default null, p_years int default 1,
  p_adults int default 1, p_children int default 0, p_extras jsonb default '[]', p_discount bigint default 0
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  u public.units; rt public.room_types; rp public.rate_plans; prop public.properties;
  periods jsonb := '[]'; lines jsonb := '[]'; d date; price bigint; total bigint := 0; gross bigint := 0;
  months int; k int; ps date; pe date; due date; rent bigint; dep bigint; e jsonb; nights int; stay_end date;
begin
  select * into u from public.units where id = p_unit;
  if not found then perform app.fail('Unit not found'); end if;
  if not app.can_access_property(u.property_id) then perform app.fail('You don''t have access to this property'); end if;
  select * into prop from public.properties where id = u.property_id;
  select * into rt from public.room_types where id = u.room_type_id;
  if not (p_mode = any (u.allowed_modes)) then perform app.fail(format('Unit %s is not rented %s', u.code, lower(p_mode::text))); end if;
  if coalesce(p_adults, 0) + coalesce(p_children, 0) > rt.max_occupancy then
    perform app.fail(format('%s takes at most %s guests', rt.name, rt.max_occupancy));
  end if;
  select * into rp from public.rate_plans where room_type_id = rt.id and mode = p_mode and is_active;
  if not found then perform app.fail(format('No %s rate set for %s', lower(p_mode::text), rt.name)); end if;
  if coalesce(p_discount, 0) < 0 then perform app.fail('Discount can''t be negative'); end if;

  if p_mode = 'DAILY' then
    if p_end is null or p_end <= p_start then perform app.fail('Check-out must be after check-in'); end if;
    nights := p_end - p_start;
    if nights < rp.min_length then perform app.fail(format('Minimum stay is %s night%s', rp.min_length, case when rp.min_length > 1 then 's' else '' end)); end if;
    if rp.max_length is not null and nights > rp.max_length then perform app.fail(format('Maximum stay is %s nights', rp.max_length)); end if;
    for d in select generate_series(p_start, p_end - 1, interval '1 day')::date loop
      price := case when extract(isodow from d) in (5, 6) and rp.weekend_amount is not null then rp.weekend_amount else rp.base_amount end;
      lines := lines || jsonb_build_object('charge_type', 'NIGHTLY', 'description', to_char(d, 'Dy DD Mon') || case when price <> rp.base_amount then ' · weekend rate' else '' end,
                                           'quantity', 1, 'unit_price', price, 'amount', price, 'meta', jsonb_build_object('date', d));
      gross := gross + price;
    end loop;
    for e in select * from jsonb_array_elements(coalesce(p_extras, '[]')) loop
      lines := lines || jsonb_build_object('charge_type', 'FEE', 'description', e ->> 'description', 'quantity', 1,
                                           'unit_price', (e ->> 'amount')::bigint, 'amount', (e ->> 'amount')::bigint);
      gross := gross + (e ->> 'amount')::bigint;
    end loop;
    if coalesce(p_discount, 0) > 0 then
      if p_discount >= gross then perform app.fail('Discount must be less than the total'); end if;
      lines := lines || jsonb_build_object('charge_type', 'DISCOUNT', 'description', 'Discount', 'quantity', 1, 'unit_price', -p_discount, 'amount', -p_discount);
    end if;
    total := gross - coalesce(p_discount, 0);
    periods := jsonb_build_array(jsonb_build_object('seq', 1, 'kind', 'STAY', 'label', format('Stay %s – %s', to_char(p_start, 'DD Mon'), to_char(p_end, 'DD Mon YYYY')),
      'start', p_start, 'end', p_end, 'due_date', p_start, 'total', total, 'lines', lines));
    stay_end := p_end;
  else
    if coalesce(p_years, 0) < rp.min_length then perform app.fail(format('Minimum lease is %s year%s', rp.min_length, case when rp.min_length > 1 then 's' else '' end)); end if;
    if p_years > 10 then perform app.fail('Leases can be at most 10 years'); end if;
    months := p_years * 12;
    stay_end := (p_start + make_interval(years => p_years))::date;
    rent := rp.base_amount - coalesce(p_discount, 0);
    if rent <= 0 then perform app.fail('Discount must be less than the monthly rent'); end if;
    dep := round(rp.base_amount * coalesce(rp.deposit_months, 0))::bigint;
    lines := '[]';
    if dep > 0 then
      lines := lines || jsonb_build_object('charge_type', 'DEPOSIT', 'description', format('Security deposit (%s months)', trim(to_char(rp.deposit_months, 'FM990.##'))),
                                           'quantity', rp.deposit_months, 'unit_price', rp.base_amount, 'amount', dep);
    end if;
    for e in select * from jsonb_array_elements(coalesce(p_extras, '[]')) loop
      lines := lines || jsonb_build_object('charge_type', 'FEE', 'description', e ->> 'description', 'quantity', 1,
                                           'unit_price', (e ->> 'amount')::bigint, 'amount', (e ->> 'amount')::bigint);
    end loop;
    if jsonb_array_length(lines) > 0 then
      periods := periods || jsonb_build_object('seq', 0, 'kind', 'MOVE_IN', 'label', 'Deposit and move-in', 'start', null, 'end', null, 'due_date', p_start,
        'total', (select coalesce(sum((l ->> 'amount')::bigint), 0) from jsonb_array_elements(lines) l), 'lines', lines);
    end if;
    for k in 1..months loop
      -- Months are counted from the move-in date (31 Jan → 28 Feb → 31 Mar), never cumulatively.
      ps := (p_start + make_interval(months => k - 1))::date;
      pe := (p_start + make_interval(months => k))::date;
      due := case when k <= coalesce(rp.advance_months, 0) then p_start else ps end;
      lines := jsonb_build_array(jsonb_build_object('charge_type', 'RENT', 'description', format('Rent %s – %s', to_char(ps, 'DD Mon'), to_char(pe, 'DD Mon YYYY')),
        'quantity', 1, 'unit_price', rent, 'amount', rent, 'meta', jsonb_build_object('list_price', rp.base_amount)));
      periods := periods || jsonb_build_object('seq', k, 'kind', 'RENT', 'label', format('%s – %s', to_char(ps, 'DD Mon'), to_char(pe, 'DD Mon YYYY')),
        'start', ps, 'end', pe, 'due_date', due, 'total', rent, 'lines', lines);
    end loop;
    total := (select sum((p ->> 'total')::bigint) from jsonb_array_elements(periods) p);
    gross := total + coalesce(p_discount, 0) * months;
  end if;

  return jsonb_build_object(
    'unit_id', u.id, 'unit_code', u.code, 'room_type', rt.name, 'property_id', prop.id, 'mode', p_mode,
    'start', p_start, 'end', stay_end, 'nights', case when p_mode = 'DAILY' then p_end - p_start end, 'years', case when p_mode = 'YEARLY' then p_years end,
    'rate_plan_id', rp.id, 'rent', case when p_mode = 'YEARLY' then rent end,
    'deposit_months', rp.deposit_months, 'advance_months', rp.advance_months,
    'gross', gross, 'discount', coalesce(p_discount, 0), 'total', total, 'periods', periods,
    'due_now', (select coalesce(sum((p ->> 'total')::bigint), 0) from jsonb_array_elements(periods) p where (p ->> 'due_date')::date <= p_start),
    'policy_id', rp.cancellation_policy_id
  );
end $$;
grant execute on function public.quote_booking(uuid, public.rental_mode, date, date, int, int, int, jsonb, bigint) to authenticated;

-- Units of a property free for the given dates, with the price for each.
create function public.available_units(p_property uuid, p_mode public.rental_mode, p_start date, p_end date default null, p_years int default 1, p_guests int default 1)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  stay_end date := case when p_mode = 'DAILY' then p_end else (p_start + make_interval(years => p_years))::date end;
  result jsonb := '[]'; u record; q jsonb; why text;
begin
  if not app.can_access_property(p_property) then perform app.fail('You don''t have access to this property'); end if;
  if stay_end is null or stay_end <= p_start then perform app.fail('Check-out must be after check-in'); end if;
  perform public.expire_holds();
  for u in
    select un.*, rt.name as type_name, rt.max_occupancy from public.units un join public.room_types rt on rt.id = un.room_type_id
    where un.property_id = p_property order by rt.sort_order, rt.name, un.code
  loop
    why := null; q := null;
    if u.status <> 'ACTIVE' then why := lower(u.status::text);
    elsif not (p_mode = any (u.allowed_modes)) then why := 'not rented ' || lower(p_mode::text);
    elsif p_guests > u.max_occupancy then why := format('fits %s guests', u.max_occupancy);
    elsif exists (select 1 from public.bookings b where b.unit_id = u.id and b.status in ('HOLD', 'CONFIRMED', 'CHECKED_IN') and b.stay && daterange(p_start, stay_end)) then
      why := 'booked';
    else
      begin
        q := public.quote_booking(u.id, p_mode, p_start, p_end, p_years, p_guests, 0);
      exception when others then why := sqlerrm;
      end;
    end if;
    result := result || jsonb_build_object('unit_id', u.id, 'code', u.code, 'floor', u.floor, 'room_type', u.type_name,
      'available', why is null, 'reason', why, 'total', q -> 'total', 'due_now', q -> 'due_now', 'rent', q -> 'rent');
  end loop;
  return result;
end $$;
grant execute on function public.available_units(uuid, public.rental_mode, date, date, int, int) to authenticated;

-- ---------------------------------------------------------------- create booking
-- p: { unit_id, mode, start, end | years, adults, children, guest_id | guest {full_name, phone, ...},
--      extras, discount, discount_reason, pay_by, source, note, idempotency_key }
create function public.create_booking(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  existing public.bookings; q jsonb; u public.units; gid uuid; bid uuid; bcode text; per jsonb; pid uuid; l jsonb;
  disc bigint := coalesce((p ->> 'discount')::bigint, 0); limit_pct numeric; gross bigint; v_hold_hours int;
  pay_by timestamptz; arrival timestamptz; prop public.properties; pol jsonb;
begin
  if p ? 'idempotency_key' then
    select * into existing from public.bookings where idempotency_key = p ->> 'idempotency_key';
    if found then return jsonb_build_object('id', existing.id, 'code', existing.code, 'duplicate', true); end if;
  end if;

  select * into u from public.units where id = (p ->> 'unit_id')::uuid;
  if not found then perform app.fail('Unit not found'); end if;
  if not app.can_book(u.property_id) then perform app.fail('You don''t have permission to make bookings here'); end if;
  select * into prop from public.properties where id = u.property_id;
  if prop.status <> 'ACTIVE' then perform app.fail('This property isn''t open for bookings yet'); end if;
  if u.status <> 'ACTIVE' then perform app.fail(format('Unit %s is %s', u.code, lower(u.status::text))); end if;
  if (p ->> 'start')::date < app.today() then perform app.fail('Check-in can''t be in the past'); end if;

  perform public.expire_holds();

  q := public.quote_booking(u.id, (p ->> 'mode')::public.rental_mode, (p ->> 'start')::date, (p ->> 'end')::date,
         coalesce((p ->> 'years')::int, 1), coalesce((p ->> 'adults')::int, 1), coalesce((p ->> 'children')::int, 0),
         coalesce(p -> 'extras', '[]'), disc);

  -- Front desk discounts are capped by the business setting; bigger ones need a manager.
  if disc > 0 then
    if coalesce(trim(p ->> 'discount_reason'), '') = '' then perform app.fail('Give a reason for the discount'); end if;
    if app.current_role() = 'FRONT_DESK' then
      select front_desk_discount_limit_pct into limit_pct from public.business_settings;
      gross := (q ->> 'gross')::bigint;
      if gross > 0 and (q ->> 'gross')::bigint - (q ->> 'total')::bigint > gross * limit_pct / 100 then
        perform app.fail(format('Front desk can give at most %s%% off. Ask a manager.', trim(to_char(limit_pct, 'FM990.##'))));
      end if;
    end if;
  end if;

  -- Guest: existing or new.
  if p ? 'guest_id' and nullif(p ->> 'guest_id', '') is not null then
    gid := (p ->> 'guest_id')::uuid;
    if not exists (select 1 from public.guests where id = gid) then perform app.fail('Guest not found'); end if;
  else
    if coalesce(trim(p -> 'guest' ->> 'full_name'), '') = '' then perform app.fail('Enter the guest''s name'); end if;
    insert into public.guests (full_name, phone, email, line_id, nationality, is_company, company_name, tax_id, branch, billing_address)
    values (trim(p -> 'guest' ->> 'full_name'), nullif(trim(p -> 'guest' ->> 'phone'), ''), nullif(trim(p -> 'guest' ->> 'email'), ''),
            nullif(trim(p -> 'guest' ->> 'line_id'), ''), nullif(trim(p -> 'guest' ->> 'nationality'), ''),
            coalesce((p -> 'guest' ->> 'is_company')::boolean, false), nullif(trim(p -> 'guest' ->> 'company_name'), ''),
            nullif(trim(p -> 'guest' ->> 'tax_id'), ''), nullif(trim(p -> 'guest' ->> 'branch'), ''), nullif(trim(p -> 'guest' ->> 'billing_address'), ''))
    returning id into gid;
  end if;

  -- Pay-by: daily = check-in time on arrival day; yearly = hold window, but never after move-in. Staff may set an earlier time.
  arrival := ((q ->> 'start')::date + prop.check_in_time) at time zone 'Asia/Bangkok';
  select bs.hold_hours into v_hold_hours from public.business_settings bs;
  -- Same-day walk-ins booked after check-in time still get an hour to pay.
  pay_by := case when q ->> 'mode' = 'DAILY' then greatest(arrival, now() + interval '1 hour')
                 else greatest(least(now() + make_interval(hours => v_hold_hours), arrival), now() + interval '1 hour') end;
  if nullif(p ->> 'pay_by', '') is not null then
    if (p ->> 'pay_by')::timestamptz <= now() then perform app.fail('Pay-by time must be in the future'); end if;
    pay_by := least(pay_by, (p ->> 'pay_by')::timestamptz);
  end if;

  select to_jsonb(cp) into pol from public.cancellation_policies cp where id = (q ->> 'policy_id')::uuid;
  bcode := app.next_doc_no(u.property_id, 'BK');

  begin
    insert into public.bookings (code, property_id, unit_id, kind, mode, status, stay, guest_id, adults, children, rate_plan_id,
      price_snapshot, policy_snapshot, hold_expires_at, source, note, idempotency_key)
    values (bcode, u.property_id, u.id, 'RESERVATION', (q ->> 'mode')::public.rental_mode, 'HOLD',
      daterange((q ->> 'start')::date, (q ->> 'end')::date), gid, coalesce((p ->> 'adults')::int, 1), coalesce((p ->> 'children')::int, 0),
      (q ->> 'rate_plan_id')::uuid, q - 'periods' || jsonb_build_object('discount_reason', p ->> 'discount_reason'), pol, pay_by,
      coalesce(nullif(p ->> 'source', ''), 'DIRECT'), nullif(trim(p ->> 'note'), ''), p ->> 'idempotency_key')
    returning id into bid;
  exception when exclusion_violation then
    perform app.fail(format('Unit %s was just booked for these dates. Choose another unit.', u.code));
  end;

  for per in select * from jsonb_array_elements(q -> 'periods') loop
    insert into public.charge_periods (booking_id, seq, kind, label, period, due_date, total_amount)
    values (bid, (per ->> 'seq')::int, (per ->> 'kind')::public.period_kind, per ->> 'label',
            case when per ->> 'start' is not null then daterange((per ->> 'start')::date, (per ->> 'end')::date) end,
            (per ->> 'due_date')::date, (per ->> 'total')::bigint)
    returning id into pid;
    for l in select * from jsonb_array_elements(per -> 'lines') loop
      insert into public.charge_lines (period_id, charge_type, description, quantity, unit_price, amount, meta)
      values (pid, l ->> 'charge_type', l ->> 'description', (l ->> 'quantity')::numeric, (l ->> 'unit_price')::bigint, (l ->> 'amount')::bigint, l -> 'meta');
    end loop;
  end loop;

  if q ->> 'mode' = 'YEARLY' then
    insert into public.leases (booking_id, start_date, end_date, rent_amount, deposit_amount, deposit_months, advance_months)
    values (bid, (q ->> 'start')::date, (q ->> 'end')::date, (q ->> 'rent')::bigint,
            round(coalesce((q ->> 'deposit_months')::numeric, 0) * ((q ->> 'rent')::bigint + disc))::bigint,
            coalesce((q ->> 'deposit_months')::numeric, 0), coalesce((q ->> 'advance_months')::int, 0));
  end if;

  perform app.refresh_booking_totals(bid);
  perform app.log_status(bid, null, 'HOLD', 'Reserved');
  insert into public.audit_logs (actor_id, action, entity, entity_id, after) values (auth.uid(), 'booking.create', 'booking', bid::text, p - 'idempotency_key');
  return jsonb_build_object('id', bid, 'code', bcode, 'pay_by', pay_by, 'total', q -> 'total', 'due_now', q -> 'due_now');
end $$;
grant execute on function public.create_booking(jsonb) to authenticated;

-- ---------------------------------------------------------------- payments
-- Confirms a reservation once what is due before arrival is paid.
create function app.maybe_confirm(bid uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; owing bigint;
begin
  select * into b from public.bookings where id = bid;
  if b.status <> 'HOLD' then return false; end if;
  select coalesce(sum(total_amount - paid_amount), 0) into owing from public.charge_periods
  where booking_id = bid and state = 'OPEN' and paid_amount < total_amount and due_date <= lower(b.stay);
  if owing > 0 then return false; end if;
  update public.bookings set status = 'CONFIRMED', hold_expires_at = null where id = bid;
  perform app.log_status(bid, 'HOLD', 'CONFIRMED', 'Paid');
  return true;
end $$;

-- Applies money to open periods, oldest due first (or the given periods, in order). Returns what is left over.
create function app.allocate(pay_id uuid, bid uuid, money bigint, only_periods uuid[], on_date date) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare cp record; take bigint;
begin
  for cp in
    select id, total_amount - paid_amount as owing from public.charge_periods
    where booking_id = bid and state = 'OPEN' and paid_amount < total_amount
      and (only_periods is null or id = any (only_periods))
    order by case when only_periods is null then 0 else array_position(only_periods, id) end, due_date, seq
    for update
  loop
    exit when money <= 0;
    take := least(money, cp.owing);
    insert into public.payment_allocations (payment_id, period_id, amount) values (pay_id, cp.id, take);
    update public.charge_periods set paid_amount = paid_amount + take,
      paid_at = case when paid_amount + take >= total_amount then on_date else paid_at end
    where id = cp.id;
    money := money - take;
  end loop;
  return money;
end $$;

-- p: { booking_id, amount, wht_amount, wht_cert_no, paid_at, method, reference, note, period_ids[], use_credit, idempotency_key }
create function public.record_payment(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.bookings; pay_id uuid; left_over bigint; amt bigint := (p ->> 'amount')::bigint; wht bigint := coalesce((p ->> 'wht_amount')::bigint, 0);
  sel_periods uuid[]; paid_on date := coalesce((p ->> 'paid_at')::date, app.today()); confirmed boolean; existing uuid;
begin
  if p ? 'idempotency_key' then
    select id into existing from public.payments where idempotency_key = p ->> 'idempotency_key';
    if found then return jsonb_build_object('payment_id', existing, 'duplicate', true); end if;
  end if;
  select * into b from public.bookings where id = (p ->> 'booking_id')::uuid for update;
  if not found then perform app.fail('Booking not found'); end if;
  if not app.can_take_payment(b.property_id) then perform app.fail('You don''t have access to this property'); end if;
  if b.kind = 'BLOCK' then perform app.fail('Blocked dates have no payments'); end if;
  if b.status in ('CANCELLED', 'EXPIRED', 'NO_SHOW') then
    perform app.fail(format('This booking is %s. Make a new booking to take payment.', lower(b.status::text)));
  end if;
  if coalesce(amt, 0) <= 0 then perform app.fail('Enter the amount received'); end if;
  if wht < 0 then perform app.fail('Withholding tax can''t be negative'); end if;
  if paid_on > app.today() then perform app.fail('Payment date can''t be in the future'); end if;
  if jsonb_typeof(p -> 'period_ids') = 'array' and jsonb_array_length(p -> 'period_ids') > 0 then
    sel_periods := array(select jsonb_array_elements_text(p -> 'period_ids')::uuid);
  end if;

  insert into public.payments (booking_id, amount, wht_amount, wht_cert_no, paid_at, method, reference, note, idempotency_key)
  values (b.id, amt, wht, nullif(trim(p ->> 'wht_cert_no'), ''), paid_on, (p ->> 'method')::public.payment_method,
          nullif(trim(p ->> 'reference'), ''), nullif(trim(p ->> 'note'), ''), p ->> 'idempotency_key')
  returning id into pay_id;

  left_over := app.allocate(pay_id, b.id, amt + wht, sel_periods, paid_on);
  if left_over > 0 then
    update public.bookings set credit_balance = credit_balance + left_over where id = b.id;
  end if;
  perform app.refresh_booking_totals(b.id);
  confirmed := app.maybe_confirm(b.id);
  insert into public.audit_logs (actor_id, action, entity, entity_id, after) values (auth.uid(), 'payment.record', 'payment', pay_id::text, p - 'idempotency_key');
  return jsonb_build_object('payment_id', pay_id, 'credit', left_over, 'confirmed', confirmed);
end $$;
grant execute on function public.record_payment(jsonb) to authenticated;

create function public.void_payment(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare pay public.payments; b public.bookings; a record; allocated bigint;
begin
  select * into pay from public.payments where id = p_payment for update;
  if not found then perform app.fail('Payment not found'); end if;
  if pay.voided_at is not null then perform app.fail('This payment is already void'); end if;
  select * into b from public.bookings where id = pay.booking_id for update;
  if not (app.has_role('ADMIN', 'MANAGER', 'ACCOUNTANT') and app.can_access_property(b.property_id)) then
    perform app.fail('Only managers and accountants can void payments');
  end if;
  if coalesce(trim(p_reason), '') = '' then perform app.fail('Give a reason'); end if;
  allocated := 0;
  for a in select * from public.payment_allocations where payment_id = pay.id loop
    update public.charge_periods set paid_amount = paid_amount - a.amount,
      paid_at = case when paid_amount - a.amount >= total_amount then paid_at else null end
    where id = a.period_id;
    allocated := allocated + a.amount;
  end loop;
  delete from public.payment_allocations where payment_id = pay.id;
  update public.bookings set credit_balance = greatest(credit_balance - (pay.amount + pay.wht_amount - allocated), 0) where id = b.id;
  update public.payments set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason) where id = pay.id;
  perform app.refresh_booking_totals(b.id);
  insert into public.audit_logs (actor_id, action, entity, entity_id, after) values (auth.uid(), 'payment.void', 'payment', pay.id::text, jsonb_build_object('reason', p_reason));
end $$;
grant execute on function public.void_payment(uuid, text) to authenticated;

-- ---------------------------------------------------------------- stay lifecycle
create function public.check_in(p_booking uuid, p_override_reason text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; owing bigint;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then perform app.fail('Booking not found'); end if;
  if not app.can_book(b.property_id) then perform app.fail('You don''t have permission to check guests in here'); end if;
  if b.status <> 'CONFIRMED' then
    perform app.fail(case when b.status = 'HOLD' then 'This reservation isn''t paid yet. Take payment first.' else format('Can''t check in a %s booking', lower(b.status::text)) end);
  end if;
  if app.today() < lower(b.stay) then perform app.fail(format('Check-in is on %s', to_char(lower(b.stay), 'DD Mon YYYY'))); end if;
  if app.today() >= upper(b.stay) then perform app.fail('This stay has already ended'); end if;
  select coalesce(sum(total_amount - paid_amount), 0) into owing from public.charge_periods
  where booking_id = b.id and state = 'OPEN' and paid_amount < total_amount and due_date <= app.today();
  if owing > 0 then
    if coalesce(trim(p_override_reason), '') = '' or not app.has_role('ADMIN', 'MANAGER') then
      perform app.fail('There is money due. Take payment, or ask a manager to check in with a reason.');
    end if;
  end if;
  update public.bookings set status = 'CHECKED_IN', actual_check_in = now() where id = b.id;
  perform app.log_status(b.id, 'CONFIRMED', 'CHECKED_IN', nullif(trim(p_override_reason), ''));
end $$;
grant execute on function public.check_in(uuid, text) to authenticated;

-- Early departure frees the remaining nights. Yearly: unpaid rent periods starting after today are cancelled.
create function public.check_out(p_booking uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; t date := app.today();
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then perform app.fail('Booking not found'); end if;
  if not app.can_book(b.property_id) then perform app.fail('You don''t have permission to check guests out here'); end if;
  if b.status <> 'CHECKED_IN' then perform app.fail('Only checked-in guests can check out'); end if;
  update public.bookings set status = 'CHECKED_OUT', actual_check_out = now(),
    stay = case when t < upper(stay) then daterange(lower(stay), greatest(t, lower(stay) + 1)) else stay end
  where id = b.id;
  if b.mode = 'YEARLY' then
    update public.charge_periods set state = 'CANCELLED', note = 'Moved out early'
    where booking_id = b.id and kind = 'RENT' and state = 'OPEN' and paid_amount = 0 and lower(period) > t;
  end if;
  perform app.refresh_booking_totals(b.id);
  perform app.log_status(b.id, 'CHECKED_IN', 'CHECKED_OUT', null);
end $$;
grant execute on function public.check_out(uuid) to authenticated;

-- Cancels a reservation or confirmed booking before check-in. Optionally records the refund given back.
create function public.cancel_booking(p_booking uuid, p_reason text, p_refund bigint default 0, p_refund_method public.payment_method default 'TRANSFER')
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then perform app.fail('Booking not found'); end if;
  if not app.can_book(b.property_id) then perform app.fail('You don''t have permission to cancel bookings here'); end if;
  if b.status not in ('HOLD', 'CONFIRMED') then perform app.fail(format('A %s booking can''t be cancelled', lower(b.status::text))); end if;
  if coalesce(trim(p_reason), '') = '' then perform app.fail('Give a reason'); end if;
  if coalesce(p_refund, 0) < 0 then perform app.fail('Refund can''t be negative'); end if;
  if coalesce(p_refund, 0) > b.paid_amount + b.credit_balance then perform app.fail('Refund can''t be more than what was paid'); end if;
  if coalesce(p_refund, 0) > 0 and b.kind = 'RESERVATION' then
    insert into public.refunds (booking_id, amount, refunded_at, method, reason) values (b.id, p_refund, app.today(), p_refund_method, trim(p_reason));
  end if;
  update public.bookings set status = 'CANCELLED', cancelled_at = now(), cancel_reason = trim(p_reason), hold_expires_at = null where id = b.id;
  update public.charge_periods set state = 'CANCELLED' where booking_id = b.id and state = 'OPEN';
  perform app.refresh_booking_totals(b.id);
  perform app.log_status(b.id, b.status, 'CANCELLED', trim(p_reason));
end $$;
grant execute on function public.cancel_booking(uuid, text, bigint, public.payment_method) to authenticated;

create function public.mark_no_show(p_booking uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then perform app.fail('Booking not found'); end if;
  if not app.can_book(b.property_id) then perform app.fail('You don''t have permission here'); end if;
  if b.mode <> 'DAILY' or b.status not in ('HOLD', 'CONFIRMED') then perform app.fail('Only daily bookings that haven''t checked in can be marked no-show'); end if;
  if app.today() < lower(b.stay) then perform app.fail('The guest isn''t due yet'); end if;
  update public.bookings set status = 'NO_SHOW', hold_expires_at = null where id = b.id;
  update public.charge_periods set state = 'CANCELLED' where booking_id = b.id and state = 'OPEN' and paid_amount = 0;
  perform app.refresh_booking_totals(b.id);
  perform app.log_status(b.id, b.status, 'NO_SHOW', null);
end $$;
grant execute on function public.mark_no_show(uuid) to authenticated;

-- Blocks dates on a unit (maintenance, owner use). Blocks collide with bookings like any stay.
create function public.create_block(p_unit uuid, p_start date, p_end date, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.units; bid uuid; bcode text;
begin
  select * into u from public.units where id = p_unit;
  if not found then perform app.fail('Unit not found'); end if;
  if not app.can_book(u.property_id) then perform app.fail('You don''t have permission here'); end if;
  if p_end <= p_start then perform app.fail('End date must be after start date'); end if;
  if coalesce(trim(p_reason), '') = '' then perform app.fail('Give a reason, e.g. Maintenance'); end if;
  perform public.expire_holds();
  bcode := app.next_doc_no(u.property_id, 'BL');
  begin
    insert into public.bookings (code, property_id, unit_id, kind, status, stay, block_reason)
    values (bcode, u.property_id, u.id, 'BLOCK', 'CONFIRMED', daterange(p_start, p_end), trim(p_reason)) returning id into bid;
  exception when exclusion_violation then
    perform app.fail(format('Unit %s already has a booking in those dates', u.code));
  end;
  perform app.log_status(bid, null, 'CONFIRMED', trim(p_reason));
  return jsonb_build_object('id', bid, 'code', bcode);
end $$;
grant execute on function public.create_block(uuid, date, date, text) to authenticated;

create function public.remove_block(p_booking uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking and kind = 'BLOCK' for update;
  if not found then perform app.fail('Block not found'); end if;
  if not app.can_book(b.property_id) then perform app.fail('You don''t have permission here'); end if;
  update public.bookings set status = 'CANCELLED', cancelled_at = now() where id = b.id;
  perform app.log_status(b.id, b.status, 'CANCELLED', 'Block removed');
end $$;
grant execute on function public.remove_block(uuid) to authenticated;

-- ---------------------------------------------------------------- row level security
alter table public.guests                 enable row level security;
alter table public.bookings               enable row level security;
alter table public.booking_status_history enable row level security;
alter table public.leases                 enable row level security;
alter table public.charge_periods         enable row level security;
alter table public.charge_lines           enable row level security;
alter table public.payments               enable row level security;
alter table public.payment_allocations    enable row level security;
alter table public.refunds                enable row level security;
alter table public.document_sequences     enable row level security;

-- Guests are shared across properties (a returning guest may stay anywhere).
create policy guests_read   on public.guests for select to authenticated using (app.is_member());
create policy guests_insert on public.guests for insert to authenticated with check (app.has_role('ADMIN', 'MANAGER', 'FRONT_DESK'));
create policy guests_update on public.guests for update to authenticated
  using (app.has_role('ADMIN', 'MANAGER', 'FRONT_DESK')) with check (app.has_role('ADMIN', 'MANAGER', 'FRONT_DESK'));

-- Booking data: read-only through RLS; all writes go through the functions above.
create policy bookings_read on public.bookings for select to authenticated using (app.can_access_property(property_id));
create policy history_read on public.booking_status_history for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and app.can_access_property(b.property_id)));
create policy leases_read on public.leases for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and app.can_access_property(b.property_id)));
create policy periods_read on public.charge_periods for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and app.can_access_property(b.property_id)));
create policy lines_read on public.charge_lines for select to authenticated
  using (exists (select 1 from public.charge_periods cp join public.bookings b on b.id = cp.booking_id where cp.id = period_id and app.can_access_property(b.property_id)));
create policy payments_read on public.payments for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and app.can_access_property(b.property_id)));
create policy allocations_read on public.payment_allocations for select to authenticated
  using (exists (select 1 from public.payments pm join public.bookings b on b.id = pm.booking_id where pm.id = payment_id and app.can_access_property(b.property_id)));
create policy refunds_read on public.refunds for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id and app.can_access_property(b.property_id)));

grant select on public.guests, public.bookings, public.booking_status_history, public.leases, public.charge_periods,
  public.charge_lines, public.payments, public.payment_allocations, public.refunds, public.charge_periods_v to authenticated;
grant insert, update on public.guests to authenticated;
revoke insert, update, delete on public.bookings, public.booking_status_history, public.leases, public.charge_periods,
  public.charge_lines, public.payments, public.payment_allocations, public.refunds, public.document_sequences from authenticated;

-- ============================================================
-- 20261028000200_sprint2_cron.sql
-- ============================================================
-- Releases unpaid reservations every 5 minutes. Enable the pg_cron extension in Supabase
-- (Database → Extensions) before running this file.
create extension if not exists pg_cron;

select cron.schedule('expire-holds', '*/5 * * * *', $$select public.expire_holds()$$);

-- ============================================================
-- 20261029000100_sprint3_meters_documents.sql
-- ============================================================
-- Sprint 3: meter readings and utility billing, invoices and receipts, extending daily stays,
-- yearly move-out with deposit settlement.

alter type public.payment_method add value if not exists 'DEPOSIT';  -- money taken from the held deposit
alter type public.payment_method add value if not exists 'CREDIT';   -- earlier overpayment moved onto new charges (not new money)

-- ---------------------------------------------------------------- meter readings
create type public.reading_type as enum ('MONTHLY', 'MOVE_IN', 'MOVE_OUT');

create table public.meter_readings (
  id           uuid primary key default gen_random_uuid(),
  meter_id     uuid not null references public.meters (id) on delete cascade,
  unit_id      uuid not null references public.units (id) on delete cascade,
  property_id  uuid not null references public.properties (id) on delete cascade,
  reading_date date not null,
  value        numeric(12,2) not null check (value >= 0),
  reading_type public.reading_type not null default 'MONTHLY',
  booking_id   uuid references public.bookings (id) on delete set null,
  photo_path   text,                  -- storage path in bucket "meter-photos"
  billed_line_id uuid references public.charge_lines (id) on delete set null,
  recorded_by  uuid default auth.uid(),
  recorded_at  timestamptz not null default now(),
  unique (meter_id, reading_date, reading_type)
);
create index meter_readings_unit_date on public.meter_readings (unit_id, reading_date desc);

-- Latest reading of a meter strictly before a date (falls back to the meter's starting value).
create function app.previous_reading(p_meter uuid, p_before date, p_not_before date default null)
returns table (value numeric, reading_date date, reading_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select * from (
    select r.value, r.reading_date, r.id as reading_id from public.meter_readings r
    where r.meter_id = p_meter and r.reading_date < p_before and (p_not_before is null or r.reading_date >= p_not_before)
    union all
    select m.initial_value, m.installed_on, null::uuid from public.meters m
    where m.id = p_meter and m.installed_on < p_before and (p_not_before is null or m.installed_on >= p_not_before)
  ) x order by reading_date desc, (reading_id is null) limit 1
$$;

-- Saves (or corrects) one reading. Creates the meter if the unit has none yet.
-- A reading lower than the previous one is refused unless p_allow_lower (meter replaced or reset).
create function public.save_meter_reading(
  p_unit uuid, p_utility public.utility_kind, p_date date, p_value numeric,
  p_type public.reading_type default 'MONTHLY', p_booking uuid default null, p_photo text default null, p_allow_lower boolean default false
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.units; m uuid; prev record; rid uuid; billed uuid;
begin
  select * into u from public.units where id = p_unit;
  if not found then perform app.fail('Unit not found'); end if;
  if not app.can_book(u.property_id) then perform app.fail('You don''t have permission to record meters here'); end if;
  if p_value is null or p_value < 0 then perform app.fail(format('Unit %s: enter a reading of 0 or more', u.code)); end if;
  if p_date > app.today() then perform app.fail('Readings can''t be in the future'); end if;

  select id into m from public.meters where unit_id = u.id and utility = p_utility and retired_on is null;
  if m is null then
    insert into public.meters (unit_id, utility, installed_on, initial_value) values (u.id, p_utility, p_date, p_value) returning id into m;
  end if;

  select * into prev from app.previous_reading(m, p_date);
  if prev.value is not null and p_value < prev.value and not p_allow_lower then
    perform app.fail(format('Unit %s %s: %s is lower than the last reading (%s on %s). Check the number, or tick "meter replaced".',
      u.code, lower(p_utility::text), p_value, prev.value, to_char(prev.reading_date, 'DD Mon')));
  end if;

  select id, billed_line_id into rid, billed from public.meter_readings where meter_id = m and reading_date = p_date and reading_type = p_type;
  if rid is not null then
    if billed is not null then perform app.fail(format('Unit %s %s reading for %s is already billed', u.code, lower(p_utility::text), to_char(p_date, 'DD Mon'))); end if;
    update public.meter_readings set value = p_value, photo_path = coalesce(p_photo, photo_path), booking_id = coalesce(p_booking, booking_id),
      recorded_by = auth.uid(), recorded_at = now() where id = rid;
  else
    insert into public.meter_readings (meter_id, unit_id, property_id, reading_date, value, reading_type, booking_id, photo_path)
    values (m, u.id, u.property_id, p_date, p_value, p_type, p_booking, p_photo) returning id into rid;
  end if;
  return rid;
end $$;
grant execute on function public.save_meter_reading(uuid, public.utility_kind, date, numeric, public.reading_type, uuid, text, boolean) to authenticated;

-- Adds water/electricity for one reading to the booking's bill. Returns the charge line id (null when nothing to bill).
-- Goes on the next open rent period due after the reading; otherwise on a separate "Utilities" period due on the reading date.
create function app.bill_reading(p_reading uuid, p_booking uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.meter_readings; b public.bookings; prev record; rate public.utility_rates; used numeric; amt bigint;
  target uuid; nseq int; lid uuid; label text; prop public.properties;
begin
  select * into r from public.meter_readings where id = p_reading for update;
  if r.billed_line_id is not null then return null; end if;
  select * into b from public.bookings where id = p_booking;
  select * into prev from app.previous_reading(r.meter_id, r.reading_date, b.check_in);
  if prev.value is null then return null; end if;           -- no starting reading within this stay
  used := r.value - prev.value;
  if used < 0 then used := 0; end if;
  select ur.* into rate from public.utility_rates ur join public.meters mt on mt.id = r.meter_id
  where ur.property_id = r.property_id and ur.utility = mt.utility and ur.effective_from <= r.reading_date
  order by ur.effective_from desc limit 1;
  if not found then perform app.fail('Set water and electricity prices for this property first'); end if;
  amt := greatest(round(used * rate.price_per_unit)::bigint, rate.minimum_charge);
  if amt = 0 then return null; end if;

  select id into target from public.charge_periods
  where booking_id = b.id and kind = 'RENT' and state = 'OPEN' and paid_amount = 0 and due_date > r.reading_date
  order by due_date, seq limit 1;
  if target is null then
    select coalesce(max(seq), 0) + 1 into nseq from public.charge_periods where booking_id = b.id;
    insert into public.charge_periods (booking_id, seq, kind, label, due_date, total_amount)
    values (b.id, nseq, 'ADJUSTMENT', format('Utilities to %s', to_char(r.reading_date, 'DD Mon YYYY')), r.reading_date, 0)
    returning id into target;
  end if;

  select (select initcap(lower(utility::text)) from public.meters where id = r.meter_id) into label;
  insert into public.charge_lines (period_id, charge_type, description, quantity, unit_price, amount, meta)
  values (target, (select utility::text from public.meters where id = r.meter_id),
    format('%s %s → %s (%s units × ฿%s)%s', case when label = 'Electric' then 'Electricity' else label end,
      trim(to_char(prev.value, 'FM999,999,990.##')), trim(to_char(r.value, 'FM999,999,990.##')), trim(to_char(used, 'FM999,999,990.##')),
      trim(to_char(rate.price_per_unit / 100.0, 'FM999,990.00')), case when amt = rate.minimum_charge and round(used * rate.price_per_unit) < amt then ' · minimum charge' else '' end),
    used, rate.price_per_unit, amt,
    jsonb_build_object('reading_id', r.id, 'previous_reading_id', prev.reading_id, 'from', prev.value, 'to', r.value, 'from_date', prev.reading_date, 'to_date', r.reading_date))
  returning id into lid;
  update public.charge_periods set total_amount = total_amount + amt where id = target;
  update public.meter_readings set billed_line_id = lid, booking_id = b.id where id = r.id;
  perform app.refresh_booking_totals(b.id);
  return lid;
end $$;

-- Bills every unbilled reading of a property on a date to the yearly tenant living there then.
create function public.bill_utilities(p_property uuid, p_date date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; lid uuid; n int := 0; total bigint := 0; skipped int := 0;
begin
  if not app.can_book(p_property) then perform app.fail('You don''t have permission here'); end if;
  for r in
    select mr.id as reading_id, b.id as booking_id from public.meter_readings mr
    join public.bookings b on b.unit_id = mr.unit_id and b.mode = 'YEARLY' and b.status in ('CONFIRMED', 'CHECKED_IN')
      and b.check_in < mr.reading_date and mr.reading_date <= b.check_out
    where mr.property_id = p_property and mr.reading_date = p_date and mr.billed_line_id is null and mr.reading_type = 'MONTHLY'
  loop
    lid := app.bill_reading(r.reading_id, r.booking_id);
    if lid is null then skipped := skipped + 1;
    else n := n + 1; total := total + (select amount from public.charge_lines where id = lid);
    end if;
  end loop;
  return jsonb_build_object('billed', n, 'skipped', skipped, 'total', total);
end $$;
grant execute on function public.bill_utilities(uuid, date) to authenticated;

-- ---------------------------------------------------------------- extend a daily stay
create function public.extend_stay(p_booking uuid, p_new_check_out date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; u public.units; rp public.rate_plans; d date; price bigint; total bigint := 0; lines jsonb := '[]';
  pid uuid; nseq int; l jsonb; old_end date;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then perform app.fail('Booking not found'); end if;
  if not app.can_book(b.property_id) then perform app.fail('You don''t have permission here'); end if;
  if b.mode <> 'DAILY' or b.status not in ('HOLD', 'CONFIRMED', 'CHECKED_IN') then perform app.fail('Only current daily bookings can be extended'); end if;
  old_end := b.check_out;
  if p_new_check_out <= old_end then perform app.fail('Pick a check-out date after the current one'); end if;
  select * into u from public.units where id = b.unit_id;
  select * into rp from public.rate_plans where room_type_id = u.room_type_id and mode = 'DAILY';
  if rp.max_length is not null and p_new_check_out - b.check_in > rp.max_length then perform app.fail(format('Maximum stay is %s nights', rp.max_length)); end if;

  begin
    update public.bookings set stay = daterange(b.check_in, p_new_check_out) where id = b.id;
  exception when exclusion_violation then
    perform app.fail(format('Unit %s has another booking before %s. Choose an earlier check-out or move the guest.', u.code,
      to_char(p_new_check_out, 'DD Mon')));
  end;

  for d in select generate_series(old_end, p_new_check_out - 1, interval '1 day')::date loop
    price := case when extract(isodow from d) in (5, 6) and rp.weekend_amount is not null then rp.weekend_amount else rp.base_amount end;
    lines := lines || jsonb_build_object('description', to_char(d, 'Dy DD Mon') || case when price <> rp.base_amount then ' · weekend rate' else '' end, 'amount', price, 'date', d);
    total := total + price;
  end loop;
  select coalesce(max(seq), 0) + 1 into nseq from public.charge_periods where booking_id = b.id;
  -- Extra nights are paid up front: due today if already in house, otherwise on arrival.
  insert into public.charge_periods (booking_id, seq, kind, label, period, due_date, total_amount)
  values (b.id, nseq, 'STAY', format('Extra nights %s – %s', to_char(old_end, 'DD Mon'), to_char(p_new_check_out, 'DD Mon YYYY')),
    daterange(old_end, p_new_check_out), greatest(app.today(), b.check_in), total)
  returning id into pid;
  for l in select * from jsonb_array_elements(lines) loop
    insert into public.charge_lines (period_id, charge_type, description, quantity, unit_price, amount, meta)
    values (pid, 'NIGHTLY', l ->> 'description', 1, (l ->> 'amount')::bigint, (l ->> 'amount')::bigint, jsonb_build_object('date', l ->> 'date'));
  end loop;
  -- Use any credit the guest already has.
  if b.credit_balance > 0 then
    perform app.apply_credit(b.id);
  end if;
  perform app.refresh_booking_totals(b.id);
  perform app.log_status(b.id, b.status, b.status, format('Extended to %s (+%s nights)', to_char(p_new_check_out, 'DD Mon YYYY'), p_new_check_out - old_end));
  return jsonb_build_object('nights', p_new_check_out - old_end, 'total', total);
end $$;

-- Moves credit (overpayment) onto open periods, oldest first, as a zero-cash allocation of the original payments.
create function app.apply_credit(bid uuid) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; pay_id uuid; left_over bigint;
begin
  select * into b from public.bookings where id = bid for update;
  if b.credit_balance <= 0 then return 0; end if;
  insert into public.payments (booking_id, amount, paid_at, method, note)
  values (b.id, b.credit_balance, app.today(), 'CREDIT', 'Credit from earlier overpayment') returning id into pay_id;
  left_over := app.allocate(pay_id, b.id, b.credit_balance, null, app.today());
  -- The credit is not new money: record only what was used, keep the rest as credit.
  update public.payments set amount = b.credit_balance - left_over where id = pay_id;
  if b.credit_balance - left_over = 0 then delete from public.payments where id = pay_id; end if;
  update public.bookings set credit_balance = left_over where id = b.id;
  return b.credit_balance - left_over;
end $$;
grant execute on function public.extend_stay(uuid, date) to authenticated;

-- ---------------------------------------------------------------- move-out & deposit
alter table public.leases
  add column settled_at timestamptz,
  add column deposit_used bigint not null default 0,
  add column deposit_refunded bigint not null default 0;

-- After check-out of a yearly lease: final meter readings, move-out charges, deposit pays what is owed, the rest is refunded.
-- p: { booking_id, date, readings: {WATER: n, ELECTRIC: n}, deductions: [{description, amount}], refund_method }
create function public.settle_lease(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; le public.leases; d date := coalesce((p ->> 'date')::date, app.today()); held bigint; owing bigint;
  use bigint; refund bigint; e jsonb; pid uuid; nseq int; pay_id uuid; rid uuid; ut text; ded_total bigint := 0;
begin
  select * into b from public.bookings where id = (p ->> 'booking_id')::uuid for update;
  if not found then perform app.fail('Booking not found'); end if;
  if not app.has_role('ADMIN', 'MANAGER', 'ACCOUNTANT', 'FRONT_DESK') or not app.can_access_property(b.property_id) then perform app.fail('You don''t have permission here'); end if;
  if b.mode <> 'YEARLY' then perform app.fail('Only yearly leases have a deposit to settle'); end if;
  if b.status <> 'CHECKED_OUT' then perform app.fail('Check the tenant out first'); end if;
  select * into le from public.leases where booking_id = b.id for update;
  if le.settled_at is not null then perform app.fail('This deposit is already settled'); end if;

  -- 1. Final meter readings, billed onto a move-out period.
  select coalesce(max(seq), 0) + 1 into nseq from public.charge_periods where booking_id = b.id;
  insert into public.charge_periods (booking_id, seq, kind, label, due_date, total_amount)
  values (b.id, nseq, 'ADJUSTMENT', 'Move-out charges', d, 0) returning id into pid;
  for ut in select unnest(array['WATER', 'ELECTRIC']) loop
    if p -> 'readings' ? ut and nullif(p -> 'readings' ->> ut, '') is not null then
      rid := public.save_meter_reading(b.unit_id, ut::public.utility_kind, d, (p -> 'readings' ->> ut)::numeric, 'MOVE_OUT', b.id);
      perform app.bill_reading(rid, b.id);
    end if;
  end loop;
  -- bill_reading may have used the move-out period (it is the only open one due after) or created its own; keep charges together.
  update public.charge_lines set period_id = pid
  where period_id in (select id from public.charge_periods where booking_id = b.id and kind = 'ADJUSTMENT' and id <> pid and label like 'Utilities to%' and due_date = d);
  delete from public.charge_periods where booking_id = b.id and kind = 'ADJUSTMENT' and id <> pid and label like 'Utilities to%' and due_date = d
    and not exists (select 1 from public.charge_lines where period_id = charge_periods.id);

  -- 2. Deductions (cleaning, damage …).
  for e in select * from jsonb_array_elements(coalesce(p -> 'deductions', '[]')) loop
    if coalesce(trim(e ->> 'description'), '') = '' or coalesce((e ->> 'amount')::bigint, 0) <= 0 then
      perform app.fail('Each deduction needs a description and an amount');
    end if;
    insert into public.charge_lines (period_id, charge_type, description, quantity, unit_price, amount)
    values (pid, 'DEDUCTION', trim(e ->> 'description'), 1, (e ->> 'amount')::bigint, (e ->> 'amount')::bigint);
    ded_total := ded_total + (e ->> 'amount')::bigint;
  end loop;
  update public.charge_periods set total_amount = (select coalesce(sum(amount), 0) from public.charge_lines where period_id = pid) where id = pid;
  delete from public.charge_periods where id = pid and total_amount = 0;

  -- 3. Deposit actually held = what was paid towards the move-in period, capped at the deposit.
  select least(le.deposit_amount, coalesce((select paid_amount from public.charge_periods where booking_id = b.id and seq = 0), 0)) into held;
  select coalesce(sum(total_amount - paid_amount), 0) into owing from public.charge_periods where booking_id = b.id and state = 'OPEN' and paid_amount < total_amount;
  use := least(held, owing);
  if use > 0 then
    insert into public.payments (booking_id, amount, paid_at, method, note) values (b.id, use, d, 'DEPOSIT', 'Paid from the security deposit') returning id into pay_id;
    perform app.allocate(pay_id, b.id, use, null, d);
  end if;
  refund := held - use;
  if refund > 0 then
    insert into public.refunds (booking_id, amount, refunded_at, method, reason)
    values (b.id, refund, d, coalesce(nullif(p ->> 'refund_method', ''), 'TRANSFER')::public.payment_method, 'Deposit returned at move-out');
  end if;
  update public.leases set settled_at = now(), deposit_used = use, deposit_refunded = refund where booking_id = b.id;
  perform app.refresh_booking_totals(b.id);
  perform app.log_status(b.id, b.status, b.status, format('Deposit settled: %s used, %s returned', to_char(use / 100.0, 'FM999,999,990.00'), to_char(refund / 100.0, 'FM999,999,990.00')));
  return jsonb_build_object('held', held, 'used', use, 'refund', refund, 'deductions', ded_total,
    'still_owed', (select coalesce(sum(total_amount - paid_amount), 0) from public.charge_periods where booking_id = b.id and state = 'OPEN'));
end $$;
grant execute on function public.settle_lease(jsonb) to authenticated;

-- Yearly check-in with move-in meter readings in the same transaction.
create function public.check_in_yearly(p_booking uuid, p_water numeric, p_electric numeric, p_override_reason text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking;
  if not found or b.mode <> 'YEARLY' then perform app.fail('Yearly booking not found'); end if;
  perform public.check_in(p_booking, p_override_reason);
  if p_water is not null then perform public.save_meter_reading(b.unit_id, 'WATER', app.today(), p_water, 'MOVE_IN', b.id, null, true); end if;
  if p_electric is not null then perform public.save_meter_reading(b.unit_id, 'ELECTRIC', app.today(), p_electric, 'MOVE_IN', b.id, null, true); end if;
end $$;
grant execute on function public.check_in_yearly(uuid, numeric, numeric, text) to authenticated;

-- ---------------------------------------------------------------- documents
create type public.doc_type   as enum ('INVOICE', 'RECEIPT');
create type public.doc_status as enum ('ISSUED', 'VOID');

create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  type         public.doc_type not null,
  number       text unique not null,
  property_id  uuid not null references public.properties (id) on delete restrict,
  booking_id   uuid not null references public.bookings (id) on delete restrict,
  payment_id   uuid references public.payments (id) on delete restrict,
  period_ids   uuid[] not null default '{}',
  issue_date   date not null,
  due_date     date,
  issuer       jsonb not null,     -- snapshot: who issues (business or property details)
  bill_to      jsonb not null,     -- snapshot: guest or company
  lines        jsonb not null,     -- snapshot: [{description, amount}]
  total        bigint not null,
  extra        jsonb,              -- receipt: method, reference, WHT; invoice: payment instructions
  status       public.doc_status not null default 'ISSUED',
  void_reason  text,
  issued_by    uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create unique index documents_one_receipt_per_payment on public.documents (payment_id) where type = 'RECEIPT' and status = 'ISSUED';
create index documents_property on public.documents (property_id, created_at desc);

create function app.doc_parties(b public.bookings) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'issuer', jsonb_build_object(
      'name', bs.legal_name, 'address', coalesce(bs.address, p.address), 'tax_id', bs.tax_id, 'phone', coalesce(p.phone, bs.phone),
      'property', p.name, 'property_code', p.code, 'photo_path', p.photo_path),
    'bill_to', jsonb_build_object(
      'name', case when g.is_company and g.company_name is not null then g.company_name else g.full_name end,
      'attention', case when g.is_company then g.full_name end,
      'address', g.billing_address, 'tax_id', g.tax_id, 'branch', g.branch, 'phone', g.phone, 'email', g.email,
      'unit', u.code, 'booking_code', b.code),
    'payment_instructions', p.payment_instructions)
  from public.business_settings bs, public.properties p, public.guests g, public.units u
  where p.id = b.property_id and g.id = b.guest_id and u.id = b.unit_id
$$;

-- Receipt for one payment: the periods it paid, plus any amount kept as credit.
create function public.issue_receipt(p_payment uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare pay public.payments; b public.bookings; existing public.documents; parts jsonb; lines jsonb; num text; did uuid; allocated bigint;
begin
  select * into pay from public.payments where id = p_payment;
  if not found then perform app.fail('Payment not found'); end if;
  select * into b from public.bookings where id = pay.booking_id;
  if not app.can_take_payment(b.property_id) then perform app.fail('You don''t have access to this property'); end if;
  if pay.voided_at is not null then perform app.fail('This payment is void'); end if;
  if pay.method in ('DEPOSIT', 'CREDIT') then perform app.fail('Money moved from the deposit or credit doesn''t get a receipt'); end if;
  select * into existing from public.documents where payment_id = pay.id and type = 'RECEIPT' and status = 'ISSUED';
  if found then return jsonb_build_object('id', existing.id, 'number', existing.number, 'existing', true); end if;

  select coalesce(jsonb_agg(jsonb_build_object('description', case when cp.seq = 0 then 'Deposit and move-in' when cp.kind = 'RENT' then 'Rent ' || cp.label else cp.label end
           || case when pa.amount < cp.total_amount then ' (part payment)' else '' end, 'amount', pa.amount) order by cp.due_date, cp.seq), '[]'),
         coalesce(sum(pa.amount), 0)
    into lines, allocated
  from public.payment_allocations pa join public.charge_periods cp on cp.id = pa.period_id where pa.payment_id = pay.id;
  if pay.amount + pay.wht_amount > allocated then
    lines := lines || jsonb_build_object('description', 'Kept as credit for future charges', 'amount', pay.amount + pay.wht_amount - allocated);
  end if;
  parts := app.doc_parties(b);
  num := app.next_doc_no(b.property_id, 'RC', 5);
  insert into public.documents (type, number, property_id, booking_id, payment_id, period_ids, issue_date, issuer, bill_to, lines, total, extra)
  values ('RECEIPT', num, b.property_id, b.id, pay.id,
    array(select period_id from public.payment_allocations where payment_id = pay.id), pay.paid_at,
    parts -> 'issuer', parts -> 'bill_to', lines, pay.amount + pay.wht_amount,
    jsonb_build_object('method', pay.method, 'reference', pay.reference, 'wht_amount', pay.wht_amount, 'wht_cert_no', pay.wht_cert_no, 'received', pay.amount,
      'balance_after', (select coalesce(sum(total_amount - paid_amount), 0) from public.charge_periods where booking_id = b.id and state = 'OPEN')))
  returning id into did;
  return jsonb_build_object('id', did, 'number', num);
end $$;
grant execute on function public.issue_receipt(uuid) to authenticated;

-- Invoice for chosen open periods (or, if none given, everything due up to p_until).
create function public.issue_invoice(p_booking uuid, p_period_ids uuid[] default null, p_until date default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; ids uuid[]; lines jsonb; total bigint; parts jsonb; num text; did uuid; due date;
begin
  select * into b from public.bookings where id = p_booking;
  if not found then perform app.fail('Booking not found'); end if;
  if not app.can_take_payment(b.property_id) then perform app.fail('You don''t have access to this property'); end if;
  if b.status in ('CANCELLED', 'EXPIRED', 'NO_SHOW') then perform app.fail('Nothing to invoice on this booking'); end if;
  select array_agg(id order by due_date, seq) into ids from public.charge_periods
  where booking_id = b.id and state = 'OPEN' and paid_amount < total_amount
    and (case when p_period_ids is not null and cardinality(p_period_ids) > 0 then id = any (p_period_ids) else due_date <= coalesce(p_until, app.today() + 7) end);
  if ids is null then perform app.fail('Nothing is owed for those periods'); end if;

  select jsonb_agg(x.line order by x.due_date, x.seq, x.ord), sum(x.amt) into lines, total from (
    select cp.due_date, cp.seq, cl.ord,
      jsonb_build_object('description', case when cp.seq = 0 then 'Deposit and move-in · ' else '' end || cl.description, 'amount', cl.amount, 'period', cp.label) as line, cl.amount as amt
    from public.charge_periods cp
    join lateral (select row_number() over (order by case charge_type when 'RENT' then 0 when 'NIGHTLY' then 1 when 'DEPOSIT' then 2 else 3 end, description) as ord, description, amount
                  from public.charge_lines where period_id = cp.id) cl on true
    where cp.id = any (ids)
    union all
    select cp.due_date, cp.seq, 999, jsonb_build_object('description', 'Already paid · ' || cp.label, 'amount', -cp.paid_amount, 'period', cp.label), -cp.paid_amount
    from public.charge_periods cp where cp.id = any (ids) and cp.paid_amount > 0
  ) x;
  select min(due_date) into due from public.charge_periods where id = any (ids);
  parts := app.doc_parties(b);
  num := app.next_doc_no(b.property_id, 'INV', 5);
  insert into public.documents (type, number, property_id, booking_id, period_ids, issue_date, due_date, issuer, bill_to, lines, total, extra)
  values ('INVOICE', num, b.property_id, b.id, ids, app.today(), greatest(due, app.today()), parts -> 'issuer', parts -> 'bill_to', lines, total,
    jsonb_build_object('payment_instructions', parts ->> 'payment_instructions', 'stay', jsonb_build_object('check_in', b.check_in, 'check_out', b.check_out, 'mode', b.mode)))
  returning id into did;
  return jsonb_build_object('id', did, 'number', num);
end $$;
grant execute on function public.issue_invoice(uuid, uuid[], date) to authenticated;

create function public.void_document(p_document uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.documents;
begin
  select * into d from public.documents where id = p_document for update;
  if not found then perform app.fail('Document not found'); end if;
  if not (app.has_role('ADMIN', 'MANAGER', 'ACCOUNTANT') and app.can_access_property(d.property_id)) then
    perform app.fail('Only managers and accountants can void documents');
  end if;
  if d.status = 'VOID' then perform app.fail('Already void'); end if;
  if coalesce(trim(p_reason), '') = '' then perform app.fail('Give a reason'); end if;
  update public.documents set status = 'VOID', void_reason = trim(p_reason) where id = d.id;
end $$;
grant execute on function public.void_document(uuid, text) to authenticated;

-- Voiding a payment voids its receipt too.
create function app.void_receipt_with_payment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.voided_at is not null and old.voided_at is null then
    update public.documents set status = 'VOID', void_reason = 'Payment voided: ' || coalesce(new.void_reason, '')
    where payment_id = new.id and type = 'RECEIPT' and status = 'ISSUED';
  end if;
  return new;
end $$;
create trigger payments_void_receipt after update of voided_at on public.payments
  for each row execute function app.void_receipt_with_payment();

-- ---------------------------------------------------------------- row level security
alter table public.meter_readings enable row level security;
alter table public.documents      enable row level security;
create policy readings_read on public.meter_readings for select to authenticated using (app.can_access_property(property_id));
create policy documents_read on public.documents for select to authenticated using (app.can_access_property(property_id));
grant select on public.meter_readings, public.documents to authenticated;
revoke insert, update, delete on public.meter_readings, public.documents from authenticated;

-- ============================================================
-- 20261029000200_sprint3_storage.sql
-- ============================================================
-- Private bucket for meter photos. Files live at "<property_id>/<unit_id>/<date>-<utility>-<n>.jpg".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meter-photos', 'meter-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "meter photos read" on storage.objects for select to authenticated
  using (bucket_id = 'meter-photos' and app.can_access_property(((storage.foldername(name))[1])::uuid));

create policy "meter photos write" on storage.objects for insert to authenticated
  with check (bucket_id = 'meter-photos' and app.can_book(((storage.foldername(name))[1])::uuid));

-- ============================================================
-- 20261029000300_auth_hook_grants.sql
-- ============================================================
-- Supabase Auth runs hooks as supabase_auth_admin; it needs to see the public schema
-- to call public.hook_before_user_created. Nobody else may call the hook directly.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
    grant select on public.team_members to supabase_auth_admin;
  end if;
end $$;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;

-- ============================================================
-- 20261030000100_backdated_bookings.sql
-- ============================================================
-- Allow bookings that start in the past (existing tenants, stays entered after the fact).
-- Safe to run on a database that already has the earlier migrations: it only replaces create_booking.

create or replace function public.create_booking(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  existing public.bookings; q jsonb; u public.units; gid uuid; bid uuid; bcode text; per jsonb; pid uuid; l jsonb;
  disc bigint := coalesce((p ->> 'discount')::bigint, 0); limit_pct numeric; gross bigint; v_hold_hours int;
  pay_by timestamptz; arrival timestamptz; prop public.properties; pol jsonb; backdated boolean; ended boolean;
begin
  if p ? 'idempotency_key' then
    select * into existing from public.bookings where idempotency_key = p ->> 'idempotency_key';
    if found then return jsonb_build_object('id', existing.id, 'code', existing.code, 'duplicate', true); end if;
  end if;

  select * into u from public.units where id = (p ->> 'unit_id')::uuid;
  if not found then perform app.fail('Unit not found'); end if;
  if not app.can_book(u.property_id) then perform app.fail('You don''t have permission to make bookings here'); end if;
  select * into prop from public.properties where id = u.property_id;
  if prop.status <> 'ACTIVE' then perform app.fail('This property isn''t open for bookings yet'); end if;
  if u.status <> 'ACTIVE' then perform app.fail(format('Unit %s is %s', u.code, lower(u.status::text))); end if;

  perform public.expire_holds();

  q := public.quote_booking(u.id, (p ->> 'mode')::public.rental_mode, (p ->> 'start')::date, (p ->> 'end')::date,
         coalesce((p ->> 'years')::int, 1), coalesce((p ->> 'adults')::int, 1), coalesce((p ->> 'children')::int, 0),
         coalesce(p -> 'extras', '[]'), disc);

  -- Back-dated entries (existing tenants, past stays) skip the reservation step:
  -- a stay already under way is saved as confirmed, a stay that has ended as checked out.
  backdated := (q ->> 'start')::date < app.today();
  ended := (q ->> 'end')::date <= app.today();

  -- Front desk discounts are capped by the business setting; bigger ones need a manager.
  if disc > 0 then
    if coalesce(trim(p ->> 'discount_reason'), '') = '' then perform app.fail('Give a reason for the discount'); end if;
    if app.current_role() = 'FRONT_DESK' then
      select front_desk_discount_limit_pct into limit_pct from public.business_settings;
      gross := (q ->> 'gross')::bigint;
      if gross > 0 and (q ->> 'gross')::bigint - (q ->> 'total')::bigint > gross * limit_pct / 100 then
        perform app.fail(format('Front desk can give at most %s%% off. Ask a manager.', trim(to_char(limit_pct, 'FM990.##'))));
      end if;
    end if;
  end if;

  -- Guest: existing or new.
  if p ? 'guest_id' and nullif(p ->> 'guest_id', '') is not null then
    gid := (p ->> 'guest_id')::uuid;
    if not exists (select 1 from public.guests where id = gid) then perform app.fail('Guest not found'); end if;
  else
    if coalesce(trim(p -> 'guest' ->> 'full_name'), '') = '' then perform app.fail('Enter the guest''s name'); end if;
    insert into public.guests (full_name, phone, email, line_id, nationality, is_company, company_name, tax_id, branch, billing_address)
    values (trim(p -> 'guest' ->> 'full_name'), nullif(trim(p -> 'guest' ->> 'phone'), ''), nullif(trim(p -> 'guest' ->> 'email'), ''),
            nullif(trim(p -> 'guest' ->> 'line_id'), ''), nullif(trim(p -> 'guest' ->> 'nationality'), ''),
            coalesce((p -> 'guest' ->> 'is_company')::boolean, false), nullif(trim(p -> 'guest' ->> 'company_name'), ''),
            nullif(trim(p -> 'guest' ->> 'tax_id'), ''), nullif(trim(p -> 'guest' ->> 'branch'), ''), nullif(trim(p -> 'guest' ->> 'billing_address'), ''))
    returning id into gid;
  end if;

  -- Pay-by: daily = check-in time on arrival day; yearly = hold window, but never after move-in. Staff may set an earlier time.
  arrival := ((q ->> 'start')::date + prop.check_in_time) at time zone 'Asia/Bangkok';
  select bs.hold_hours into v_hold_hours from public.business_settings bs;
  -- Same-day walk-ins booked after check-in time still get an hour to pay.
  pay_by := case when q ->> 'mode' = 'DAILY' then greatest(arrival, now() + interval '1 hour')
                 else greatest(least(now() + make_interval(hours => v_hold_hours), arrival), now() + interval '1 hour') end;
  if nullif(p ->> 'pay_by', '') is not null and not backdated then
    if (p ->> 'pay_by')::timestamptz <= now() then perform app.fail('Pay-by time must be in the future'); end if;
    pay_by := least(pay_by, (p ->> 'pay_by')::timestamptz);
  end if;

  select to_jsonb(cp) into pol from public.cancellation_policies cp where id = (q ->> 'policy_id')::uuid;
  -- Finished stays are outside the overlap constraint, so check them here (matters for back-dated entries).
  if exists (select 1 from public.bookings x where x.unit_id = u.id and x.status = 'CHECKED_OUT'
             and x.stay && daterange((q ->> 'start')::date, (q ->> 'end')::date)) then
    perform app.fail(format('Unit %s already has a stay in these dates. Choose another unit or dates.', u.code));
  end if;

  bcode := app.next_doc_no(u.property_id, 'BK');

  begin
    insert into public.bookings (code, property_id, unit_id, kind, mode, status, stay, guest_id, adults, children, rate_plan_id,
      price_snapshot, policy_snapshot, hold_expires_at, source, note, idempotency_key)
    values (bcode, u.property_id, u.id, 'RESERVATION', (q ->> 'mode')::public.rental_mode, case when backdated then 'CONFIRMED'::public.booking_status else 'HOLD'::public.booking_status end,
      daterange((q ->> 'start')::date, (q ->> 'end')::date), gid, coalesce((p ->> 'adults')::int, 1), coalesce((p ->> 'children')::int, 0),
      (q ->> 'rate_plan_id')::uuid, q - 'periods' || jsonb_build_object('discount_reason', p ->> 'discount_reason', 'backdated', backdated), pol, case when backdated then null else pay_by end,
      coalesce(nullif(p ->> 'source', ''), 'DIRECT'), nullif(trim(p ->> 'note'), ''), p ->> 'idempotency_key')
    returning id into bid;
  exception when exclusion_violation then
    perform app.fail(format('Unit %s already has a booking in these dates (it may have just been taken). Choose another unit or dates.', u.code));
  end;

  for per in select * from jsonb_array_elements(q -> 'periods') loop
    insert into public.charge_periods (booking_id, seq, kind, label, period, due_date, total_amount)
    values (bid, (per ->> 'seq')::int, (per ->> 'kind')::public.period_kind, per ->> 'label',
            case when per ->> 'start' is not null then daterange((per ->> 'start')::date, (per ->> 'end')::date) end,
            (per ->> 'due_date')::date, (per ->> 'total')::bigint)
    returning id into pid;
    for l in select * from jsonb_array_elements(per -> 'lines') loop
      insert into public.charge_lines (period_id, charge_type, description, quantity, unit_price, amount, meta)
      values (pid, l ->> 'charge_type', l ->> 'description', (l ->> 'quantity')::numeric, (l ->> 'unit_price')::bigint, (l ->> 'amount')::bigint, l -> 'meta');
    end loop;
  end loop;

  if q ->> 'mode' = 'YEARLY' then
    insert into public.leases (booking_id, start_date, end_date, rent_amount, deposit_amount, deposit_months, advance_months)
    values (bid, (q ->> 'start')::date, (q ->> 'end')::date, (q ->> 'rent')::bigint,
            round(coalesce((q ->> 'deposit_months')::numeric, 0) * ((q ->> 'rent')::bigint + disc))::bigint,
            coalesce((q ->> 'deposit_months')::numeric, 0), coalesce((q ->> 'advance_months')::int, 0));
  end if;

  perform app.refresh_booking_totals(bid);
  if not backdated then
    perform app.log_status(bid, null, 'HOLD', 'Reserved');
  elsif ended then
    -- Overlap was checked on insert (as confirmed); now record it as a finished stay.
    update public.bookings set status = 'CHECKED_OUT' where id = bid;
    perform app.log_status(bid, null, 'CHECKED_OUT', 'Back-dated: past stay');
  else
    perform app.log_status(bid, null, 'CONFIRMED', 'Back-dated: stay already under way');
  end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id, after) values (auth.uid(), 'booking.create', 'booking', bid::text, p - 'idempotency_key');
  return jsonb_build_object('id', bid, 'code', bcode, 'pay_by', case when backdated then null else pay_by end, 'backdated', backdated,
    'total', q -> 'total', 'due_now', q -> 'due_now');
end $$;
grant execute on function public.create_booking(jsonb) to authenticated;

-- ============================================================
-- 20261031000100_corrections.sql
-- ============================================================
-- Corrections: change past data safely.
-- Every correction needs a reason and is written to the booking's history (who, what, when).
-- Money rules after any change: a period's paid amount never exceeds its total; any excess
-- becomes credit on the booking. Changes to money or past status need a manager or admin.

-- ---------------------------------------------------------------- helpers
create or replace function app.require_editor(pid uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (app.has_role('ADMIN', 'MANAGER') and app.can_access_property(pid)) then
    perform app.fail('Only managers and admins can correct this. Ask a manager.');
  end if;
end $$;

create or replace function app.require_reason(r text) returns text language plpgsql as $$
begin
  if coalesce(trim(r), '') = '' then perform app.fail('Give a reason for the change'); end if;
  return trim(r);
end $$;

-- Date a period became fully paid = latest date among the live payments that paid it.
create or replace function app.recalc_paid_at(p_period uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.charge_periods cp set paid_at = case when cp.paid_amount >= cp.total_amount and cp.total_amount > 0 then (
      select max(pm.paid_at) from public.payment_allocations pa join public.payments pm on pm.id = pa.payment_id
      where pa.period_id = cp.id and pm.voided_at is null) end
  where cp.id = p_period;
$$;

-- Recomputes a period's total from its lines; money paid beyond the new total moves to booking credit
-- (newest allocations are reduced first).
create or replace function app.recalc_period(p_period uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare cp public.charge_periods; excess bigint; a record; take bigint;
begin
  update public.charge_periods set total_amount = coalesce((select sum(amount) from public.charge_lines where period_id = p_period), 0)
  where id = p_period returning * into cp;
  excess := cp.paid_amount - greatest(cp.total_amount, 0);
  if excess > 0 then
    for a in select pa.* from public.payment_allocations pa join public.payments pm on pm.id = pa.payment_id
             where pa.period_id = p_period order by pm.paid_at desc, pm.recorded_at desc loop
      exit when excess <= 0;
      take := least(excess, a.amount);
      if take = a.amount then delete from public.payment_allocations where payment_id = a.payment_id and period_id = a.period_id;
      else update public.payment_allocations set amount = amount - take where payment_id = a.payment_id and period_id = a.period_id;
      end if;
      excess := excess - take;
      update public.charge_periods set paid_amount = paid_amount - take where id = p_period;
      update public.bookings set credit_balance = credit_balance + take where id = cp.booking_id;
    end loop;
  end if;
  perform app.recalc_paid_at(p_period);
  perform app.refresh_booking_totals(cp.booking_id);
end $$;

-- Moves every allocation of one period onto another (used when periods are merged).
create or replace function app.move_allocations(p_from uuid, p_to uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a record; moved bigint := 0;
begin
  for a in select * from public.payment_allocations where period_id = p_from loop
    insert into public.payment_allocations (payment_id, period_id, amount) values (a.payment_id, p_to, a.amount)
    on conflict (payment_id, period_id) do update set amount = public.payment_allocations.amount + excluded.amount;
    moved := moved + a.amount;
  end loop;
  delete from public.payment_allocations where period_id = p_from;
  update public.charge_periods set paid_amount = paid_amount - moved where id = p_from;
  update public.charge_periods set paid_amount = paid_amount + moved where id = p_to;
end $$;

-- Overlap with any other stay that occupies the unit (live or finished).
create or replace function app.assert_free(p_unit uuid, p_start date, p_end date, p_except uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare code text;
begin
  select u.code into code from public.units u where u.id = p_unit;
  if exists (select 1 from public.bookings x where x.unit_id = p_unit and x.id <> p_except
             and x.status in ('HOLD', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT') and x.stay && daterange(p_start, p_end)) then
    perform app.fail(format('Unit %s already has another booking in these dates', code));
  end if;
end $$;

create or replace function app.log_edit(bid uuid, what text, before jsonb, after jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.booking_status;
begin
  select status into s from public.bookings where id = bid;
  perform app.log_status(bid, s, s, what);
  insert into public.audit_logs (actor_id, action, entity, entity_id, before, after) values (auth.uid(), 'booking.edit', 'booking', bid::text, before, after);
end $$;

-- Same as before, but safe when nothing is owed (the unused credit payment is removed before its amount is set),
-- and the booking's totals are refreshed.
create or replace function app.apply_credit(bid uuid) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; pay_id uuid; left_over bigint;
begin
  select * into b from public.bookings where id = bid for update;
  if b.credit_balance <= 0 then return 0; end if;
  insert into public.payments (booking_id, amount, paid_at, method, note)
  values (b.id, b.credit_balance, app.today(), 'CREDIT', 'Credit from earlier overpayment') returning id into pay_id;
  left_over := app.allocate(pay_id, b.id, b.credit_balance, null, app.today());
  if b.credit_balance - left_over = 0 then
    delete from public.payments where id = pay_id;
  else
    -- The credit is not new money: record only what was used, keep the rest as credit.
    update public.payments set amount = b.credit_balance - left_over where id = pay_id;
  end if;
  update public.bookings set credit_balance = left_over where id = b.id;
  perform app.refresh_booking_totals(b.id);
  return b.credit_balance - left_over;
end $$;

-- ---------------------------------------------------------------- booking details
-- p: { adults, children, note, source }   (guest details are edited on the guest row directly)
create or replace function public.update_booking_info(p_booking uuid, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; maxocc int;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then perform app.fail('Booking not found'); end if;
  if not app.can_book(b.property_id) then perform app.fail('You don''t have permission here'); end if;
  select rt.max_occupancy into maxocc from public.units u join public.room_types rt on rt.id = u.room_type_id where u.id = b.unit_id;
  if coalesce((p ->> 'adults')::int, b.adults) + coalesce((p ->> 'children')::int, b.children) > maxocc then
    perform app.fail(format('This room takes at most %s guests', maxocc));
  end if;
  update public.bookings set
    adults = coalesce((p ->> 'adults')::int, adults),
    children = coalesce((p ->> 'children')::int, children),
    note = case when p ? 'note' then nullif(trim(p ->> 'note'), '') else note end,
    source = coalesce(nullif(p ->> 'source', ''), source)
  where id = b.id;
  perform app.log_edit(b.id, 'Details edited', jsonb_build_object('adults', b.adults, 'children', b.children, 'note', b.note, 'source', b.source), p);
end $$;
grant execute on function public.update_booking_info(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- daily: change dates / unit
-- Re-prices the nights at the new unit's daily rate. Extra-night periods are merged into the stay.
-- Fees and discounts already on the stay are kept. Paying beyond the new total becomes credit.
create or replace function public.change_daily_stay(p_booking uuid, p_unit uuid, p_start date, p_end date, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; u public.units; rt public.room_types; rp public.rate_plans; prop public.properties;
  main uuid; x record; d date; price bigint; why text; old_total bigint; new_total bigint;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.mode <> 'DAILY' then perform app.fail('Daily booking not found'); end if;
  if b.status not in ('HOLD', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT') then perform app.fail('Reopen this booking first'); end if;
  if b.status in ('CHECKED_IN', 'CHECKED_OUT') or b.check_in < app.today() or p_start < app.today() then
    perform app.require_editor(b.property_id);
  elsif not app.can_book(b.property_id) then perform app.fail('You don''t have permission here');
  end if;
  why := app.require_reason(p_reason);
  if p_end <= p_start then perform app.fail('Check-out must be after check-in'); end if;
  select * into u from public.units where id = p_unit and property_id = b.property_id;
  if not found then perform app.fail('Unit not found in this property'); end if;
  if not ('DAILY' = any (u.allowed_modes)) then perform app.fail(format('Unit %s is not rented daily', u.code)); end if;
  select * into rt from public.room_types where id = u.room_type_id;
  if b.adults + b.children > rt.max_occupancy then perform app.fail(format('%s takes at most %s guests', rt.name, rt.max_occupancy)); end if;
  select * into rp from public.rate_plans where room_type_id = rt.id and mode = 'DAILY';
  if not found then perform app.fail(format('No daily rate set for %s', rt.name)); end if;
  perform app.assert_free(u.id, p_start, p_end, b.id);
  select * into prop from public.properties where id = b.property_id;
  old_total := b.total_amount;

  -- 1. Merge every STAY period into the first one.
  select id into main from public.charge_periods where booking_id = b.id and kind = 'STAY' order by seq limit 1;
  for x in select id from public.charge_periods where booking_id = b.id and kind = 'STAY' and id <> main loop
    perform app.move_allocations(x.id, main);
    update public.charge_lines set period_id = main where period_id = x.id and charge_type <> 'NIGHTLY';
    delete from public.charge_periods where id = x.id;
  end loop;
  -- 2. Replace the nights.
  delete from public.charge_lines where period_id = main and charge_type = 'NIGHTLY';
  for d in select generate_series(p_start, p_end - 1, interval '1 day')::date loop
    price := case when extract(isodow from d) in (5, 6) and rp.weekend_amount is not null then rp.weekend_amount else rp.base_amount end;
    insert into public.charge_lines (period_id, charge_type, description, quantity, unit_price, amount, meta)
    values (main, 'NIGHTLY', to_char(d, 'Dy DD Mon') || case when price <> rp.base_amount then ' · weekend rate' else '' end, 1, price, price, jsonb_build_object('date', d));
  end loop;
  update public.charge_periods set label = format('Stay %s – %s', to_char(p_start, 'DD Mon'), to_char(p_end, 'DD Mon YYYY')),
    period = daterange(p_start, p_end), due_date = p_start, state = case when state = 'CANCELLED' then 'OPEN'::public.period_state else state end
  where id = main;
  -- 3. Move the stay.
  update public.bookings set unit_id = u.id, stay = daterange(p_start, p_end), rate_plan_id = rp.id,
    price_snapshot = coalesce(price_snapshot, '{}') || jsonb_build_object('start', p_start, 'end', p_end, 'nights', p_end - p_start, 'unit_code', u.code),
    hold_expires_at = case when status = 'HOLD' then greatest((p_start + prop.check_in_time) at time zone 'Asia/Bangkok', now() + interval '1 hour') else hold_expires_at end
  where id = b.id;
  perform app.recalc_period(main);
  perform app.apply_credit(b.id);
  select total_amount into new_total from public.bookings where id = b.id;
  perform app.log_edit(b.id, format('Stay changed to unit %s, %s – %s: %s', u.code, to_char(p_start, 'DD Mon YYYY'), to_char(p_end, 'DD Mon YYYY'), why),
    jsonb_build_object('unit_id', b.unit_id, 'start', b.check_in, 'end', b.check_out, 'total', old_total),
    jsonb_build_object('unit_id', u.id, 'start', p_start, 'end', p_end, 'total', new_total));
  return jsonb_build_object('total', new_total, 'difference', new_total - old_total);
end $$;
grant execute on function public.change_daily_stay(uuid, uuid, date, date, text) to authenticated;

-- ---------------------------------------------------------------- yearly: change lease
-- p: { unit_id, start, months, rent, rent_from, reason }  (any omitted field is unchanged)
--   start  : only while no rent has been paid (rent periods are rebuilt from the new date)
--   months : lease length; unpaid months beyond the new end are removed, new months are added
--   rent   : new monthly rent for unpaid months starting on or after rent_from
create or replace function public.change_lease(p_booking uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; le public.leases; why text; new_unit uuid; new_start date; months int; old_months int; new_end date;
  rent bigint; rent_from date; k int; ps date; pe date; nseq int; pid uuid; skipped int := 0; x record; u public.units;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.mode <> 'YEARLY' then perform app.fail('Yearly booking not found'); end if;
  if b.status not in ('HOLD', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT') then perform app.fail('Reopen this booking first'); end if;
  perform app.require_editor(b.property_id);
  why := app.require_reason(p ->> 'reason');
  select * into le from public.leases where booking_id = b.id for update;
  if le.settled_at is not null then perform app.fail('The deposit is already settled; this lease is closed'); end if;

  new_unit := coalesce((p ->> 'unit_id')::uuid, b.unit_id);
  new_start := coalesce((p ->> 'start')::date, le.start_date);
  old_months := (extract(year from age(le.end_date, le.start_date)) * 12 + extract(month from age(le.end_date, le.start_date)))::int;
  if (le.start_date + make_interval(months => old_months))::date < le.end_date then old_months := old_months + 1; end if;
  months := coalesce((p ->> 'months')::int, old_months);
  if months < 1 or months > 120 then perform app.fail('Lease length must be 1 to 120 months'); end if;
  new_end := (new_start + make_interval(months => months))::date;
  rent := coalesce((p ->> 'rent')::bigint, le.rent_amount);
  if rent <= 0 then perform app.fail('Rent must be more than 0'); end if;
  rent_from := coalesce((p ->> 'rent_from')::date, new_start);

  if new_unit <> b.unit_id then
    select * into u from public.units where id = new_unit and property_id = b.property_id;
    if not found or not ('YEARLY' = any (u.allowed_modes)) then perform app.fail('Choose a unit of this property that is rented yearly'); end if;
  end if;
  perform app.assert_free(new_unit, new_start, new_end, b.id);

  -- Move-in date changed: rebuild the rent schedule (only possible while no rent is paid).
  if new_start <> le.start_date then
    if exists (select 1 from public.charge_periods where booking_id = b.id and kind = 'RENT' and paid_amount > 0) then
      perform app.fail('Rent has been paid on this lease. Void those rent payments first, or keep the move-in date.');
    end if;
    delete from public.charge_periods where booking_id = b.id and kind = 'RENT';
    update public.charge_periods set due_date = new_start where booking_id = b.id and kind = 'MOVE_IN';
    old_months := 0;
  end if;

  -- Shorter lease: remove unpaid months that start on or after the new end.
  for x in select * from public.charge_periods where booking_id = b.id and kind = 'RENT' and lower(period) >= new_end loop
    if x.paid_amount > 0 then perform app.fail(format('Rent for %s is already paid. Void that payment first, or keep a longer lease.', x.label)); end if;
    delete from public.charge_periods where id = x.id;
  end loop;

  -- Longer lease (or rebuilt schedule): add the missing months.
  for k in 1..months loop
    ps := (new_start + make_interval(months => k - 1))::date;
    pe := (new_start + make_interval(months => k))::date;
    if not exists (select 1 from public.charge_periods where booking_id = b.id and kind = 'RENT' and lower(period) = ps) then
      select coalesce(max(seq), 0) + 1 into nseq from public.charge_periods where booking_id = b.id;
      insert into public.charge_periods (booking_id, seq, kind, label, period, due_date, total_amount)
      values (b.id, nseq, 'RENT', format('%s – %s', to_char(ps, 'DD Mon'), to_char(pe, 'DD Mon YYYY')), daterange(ps, pe),
              case when k <= le.advance_months then new_start else ps end, 0)
      returning id into pid;
      insert into public.charge_lines (period_id, charge_type, description, quantity, unit_price, amount, meta)
      values (pid, 'RENT', format('Rent %s – %s', to_char(ps, 'DD Mon'), to_char(pe, 'DD Mon YYYY')), 1,
              case when ps >= rent_from then rent else le.rent_amount end, case when ps >= rent_from then rent else le.rent_amount end,
              jsonb_build_object('list_price', rent));
      perform app.recalc_period(pid);
    end if;
  end loop;

  -- New rent for unpaid months from rent_from.
  if rent <> le.rent_amount then
    for x in select cp.id, cp.paid_amount from public.charge_periods cp where cp.booking_id = b.id and cp.kind = 'RENT' and lower(cp.period) >= rent_from loop
      if x.paid_amount > 0 then skipped := skipped + 1; continue; end if;
      update public.charge_lines set unit_price = rent, amount = rent where period_id = x.id and charge_type = 'RENT';
      perform app.recalc_period(x.id);
    end loop;
  end if;

  update public.leases set start_date = new_start, end_date = new_end, rent_amount = rent where booking_id = b.id;
  update public.bookings set unit_id = new_unit,
    stay = daterange(new_start, case when status = 'CHECKED_OUT' and check_out < new_end then check_out else new_end end)
  where id = b.id;
  perform app.refresh_booking_totals(b.id);
  perform app.apply_credit(b.id);
  perform app.log_edit(b.id, format('Lease changed (%s): %s', concat_ws(', ',
      case when new_unit <> b.unit_id then 'unit' end, case when new_start <> le.start_date then 'move-in date' end,
      case when new_end <> le.end_date then 'length' end, case when rent <> le.rent_amount then 'rent' end), why),
    to_jsonb(le), jsonb_build_object('unit_id', new_unit, 'start', new_start, 'end', new_end, 'rent', rent, 'rent_from', rent_from));
  return jsonb_build_object('end', new_end, 'skipped_paid_months', skipped);
end $$;
grant execute on function public.change_lease(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- charges
-- Adds a charge (positive) or a discount (negative) to a period, or to a new period when p_period is null.
create or replace function public.add_charge(p_booking uuid, p_period uuid, p_description text, p_amount bigint, p_due date, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; pid uuid := p_period; nseq int;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.kind <> 'RESERVATION' then perform app.fail('Booking not found'); end if;
  if coalesce(p_amount, 0) = 0 then perform app.fail('Enter an amount'); end if;
  if coalesce(trim(p_description), '') = '' then perform app.fail('Describe the charge'); end if;
  if p_amount < 0 or b.status in ('CHECKED_OUT', 'CANCELLED', 'EXPIRED', 'NO_SHOW') then perform app.require_editor(b.property_id);
  elsif not app.can_book(b.property_id) then perform app.fail('You don''t have permission here');
  end if;
  if pid is null then
    select coalesce(max(seq), 0) + 1 into nseq from public.charge_periods where booking_id = b.id;
    insert into public.charge_periods (booking_id, seq, kind, label, due_date, total_amount)
    values (b.id, nseq, 'ADJUSTMENT', trim(p_description), coalesce(p_due, app.today()), 0) returning id into pid;
  elsif not exists (select 1 from public.charge_periods where id = pid and booking_id = b.id and state = 'OPEN') then
    perform app.fail('Choose an open period of this booking');
  end if;
  insert into public.charge_lines (period_id, charge_type, description, quantity, unit_price, amount, meta)
  values (pid, case when p_amount < 0 then 'DISCOUNT' else 'FEE' end, trim(p_description), 1, p_amount, p_amount, jsonb_build_object('reason', nullif(trim(p_reason), '')));
  perform app.recalc_period(pid);
  if p_amount > 0 then perform app.apply_credit(b.id); end if;
  perform app.log_edit(b.id, format('%s %s: %s', case when p_amount < 0 then 'Discount' else 'Charge' end, to_char(abs(p_amount) / 100.0, 'FM999,999,990.00'), trim(p_description)), null,
    jsonb_build_object('period_id', pid, 'amount', p_amount, 'description', p_description, 'reason', p_reason));
end $$;
grant execute on function public.add_charge(uuid, uuid, text, bigint, date, text) to authenticated;

create or replace function public.remove_charge(p_line uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.charge_lines; cp public.charge_periods; b public.bookings; why text;
begin
  select * into l from public.charge_lines where id = p_line;
  if not found then perform app.fail('Charge not found'); end if;
  select * into cp from public.charge_periods where id = l.period_id;
  select * into b from public.bookings where id = cp.booking_id for update;
  perform app.require_editor(b.property_id);
  why := app.require_reason(p_reason);
  if l.charge_type in ('WATER', 'ELECTRIC') then
    update public.meter_readings set billed_line_id = null where billed_line_id = l.id;
  end if;
  delete from public.charge_lines where id = l.id;
  perform app.recalc_period(cp.id);
  -- An adjustment left with nothing on it and nothing paid disappears.
  delete from public.charge_periods where id = cp.id and kind = 'ADJUSTMENT' and paid_amount = 0
    and not exists (select 1 from public.charge_lines where period_id = cp.id);
  perform app.refresh_booking_totals(b.id);
  perform app.log_edit(b.id, format('Removed "%s" (%s): %s', l.description, to_char(l.amount / 100.0, 'FM999,999,990.00'), why), to_jsonb(l), null);
end $$;
grant execute on function public.remove_charge(uuid, text) to authenticated;

-- Changes a period's due date, or waives / reopens it.
-- p: { due_date, waive (true/false), reason }
create or replace function public.update_period(p_period uuid, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare cp public.charge_periods; b public.bookings; why text;
begin
  select * into cp from public.charge_periods where id = p_period for update;
  if not found then perform app.fail('Period not found'); end if;
  select * into b from public.bookings where id = cp.booking_id;
  perform app.require_editor(b.property_id);
  why := app.require_reason(p ->> 'reason');
  if p ? 'due_date' and nullif(p ->> 'due_date', '') is not null then
    update public.charge_periods set due_date = (p ->> 'due_date')::date where id = cp.id;
  end if;
  if (p ->> 'waive') = 'true' then
    if cp.state <> 'OPEN' then perform app.fail('Only open periods can be waived'); end if;
    update public.charge_periods set state = 'WAIVED', note = why where id = cp.id;
  elsif (p ->> 'waive') = 'false' and cp.state in ('WAIVED', 'CANCELLED') then
    update public.charge_periods set state = 'OPEN', note = null where id = cp.id;
  end if;
  perform app.refresh_booking_totals(b.id);
  perform app.log_edit(b.id, format('%s: %s', cp.label, why), to_jsonb(cp), p - 'reason');
end $$;
grant execute on function public.update_period(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- payments
-- Changes date, method, reference or note of a payment. A receipt already issued is replaced.
-- (To change the amount, void the payment and record it again.)
create or replace function public.edit_payment(p_payment uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare pay public.payments; b public.bookings; why text; a record; had_receipt boolean; rc jsonb;
begin
  select * into pay from public.payments where id = p_payment for update;
  if not found then perform app.fail('Payment not found'); end if;
  if pay.voided_at is not null then perform app.fail('This payment is void'); end if;
  if pay.method in ('DEPOSIT', 'CREDIT') then perform app.fail('Moves from deposit or credit can''t be edited'); end if;
  select * into b from public.bookings where id = pay.booking_id;
  if not (app.has_role('ADMIN', 'MANAGER', 'ACCOUNTANT') and app.can_access_property(b.property_id)) then
    perform app.fail('Only managers and accountants can edit payments');
  end if;
  why := app.require_reason(p ->> 'reason');
  if coalesce((p ->> 'paid_at')::date, pay.paid_at) > app.today() then perform app.fail('Payment date can''t be in the future'); end if;
  update public.payments set
    paid_at = coalesce((p ->> 'paid_at')::date, paid_at),
    method = coalesce(nullif(p ->> 'method', '')::public.payment_method, method),
    reference = case when p ? 'reference' then nullif(trim(p ->> 'reference'), '') else reference end,
    note = case when p ? 'note' then nullif(trim(p ->> 'note'), '') else note end,
    wht_cert_no = case when p ? 'wht_cert_no' then nullif(trim(p ->> 'wht_cert_no'), '') else wht_cert_no end
  where id = pay.id;
  for a in select period_id from public.payment_allocations where payment_id = pay.id loop
    perform app.recalc_paid_at(a.period_id);
  end loop;
  select exists (select 1 from public.documents where payment_id = pay.id and type = 'RECEIPT' and status = 'ISSUED') into had_receipt;
  if had_receipt then
    update public.documents set status = 'VOID', void_reason = 'Replaced after payment was edited: ' || why
    where payment_id = pay.id and type = 'RECEIPT' and status = 'ISSUED';
    rc := public.issue_receipt(pay.id);
  end if;
  perform app.log_edit(b.id, format('Payment of %s edited: %s', to_char(pay.amount / 100.0, 'FM999,999,990.00'), why), to_jsonb(pay), p - 'reason');
  return jsonb_build_object('receipt', rc ->> 'number');
end $$;
grant execute on function public.edit_payment(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- status corrections
-- action: 'undo_check_in' | 'undo_check_out' | 'reopen' | 'set_times'
-- p: { reason, check_in_at, check_out_at }
create or replace function public.correct_status(p_booking uuid, p_action text, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; why text; le public.leases; stay_end date;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.kind <> 'RESERVATION' then perform app.fail('Booking not found'); end if;
  perform app.require_editor(b.property_id);
  why := app.require_reason(p ->> 'reason');

  if p_action = 'undo_check_in' then
    if b.status <> 'CHECKED_IN' then perform app.fail('The guest isn''t checked in'); end if;
    update public.bookings set status = 'CONFIRMED', actual_check_in = null where id = b.id;
    -- Move-in meter readings are taken again at the next check-in.
    delete from public.meter_readings where booking_id = b.id and reading_type = 'MOVE_IN' and billed_line_id is null;
    perform app.log_status(b.id, 'CHECKED_IN', 'CONFIRMED', 'Check-in undone: ' || why);

  elsif p_action = 'undo_check_out' then
    if b.status <> 'CHECKED_OUT' then perform app.fail('The guest isn''t checked out'); end if;
    select * into le from public.leases where booking_id = b.id;
    if le.settled_at is not null then perform app.fail('The deposit is already settled; this stay is closed'); end if;
    stay_end := case when b.mode = 'YEARLY' then le.end_date
                     else greatest(b.check_out, coalesce((select max(upper(period)) from public.charge_periods where booking_id = b.id and kind = 'STAY'), b.check_out)) end;
    begin
      update public.bookings set status = 'CHECKED_IN', actual_check_out = null, stay = daterange(check_in, stay_end) where id = b.id;
    exception when exclusion_violation then
      perform app.fail('The unit has been booked since this guest left. Move that booking first.');
    end;
    update public.charge_periods set state = 'OPEN', note = null where booking_id = b.id and state = 'CANCELLED' and note = 'Moved out early';
    perform app.log_status(b.id, 'CHECKED_OUT', 'CHECKED_IN', 'Check-out undone: ' || why);

  elsif p_action = 'reopen' then
    if b.status not in ('CANCELLED', 'EXPIRED', 'NO_SHOW') then perform app.fail('Only cancelled, expired or no-show bookings can be reopened'); end if;
    begin
      update public.bookings set status = case when b.check_out <= app.today() then 'CHECKED_OUT'::public.booking_status else 'CONFIRMED'::public.booking_status end,
        cancelled_at = null, cancel_reason = null, hold_expires_at = null where id = b.id;
      if b.check_out <= app.today() then perform app.assert_free(b.unit_id, b.check_in, b.check_out, b.id); end if;
    exception when exclusion_violation then
      perform app.fail('The unit has been booked for these dates since. Change the dates or unit after reopening is not possible; book again instead.');
    end;
    update public.charge_periods set state = 'OPEN' where booking_id = b.id and state = 'CANCELLED';
    perform app.log_status(b.id, b.status, (select status from public.bookings where id = b.id), 'Reopened: ' || why);

  elsif p_action = 'set_times' then
    update public.bookings set
      actual_check_in = coalesce((p ->> 'check_in_at')::timestamptz, actual_check_in),
      actual_check_out = coalesce((p ->> 'check_out_at')::timestamptz, actual_check_out)
    where id = b.id;
    perform app.log_edit(b.id, 'Arrival/departure times corrected: ' || why,
      jsonb_build_object('check_in_at', b.actual_check_in, 'check_out_at', b.actual_check_out), p - 'reason');
  else
    perform app.fail('Unknown correction');
  end if;
  perform app.refresh_booking_totals(b.id);
end $$;
grant execute on function public.correct_status(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------- meter readings
-- Recomputes a utility charge from the readings as they are now (used after a reading is corrected).
create or replace function app.recalc_utility_line(p_line uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.charge_lines; r public.meter_readings; b public.bookings; prev record; rate public.utility_rates; used numeric; amt bigint; label text;
begin
  select * into l from public.charge_lines where id = p_line;
  select * into r from public.meter_readings where billed_line_id = l.id;
  if not found then return; end if;
  select * into b from public.bookings where id = r.booking_id;
  select * into prev from app.previous_reading(r.meter_id, r.reading_date, b.check_in);
  used := greatest(r.value - coalesce(prev.value, r.value), 0);
  select ur.* into rate from public.utility_rates ur join public.meters mt on mt.id = r.meter_id
  where ur.property_id = r.property_id and ur.utility = mt.utility and ur.effective_from <= r.reading_date order by ur.effective_from desc limit 1;
  amt := greatest(round(used * rate.price_per_unit)::bigint, rate.minimum_charge);
  select case when utility = 'ELECTRIC' then 'Electricity' else 'Water' end into label from public.meters where id = r.meter_id;
  update public.charge_lines set quantity = used, unit_price = rate.price_per_unit, amount = amt,
    description = format('%s %s → %s (%s units × ฿%s) · corrected', label, trim(to_char(coalesce(prev.value, r.value), 'FM999,999,990.##')),
      trim(to_char(r.value, 'FM999,999,990.##')), trim(to_char(used, 'FM999,999,990.##')), trim(to_char(rate.price_per_unit / 100.0, 'FM999,990.00'))),
    meta = coalesce(meta, '{}') || jsonb_build_object('from', prev.value, 'to', r.value, 'previous_reading_id', prev.reading_id)
  where id = l.id;
  perform app.recalc_period(l.period_id);
end $$;

-- Corrects or deletes a reading, including one already billed: its charge and the next reading's charge are recomputed.
-- p_value null = delete.
create or replace function public.correct_meter_reading(p_reading uuid, p_value numeric, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.meter_readings; why text; x record; b uuid;
begin
  select * into r from public.meter_readings where id = p_reading for update;
  if not found then perform app.fail('Reading not found'); end if;
  if r.billed_line_id is not null or r.reading_date < app.today() - 31 then perform app.require_editor(r.property_id);
  elsif not app.can_book(r.property_id) then perform app.fail('You don''t have permission here');
  end if;
  why := app.require_reason(p_reason);
  if p_value is not null and p_value < 0 then perform app.fail('Readings can''t be negative'); end if;

  if p_value is null then
    if r.billed_line_id is not null then perform public.remove_charge(r.billed_line_id, 'Reading deleted: ' || why); end if;
    delete from public.meter_readings where id = r.id;
  else
    update public.meter_readings set value = p_value, recorded_by = auth.uid(), recorded_at = now() where id = r.id;
    if r.billed_line_id is not null then perform app.recalc_utility_line(r.billed_line_id); end if;
  end if;
  -- The next billed reading of this meter used this one as its starting point.
  for x in select billed_line_id from public.meter_readings where meter_id = r.meter_id and reading_date > r.reading_date and billed_line_id is not null
           order by reading_date limit 1 loop
    perform app.recalc_utility_line(x.billed_line_id);
  end loop;
  b := coalesce(r.booking_id, (select booking_id from public.meter_readings where meter_id = r.meter_id and reading_date > r.reading_date and booking_id is not null order by reading_date limit 1));
  if b is not null then
    perform app.log_edit(b, format('Meter reading %s on %s %s: %s', case when p_value is null then 'deleted' else 'corrected' end,
      to_char(r.reading_date, 'DD Mon YYYY'), case when p_value is null then '' else format('(%s → %s)', r.value, p_value) end, why), to_jsonb(r), jsonb_build_object('value', p_value));
  end if;
end $$;
grant execute on function public.correct_meter_reading(uuid, numeric, text) to authenticated;
