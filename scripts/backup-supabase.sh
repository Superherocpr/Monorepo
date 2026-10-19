#!/usr/bin/env bash
# Local backup of the PRODUCTION Supabase database.
#
#   ./scripts/backup-supabase.sh
#
# Writes a compressed pg_dump (custom format, restore with pg_restore) to
# /Volumes/Sodalypsis/SupabaseBackups/production/ and keeps the newest $KEEP.
#
# The DB password is read from ~/SupabaseBackups/.env (SUPABASE_DB_PASSWORD=...),
# which lives on the internal disk on purpose and is never committed. Optional keys
# in that same file:
#   AGE_RECIPIENT=age1...   encrypt every dump with age (needs `brew install age`)
#   POOLER_HOST=...         override the pooler host
#   KEEP=14                 how many dumps to keep
#
# The dumps contain student names, emails and phone numbers. The destination drive
# is NOT encrypted, so set AGE_RECIPIENT before treating these as safe to carry around.
set -euo pipefail

PROJECT_REF="qgvlguifubbnclxfascz"          # superherocpr-production
ENV_FILE="$HOME/SupabaseBackups/.env"
VOLUME="/Volumes/Sodalypsis"
DEST="$VOLUME/SupabaseBackups/production"
PG_BIN="/opt/homebrew/opt/postgresql@17/bin"

die() { echo "ERROR: $*" >&2; exit 1; }

[ -r "$ENV_FILE" ] || die "missing $ENV_FILE (needs SUPABASE_DB_PASSWORD=...)"
getenv() { grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2- || true; }

PGPASSWORD="$(getenv SUPABASE_DB_PASSWORD)"
[ -n "$PGPASSWORD" ] || die "SUPABASE_DB_PASSWORD is empty in $ENV_FILE"
export PGPASSWORD
POOLER_HOST="$(getenv POOLER_HOST)"; POOLER_HOST="${POOLER_HOST:-aws-1-us-west-2.pooler.supabase.com}"
KEEP="$(getenv KEEP)"; KEEP="${KEEP:-14}"
AGE_RECIPIENT="$(getenv AGE_RECIPIENT)"

[ -x "$PG_BIN/pg_dump" ] || die "pg_dump 17 not found; run: brew install postgresql@17"
# Refuse to run unless the drive is really mounted, otherwise mkdir -p would quietly
# create a fake /Volumes/Sodalypsis folder on the internal disk and back up into it.
mount | grep -q " on $VOLUME " || die "$VOLUME is not mounted"
if [ -n "$AGE_RECIPIENT" ]; then command -v age >/dev/null || die "AGE_RECIPIENT set but age is not installed"; fi

mkdir -p "$DEST"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$DEST/superherocpr-production_$STAMP.dump"
TMP="$OUT.partial"
trap 'rm -f "$TMP"' EXIT

CONN="host=$POOLER_HOST port=5432 user=postgres.$PROJECT_REF dbname=postgres sslmode=require"
echo "Backing up production ($POOLER_HOST, project $PROJECT_REF) -> $OUT"

# --no-owner/--no-privileges keeps the dump restorable into a plain scratch Postgres.
"$PG_BIN/pg_dump" "$CONN" --format=custom --no-owner --no-privileges --file="$TMP"

# A dump that cannot be listed cannot be restored; fail loudly instead of keeping it.
"$PG_BIN/pg_restore" --list "$TMP" >/dev/null || die "dump failed verification, discarded"

mv "$TMP" "$OUT"
if [ -n "$AGE_RECIPIENT" ]; then
  age -r "$AGE_RECIPIENT" -o "$OUT.age" "$OUT" && rm -f "$OUT"
  OUT="$OUT.age"
fi
( cd "$DEST" && shasum -a 256 "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
echo "OK: $(basename "$OUT")  $(du -h "$OUT" | cut -f1)"

# Retention: delete everything but the newest $KEEP dumps (and their checksums).
ls -1t "$DEST"/superherocpr-production_*.dump* 2>/dev/null | grep -v '\.sha256$' \
  | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old" "$old.sha256"; done
