#!/usr/bin/env bash
# Applies new files from supabase/migrations to the database in $DATABASE_URL, in name order.
# Each file runs in one transaction together with its record in app.schema_migrations,
# so a failed file changes nothing and is retried on the next run.
#
# A database first set up by hand (setup-all.sql or file by file) has no record yet: the first
# run marks the files up to BASELINE as already applied. Files after it are written to be safe
# to run again, so they are applied (again) to be sure.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL}"
DIR="${MIGRATIONS_DIR:-supabase/migrations}"
BASELINE="20261029000300"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
PSQL=(psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 --no-psqlrc)

q() { "${PSQL[@]}" -At -c "$1"; }

has_table=$(q "select to_regclass('app.schema_migrations') is not null")
if [ "$has_table" != "t" ]; then
  existing=$(q "select to_regclass('public.team_members') is not null")
  q "create schema if not exists app; create table if not exists app.schema_migrations (version text primary key, name text not null, applied_at timestamptz not null default now())" >/dev/null
  if [ "$existing" = "t" ]; then
    echo "Database was set up by hand: marking migrations up to $BASELINE as applied."
    for f in "$DIR"/*.sql; do
      name=$(basename "$f"); v=${name%%_*}
      if [[ "$v" < "$BASELINE" || "$v" == "$BASELINE" ]]; then
        q "insert into app.schema_migrations (version, name) values ('$v', '$name') on conflict do nothing" >/dev/null
      fi
    done
  else
    echo "Empty database: applying every migration."
  fi
fi

applied=0
for f in "$DIR"/*.sql; do
  name=$(basename "$f"); v=${name%%_*}
  [[ "$v" =~ ^[0-9]+$ ]] || { echo "Skipping $name (name must start with a number)"; continue; }
  if [ "$(q "select exists (select 1 from app.schema_migrations where version = '$v')")" = "t" ]; then continue; fi
  echo "Applying $name"
  "${PSQL[@]}" -1 -f "$f" -c "insert into app.schema_migrations (version, name) values ('$v', '$name')"
  applied=$((applied + 1))
done
echo "Done: $applied migration(s) applied."
