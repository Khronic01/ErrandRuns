#!/usr/bin/env bash
# Rebuilds a throwaway local database and runs the engine tests.
# Needs Postgres 16 + PostGIS. Usage: PGPORT=54329 PGHOST=/tmp supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-errandruns_test}
PSQL="psql -X -q -v ON_ERROR_STOP=1 -U ${PGUSER:-postgres}"
$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB"
$PSQL -d "$DB" -f tests/local_supabase_shim.sql
for f in migrations/*.sql; do echo "migrate: $f"; $PSQL -d "$DB" -f "$f"; done
$PSQL -d "$DB" -f seed.sql
for f in tests/test_*.sql; do echo "test: $f"; $PSQL -d "$DB" -o /dev/null -f "$f" 2>&1 | sed -E 's/^psql:[^ ]+ (NOTICE|ERROR):  /\1 /'; [ "${PIPESTATUS[0]}" -eq 0 ] || exit 1; done
echo "ALL TESTS PASSED"
