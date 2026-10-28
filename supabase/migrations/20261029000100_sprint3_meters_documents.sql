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
