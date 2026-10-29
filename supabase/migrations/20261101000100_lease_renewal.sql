-- Yearly leases: renewal, notice to move out, deposit top-up.
-- Safe to run more than once.

alter table public.leases
  add column if not exists notice_given_on date,   -- the day the tenant told us
  add column if not exists move_out_on    date,    -- planned move-out (end of stay); null = staying to end_date
  add column if not exists renewed_count  int not null default 0,
  add column if not exists last_renewed_at timestamptz;

-- Deposit actually held: what was paid on the move-in period plus deposit top-ups, capped at the deposit.
create or replace function app.deposit_held(bid uuid) returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select least(le.deposit_amount, coalesce((
    select sum(cp.paid_amount) from public.charge_periods cp
    where cp.booking_id = bid and (cp.seq = 0 or (cp.kind = 'ADJUSTMENT' and cp.label like 'Deposit top-up%'))), 0))
  from public.leases le where le.booking_id = bid;
$$;

-- ---------------------------------------------------------------- renewal
-- p: { months (default 12), rent (satang, default unchanged), deposit_topup (satang, default 0), reason }
-- Keeps the same booking: new months are added after the current end; the new rent applies from the old end date.
create or replace function public.renew_lease(p_booking uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; le public.leases; add_months int := coalesce((p ->> 'months')::int, 12); cur_months int;
  rent bigint; topup bigint := coalesce((p ->> 'deposit_topup')::bigint, 0); why text; r jsonb; nseq int; pid uuid; new_end date;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.mode <> 'YEARLY' then perform app.fail('Yearly lease not found'); end if;
  if b.status not in ('CONFIRMED', 'CHECKED_IN') then perform app.fail('Only active leases can be renewed'); end if;
  perform app.require_editor(b.property_id);
  select * into le from public.leases where booking_id = b.id for update;
  if le.move_out_on is not null then perform app.fail('The tenant has given notice to move out. Withdraw the notice first.'); end if;
  if add_months < 1 or add_months > 60 then perform app.fail('Renew for 1 to 60 months'); end if;
  if topup < 0 then perform app.fail('Deposit top-up can''t be negative'); end if;
  rent := coalesce((p ->> 'rent')::bigint, le.rent_amount);
  why := coalesce(nullif(trim(p ->> 'reason'), ''), 'Renewal');

  cur_months := (extract(year from age(le.end_date, le.start_date)) * 12 + extract(month from age(le.end_date, le.start_date)))::int;
  if (le.start_date + make_interval(months => cur_months))::date < le.end_date then cur_months := cur_months + 1; end if;
  r := public.change_lease(b.id, jsonb_build_object('months', cur_months + add_months, 'rent', rent, 'rent_from', le.end_date,
         'reason', format('Renewed %s months: %s', add_months, why)));
  new_end := (r ->> 'end')::date;

  if topup > 0 then
    select coalesce(max(seq), 0) + 1 into nseq from public.charge_periods where booking_id = b.id;
    insert into public.charge_periods (booking_id, seq, kind, label, due_date, total_amount)
    values (b.id, nseq, 'ADJUSTMENT', 'Deposit top-up', le.end_date, 0) returning id into pid;
    insert into public.charge_lines (period_id, charge_type, description, quantity, unit_price, amount)
    values (pid, 'DEPOSIT', 'Deposit top-up for the renewed lease', 1, topup, topup);
    perform app.recalc_period(pid);
    update public.leases set deposit_amount = deposit_amount + topup where booking_id = b.id;
  end if;
  update public.leases set renewed_count = renewed_count + 1, last_renewed_at = now() where booking_id = b.id;
  perform app.refresh_booking_totals(b.id);
  perform app.apply_credit(b.id);
  return jsonb_build_object('end', new_end, 'skipped_paid_months', r -> 'skipped_paid_months');
end $$;
grant execute on function public.renew_lease(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- notice to move out
-- p: { move_out (date the unit is free again), notice_date (default today), reason }
-- Frees the unit from the move-out date and cancels unpaid rent months starting on or after it.
create or replace function public.give_notice(p_booking uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; le public.leases; mo date := (p ->> 'move_out')::date; nd date := coalesce((p ->> 'notice_date')::date, app.today());
  short_by int; paid_after int; why text := nullif(trim(p ->> 'reason'), '');
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.mode <> 'YEARLY' then perform app.fail('Yearly lease not found'); end if;
  if b.status not in ('CONFIRMED', 'CHECKED_IN') then perform app.fail('Only active leases can be given notice'); end if;
  if not app.can_book(b.property_id) then perform app.fail('You don''t have permission here'); end if;
  select * into le from public.leases where booking_id = b.id for update;
  if mo is null then perform app.fail('Pick the move-out date'); end if;
  if nd > app.today() then perform app.fail('The notice date can''t be in the future'); end if;
  if mo <= b.check_in then perform app.fail('Move-out must be after the move-in date'); end if;
  if mo > le.end_date then perform app.fail(format('The lease ends %s. Renew it first to stay longer.', to_char(le.end_date, 'DD Mon YYYY'))); end if;

  -- A changed date replaces the earlier notice.
  update public.charge_periods set state = 'OPEN', note = null where booking_id = b.id and state = 'CANCELLED' and note = 'Moving out';
  update public.leases set notice_given_on = nd, move_out_on = mo where booking_id = b.id;
  begin
    update public.bookings set stay = daterange(check_in, mo) where id = b.id;
  exception when exclusion_violation then
    perform app.fail('The unit has been booked from an earlier date. Move that booking first.');
  end;
  update public.charge_periods set state = 'CANCELLED', note = 'Moving out'
  where booking_id = b.id and kind = 'RENT' and state = 'OPEN' and paid_amount = 0 and lower(period) >= mo;
  select count(*) into paid_after from public.charge_periods where booking_id = b.id and kind = 'RENT' and paid_amount > 0 and lower(period) >= mo;
  short_by := greatest(le.notice_days - (mo - nd), 0);
  perform app.refresh_booking_totals(b.id);
  perform app.log_edit(b.id, format('Notice to move out on %s (given %s%s)%s', to_char(mo, 'DD Mon YYYY'), to_char(nd, 'DD Mon YYYY'),
      case when short_by > 0 then format(', %s days short of the %s-day notice', short_by, le.notice_days) else '' end,
      case when why is not null then ': ' || why else '' end),
    jsonb_build_object('end', b.check_out), jsonb_build_object('move_out', mo, 'notice_date', nd));
  return jsonb_build_object('short_by_days', short_by, 'paid_months_after', paid_after);
end $$;
grant execute on function public.give_notice(uuid, jsonb) to authenticated;

create or replace function public.withdraw_notice(p_booking uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; le public.leases;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found or b.mode <> 'YEARLY' then perform app.fail('Yearly lease not found'); end if;
  if b.status not in ('CONFIRMED', 'CHECKED_IN') then perform app.fail('Only active leases can be changed'); end if;
  if not app.can_book(b.property_id) then perform app.fail('You don''t have permission here'); end if;
  select * into le from public.leases where booking_id = b.id for update;
  if le.move_out_on is null then perform app.fail('There is no notice to withdraw'); end if;
  begin
    update public.bookings set stay = daterange(check_in, le.end_date) where id = b.id;
  exception when exclusion_violation then
    perform app.fail('The unit has been booked after the move-out date. Move that booking first.');
  end;
  perform app.assert_free(b.unit_id, b.check_in, le.end_date, b.id);
  update public.charge_periods set state = 'OPEN', note = null where booking_id = b.id and state = 'CANCELLED' and note = 'Moving out';
  update public.leases set notice_given_on = null, move_out_on = null where booking_id = b.id;
  perform app.refresh_booking_totals(b.id);
  perform app.log_edit(b.id, 'Notice to move out withdrawn' || coalesce(': ' || nullif(trim(p_reason), ''), ''), jsonb_build_object('move_out', le.move_out_on), null);
end $$;
grant execute on function public.withdraw_notice(uuid, text) to authenticated;

-- ---------------------------------------------------------------- updated: deposit held includes top-ups
create or replace function public.settle_lease(p jsonb) returns jsonb
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

  -- 3. Deposit actually held (move-in deposit plus any top-ups paid).
  held := app.deposit_held(b.id);
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

-- ---------------------------------------------------------------- updated: undoing a check-out returns to the planned move-out date
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
    stay_end := case when b.mode = 'YEARLY' then coalesce(le.move_out_on, le.end_date)
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
