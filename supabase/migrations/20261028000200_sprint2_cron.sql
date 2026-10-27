-- Releases unpaid reservations every 5 minutes. Enable the pg_cron extension in Supabase
-- (Database → Extensions) before running this file.
create extension if not exists pg_cron;

select cron.schedule('expire-holds', '*/5 * * * *', $$select public.expire_holds()$$);
