#!/usr/bin/env bash
# Robust backfill script for StonksFYI.
# Usage: ./scripts/backfillRange.sh <start_date> <end_date>
# Dates should be in YYYY-MM-DD format.  All weekdays between start and end (inclusive)
# will be processed.  Any failures to fetch or compute for a given day are logged
# but do not abort the loop.  At the end, the universe snapshot is refreshed.

set -euo pipefail

START_DATE="${1:?Start date (YYYY-MM-DD) required}";
END_DATE="${2:?End date (YYYY-MM-DD) required}";

current="$START_DATE"
while [[ "$current" < "$END_DATE" || "$current" == "$END_DATE" ]]; do
  # Skip weekends (Saturday=6, Sunday=7 for %u)
  dow=$(date -d "$current" +%u)
  if [[ "$dow" -lt 6 ]]; then
    echo "=== $current ==="
    # Fetch daily bars; ignore failures but print warning
    node scripts/fetchDailyDataToDb.js "$current" || echo "warn: fetch failed for $current"
    # Compute scores; ignore failures but print warning
    node scripts/computeScoresToDb.js "$current" || echo "warn: compute failed for $current"
  fi
  current=$(date -I -d "$current + 1 day")
done
# Refresh universe snapshot once after full backfill
node scripts/updateUniverseFromReference.js || true
echo "Backfill completed from $START_DATE to $END_DATE."
