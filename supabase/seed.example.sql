-- Run once in the Supabase SQL editor after the migrations, with your own Google address.
-- This is the first admin; everyone else is added from Settings → Team in the app.
insert into public.team_members (email, full_name, role)
values ('you@gmail.com', 'Your Name', 'ADMIN')
on conflict (email) do update set role = 'ADMIN', is_active = true;
