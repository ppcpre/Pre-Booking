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
