#!/usr/bin/env bash
# Teste les migrations sur un Postgres 16 jetable : ./supabase/tests/run.sh
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"; B=/usr/lib/postgresql/16/bin; D=$(mktemp -d); P=5545
chown postgres "$D"
su postgres -c "$B/initdb -D $D/data -A trust >/dev/null && $B/pg_ctl -D $D/data -o '-k /tmp -p $P' -l $D/log -w start >/dev/null"
trap 'su postgres -c "$B/pg_ctl -D $D/data -m immediate stop >/dev/null"; rm -rf "$D"' EXIT
Q="psql -h /tmp -p $P -U postgres -q -v ON_ERROR_STOP=1"
$Q -c "create extension pgcrypto" -f "$ICI/stub.sql"
for f in "$ICI"/../migrations/*.sql; do
  case "$f" in *planification*) continue;; esac   # pg_cron : uniquement sur Supabase
  $Q -f "$f"
done
$Q -f "$ICI/tests.sql"
$Q -f "$ICI/serveur.sql"
