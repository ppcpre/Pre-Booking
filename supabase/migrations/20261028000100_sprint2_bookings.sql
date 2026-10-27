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
