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
