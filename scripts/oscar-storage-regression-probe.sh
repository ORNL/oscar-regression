#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C
umask 077

# Privileged target-side helper for the OSCAR 3.9.2 storage regression. It is copied to
# /tmp for one run and is never installed into the deployment. Ordinary
# Legacy HOT_RETENTION fixture mutations operate only on rows registered in
# oscar_regression_fixture and fail closed if a cold-deletion plan includes any
# other generation. PARQUET_PRIMARY lifecycle observation uses natural ingest,
# read-only catalog queries, and a bounded ACCESS SHARE witness lock; it never
# changes product rows. The separately selected restore-drill action intentionally
# replaces the isolated database, application state, cold archive, and credentials
# from the self-contained schema-v2 snapshot; the runner binds that profile to
# exact target, data-loss, and canonical storage-path acknowledgements, and the
# probe additionally requires an exact per-run token.

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ ${1:-} == --release-dir ]] || fail 'Expected --release-dir.'
release_dir=${2:-}; shift 2
canonical_release=$(realpath -e -- "$release_dir" 2>/dev/null || true)
[[ $release_dir == /* && $release_dir != / && $release_dir != *'/../'* &&
   -d $release_dir && ! -L $release_dir && $canonical_release == "$release_dir" &&
   -f $release_dir/oscar.sh && ! -L $release_dir/oscar.sh ]] ||
  fail 'Release directory is not a configured OSCAR release.'
action=${1:-}; (($#)) && shift
[[ ${EUID:-$(id -u)} -eq 0 ]] || fail 'Storage probe requires passwordless sudo.'
cd "$release_dir"

compose() {
  env -u OSCAR_ARCHIVE_DIR -u OSCAR_BACKUP_DIR -u OSCAR_BACKUP_MODE -u OSCAR_DEPLOYMENT_ID \
    -u OSCAR_HTTPS_PORT -u OSCAR_JAVA_OPTS -u OSCAR_POSTGIS_PLATFORM \
    -u OSCAR_SECRETS_DIR -u OSCAR_TLS_DIR -u OSCAR_VERSION \
    -u OSCAR_WAL_ARCHIVE_DIR \
    docker compose --project-name oscar --env-file .env --file compose.yaml "$@"
}
psql_admin() {
  compose exec -T postgres sh -eu -c '
    PGPASSWORD=$(cat /run/secrets/postgres_bootstrap_password)
    PGOPTIONS="-csearch_path=oscar,public -ctimezone=UTC"
    export PGPASSWORD PGOPTIONS
    exec psql --set=ON_ERROR_STOP=1 --username oscar_bootstrap --dbname gis "$@"
  ' psql-wrapper "$@"
}
# These helpers are called from manifest/ledger read loops. psql/docker inherit
# stdin by default and would otherwise consume the loop's remaining records
# after validating the first item.
scalar() { psql_admin --quiet --tuples-only --no-align --command "$1" </dev/null | tr -d '[:space:]'; }
json_query() { psql_admin --quiet --tuples-only --no-align --command "$1" </dev/null | tail -n 1; }
valid_run() { [[ $1 =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$ ]]; }
valid_uuid() { [[ $1 =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]; }
valid_utc_timestamp() { [[ $1 =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?Z$ ]]; }
retention_hold_id_from_output() {
  local output=$1 expected_store=$2 expected_scope=$3 expected_resolution=$4
  local line hold_id='' store_key='' id_scope='' resolution='' matches=0
  while IFS= read -r line; do
    if [[ $line =~ ^Retention\ hold\ created:\ ([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\ \(store=([a-z_][a-z0-9_]{0,62}),\ id-scope=(-?[0-9]+),\ resolution=(GENERATION_EXACT|HOT_EXACT|COLD_RANGE_CONSERVATIVE)\)$ ]]; then
      hold_id=${BASH_REMATCH[1]}
      store_key=${BASH_REMATCH[2]}
      id_scope=${BASH_REMATCH[3]}
      resolution=${BASH_REMATCH[4]}
      matches=$((matches+1))
    fi
  done <<<"$output"
  [[ $matches -eq 1 && $store_key == "$expected_store" && $id_scope == "$expected_scope" &&
     $resolution == "$expected_resolution" ]] || return 1
  valid_uuid "$hold_id" || return 1
  printf '%s' "$hold_id"
}
valid_deployment_id() { valid_uuid "$1"; }
valid_store_key() { [[ $1 =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; }
valid_id_scope() { [[ $1 =~ ^-?[0-9]+$ && $1 -ge -2147483648 && $1 -le 2147483647 ]]; }
valid_media_token() { [[ $1 =~ ^[A-Za-z0-9_-]+$ ]]; }
valid_alarm_video_path() {
  [[ $1 =~ ^videos/clips/[A-Za-z0-9._-]+/[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])_([01][0-9]|2[0-3])-[0-5][0-9]-[0-5][0-9]_[0-9]{3}-g[1-9][0-9]*\.mp4$ ]]
}
alarm_media_marker() {
  valid_run "$1" || fail 'Alarm-media run ID is invalid.'
  printf '/tmp/oscar-alarm-media-%s.baseline' "$1"
}
alarm_all_camera_artifacts() {
  local listing full relative name kind
  listing=$(compose exec -T oscar sh -eu -c '
    root=/var/lib/oscar/files/videos/clips
    test ! -L "$root"
    test -d "$root" || exit 0
    find "$root" -mindepth 2 -maxdepth 2 -type f -print
  ' alarm-camera-artifacts)
  while IFS= read -r full; do
    [[ -n $full ]] || continue
    relative=${full#/var/lib/oscar/files/}
    [[ $relative =~ ^videos/clips/[A-Za-z0-9._-]+/[^/]+$ ]] ||
      fail 'Alarm-media inventory encountered an unsafe clip path.'
    name=${relative##*/}
    case $name in
      *.partial-*|*.partial|*.partial.*|*.tmp|*.tmp.*) kind=partial ;;
      *.mp4) kind=final ;;
      *) continue ;;
    esac
    printf '%s\t%s\n' "$kind" "$relative"
  done <<<"$listing" | sort -u
}
env_value() {
  local name=$1 fallback=$2 value
  value=$(awk -F= -v name="$name" '$1 == name { print substr($0, index($0, "=") + 1); exit }' .env)
  printf '%s' "${value:-$fallback}"
}
platform_config_fields() {
  local config_path=$1
  {
    cat <<'SQL'
\set ON_ERROR_STOP on
CREATE TEMP TABLE oscar_config_input (sequence bigserial, line text NOT NULL);
\copy oscar_config_input(line) FROM STDIN
SQL
    compose exec -T oscar base64 "$config_path"
    printf '\\.\n'
    cat <<'SQL'
WITH payload AS (
  SELECT convert_from(decode(string_agg(line, '' ORDER BY sequence), 'base64'), 'UTF8') AS text
  FROM oscar_config_input
), document AS (
  SELECT text::json AS raw FROM payload WHERE left(ltrim(text), 1) = '['
), items AS (
  SELECT item AS raw, ordinal
  FROM document, LATERAL json_array_elements(raw) WITH ORDINALITY AS entry(item, ordinal)
), expected(kind, class_name) AS (
  VALUES
    ('daily', 'com.botts.impl.service.dailyfile.DailyFileJournalServiceConfig'),
    ('oscar', 'com.botts.impl.service.oscar.OSCARServiceConfig'),
    ('database', 'org.sensorhub.impl.database.system.SystemDriverDatabaseConfig')
), candidates AS (
  SELECT expected.kind, items.ordinal, items.raw
  FROM items CROSS JOIN expected
  WHERE json_typeof(items.raw) = 'object'
    AND EXISTS (
      SELECT 1 FROM json_each(items.raw) pair
      WHERE pair.key = 'objClass' AND json_typeof(pair.value) = 'string'
        AND pair.value #>> '{}' = expected.class_name
    )
), selected AS (
  SELECT daily.raw AS daily, oscar.raw AS oscar, database.raw AS database
  FROM candidates daily CROSS JOIN candidates oscar CROSS JOIN candidates database
  WHERE daily.kind = 'daily' AND oscar.kind = 'oscar' AND database.kind = 'database'
    AND (SELECT count(*) FROM candidates WHERE kind = 'daily') = 1
    AND (SELECT count(*) FROM candidates WHERE kind = 'oscar') = 1
    AND (SELECT count(*) FROM candidates WHERE kind = 'database') = 1
), nested AS (
  SELECT daily, oscar, database,
    oscar->'videoRetentionConfig' AS media,
    database->'dbConfig' AS db_config,
    (database->'dbConfig')->'archive' AS archive
  FROM selected
), valid AS (
  SELECT * FROM nested
  WHERE NOT EXISTS (SELECT key FROM json_each(daily) GROUP BY key HAVING count(*) <> 1)
    AND NOT EXISTS (SELECT key FROM json_each(oscar) GROUP BY key HAVING count(*) <> 1)
    AND NOT EXISTS (SELECT key FROM json_each(database) GROUP BY key HAVING count(*) <> 1)
    AND json_typeof(media) = 'object'
    AND json_typeof(db_config) = 'object'
    AND json_typeof(archive) = 'object'
    AND NOT EXISTS (SELECT key FROM json_each(media) GROUP BY key HAVING count(*) <> 1)
    AND NOT EXISTS (SELECT key FROM json_each(db_config) GROUP BY key HAVING count(*) <> 1)
    AND NOT EXISTS (SELECT key FROM json_each(archive) GROUP BY key HAVING count(*) <> 1)
    AND daily->>'moduleClass' = 'com.botts.impl.service.dailyfile.DailyFileJournalService'
    AND oscar->>'moduleClass' = 'com.botts.impl.service.oscar.OSCARServiceModule'
    AND database->>'moduleClass' = 'org.sensorhub.impl.database.system.SystemDriverDatabase'
    AND db_config->>'objClass' = 'org.sensorhub.impl.datastore.postgis.database.OscarTieredObsSystemDatabaseConfig'
    AND db_config->>'moduleClass' = 'org.sensorhub.impl.datastore.postgis.database.OscarTieredObsSystemDatabase'
    AND archive->>'objClass' = 'org.sensorhub.impl.datastore.postgis.archive.TieredArchiveConfig'
    AND media->>'objClass' = 'com.botts.impl.service.oscar.video.VideoRetentionConfig'
    AND json_typeof(db_config->'useBatch') = 'boolean' AND (db_config->>'useBatch')::boolean
    AND json_typeof(media->'enableFrameRetention') = 'boolean'
    AND json_typeof(archive->'enabled') = 'boolean'
    AND json_typeof(archive->'storageMode') = 'string'
    AND json_typeof(archive->'deleteHotAfterArchive') = 'boolean'
    AND json_typeof(oscar->'delegateObservationLifecycleToDatabase') = 'boolean'
    AND json_typeof(daily->'rootDirectory') = 'string'
    AND json_typeof(daily->'journalDirectory') = 'string'
    AND json_typeof(daily->'publicationDirectory') = 'string'
    AND json_typeof(daily->'zoneId') = 'string'
    AND json_typeof(daily->'dailyFileObservationMode') = 'string'
    AND json_typeof(archive->'duckDbTemporaryDirectory') = 'string'
    AND json_typeof(archive->'intervalMinutes') = 'number' AND archive->>'intervalMinutes' ~ '^[0-9]+$'
    AND json_typeof(archive->'hotRetentionDays') = 'number' AND archive->>'hotRetentionDays' ~ '^[0-9]+$'
    AND json_typeof(archive->'rollbackGraceDays') = 'number' AND archive->>'rollbackGraceDays' ~ '^[0-9]+$'
    AND json_typeof(archive->'parquetPrimaryArchiveDelayMinutes') = 'number'
      AND archive->>'parquetPrimaryArchiveDelayMinutes' ~ '^[0-9]+$'
    AND json_typeof(archive->'immutableStageWindowMinutes') = 'number'
      AND archive->>'immutableStageWindowMinutes' ~ '^[0-9]+$'
    AND json_typeof(archive->'maximumFuturePhenomenonSkewMinutes') = 'number'
      AND archive->>'maximumFuturePhenomenonSkewMinutes' ~ '^[0-9]+$'
    AND json_typeof(archive->'parquetPrimaryIntervalMinutes') = 'number'
      AND archive->>'parquetPrimaryIntervalMinutes' ~ '^[0-9]+$'
    AND json_typeof(archive->'maximumStagePartitionsPerCycle') = 'number'
      AND archive->>'maximumStagePartitionsPerCycle' ~ '^[0-9]+$'
    AND json_typeof(archive->'maximumGenerationsPerCycle') = 'number'
      AND archive->>'maximumGenerationsPerCycle' ~ '^[0-9]+$'
    AND json_typeof(archive->'maximumVerificationsPerCycle') = 'number'
      AND archive->>'maximumVerificationsPerCycle' ~ '^[0-9]+$'
    AND json_typeof(archive->'maximumDeletionsPerCycle') = 'number'
      AND archive->>'maximumDeletionsPerCycle' ~ '^[0-9]+$'
    AND json_typeof(archive->'outputNames') = 'array'
    AND json_array_length(archive->'outputNames') BETWEEN 1 AND 64
    AND NOT EXISTS (
      SELECT 1 FROM json_array_elements(archive->'outputNames') value
      WHERE json_typeof(value) <> 'string'
        OR value #>> '{}' !~ '^[A-Za-z][A-Za-z0-9._-]{0,127}$')
    AND json_array_length(archive->'outputNames') = (
      SELECT count(DISTINCT value #>> '{}') FROM json_array_elements(archive->'outputNames') value)
    AND json_typeof(archive->'duckDbMemoryLimitMegabytes') = 'number' AND archive->>'duckDbMemoryLimitMegabytes' ~ '^[0-9]+$'
    AND json_typeof(archive->'duckDbThreads') = 'number' AND archive->>'duckDbThreads' ~ '^[0-9]+$'
    AND json_typeof(archive->'duckDbMaximumTemporaryMegabytes') = 'number' AND archive->>'duckDbMaximumTemporaryMegabytes' ~ '^[0-9]+$'
    AND json_typeof(archive->'duckDbMaximumConcurrentSessions') = 'number' AND archive->>'duckDbMaximumConcurrentSessions' ~ '^[0-9]+$'
    AND json_typeof(archive->'duckDbSessionAcquireTimeoutSeconds') = 'number' AND archive->>'duckDbSessionAcquireTimeoutSeconds' ~ '^[0-9]+$'
    AND json_typeof(media->'timeToRetention') = 'number' AND media->>'timeToRetention' ~ '^[0-9]+$'
    AND json_typeof(media->'videoQueryPeriod') = 'number' AND media->>'videoQueryPeriod' ~ '^[0-9]+$'
    AND json_typeof(media->'maximumCatchUpHours') = 'number' AND media->>'maximumCatchUpHours' ~ '^[0-9]+$'
    AND json_typeof(media->'lateArrivalOverlapHours') = 'number' AND media->>'lateArrivalOverlapHours' ~ '^[0-9]+$'
    AND json_typeof(media->'lateArrivalScanPeriodMinutes') = 'number' AND media->>'lateArrivalScanPeriodMinutes' ~ '^[0-9]+$'
    AND json_typeof(media->'lateArrivalCatchUpHours') = 'number' AND media->>'lateArrivalCatchUpHours' ~ '^[0-9]+$'
    AND json_typeof(media->'reconciliationCatchUpHours') = 'number' AND media->>'reconciliationCatchUpHours' ~ '^[0-9]+$'
    AND json_typeof(media->'reconciliationPeriodHours') = 'number' AND media->>'reconciliationPeriodHours' ~ '^[0-9]+$'
    AND json_typeof(media->'occupancyStreamRefreshMinutes') = 'number' AND media->>'occupancyStreamRefreshMinutes' ~ '^[0-9]+$'
    AND json_typeof(media->'frameRetentionCount') = 'number' AND media->>'frameRetentionCount' ~ '^[0-9]+$'
    AND json_typeof(media->'jpegQuality') = 'number' AND media->>'jpegQuality' ~ '^[0-9]+$'
    AND json_typeof(media->'sourceRollbackGraceHours') = 'number' AND media->>'sourceRollbackGraceHours' ~ '^[0-9]+$'
    AND json_typeof(media->'metadataReclamationWorkLimit') = 'number' AND media->>'metadataReclamationWorkLimit' ~ '^[0-9]+$'
    AND json_typeof(media->'maintenanceWorkLimit') = 'number' AND media->>'maintenanceWorkLimit' ~ '^[0-9]+$'
    AND json_typeof(daily->'fsyncIntervalMillis') = 'number' AND daily->>'fsyncIntervalMillis' ~ '^[0-9]+$'
    AND json_typeof(daily->'maxUnforcedRecords') = 'number' AND daily->>'maxUnforcedRecords' ~ '^[0-9]+$'
    AND json_typeof(daily->'maxUnforcedBytes') = 'number' AND daily->>'maxUnforcedBytes' ~ '^[0-9]+$'
    AND json_typeof(daily->'maxSegmentBytes') = 'number' AND daily->>'maxSegmentBytes' ~ '^[0-9]+$'
    AND json_typeof(daily->'maxSegmentAgeSeconds') = 'number' AND daily->>'maxSegmentAgeSeconds' ~ '^[0-9]+$'
    AND json_typeof(daily->'maxRecordBytes') = 'number' AND daily->>'maxRecordBytes' ~ '^[0-9]+$'
    AND json_typeof(daily->'sealedJournalRetentionDays') = 'number' AND daily->>'sealedJournalRetentionDays' ~ '^[0-9]+$'
    AND json_typeof(daily->'requireBackupBeforeSealedJournalDeletion') = 'boolean'
    AND json_typeof(oscar->'dailyFilePurgeWorkLimit') = 'number' AND oscar->>'dailyFilePurgeWorkLimit' ~ '^[0-9]+$'
)
SELECT concat_ws('|',
  archive->>'intervalMinutes', archive->>'hotRetentionDays', archive->>'rollbackGraceDays',
  archive->>'duckDbMemoryLimitMegabytes', archive->>'duckDbThreads',
  archive->>'duckDbMaximumTemporaryMegabytes', archive->>'duckDbMaximumConcurrentSessions',
  archive->>'duckDbSessionAcquireTimeoutSeconds', archive->>'duckDbTemporaryDirectory',
  media->>'timeToRetention', media->>'videoQueryPeriod', media->>'maximumCatchUpHours',
  media->>'lateArrivalOverlapHours', media->>'lateArrivalScanPeriodMinutes',
  media->>'lateArrivalCatchUpHours', media->>'reconciliationCatchUpHours',
  media->>'reconciliationPeriodHours', media->>'occupancyStreamRefreshMinutes',
  media->>'frameRetentionCount',
  media->>'jpegQuality', media->>'sourceRollbackGraceHours', media->>'metadataReclamationWorkLimit',
  media->>'maintenanceWorkLimit',
  media->>'enableFrameRetention', archive->>'deleteHotAfterArchive',
  daily->>'rootDirectory', daily->>'journalDirectory', daily->>'publicationDirectory',
  daily->>'zoneId', daily->>'dailyFileObservationMode', daily->>'fsyncIntervalMillis',
  daily->>'maxUnforcedRecords', daily->>'maxUnforcedBytes', daily->>'maxSegmentBytes',
  daily->>'maxSegmentAgeSeconds', daily->>'maxRecordBytes', daily->>'sealedJournalRetentionDays',
  daily->>'requireBackupBeforeSealedJournalDeletion',
  oscar->>'delegateObservationLifecycleToDatabase', oscar->>'dailyFilePurgeWorkLimit',
  archive->>'enabled', archive->>'storageMode', archive->>'parquetPrimaryArchiveDelayMinutes',
  archive->>'immutableStageWindowMinutes', archive->>'maximumFuturePhenomenonSkewMinutes',
  archive->>'parquetPrimaryIntervalMinutes', archive->>'maximumStagePartitionsPerCycle',
  archive->>'maximumGenerationsPerCycle', archive->>'maximumVerificationsPerCycle',
  archive->>'maximumDeletionsPerCycle', (archive->'outputNames')::jsonb::text)
FROM valid;
SQL
  } | psql_admin --quiet --tuples-only --no-align | tail -n 1
}
entrypoint_has_managed_tmp_contract() {
  local entrypoint=$1
  [[ $(grep -Fxc 'NATIVE_TMP_DIR=/run/oscar-native' "$entrypoint") == 1 &&
     $(grep -Fxc 'readonly NATIVE_TMP_DIR' "$entrypoint") == 1 ]] &&
    awk '
      /^[[:space:]]*exec java \$\{JAVA_OPTS:-\}/ {
        java_opts++
        if (state == 0) state = 1
        next
      }
      /^[[:space:]]*-Djava\.io\.tmpdir="\$\{NATIVE_TMP_DIR\}"/ {
        java_tmp++
        if (state == 1) state = 2
        next
      }
      /^[[:space:]]*-Dorg\.bytedeco\.javacpp\.cachedir="\$\{NATIVE_TMP_DIR\}\/javacpp"/ {
        javacpp_cache++
        if (state == 2) state = 3
        next
      }
      /^[[:space:]]*-Doscar\.data\.tmpdir=\/tmp/ {
        data_tmp++
        if (state == 3) state = 4
      }
      END {
        exit !(state == 4 && java_opts == 1 && java_tmp == 1 &&
          javacpp_cache == 1 && data_tmp == 1)
      }
    ' "$entrypoint"
}
absolute_path() { case $1 in /*) printf '%s' "$1" ;; *) printf '%s/%s' "$release_dir" "${1#./}" ;; esac; }
canonical_directory() {
  local value=$1 resolved
  [[ $value == /* && $value != / && -d $value && ! -L $value ]] ||
    fail "Restore storage plane is not a non-root regular directory: $value"
  resolved=$(realpath -e -- "$value")
  [[ $resolved == "$value" ]] || fail "Restore storage plane is not canonical: $value"
  printf '%s' "$resolved"
}
paths_overlap() { [[ $1 == "$2" || $1 == "$2"/* || $2 == "$1"/* ]]; }
directory_bytes() {
  [[ -d $1 ]] || { printf 0; return; }
  du -sb -- "$1" 2>/dev/null | awk '{print $1+0}'
}
archive_scratch_json() {
  local scratch_path=$1 archive_path=$2
  compose exec -T oscar sh -eu -c '
    scratch=$1; archive=$2
    if [ ! -e "$scratch" ] && [ ! -L "$scratch" ]; then
      printf "{\"present\":false,\"realDirectory\":false,\"ownerUid\":null,\"ownerGid\":null,\"mode\":\"\",\"archiveDisjoint\":true,\"leaseFilePresent\":false,\"leaseFileRegular\":false,\"leaseFileOwnerUid\":null,\"leaseFileOwnerGid\":null,\"leaseFileMode\":\"\",\"entryCount\":0,\"unexpectedEntryCount\":0}\n"
      exit 0
    fi
    real_directory=false
    if [ -d "$scratch" ] && [ ! -L "$scratch" ]; then real_directory=true; fi
    owner=$(stat -c %u -- "$scratch" 2>/dev/null || printf -1)
    group=$(stat -c %g -- "$scratch" 2>/dev/null || printf -1)
    mode=$(stat -c %a -- "$scratch" 2>/dev/null || printf missing)
    lease="$scratch/.oscar-duckdb.lock"
    lease_present=false; lease_regular=false
    lease_owner=-1; lease_group=-1; lease_mode=missing
    if [ -e "$lease" ] || [ -L "$lease" ]; then
      lease_present=true
      if [ -f "$lease" ] && [ ! -L "$lease" ]; then lease_regular=true; fi
      lease_owner=$(stat -c %u -- "$lease" 2>/dev/null || printf -1)
      lease_group=$(stat -c %g -- "$lease" 2>/dev/null || printf -1)
      lease_mode=$(stat -c %a -- "$lease" 2>/dev/null || printf missing)
    fi
    entries=0; unexpected=0
    if [ "$real_directory" = true ]; then
      work=$(mktemp -d /tmp/oscar-scratch-health.XXXXXXXX)
      chmod 700 "$work"
      cleanup() { rm -rf -- "$work"; }
      trap cleanup EXIT HUP INT TERM
      find "$scratch" -xdev -mindepth 1 -maxdepth 1 -print0 >"$work/first.raw"
      LC_ALL=C sort -zu "$work/first.raw" >"$work/first.sorted"
      find "$scratch" -xdev -mindepth 1 -maxdepth 1 -print0 >"$work/second.raw"
      LC_ALL=C sort -zu "$work/second.raw" >"$work/second.sorted"
      inventory_stable=true
      cmp -s "$work/first.sorted" "$work/second.sorted" || inventory_stable=false
      classifier="$work/classifier.sh"
      cat >"$classifier" <<\OSCAR_SCRATCH_CLASSIFIER
root=$1
lease=$2
shift 2
newline=$(printf "\nx")
newline=${newline%x}
carriage_return=$(printf "\rx")
carriage_return=${carriage_return%x}
for child do
  if [ "$child" = "$lease" ]; then
    printf "lease\n"
    continue
  fi
  name=${child#"$root/"}
  case "$name" in
    *"$newline"*|*"$carriage_return"*) printf "unexpected\n"; continue ;;
  esac
  if printf "%s\n" "$name" |
       grep -Eq "^[a-z][a-z0-9-]{0,31}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" &&
     [ -d "$child" ] && [ ! -L "$child" ]; then
    real_child=$(realpath -e -- "$child" 2>/dev/null || true)
    if [ -n "$real_child" ] && [ "$(dirname -- "$real_child")" = "$root" ]; then
      printf "operation\n"
      continue
    fi
  fi
  printf "unexpected\n"
done
OSCAR_SCRATCH_CLASSIFIER
      chmod 600 "$classifier"
      if [ -s "$work/second.sorted" ]; then
        xargs -0 -r sh -eu "$classifier" "$scratch" "$lease" \
          <"$work/second.sorted" >"$work/classes"
      else
        : >"$work/classes"
      fi
      entries=$(grep -c "^operation$" "$work/classes" || true)
      unexpected=$(grep -c "^unexpected$" "$work/classes" || true)
      [ "$inventory_stable" = true ] || unexpected=$((unexpected+1))
    fi
    disjoint=false
    if [ "$real_directory" = true ] && [ -d "$archive" ] && [ ! -L "$archive" ]; then
      scratch_real=$(realpath -e -- "$scratch")
      archive_real=$(realpath -e -- "$archive")
      case "$scratch_real/" in "$archive_real/"*) ;; *)
        case "$archive_real/" in "$scratch_real/"*) ;; *) disjoint=true ;; esac
      esac
    fi
    printf "{\"present\":true,\"realDirectory\":%s,\"ownerUid\":%s,\"ownerGid\":%s,\"mode\":\"%s\",\"archiveDisjoint\":%s,\"leaseFilePresent\":%s,\"leaseFileRegular\":%s,\"leaseFileOwnerUid\":%s,\"leaseFileOwnerGid\":%s,\"leaseFileMode\":\"%s\",\"entryCount\":%s,\"unexpectedEntryCount\":%s}\n" \
      "$real_directory" "$owner" "$group" "$mode" "$disjoint" \
      "$lease_present" "$lease_regular" "$lease_owner" "$lease_group" "$lease_mode" \
      "${entries:-0}" "${unexpected:-0}"
  ' scratch-health "$scratch_path" "$archive_path"
}
archive_scratch_inventory() {
  compose exec -T oscar sh -eu -c '
    root=/var/lib/oscar/duckdb-tmp
    [ -d "$root" ] && [ ! -L "$root" ] || exit 20
    real_root=$(realpath -e -- "$root")
    [ "$real_root" = "$root" ] || exit 21
    [ "$(stat -c %u -- "$root")" = 10001 ] && [ "$(stat -c %g -- "$root")" = 10001 ] &&
      [ "$(stat -c %a -- "$root")" = 700 ] || exit 22
    lease="$root/.oscar-duckdb.lock"
    [ -f "$lease" ] && [ ! -L "$lease" ] || exit 23
    [ "$(stat -c %u -- "$lease")" = 10001 ] && [ "$(stat -c %g -- "$lease")" = 10001 ] &&
      [ "$(stat -c %a -- "$lease")" = 600 ] || exit 24
    root_identity=$(stat -c %d:%i -- "$root")
    lease_identity=$(stat -c %d:%i -- "$lease")
    work=$(mktemp -d /tmp/oscar-scratch-inventory.XXXXXXXX)
    chmod 700 "$work"
    cleanup() { rm -rf -- "$work"; }
    trap cleanup EXIT HUP INT TERM
    validator="$work/validator.sh"
    cat >"$validator" <<\OSCAR_SCRATCH_CHILD
root=$1
lease=$2
shift 2
newline=$(printf "\nx")
newline=${newline%x}
carriage_return=$(printf "\rx")
carriage_return=${carriage_return%x}
for child do
  [ "$child" != "$lease" ] || continue
  name=${child#"$root/"}
  case "$name" in
    *"$newline"*|*"$carriage_return"*) exit 30 ;;
  esac
  printf "%s\n" "$name" |
    grep -Eq "^[a-z][a-z0-9-]{0,31}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" || exit 31
  [ -e "$child" ] || [ -L "$child" ] || exit 25
  [ -d "$child" ] && [ ! -L "$child" ] || exit 32
  real_child=$(realpath -e -- "$child") || exit 25
  [ "$(dirname -- "$real_child")" = "$root" ] || exit 33
  printf "%s\n" "$name"
done
OSCAR_SCRATCH_CHILD
    chmod 600 "$validator"
    attempt=0
    while :; do
      attempt=$((attempt+1))
      find "$root" -xdev -mindepth 1 -maxdepth 1 -print0 >"$work/first.raw"
      LC_ALL=C sort -zu "$work/first.raw" >"$work/first.sorted"
      find "$root" -xdev -mindepth 1 -maxdepth 1 -print0 >"$work/second.raw"
      LC_ALL=C sort -zu "$work/second.raw" >"$work/second.sorted"
      if ! cmp -s "$work/first.sorted" "$work/second.sorted"; then
        [ "$attempt" -lt 50 ] || { cmp -s "$work/first.sorted" "$work/second.sorted" || exit 25; }
        sleep 0.1
        continue
      fi
      if [ -s "$work/second.sorted" ]; then
        if xargs -0 -r sh -eu "$validator" "$root" "$lease" \
             <"$work/second.sorted" >"$work/operations"; then
          break
        else
          rc=$?
          [ "$attempt" -lt 50 ] || exit "$rc"
          sleep 0.1
          continue
        fi
      else
        : >"$work/operations"
        break
      fi
    done
    [ "$(stat -c %d:%i -- "$root")" = "$root_identity" ] &&
      [ "$(stat -c %u:%g:%a -- "$root")" = 10001:10001:700 ] &&
      [ "$(stat -c %d:%i -- "$lease")" = "$lease_identity" ] &&
      [ "$(stat -c %u:%g:%a -- "$lease")" = 10001:10001:600 ] &&
      [ -f "$lease" ] && [ ! -L "$lease" ] || exit 34
    LC_ALL=C sort -u "$work/operations"
  ' scratch-inventory
}
scratch_inventory_json() {
  local inventory=$1 line count=0 first=true
  [[ -f $inventory && ! -L $inventory ]] ||
    fail 'DuckDB scratch inventory is not a regular file.'
  printf '['
  while IFS= read -r line; do
    [[ $line =~ ^[a-z][a-z0-9-]{0,31}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
      fail 'DuckDB scratch inventory contains an unsafe identity.'
    count=$((count+1)); ((count <= 512)) ||
      fail 'DuckDB scratch inventory exceeds its 512-entry safety bound.'
    $first || printf ','
    first=false
    printf '"%s"' "$line"
  done <"$inventory"
  printf ']'
}
media_metadata_health_json() {
  local checkpoint=/var/lib/oscar/files/videos/retained-media/v1/.metadata-reclamation-checkpoint.json
  local checkpoint_present=false checkpoint_valid=false checkpoint_schema=null checkpoint_encoded='' checkpoint_result=''
  checkpoint_encoded=$(compose exec -T oscar sh -eu -c '
    path=$1
    if [ ! -e "$path" ] && [ ! -L "$path" ]; then exit 0; fi
    [ -f "$path" ] && [ ! -L "$path" ] || exit 20
    size=$(stat -c %s -- "$path")
    [ "$size" -gt 0 ] && [ "$size" -le 1048576 ] || exit 21
    openssl base64 -A -in "$path"
  ' media-metadata-checkpoint "$checkpoint") || fail 'Media metadata checkpoint is linked, non-regular, empty, or over 1 MiB.'
  if [[ -n $checkpoint_encoded ]]; then
    checkpoint_present=true
    [[ $checkpoint_encoded =~ ^[A-Za-z0-9+/]+=*$ && ${#checkpoint_encoded} -le 1398104 ]] ||
      fail 'Media metadata checkpoint is not bounded canonical base64.'
    checkpoint_result=$(scalar "WITH source AS (
        SELECT convert_from(decode('$checkpoint_encoded','base64'),'UTF8') AS text),
      doc AS (SELECT text::json AS raw, text::jsonb AS value FROM source)
      SELECT coalesce(value->>'schemaVersion','')||'|'||(
        jsonb_typeof(value)='object'
        AND (SELECT count(*) FROM json_object_keys(raw))=3
        AND value ?& ARRAY['schemaVersion','earliestProcessedObservationEpochHour','updatedAt']
        AND value->'schemaVersion'='2'::jsonb
        AND (jsonb_typeof(value->'earliestProcessedObservationEpochHour')='null' OR
          (jsonb_typeof(value->'earliestProcessedObservationEpochHour')='number'
           AND value->>'earliestProcessedObservationEpochHour' ~ '^(0|[1-9][0-9]*)$'
           AND (value->>'earliestProcessedObservationEpochHour')::numeric <= 8765802740110))
        AND jsonb_typeof(value->'updatedAt')='string'
        AND value->>'updatedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?Z$'
        AND (value->>'updatedAt')::timestamptz IS NOT NULL
      )::text FROM doc;")
    IFS='|' read -r checkpoint_schema checkpoint_valid_text <<<"$checkpoint_result"
    [[ $checkpoint_schema =~ ^[0-9]+$ ]] || checkpoint_schema=null
    [[ $checkpoint_valid_text == true ]] && checkpoint_valid=true
  fi
  compose exec -T oscar sh -eu -c '
    checkpoint_present=$1; checkpoint_valid=$2; checkpoint_schema=$3
    root=/var/lib/oscar/files/videos/retained-media/v1
    if [ ! -e "$root" ] && [ ! -L "$root" ]; then
      printf "{\"rootPresent\":false,\"checkpointPresent\":false,\"checkpointValid\":false,\"checkpointSchemaVersion\":null,\"totalEntries\":0,\"regularFiles\":0,\"directories\":0,\"processedIndexFiles\":0,\"processedIndexBytes\":0,\"deletionIndexFiles\":0,\"deletionIndexBytes\":0,\"retainedManifestFiles\":0,\"retainedJpegFiles\":0,\"legacyProcessedMarkerFiles\":0,\"legacyDeletionTombstones\":0,\"partialArtifacts\":0,\"unsafeEntries\":0,\"indexFormatFailures\":0}\n"
      exit 0
    fi
    [ -d "$root" ] && [ ! -L "$root" ] || exit 20
    inventory_file=$(mktemp /tmp/oscar-media-inventory.XXXXXX)
    cleanup_inventory() { rm -f -- "$inventory_file"; }
    trap cleanup_inventory EXIT HUP INT TERM
    newline=$(printf "\nx"); newline=${newline%x}; tab=$(printf "\t")
    find "$root" -xdev -mindepth 1 \( -name "*$newline*" -o -name "*$tab*" \) \
      -print -quit >"$inventory_file"
    [ ! -s "$inventory_file" ] || exit 21
    find "$root" -xdev -mindepth 1 -printf "%y\t%P\n" >"$inventory_file"
    inventory=$(awk -F "\t" "
      BEGIN { total=0; regular=0; directories=0; manifests=0; jpegs=0;
              legacy_processed=0; legacy_deleted=0; partials=0; unsafe=0 }
      {
        type=\$1; path=substr(\$0,index(\$0,\"\t\")+1); total++
        if (type == \"f\") regular++
        else if (type == \"d\") directories++
        else unsafe++
        if (path !~ /^[A-Za-z0-9._\/-]+$/) unsafe++
        if (type == \"f\" && path ~ /(^|\/)[^\/]*[.](partial|tmp)([.-].*)?$/) partials++
        if (type == \"f\" && path ~ /^events\/.+\/manifest[.]json$/) manifests++
        if (type == \"f\" && path ~ /^events\/.+\/frame-0[1-5][.]jpg$/) jpegs++
        if (type == \"f\" && path ~ /^retention-processed\/.+[.]json$/) legacy_processed++
        if (type == \"f\" && path ~ /^events\/.+\/[.]deleted[.]json$/) legacy_deleted++
      }
      END { printf \"%d|%d|%d|%d|%d|%d|%d|%d|%d\", total, regular, directories,
                   manifests, jpegs, legacy_processed, legacy_deleted, partials, unsafe }
    " "$inventory_file")
    rm -f -- "$inventory_file"
    trap - EXIT HUP INT TERM
    IFS="|" read -r total_entries regular_files directories manifests jpegs legacy_processed \
      legacy_deleted partials unsafe inventory_extra <<EOF
$inventory
EOF
    [ -z "${inventory_extra:-}" ] || exit 21
    for count in "$total_entries" "$regular_files" "$directories" "$manifests" "$jpegs" \
      "$legacy_processed" "$legacy_deleted" "$partials" "$unsafe"; do
      printf "%s" "$count" | grep -Eq "^[0-9]+$" || exit 21
    done
    processed_files=0; processed_bytes=0; deletion_files=0; deletion_bytes=0; format_failures=0
    processed_root="$root/retention-processed-index"
    if [ -e "$processed_root" ] || [ -L "$processed_root" ]; then
      if [ ! -d "$processed_root" ] || [ -L "$processed_root" ]; then unsafe=$((unsafe+1)); else
        while IFS= read -r index; do
          [ "$index" ] || continue
          name=${index##*/}; processed_files=$((processed_files+1))
          size=$(stat -c %s -- "$index" 2>/dev/null || printf 0)
          processed_bytes=$((processed_bytes+size))
          header=$(od -An -tx1 -N16 -- "$index" 2>/dev/null | tr -d " [:space:]")
          if ! printf "%s" "$name" | grep -Eq "^[0-9]{19}-(0[0-9]|1[01])[.]idx$" ||
             [ "$size" -lt 16 ] || [ $(((size-16)%36)) -ne 0 ] ||
             [ "$header" != 4f534341524d50490000000100000024 ]; then
            format_failures=$((format_failures+1))
          fi
        done <<EOF
$(find "$processed_root" -mindepth 1 -maxdepth 1 -type f -name "*.idx" -print | LC_ALL=C sort)
EOF
        unexpected=$(find "$processed_root" -mindepth 1 -maxdepth 1 ! -type f -print | wc -l | tr -d "[:space:]")
        unexpected_files=$(find "$processed_root" -mindepth 1 -maxdepth 1 -type f ! -name "*.idx" ! -name ".index.lock" -print | wc -l | tr -d "[:space:]")
        unsafe=$((unsafe+unexpected+unexpected_files))
        lock="$processed_root/.index.lock"
        if [ -e "$lock" ] || [ -L "$lock" ]; then
          if [ ! -f "$lock" ] || [ -L "$lock" ] || [ "$(stat -c %s -- "$lock" 2>/dev/null || printf -1)" -ne 0 ]; then
            unsafe=$((unsafe+1))
          fi
        fi
      fi
    fi
    deletion_root="$root/deletion-index"
    if [ -e "$deletion_root" ] || [ -L "$deletion_root" ]; then
      if [ ! -d "$deletion_root" ] || [ -L "$deletion_root" ]; then unsafe=$((unsafe+1)); else
        while IFS= read -r index; do
          [ "$index" ] || continue
          relative=${index#"$deletion_root"/}; shard=${relative%%/*}; name=${relative##*/}
          deletion_files=$((deletion_files+1))
          size=$(stat -c %s -- "$index" 2>/dev/null || printf 0)
          deletion_bytes=$((deletion_bytes+size))
          header=$(od -An -tx1 -N16 -- "$index" 2>/dev/null | tr -d " [:space:]")
          index_prefix=$(printf "%s" "${name%.idx}" | cut -c1-2)
          if ! printf "%s/%s" "$shard" "$name" | grep -Eq "^[0-9a-f]{2}/[0-9a-f]{4}[.]idx$" ||
             [ "$index_prefix" != "$shard" ]; then
            format_failures=$((format_failures+1))
          fi
          if [ "$size" -lt 16 ] || [ $(((size-16)%36)) -ne 0 ] ||
             [ "$header" != 4f534341524d44490000000100000024 ]; then
            format_failures=$((format_failures+1))
          fi
        done <<EOF
$(find "$deletion_root" -mindepth 2 -maxdepth 2 -type f -name "*.idx" -print | LC_ALL=C sort)
EOF
        unexpected=$(find "$deletion_root" -mindepth 1 -maxdepth 1 ! -type d -print | wc -l | tr -d "[:space:]")
        invalid_shards=$(find "$deletion_root" -mindepth 1 -maxdepth 1 -type d ! -name "[0-9a-f][0-9a-f]" -print | wc -l | tr -d "[:space:]")
        unexpected_files=$(find "$deletion_root" -mindepth 2 -maxdepth 2 -type f ! -name "*.idx" ! -name ".index.lock" -print | wc -l | tr -d "[:space:]")
        unexpected_members=$(find "$deletion_root" -mindepth 2 -maxdepth 2 ! -type f -print | wc -l | tr -d "[:space:]")
        unexpected_deep=$(find "$deletion_root" -mindepth 3 -print | wc -l | tr -d "[:space:]")
        invalid_locks=0
        while IFS= read -r lock; do
          [ "$lock" ] || continue
          if [ ! -f "$lock" ] || [ -L "$lock" ] || [ "$(stat -c %s -- "$lock" 2>/dev/null || printf -1)" -ne 0 ]; then
            invalid_locks=$((invalid_locks+1))
          fi
        done <<EOF
$(find "$deletion_root" -mindepth 2 -maxdepth 2 -name ".index.lock" -print | LC_ALL=C sort)
EOF
        unsafe=$((unsafe+unexpected+invalid_shards+unexpected_files+unexpected_members+unexpected_deep+invalid_locks))
      fi
    fi
    printf "{\"rootPresent\":true,\"checkpointPresent\":%s,\"checkpointValid\":%s,\"checkpointSchemaVersion\":%s,\"totalEntries\":%s,\"regularFiles\":%s,\"directories\":%s,\"processedIndexFiles\":%s,\"processedIndexBytes\":%s,\"deletionIndexFiles\":%s,\"deletionIndexBytes\":%s,\"retainedManifestFiles\":%s,\"retainedJpegFiles\":%s,\"legacyProcessedMarkerFiles\":%s,\"legacyDeletionTombstones\":%s,\"partialArtifacts\":%s,\"unsafeEntries\":%s,\"indexFormatFailures\":%s}\n" \
      "$checkpoint_present" "$checkpoint_valid" "$checkpoint_schema" "$total_entries" "$regular_files" \
      "$directories" "$processed_files" "$processed_bytes" \
      "$deletion_files" "$deletion_bytes" "${manifests:-0}" "${jpegs:-0}" "${legacy_processed:-0}" \
      "${legacy_deleted:-0}" "${partials:-0}" "${unsafe:-0}" "$format_failures"
  ' media-metadata-health "$checkpoint_present" "$checkpoint_valid" "$checkpoint_schema"
}
retention_runtime_health_json() {
  local checkpoint=/var/lib/oscar/files/videos/retained-media/v1/.retention-scan-checkpoint.json
  local encoded='' result='' schema=null valid=false processed=null updated=null lag=null
  encoded=$(compose exec -T oscar sh -eu -c '
    path=$1
    if [ ! -e "$path" ] && [ ! -L "$path" ]; then exit 0; fi
    [ -f "$path" ] && [ ! -L "$path" ] || exit 20
    size=$(stat -c %s -- "$path")
    [ "$size" -gt 0 ] && [ "$size" -le 1048576 ] || exit 21
    openssl base64 -A -in "$path"
  ' retention-scan-checkpoint "$checkpoint") ||
    fail 'Retention scan checkpoint is linked, non-regular, empty, or over 1 MiB.'
  if [[ -z $encoded ]]; then
    printf '{"checkpointPresent":false,"checkpointValid":false,"checkpointSchemaVersion":null,"processedThrough":null,"updatedAt":null,"cursorLagSeconds":null}\n'
    return
  fi
  [[ $encoded =~ ^[A-Za-z0-9+/]+=*$ && ${#encoded} -le 1398104 ]] ||
    fail 'Retention scan checkpoint is not bounded canonical base64.'
  result=$(scalar "WITH source AS (
      SELECT convert_from(decode('$encoded','base64'),'UTF8') AS text),
    doc AS (SELECT text::json AS raw, text::jsonb AS value FROM source),
    checked AS (
      SELECT raw,value,(
        jsonb_typeof(value)='object'
        AND (SELECT count(*) FROM json_object_keys(raw))=3
        AND value ?& ARRAY['schemaVersion','processedThrough','updatedAt']
        AND value->'schemaVersion'='1'::jsonb
        AND jsonb_typeof(value->'processedThrough')='string'
        AND value->>'processedThrough' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?Z$'
        AND jsonb_typeof(value->'updatedAt')='string'
        AND value->>'updatedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?Z$'
      ) AS valid FROM doc)
    SELECT coalesce(value->>'schemaVersion','')||'|'||valid::text||'|'||
      CASE WHEN valid THEN value->>'processedThrough' ELSE '' END||'|'||
      CASE WHEN valid THEN value->>'updatedAt' ELSE '' END||'|'||
      CASE WHEN valid THEN greatest(0,floor(extract(epoch FROM
        (clock_timestamp()-(value->>'processedThrough')::timestamptz))))::bigint::text ELSE '' END
    FROM checked;")
  IFS='|' read -r schema valid_text processed_text updated_text lag_text extra <<<"$result"
  [[ -z ${extra:-} ]] || fail 'Retention scan checkpoint produced an ambiguous result.'
  [[ $schema =~ ^[0-9]+$ ]] || schema=null
  if [[ $valid_text == true ]]; then
    valid=true
    safe_json_text "$processed_text"; safe_json_text "$updated_text"
    [[ $lag_text =~ ^[0-9]+$ ]] || fail 'Retention scan checkpoint lag is invalid.'
    processed=\"$processed_text\"; updated=\"$updated_text\"; lag=$lag_text
  fi
  printf '{"checkpointPresent":true,"checkpointValid":%s,"checkpointSchemaVersion":%s,"processedThrough":%s,"updatedAt":%s,"cursorLagSeconds":%s}\n' \
    "$valid" "$schema" "$processed" "$updated" "$lag"
}
tree_fingerprint() {
  local path=$1
  if [[ ! -e $path && ! -L $path ]]; then printf absent; return; fi
  [[ -d $path && ! -L $path ]] || fail "Fingerprint target is not a real directory: $path"
  find "$path" -xdev -printf '%P|%y|%s|%T@\n' | LC_ALL=C sort | sha256sum | awk '{print $1}'
}
running_services_fingerprint() {
  compose ps --status running --format '{{.Service}}|{{.ID}}' | LC_ALL=C sort |
    sha256sum | awk '{print $1}'
}
safe_json_text() {
  [[ ${1:-} =~ ^[A-Za-z0-9._/:@+,()%\ -]*$ ]] || fail "Unsafe value in probe JSON: ${1:-}"
}
sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum -- "$1" | awk '{print $1}'
  else shasum --algorithm 256 -- "$1" | awk '{print $1}'
  fi
}
valid_backup_relative_path() {
  local relative=$1 segment remainder
  [[ $relative =~ ^[A-Za-z0-9._/-]+$ && $relative != /* && $relative != *'//' ]] || return 1
  remainder=$relative
  while :; do
    case $remainder in */*) segment=${remainder%%/*}; remainder=${remainder#*/} ;; *) segment=$remainder; remainder='' ;; esac
    [[ -n $segment && $segment != . && $segment != .. ]] || return 1
    [[ -n $remainder ]] || break
  done
}
calculate_backup_manifest_hmac() {
  local root=$1 key_file=$2 image=$3
  sudo docker run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges --user 0 --entrypoint sh \
    --volume "$root:/backup:ro" --volume "$key_file:/backup-key.txt:ro" "$image" -eu -c '
      key=$(cat /backup-key.txt)
      openssl dgst -sha256 -hmac "$key" -binary /backup/SHA256SUMS | openssl base64 -A
    ' | tr -d '\r\n'
}
verify_backup_core_authentication() (
  set -Eeuo pipefail
  local root=$1 key_file=$2 image=$3 root_real expected actual line digest relative candidate resolved
  local work manifest_paths actual_paths count=0
  [[ -d $root && ! -L $root && -f $root/SHA256SUMS && ! -L $root/SHA256SUMS &&
     -s $root/SHA256SUMS && -f $root/SHA256SUMS.hmac && ! -L $root/SHA256SUMS.hmac &&
     -s $root/SHA256SUMS.hmac && -f $key_file && ! -L $key_file && -n $image ]] || {
    printf 'Independent backup authentication inputs are unsafe.\n' >&2; return 1; }
  [[ $(file_size "$root/SHA256SUMS") -le 16777216 ]] || {
    printf 'Authenticated checksum manifest exceeds 16 MiB.\n' >&2; return 1; }
  root_real=$(realpath -e -- "$root")
  [[ $root_real == "$root" ]] || {
    printf 'Backup root is not canonical.\n' >&2; return 1; }
  expected=$(tr -d '\r\n' <"$root/SHA256SUMS.hmac")
  [[ $expected =~ ^[A-Za-z0-9+/]{43}=$ ]] || {
    printf 'Backup core HMAC is malformed.\n' >&2; return 1; }
  actual=$(calculate_backup_manifest_hmac "$root" "$key_file" "$image")
  [[ $actual == "$expected" ]] || {
    printf 'Independent SHA256SUMS HMAC verification failed.\n' >&2; return 1; }
  work=$(mktemp -d /tmp/oscar-regression-backup-auth.XXXXXXXX)
  trap 'rm -rf -- "$work"' EXIT HUP INT TERM
  manifest_paths=$work/manifest-paths
  actual_paths=$work/actual-paths
  : >"$manifest_paths"; : >"$actual_paths"
  while IFS= read -r line || [[ -n $line ]]; do
    count=$((count+1)); [[ $count -le 10000 ]] || {
      printf 'Authenticated checksum manifest exceeds 10,000 entries.\n' >&2; return 1; }
    [[ $line =~ ^([0-9a-f]{64})\ \ \./([A-Za-z0-9._/-]+)$ ]] || {
      printf 'Authenticated checksum entry is noncanonical.\n' >&2; return 1; }
    digest=${BASH_REMATCH[1]}; relative=${BASH_REMATCH[2]}
    valid_backup_relative_path "$relative" || {
      printf 'Authenticated checksum path is unsafe.\n' >&2; return 1; }
    candidate="$root/$relative"
    [[ -f $candidate && ! -L $candidate ]] || {
      printf 'Authenticated backup object is missing, linked, or non-regular.\n' >&2; return 1; }
    resolved=$(realpath -e -- "$candidate")
    [[ $resolved == "$root_real"/* ]] || {
      printf 'Authenticated backup object escapes its root.\n' >&2; return 1; }
    [[ $(sha256_file "$candidate") == "$digest" ]] || {
      printf 'Authenticated backup object checksum mismatch.\n' >&2; return 1; }
    printf '%s\n' "$relative" >>"$manifest_paths"
  done <"$root/SHA256SUMS"
  [[ $count -gt 0 && -z $(LC_ALL=C sort "$manifest_paths" | uniq -d) ]] || {
    printf 'Authenticated checksum manifest is empty or has duplicate paths.\n' >&2; return 1; }
  while IFS= read -r -d '' candidate; do
    [[ ! -L $candidate && ( -f $candidate || -d $candidate ) ]] || {
      printf 'Backup tree contains a link or special entry.\n' >&2; return 1; }
    [[ -f $candidate ]] || continue
    relative=${candidate#"$root/"}
    case $relative in VERIFIED|JOURNAL_CONFIRMED|SHA256SUMS|SHA256SUMS.hmac) continue ;; esac
    valid_backup_relative_path "$relative" || {
      printf 'Backup filesystem contains an unsafe path.\n' >&2; return 1; }
    printf '%s\n' "$relative" >>"$actual_paths"
  done < <(find "$root" -mindepth 1 -print0)
  LC_ALL=C sort -o "$manifest_paths" "$manifest_paths"
  LC_ALL=C sort -o "$actual_paths" "$actual_paths"
  cmp -s "$manifest_paths" "$actual_paths" || {
    printf 'Authenticated manifest does not exactly cover backup payload files.\n' >&2; return 1; }
  printf verified
)
file_size() {
  if stat -c %s "$1" >/dev/null 2>&1; then stat -c %s "$1"; else stat -f %z "$1"; fi
}
journal_prefix_matches() {
  local expected_sha=$1 expected_bytes=$2 candidate=$3 actual_size actual_sha
  [[ $expected_sha =~ ^[0-9a-f]{64}$ && $expected_bytes =~ ^[1-9][0-9]*$ &&
     -f $candidate && ! -L $candidate ]] || return 1
  actual_size=$(wc -c <"$candidate" | tr -d '[:space:]')
  [[ $actual_size =~ ^[0-9]+$ && $actual_size -ge $expected_bytes ]] || return 1
  if command -v sha256sum >/dev/null 2>&1; then
    actual_sha=$(head -c "$expected_bytes" -- "$candidate" | sha256sum | awk '{print $1}')
  else
    actual_sha=$(head -c "$expected_bytes" -- "$candidate" | shasum --algorithm 256 | awk '{print $1}')
  fi
  [[ $actual_sha == "$expected_sha" ]]
}
emit_command_diagnostics() {
  local label=$1 log=$2
  [[ -f $log && ! -L $log ]] || return 0
  printf '%s failed; bounded diagnostics follow:\n' "$label" >&2
  tail -n 200 -- "$log" >&2 || true
}
append_live_backup_member() {
  local inventory=$1 kind=$2 member=$3 expected_sha=${4:-} expected_bytes=${5:-}
  local live result_sha result_bytes
  [[ $kind =~ ^(M|J|C|P|D)$ ]] || fail 'Retained backup expectation has an invalid member kind.'
  [[ $member =~ ^files/videos/retained-media/v1/[A-Za-z0-9._/-]+$ &&
     $member != *'/../'* && $member != */.. && $member != *'//' ]] ||
    fail 'Retained backup expectation has an unsafe member path.'
  live=$(compose exec -T oscar sh -eu -c '
    path=/var/lib/oscar/$1
    [ -f "$path" ] && [ ! -L "$path" ]
    size=$(stat -c %s -- "$path")
    [ "$size" -gt 0 ]
    sha=$(sha256sum -- "$path" | awk "{print \$1}")
    printf "%s|%s\\n" "$sha" "$size"
  ' retained-backup-member "$member") || fail "Expected retained backup member is missing or unsafe: $member"
  IFS='|' read -r result_sha result_bytes extra <<<"$live"
  [[ -z ${extra:-} && $result_sha =~ ^[0-9a-f]{64}$ && $result_bytes =~ ^[1-9][0-9]*$ ]] ||
    fail 'Retained backup member snapshot returned invalid hash/size metadata.'
  [[ -z $expected_sha || $result_sha == "$expected_sha" ]] ||
    fail "Live retained frame hash does not match its authenticated API manifest: $member"
  [[ -z $expected_bytes || $result_bytes == "$expected_bytes" ]] ||
    fail "Live retained frame size does not match its authenticated API manifest: $member"
  printf '%s|%s|%s|%s\n' "$kind" "$member" "$result_sha" "$result_bytes" >>"$inventory"
}
append_quiesced_backup_member() {
  local inventory=$1 kind=$2 member=$3 image=$4 expected_sha=${5:-} expected_bytes=${6:-}
  local snapshot result_sha result_bytes extra
  [[ $kind =~ ^(M|J|C|P|D)$ && -n $image ]] ||
    fail 'Quiesced retained backup expectation has an invalid member kind or image.'
  [[ $member =~ ^files/videos/retained-media/v1/[A-Za-z0-9._/-]+$ &&
     $member != *'/../'* && $member != */.. && $member != *'//' ]] ||
    fail 'Quiesced retained backup expectation has an unsafe member path.'
  snapshot=$(docker run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges --workdir / --user 10001:10001 --entrypoint sh \
    --volume oscar_oscar_state:/state:ro "$image" -eu -c '
      path=/state/$1
      [ -f "$path" ] && [ ! -L "$path" ]
      size=$(stat -c %s -- "$path")
      [ "$size" -gt 0 ]
      sha=$(sha256sum -- "$path" | awk "{print \$1}")
      printf "%s|%s\\n" "$sha" "$size"
    ' retained-backup-member "$member") ||
    fail "Expected quiesced retained backup member is missing or unsafe: $member"
  IFS='|' read -r result_sha result_bytes extra <<<"$snapshot"
  [[ -z ${extra:-} && $result_sha =~ ^[0-9a-f]{64}$ && $result_bytes =~ ^[1-9][0-9]*$ ]] ||
    fail 'Quiesced retained backup member snapshot returned invalid hash/size metadata.'
  [[ -z $expected_sha || $result_sha == "$expected_sha" ]] ||
    fail "Quiesced retained frame hash does not match its authenticated API manifest: $member"
  [[ -z $expected_bytes || $result_bytes == "$expected_bytes" ]] ||
    fail "Quiesced retained frame size does not match its authenticated API manifest: $member"
  printf '%s|%s|%s|%s\n' "$kind" "$member" "$result_sha" "$result_bytes" >>"$inventory"
}
copy_quiesced_confirmation_member() {
  local member=$1 destination=$2 image=$3 byte_limit=$4 actual_bytes
  [[ -n $image && $byte_limit =~ ^[1-9][0-9]*$ && $byte_limit -le 1048576 ]] ||
    fail 'Quiesced daily-journal confirmation copy has invalid bounds.'
  [[ $member =~ ^files/[.]dailyfile-journal/backup-confirmations/([.]sets/[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}|[A-Za-z0-9._-]+/[0-9]{4}-[0-9]{2}-[0-9]{2})[.]json$ ]] ||
    fail 'Quiesced daily-journal confirmation member has an unsafe path.'
  docker run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges --workdir / --user 10001:10001 --entrypoint sh \
    --volume oscar_oscar_state:/state:ro "$image" -eu -c '
      member=$1
      limit=$2
      path=/state/$member
      current=/state
      old_ifs=$IFS
      IFS=/
      set -- $member
      IFS=$old_ifs
      for component do
        [ -n "$component" ] && [ "$component" != . ] && [ "$component" != .. ]
        current=$current/$component
        [ ! -L "$current" ]
      done
      [ -f "$path" ]
      size=$(stat -c %s -- "$path")
      [ "$size" -gt 0 ] && [ "$size" -le "$limit" ]
      cat -- "$path"
    ' live-journal-confirmation "$member" "$byte_limit" >"$destination" ||
    fail "Required quiesced daily-journal confirmation member is missing or unsafe: $member"
  [[ -f $destination && ! -L $destination ]] ||
    fail 'Quiesced daily-journal confirmation copy is not a regular file.'
  actual_bytes=$(file_size "$destination")
  [[ $actual_bytes =~ ^[1-9][0-9]*$ && $actual_bytes -le $byte_limit ]] ||
    fail 'Quiesced daily-journal confirmation copy violated its byte bound.'
}
verify_retained_backup_members() {
  local archive=$1 inventory=$2 work=$3 listing member_file line kind member expected_sha expected_bytes
  local lookup matches raw verbose actual_sha actual_bytes header verified=0
  [[ -f $archive && ! -L $archive && -f $inventory && ! -L $inventory && -s $inventory &&
     -d $work && ! -L $work ]] || fail 'Retained backup verification inputs are missing or unsafe.'
  listing=$work/state-members.txt
  tar -tzf "$archive" >"$listing"
  [[ $(wc -l <"$listing" | tr -d '[:space:]') -le 200000 ]] ||
    fail 'OSCAR state backup member inventory exceeds its 200,000-entry safety bound.'
  ! grep -Eq '(^/|(^|/)[.][.](/|$))' "$listing" ||
    fail 'OSCAR state backup contains an absolute or traversal member.'
  [[ $(cut -d'|' -f2 "$inventory" | LC_ALL=C sort | uniq -d | wc -l | tr -d '[:space:]') == 0 ]] ||
    fail 'Retained backup expectation contains duplicate member identities.'
  while IFS='|' read -r kind member expected_sha expected_bytes extra; do
    [[ -z ${extra:-} && $kind =~ ^(M|J|C|P|D)$ &&
       $member =~ ^files/videos/retained-media/v1/[A-Za-z0-9._/-]+$ &&
       $expected_sha =~ ^[0-9a-f]{64}$ && $expected_bytes =~ ^[1-9][0-9]*$ ]] ||
      fail 'Retained backup expectation inventory is malformed.'
    lookup=$(awk -v expected="$member" '
      { normalized=$0; if (substr(normalized,1,2)=="./") normalized=substr(normalized,3);
        if (normalized==expected) { count++; raw=$0 } }
      END { printf "%d|%s", count+0, raw }
    ' "$listing")
    IFS='|' read -r matches raw <<<"$lookup"
    [[ $matches == 1 && -n $raw ]] ||
      fail "Backup must contain exactly one expected retained member: $member"
    verbose=$(tar -tvzf "$archive" -- "$raw")
    [[ $(printf '%s\n' "$verbose" | wc -l | tr -d '[:space:]') == 1 ]] ||
      fail "Backup retained member has an ambiguous archive type: $member"
    [[ ${verbose:0:1} == - ]] || fail "Backup retained member is not a regular file: $member"
    member_file=$work/member-$verified
    tar -xOf "$archive" -- "$raw" >"$member_file"
    [[ -f $member_file && ! -L $member_file ]] || fail "Could not stream retained backup member: $member"
    actual_sha=$(sha256_file "$member_file")
    actual_bytes=$(file_size "$member_file")
    [[ $actual_sha == "$expected_sha" && $actual_bytes == "$expected_bytes" ]] ||
      fail "Retained backup member hash or size changed: $member"
    case $kind in
      J)
        header=$(od -An -tx1 -N2 -- "$member_file" | tr -d ' [:space:]')
        [[ $header == ffd8 && $(tail -c 2 -- "$member_file" | od -An -tx1 | tr -d ' [:space:]') == ffd9 ]] ||
          fail "Retained backup JPEG has an invalid content type: $member"
        ;;
      M|C)
        grep -Eq '^[[:space:]]*[{]' "$member_file" && grep -Eq '[}][[:space:]]*$' "$member_file" ||
          fail "Retained backup JSON has an invalid content type: $member"
        ;;
      P)
        header=$(od -An -tx1 -N16 -- "$member_file" | tr -d ' [:space:]')
        [[ $header == 4f534341524d50490000000100000024 && $actual_bytes -ge 16 &&
           $(((actual_bytes-16)%36)) -eq 0 ]] ||
          fail "Retained backup processed index has an invalid content type: $member"
        ;;
      D)
        header=$(od -An -tx1 -N16 -- "$member_file" | tr -d ' [:space:]')
        [[ $header == 4f534341524d44490000000100000024 && $actual_bytes -ge 16 &&
           $(((actual_bytes-16)%36)) -eq 0 ]] ||
          fail "Retained backup deletion index has an invalid content type: $member"
        ;;
    esac
    verified=$((verified+1))
  done <"$inventory"
  printf '%s' "$verified"
}
verify_daily_receipt_backup_members() {
  local archive=$1 listing=$2 directory_id=$3 day=$4 inventory=$5 work=$6
  local expected_names actual_names prefix name expected_bytes expected_sha lookup matches raw verbose member
  local actual_bytes actual_sha verified=0
  [[ -f $archive && ! -L $archive && -f $listing && ! -L $listing &&
     $directory_id =~ ^[A-Za-z0-9._-]+$ &&
     $day =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ && -s $inventory ]] || return 1
  expected_names=$(mktemp "$work/expected-segments.XXXXXXXX")
  actual_names=$(mktemp "$work/actual-segments.XXXXXXXX")
  : >"$expected_names"; : >"$actual_names"
  prefix="files/.dailyfile-journal/segments/$directory_id/$day/"
  while IFS='|' read -r name expected_bytes expected_sha extra; do
    [[ -z ${extra:-} && $name =~ ^[0-9]{6}[.]seg$ &&
       $expected_bytes =~ ^[1-9][0-9]*$ && $expected_sha =~ ^[0-9a-f]{64}$ ]] || return 1
    printf '%s\n' "$name" >>"$expected_names"
    lookup=$(awk -v expected="$prefix$name" '
      { normalized=$0; if (substr(normalized,1,2)=="./") normalized=substr(normalized,3);
        if (normalized==expected) { count++; raw=$0 } }
      END { printf "%d|%s", count+0, raw }
    ' "$listing")
    IFS='|' read -r matches raw <<<"$lookup"
    [[ $matches == 1 && -n $raw ]] || return 1
    verbose=$(tar -tvzf "$archive" -- "$raw")
    [[ $(printf '%s\n' "$verbose" | wc -l | tr -d '[:space:]') == 1 && ${verbose:0:1} == - ]] || return 1
    member=$(mktemp "$work/daily-segment.XXXXXXXX")
    tar -xOf "$archive" -- "$raw" >"$member"
    actual_bytes=$(file_size "$member"); actual_sha=$(sha256_file "$member")
    [[ $actual_bytes == "$expected_bytes" && $actual_sha == "$expected_sha" ]] || return 1
    rm -f -- "$member"
    verified=$((verified+1))
  done <"$inventory"
  [[ $verified -gt 0 && -z $(LC_ALL=C sort "$expected_names" | uniq -d) ]] || return 1
  awk -v prefix="$prefix" '
    { normalized=$0; if (substr(normalized,1,2)=="./") normalized=substr(normalized,3);
      if (index(normalized,prefix)==1) {
        name=substr(normalized,length(prefix)+1)
        if (name ~ /^[0-9]{6}[.](seg|open)$/) print name
      }
    }
  ' "$listing" | LC_ALL=C sort >"$actual_names"
  LC_ALL=C sort -o "$expected_names" "$expected_names"
  cmp -s "$expected_names" "$actual_names" || return 1
  printf '%s' "$verified"
}
file_owner_id() { if stat -c %u "$1" >/dev/null 2>&1; then stat -c %u "$1"; else stat -f %u "$1"; fi; }
file_group_id() { if stat -c %g "$1" >/dev/null 2>&1; then stat -c %g "$1"; else stat -f %g "$1"; fi; }
file_mode() { if stat -c %a "$1" >/dev/null 2>&1; then stat -c %a "$1"; else stat -f %Lp "$1"; fi; }
identity_value() {
  local marker=$1 name=$2
  awk -F= -v name="$name" '$1 == name { print substr($0, index($0, "=") + 1); exit }' "$marker"
}
storage_root_identity_json() {
  local root=$1 expected_kind=$2 expected_deployment=$3 expected_group expected_mode marker
  local format version deployment_id root_kind adoption claimed_at adopted_at adopted_by
  local marker_owner marker_group marker_mode root_owner root_group root_mode exact=false
  marker="$root/.oscar-storage-root"
  [[ -d $root && ! -L $root && -f $marker && ! -L $marker ]] ||
    fail "Storage root or identity marker is missing, linked, or non-regular: $root"
  format=$(identity_value "$marker" format)
  version=$(identity_value "$marker" version)
  deployment_id=$(identity_value "$marker" deployment_id)
  root_kind=$(identity_value "$marker" root_kind)
  adoption=$(identity_value "$marker" adoption)
  claimed_at=$(identity_value "$marker" claimed_at)
  adopted_at=$(identity_value "$marker" adopted_at)
  adopted_by=$(identity_value "$marker" adopted_by)
  marker_owner=$(file_owner_id "$marker"); marker_group=$(file_group_id "$marker"); marker_mode=$(file_mode "$marker")
  root_owner=$(file_owner_id "$root"); root_group=$(file_group_id "$root"); root_mode=$(file_mode "$root")
  case $expected_kind in
    archive) expected_group=10001; expected_mode=1770 ;;
    wal-archive) expected_group=999; expected_mode=1770 ;;
    backup) expected_group=0; expected_mode=700 ;;
    *) fail "Unknown expected storage-root kind: $expected_kind" ;;
  esac
  if [[ $(wc -l <"$marker" | tr -d '[:space:]') == 8 &&
        $(grep -Fxc 'format=oscar-storage-root-identity' "$marker") == 1 &&
        $(grep -Fxc 'version=1' "$marker") == 1 &&
        $(grep -Fxc "deployment_id=$expected_deployment" "$marker") == 1 &&
        $(grep -Fxc "root_kind=$expected_kind" "$marker") == 1 &&
        $(grep -Ec '^adoption=(new|explicit-existing)$' "$marker") == 1 &&
        $(grep -Ec '^claimed_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' "$marker") == 1 &&
        $(grep -Ec '^adopted_at=(none|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)$' "$marker") == 1 &&
        $(grep -Ec '^adopted_by=(none|[A-Za-z0-9_.@-]{1,128})$' "$marker") == 1 &&
        $format == oscar-storage-root-identity && $version == 1 &&
        $deployment_id == "$expected_deployment" && $root_kind == "$expected_kind" &&
        $marker_owner == 0 && $marker_group == 0 && $marker_mode == 600 &&
        $root_owner == 0 && $root_group == "$expected_group" && $root_mode == "$expected_mode" ]] &&
     { [[ $adoption == new && $adopted_at == none && $adopted_by == none ]] ||
       [[ $adoption == explicit-existing && $adopted_at != none && $adopted_by != none ]]; }; then
    exact=true
  fi
  for value in "$format" "$version" "$deployment_id" "$root_kind" "$adoption" "$claimed_at" "$adopted_at" "$adopted_by" \
    "$marker_owner" "$marker_group" "$marker_mode" "$root_owner" "$root_group" "$root_mode"; do safe_json_text "$value"; done
  printf '{"format":"%s","version":"%s","deploymentId":"%s","rootKind":"%s",' \
    "$format" "$version" "$deployment_id" "$root_kind"
  printf '"adoption":"%s","claimedAt":"%s","adoptedAt":"%s","adoptedBy":"%s",' \
    "$adoption" "$claimed_at" "$adopted_at" "$adopted_by"
  printf '"markerOwner":%s,"markerGroup":%s,"markerMode":"%s","rootOwner":%s,"rootGroup":%s,"rootMode":"%s","exact":%s}' \
    "$marker_owner" "$marker_group" "$marker_mode" "$root_owner" "$root_group" "$root_mode" "$exact"
}
image_id() { docker image inspect "$1" --format '{{.Id}}'; }
container_image_id() {
  local container
  container=$(compose ps -q "$1")
  [[ -n $container ]] || fail "Compose service is not created: $1"
  docker inspect "$container" --format '{{.Image}}'
}
image_label() {
  local value
  value=$(docker image inspect "$1" --format "{{ index .Config.Labels \"$2\" }}" 2>/dev/null || true)
  [[ $value == '<no value>' ]] && value=''
  printf '%s' "$value"
}
repo_digests_json() {
  local reference=$1 digest first=true
  printf '['
  while IFS= read -r digest; do
    [[ -n $digest ]] || continue
    [[ $digest =~ ^[A-Za-z0-9._/:@+-]+@sha256:[0-9a-f]{64}$ ]] ||
      fail "Image has an unsafe repository digest: $reference"
    $first || printf ','
    printf '"%s"' "$digest"
    first=false
  done < <(docker image inspect "$reference" --format '{{range .RepoDigests}}{{println .}}{{end}}')
  printf ']'
}
ensure_fixture_table() {
  psql_admin --command "CREATE TABLE IF NOT EXISTS oscar_regression_fixture (
    run_id text PRIMARY KEY CHECK (run_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$'),
    cold_id bigint NOT NULL UNIQUE, hot_id bigint NOT NULL UNIQUE, datastream_id bigint NOT NULL,
    cold_ids bigint[],
    cold_time timestamptz NOT NULL, hot_time timestamptz NOT NULL,
    generation_id uuid, created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE oscar_regression_fixture ADD COLUMN IF NOT EXISTS cold_ids bigint[];
  UPDATE oscar_regression_fixture SET cold_ids=ARRAY[cold_id] WHERE cold_ids IS NULL;
  ALTER TABLE oscar_regression_fixture ALTER COLUMN cold_ids SET NOT NULL;
  CREATE TABLE IF NOT EXISTS oscar_regression_fixture_allocator (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    leased_high_water bigint NOT NULL CHECK (leased_high_water > 0)
  );" >/dev/null
}
create_observation_fixture() {
  local run=$1 cold_time_sql=$2 hot_time_sql=$3 fixture_json
  # PostgisStore allocates positive observation IDs from an in-process AtomicLong
  # initialized from the durable hot/archive high-water. Keep direct SQL fixtures
  # in a test-only lease over 2^40 IDs beyond that high-water. The singleton
  # allocator UPSERT takes a PostgreSQL row lock and computes each new lease
  # from the latest committed allocator value, even when concurrent statements
  # began with the same READ COMMITTED snapshot. The obs primary key still
  # fails the entire statement if an outside writer reaches either candidate.
  # The archived cold ID is the top of the lease so its durable generation
  # high-water prevents the deleted hot ID from becoming the restart next ID.
  fixture_json=$(json_query "WITH source AS MATERIALIZED (
      SELECT o.* FROM obs o JOIN obs_datastreams d ON d.id=o.datastreamid
      WHERE d.data->>'outputName'='gammaCounts' AND o.archivegenerationid IS NULL
      ORDER BY o.id DESC LIMIT 1),
    fixture_clock AS MATERIALIZED (SELECT clock_timestamp() sampled_at),
    high_water AS MATERIALIZED (
      SELECT greatest(
        coalesce((SELECT max(id) FROM obs),0),
        coalesce((SELECT max(max_id) FROM oscar_archive_generation),0),
        coalesce((SELECT max(greatest(cold_id,hot_id)) FROM oscar_regression_fixture),0)
      ) id),
    allocated AS MATERIALIZED (
      INSERT INTO oscar_regression_fixture_allocator(singleton,leased_high_water)
      SELECT true,high_water.id+1099511627778 FROM high_water CROSS JOIN source
      WHERE high_water.id BETWEEN 0 AND 9223370937343148029
        AND NOT EXISTS (SELECT 1 FROM oscar_regression_fixture WHERE run_id='$run')
      ON CONFLICT (singleton) DO UPDATE SET leased_high_water=greatest(
        oscar_regression_fixture_allocator.leased_high_water,
        EXCLUDED.leased_high_water-1099511627778)+1099511627778
      WHERE greatest(oscar_regression_fixture_allocator.leased_high_water,
        EXCLUDED.leased_high_water-1099511627778) BETWEEN 0 AND 9223370937343148029
      RETURNING leased_high_water cold_id,leased_high_water-3 hot_id),
    collision_free AS MATERIALIZED (
      SELECT a.* FROM allocated a
      WHERE NOT EXISTS (SELECT 1 FROM obs WHERE id BETWEEN a.hot_id AND a.cold_id)
        AND NOT EXISTS (SELECT 1 FROM oscar_regression_fixture
          WHERE cold_id BETWEEN a.hot_id AND a.cold_id OR hot_id BETWEEN a.hot_id AND a.cold_id)
        AND NOT EXISTS (SELECT 1 FROM oscar_archive_generation
          WHERE int8range(min_id,max_id,'[]') && int8range(a.hot_id,a.cold_id,'[]'))
        AND NOT EXISTS (SELECT 1 FROM oscar_archive_id_block
          WHERE int8range(min_id,max_id,'[]') && int8range(a.hot_id,a.cold_id,'[]'))
        AND NOT EXISTS (SELECT 1 FROM oscar_obs_overlay
          WHERE observation_id BETWEEN a.hot_id AND a.cold_id)),
    cold AS (INSERT INTO obs(id,datastreamid,foiid,phenomenontime,resulttime,result)
      SELECT allocation.cold_id-series.value,source.datastreamid,source.foiid,
        ($cold_time_sql)+series.value*interval '1 microsecond',
        ($cold_time_sql)+series.value*interval '1 microsecond',source.result
      FROM source CROSS JOIN collision_free allocation CROSS JOIN fixture_clock
        CROSS JOIN generate_series(0,2) series(value) RETURNING *),
    cold_set AS (SELECT max(id) cold_id,array_agg(id ORDER BY id DESC) cold_ids,
        max(datastreamid) datastreamid,min(phenomenontime) phenomenontime FROM cold),
    hot AS (INSERT INTO obs(id,datastreamid,foiid,phenomenontime,resulttime,result)
      SELECT allocation.hot_id,source.datastreamid,source.foiid,$hot_time_sql,$hot_time_sql,source.result
      FROM source CROSS JOIN collision_free allocation CROSS JOIN fixture_clock RETURNING *),
    registry AS (INSERT INTO oscar_regression_fixture(
        run_id,cold_id,cold_ids,hot_id,datastream_id,cold_time,hot_time)
      SELECT '$run',cold_set.cold_id,cold_set.cold_ids,hot.id,cold_set.datastreamid,
        cold_set.phenomenontime,hot.phenomenontime FROM cold_set,hot RETURNING *)
    SELECT json_build_object('runId',run_id,'coldId',cold_id::text,'coldRowCount',cardinality(cold_ids),
      'hotId',hot_id::text,'datastreamId',datastream_id,'coldTime',cold_time,'hotTime',hot_time)
      FROM registry;")
  [[ $fixture_json == \{* ]] ||
    fail 'Could not allocate four collision-free test observation IDs below the signed BIGINT limit.'
  printf '%s\n' "$fixture_json"
}

# Put lifecycle fixtures in a complete archive window strictly before every
# window already known to this deployment. A two-hour margin keeps the
# fixture's UTC-hour window disjoint even when the existing minimum is exactly
# on an hour boundary. Keep the ordinary age-derived time as an upper bound so
# an empty catalog still exercises the configured retention threshold.
fixture_archive_time_sql() {
  local retention=$1 clock_expression=$2
  [[ $retention =~ ^[1-9][0-9]*$ ]] || fail 'Invalid fixture retention days.'
  case $clock_expression in
    fixture_clock.sampled_at|clock_timestamp\(\)) ;;
    *) fail 'Invalid fixture clock expression.' ;;
  esac
  printf "(SELECT least(%s-make_interval(days=>%s+2),coalesce((SELECT min(window_start) FROM oscar_archive_generation),'infinity'::timestamptz),coalesce((SELECT min(window_start) FROM oscar_archive_job),'infinity'::timestamptz))-interval '2 hours')" \
    "$clock_expression" "$retention"
}

archive_maintenance_idle_json() {
  local config_path=$1 scratch_entries=$2
  [[ $scratch_entries =~ ^[0-9]+$ ]] || fail 'Invalid archive scratch entry count.'
  {
    cat <<'SQL'
\set ON_ERROR_STOP on
CREATE TEMP TABLE oscar_idle_config_input (sequence bigserial, line text NOT NULL);
\copy oscar_idle_config_input(line) FROM STDIN
SQL
    compose exec -T oscar base64 "$config_path"
    printf '\\.\n\\set scratch_entries %s\n' "$scratch_entries"
    cat <<'SQL'
WITH payload AS (
  SELECT convert_from(decode(string_agg(line, '' ORDER BY sequence), 'base64'), 'UTF8') AS text
  FROM oscar_idle_config_input
), document AS (
  SELECT text::json AS raw FROM payload WHERE left(ltrim(text), 1) = '['
), items AS (
  SELECT item AS raw
  FROM document, LATERAL json_array_elements(raw) item
), candidates AS (
  SELECT raw
  FROM items
  WHERE json_typeof(raw) = 'object'
    AND raw->>'objClass' = 'org.sensorhub.impl.database.system.SystemDriverDatabaseConfig'
), selected AS (
  SELECT raw->'dbConfig'->'archive' AS archive
  FROM candidates
  WHERE (SELECT count(*) FROM candidates) = 1
    AND NOT EXISTS (SELECT key FROM json_each(raw) GROUP BY key HAVING count(*) <> 1)
    AND json_typeof(raw->'dbConfig') = 'object'
    AND NOT EXISTS (SELECT key FROM json_each(raw->'dbConfig') GROUP BY key HAVING count(*) <> 1)
    AND raw->'dbConfig'->>'objClass' =
      'org.sensorhub.impl.datastore.postgis.database.OscarTieredObsSystemDatabaseConfig'
), config AS (
  SELECT archive,
    (archive->>'parquetPrimaryArchiveDelayMinutes')::integer AS primary_archive_delay_minutes,
    (archive->>'rollbackGraceDays')::integer AS rollback_grace_days,
    ARRAY(SELECT value #>> '{}' FROM json_array_elements(archive->'outputNames') value) AS output_names
  FROM selected
  WHERE json_typeof(archive) = 'object'
    AND NOT EXISTS (SELECT key FROM json_each(archive) GROUP BY key HAVING count(*) <> 1)
    AND archive->>'objClass' = 'org.sensorhub.impl.datastore.postgis.archive.TieredArchiveConfig'
    AND archive->>'storageMode' = 'PARQUET_PRIMARY'
    AND json_typeof(archive->'parquetPrimaryArchiveDelayMinutes') = 'number'
    AND archive->>'parquetPrimaryArchiveDelayMinutes' ~ '^[1-9][0-9]*$'
    AND json_typeof(archive->'rollbackGraceDays') = 'number'
    AND archive->>'rollbackGraceDays' ~ '^[1-9][0-9]*$'
    AND json_typeof(archive->'outputNames') = 'array'
    AND json_array_length(archive->'outputNames') BETWEEN 1 AND 64
    AND NOT EXISTS (
      SELECT 1 FROM json_array_elements(archive->'outputNames') value
      WHERE json_typeof(value) <> 'string' OR length(value #>> '{}') = 0)
    AND json_array_length(archive->'outputNames') = (
      SELECT count(DISTINCT value #>> '{}') FROM json_array_elements(archive->'outputNames') value)
), state AS (
  SELECT
    (SELECT count(*) FROM oscar_archive_job WHERE state='EXPORTING') exporting_jobs,
    (SELECT count(*) FROM oscar_archive_job failed
      WHERE failed.state='FAILED' AND NOT EXISTS (
        SELECT 1 FROM oscar_archive_job newer
        WHERE newer.store_key=failed.store_key AND newer.id_scope=failed.id_scope
          AND newer.profile=failed.profile AND newer.window_start=failed.window_start
          AND newer.window_end=failed.window_end AND newer.revision>failed.revision)) latest_failed_jobs,
    (SELECT count(*) FROM oscar_archive_generation g, config c
      WHERE g.state='ACTIVE' AND g.parity_verified
        AND g.activated_at<=now()-make_interval(days=>c.rollback_grace_days)
        AND EXISTS (SELECT 1 FROM obs o WHERE o.archivegenerationid=g.id)) eligible_hot_deletes,
    (SELECT count(*) FROM (
      SELECT 1 FROM obs o JOIN obs_datastreams d ON d.id=o.datastreamid, config c
      WHERE o.archivegenerationid IS NULL
        AND o.phenomenontime<date_trunc('hour',now()-make_interval(mins=>c.primary_archive_delay_minutes))
        AND d.data->>'outputName'=ANY(c.output_names)
      LIMIT 1) candidate) eligible_unowned_rows,
    (SELECT count(*) FROM config) config_rows
)
SELECT json_build_object(
  'idle',config_rows=1 AND exporting_jobs=0 AND latest_failed_jobs=0
    AND eligible_hot_deletes=0 AND eligible_unowned_rows=0 AND :scratch_entries::bigint=0,
  'exportingJobs',exporting_jobs,
  'latestFailedJobs',latest_failed_jobs,
  'eligibleHotDeleteGenerations',eligible_hot_deletes,
  'eligibleUnownedRows',eligible_unowned_rows,
  'scratchEntries',:scratch_entries::bigint) FROM state;
SQL
  } | psql_admin --quiet --tuples-only --no-align | tail -n 1
}

case $action in
  camera-recording-log-start)
    (($# == 0)) || fail 'Camera-recording log start accepts no arguments.'
    camera_log_started_at=$(date --utc +%Y-%m-%dT%H:%M:%S.%NZ)
    [[ $camera_log_started_at =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{9}Z$ ]] ||
      fail 'Could not capture a valid camera-recording log start time.'
    printf '{"startedAt":"%s"}\n' "$camera_log_started_at"
    ;;
  camera-recording-log-check)
    camera_log_started_at=${1:-}
    (($# == 1)) || fail 'Camera-recording log check requires exactly one start time.'
    [[ $camera_log_started_at =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{9}Z$ ]] ||
      fail 'Camera-recording log check start time is invalid.'
    camera_log=$(mktemp /tmp/oscar-camera-recording-log.XXXXXX)
    cleanup_camera_log() { rm -f -- "$camera_log"; }
    trap cleanup_camera_log EXIT
    if ! compose logs --since "$camera_log_started_at" oscar >"$camera_log" 2>&1; then
      emit_command_diagnostics 'Camera-recording service-log collection' "$camera_log"
      fail 'Could not collect the exact camera-recording service log window.'
    fi
    camera_timeout_quarantines=$(grep -Eic \
      'Timed out waiting for camera .* command; quarantining its queue' "$camera_log" || true)
    camera_queue_rejections=$(grep -Eic \
      'Camera .* command queue is quarantined' "$camera_log" || true)
    recording_result_timeouts=$(grep -Eic \
      'Timed out waiting for video files for occupancy generation' "$camera_log" || true)
    stale_generation_results=$(grep -Eic \
      'returned a stale or mismatched saved-video result for occupancy generation' "$camera_log" || true)
    camera_command_failures=$(grep -Eic \
      'Camera .* failed to close occupancy generation|Failed to finish matched camera recording generation' \
      "$camera_log" || true)
    printf '{"timeoutQuarantines":%s,"queueRejections":%s,"recordingResultTimeouts":%s,' \
      "$camera_timeout_quarantines" "$camera_queue_rejections" "$recording_result_timeouts"
    printf '"staleGenerationResults":%s,"cameraCommandFailures":%s}\n' \
      "$stale_generation_results" "$camera_command_failures"
    cleanup_camera_log
    trap - EXIT
    ;;
  alarm-media-baseline)
    run=${1:-}
    (($# == 1)) || fail 'Alarm-media baseline requires exactly one run ID.'
    valid_run "$run" || fail 'Alarm-media baseline requires a valid run ID.'
    marker=$(alarm_media_marker "$run")
    [[ ! -e $marker && ! -L $marker ]] || fail 'Alarm-media baseline marker already exists.'
    artifacts=$(alarm_all_camera_artifacts)
    marker_tmp=$(mktemp "/tmp/.oscar-alarm-media-$run.XXXXXX")
    cleanup_alarm_baseline() { rm -f -- "$marker_tmp"; }
    trap cleanup_alarm_baseline EXIT
    {
      printf 'version\t2\n'
      [[ -z $artifacts ]] || printf '%s\n' "$artifacts"
    } >"$marker_tmp"
    chmod 600 "$marker_tmp"
    ln -- "$marker_tmp" "$marker"
    rm -f -- "$marker_tmp"
    trap - EXIT
    baseline_finalized=$(awk -F '\t' '$1=="final" {count++} END {print count+0}' "$marker")
    baseline_partials=$(awk -F '\t' '$1=="partial" {count++} END {print count+0}' "$marker")
    printf '{"baselineCreated":true,"baselineFinalized":%s,"baselinePartials":%s}\n' \
      "$baseline_finalized" "$baseline_partials"
    ;;
  alarm-media-cleanup)
    run=${1:-}
    (($# == 1)) || fail 'Alarm-media cleanup requires exactly one run ID.'
    valid_run "$run" || fail 'Alarm-media cleanup requires a valid run ID.'
    marker=$(alarm_media_marker "$run")
    if [[ ! -e $marker && ! -L $marker ]]; then
      printf '{"removed":false}\n'
      exit 0
    fi
    [[ -f $marker && ! -L $marker && $(file_owner_id "$marker") == 0 && $(file_mode "$marker") == 600 ]] ||
      fail 'Alarm-media cleanup refused an unsafe baseline marker.'
    [[ $(grep -Fxc $'version\t2' "$marker") == 1 ]] ||
      fail 'Alarm-media cleanup refused an unknown baseline marker.'
    rm -f -- "$marker"
    printf '{"removed":true}\n'
    ;;
  alarm-media-source-status)
    (($# > 0)) || fail 'Alarm-media source status requires at least one path.'
    source_paths=$#
    source_existing=0
    source_nonzero=0
    for source_path in "$@"; do
      valid_alarm_video_path "$source_path" || fail "Alarm-media source path is invalid: $source_path"
      source_status=$(compose exec -T oscar sh -eu -c '
        source=/var/lib/oscar/files/$1
        if test -f "$source" && test ! -L "$source"; then
          bytes=$(wc -c <"$source" | tr -d "[:space:]")
          printf "1\\t%s\\n" "${bytes:-0}"
        else
          printf "0\\t0\\n"
        fi
      ' alarm-media-source "$source_path")
      source_exists=${source_status%%$'\t'*}
      source_bytes=${source_status#*$'\t'}
      [[ $source_exists == 1 ]] && source_existing=$((source_existing+1))
      [[ $source_bytes =~ ^[0-9]+$ ]] || fail 'Alarm-media source returned an invalid byte count.'
      ((source_bytes > 0)) && source_nonzero=$((source_nonzero+1))
    done
    printf '{"paths":%s,"existing":%s,"nonzero":%s}\n' \
      "$source_paths" "$source_existing" "$source_nonzero"
    ;;
  alarm-media-ledger)
    event_token=${1:-}; lane_token=${2:-}; camera_token=${3:-}
    (($# == 3)) || fail 'Alarm-media ledger requires event, lane, and camera tokens.'
    valid_media_token "$event_token" && valid_media_token "$lane_token" && valid_media_token "$camera_token" ||
      fail 'Alarm-media ledger token is invalid.'
    ledger_key="retained-media/v1/events/$event_token/lanes/$lane_token/cameras/$camera_token/.job.json"
    ledger_json=$(compose exec -T oscar sh -eu -c '
      ledger=/var/lib/oscar/files/videos/$1
      if test ! -f "$ledger" || test -L "$ledger"; then
        printf "MISSING\\n"
        exit 0
      fi
      cat -- "$ledger"
    ' alarm-media-ledger "$ledger_key")
    if [[ $ledger_json == MISSING ]]; then
      printf '{"exists":false}\n'
    else
      compact=$(printf '%s' "$ledger_json" | tr -d '\r\n')
      case $compact in \{*\}) ;; *) fail 'Alarm-media ledger is not a JSON object.' ;; esac
      printf '{"exists":true,"ledger":%s}\n' "$compact"
    fi
    ;;
  alarm-media-forensics)
    run=${1:-}; shift || true
    valid_run "$run" || fail 'Alarm-media forensics requires a valid run ID.'
    (($# > 0)) || fail 'Alarm-media forensics requires generated source paths.'
    marker=$(alarm_media_marker "$run")
    [[ -f $marker && ! -L $marker && $(file_owner_id "$marker") == 0 && $(file_mode "$marker") == 600 ]] ||
      fail 'Alarm-media baseline marker is missing or unsafe.'
    [[ $(grep -Fxc $'version\t2' "$marker") == 1 ]] || fail 'Alarm-media baseline marker has an unknown version.'
    for source_path in "$@"; do valid_alarm_video_path "$source_path" || fail 'Generated alarm-media path is invalid.'; done
    forensic_tmp=$(mktemp -d "/tmp/.oscar-alarm-media-forensics-$run.XXXXXX")
    cleanup_alarm_forensics() { rm -rf -- "$forensic_tmp"; }
    trap cleanup_alarm_forensics EXIT
    printf '%s\n' "$@" | sort -u >"$forensic_tmp/expected"
    [[ $(wc -l <"$forensic_tmp/expected" | tr -d '[:space:]') == $# ]] ||
      fail 'Generated alarm-media paths contain duplicates.'
    cut -d/ -f3 "$forensic_tmp/expected" | sort -u >"$forensic_tmp/cameras"
    awk -F '\t' 'NR==FNR {camera[$1]=1; next} $1=="final" {split($2,path,"/"); if (camera[path[3]]) print $2}' \
      "$forensic_tmp/cameras" "$marker" | sort -u >"$forensic_tmp/baseline-final"
    awk -F '\t' 'NR==FNR {camera[$1]=1; next} $1=="partial" {split($2,path,"/"); if (camera[path[3]]) print $2}' \
      "$forensic_tmp/cameras" "$marker" | sort -u >"$forensic_tmp/baseline-partial"
    alarm_all_camera_artifacts >"$forensic_tmp/current-all"
    awk -F '\t' 'NR==FNR {camera[$1]=1; next} $1=="final" {split($2,path,"/"); if (camera[path[3]]) print $2}' \
      "$forensic_tmp/cameras" "$forensic_tmp/current-all" | sort -u >"$forensic_tmp/current-final"
    awk -F '\t' 'NR==FNR {camera[$1]=1; next} $1=="partial" {split($2,path,"/"); if (camera[path[3]]) print $2}' \
      "$forensic_tmp/cameras" "$forensic_tmp/current-all" | sort -u >"$forensic_tmp/current-partial"
    comm -13 "$forensic_tmp/baseline-final" "$forensic_tmp/current-final" >"$forensic_tmp/new-final"
    expected_paths=$(wc -l <"$forensic_tmp/expected" | tr -d '[:space:]')
    current_expected=$(comm -12 "$forensic_tmp/expected" "$forensic_tmp/current-final" | wc -l | tr -d '[:space:]')
    new_finalized=$(wc -l <"$forensic_tmp/new-final" | tr -d '[:space:]')
    new_orphans=$(comm -23 "$forensic_tmp/new-final" "$forensic_tmp/expected" | wc -l | tr -d '[:space:]')
    new_partials=$(comm -13 "$forensic_tmp/baseline-partial" "$forensic_tmp/current-partial" | wc -l | tr -d '[:space:]')
    baseline_collisions=$(comm -12 "$forensic_tmp/expected" "$forensic_tmp/baseline-final" | wc -l | tr -d '[:space:]')
    rm -f -- "$marker"
    printf '{"baselineFound":true,"expectedPaths":%s,"currentExpectedPaths":%s,' \
      "$expected_paths" "$current_expected"
    printf '"newFinalizedPaths":%s,"newFinalizedOrphans":%s,"newPartialArtifacts":%s,' \
      "$new_finalized" "$new_orphans" "$new_partials"
    printf '"expectedAlreadyPresentAtBaseline":%s}\n' "$baseline_collisions"
    ;;
  platform)
    expected_release=3.11.0
    configured_release=$(env_value OSCAR_VERSION missing)
    template_release=$(awk -F= '$1 == "OSCAR_VERSION" { print substr($0, index($0, "=") + 1); exit }' .env.example)
    deployment_id=$(env_value OSCAR_DEPLOYMENT_ID missing)
    valid_deployment_id "$deployment_id" || fail 'OSCAR_DEPLOYMENT_ID is missing or is not a lowercase UUID.'
    backup_mode=$(env_value OSCAR_BACKUP_MODE disabled)
    [[ $backup_mode == disabled || $backup_mode == single ]] ||
      fail 'OSCAR_BACKUP_MODE must be exactly disabled or single.'
    archive_dir=$(realpath -e -- "$(absolute_path "$(env_value OSCAR_ARCHIVE_DIR ../oscar-storage/archive)")")
    archive_identity=$(storage_root_identity_json "$archive_dir" archive "$deployment_id")
    backup_identity=null
    if [[ $backup_mode == single ]]; then
      backup_dir=$(realpath -e -- "$(absolute_path "$(env_value OSCAR_BACKUP_DIR ../oscar-storage/backups)")")
      backup_identity=$(storage_root_identity_json "$backup_dir" backup "$deployment_id")
    fi
    legacy_wal_configured=false
    legacy_wal_present=false
    legacy_wal_bytes=0
    legacy_wal_value=$(awk -F= '$1 == "OSCAR_WAL_ARCHIVE_DIR" { print substr($0, index($0, "=") + 1); exit }' .env)
    legacy_wal_path=$(absolute_path "${legacy_wal_value:-../oscar-storage/wal-archive}")
    if [[ -n $legacy_wal_value ]]; then
      legacy_wal_configured=true
    fi
    if [[ -d $legacy_wal_path && ! -L $legacy_wal_path ]]; then
      legacy_wal_present=true
      legacy_wal_bytes=$(directory_bytes "$legacy_wal_path")
    fi

    packaged_archive_helper=docker/oscar/archive-object-helper.sh
    packaged_prepare_restore_helper=postgis/prepare-restore.sh
    packaged_atomic_source=docker/oscar/atomic-publish.c
    packaged_entrypoint=docker/oscar/entrypoint.sh
    [[ -f $packaged_archive_helper && ! -L $packaged_archive_helper &&
       -f $packaged_prepare_restore_helper && ! -L $packaged_prepare_restore_helper &&
       -f $packaged_atomic_source && ! -L $packaged_atomic_source &&
       -f $packaged_entrypoint && ! -L $packaged_entrypoint ]] ||
      fail 'A packaged storage helper is missing, linked, or non-regular.'
    packaged_archive_sha=$(sha256_file "$packaged_archive_helper")
    packaged_prepare_restore_sha=$(sha256_file "$packaged_prepare_restore_helper")
    packaged_atomic_source_sha=$(sha256_file "$packaged_atomic_source")
    packaged_entrypoint_sha=$(sha256_file "$packaged_entrypoint")
    entrypoint_tmp_contract=false
    if entrypoint_has_managed_tmp_contract "$packaged_entrypoint"; then
      entrypoint_tmp_contract=true
    fi
    archive_export_helper_wired=false
    grep -Eq '^[[:space:]]+archive_object_helper copy "\$relative" "\$expected_sha" ro "\$partial"$' oscar-storage.sh &&
      archive_export_helper_wired=true
    archive_purge_helper_wired=false
    # The purge loop reads its work list from standard input. Require the
    # helper subprocess to detach from that stream so it cannot consume the
    # remaining object rows and silently leave a multi-object plan partial.
    grep -Eq '^[[:space:]]+delete_outcome=\$\(archive_object_helper delete "\$relative" "\$expected_sha" rw </dev/null\)$' oscar-storage.sh &&
      archive_purge_helper_wired=true
    archive_helper_regular=false
    compose exec -T oscar sh -c 'test -f /usr/local/bin/oscar-archive-object && test ! -L /usr/local/bin/oscar-archive-object && test -x /usr/local/bin/oscar-archive-object' && archive_helper_regular=true
    prepare_restore_helper_regular=false
    compose exec -T postgres sh -c 'test -f /usr/local/bin/oscar-prepare-restore && test ! -L /usr/local/bin/oscar-prepare-restore && test -x /usr/local/bin/oscar-prepare-restore' && prepare_restore_helper_regular=true
    atomic_publisher_regular=false
    compose exec -T oscar sh -c 'test -f /usr/local/bin/oscar-atomic-publish && test ! -L /usr/local/bin/oscar-atomic-publish && test -x /usr/local/bin/oscar-atomic-publish' && atomic_publisher_regular=true
    atomic_source_stamp_regular=false
    compose exec -T oscar sh -c 'test -f /usr/local/share/oscar-atomic-publish.source.sha256 && test ! -L /usr/local/share/oscar-atomic-publish.source.sha256' && atomic_source_stamp_regular=true
    entrypoint_regular=false
    compose exec -T oscar sh -c 'test -f /usr/local/bin/oscar-entrypoint && test ! -L /usr/local/bin/oscar-entrypoint && test -x /usr/local/bin/oscar-entrypoint' && entrypoint_regular=true
    deployed_archive_sha=$(compose exec -T oscar sha256sum /usr/local/bin/oscar-archive-object | awk '{print $1}')
    deployed_prepare_restore_sha=$(compose exec -T postgres sha256sum /usr/local/bin/oscar-prepare-restore | awk '{print $1}')
    deployed_atomic_sha=$(compose exec -T oscar sha256sum /usr/local/bin/oscar-atomic-publish | awk '{print $1}')
    deployed_atomic_source_sha=$(compose exec -T oscar cat /usr/local/share/oscar-atomic-publish.source.sha256 | tr -d '[:space:]')
    deployed_entrypoint_sha=$(compose exec -T oscar sha256sum /usr/local/bin/oscar-entrypoint | awk '{print $1}')
    for digest in "$packaged_archive_sha" "$packaged_prepare_restore_sha" \
      "$packaged_atomic_source_sha" "$deployed_archive_sha" "$deployed_prepare_restore_sha" \
      "$deployed_atomic_sha" "$deployed_atomic_source_sha" "$packaged_entrypoint_sha" \
      "$deployed_entrypoint_sha"; do
      [[ $digest =~ ^[0-9a-f]{64}$ ]] || fail 'A packaged/deployed storage helper has an invalid SHA-256 identity.'
    done
    atomic_behavior_output=$(compose exec -T oscar sh -eu -c '
      root=$(mktemp -d /var/lib/oscar/.atomic-publish-regression.XXXXXX)
      trap '\''rm -rf -- "$root"'\'' EXIT HUP INT TERM
      mkdir "$root/source" "$root/destination"
      printf source > "$root/source/payload"
      printf destination > "$root/destination/payload"
      /usr/local/bin/oscar-atomic-publish "$root" source published
      test ! -e "$root/source" && test "$(cat "$root/published/payload")" = source
      printf "%s\n" first-publish-succeeded
      mkdir "$root/challenger"
      printf challenger > "$root/challenger/payload"
      set +e
      /usr/local/bin/oscar-atomic-publish "$root" challenger published >/dev/null 2>&1
      status=$?
      set -e
      test "$status" -ne 0
      printf "%s\n" collision-rejected
      test "$(cat "$root/challenger/payload")" = challenger
      printf "%s\n" source-preserved
      test "$(cat "$root/published/payload")" = source
      printf "%s\n" destination-preserved
    ' 2>/dev/null || true)
    atomic_behavior_tested=false
    atomic_first_publish_succeeded=false
    atomic_collision_rejected=false
    atomic_source_preserved=false
    atomic_destination_preserved=false
    grep -Fqx first-publish-succeeded <<<"$atomic_behavior_output" && atomic_first_publish_succeeded=true
    grep -Fqx collision-rejected <<<"$atomic_behavior_output" && atomic_collision_rejected=true
    grep -Fqx source-preserved <<<"$atomic_behavior_output" && atomic_source_preserved=true
    grep -Fqx destination-preserved <<<"$atomic_behavior_output" && atomic_destination_preserved=true
    if $atomic_first_publish_succeeded && $atomic_collision_rejected &&
       $atomic_source_preserved && $atomic_destination_preserved; then
      atomic_behavior_tested=true
    fi
    archive_mode=$(scalar 'SHOW archive_mode;')
    archive_timeout=$(scalar 'SHOW archive_timeout;')
    archive_command=$(psql_admin --tuples-only --no-align --command 'SHOW archive_command;' | sed -e 's/[[:space:]]*$//' | tail -n1)
    archive_command_inactive=false
    [[ -z $archive_command || $archive_command == '(disabled)' ]] && archive_command_inactive=true

    case $(uname -s) in
      Linux) expected_lock_directory=/run/lock/oscar-storage ;;
      Darwin) expected_lock_directory=/private/var/run/oscar-storage ;;
      *) expected_lock_directory=/var/run/oscar-storage ;;
    esac
    lock_directory=$expected_lock_directory
    lock_file="$lock_directory/$deployment_id.lock"
    lock_log=$(mktemp /tmp/oscar-regression-lock.XXXXXX)
    trap 'rm -f -- "$lock_log"' EXIT
    [[ -d $lock_directory && ! -L $lock_directory && -f $lock_file && ! -L $lock_file ]] ||
      fail 'The deployment storage lock directory/file is missing, linked, or non-regular.'
    lock_owner=$(file_owner_id "$lock_file"); lock_mode=$(file_mode "$lock_file")
    lock_directory_owner=$(file_owner_id "$lock_directory"); lock_directory_mode=$(file_mode "$lock_directory")
    lock_path_stable=false
    [[ $lock_directory == "$expected_lock_directory" && $lock_file == "$expected_lock_directory/$deployment_id.lock" ]] &&
      lock_path_stable=true
    lock_private=false
    [[ $lock_owner == 0 && $lock_mode == 600 && $lock_directory_owner == 0 && $lock_directory_mode == 700 ]] &&
      lock_private=true
    lock_behavior_tested=false; concurrent_lock_rejected=false
    if command -v flock >/dev/null 2>&1; then
      lock_behavior_tested=true
      exec 8>>"$lock_file"
      flock -n 8 || fail 'Could not acquire the idle deployment lock for its concurrency oracle.'
      set +e
      (exec 8>&-; bash oscar.sh archive status) >"$lock_log" 2>&1
      concurrent_status=$?
      set -e
      flock -u 8
      exec 8>&-
      if [[ $concurrent_status -ne 0 ]] && grep -Fq 'Another OSCAR storage administration command is already running.' "$lock_log"; then
        concurrent_lock_rejected=true
      fi
    fi
    rm -f -- "$lock_log"
    trap - EXIT
    for value in "$deployment_id" "$backup_mode" "$archive_mode" "$archive_timeout" "$archive_command" "$expected_lock_directory" "$lock_directory" "$lock_file" \
      "$lock_owner" "$lock_mode" "$lock_directory_owner" "$lock_directory_mode"; do safe_json_text "$value"; done
    images=$(compose config --images)
    app_image=''; postgis_image=''; gateway_image=''
    while IFS= read -r image; do
      [[ -n $image ]] || continue
      case $image in
        oscar-postgis:*) [[ -z $postgis_image ]] || fail 'Compose selects multiple PostGIS images.'; postgis_image=$image ;;
        oscar:*) [[ -z $app_image ]] || fail 'Compose selects multiple OSCAR application images.'; app_image=$image ;;
        nginxinc/nginx-unprivileged:*) [[ -z $gateway_image ]] || fail 'Compose selects multiple gateway images.'; gateway_image=$image ;;
      esac
    done <<<"$images"
    [[ -n $app_image && -n $postgis_image && -n $gateway_image ]] ||
      fail 'Compose does not select exactly one OSCAR, PostGIS, and gateway image.'
    for value in "$configured_release" "$template_release" "$app_image" "$postgis_image" "$gateway_image"; do
      safe_json_text "$value"
    done
    app_id=$(image_id "$app_image"); postgis_id=$(image_id "$postgis_image"); gateway_id=$(image_id "$gateway_image")
    app_container_id=$(container_image_id oscar); postgis_container_id=$(container_image_id postgres); gateway_container_id=$(container_image_id gateway)
    app_container=$(compose ps -q oscar)
    postgres_container=$(compose ps -q postgres)
    external_wal_mount_absent=false
    if ! docker inspect "$postgres_container" --format '{{range .Mounts}}{{println .Destination}}{{end}}' |
         grep -Fqx /var/lib/postgresql/wal-archive; then
      external_wal_mount_absent=true
    fi
    container_entrypoint_exact=false
    [[ $(docker inspect "$app_container" --format '{{json .Config.Entrypoint}}') == \
      '["/usr/local/bin/oscar-entrypoint"]' ]] && container_entrypoint_exact=true
    native_runtime_output=$(compose exec -T oscar sh -u -c '
      mount_type() {
        awk -v target="$1" '\''
          $5 == target {
            matches++
            for (field = 7; field <= NF; field++)
              if ($field == "-") type = $(field + 1)
          }
          END {
            if (matches == 1 && type != "") print type
            else if (matches == 0) print "missing"
            else print "multiple"
          }
        '\'' /proc/self/mountinfo
      }
      mount_has_option() {
        if awk -v target="$1" -v required="$2" '\''
          $5 == target {
            count = split($6, options, ",")
            for (option = 1; option <= count; option++)
              if (options[option] == required) found = 1
          }
          END { exit found ? 0 : 1 }
        '\'' /proc/self/mountinfo; then printf true; return 0
        else printf false; return 1; fi
      }

      tmp_type=$(mount_type /tmp)
      native_path=/run/oscar-native
      native_type=$(mount_type "$native_path")
      tmp_rw=$(mount_has_option /tmp rw)
      tmp_noexec=$(mount_has_option /tmp noexec)
      tmp_nosuid=$(mount_has_option /tmp nosuid)
      tmp_nodev=$(mount_has_option /tmp nodev)
      native_rw=$(mount_has_option "$native_path" rw)
      if mount_has_option "$native_path" noexec >/dev/null; then native_noexec_absent=false
      else native_noexec_absent=true; fi
      native_nosuid=$(mount_has_option "$native_path" nosuid)
      native_nodev=$(mount_has_option "$native_path" nodev)

      native_directory=false
      [ -d "$native_path" ] && [ ! -L "$native_path" ] && native_directory=true
      metadata=$(stat -c "%u:%g:%a" "$native_path" 2>/dev/null || printf "-1:-1:missing")
      old_ifs=$IFS; IFS=:; set -- $metadata; IFS=$old_ifs
      native_owner_uid=${1:--1}; native_owner_gid=${2:--1}; native_mode=${3:-missing}
      filesystem=$(stat -f -c "%S:%b" "$native_path" 2>/dev/null || printf "0:0")
      old_ifs=$IFS; IFS=:; set -- $filesystem; IFS=$old_ifs
      case ${1:-}:${2:-} in
        *[!0-9:]*|:|:*|*:|0:*) native_size_bytes=-1 ;;
        *) native_size_bytes=$((${1} * ${2})) ;;
      esac

      native_executable=false
      exec_probe="$native_path/.regression-exec-probe.$$"
      if cp /bin/true "$exec_probe" 2>/dev/null && chmod 0500 "$exec_probe" 2>/dev/null &&
         "$exec_probe" >/dev/null 2>&1; then native_executable=true; fi
      if ! rm -f -- "$exec_probe" >/dev/null 2>&1; then native_executable=false; fi

      runtime_uid=$(id -u); runtime_gid=$(id -g)
      java_process_count=0
      java_tmp_property_count=0; effective_java_tmp=missing
      javacpp_cache_property_count=0; effective_javacpp_cache=missing
      data_tmp_property_count=0; effective_data_tmp=missing
      for process in /proc/[0-9]*; do
        executable=$(readlink "$process/exe" 2>/dev/null || true)
        case $executable in
          */java)
            java_process_count=$((java_process_count + 1))
            arguments=$(tr "\\000" "\\n" <"$process/cmdline" 2>/dev/null || true)
            old_ifs=$IFS
            IFS="
"
            for argument in $arguments; do
              case $argument in
                -Djava.io.tmpdir=*)
                  java_tmp_property_count=$((java_tmp_property_count + 1))
                  effective_java_tmp=${argument#-Djava.io.tmpdir=}
                  ;;
                -Dorg.bytedeco.javacpp.cachedir=*)
                  javacpp_cache_property_count=$((javacpp_cache_property_count + 1))
                  effective_javacpp_cache=${argument#-Dorg.bytedeco.javacpp.cachedir=}
                  ;;
                -Doscar.data.tmpdir=*)
                  data_tmp_property_count=$((data_tmp_property_count + 1))
                  effective_data_tmp=${argument#-Doscar.data.tmpdir=}
                  ;;
              esac
            done
            IFS=$old_ifs
            ;;
        esac
      done
      printf "%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\\n" \
        "$tmp_type" "$tmp_rw" "$tmp_noexec" "$tmp_nosuid" "$tmp_nodev" \
        "$native_type" "$native_rw" "$native_noexec_absent" "$native_nosuid" "$native_nodev" \
        "$native_directory" "$native_executable" "$runtime_uid" "$runtime_gid" \
        "$native_owner_uid" "$native_owner_gid" "$native_mode" "$native_size_bytes" \
        "$java_process_count" "$java_tmp_property_count" "$effective_java_tmp" \
        "$javacpp_cache_property_count" "$effective_javacpp_cache" \
        "$data_tmp_property_count" "$effective_data_tmp" /tmp "$native_path"
    ')
    IFS='|' read -r tmp_mount_type tmp_mount_read_write tmp_mount_noexec tmp_mount_nosuid tmp_mount_nodev \
      native_mount_type native_mount_read_write native_mount_noexec_absent native_mount_nosuid native_mount_nodev \
      native_directory native_executable runtime_uid runtime_gid native_owner_uid native_owner_gid native_mode \
      native_size_bytes java_process_count java_tmp_property_count effective_java_tmp \
      javacpp_cache_property_count effective_javacpp_cache \
      data_tmp_property_count effective_data_tmp tmp_path native_path \
      <<<"$native_runtime_output"
    for value in "$tmp_mount_type" "$native_mount_type" "$native_mode" "$effective_java_tmp" \
      "$effective_javacpp_cache" "$effective_data_tmp" "$tmp_path" "$native_path"; do
      safe_json_text "$value"
    done
    for value in "$runtime_uid" "$runtime_gid" "$native_owner_uid" "$native_owner_gid" \
      "$native_size_bytes" "$java_process_count" "$java_tmp_property_count" \
      "$javacpp_cache_property_count" "$data_tmp_property_count"; do
      [[ $value =~ ^-?[0-9]+$ ]] || fail 'The OSCAR native-runtime probe returned a nonnumeric field.'
    done
    for value in "$tmp_mount_read_write" "$tmp_mount_noexec" "$tmp_mount_nosuid" "$tmp_mount_nodev" \
      "$native_mount_read_write" "$native_mount_noexec_absent" "$native_mount_nosuid" "$native_mount_nodev" \
      "$native_directory" "$native_executable"; do
      [[ $value == true || $value == false ]] || fail 'The OSCAR native-runtime probe returned a nonboolean field.'
    done
    app_backup_root_absent=false
    postgres_backup_root_absent=false
    if ! docker inspect "$app_container" --format '{{range .Mounts}}{{println .Destination}}{{end}}' |
         grep -Fqx /var/lib/oscar/backups; then
      app_backup_root_absent=true
    fi
    if ! docker inspect "$postgres_container" --format '{{range .Mounts}}{{println .Destination}}{{end}}' |
         grep -Fqx /var/lib/postgresql/backups; then
      postgres_backup_root_absent=true
    fi
    isolated_basebackup_wired=false
    if grep -Fq -- '--network "container:$postgres_container"' oscar-storage.sh &&
       grep -Fq -- '--volume "$work/postgres:/backup"' oscar-storage.sh &&
       grep -Fq -- '--volume "$script_dir/secrets/postgres-bootstrap-password.txt:/run/secrets/postgres_bootstrap_password:ro"' oscar-storage.sh &&
       ! grep -Fq 'target: /var/lib/postgresql/backups' compose.yaml &&
       ! grep -Fq 'target: /var/lib/oscar/backups' compose.yaml; then
      isolated_basebackup_wired=true
    fi
    app_version_label=$(image_label "$app_image" org.opencontainers.image.version)
    postgis_version_label=$(image_label "$postgis_image" org.opencontainers.image.version)
    postgis_profile_label=$(image_label "$postgis_image" com.botts.oscar.storage-profile)
    gateway_version_label=$(image_label "$gateway_image" org.opencontainers.image.version)
    for value in "$app_id" "$postgis_id" "$gateway_id" "$app_container_id" "$postgis_container_id" "$gateway_container_id" \
      "$app_version_label" "$postgis_version_label" "$postgis_profile_label" "$gateway_version_label"; do
      safe_json_text "$value"
    done
    app_digests=$(repo_digests_json "$app_image")
    postgis_digests=$(repo_digests_json "$postgis_image")
    gateway_digests=$(repo_digests_json "$gateway_image")
    config=/var/lib/oscar/config.json
    compose exec -T oscar sh -eu -c '
      path=$1
      test -f "$path" && test ! -L "$path"
      size=$(stat -c %s -- "$path")
      test "$size" -gt 0 && test "$size" -le 16777216
    ' config-contract "$config" || fail 'The live OSCAR config is missing, linked, empty, or over 16 MiB.'
    config_fields=$(platform_config_fields "$config") ||
      fail 'The live OSCAR config failed structural JSON extraction.'
    [[ -n $config_fields ]] ||
      fail 'The live OSCAR config does not contain exactly one correctly typed storage module set.'
    IFS='|' read -r interval hot_retention grace duck_memory duck_threads duck_temp_limit duck_max_sessions \
      duck_acquire_timeout duck_temp_dir media_retention media_query_period media_maximum_catch_up \
      media_late_arrival_overlap media_late_arrival_scan_period media_late_arrival_catch_up \
      media_reconciliation_catch_up media_reconciliation_period media_stream_refresh media_frame_count \
      media_jpeg_quality media_source_grace media_metadata_work media_maintenance_work \
      media_enabled delete_hot \
      daily_root daily_journal daily_publication daily_zone daily_mode daily_fsync daily_records \
      daily_unforced_bytes daily_segment_bytes daily_segment_age daily_record_bytes daily_retention \
      daily_require_backup lifecycle_delegated daily_purge_work archive_enabled storage_mode \
      primary_archive_delay stage_window future_skew primary_interval max_stage_partitions \
      max_generations max_verifications max_deletions output_names_json \
      unexpected_config_field <<<"$config_fields"
    [[ -z ${unexpected_config_field:-} ]] || fail 'The structural OSCAR config result is ambiguous.'
    packaged_config_fields=$(platform_config_fields /opt/oscar/config.json) ||
      fail 'The packaged OSCAR default config failed structural JSON extraction.'
    IFS='|' read -r -a packaged_config <<<"$packaged_config_fields"
    [[ ${#packaged_config[@]} -eq 51 ]] ||
      fail 'The packaged OSCAR default config result is ambiguous.'
    packaged_archive_interval=${packaged_config[0]}
    packaged_hot_retention=${packaged_config[1]}
    packaged_grace=${packaged_config[2]}
    packaged_media_retention=${packaged_config[9]}
    packaged_media_query_period=${packaged_config[10]}
    packaged_media_maximum_catch_up=${packaged_config[11]}
    packaged_media_late_arrival_overlap=${packaged_config[12]}
    packaged_media_late_arrival_scan_period=${packaged_config[13]}
    packaged_media_late_arrival_catch_up=${packaged_config[14]}
    packaged_media_reconciliation_catch_up=${packaged_config[15]}
    packaged_media_reconciliation_period=${packaged_config[16]}
    packaged_media_stream_refresh=${packaged_config[17]}
    packaged_media_frame_count=${packaged_config[18]}
    packaged_media_jpeg_quality=${packaged_config[19]}
    packaged_media_source_grace=${packaged_config[20]}
    packaged_media_metadata_work=${packaged_config[21]}
    packaged_media_maintenance_work=${packaged_config[22]}
    packaged_media_enabled=${packaged_config[23]}
    packaged_delete_hot=${packaged_config[24]}
    packaged_daily_retention=${packaged_config[36]}
    packaged_daily_require_backup=${packaged_config[37]}
    packaged_archive_enabled=${packaged_config[40]}
    packaged_storage_mode=${packaged_config[41]}
    packaged_primary_archive_delay=${packaged_config[42]}
    packaged_stage_window=${packaged_config[43]}
    packaged_future_skew=${packaged_config[44]}
    packaged_primary_interval=${packaged_config[45]}
    packaged_max_stage_partitions=${packaged_config[46]}
    packaged_max_generations=${packaged_config[47]}
    packaged_max_verifications=${packaged_config[48]}
    packaged_max_deletions=${packaged_config[49]}
    packaged_output_names_json=${packaged_config[50]}
    for value in "$daily_root" "$daily_journal" "$daily_publication" "$daily_zone" "$daily_mode" \
      "$storage_mode" "$packaged_storage_mode"; do
      safe_json_text "$value"
    done
    schema=$(scalar "SELECT coalesce(max(version),0) FROM oscar_storage_schema_version;")
    schema_checksum=$(scalar "SELECT coalesce((SELECT checksum FROM oscar_storage_schema_version WHERE version=5),'');")
    safe_json_text "$schema_checksum"
    checksums=$(scalar "SHOW data_checksums;")
    installed=$(scalar "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements');")
    preloaded=$(scalar "SELECT position('pg_stat_statements' in current_setting('shared_preload_libraries'))>0;")
    marker_text=$(compose exec -T postgres sh -c 'marker=/var/lib/postgresql/data/.oscar-data-checksum-init; test -f "$marker" && test ! -L "$marker" && cat "$marker"' 2>/dev/null || true)
    marker_lines=$(compose exec -T postgres sh -c 'marker=/var/lib/postgresql/data/.oscar-data-checksum-init; test -f "$marker" && test ! -L "$marker" && awk "END {print NR}" "$marker"' 2>/dev/null || true)
    marker_present=false; marker_exact=false; marker_format=''; marker_version=''; marker_checksums=''; marker_initialized=''
    if [[ -n $marker_text ]]; then
      marker_present=true
      marker_format=$(printf '%s\n' "$marker_text" | awk -F= '$1=="format" {print substr($0,index($0,"=")+1); exit}')
      marker_version=$(printf '%s\n' "$marker_text" | awk -F= '$1=="version" {print substr($0,index($0,"=")+1); exit}')
      marker_checksums=$(printf '%s\n' "$marker_text" | awk -F= '$1=="data_checksums" {print substr($0,index($0,"=")+1); exit}')
      marker_initialized=$(printf '%s\n' "$marker_text" | awk -F= '$1=="initialized_at" {print substr($0,index($0,"=")+1); exit}')
      if [[ $marker_lines == 4 && $marker_format == oscar-storage-profile &&
            $marker_version == "$expected_release" && $marker_checksums == on &&
            $marker_initialized =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
        marker_exact=true
      fi
    fi
    for value in "$marker_format" "$marker_version" "$marker_checksums" "$marker_initialized" "$duck_temp_dir"; do safe_json_text "$value"; done
    archive_scratch=$(archive_scratch_json "$duck_temp_dir" /var/lib/oscar/archive)
    batch_evidence=$(psql_admin --quiet --tuples-only --no-align --command "
      WITH current_db AS (
        SELECT oid AS dbid FROM pg_database WHERE datname = current_database()
      ), rewritten AS (
        SELECT coalesce(sum(calls),0)::bigint calls,
          coalesce(sum(GREATEST(rows, calls * regexp_count(query, '::jsonb'))),0)::bigint rows
        FROM pg_stat_statements statements
        JOIN current_db USING (dbid)
        WHERE query ~* '^[[:space:]]*insert[[:space:]]+into[[:space:]]+((oscar|public)[.])?obs[[:space:]]*[(]'
          AND query ~ '[)][[:space:]]*,[[:space:]]*[(]')
      SELECT calls||'|'||rows FROM rewritten;" | tail -n 1)
    IFS='|' read -r batch_calls batch_rows batch_extra <<<"$batch_evidence"
    [[ -z ${batch_extra:-} && $batch_calls =~ ^[0-9]+$ && $batch_rows =~ ^[0-9]+$ ]] ||
      fail 'Could not obtain bounded PostgreSQL batch-rewrite execution evidence.'
    batch=false
    if [[ $batch_calls -gt 0 && $batch_rows -gt $batch_calls ]]; then batch=true; fi
    observation_indexes=$(json_query "
      WITH required(indexname) AS (VALUES
        ('obs_pkey'),('obs_unique_constraint_v2'),('obs_datastream_idx'),
        ('obs_phenomenon_time_idx'),('obs_datastream_id_phenomenon_time_idx'),
        ('obs_result_time_idx'),('obs_datastream_id_result_time_idx'),('obs_foi_idx'),
        ('obs_unarchived_time_idx'),
        ('obs_result_path_ops_idx'),('obs_result_occupancy_count_idx'),
        ('obs_result_max_gamma_idx'),('obs_result_max_neutron_idx')
      ), actual AS (
        SELECT indexname,lower(indexdef) indexdef FROM pg_indexes
        WHERE schemaname=current_schema() AND tablename='obs'
      ), missing AS (
        SELECT required.indexname FROM required LEFT JOIN actual USING(indexname)
        WHERE actual.indexname IS NULL ORDER BY required.indexname
      )
      SELECT json_build_object(
        'genericPayloadGinAbsent',NOT EXISTS(SELECT 1 FROM actual WHERE indexname='obs_data_idx'),
        'requiredCount',(SELECT count(*) FROM required),
        'requiredPresent',(SELECT count(*) FROM required JOIN actual USING(indexname)),
        'missingNames',coalesce((SELECT json_agg(indexname) FROM missing),'[]'::json),
        'eventPathGinExact',EXISTS(SELECT 1 FROM actual WHERE indexname='obs_result_path_ops_idx'
          AND indexdef LIKE '%using gin (result jsonb_path_ops)%'),
        'numericEventIndexesExact',3=(SELECT count(*) FROM actual
          WHERE indexname IN ('obs_result_occupancy_count_idx','obs_result_max_gamma_idx',
            'obs_result_max_neutron_idx')
            AND indexdef LIKE '%datastreamid%' AND indexdef LIKE '%::numeric%'
            AND indexdef LIKE '%where (jsonb_typeof(%')
      );")
    [[ $observation_indexes == \{* ]] ||
      fail 'Could not verify the fresh PARQUET_PRIMARY observation index catalog.'
    journal=true
    printf '{"expectedRelease":"%s","configuredRelease":"%s","templateRelease":"%s","deploymentId":"%s","backupMode":"%s",' \
      "$expected_release" "$configured_release" "$template_release" "$deployment_id" "$backup_mode"
    printf '"storageRoots":{"archive":%s,"backup":%s},' \
      "$archive_identity" "$backup_identity"
    printf '"storageLock":{"directory":"%s","file":"%s","stablePath":%s,"private":%s,"behaviorTested":%s,"concurrentRejected":%s},' \
      "$lock_directory" "$lock_file" "$lock_path_stable" "$lock_private" "$lock_behavior_tested" "$concurrent_lock_rejected"
    printf '"postgresWal":{"archiveMode":"%s","archiveTimeout":"%s","archiveCommand":"%s","archiveCommandInactive":%s,"externalWalMountAbsent":%s},' \
      "$archive_mode" "$archive_timeout" "$archive_command" "$archive_command_inactive" "$external_wal_mount_absent"
    printf '"legacyWalArchive":{"configured":%s,"present":%s,"bytes":%s},' \
      "$legacy_wal_configured" "$legacy_wal_present" "$legacy_wal_bytes"
    printf '"archiveObjectHelper":{"helperPath":"/usr/local/bin/oscar-archive-object","packagedSha256":"%s","deployedSha256":"%s","regularExecutable":%s,"cliExportIntegrated":%s,"cliPurgeIntegrated":%s},' \
      "$packaged_archive_sha" "$deployed_archive_sha" "$archive_helper_regular" "$archive_export_helper_wired" "$archive_purge_helper_wired"
    printf '"restoreHelpers":{"prepare":{"helperPath":"/usr/local/bin/oscar-prepare-restore","packagedSha256":"%s","deployedSha256":"%s","regularExecutable":%s}},' \
      "$packaged_prepare_restore_sha" "$deployed_prepare_restore_sha" "$prepare_restore_helper_regular"
    printf '"atomicPublisher":{"helperPath":"/usr/local/bin/oscar-atomic-publish","sourceStampPath":"/usr/local/share/oscar-atomic-publish.source.sha256","packagedSourceSha256":"%s","deployedSourceSha256":"%s","deployedBinarySha256":"%s","regularExecutable":%s,"sourceStampRegular":%s,"behaviorTested":%s,"firstPublishSucceeded":%s,"collisionRejected":%s,"sourcePreserved":%s,"destinationPreserved":%s},' \
      "$packaged_atomic_source_sha" "$deployed_atomic_source_sha" "$deployed_atomic_sha" \
      "$atomic_publisher_regular" "$atomic_source_stamp_regular" "$atomic_behavior_tested" \
      "$atomic_first_publish_succeeded" "$atomic_collision_rejected" "$atomic_source_preserved" "$atomic_destination_preserved"
    printf '"backupIsolation":{"appBackupRootAbsent":%s,"postgresBackupRootAbsent":%s,"isolatedBasebackupWired":%s},' \
      "$app_backup_root_absent" "$postgres_backup_root_absent" "$isolated_basebackup_wired"
    printf '"nativeRuntime":{"entrypointPath":"/usr/local/bin/oscar-entrypoint","packagedEntrypointSha256":"%s","deployedEntrypointSha256":"%s","entrypointRegularExecutable":%s,"containerEntrypointExact":%s,"managedPropertiesAfterJavaOpts":%s,' \
      "$packaged_entrypoint_sha" "$deployed_entrypoint_sha" "$entrypoint_regular" \
      "$container_entrypoint_exact" "$entrypoint_tmp_contract"
    printf '"tmpPath":"%s","tmpMountType":"%s","tmpReadWrite":%s,"tmpNoexec":%s,"tmpNosuid":%s,"tmpNodev":%s,' \
      "$tmp_path" "$tmp_mount_type" "$tmp_mount_read_write" "$tmp_mount_noexec" "$tmp_mount_nosuid" "$tmp_mount_nodev"
    printf '"nativePath":"%s","nativeMountType":"%s","nativeReadWrite":%s,"nativeNoexecAbsent":%s,"nativeNosuid":%s,"nativeNodev":%s,"nativeDirectory":%s,"nativeExecutable":%s,' \
      "$native_path" "$native_mount_type" "$native_mount_read_write" "$native_mount_noexec_absent" \
      "$native_mount_nosuid" "$native_mount_nodev" "$native_directory" "$native_executable"
    printf '"runtimeUid":%s,"runtimeGid":%s,"nativeOwnerUid":%s,"nativeOwnerGid":%s,"nativeMode":"%s","nativeSizeBytes":%s,"javaProcessCount":%s,"javaTmpPropertyCount":%s,"effectiveJavaTmp":"%s","javaCppCachePropertyCount":%s,"effectiveJavaCppCache":"%s","dataTmpPropertyCount":%s,"effectiveDataTmp":"%s"},' \
      "$runtime_uid" "$runtime_gid" "$native_owner_uid" "$native_owner_gid" "$native_mode" \
      "$native_size_bytes" "$java_process_count" "$java_tmp_property_count" "$effective_java_tmp" \
      "$javacpp_cache_property_count" "$effective_javacpp_cache" \
      "$data_tmp_property_count" "$effective_data_tmp"
    printf '"appImage":{"reference":"%s","imageId":"%s","containerImageId":"%s","repoDigests":%s,"versionLabel":"%s","storageProfileLabel":""},' \
      "$app_image" "$app_id" "$app_container_id" "$app_digests" "$app_version_label"
    printf '"postgisImage":{"reference":"%s","imageId":"%s","containerImageId":"%s","repoDigests":%s,"versionLabel":"%s","storageProfileLabel":"%s"},' \
      "$postgis_image" "$postgis_id" "$postgis_container_id" "$postgis_digests" "$postgis_version_label" "$postgis_profile_label"
    printf '"gatewayImage":{"reference":"%s","imageId":"%s","containerImageId":"%s","repoDigests":%s,"versionLabel":"%s","storageProfileLabel":""},' \
      "$gateway_image" "$gateway_id" "$gateway_container_id" "$gateway_digests" "$gateway_version_label"
    printf '"dataChecksums":"%s","pgStatStatementsInstalled":%s,"pgStatStatementsPreloaded":%s,"schemaVersion":%s,"schemaChecksum":"%s",' \
      "$checksums" "$([[ $installed == t ]] && echo true || echo false)" "$([[ $preloaded == t ]] && echo true || echo false)" "$schema" "$schema_checksum"
    printf '"archiveMarker":{"present":%s,"exact":%s,"format":"%s","version":"%s","dataChecksums":"%s","initializedAt":"%s"},' \
      "$marker_present" "$marker_exact" "$marker_format" "$marker_version" "$marker_checksums" "$marker_initialized"
    printf '"batchRewriteConfigured":%s,"batchRewriteObservedCalls":%s,"batchRewriteObservedRows":%s,"dailyJournalConfigured":%s,"archiveEnabled":%s,"storageMode":"%s","parquetPrimaryArchiveDelayMinutes":%s,"immutableStageWindowMinutes":%s,"maximumFuturePhenomenonSkewMinutes":%s,"parquetPrimaryIntervalMinutes":%s,"maximumStagePartitionsPerCycle":%s,"archiveIntervalMinutes":%s,"hotRetentionDays":%s,"deleteHotAfterArchive":%s,"rollbackGraceDays":%s,"maximumGenerationsPerCycle":%s,"maximumVerificationsPerCycle":%s,"maximumDeletionsPerCycle":%s,"outputNames":%s,"observationIndexes":%s,' \
      "$batch" "$batch_calls" "$batch_rows" "$journal" "$archive_enabled" "$storage_mode" \
      "${primary_archive_delay:-null}" "${stage_window:-null}" "${future_skew:-null}" \
      "${primary_interval:-null}" "${max_stage_partitions:-null}" \
      "${interval:-null}" "${hot_retention:-null}" "$delete_hot" \
      "${grace:-null}" "${max_generations:-null}" "${max_verifications:-null}" \
      "${max_deletions:-null}" "$output_names_json" "$observation_indexes"
    printf '"packagedDefaults":{"archiveEnabled":%s,"storageMode":"%s","parquetPrimaryArchiveDelayMinutes":%s,"immutableStageWindowMinutes":%s,"maximumFuturePhenomenonSkewMinutes":%s,"parquetPrimaryIntervalMinutes":%s,"maximumStagePartitionsPerCycle":%s,"archiveIntervalMinutes":%s,"hotRetentionDays":%s,"rollbackGraceDays":%s,"maximumGenerationsPerCycle":%s,"maximumVerificationsPerCycle":%s,"maximumDeletionsPerCycle":%s,"outputNames":%s,"deleteHotAfterArchive":%s,"videoRetentionDays":%s,"videoQueryPeriodMinutes":%s,"maximumCatchUpHours":%s,"lateArrivalOverlapHours":%s,"lateArrivalScanPeriodMinutes":%s,"lateArrivalCatchUpHours":%s,"reconciliationCatchUpHours":%s,"reconciliationPeriodHours":%s,"occupancyStreamRefreshMinutes":%s,"retainedFrameCount":%s,"jpegQuality":%s,"sourceRollbackGraceHours":%s,"metadataReclamationWorkLimit":%s,"maintenanceWorkLimit":%s,"frameRetentionEnabled":%s,"sealedJournalRetentionDays":%s,"requireBackupBeforeSealedJournalDeletion":%s},' \
      "$packaged_archive_enabled" "$packaged_storage_mode" "$packaged_primary_archive_delay" \
      "$packaged_stage_window" "$packaged_future_skew" "$packaged_primary_interval" \
      "$packaged_max_stage_partitions" \
      "$packaged_archive_interval" "$packaged_hot_retention" "$packaged_grace" \
      "$packaged_max_generations" "$packaged_max_verifications" "$packaged_max_deletions" \
      "$packaged_output_names_json" "$packaged_delete_hot" \
      "$packaged_media_retention" "$packaged_media_query_period" "$packaged_media_maximum_catch_up" \
      "$packaged_media_late_arrival_overlap" "$packaged_media_late_arrival_scan_period" \
      "$packaged_media_late_arrival_catch_up" "$packaged_media_reconciliation_catch_up" \
      "$packaged_media_reconciliation_period" "$packaged_media_stream_refresh" \
      "$packaged_media_frame_count" "$packaged_media_jpeg_quality" \
      "$packaged_media_source_grace" "$packaged_media_metadata_work" \
      "$packaged_media_maintenance_work" "$packaged_media_enabled" \
      "$packaged_daily_retention" "$packaged_daily_require_backup"
    printf '"archiveResources":{"memoryLimitMegabytes":%s,"threads":%s,"maximumTemporaryMegabytes":%s,"maximumConcurrentSessions":%s,"sessionAcquireTimeoutSeconds":%s,"temporaryDirectory":"%s"},' \
      "${duck_memory:-null}" "${duck_threads:-null}" "${duck_temp_limit:-null}" \
      "${duck_max_sessions:-null}" "${duck_acquire_timeout:-null}" "$duck_temp_dir"
    printf '"archiveScratch":%s,' "$archive_scratch"
    printf '"dailyJournal":{"rootDirectory":"%s","journalDirectory":"%s","publicationDirectory":"%s","zoneId":"%s","observationMode":"%s","fsyncIntervalMillis":%s,"maxUnforcedRecords":%s,"maxUnforcedBytes":%s,"maxSegmentBytes":%s,"maxSegmentAgeSeconds":%s,"maxRecordBytes":%s,"sealedJournalRetentionDays":%s,"requireBackupBeforeSealedJournalDeletion":%s,"observationLifecycleDelegated":%s,"purgeWorkLimit":%s},' \
      "$daily_root" "$daily_journal" "$daily_publication" "$daily_zone" "$daily_mode" \
      "${daily_fsync:-null}" "${daily_records:-null}" "${daily_unforced_bytes:-null}" \
      "${daily_segment_bytes:-null}" "${daily_segment_age:-null}" "${daily_record_bytes:-null}" \
      "${daily_retention:-null}" "$daily_require_backup" "$lifecycle_delegated" "${daily_purge_work:-null}"
    printf '"videoRetention":{"enabled":%s,"timeToRetentionDays":%s,"queryPeriodMinutes":%s,"maximumCatchUpHours":%s,"lateArrivalOverlapHours":%s,"lateArrivalScanPeriodMinutes":%s,"lateArrivalCatchUpHours":%s,"reconciliationCatchUpHours":%s,"reconciliationPeriodHours":%s,"occupancyStreamRefreshMinutes":%s,"frameCount":%s,"jpegQuality":%s,"sourceRollbackGraceHours":%s,"metadataReclamationWorkLimit":%s,"maintenanceWorkLimit":%s}}\n' \
      "$media_enabled" "${media_retention:-null}" "${media_query_period:-null}" \
      "${media_maximum_catch_up:-null}" "${media_late_arrival_overlap:-null}" \
      "${media_late_arrival_scan_period:-null}" "${media_late_arrival_catch_up:-null}" \
      "${media_reconciliation_catch_up:-null}" "${media_reconciliation_period:-null}" \
      "${media_stream_refresh:-null}" \
      "${media_frame_count:-null}" "${media_jpeg_quality:-null}" "${media_source_grace:-null}" \
      "${media_metadata_work:-null}" "${media_maintenance_work:-null}"
    ;;

  archive-scratch-health)
    archive_scratch_json /var/lib/oscar/duckdb-tmp /var/lib/oscar/archive
    ;;

  media-metadata-health)
    media_metadata_health_json
    ;;

  retention-runtime-health)
    retention_runtime_health_json
    ;;

  backup-mode-check)
    backup_mode=$(env_value OSCAR_BACKUP_MODE disabled)
    [[ $backup_mode == disabled ]] || fail 'backup-mode-check is valid only for disabled mode.'
    backup_path=$(absolute_path "$(env_value OSCAR_BACKUP_DIR ../oscar-storage/backups)")
    legacy_wal_value=$(awk -F= '$1 == "OSCAR_WAL_ARCHIVE_DIR" { print substr($0, index($0, "=") + 1); exit }' .env)
    legacy_wal_path=$(absolute_path "${legacy_wal_value:-../oscar-storage/wal-archive}")
    services_before=$(running_services_fingerprint)
    backup_before=$(tree_fingerprint "$backup_path")
    wal_before=$(tree_fingerprint "$legacy_wal_path")
    wal_bytes_before=$(directory_bytes "$legacy_wal_path")
    epochs_before=$(scalar 'SELECT count(*) FROM oscar_backup_epoch;')
    work=$(mktemp -d /tmp/oscar-regression-disabled-backup.XXXXXXXX)
    cleanup_disabled_backup_check() { rm -rf -- "$work"; }
    trap cleanup_disabled_backup_check EXIT
    expected_message='OSCAR backups are disabled. Re-run upgrade with --backup-mode single --backup-dir <safe-absolute-backup-path> before using backup, verification, pruning, or restore.'
    commands_rejected=true
    index=0
    while IFS= read -r command; do
      index=$((index+1)); log="$work/$index.log"
      set +e
      bash -c "$command" >"$log" 2>&1
      status=$?
      set -e
      plain_message_count=$(grep -Fxc "$expected_message" "$log" || true)
      launcher_message_count=$(grep -Fxc "ERROR: $expected_message" "$log" || true)
      if [[ $status -eq 0 || $((plain_message_count + launcher_message_count)) -ne 1 ]]; then
        commands_rejected=false
      fi
    done <<'COMMANDS'
bash oscar.sh backup
bash oscar.sh backup-verify 20000101T000000Z-00000000
bash oscar.sh backup-prune
bash oscar.sh restore --backup 20000101T000000Z-00000000 --confirm 20000101T000000Z-00000000
COMMANDS
    # A forced segment switch proves that an inactive external WAL directory
    # does not grow. The internal pg_wal volume is intentionally outside this
    # fingerprint and remains PostgreSQL-managed.
    scalar 'SELECT pg_switch_wal();' >/dev/null
    sleep 2
    services_after=$(running_services_fingerprint)
    backup_after=$(tree_fingerprint "$backup_path")
    wal_after=$(tree_fingerprint "$legacy_wal_path")
    wal_bytes_after=$(directory_bytes "$legacy_wal_path")
    epochs_after=$(scalar 'SELECT count(*) FROM oscar_backup_epoch;')
    backup_unchanged=false; [[ $backup_before == "$backup_after" ]] && backup_unchanged=true
    wal_unchanged=false
    [[ $wal_before == "$wal_after" && $wal_bytes_before == "$wal_bytes_after" ]] && wal_unchanged=true
    services_unchanged=false; [[ $services_before == "$services_after" ]] && services_unchanged=true
    epochs_unchanged=false; [[ $epochs_before == "$epochs_after" ]] && epochs_unchanged=true
    cleanup_disabled_backup_check
    trap - EXIT
    printf '{"mode":"disabled","commandsRejected":%s,"backupTreeUnchanged":%s,"legacyWalTreeUnchanged":%s,"legacyWalBytesBefore":%s,"legacyWalBytesAfter":%s,"servicesUnchanged":%s,"backupEpochsUnchanged":%s}\n' \
      "$commands_rejected" "$backup_unchanged" "$wal_unchanged" "$wal_bytes_before" \
      "$wal_bytes_after" "$services_unchanged" "$epochs_unchanged"
    ;;

  snapshot)
    archive_dir=$(absolute_path "$(env_value OSCAR_ARCHIVE_DIR ../oscar-storage/archive)")
    backup_dir=$(absolute_path "$(env_value OSCAR_BACKUP_DIR ../oscar-storage/backups)")
    journal_bytes=$(compose exec -T oscar sh -c "du -sb /var/lib/oscar/files/.dailyfile-journal 2>/dev/null | awk '{print \$1+0}'" || echo 0)
    daily_bytes=$(compose exec -T oscar sh -c "du -sb /var/lib/oscar/files/dailyfiles 2>/dev/null | awk '{print \$1+0}'" || echo 0)
    media_bytes=$(compose exec -T oscar sh -c "du -sb /var/lib/oscar/files/videos/retained-media 2>/dev/null | awk '{print \$1+0}'" || echo 0)
    metadata_stats=$(compose exec -T oscar sh -eu -c '
      root=/var/lib/oscar/files/videos/retained-media/v1
      count() { path=$1; shift; find "$path" "$@" 2>/dev/null | wc -l | tr -d "[:space:]"; }
      bytes() { path=$1; shift; find "$path" "$@" -printf "%s\n" 2>/dev/null | awk "{sum+=\$1} END {print sum+0}"; }
      manifests=$(count "$root/events" -type f -name manifest.json)
      jpegs=$(count "$root/events" -type f -name "frame-0[1-5].jpg")
      processed=$(count "$root/retention-processed-index" -mindepth 1 -maxdepth 1 -type f -name "*.idx")
      processed_bytes=$(bytes "$root/retention-processed-index" -mindepth 1 -maxdepth 1 -type f -name "*.idx")
      deleted=$(count "$root/deletion-index" -mindepth 2 -maxdepth 2 -type f -name "*.idx")
      deleted_bytes=$(bytes "$root/deletion-index" -mindepth 2 -maxdepth 2 -type f -name "*.idx")
      legacy_processed=$(count "$root/retention-processed" -type f -name "*.json")
      legacy_deleted=$(count "$root/events" -type f -name .deleted.json)
      checkpoint=0
      checkpoint_path="$root/.metadata-reclamation-checkpoint.json"
      if [ -f "$checkpoint_path" ] && [ ! -L "$checkpoint_path" ]; then
        checkpoint=$(stat -c %s -- "$checkpoint_path")
      fi
      printf "%s|%s|%s|%s|%s|%s|%s|%s|%s\n" "$manifests" "$jpegs" "$processed" \
        "$processed_bytes" "$deleted" "$deleted_bytes" "$legacy_processed" "$legacy_deleted" "$checkpoint"
    ' metadata-stats)
    IFS='|' read -r media_manifests media_jpegs processed_indexes processed_index_bytes \
      deletion_indexes deletion_index_bytes legacy_markers legacy_tombstones metadata_checkpoint_bytes \
      <<<"$metadata_stats"
    for value in "$media_manifests" "$media_jpegs" "$processed_indexes" "$processed_index_bytes" \
      "$deletion_indexes" "$deletion_index_bytes" "$legacy_markers" "$legacy_tombstones" \
      "$metadata_checkpoint_bytes"; do
      [[ $value =~ ^[0-9]+$ ]] || fail 'Media metadata inventory returned a nonnumeric field.'
    done
    archive_bytes=$(directory_bytes "$archive_dir"); backup_bytes=$(directory_bytes "$backup_dir")
    json_query "WITH db AS (
      SELECT pg_database_size(current_database()) database_size,
        coalesce(pg_total_relation_size('obs'::regclass),0) obs_total,
        coalesce(pg_relation_size('obs'::regclass),0) obs_heap),
    stats AS (SELECT temp_bytes,xact_commit,xact_rollback,tup_inserted,tup_updated,tup_deleted FROM pg_stat_database WHERE datname=current_database()),
    wal AS (SELECT wal_bytes::numeric wal_bytes FROM pg_stat_wal),
    current_db AS (SELECT oid FROM pg_database WHERE datname=current_database()),
    statements AS (SELECT coalesce(sum(calls),0) calls,
        coalesce(sum(GREATEST(rows, calls * GREATEST(regexp_count(query, '::jsonb'), 1))),0) rows
      FROM pg_stat_statements,current_db WHERE dbid=current_db.oid
        AND query ~* '^[[:space:]]*insert[[:space:]]+into[[:space:]]+((oscar|public)[.])?obs([[:space:]]|[(])'),
    statement_io AS (SELECT coalesce(sum(temp_blks_written),0) temp_blocks,
        coalesce(sum(calls) FILTER (WHERE query ~* '^[[:space:]]*delete[[:space:]]+from[[:space:]]+(only[[:space:]]+)?((oscar|public)[.])?(obs([[:space:]]|$)|oscar_obs_stage_[a-z0-9_]+([[:space:]]|$))'
          AND query !~* 'oscar_obs_stage_(owner|partition)([[:space:]]|$)'),0) delete_calls,
        coalesce(sum(rows) FILTER (WHERE query ~* '^[[:space:]]*delete[[:space:]]+from[[:space:]]+(only[[:space:]]+)?((oscar|public)[.])?(obs([[:space:]]|$)|oscar_obs_stage_[a-z0-9_]+([[:space:]]|$))'
          AND query !~* 'oscar_obs_stage_(owner|partition)([[:space:]]|$)'),0) delete_rows,
        coalesce(sum(calls) FILTER (WHERE query ~* '^[[:space:]]*delete[[:space:]]+from[[:space:]]+(only[[:space:]]+)?((oscar|public)[.])?(obs([[:space:]]|$)|oscar_obs_stage_[a-z0-9_]+([[:space:]]|$))'
          AND query !~* 'oscar_obs_stage_(owner|partition)([[:space:]]|$)'
          AND query ~* 'id[[:space:]]*=[[:space:]]*[$][0-9]+' AND query !~* 'any[[:space:]]*[(]'),0) singleton_delete_calls,
        coalesce(sum(calls) FILTER (WHERE query ~* '^[[:space:]]*delete[[:space:]]+from[[:space:]]+(only[[:space:]]+)?((oscar|public)[.])?(obs([[:space:]]|$)|oscar_obs_stage_[a-z0-9_]+([[:space:]]|$))'
          AND query !~* 'oscar_obs_stage_(owner|partition)([[:space:]]|$)'
          AND query ~* 'id[[:space:]]*=[[:space:]]*any[[:space:]]*[(]'),0) batch_delete_calls,
        coalesce(sum(rows) FILTER (WHERE query ~* '^[[:space:]]*delete[[:space:]]+from[[:space:]]+(only[[:space:]]+)?((oscar|public)[.])?(obs([[:space:]]|$)|oscar_obs_stage_[a-z0-9_]+([[:space:]]|$))'
          AND query !~* 'oscar_obs_stage_(owner|partition)([[:space:]]|$)'
          AND query ~* 'id[[:space:]]*=[[:space:]]*any[[:space:]]*[(]'),0) batch_delete_rows
      FROM pg_stat_statements,current_db WHERE dbid=current_db.oid),
    catalog AS (SELECT count(*) FILTER(WHERE state='ACTIVE') active,count(*) FILTER(WHERE state='SEALED') sealed,coalesce(sum(row_count),0) rows FROM oscar_archive_generation),
    jobs AS (SELECT count(*) FILTER(WHERE state='FAILED') failed FROM oscar_archive_job),
    parity AS (SELECT count(*) FILTER(WHERE status<>'PASSED') failed FROM oscar_archive_verification WHERE verification_type='PARITY'),
    holds AS (SELECT count(*) FILTER(WHERE released_at IS NULL) active FROM oscar_retention_hold),
    backups AS (SELECT count(*) FILTER(WHERE state='VERIFIED') verified FROM oscar_backup_epoch),
    ds_bloat AS (
      SELECT coalesce(pg_total_relation_size(to_regclass('oscar.obs_datastreams')),0) ds_total,
        coalesce((SELECT n_tup_upd FROM pg_stat_user_tables WHERE schemaname='oscar' AND relname='obs_datastreams'),0) ds_updates,
        coalesce((SELECT n_tup_hot_upd FROM pg_stat_user_tables WHERE schemaname='oscar' AND relname='obs_datastreams'),0) ds_hot_updates,
        coalesce((SELECT count(*) * 12 FROM ONLY oscar.obs o JOIN oscar.obs_datastreams d ON d.id=o.datastreamid WHERE d.data->>'outputName'='connectionStatus' AND o.phenomenontime >= (now() AT TIME ZONE 'UTC') - interval '5 minutes'),0) conn_status_rows_last_hour,
        (to_regclass('oscar.oscar_archive_schema_datastream_idx') IS NOT NULL)::int archive_schema_ds_idx
    )
    SELECT json_build_object('databaseSizeBytes',db.database_size,'observationTableBytes',db.obs_heap,
      'observationIndexBytes',db.obs_total-db.obs_heap,'walBytes',wal.wal_bytes,'tempBytes',stats.temp_bytes,
      'tuplesInserted',stats.tup_inserted,'tuplesUpdated',stats.tup_updated,'tuplesDeleted',stats.tup_deleted,
      'transactionCommits',stats.xact_commit,'transactionRollbacks',stats.xact_rollback,
      'observationInsertCalls',statements.calls,'observationInsertRows',statements.rows,
      'observationRowsPerCall',CASE WHEN statements.calls=0 THEN NULL ELSE statements.rows/statements.calls END,
      'statementTempBlocksWritten',statement_io.temp_blocks,
      'observationDeleteCalls',statement_io.delete_calls,'observationDeleteRows',statement_io.delete_rows,
      'observationRowsPerDeleteCall',CASE WHEN statement_io.delete_calls=0 THEN NULL
        ELSE statement_io.delete_rows/statement_io.delete_calls END,
      'legacySingletonObservationDeleteCalls',statement_io.singleton_delete_calls,
      'batchedObservationDeleteCalls',statement_io.batch_delete_calls,
      'batchedObservationDeleteRows',statement_io.batch_delete_rows,
      'batchedObservationRowsPerDeleteCall',CASE WHEN statement_io.batch_delete_calls=0 THEN NULL
        ELSE statement_io.batch_delete_rows/statement_io.batch_delete_calls END,
      'activeArchiveGenerations',catalog.active,'sealedArchiveGenerations',catalog.sealed,'archiveRows',catalog.rows,
      'archiveBytes',$archive_bytes,'failedArchiveJobs',jobs.failed,'failedParityReceipts',parity.failed,
      'activeHolds',holds.active,'verifiedBackups',backups.verified,'journalBytes',${journal_bytes:-0},
      'dailyFileBytes',${daily_bytes:-0},'retainedMediaBytes',${media_bytes:-0},
      'retainedMediaManifestFiles',$media_manifests,'retainedMediaJpegFiles',$media_jpegs,
      'processedObservationIndexFiles',$processed_indexes,'processedObservationIndexBytes',$processed_index_bytes,
      'deletionIndexFiles',$deletion_indexes,'deletionIndexBytes',$deletion_index_bytes,
      'legacyProcessedMarkerFiles',$legacy_markers,'legacyDeletionTombstones',$legacy_tombstones,
      'mediaMetadataCheckpointBytes',$metadata_checkpoint_bytes,'backupBytes',$backup_bytes,
      'datastreamsTableBytes',ds_bloat.ds_total,'datastreamsUpdates',ds_bloat.ds_updates,
      'datastreamsHotUpdates',ds_bloat.ds_hot_updates,
      'connectionStatusRowsLastHour',ds_bloat.conn_status_rows_last_hour,
      'archiveSchemaDatastreamIndexPresent',ds_bloat.archive_schema_ds_idx)
    FROM db,stats,wal,statements,statement_io,catalog,jobs,parity,holds,backups,ds_bloat;"
    ;;

  stage-health)
    config_fields=$(platform_config_fields /var/lib/oscar/config.json) ||
      fail 'The live OSCAR config failed structural JSON extraction for stage health.'
    IFS='|' read -r -a stage_config <<<"$config_fields"
    [[ ${#stage_config[@]} -eq 51 ]] ||
      fail 'The live OSCAR config result is ambiguous for stage health.'
    stage_mode=${stage_config[41]}; stage_window=${stage_config[43]}
    [[ $stage_mode == PARQUET_PRIMARY || $stage_mode == HOT_RETENTION ]] ||
      fail 'The live OSCAR storage mode is unsupported.'
    if [[ $stage_mode != PARQUET_PRIMARY ]]; then
      safe_json_text "$stage_mode"
      printf '{"applicable":false,"storageMode":"%s"}\n' "$stage_mode"
      exit 0
    fi
    [[ $stage_window == 30 ]] || fail 'PARQUET_PRIMARY stage health requires a 30-minute stage window.'
    stage_tables=$(scalar "SELECT count(*) FROM (VALUES
      (to_regclass(current_schema()||'.oscar_obs_stage_partition')),
      (to_regclass(current_schema()||'.oscar_obs_stage_owner')),
      (to_regclass(current_schema()||'.oscar_obs_storage_route'))) required(relation)
      WHERE relation IS NOT NULL;")
    [[ $stage_tables == 3 ]] || fail 'PARQUET_PRIMARY stage catalog tables are incomplete.'

    stage_base=$(psql_admin --quiet --tuples-only --no-align --field-separator='|' --command "
      SELECT
        count(*) FILTER (WHERE state='ATTACHED'),
        count(*) FILTER (WHERE state='DETACHED'),
        (SELECT count(*) FROM oscar_obs_stage_owner),
        (SELECT count(*) FROM oscar_obs_stage_owner owner
          WHERE NOT EXISTS (SELECT 1 FROM oscar_obs_stage_partition partition
            WHERE partition.store_key=owner.store_key AND partition.id_scope=owner.id_scope
              AND partition.child_table=owner.child_table)),
        (SELECT count(*) FROM oscar_obs_stage_owner owner
          WHERE NOT EXISTS (SELECT 1 FROM oscar_archive_generation generation
            WHERE generation.id=owner.generation_id)),
        (SELECT count(*) FROM ONLY obs),
        (SELECT count(*) FROM ONLY obs observation WHERE EXISTS (
          SELECT 1 FROM oscar_obs_storage_route route
          WHERE route.datastream_id=observation.datastreamid AND route.immutable))
      FROM oscar_obs_stage_partition;" | tail -n 1)
    IFS='|' read -r attached_children detached_children owner_count orphan_registry_owners \
      orphan_generation_owners parent_rows parent_immutable_rows base_extra <<<"$stage_base"
    [[ -z ${base_extra:-} && $attached_children =~ ^[0-9]+$ && $detached_children =~ ^[0-9]+$ &&
       $owner_count =~ ^[0-9]+$ && $orphan_registry_owners =~ ^[0-9]+$ &&
       $orphan_generation_owners =~ ^[0-9]+$ && $parent_rows =~ ^[0-9]+$ &&
       $parent_immutable_rows =~ ^[0-9]+$ ]] || fail 'Could not obtain bounded stage catalog counts.'

    stage_rows=0; owned_stage_rows=0; attached_unowned_rows=0; detached_unowned_rows=0
    owners_missing_rows=0; marker_nonnull_rows=0; immutable_route_mismatches=0
    missing_relations=0; inheritance_mismatches=0; oldest_age_seconds=0; oldest_received_at=''
    sample_consistent=true
    while IFS='|' read -r store_key id_scope parent_table child_table state window_valid extra; do
      [[ -n $store_key ]] || continue
      if ! valid_store_key "$store_key" || ! valid_id_scope "$id_scope" ||
         ! valid_store_key "$parent_table" || ! valid_store_key "$child_table" ||
         [[ -n ${extra:-} ]] || [[ $state != ATTACHED && $state != DETACHED ]]; then
        fail 'Stage catalog contains an unsafe or ambiguous partition identity.'
      fi
      relation_present=$(scalar "SELECT to_regclass(current_schema()||'.$child_table') IS NOT NULL;")
      if [[ $relation_present != t ]]; then
        missing_relations=$((missing_relations+1)); sample_consistent=false; continue
      fi
      logged_regular=$(scalar "SELECT EXISTS(SELECT 1 FROM pg_class child
        JOIN pg_namespace child_namespace ON child_namespace.oid=child.relnamespace
        WHERE child_namespace.nspname=current_schema() AND child.relname='$child_table'
          AND child.relkind='r' AND child.relpersistence='p');")
      inherits=$(scalar "SELECT EXISTS(SELECT 1 FROM pg_inherits inheritance
        JOIN pg_class child ON child.oid=inheritance.inhrelid
        JOIN pg_class parent ON parent.oid=inheritance.inhparent
        JOIN pg_namespace child_namespace ON child_namespace.oid=child.relnamespace
        JOIN pg_namespace parent_namespace ON parent_namespace.oid=parent.relnamespace
        WHERE child_namespace.nspname=current_schema() AND parent_namespace.nspname=current_schema()
          AND child.relname='$child_table' AND parent.relname='$parent_table');")
      if [[ $window_valid != t || $logged_regular != t ||
            ($state == ATTACHED && $inherits != t) || ($state == DETACHED && $inherits != f) ]]; then
        inheritance_mismatches=$((inheritance_mismatches+1)); sample_consistent=false
      fi
      child_metrics=$(psql_admin --quiet --tuples-only --no-align --field-separator='|' --command "
        SELECT count(*),
          coalesce(to_char(min(received_at) AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'),''),
          coalesce(extract(epoch FROM clock_timestamp()-min(received_at))::bigint,0),
          count(*) FILTER (WHERE archivegenerationid IS NOT NULL),
          count(*) FILTER (WHERE owner.observation_id IS NOT NULL),
          count(*) FILTER (WHERE owner.observation_id IS NULL),
          count(*) FILTER (WHERE NOT coalesce(route.immutable,false)),
          (SELECT count(*) FROM oscar_obs_stage_owner owner
            WHERE owner.store_key='$store_key' AND owner.id_scope=$id_scope
              AND owner.child_table='$child_table'
              AND NOT EXISTS (SELECT 1 FROM $child_table physical
                WHERE physical.id=owner.observation_id))
        FROM $child_table stage
        LEFT JOIN oscar_obs_stage_owner owner
          ON owner.store_key='$store_key' AND owner.id_scope=$id_scope
          AND owner.child_table='$child_table' AND owner.observation_id=stage.id
        LEFT JOIN oscar_obs_storage_route route
          ON route.store_key='$store_key' AND route.id_scope=$id_scope
          AND route.datastream_id=stage.datastreamid;" 2>/dev/null | tail -n 1 || true)
      IFS='|' read -r child_rows child_oldest child_age child_markers child_owned child_unowned \
        child_route_mismatch child_missing_owners child_extra <<<"$child_metrics"
      if [[ -n ${child_extra:-} || ! $child_rows =~ ^[0-9]+$ || ! $child_age =~ ^[0-9]+$ ||
            ! $child_markers =~ ^[0-9]+$ || ! $child_owned =~ ^[0-9]+$ ||
            ! $child_unowned =~ ^[0-9]+$ || ! $child_route_mismatch =~ ^[0-9]+$ ||
            ! $child_missing_owners =~ ^[0-9]+$ ]]; then
        sample_consistent=false; continue
      fi
      stage_rows=$((stage_rows+child_rows)); owned_stage_rows=$((owned_stage_rows+child_owned))
      marker_nonnull_rows=$((marker_nonnull_rows+child_markers))
      immutable_route_mismatches=$((immutable_route_mismatches+child_route_mismatch))
      owners_missing_rows=$((owners_missing_rows+child_missing_owners))
      if [[ $state == ATTACHED ]]; then attached_unowned_rows=$((attached_unowned_rows+child_unowned))
      else detached_unowned_rows=$((detached_unowned_rows+child_unowned)); fi
      if (( child_age > oldest_age_seconds )); then
        oldest_age_seconds=$child_age; oldest_received_at=$child_oldest
      fi
    done < <(psql_admin --quiet --tuples-only --no-align --field-separator='|' --command "
      SELECT store_key,id_scope,parent_table,child_table,state,
        (window_end=window_start+make_interval(mins=>$stage_window)
          AND extract(epoch FROM window_start)::bigint % ($stage_window*60)=0)
      FROM oscar_obs_stage_partition ORDER BY store_key,id_scope,window_start,child_table;")
    [[ -z $oldest_received_at ]] || safe_json_text "$oldest_received_at"
    if (( owned_stage_rows + owners_missing_rows != owner_count )); then sample_consistent=false; fi
    slo_exceeded=false
    if (( oldest_age_seconds > 3600 )); then slo_exceeded=true; fi
    printf '{"applicable":true,"storageMode":"PARQUET_PRIMARY","attachedChildCount":%s,"detachedChildCount":%s,' \
      "$attached_children" "$detached_children"
    printf '"stageRowCount":%s,"oldestReceivedAt":%s,"oldestReceivedAtAgeSeconds":%s,"stagingSloSeconds":3600,"stagingSloExceeded":%s,' \
      "$stage_rows" "$([[ -n $oldest_received_at ]] && printf '"%s"' "$oldest_received_at" || printf null)" \
      "$oldest_age_seconds" "$slo_exceeded"
    printf '"exactSidecarOwnerCount":%s,"ownedStageRowCount":%s,"attachedUnownedRowCount":%s,"detachedUnownedRowCount":%s,' \
      "$owner_count" "$owned_stage_rows" "$attached_unowned_rows" "$detached_unowned_rows"
    printf '"orphanRegistryOwnerCount":%s,"orphanGenerationOwnerCount":%s,"ownersMissingPhysicalRowCount":%s,' \
      "$orphan_registry_owners" "$orphan_generation_owners" "$owners_missing_rows"
    printf '"markerNonNullRowCount":%s,"immutableRouteMismatchRowCount":%s,"parentOnlyRowCount":%s,"parentImmutableRowCount":%s,' \
      "$marker_nonnull_rows" "$immutable_route_mismatches" "$parent_rows" "$parent_immutable_rows"
    printf '"missingRelationCount":%s,"inheritanceMismatchCount":%s,"sampleConsistent":%s}\n' \
      "$missing_relations" "$inheritance_mismatches" "$sample_consistent"
    ;;

  archive-health)
    archive_verify_work=$(mktemp -d /tmp/oscar-regression-archive-verify.XXXXXXXX)
    cleanup_archive_verify() { rm -rf -- "$archive_verify_work"; }
    trap cleanup_archive_verify EXIT
    archive_verify_log=$archive_verify_work/archive-verify.log
    verify_passed=false
    for verify_attempt in 1 2 3; do
      if sudo bash oscar.sh archive verify >"$archive_verify_log" 2>&1; then
        verify_passed=true
        break
      fi
      if ((verify_attempt < 3)) && grep -Fq 'Archive catalog changed during verification' "$archive_verify_log"; then
        sleep 5
        continue
      fi
      emit_command_diagnostics 'OSCAR archive verification' "$archive_verify_log"
      break
    done
    archive_dir=$(realpath -e -- "$(absolute_path "$(env_value OSCAR_ARCHIVE_DIR ../oscar-storage/archive)")")
    archive_partials=$(find "$archive_dir" -mindepth 1 \( -name '*.partial' -o -name '*.partial.*' -o -name '*.tmp' -o -name '*.tmp.*' \) -print | wc -l | tr -d '[:space:]')
    # OSCAR 3.9.2 does not have an active external WAL archive. This retained
    # field stays zero for report-schema compatibility.
    wal_partials=0
    json_query "WITH generations AS (
        SELECT count(*) FILTER(WHERE state='ACTIVE') active,
          count(*) FILTER(WHERE state='SEALED') sealed,
          coalesce(sum(row_count) FILTER(WHERE state IN ('ACTIVE','SEALED')),0) rows
        FROM oscar_archive_generation),
      objects AS (
        SELECT coalesce(sum(bytes) FILTER(WHERE state='ACTIVE'),0) bytes
        FROM oscar_archive_object),
      incomplete AS (
        SELECT count(*) count FROM oscar_archive_generation g
        WHERE g.state IN ('ACTIVE','SEALED') AND (
          NOT EXISTS (SELECT 1 FROM oscar_archive_object o WHERE o.generation_id=g.id) OR
          EXISTS (SELECT 1 FROM oscar_archive_object o WHERE o.generation_id=g.id AND o.state<>'ACTIVE')
        ))
      SELECT json_build_object(
        'activeGenerations',generations.active,'sealedGenerations',generations.sealed,
        'archiveRows',generations.rows,'archiveBytes',objects.bytes,
        'failedJobs',(SELECT count(*) FROM oscar_archive_job WHERE state='FAILED'),
        'parityFailures',(SELECT count(*) FROM oscar_archive_verification WHERE verification_type='PARITY' AND status<>'PASSED'),
        'activeHolds',(SELECT count(*) FROM oscar_retention_hold WHERE released_at IS NULL),
        'incompleteActiveObjects',incomplete.count,
        'archivePartialArtifacts',$archive_partials,
        'walPartialArtifacts',$wal_partials,
        'checksumVerificationPassed',$verify_passed)
      FROM generations,objects,incomplete;"
    cleanup_archive_verify
    trap - EXIT
    ;;

  journal-status)
    journal_metadata=$(compose exec -T oscar sh -eu -c '
      path=/var/lib/oscar/files/.dailyfile-journal/journal-metadata.v1.json
      [ -f "$path" ] && [ ! -L "$path" ] || exit 20
      size=$(stat -c %s -- "$path")
      [ "$size" -gt 0 ] && [ "$size" -le 65536 ] || exit 21
      openssl base64 -A -in "$path"
    ' journal-metadata) || fail 'Daily-file journal metadata is missing, linked, empty, or over 64 KiB.'
    [[ $journal_metadata =~ ^[A-Za-z0-9+/]+=*$ && ${#journal_metadata} -le 87384 ]] ||
      fail 'Daily-file journal metadata is not bounded canonical base64.'
    journal_metadata_result=$(scalar "WITH source AS (
        SELECT convert_from(decode('$journal_metadata','base64'),'UTF8') AS text),
      doc AS (SELECT text::json AS raw, text::jsonb AS value FROM source)
      SELECT (jsonb_typeof(value)='object'
        AND (SELECT count(*) FROM json_object_keys(raw))=3
        AND value ?& ARRAY['schemaVersion','zoneId','lifecycleIndexVersion']
        AND value->'schemaVersion'='1'::jsonb
        AND value->'lifecycleIndexVersion'='1'::jsonb
        AND jsonb_typeof(value->'zoneId')='string'
        AND length(value->>'zoneId') BETWEEN 1 AND 128)::text
        ||'|'||coalesce(value->>'zoneId','') FROM doc;")
    IFS='|' read -r journal_metadata_valid journal_zone <<<"$journal_metadata_result"
    [[ $journal_metadata_valid == true &&
       $journal_zone =~ ^[A-Za-z0-9._+/-]{1,128}$ ]] ||
      fail 'Daily-file journal metadata is not the exact schema-1 configured-zone lifecycle-index contract.'
    journal_today=$(scalar "SELECT to_char(current_timestamp AT TIME ZONE '$journal_zone','YYYY-MM-DD');")
    [[ $journal_today =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] ||
      fail 'Could not resolve the current daily-file date in the configured journal zone.'
    inventory=$(compose exec -T oscar sh -eu -c '
      today=$1
      root=/var/lib/oscar/files; pubs="$root/dailyfiles"; journal="$root/.dailyfile-journal"
      for path in "$root" "$pubs" "$journal"; do
        [ -d "$path" ] && [ ! -L "$path" ] || exit 20
      done
      segments_root="$journal/segments"
      [ -d "$segments_root" ] && [ ! -L "$segments_root" ] || exit 22
    total=$(find "$pubs" "$journal" -mindepth 1 -print | wc -l | tr -d "[:space:]")
    [ "$total" -le 100000 ] || exit 21
    partial=$(find "$pubs" "$journal" -type f \( -name "*.partial" -o -name "*.partial.*" -o -name "*.partial-*" -o -name "*.tmp" -o -name "*.tmp.*" -o -name "*.tmp-*" \) -print | wc -l | tr -d "[:space:]")
    manifests=$(find "$pubs" -mindepth 1 -maxdepth 1 -type f -name "*.manifest.v1.json" -print | wc -l | tr -d "[:space:]")
    publications=$(find "$pubs" -mindepth 1 -maxdepth 1 -type f -name "*.csv" -print | wc -l | tr -d "[:space:]")
    open=$(find "$journal" -type f -name "*.open" -print | wc -l | tr -d "[:space:]")
    segments=$(find "$journal" -type f -name "*.seg" -print | wc -l | tr -d "[:space:]")
    links=$(find "$pubs" "$journal" -type l -print | wc -l | tr -d "[:space:]")
    publication_nonfiles=$(find "$pubs" -mindepth 1 -maxdepth 1 ! -type f -print | wc -l | tr -d "[:space:]")
    publication_nested=$(find "$pubs" -mindepth 2 -print | wc -l | tr -d "[:space:]")
    publication_bad_names=$(find "$pubs" -mindepth 1 -maxdepth 1 -type f -printf "%f\n" |
      grep -Evc "^[A-Za-z0-9._-]+-[0-9a-f]{12}_[0-9]{4}-[0-9]{2}-[0-9]{2}[.]csv([.]manifest[.]v1[.]json)?$" || true)
    unsafe=$((publication_nonfiles+publication_nested+publication_bad_names))

    lane_non_dirs=$(find "$segments_root" -mindepth 1 -maxdepth 1 ! -type d -print | wc -l | tr -d "[:space:]")
    invalid_days=$(find "$segments_root" -mindepth 2 -maxdepth 2 -type d -printf "%f\n" |
      grep -Evc "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" || true)
    eligible_days=$(find "$segments_root" -mindepth 2 -maxdepth 2 -type d -printf "%f\n" |
      awk -v today="$today" "\$0 ~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/ && \$0 < today { count++ } END { print count+0 }")
    future_days=$(find "$segments_root" -mindepth 2 -maxdepth 2 -type d -printf "%f\n" |
      awk -v today="$today" "\$0 ~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/ && \$0 > today { count++ } END { print count+0 }")
    current_dirs=$(find "$segments_root" -mindepth 2 -maxdepth 2 -type d -name "$today" -print |
      wc -l | tr -d "[:space:]")
    current_open=$(find "$segments_root" -mindepth 3 -maxdepth 3 -path "*/$today/*" -type f \
      -name "[0-9][0-9][0-9][0-9][0-9][0-9].open" -print | wc -l | tr -d "[:space:]")
    current_sealed=$(find "$segments_root" -mindepth 3 -maxdepth 3 -path "*/$today/*" -type f \
      -name "[0-9][0-9][0-9][0-9][0-9][0-9].seg" -print | wc -l | tr -d "[:space:]")
    current_bytes=$(find "$segments_root" -mindepth 3 -maxdepth 3 -path "*/$today/*" -type f \
      \( -name "[0-9][0-9][0-9][0-9][0-9][0-9].open" -o \
         -name "[0-9][0-9][0-9][0-9][0-9][0-9].seg" \) -printf "%s\n" |
      awk "{ total += \$1 } END { printf \"%.0f\n\", total+0 }")
    current_entries=$(find "$segments_root" -mindepth 3 -maxdepth 3 -path "*/$today/*" -print |
      wc -l | tr -d "[:space:]")
    current_expected=$((current_open+current_sealed))
    current_unexpected=$((current_entries-current_expected))
    [ "$current_unexpected" -ge 0 ] || current_unexpected=1
    empty_current_dirs=0
    for directory in "$segments_root"/*/"$today"; do
      [ -e "$directory" ] || [ -L "$directory" ] || continue
      [ -d "$directory" ] && [ ! -L "$directory" ] || continue
      count=$(find "$directory" -mindepth 1 -maxdepth 1 -type f \
        \( -name "[0-9][0-9][0-9][0-9][0-9][0-9].open" -o \
           -name "[0-9][0-9][0-9][0-9][0-9][0-9].seg" \) -print | wc -l | tr -d "[:space:]")
      [ "$count" -gt 0 ] || empty_current_dirs=$((empty_current_dirs+1))
    done
    header_failures=0
    for path in "$segments_root"/*/"$today"/*; do
      [ -e "$path" ] || [ -L "$path" ] || continue
      name=${path##*/}
      case $name in
        [0-9][0-9][0-9][0-9][0-9][0-9].open|[0-9][0-9][0-9][0-9][0-9][0-9].seg) ;;
        *) continue ;;
      esac
      size=$(stat -c %s -- "$path" 2>/dev/null || printf 0)
      header=$(od -An -tx1 -N8 -- "$path" 2>/dev/null | tr -d "[:space:]")
      if [ ! -f "$path" ] || [ -L "$path" ] || [ "$size" -lt 16 ] ||
         [ "$header" != 444a4e4c00000001 ]; then
        header_failures=$((header_failures+1))
      fi
    done
    journal_integrity_failures=$((lane_non_dirs+invalid_days+future_days+current_unexpected+empty_current_dirs+header_failures))
    printf "%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n" \
      "$publications" "$manifests" "$partial" "$open" "$segments" "$links" "$unsafe" \
      "$eligible_days" "$current_dirs" "$current_open" "$current_sealed" "$current_bytes" \
      "$journal_integrity_failures" "$total"
  ' journal-inventory "$journal_today") ||
      fail 'Daily-file roots are missing, linked, malformed, or exceed the 100,000-entry safety bound.'
    IFS='|' read -r publications manifests partial open segments unsafe_links unsafe_entries \
      eligible_prior_days current_day_directories current_day_open current_day_sealed current_day_bytes \
      journal_integrity_failures inventory_entries <<<"$inventory"
    for value in "$publications" "$manifests" "$partial" "$open" "$segments" "$unsafe_links" \
      "$unsafe_entries" "$eligible_prior_days" "$current_day_directories" "$current_day_open" \
      "$current_day_sealed" "$current_day_bytes" "$journal_integrity_failures" "$inventory_entries"; do
      [[ $value =~ ^[0-9]+$ ]] || fail 'Daily-file inventory returned a nonnumeric field.'
    done
    manifest_listing=$(compose exec -T oscar find /var/lib/oscar/files/dailyfiles \
      -mindepth 1 -maxdepth 1 -type f -name '*.manifest.v1.json' -print | LC_ALL=C sort)
    validated=0; failures=0
    # Materialize the bounded listing before validation. docker compose exec
    # commands inside the loop may read stdin even with -T; a read-driven loop
    # would therefore lose every path after the first validation.
    mapfile -t manifest_paths <<<"$manifest_listing"
    for manifest in "${manifest_paths[@]}"; do
      [[ -n $manifest ]] || continue
      if [[ ! $manifest =~ ^/var/lib/oscar/files/dailyfiles/[A-Za-z0-9._-]+-[0-9a-f]{12}_[0-9]{4}-[0-9]{2}-[0-9]{2}\.csv\.manifest\.v1\.json$ ]]; then
        failures=$((failures+1)); continue
      fi
      csv=${manifest%.manifest.v1.json}
      csv_name=${csv##*/}
      csv_day=${csv_name%.csv}; csv_day=${csv_day##*_}
      [[ $csv_day =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || {
        failures=$((failures+1)); continue;
      }
      manifest_size=$(compose exec -T oscar stat -c %s -- "$manifest" 2>/dev/null || printf 0)
      [[ $manifest_size =~ ^[0-9]+$ && $manifest_size -gt 0 && $manifest_size -le 1048576 ]] || {
        failures=$((failures+1)); continue;
      }
      manifest_encoded=$(compose exec -T oscar openssl base64 -A -in "$manifest" | tr -d '\r\n')
      if [[ ! $manifest_encoded =~ ^[A-Za-z0-9+/]+=*$ || ${#manifest_encoded} -gt 1398104 ]]; then
        failures=$((failures+1)); continue
      fi
      csv_stats=$(compose exec -T oscar sh -eu -c '
        path=$1
        [ -f "$path" ] && [ ! -L "$path" ] || exit 20
        digest=$(sha256sum "$path"); digest=${digest%% *}
        bytes=$(wc -c <"$path" | tr -d "[:space:]")
        records=$(wc -l <"$path" | tr -d "[:space:]")
        printf "%s|%s|%s\n" "$digest" "$bytes" "$records"
      ' journal-csv "$csv" 2>/dev/null || true)
      IFS='|' read -r actual_sha actual_bytes actual_records <<<"$csv_stats"
      if [[ ! $actual_sha =~ ^[0-9a-f]{64}$ || ! $actual_bytes =~ ^[0-9]+$ || ! $actual_records =~ ^[0-9]+$ ]]; then
        failures=$((failures+1)); continue
      fi
      manifest_valid=$(scalar "WITH source AS (
          SELECT convert_from(decode('$manifest_encoded','base64'),'UTF8') AS text),
        doc AS (SELECT text::json AS raw, text::jsonb AS value FROM source)
        SELECT jsonb_typeof(value)='object'
          AND (SELECT count(*) FROM json_object_keys(raw))=12
          AND value ?& ARRAY['schemaVersion','format','laneId','zoneId','windowStartInclusive',
            'windowEndExclusive','recordCount','byteCount','checksumAlgorithm','sha256','dataFile','publishedAt']
          AND value->'schemaVersion'='1'::jsonb
          AND value->>'format'='OSCAR_LEGACY_DAILY_CSV'
          AND jsonb_typeof(value->'laneId')='string' AND length(value->>'laneId') BETWEEN 1 AND 256
          AND value->>'zoneId'='$journal_zone'
          AND value->>'windowStartInclusive' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?Z$'
          AND value->>'windowEndExclusive' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?Z$'
          AND (value->>'windowStartInclusive')::timestamptz < (value->>'windowEndExclusive')::timestamptz
          AND (value->>'windowStartInclusive')::timestamptz =
            ('$csv_day'::date::timestamp AT TIME ZONE '$journal_zone')
          AND (value->>'windowEndExclusive')::timestamptz =
            ((('$csv_day'::date + 1)::timestamp) AT TIME ZONE '$journal_zone')
          AND jsonb_typeof(value->'recordCount')='number' AND value->>'recordCount' ~ '^(0|[1-9][0-9]*)$'
          AND (value->>'recordCount')::bigint=$actual_records
          AND jsonb_typeof(value->'byteCount')='number' AND value->>'byteCount' ~ '^(0|[1-9][0-9]*)$'
          AND (value->>'byteCount')::bigint=$actual_bytes
          AND value->>'checksumAlgorithm'='SHA-256'
          AND value->>'sha256'='$actual_sha'
          AND value->>'dataFile'='$csv_name'
          AND value->>'dataFile' ~ '^[A-Za-z0-9._-]+-[0-9a-f]{12}_[0-9]{4}-[0-9]{2}-[0-9]{2}[.]csv$'
          AND value->>'publishedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?Z$'
          AND (value->>'publishedAt')::timestamptz IS NOT NULL
          AND (value->>'publishedAt')::timestamptz >=
            (value->>'windowEndExclusive')::timestamptz
        FROM doc;")
      if [[ $manifest_valid == t ]]; then validated=$((validated+1)); else failures=$((failures+1)); fi
    done
    printf '{"publications":%s,"manifests":%s,"validatedManifests":%s,"manifestFailures":%s,"partialFiles":%s,"unsafeLinks":%s,"unsafeEntries":%s,"bounded":true,"inventoryEntries":%s,"zoneId":"%s","currentDate":"%s","eligiblePriorDayDirectories":%s,"currentDayDirectories":%s,"currentDayOpenSegments":%s,"currentDaySealedSegments":%s,"currentDayBytes":%s,"journalIntegrityFailures":%s,"openSegments":%s,"sealedSegments":%s}\n' \
      "$publications" "$manifests" "$validated" "$failures" "$partial" "$unsafe_links" "$unsafe_entries" \
      "$inventory_entries" "$journal_zone" "$journal_today" "$eligible_prior_days" \
      "$current_day_directories" "$current_day_open" "$current_day_sealed" "$current_day_bytes" \
      "$journal_integrity_failures" "$open" "$segments"
    ;;

  journal-lane-state)
    lane_uid=${1:-}
    [[ $lane_uid =~ ^urn:osh:system:lane:[A-Za-z0-9._-]{1,200}$ ]] ||
      fail 'Direct-journal lane UID is outside the canonical regression fixture namespace.'
    safe_lane=$(printf '%s' "$lane_uid" | sed 's/[^A-Za-z0-9._-]/_/g')
    if ((${#safe_lane} > 120)); then safe_lane=${safe_lane:0:120}; fi
    lane_hash=$(printf '%s' "$lane_uid" | sha256sum | cut -c1-12)
    directory_id="$safe_lane-$lane_hash"
    [[ $directory_id =~ ^[A-Za-z0-9._-]+$ ]] || fail 'Could not derive the direct-journal lane directory.'
    compose exec -T oscar sh -eu -s -- "$directory_id" "$lane_uid" <<'EOF'
      directory_id=$1; lane_uid=$2
      root=/var/lib/oscar/files/.dailyfile-journal/segments
      [ -d "$root" ] && [ ! -L "$root" ] || exit 20
      lane="$root/$directory_id"
      if [ ! -e "$lane" ] && [ ! -L "$lane" ]; then
        printf '{"directoryId":"%s","present":false,"files":0,"bytes":0,"openSegments":0,"sealedSegments":0,"partialFiles":0,"unsafeEntries":0,"segments":[]}\n' "$directory_id"
        exit 0
      fi
      [ -d "$lane" ] && [ ! -L "$lane" ] || exit 21
      entries=$(find "$lane" -mindepth 1 -print | wc -l | tr -d "[:space:]")
      [ "$entries" -le 10000 ] || exit 22
      identity_bad=0
      if [ ! -f "$lane/lane.id" ] || [ -L "$lane/lane.id" ] ||
         [ "$(wc -c <"$lane/lane.id" | tr -d "[:space:]")" -gt 4096 ] ||
         [ "$(cat -- "$lane/lane.id")" != "$lane_uid" ]; then identity_bad=1; fi
      invalid_days=$(find "$lane" -mindepth 1 -maxdepth 1 -type d -printf "%f\n" |
        grep -Evc "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" || true)
      unexpected_root=$(find "$lane" -mindepth 1 -maxdepth 1 ! -type d ! -name lane.id -print | wc -l | tr -d "[:space:]")
      unexpected_deep=$(find "$lane" -mindepth 3 -print | wc -l | tr -d "[:space:]")
      invalid_segments=$(find "$lane" -mindepth 2 -maxdepth 2 -type f -printf "%f\n" |
        grep -Evc "^[0-9]{6}[.](open|seg)$" || true)
      nonfiles=$(find "$lane" -mindepth 2 -maxdepth 2 ! -type f -print | wc -l | tr -d "[:space:]")
      partial=$(find "$lane" -type f \( -name "*.partial" -o -name "*.partial.*" -o -name "*.partial-*" -o -name "*.tmp" -o -name "*.tmp.*" -o -name "*.tmp-*" \) -print | wc -l | tr -d "[:space:]")
      links=$(find "$lane" -type l -print | wc -l | tr -d "[:space:]")
      unsafe=$((identity_bad+invalid_days+unexpected_root+unexpected_deep+invalid_segments+nonfiles+links))

      tmp_dir=$(mktemp -d /tmp/journal-lane-state.XXXXXXXX)
      trap 'rm -rf -- "$tmp_dir"' EXIT
      captured=false
      for attempt in 1 2 3 4 5; do
        : >"$tmp_dir/seg.meta"
        : >"$tmp_dir/seg.sha"
        : >"$tmp_dir/rows.tsv"
        if ! find "$lane" -mindepth 2 -maxdepth 2 -type f -name "*.seg" -printf "%P\t%s\n" 2>/dev/null | LC_ALL=C sort >"$tmp_dir/seg.meta"; then
          continue
        fi
        if [ -s "$tmp_dir/seg.meta" ]; then
          cut -f1 "$tmp_dir/seg.meta" | tr "\n" "\0" | (cd "$lane" && xargs -0 -r sha256sum --) >"$tmp_dir/seg.sha" 2>/dev/null || continue
          if [ "$(wc -l <"$tmp_dir/seg.meta")" -ne "$(wc -l <"$tmp_dir/seg.sha")" ]; then
            continue
          fi
          if ! awk -F "\t" '
            NR==FNR {
              line=$0;
              sha=line; sub(/[ *].*$/, "", sha);
              path=line; sub(/^[0-9a-f]+[ *]+/, "", path);
              hashes[path]=sha; next
            }
            {
              rel=$1; sz=$2;
              if (!(rel in hashes)) exit 1;
              printf "%s\tseg\t%s\t%s\n", rel, sz, hashes[rel];
            }
          ' "$tmp_dir/seg.sha" "$tmp_dir/seg.meta" >"$tmp_dir/rows.tsv"; then
            continue
          fi
        fi
        open_ok=true
        for open_file in $(find "$lane" -mindepth 2 -maxdepth 2 -type f -name "*.open" -print 2>/dev/null | LC_ALL=C sort); do
          [ -f "$open_file" ] && [ ! -L "$open_file" ] || { open_ok=false; break; }
          rel=${open_file#"$lane/"}
          sz=$(stat -c %s -- "$open_file" 2>/dev/null) || { open_ok=false; break; }
          sha=$(head -c "$sz" -- "$open_file" 2>/dev/null | sha256sum | awk '{print $1}') || { open_ok=false; break; }
          after_sz=$(stat -c %s -- "$open_file" 2>/dev/null) || { open_ok=false; break; }
          [ -f "$open_file" ] && [ ! -L "$open_file" ] && [ "$after_sz" -ge "$sz" ] || { open_ok=false; break; }
          printf "%s\topen\t%s\t%s\n" "$rel" "$sz" "$sha" >>"$tmp_dir/rows.tsv"
        done
        [ "$open_ok" = true ] || continue
        LC_ALL=C sort -o "$tmp_dir/rows.tsv" "$tmp_dir/rows.tsv"
        if awk -F "\t" '
          {
            stem=$1; sub(/[.](open|seg)$/, "", stem);
            if (seen[stem]++) exit 1;
          }
        ' "$tmp_dir/rows.tsv"; then
          captured=true
          break
        fi
      done
      [ "$captured" = true ] || exit 25
      files=$(wc -l <"$tmp_dir/rows.tsv" | tr -d "[:space:]")
      [ "$files" -le 10000 ] || exit 23
      awk -F "\t" -v dir="$directory_id" -v partial="$partial" -v unsafe="$unsafe" '
        BEGIN { files=0; bytes=0; open_c=0; seg_c=0 }
        {
          rel=$1; kind=$2; sz=$3+0; sha=$4;
          if (rel !~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}\/[0-9]{6}[.](open|seg)$/) exit 24;
          if (sha !~ /^[0-9a-f]{64}$/) exit 24;
          files++;
          bytes += sz;
          if (kind == "open") open_c++; else seg_c++;
          items[files] = sprintf("{\"path\":\"%s\",\"kind\":\"%s\",\"bytes\":%.0f,\"sha256\":\"%s\"}", rel, kind, sz, sha);
        }
        END {
          printf "{\"directoryId\":\"%s\",\"present\":true,\"files\":%d,\"bytes\":%.0f,\"openSegments\":%d,\"sealedSegments\":%d,\"partialFiles\":%d,\"unsafeEntries\":%d,\"segments\":[",
            dir, files, bytes, open_c, seg_c, partial+0, unsafe+0;
          for (i = 1; i <= files; i++) {
            if (i > 1) printf ",";
            printf "%s", items[i];
          }
          printf "]}\n";
        }
      ' "$tmp_dir/rows.tsv"
EOF
    ;;

  journal-restart)
    lane_uid=${1:-}
    [[ $lane_uid =~ ^urn:osh:system:lane:[A-Za-z0-9._-]{1,200}$ ]] ||
      fail 'Journal restart requires the canonical reserved-lane UID.'
    safe_lane=$(printf '%s' "$lane_uid" | sed 's/[^A-Za-z0-9._-]/_/g')
    if ((${#safe_lane} > 120)); then safe_lane=${safe_lane:0:120}; fi
    lane_hash=$(printf '%s' "$lane_uid" | sha256sum | cut -c1-12)
    directory_id="$safe_lane-$lane_hash"
    restart_work=$(mktemp -d /tmp/oscar-regression-journal-restart.XXXXXXXX)
    before_inventory=$restart_work/before.tsv
    cleanup_journal_restart() { rm -rf -- "$restart_work"; }
    trap cleanup_journal_restart EXIT
    compose exec -T oscar sh -eu -s -- "$directory_id" <<'EOF' >"$before_inventory" ||
      lane="/var/lib/oscar/files/.dailyfile-journal/segments/$1"
      [ -d "$lane" ] && [ ! -L "$lane" ]
      tmp_dir=$(mktemp -d /tmp/journal-restart-before.XXXXXXXX)
      trap 'rm -rf -- "$tmp_dir"' EXIT
      captured=false
      for attempt in 1 2 3 4 5; do
        : >"$tmp_dir/seg.meta"
        : >"$tmp_dir/seg.sha"
        : >"$tmp_dir/rows.tsv"
        if ! find "$lane" -mindepth 2 -maxdepth 2 -type f -name "*.seg" -printf "%P\t%s\n" 2>/dev/null | LC_ALL=C sort >"$tmp_dir/seg.meta"; then
          continue
        fi
        if [ -s "$tmp_dir/seg.meta" ]; then
          cut -f1 "$tmp_dir/seg.meta" | tr "\n" "\0" | (cd "$lane" && xargs -0 -r sha256sum --) >"$tmp_dir/seg.sha" 2>/dev/null || continue
          if [ "$(wc -l <"$tmp_dir/seg.meta")" -ne "$(wc -l <"$tmp_dir/seg.sha")" ]; then
            continue
          fi
          if ! awk -F "\t" '
            NR==FNR {
              line=$0;
              sha=line; sub(/[ *].*$/, "", sha);
              path=line; sub(/^[0-9a-f]+[ *]+/, "", path);
              hashes[path]=sha; next
            }
            {
              rel=$1; sz=$2+0;
              if (sz <= 0 || !(rel in hashes)) exit 1;
              printf "%s|%.0f|%s\n", rel, sz, hashes[rel];
            }
          ' "$tmp_dir/seg.sha" "$tmp_dir/seg.meta" >"$tmp_dir/rows.tsv"; then
            continue
          fi
        fi
        open_ok=true
        for open_file in $(find "$lane" -mindepth 2 -maxdepth 2 -type f -name "*.open" -print 2>/dev/null | LC_ALL=C sort); do
          [ -f "$open_file" ] && [ ! -L "$open_file" ] || { open_ok=false; break; }
          rel=${open_file#"$lane/"}
          sz=$(stat -c %s -- "$open_file" 2>/dev/null) || { open_ok=false; break; }
          [ "$sz" -gt 0 ] || { open_ok=false; sleep 1; break; }
          sha=$(head -c "$sz" -- "$open_file" 2>/dev/null | sha256sum | awk '{print $1}') || { open_ok=false; break; }
          after_sz=$(stat -c %s -- "$open_file" 2>/dev/null) || { open_ok=false; break; }
          [ -f "$open_file" ] && [ ! -L "$open_file" ] && [ "$after_sz" -ge "$sz" ] || { open_ok=false; break; }
          printf "%s|%s|%s\n" "$rel" "$sz" "$sha" >>"$tmp_dir/rows.tsv"
        done
        [ "$open_ok" = true ] || continue
        LC_ALL=C sort -o "$tmp_dir/rows.tsv" "$tmp_dir/rows.tsv"
        if awk -F "|" '
          {
            if ($1 !~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}\/[0-9]{6}[.](open|seg)$/) exit 1;
            stem=$1; sub(/[.](open|seg)$/, "", stem);
            if (seen[stem]++) exit 1;
          }
        ' "$tmp_dir/rows.tsv"; then
          captured=true
          break
        fi
      done
      [ "$captured" = true ]
      count=$(wc -l <"$tmp_dir/rows.tsv" | tr -d "[:space:]")
      [ "$count" -gt 0 ] && [ "$count" -le 10000 ]
      cat "$tmp_dir/rows.tsv"
EOF
      fail 'Could not capture the bounded pre-restart segment inventory.'
    segments_before=$(wc -l <"$before_inventory" | tr -d '[:space:]')
    [[ $segments_before =~ ^[1-9][0-9]*$ && $segments_before -le 10000 ]] ||
      fail 'Pre-restart segment inventory is empty or exceeds its bound.'
    scratch_before=$restart_work/scratch-before.txt
    if ! archive_scratch_inventory >"$scratch_before"; then
      fail 'Could not capture the validated pre-restart DuckDB scratch inventory.'
    fi
    scratch_before_count=$(wc -l <"$scratch_before" | tr -d '[:space:]')
    [[ $scratch_before_count =~ ^[0-9]+$ && $scratch_before_count -le 512 ]] ||
      fail 'Pre-restart DuckDB scratch inventory exceeds its bound.'
    restart_started=$(date --iso-8601=seconds)
    restart_log=$restart_work/supported-restart.log
    if ! sudo bash oscar.sh restart >"$restart_log" 2>&1; then
      emit_command_diagnostics 'Supported OSCAR restart' "$restart_log"
      fail 'The supported whole-deployment restart failed.'
    fi
    deadline=$((SECONDS+180)); healthy=false
    while ((SECONDS < deadline)); do
      state=$(compose ps --format json oscar 2>/dev/null | grep -o '"Health":"[^"]*"' | head -n1 || true)
      [[ $state == *healthy* ]] && { healthy=true; break; }
      sleep 2
    done
    scratch_after=$restart_work/scratch-after.txt
    if ! archive_scratch_inventory >"$scratch_after"; then
      fail 'Could not capture the validated post-restart DuckDB scratch inventory.'
    fi
    scratch_after_count=$(wc -l <"$scratch_after" | tr -d '[:space:]')
    [[ $scratch_after_count =~ ^[0-9]+$ && $scratch_after_count -le 512 ]] ||
      fail 'Post-restart DuckDB scratch inventory exceeds its bound.'
    stale_scratch=$restart_work/scratch-stale.txt
    comm -12 "$scratch_before" "$scratch_after" >"$stale_scratch"
    stale_scratch_count=$(wc -l <"$stale_scratch" | tr -d '[:space:]')
    [[ $stale_scratch_count =~ ^[0-9]+$ && $stale_scratch_count -le 512 ]] ||
      fail 'Restart-surviving DuckDB scratch inventory exceeds its bound.'
    segments_preserved=0; segment_failures=0; segments_verified=0
    mapfile -t before_rows <"$before_inventory"
    for before_row in "${before_rows[@]}"; do
      IFS='|' read -r relative before_bytes before_sha extra <<<"$before_row"
      [[ -z ${extra:-} && $relative =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9]{6}\.(open|seg)$ &&
         $before_bytes =~ ^[1-9][0-9]*$ && $before_sha =~ ^[0-9a-f]{64}$ ]] ||
        fail 'Pre-restart segment inventory is malformed.'
      segments_verified=$((segments_verified+1))
    done
    [[ $segments_verified == "$segments_before" ]] ||
      fail 'Restart verification did not inspect every captured journal segment.'
    lane_root="/var/lib/oscar/files/.dailyfile-journal/segments/$directory_id"
    verify_counts=$(compose exec -T oscar sh -eu -c '
      root=$1
      preserved=0; failures=0; checked=0
      while IFS="|" read -r relative expected_bytes expected_sha; do
        [ -n "$relative" ] || continue
        checked=$((checked+1))
        ok=false
        case $relative in
          *.seg)
            candidate="$root/$relative"
            if [ -f "$candidate" ] && [ ! -L "$candidate" ] &&
               [ "$(stat -c %s -- "$candidate")" = "$expected_bytes" ] &&
               [ "$(sha256sum -- "$candidate" | awk "{print \$1}")" = "$expected_sha" ]; then
              ok=true
            fi
            ;;
          *.open)
            sealed="${relative%.open}.seg"
            matches=0; candidate=
            for rel in "$relative" "$sealed"; do
              path="$root/$rel"
              if [ -e "$path" ] || [ -L "$path" ]; then
                if [ -f "$path" ] && [ ! -L "$path" ]; then
                  matches=$((matches+1)); candidate=$path
                else
                  matches=99
                fi
              fi
            done
            if [ "$matches" -eq 1 ]; then
              size=$(stat -c %s -- "$candidate" 2>/dev/null || printf 0)
              if [ "$size" -ge "$expected_bytes" ]; then
                prefix_sha=$(head -c "$expected_bytes" -- "$candidate" | sha256sum | awk "{print \$1}")
                [ "$prefix_sha" = "$expected_sha" ] && ok=true
              fi
            fi
            ;;
        esac
        if [ "$ok" = true ]; then preserved=$((preserved+1)); else failures=$((failures+1)); fi
      done
      printf "%s|%s|%s\n" "$checked" "$preserved" "$failures"
    ' journal-restart-verify "$lane_root" <"$before_inventory") ||
      fail 'Post-restart segment verification inside container failed.'
    IFS='|' read -r container_checked segments_preserved segment_failures <<<"$verify_counts"
    [[ $container_checked == "$segments_before" ]] ||
      fail 'Container restart verification did not inspect every captured journal segment.'
    # Hidden camera partials created after the restart are legitimate active recordings on a
    # live multi-lane site.  Count only pre-restart partials that survived the supported restart,
    # plus every temporary publication artifact (which is never a live camera output).
    partial=$(compose exec -T oscar sh -eu -c '
      root=/var/lib/oscar/files; cutoff=$1
      {
        find "$root" -type f \( -name "*.partial" -o -name "*.partial.*" -o -name "*.partial-*" \) \
          ! -newermt "$cutoff" -print
        find "$root" -type f \( -name "*.tmp" -o -name "*.tmp.*" -o -name "*.tmp-*" \) -print
      } 2>/dev/null | wc -l
    ' journal-restart-partials "$restart_started")
    restart_service_log=$restart_work/restart-services.log
    if ! compose logs --since "$restart_started" oscar postgres >"$restart_service_log" 2>&1; then
      emit_command_diagnostics 'Supported restart service-log collection' "$restart_service_log"
      fail 'Could not collect the exact supported-restart service log window.'
    fi
    recovery_errors=$(grep -Eic 'daily.?file.*(corrupt|recovery failed|checksum mismatch)' "$restart_service_log" || true)
    shutdown_errors=$(grep -Eic '(BasicEventHandler|DataStreamTransactionHandler|DatabasePurger|ModuleRegistry).*(error|failed|timed out|timeout|administrator command)|(error|failed|timed out|timeout|administrator command).*(BasicEventHandler|DataStreamTransactionHandler|DatabasePurger|ModuleRegistry)' "$restart_service_log" || true)
    camera_recording_errors=$(grep -Eic 'Timed out waiting for camera .* command; quarantining its queue|Camera .* command queue is quarantined|Timed out waiting for video files for occupancy generation|returned a stale or mismatched saved-video result for occupancy generation|Camera .* failed to close occupancy generation|Failed to finish matched camera recording generation' "$restart_service_log" || true)
    scratch_before_json=$(scratch_inventory_json "$scratch_before")
    scratch_after_json=$(scratch_inventory_json "$scratch_after")
    stale_scratch_json=$(scratch_inventory_json "$stale_scratch")
    printf '{"healthy":%s,"segmentsChecked":%s,"segmentsPreserved":%s,"segmentFailures":%s,"partialFiles":%s,"recoveryErrors":%s,"shutdownErrors":%s,"cameraRecordingErrors":%s,"scratchBeforeRestartCount":%s,"scratchAfterRestartCount":%s,"staleScratchAfterRestartCount":%s,"scratchBeforeRestart":%s,"scratchAfterRestart":%s,"staleScratchAfterRestart":%s}\n' \
      "$healthy" "$segments_before" "$segments_preserved" "$segment_failures" "${partial:-0}" "$recovery_errors" "$shutdown_errors" "$camera_recording_errors" \
      "$scratch_before_count" "$scratch_after_count" "$stale_scratch_count" \
      "$scratch_before_json" "$scratch_after_json" "$stale_scratch_json"
    cleanup_journal_restart
    trap - EXIT
    ;;

  stage-lifecycle-select)
    config_fields=$(platform_config_fields /var/lib/oscar/config.json) ||
      fail 'The live OSCAR config failed structural JSON extraction for stage selection.'
    IFS='|' read -r -a stage_config <<<"$config_fields"
    [[ ${#stage_config[@]} -eq 51 && ${stage_config[41]} == PARQUET_PRIMARY ]] ||
      fail 'Stage lifecycle selection requires PARQUET_PRIMARY.'
    stage_window=${stage_config[43]}; archive_delay=${stage_config[42]}
    [[ $stage_window == 30 && $archive_delay =~ ^[1-9][0-9]*$ ]] ||
      fail 'Stage lifecycle timing is invalid.'
    selected=false
    while IFS='|' read -r store_key id_scope parent_table child_table window_start window_end extra; do
      [[ -n $store_key ]] || continue
      if ! valid_store_key "$store_key" || ! valid_id_scope "$id_scope" ||
         ! valid_store_key "$parent_table" || ! valid_store_key "$child_table" ||
         [[ -n ${extra:-} ]]; then
        fail 'Stage lifecycle candidate has an unsafe identity.'
      fi
      candidate=$(psql_admin --quiet --tuples-only --no-align --command "
        WITH cold AS (
          SELECT id,datastreamid,phenomenontime,received_at
          FROM $child_table ORDER BY phenomenontime,id LIMIT 1
        )
        SELECT json_build_object(
          'available',true,'storeKey','$store_key','idScope',$id_scope,
          'parentTable','$parent_table','childTable','$child_table',
          'windowStart','$window_start','windowEnd','$window_end',
          'rowCount',(SELECT count(*) FROM $child_table),
          'ownerCount',(SELECT count(*) FROM oscar_obs_stage_owner
            WHERE store_key='$store_key' AND id_scope=$id_scope AND child_table='$child_table'),
          'markerNonNullRowCount',(SELECT count(*) FROM $child_table
            WHERE archivegenerationid IS NOT NULL),
          'coldId',(SELECT id::text FROM cold),
          'datastreamId',(SELECT datastreamid FROM cold),
          'coldTime',(SELECT to_char(phenomenontime AT TIME ZONE 'UTC',
            'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') FROM cold),
          'oldestReceivedAt',(SELECT to_char(min(received_at) AT TIME ZONE 'UTC',
            'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') FROM $child_table))
        WHERE EXISTS (SELECT 1 FROM cold)
          AND EXISTS (SELECT 1 FROM pg_class child
            JOIN pg_namespace child_namespace ON child_namespace.oid=child.relnamespace
            WHERE child_namespace.nspname=current_schema() AND child.relname='$child_table'
              AND child.relkind='r' AND child.relpersistence='p');" 2>/dev/null | tail -n 1 || true)
      if [[ $candidate == \{* ]]; then printf '%s\n' "$candidate"; selected=true; break; fi
    done < <(psql_admin --quiet --tuples-only --no-align --field-separator='|' --command "
      SELECT store_key,id_scope,parent_table,child_table,
        to_char(window_start AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'),
        to_char(window_end AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')
      FROM oscar_obs_stage_partition
      WHERE state='ATTACHED' AND window_end<=clock_timestamp()
        AND window_end>clock_timestamp()-make_interval(mins=>$archive_delay)
        AND window_end=window_start+make_interval(mins=>$stage_window)
        AND extract(epoch FROM window_start)::bigint % ($stage_window*60)=0
      ORDER BY window_end DESC,child_table LIMIT 16;")
    $selected || printf '{"available":false}\n'
    ;;

  stage-lifecycle-witness)
    child_table=${1:-}; store_key=${2:-}; id_scope=${3:-}; expected_rows=${4:-}
    cold_id=${5:-}; wait_seconds=${6:-}
    valid_store_key "$child_table" && valid_store_key "$store_key" && valid_id_scope "$id_scope" ||
      fail 'Stage lifecycle witness has an unsafe stage identity.'
    [[ $expected_rows =~ ^[1-9][0-9]{0,18}$ && $cold_id =~ ^[1-9][0-9]{0,18}$ &&
       $wait_seconds =~ ^[1-9][0-9]{0,4}$ && $wait_seconds -le 7200 ]] ||
      fail 'Stage lifecycle witness bounds are invalid.'
    witness_output=$(psql_admin --quiet --tuples-only --no-align --command "
      BEGIN;
      SET LOCAL client_min_messages=notice;
      SET LOCAL lock_timeout='2s';
      SET LOCAL work_mem='64MB';
      DO \$stage_witness\$
      DECLARE
        deadline timestamptz := clock_timestamp()+make_interval(secs=>$wait_seconds);
        relation_present boolean := false;
        full_ownership boolean := false;
        stage_rows bigint := 0;
        unowned_stage_rows bigint := 0;
        missing_physical_owners bigint := 0;
        owner_rows bigint := 0;
        owner_generations bigint := 0;
        invalid_owner_generations bigint := 0;
        owner_generation_rows bigint := 0;
        generation_ids jsonb := '[]'::jsonb;
        selected_generation_id text := NULL;
        selected_generation_state text := NULL;
        selected_generation_parity boolean := false;
      BEGIN
        BEGIN
          EXECUTE 'LOCK TABLE $child_table IN ACCESS SHARE MODE';
          relation_present := true;
        EXCEPTION WHEN undefined_table OR lock_not_available THEN
          RAISE NOTICE 'OSCAR_STAGE_WITNESS:%', json_build_object(
            'relationPresent',false,'fullOwnershipObserved',false,
            'rowCount',0,'ownerCount',0,'ownerGenerationCount',0,
            'invalidOwnerGenerationCount',0,'ownerGenerationRowCount',0,
            'generationIds','[]'::json,'selectedGenerationId',NULL,
            'selectedGenerationState',NULL,'selectedGenerationParityVerified',false);
          RETURN;
        END;
        LOOP
          SELECT generation.id::text,generation.state,generation.parity_verified
          INTO selected_generation_id,selected_generation_state,selected_generation_parity
          FROM oscar_obs_stage_owner owner
          JOIN oscar_archive_generation generation ON generation.id=owner.generation_id
          WHERE owner.store_key='$store_key' AND owner.id_scope=$id_scope
            AND owner.child_table='$child_table' AND owner.observation_id=$cold_id;
          IF (selected_generation_id IS NOT NULL
              AND selected_generation_state IN ('ACTIVE','SEALED')
              AND selected_generation_parity)
             OR clock_timestamp()>=deadline THEN
            SELECT count(*),count(DISTINCT owner.generation_id),
              count(*) FILTER (WHERE generation.id IS NULL
                OR generation.store_key<>'$store_key' OR generation.id_scope<>$id_scope
                OR generation.state NOT IN ('ACTIVE','SEALED')
                OR NOT generation.parity_verified)
            INTO owner_rows,owner_generations,invalid_owner_generations
            FROM oscar_obs_stage_owner owner
            LEFT JOIN oscar_archive_generation generation ON generation.id=owner.generation_id
            WHERE owner.store_key='$store_key' AND owner.id_scope=$id_scope
              AND owner.child_table='$child_table';
            SELECT coalesce(sum(exact.row_count),0),
              coalesce(jsonb_agg(exact.id ORDER BY exact.id),'[]'::jsonb)
            INTO owner_generation_rows,generation_ids
            FROM (SELECT generation.id::text id,max(generation.row_count) row_count
              FROM oscar_obs_stage_owner owner
              JOIN oscar_archive_generation generation ON generation.id=owner.generation_id
              WHERE owner.store_key='$store_key' AND owner.id_scope=$id_scope
                AND owner.child_table='$child_table'
              GROUP BY generation.id) exact;
          END IF;
          IF (owner_rows=$expected_rows AND owner_generations>0 AND invalid_owner_generations=0
              AND owner_generation_rows=owner_rows AND selected_generation_id IS NOT NULL
              AND selected_generation_state IN ('ACTIVE','SEALED')
              AND selected_generation_parity)
             OR clock_timestamp()>=deadline THEN
            EXECUTE 'SELECT count(stage.id),
              count(stage.id) FILTER (WHERE owner.observation_id IS NULL),
              count(owner.observation_id) FILTER (WHERE stage.id IS NULL)
              FROM (SELECT id FROM $child_table) stage
              FULL JOIN (
                SELECT observation_id FROM oscar_obs_stage_owner
                WHERE store_key=''$store_key'' AND id_scope=$id_scope AND child_table=''$child_table''
              ) owner ON owner.observation_id=stage.id'
              INTO stage_rows, unowned_stage_rows, missing_physical_owners;
          END IF;
          full_ownership := stage_rows=$expected_rows AND owner_rows=stage_rows
            AND unowned_stage_rows=0 AND missing_physical_owners=0
            AND owner_generations>0 AND invalid_owner_generations=0
            AND owner_generation_rows=owner_rows AND selected_generation_id IS NOT NULL
            AND selected_generation_state IN ('ACTIVE','SEALED')
            AND selected_generation_parity;
          EXIT WHEN full_ownership OR clock_timestamp()>=deadline;
          PERFORM pg_sleep(0.1);
        END LOOP;
        RAISE NOTICE 'OSCAR_STAGE_WITNESS:%', json_build_object(
          'relationPresent',relation_present,'fullOwnershipObserved',full_ownership,
          'rowCount',stage_rows,'ownerCount',owner_rows,
          'ownerGenerationCount',owner_generations,
          'invalidOwnerGenerationCount',invalid_owner_generations,
          'ownerGenerationRowCount',owner_generation_rows,
          'generationIds',generation_ids,'selectedGenerationId',selected_generation_id,
          'selectedGenerationState',selected_generation_state,
          'selectedGenerationParityVerified',selected_generation_parity);
      END
      \$stage_witness\$;
      COMMIT;" 2>&1) || fail 'Could not hold the bounded read-only stage ownership witness.'
    witness=$(sed -n 's/^NOTICE:[[:space:]]*OSCAR_STAGE_WITNESS://p' <<<"$witness_output" | tail -n 1)
    [[ $witness == \{* ]] || fail 'Stage lifecycle witness returned no bounded evidence.'
    printf '%s\n' "$witness"
    ;;

  stage-lifecycle-status)
    child_table=${1:-}; store_key=${2:-}; id_scope=${3:-}; cold_id=${4:-}; datastream_id=${5:-}
    window_start=${6:-}; window_end=${7:-}; selected_generation_id=${8:-}
    valid_store_key "$child_table" && valid_store_key "$store_key" && valid_id_scope "$id_scope" ||
      fail 'Stage lifecycle status has an unsafe stage identity.'
    [[ $cold_id =~ ^[1-9][0-9]{0,18}$ && $datastream_id =~ ^[1-9][0-9]{0,18}$ ]] ||
      fail 'Stage lifecycle status has an unsafe observation identity.'
    valid_utc_timestamp "$window_start" && valid_utc_timestamp "$window_end" ||
      fail 'Stage lifecycle status has an unsafe stage window.'
    valid_uuid "$selected_generation_id" ||
      fail 'Stage lifecycle status has an unsafe selected generation identity.'
    registry_state=$(scalar "SELECT coalesce((SELECT state FROM oscar_obs_stage_partition
      WHERE store_key='$store_key' AND id_scope=$id_scope AND child_table='$child_table'),'');")
    [[ -z $registry_state || $registry_state == ATTACHED || $registry_state == DETACHED ]] ||
      fail 'Stage lifecycle status found an invalid registry state.'
    relation_present=$(scalar "SELECT to_regclass(current_schema()||'.$child_table') IS NOT NULL;")
    row_count=0; owner_count=0; marker_count=0; inherits=false; sample_consistent=true
    if [[ $relation_present == t ]]; then
      relation_metrics=$(psql_admin --quiet --tuples-only --no-align --field-separator='|' --command "
        SELECT count(*),count(*) FILTER(WHERE archivegenerationid IS NOT NULL),
          (SELECT count(*) FROM oscar_obs_stage_owner WHERE store_key='$store_key'
            AND id_scope=$id_scope AND child_table='$child_table') FROM $child_table;" 2>/dev/null |
        tail -n 1 || true)
      IFS='|' read -r row_count marker_count owner_count relation_extra <<<"$relation_metrics"
      if [[ -n ${relation_extra:-} || ! $row_count =~ ^[0-9]+$ || ! $marker_count =~ ^[0-9]+$ ||
            ! $owner_count =~ ^[0-9]+$ ]]; then
        row_count=0; marker_count=0; owner_count=0; sample_consistent=false
      fi
      inherits=$(scalar "SELECT EXISTS(SELECT 1 FROM pg_inherits inheritance
        JOIN pg_class child ON child.oid=inheritance.inhrelid
        JOIN pg_class parent ON parent.oid=inheritance.inhparent
        JOIN pg_namespace child_namespace ON child_namespace.oid=child.relnamespace
        JOIN pg_namespace parent_namespace ON parent_namespace.oid=parent.relnamespace
        WHERE child_namespace.nspname=current_schema() AND parent_namespace.nspname=current_schema()
          AND child.relname='$child_table' AND parent.relname='obs');")
    fi
    cold_hot_present=$(scalar "SELECT EXISTS(SELECT 1 FROM obs WHERE id=$cold_id);")
    selected_generation=$(json_query "WITH candidate AS (
        SELECT generation.id,generation.state,generation.parity_verified,generation.row_count
        FROM oscar_archive_generation generation
        WHERE generation.id='$selected_generation_id'::uuid
          AND generation.store_key='$store_key' AND generation.id_scope=$id_scope
          AND generation.state IN ('ACTIVE','SEALED')
          AND EXISTS (SELECT 1 FROM oscar_archive_id_block block
            WHERE block.generation_id=generation.id
              AND $cold_id BETWEEN block.min_id AND block.max_id)
          AND EXISTS (SELECT 1 FROM oscar_archive_schema schema
            WHERE schema.generation_id=generation.id AND schema.datastream_id=$datastream_id))
      SELECT json_build_object('generationId',(SELECT id FROM candidate),
        'generationState',(SELECT state FROM candidate),
        'parityVerified',coalesce((SELECT parity_verified FROM candidate),false),
        'generationRowCount',(SELECT row_count FROM candidate));")
    [[ $selected_generation == \{* ]] || fail 'Could not inspect the selected stage generation.'
    window_generations=$(json_query "SELECT json_build_object(
        'generationCount',count(*),
        'generationIds',coalesce(json_agg(id::text ORDER BY id::text),'[]'::json),
        'invalidGenerationCount',count(*) FILTER (WHERE NOT parity_verified
          OR state NOT IN ('ACTIVE','SEALED')),
        'nonSealedGenerationCount',count(*) FILTER (WHERE state<>'SEALED'),
        'generationRowCount',coalesce(sum(row_count),0))
      FROM oscar_archive_generation
      WHERE store_key='$store_key' AND id_scope=$id_scope AND profile='RAW_GATED'
        AND window_start='$window_start'::timestamptz
        AND window_end='$window_end'::timestamptz;")
    [[ $window_generations == \{* ]] || fail 'Could not inspect every stage-window generation.'
    [[ -z $registry_state ]] || safe_json_text "$registry_state"
    printf '{"registryState":%s,"relationPresent":%s,"inheritsParent":%s,' \
      "$([[ -n $registry_state ]] && printf '"%s"' "$registry_state" || printf null)" \
      "$([[ $relation_present == t ]] && printf true || printf false)" \
      "$([[ $inherits == t ]] && printf true || printf false)"
    printf '"rowCount":%s,"ownerCount":%s,"markerNonNullRowCount":%s,"coldHotPresent":%s,"sampleConsistent":%s,"selectedGeneration":%s,"windowGenerations":%s}\n' \
      "$row_count" "$owner_count" "$marker_count" \
      "$([[ $cold_hot_present == t ]] && printf true || printf false)" "$sample_consistent" \
      "$selected_generation" "$window_generations"
    ;;

  stage-lifecycle-hot)
    datastream_id=${1:-}; excluded_id=${2:-}
    [[ $datastream_id =~ ^[1-9][0-9]{0,18}$ && $excluded_id =~ ^[1-9][0-9]{0,18}$ ]] ||
      fail 'Stage hot-sample identity is invalid.'
    hot=$(json_query "WITH candidate AS (
        SELECT observation.id,observation.phenomenontime
        FROM obs observation
        JOIN pg_class relation ON relation.oid=observation.tableoid
        JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
        JOIN oscar_obs_stage_partition partition ON partition.child_table=relation.relname
          AND partition.state='ATTACHED'
        WHERE namespace.nspname=current_schema() AND observation.datastreamid=$datastream_id
          AND observation.id<>$excluded_id
        ORDER BY observation.phenomenontime DESC,observation.id DESC LIMIT 1)
      SELECT json_build_object('available',EXISTS(SELECT 1 FROM candidate),
        'hotId',(SELECT id::text FROM candidate),
        'hotTime',(SELECT to_char(phenomenontime AT TIME ZONE 'UTC',
          'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') FROM candidate));")
    [[ $hot == \{* ]] || fail 'Could not inspect an attached hot observation sample.'
    printf '%s\n' "$hot"
    ;;

  fixture-create)
    run=${1:-}; retention=${2:-}; valid_run "$run" || fail 'Invalid run ID.'
    [[ $retention =~ ^[1-9][0-9]*$ ]] || fail 'Invalid retention days.'
    ensure_fixture_table
    [[ $(scalar "SELECT count(*) FROM oscar_regression_fixture WHERE run_id='$run';") == 0 ]] || fail 'Fixture already exists.'
    fixture_cold_time=$(fixture_archive_time_sql "$retention" fixture_clock.sampled_at)
    create_observation_fixture "$run" \
      "$fixture_cold_time" \
      "fixture_clock.sampled_at-interval '1 minute'"
    ;;

  fixture-create-race)
    run=${1:-}; retention=${2:-}; valid_run "$run" || fail 'Invalid run ID.'
    [[ $retention =~ ^[1-9][0-9]*$ ]] || fail 'Invalid retention days.'
    ensure_fixture_table
    [[ $(scalar "SELECT count(*) FROM oscar_regression_fixture WHERE run_id='$run';") == 0 ]] || fail 'Fixture already exists.'
    suffix=$(printf '%s' "$run" | sha256sum | awk '{print substr($1,1,12)}')
    trigger_name="oscar_regression_activation_$suffix"
    function_name="oscar_regression_activation_fn_$suffix"
    holder_app="oscar_regression_holder_$suffix"
    lock_class=$((16#${suffix:0:6})); lock_object=$((16#${suffix:6:6}))
    race_work=$(mktemp -d "/tmp/oscar-regression-activation-$suffix.XXXXXXXX")
    holder_log="$race_work/holder.log"
    holder_client=''; race_fixture_created=false; race_success=false
    cleanup_activation_race() {
      psql_admin --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='$holder_app' AND pid<>pg_backend_pid();" >/dev/null 2>&1 || true
      if [[ -n $holder_client ]]; then wait "$holder_client" >/dev/null 2>&1 || true; fi
      psql_admin --command "DROP TRIGGER IF EXISTS $trigger_name ON obs; DROP FUNCTION IF EXISTS $function_name();" >/dev/null 2>&1 || true
      if [[ $race_success != true && -s $holder_log ]]; then
        emit_command_diagnostics 'PostgreSQL activation barrier holder' "$holder_log"
      fi
      rm -rf -- "$race_work"
      if [[ $race_fixture_created == true && $race_success != true ]]; then
        psql_admin --command "WITH f AS (DELETE FROM oscar_regression_fixture WHERE run_id='$run' RETURNING cold_ids,hot_id)
          DELETE FROM obs o USING f WHERE o.id=ANY(f.cold_ids) OR o.id=f.hot_id;" >/dev/null 2>&1 || true
      fi
    }
    trap cleanup_activation_race EXIT
    [[ $(scalar "SELECT count(*) FROM pg_trigger WHERE tgname='$trigger_name';") == 0 ]] ||
      fail 'The activation-race trigger already exists.'
    (
      compose exec -T postgres sh -eu -c '
        PGPASSWORD=$(cat /run/secrets/postgres_bootstrap_password)
        PGOPTIONS=-csearch_path=oscar,public
        PGAPPNAME=$1
        export PGPASSWORD PGOPTIONS PGAPPNAME
        exec psql --set=ON_ERROR_STOP=1 --username oscar_bootstrap --dbname gis \
          --command "SELECT pg_advisory_lock($2,$3); SELECT pg_sleep(240);"
      ' activation-holder "$holder_app" "$lock_class" "$lock_object"
    ) >"$holder_log" 2>&1 &
    holder_client=$!
    deadline=$((SECONDS+30)); holder_ready=false
    while ((SECONDS < deadline)); do
      held=$(scalar "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING(pid)
        WHERE a.application_name='$holder_app' AND l.locktype='advisory' AND l.classid=$lock_class::oid
          AND l.objid=$lock_object::oid AND l.granted;")
      [[ $held == 1 ]] && { holder_ready=true; break; }
      sleep 1
    done
    $holder_ready || fail 'Could not establish the PostgreSQL activation barrier.'
    race_started=$(scalar "SELECT to_char(clock_timestamp(),'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');")
    create_observation_fixture "$run" \
      "fixture_clock.sampled_at-interval '2 minutes'" \
      "fixture_clock.sampled_at-interval '1 minute'" >/dev/null
    race_fixture_created=true
    cold_id=$(scalar "SELECT cold_id FROM oscar_regression_fixture WHERE run_id='$run';")
    [[ $cold_id =~ ^[1-9][0-9]{0,18}$ ]] || fail 'Could not identify the activation-race cold row.'
    psql_admin --command "CREATE FUNCTION $function_name() RETURNS trigger LANGUAGE plpgsql AS \$\$
      DECLARE should_block boolean := false;
      BEGIN
        IF to_regclass('pg_temp.oscar_archive_activation_row') IS NOT NULL THEN
          EXECUTE 'SELECT EXISTS (SELECT 1 FROM pg_temp.oscar_archive_activation_row WHERE observation_id=$cold_id)'
            INTO should_block;
        END IF;
        IF should_block THEN PERFORM pg_advisory_xact_lock($lock_class,$lock_object); END IF;
        RETURN NULL;
      END \$\$;
      CREATE TRIGGER $trigger_name BEFORE UPDATE OF archivegenerationid ON obs FOR EACH STATEMENT
        EXECUTE FUNCTION $function_name();" >/dev/null
    fixture_cold_time=$(fixture_archive_time_sql "$retention" 'clock_timestamp()')
    chilled=$(scalar "WITH boundary AS (
        SELECT $fixture_cold_time archived_at),
      changed AS (UPDATE obs o SET
        phenomenontime=boundary.archived_at+(f.cold_id-o.id)*interval '1 microsecond',
        resulttime=boundary.archived_at+(f.cold_id-o.id)*interval '1 microsecond'
        FROM boundary,oscar_regression_fixture f
        WHERE f.run_id='$run' AND o.id=ANY(f.cold_ids) AND o.archivegenerationid IS NULL
        RETURNING o.phenomenontime),
      recorded AS (UPDATE oscar_regression_fixture f SET cold_time=(SELECT min(phenomenontime) FROM changed)
        WHERE f.run_id='$run' AND (SELECT count(*) FROM changed)=3 RETURNING 1)
      SELECT count(*) FROM recorded;")
    [[ $chilled == 1 ]] || fail 'Could not move all protected fixture rows into the archive window.'
    fixture_json=$(json_query "SELECT json_build_object('runId',run_id,'coldId',cold_id::text,
        'coldRowCount',cardinality(cold_ids),'hotId',hot_id::text,
        'datastreamId',datastream_id,'coldTime',cold_time,'hotTime',hot_time)
      FROM oscar_regression_fixture WHERE run_id='$run';")
    deadline=$((SECONDS+180)); activation_blocked=false
    while ((SECONDS < deadline)); do
      waiting=$(scalar "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING(pid)
        WHERE l.locktype='advisory' AND l.classid=$lock_class::oid AND l.objid=$lock_object::oid
          AND NOT l.granted AND a.application_name<>'$holder_app';")
      [[ $waiting =~ ^[1-9][0-9]*$ ]] && { activation_blocked=true; break; }
      sleep 1
    done
    $activation_blocked || fail 'Archive activation did not reach the controlled exact-row barrier.'
    changed=$(scalar "UPDATE obs SET resulttime=resulttime+interval '1 microsecond'
      WHERE id=(SELECT cold_id FROM oscar_regression_fixture WHERE run_id='$run') AND archivegenerationid IS NULL RETURNING 1;")
    [[ $changed == 1 ]] || fail 'Could not mutate the unactivated fixture row at the concurrency barrier.'
    psql_admin --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='$holder_app' AND pid<>pg_backend_pid();" >/dev/null
    wait "$holder_client" >/dev/null 2>&1 || true; holder_client=''
    deadline=$((SECONDS+60)); stale_rejected=false
    while ((SECONDS < deadline)); do
      rejected=$(scalar "SELECT count(*) FROM oscar_archive_job j,oscar_regression_fixture f
        WHERE f.run_id='$run' AND j.window_start<=f.cold_time AND j.window_end>f.cold_time
          AND j.state='FAILED' AND j.updated_at>='$race_started'::timestamptz;")
      unmarked=$(scalar "SELECT count(*) FROM obs o JOIN oscar_regression_fixture f ON o.id=ANY(f.cold_ids)
        WHERE f.run_id='$run' AND o.archivegenerationid IS NULL;")
      [[ $rejected =~ ^[1-9][0-9]*$ && $unmarked == 3 ]] && { stale_rejected=true; break; }
      sleep 1
    done
    $stale_rejected || fail 'The stale archive export was not rejected with its exact source row left unmarked.'
    race_success=true
    cleanup_activation_race
    trap - EXIT
    printf '%s' "${fixture_json%?}"
    printf ',"activationBlocked":true,"sourceMutated":true,"staleActivationRejected":true,"staleRowUnmarked":true}\n'
    ;;

  archive-maintenance-idle)
    (($# == 0)) || fail 'Archive maintenance idle accepts no arguments.'
    scratch_inventory=$(archive_scratch_inventory) ||
      fail 'DuckDB scratch root, permanent lease, or operation inventory is unsafe.'
    if [[ -z $scratch_inventory ]]; then
      scratch_entries=0
    else
      scratch_entries=$(grep -c . <<<"$scratch_inventory")
    fi
    [[ $scratch_entries =~ ^[0-9]+$ ]] ||
      fail 'DuckDB scratch idle probe returned a nonnumeric count.'
    config=/var/lib/oscar/config.json
    compose exec -T oscar sh -eu -c '
      path=$1
      test -f "$path" && test ! -L "$path"
      size=$(stat -c %s -- "$path")
      test "$size" -gt 0 && test "$size" -le 16777216
    ' archive-maintenance-config "$config" ||
      fail 'The live OSCAR config is unsafe for the archive maintenance idle probe.'
    idle_json=$(archive_maintenance_idle_json "$config" "$scratch_entries")
    [[ -n $idle_json ]] || fail 'Could not derive one deployed archive configuration for the idle probe.'
    printf '%s\n' "$idle_json"
    ;;

  fixture-status)
    run=${1:-}; valid_run "$run" || fail 'Invalid run ID.'; ensure_fixture_table
    json_query "WITH f AS (SELECT * FROM oscar_regression_fixture WHERE run_id='$run'), g AS (
      SELECT g.* FROM f LEFT JOIN obs archived_observation ON archived_observation.id=f.cold_id
      JOIN oscar_archive_generation g ON g.id=coalesce(f.generation_id,archived_observation.archivegenerationid)
      WHERE g.state IN ('ACTIVE','SEALED') ORDER BY g.activated_at DESC LIMIT 1),
    saved AS (UPDATE oscar_regression_fixture f SET generation_id=g.id FROM g WHERE f.run_id='$run' RETURNING f.*)
    SELECT json_build_object('exists',EXISTS(SELECT 1 FROM f),'generationId',(SELECT id FROM g),'generationState',(SELECT state FROM g),
      'parityVerified',coalesce((SELECT parity_verified FROM g),false),'generationRows',coalesce((SELECT row_count FROM g),0),
      'generationMinId',(SELECT min_id::text FROM g),'generationMaxId',(SELECT max_id::text FROM g),
      'windowStart',(SELECT window_start FROM g),'windowEnd',(SELECT window_end FROM g),
      'completedHourWindow',coalesce((SELECT window_start=date_trunc('hour',window_start)
        AND window_end=window_start+interval '1 hour' FROM g),false),
      'fixtureWithinWindow',coalesce((SELECT f.cold_time>=g.window_start
        AND f.cold_time<g.window_end FROM f,g),false),
      'markedRows',coalesce((SELECT count(*) FROM obs o,g WHERE o.archivegenerationid=g.id),0),
      'fixtureColdMarked',coalesce((SELECT count(*) FROM obs o,g
        WHERE o.id IN (SELECT unnest(cold_ids) FROM f) AND o.archivegenerationid=g.id),0)
        =coalesce((SELECT cardinality(cold_ids) FROM f),-1),
      'fixtureHotUnmarked',coalesce((SELECT o.archivegenerationid IS NULL FROM obs o,f WHERE o.id=f.hot_id),false),
      'exactRowOwnership',coalesce((SELECT g.row_count=cardinality(f.cold_ids)
        AND g.min_id=(SELECT min(id) FROM unnest(f.cold_ids) ids(id))
        AND g.max_id=(SELECT max(id) FROM unnest(f.cold_ids) ids(id))
        AND (SELECT count(*) FROM obs o WHERE o.archivegenerationid=g.id)=cardinality(f.cold_ids)
        AND (SELECT count(*)=cardinality(f.cold_ids) FROM obs o
          WHERE o.id=ANY(f.cold_ids) AND o.archivegenerationid=g.id)
        AND (SELECT o.archivegenerationid IS NULL FROM obs o WHERE o.id=f.hot_id) FROM f,g),false),
      'coldHotPresent',EXISTS(SELECT 1 FROM obs o,f WHERE o.id=ANY(f.cold_ids)),
      'hotPresent',EXISTS(SELECT 1 FROM obs WHERE id=(SELECT hot_id FROM f))) ;"
    ;;

  fixture-accelerate)
    run=${1:-}; valid_run "$run" || fail 'Invalid run ID.'; ensure_fixture_table
    changed=$(scalar "WITH target AS (SELECT generation_id FROM oscar_regression_fixture WHERE run_id='$run'),
      exact AS (SELECT g.id FROM oscar_archive_generation g JOIN target t ON t.generation_id=g.id
        JOIN oscar_regression_fixture f ON f.run_id='$run'
        WHERE g.state='ACTIVE' AND g.parity_verified AND g.row_count=cardinality(f.cold_ids)
          AND g.min_id=(SELECT min(id) FROM unnest(f.cold_ids) ids(id))
          AND g.max_id=(SELECT max(id) FROM unnest(f.cold_ids) ids(id))),
      changed AS (UPDATE oscar_archive_generation g SET activated_at=now()-interval '100 years' FROM exact e WHERE g.id=e.id RETURNING 1)
      SELECT count(*) FROM changed;")
    [[ $changed == 1 ]] || fail 'Fixture generation is not uniquely ACTIVE and parity verified.'
    printf '{"accelerated":true}\n'
    ;;

  export-check)
    subject=${1:-}
    if valid_uuid "$subject"; then generation=$subject; run=${subject//-/}
    else
      run=$subject; valid_run "$run" || fail 'Invalid run ID.'; ensure_fixture_table
      generation=$(scalar "SELECT generation_id FROM oscar_regression_fixture WHERE run_id='$run';")
    fi
    valid_uuid "$generation" || fail 'No archive generation was selected.'
    store_key=$(scalar "SELECT store_key FROM oscar_archive_generation WHERE id='$generation';")
    id_scope=$(scalar "SELECT id_scope FROM oscar_archive_generation WHERE id='$generation';")
    valid_store_key "$store_key" && valid_id_scope "$id_scope" ||
      fail 'Fixture archive generation has an invalid store identity.'
    export_root=$(mktemp -d "/tmp/oscar-regression-export-${run}.XXXXXX")
    trap 'rm -rf -- "$export_root"' EXIT
    sudo bash oscar.sh archive export --store-key "$store_key" --id-scope "$id_scope" \
      --generation "$generation" --destination "$export_root/portable" >/dev/null
    (cd "$export_root/portable" && sha256sum --check SHA256SUMS >/dev/null)
    parquet=$(find "$export_root/portable" -type f -name '*.parquet' | wc -l)
    manifests=$(find "$export_root/portable" -type f -name 'manifest*.json' | wc -l)
    schemas=$(find "$export_root/portable" -type f -name '*schema*' | wc -l)
    [[ -s $export_root/portable/query.sql && -s $export_root/portable/README.md && $parquet -gt 0 ]] || fail 'Portable export is incomplete.'
    printf '{"generationId":"%s","checksumVerified":true,"parquetFiles":%s,"manifestFiles":%s,"schemaFiles":%s,"querySql":true,"readme":true}\n' "$generation" "$parquet" "$manifests" "$schemas"
    ;;

  archive-helper-check)
    subject=${1:-}
    if valid_uuid "$subject"; then generation=$subject; run=${subject//-/}
    else
      run=$subject; valid_run "$run" || fail 'Invalid run ID.'; ensure_fixture_table
      generation=$(scalar "SELECT generation_id FROM oscar_regression_fixture WHERE run_id='$run';")
    fi
    valid_uuid "$generation" || fail 'No archive generation was selected.'
    object=$(psql_admin --tuples-only --no-align --field-separator=$'\t' --command \
      "SELECT relative_path,sha256 FROM oscar_archive_object WHERE generation_id='$generation' AND state='ACTIVE' ORDER BY relative_path LIMIT 1;" | tail -n1)
    IFS=$'\t' read -r relative expected_sha <<<"$object"
    [[ -n $relative && $expected_sha =~ ^[0-9a-f]{64}$ ]] || fail 'Fixture has no valid active archive object.'
    export_root="/tmp/oscar-regression-archive-helper-$run"
    compose exec -T oscar sh -eu -c 'test ! -e "$1" && test ! -L "$1"; mkdir -m 0700 "$1"' helper-fixture "$export_root"
    cleanup_archive_helper_fixture() {
      compose exec -T oscar sh -eu -c 'case $1 in /tmp/oscar-regression-archive-helper-*) rm -rf -- "$1" ;; *) exit 2 ;; esac' \
        helper-cleanup "$export_root" >/dev/null 2>&1 || true
    }
    trap cleanup_archive_helper_fixture EXIT
    compose exec -T -e OSCAR_ARCHIVE_HELPER_ROOT=/var/lib/oscar/archive \
      -e OSCAR_ARCHIVE_HELPER_EXPORT_ROOT="$export_root" oscar \
      /usr/local/bin/oscar-archive-object verify "$relative" "$expected_sha" >/dev/null
    compose exec -T -e OSCAR_ARCHIVE_HELPER_ROOT=/var/lib/oscar/archive \
      -e OSCAR_ARCHIVE_HELPER_EXPORT_ROOT="$export_root" oscar \
      /usr/local/bin/oscar-archive-object copy "$relative" "$expected_sha" >/dev/null
    copied_sha=$(compose exec -T oscar sha256sum "$export_root/$relative" | awk '{print $1}')
    [[ $copied_sha == "$expected_sha" ]] || fail 'Archive-object helper copy did not preserve the catalog checksum.'
    wrong_sha=$(printf '0%.0s' {1..64}); [[ $wrong_sha != "$expected_sha" ]] || wrong_sha=$(printf '1%.0s' {1..64})
    mismatch_rejected=false
    if ! compose exec -T -e OSCAR_ARCHIVE_HELPER_ROOT=/var/lib/oscar/archive oscar \
      /usr/local/bin/oscar-archive-object verify "$relative" "$wrong_sha" >/dev/null 2>&1; then
      mismatch_rejected=true
    fi
    traversal_rejected=false
    if ! compose exec -T -e OSCAR_ARCHIVE_HELPER_ROOT=/var/lib/oscar/archive oscar \
      /usr/local/bin/oscar-archive-object verify '../escape' "$expected_sha" >/dev/null 2>&1; then
      traversal_rejected=true
    fi
    cleanup_archive_helper_fixture
    trap - EXIT
    printf '{"generationId":"%s","verified":true,"copied":true,"copyChecksumValid":true,"mismatchRejected":%s,"traversalRejected":%s}\n' \
      "$generation" "$mismatch_rejected" "$traversal_rejected"
    ;;

  fixture-hot-hold-create)
    run=${1:-}; valid_run "$run" || fail 'Invalid run ID.'; ensure_fixture_table
    generation=$(scalar "SELECT generation_id FROM oscar_regression_fixture WHERE run_id='$run';")
    valid_uuid "$generation" || fail 'Fixture has no archive generation.'
    store_key=$(scalar "SELECT store_key FROM oscar_archive_generation WHERE id='$generation';")
    id_scope=$(scalar "SELECT id_scope FROM oscar_archive_generation WHERE id='$generation';")
    hot_id=$(scalar "SELECT hot_id FROM oscar_regression_fixture WHERE run_id='$run';")
    valid_store_key "$store_key" && valid_id_scope "$id_scope" || fail 'Fixture has an invalid store identity.'
    [[ $hot_id =~ ^[1-9][0-9]{0,18}$ ]] || fail 'Fixture has no valid hot observation ID.'
    [[ $(scalar "SELECT count(*) FROM \"$store_key\" WHERE id=$hot_id;") == 1 ]] ||
      fail 'Fixture hot observation is no longer present.'
    hot_hold=''; keep_hot_hold=false
    cleanup_hot_hold_create() {
      if [[ $keep_hot_hold != true ]] && valid_uuid "$hot_hold"; then
        sudo bash oscar.sh archive hold release --id "$hot_hold" --released-by oscar-regression-cleanup >/dev/null 2>&1 || true
      fi
    }
    trap cleanup_hot_hold_create EXIT
    hot_output=$(sudo bash oscar.sh archive hold create --store-key "$store_key" --id-scope "$id_scope" \
      --observation "$hot_id" --reason "regression-hot-$run" --created-by oscar-regression)
    hot_hold=$(retention_hold_id_from_output "$hot_output" "$store_key" "$id_scope" HOT_EXACT) ||
      fail 'Hot observation hold did not return one canonical HOT_EXACT ID.'
    [[ $(scalar "SELECT count(*) FROM oscar_retention_hold WHERE id='$hot_hold' AND store_key='$store_key' AND id_scope=$id_scope AND subject_type='OBSERVATION' AND subject_id='$hot_id' AND resolution_mode='HOT_EXACT' AND reason='regression-hot-$run' AND created_by='oscar-regression' AND released_at IS NULL;") == 1 ]] ||
      fail 'Created hot observation hold is not exact or active.'
    hot_list=$(sudo bash oscar.sh archive hold list)
    hot_listed=false
    grep -Eq "^[[:space:]]*$hot_hold[[:space:]|]+$store_key[[:space:]|]+$id_scope[[:space:]|]+OBSERVATION[[:space:]|]+$hot_id[[:space:]|]+HOT_EXACT([[:space:]|]+|$)" <<<"$hot_list" && hot_listed=true
    [[ $hot_listed == true ]] || fail 'Created HOT_EXACT hold is absent from the operator list.'
    keep_hot_hold=true
    trap - EXIT
    printf '{"holdId":"%s","storeKey":"%s","idScope":%s,"hotId":"%s","resolution":"HOT_EXACT","listed":true}\n' \
      "$hot_hold" "$store_key" "$id_scope" "$hot_id"
    ;;

  fixture-hot-hold-release)
    run=${1:-}; hot_hold=${2:-}; valid_run "$run" || fail 'Invalid run ID.'
    valid_uuid "$hot_hold" || fail 'Invalid hot-hold ID.'; ensure_fixture_table
    exact=$(scalar "SELECT count(*) FROM oscar_retention_hold h JOIN oscar_regression_fixture f ON f.run_id='$run' JOIN oscar_archive_generation g ON g.id=f.generation_id WHERE h.id='$hot_hold' AND h.store_key=g.store_key AND h.id_scope=g.id_scope AND h.subject_type='OBSERVATION' AND h.subject_id=f.hot_id::text AND h.resolution_mode='HOT_EXACT' AND h.reason='regression-hot-$run' AND h.created_by='oscar-regression' AND h.released_at IS NULL;")
    [[ $exact == 1 ]] || fail 'Hot hold does not match the registered disposable fixture.'
    sudo bash oscar.sh archive hold release --id "$hot_hold" --released-by oscar-regression >/dev/null
    released=false
    [[ $(scalar "SELECT count(*) FROM oscar_retention_hold WHERE id='$hot_hold' AND released_at IS NOT NULL AND released_by='oscar-regression';") == 1 ]] && released=true
    printf '{"holdId":"%s","released":%s}\n' "$hot_hold" "$released"
    ;;

  fixture-controls)
    run=${1:-}; valid_run "$run" || fail 'Invalid run ID.'; ensure_fixture_table
    generation=$(scalar "SELECT generation_id FROM oscar_regression_fixture WHERE run_id='$run';")
    valid_uuid "$generation" || fail 'Fixture has no archive generation.'
    [[ $(scalar "SELECT state FROM oscar_archive_generation WHERE id='$generation';") == SEALED ]] || fail 'Fixture generation is not SEALED.'
    store_key=$(scalar "SELECT store_key FROM oscar_archive_generation WHERE id='$generation';")
    id_scope=$(scalar "SELECT id_scope FROM oscar_archive_generation WHERE id='$generation';")
    cold_id=$(scalar "SELECT cold_id FROM oscar_regression_fixture WHERE run_id='$run';")
    valid_store_key "$store_key" && valid_id_scope "$id_scope" ||
      fail 'Fixture archive generation has an invalid store identity.'
    [[ $cold_id =~ ^[1-9][0-9]{0,18}$ ]] || fail 'Fixture has no valid archived observation ID.'
    cutoff=$(psql_admin --tuples-only --no-align --command "SELECT to_char(window_end+interval '1 second','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') FROM oscar_archive_generation WHERE id='$generation';" | tr -d '[:space:]')
    [[ $cutoff =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
      fail 'Fixture archive generation has no canonical deletion cutoff.'
    generation_hold=''; observation_hold=''
    cleanup_control_holds() {
      set +e
      for pending_hold in "$generation_hold" "$observation_hold"; do
        valid_uuid "$pending_hold" || continue
        sudo bash oscar.sh archive hold release --id "$pending_hold" --released-by oscar-regression-cleanup >/dev/null 2>&1
      done
      while IFS= read -r pending_hold; do
        valid_uuid "$pending_hold" || continue
        sudo bash oscar.sh archive hold release --id "$pending_hold" --released-by oscar-regression-cleanup >/dev/null 2>&1
      done < <(psql_admin --quiet --tuples-only --no-align --command "
        SELECT id::text FROM oscar_retention_hold
         WHERE released_at IS NULL AND store_key='$store_key' AND id_scope=$id_scope
           AND created_by='oscar-regression'
           AND ((subject_type='ARCHIVE_GENERATION' AND subject_id='$generation' AND reason='regression-$run')
             OR (subject_type='OBSERVATION' AND subject_id='$cold_id' AND reason='regression-observation-$run'))
         ORDER BY id;")
      set -e
    }
    trap cleanup_control_holds EXIT
    hold_output=$(sudo bash oscar.sh archive hold create --store-key "$store_key" --id-scope "$id_scope" \
      --generation "$generation" --reason "regression-$run" --created-by oscar-regression)
    hold=$(retention_hold_id_from_output "$hold_output" "$store_key" "$id_scope" GENERATION_EXACT) ||
      fail 'Hold create did not return one canonical exact-generation ID.'
    generation_hold=$hold
    [[ $(scalar "SELECT count(*) FROM oscar_retention_hold WHERE id='$hold' AND subject_type='ARCHIVE_GENERATION' AND resolution_mode='GENERATION_EXACT' AND released_at IS NULL;") == 1 ]] || fail 'Created exact-generation hold is not listed.'
    generation_hold_listed=false
    hold_list=$(sudo bash oscar.sh archive hold list)
    grep -Eq "^[[:space:]]*$hold[[:space:]|]+$store_key[[:space:]|]+$id_scope[[:space:]|]+ARCHIVE_GENERATION[[:space:]|]+$generation[[:space:]|]+GENERATION_EXACT([[:space:]|]+|$)" <<<"$hold_list" &&
      generation_hold_listed=true
    generation_held_dry=$(sudo bash oscar.sh archive dry-run --store-key "$store_key" --id-scope "$id_scope" \
      --before "$cutoff" --requested-by oscar-regression)
    generation_held_plan=$(printf '%s' "$generation_held_dry" | sed -n 's/^Deletion plan: //p')
    valid_uuid "$generation_held_plan" || fail 'Generation-held dry run did not return a plan.'
    generation_hold_enforced=false
    if [[ $(scalar "SELECT count(*) FROM oscar_deletion_plan_item WHERE plan_id='$generation_held_plan';") == 0 &&
          $(scalar "SELECT hold_count FROM oscar_deletion_plan WHERE id='$generation_held_plan';") == 1 ]]; then
      generation_hold_enforced=true
    fi
    psql_admin --command "DELETE FROM oscar_deletion_plan WHERE id='$generation_held_plan' AND state='PLANNED';" >/dev/null
    sudo bash oscar.sh archive hold release --id "$hold" --released-by oscar-regression >/dev/null
    [[ $(scalar "SELECT count(*) FROM oscar_retention_hold WHERE id='$hold' AND released_at IS NOT NULL;") == 1 ]] || fail 'Hold was not released.'
    generation_hold=''
    observation_hold_output=$(sudo bash oscar.sh archive hold create --store-key "$store_key" --id-scope "$id_scope" \
      --observation "$cold_id" --reason "regression-observation-$run" --created-by oscar-regression)
    observation_hold=$(retention_hold_id_from_output "$observation_hold_output" "$store_key" "$id_scope" COLD_RANGE_CONSERVATIVE) ||
      fail 'Observation hold create did not return one canonical conservative cold-range ID.'
    [[ $(scalar "SELECT count(*) FROM oscar_retention_hold WHERE id='$observation_hold' AND subject_type='OBSERVATION' AND subject_id='$cold_id' AND resolution_mode='COLD_RANGE_CONSERVATIVE' AND released_at IS NULL;") == 1 ]] ||
      fail 'Created observation hold is not listed.'
    observation_hold_listed=false
    hold_list=$(sudo bash oscar.sh archive hold list)
    grep -Eq "^[[:space:]]*$observation_hold[[:space:]|]+$store_key[[:space:]|]+$id_scope[[:space:]|]+OBSERVATION[[:space:]|]+$cold_id[[:space:]|]+COLD_RANGE_CONSERVATIVE([[:space:]|]+|$)" <<<"$hold_list" &&
      observation_hold_listed=true
    observation_held_dry=$(sudo bash oscar.sh archive dry-run --store-key "$store_key" --id-scope "$id_scope" \
      --before "$cutoff" --requested-by oscar-regression)
    observation_held_plan=$(printf '%s' "$observation_held_dry" | sed -n 's/^Deletion plan: //p')
    valid_uuid "$observation_held_plan" || fail 'Observation-held dry run did not return a plan.'
    observation_hold_enforced=false
    if [[ $(scalar "SELECT count(*) FROM oscar_deletion_plan_item WHERE plan_id='$observation_held_plan';") == 0 &&
          $(scalar "SELECT hold_count FROM oscar_deletion_plan WHERE id='$observation_held_plan';") == 1 ]]; then
      observation_hold_enforced=true
    fi
    psql_admin --command "DELETE FROM oscar_deletion_plan WHERE id='$observation_held_plan' AND state='PLANNED';" >/dev/null
    sudo bash oscar.sh archive hold release --id "$observation_hold" --released-by oscar-regression >/dev/null
    [[ $(scalar "SELECT count(*) FROM oscar_retention_hold WHERE id='$observation_hold' AND released_at IS NOT NULL;") == 1 ]] ||
      fail 'Observation hold was not released.'
    observation_hold=''
    trap - EXIT
    dry=$(sudo bash oscar.sh archive dry-run --store-key "$store_key" --id-scope "$id_scope" \
      --before "$cutoff" --requested-by oscar-regression)
    plan=$(printf '%s' "$dry" | sed -n 's/^Deletion plan: //p'); token=$(printf '%s' "$dry" | sed -n 's/^Confirmation token (shown once): //p')
    valid_uuid "$plan" && [[ $token =~ ^[0-9a-f]{48}$ ]] || fail 'Dry run did not return plan/token.'
    candidates=$(scalar "SELECT count(*) FROM oscar_deletion_plan_item WHERE plan_id='$plan';")
    only=$(scalar "SELECT count(*) FROM oscar_deletion_plan_item WHERE plan_id='$plan' AND generation_id='$generation';")
    if [[ $candidates != 1 || $only != 1 ]]; then
      psql_admin --command "DELETE FROM oscar_deletion_plan WHERE id='$plan' AND state='PLANNED';" >/dev/null
      fail 'Deletion plan included non-fixture generations; it was cancelled.'
    fi
    wrong=${token%?}0; [[ $wrong != "$token" ]] || wrong=${token%?}1
    if sudo bash oscar.sh archive purge --store-key "$store_key" --id-scope "$id_scope" \
      --plan "$plan" --token "$wrong" >/dev/null 2>&1; then fail 'Wrong token unexpectedly succeeded.'; fi
    [[ $(scalar "SELECT state FROM oscar_deletion_plan WHERE id='$plan';") == PLANNED ]] || fail 'Wrong token changed plan state.'
    sudo bash oscar.sh archive purge --store-key "$store_key" --id-scope "$id_scope" \
      --plan "$plan" --token "$token" >/dev/null
    replay_rejected=false
    sudo bash oscar.sh archive purge --store-key "$store_key" --id-scope "$id_scope" \
      --plan "$plan" --token "$token" >/dev/null 2>&1 || replay_rejected=true
    json_query "SELECT json_build_object('holdCreated',true,'holdListed',true,'holdReleased',true,
      'generationHoldCreated',true,'generationHoldResolution','GENERATION_EXACT',
      'generationHoldListed',$generation_hold_listed,'generationHoldEnforced',$generation_hold_enforced,
      'observationHoldCreated',true,'observationHoldResolution','COLD_RANGE_CONSERVATIVE',
      'observationHoldListed',$observation_hold_listed,'coldObservationHoldEnforced',$observation_hold_enforced,
      'dryRunPlan','$plan',
      'wrongTokenRejected',true,'purged',g.state='PURGED','objectsDeleted',NOT EXISTS(SELECT 1 FROM oscar_archive_object o WHERE o.generation_id=g.id AND o.state<>'DELETED'),
      'tombstonePresent',EXISTS(SELECT 1 FROM oscar_tombstone t WHERE t.generation_id=g.id),
      'ledgerPresent',EXISTS(SELECT 1 FROM oscar_deletion_ledger l WHERE l.plan_id='$plan' AND l.outcome='DELETED'),
      'tokenReplayRejected',$replay_rejected) FROM oscar_archive_generation g WHERE g.id='$generation';"
    ;;

  backup-check)
    [[ $(env_value OSCAR_BACKUP_MODE disabled) == single ]] ||
      fail 'Backup certification requires OSCAR_BACKUP_MODE=single.'
    (($# > 0 && $# <= 8)) ||
      fail 'Backup certification requires one to eight exact retained-media set expectations.'
    backup_work=$(mktemp -d /tmp/oscar-regression-backup-check.XXXXXXXX)
    backup_services_quiesced=false
    cleanup_backup_check() {
      local status=$? recovery_log=$backup_work/service-recovery.log had_errexit=false
      [[ $- == *e* ]] && had_errexit=true
      trap - EXIT
      set +e
      if $backup_services_quiesced; then
        if ! sudo bash oscar.sh start >"$recovery_log" 2>&1; then
          emit_command_diagnostics 'OSCAR backup-check service recovery' "$recovery_log"
          status=1
        fi
      fi
      rm -rf -- "$backup_work"
      $had_errexit && set -e
      return "$status"
    }
    trap cleanup_backup_check EXIT
    expected_inventory=$backup_work/expected-retained-members.txt
    : >"$expected_inventory"
    expected_sets=0
    retained_records=("$@")
    for retained_record in "$@"; do
      IFS='.' read -r event_token lane_token camera_token \
        frame_1_sha frame_1_bytes frame_2_sha frame_2_bytes frame_3_sha frame_3_bytes \
        frame_4_sha frame_4_bytes frame_5_sha frame_5_bytes extra <<<"$retained_record"
      [[ -z ${extra:-} ]] && valid_media_token "$event_token" && valid_media_token "$lane_token" &&
        valid_media_token "$camera_token" || fail 'Retained-media backup expectation has an invalid identity.'
      frame_shas=("$frame_1_sha" "$frame_2_sha" "$frame_3_sha" "$frame_4_sha" "$frame_5_sha")
      frame_bytes=("$frame_1_bytes" "$frame_2_bytes" "$frame_3_bytes" "$frame_4_bytes" "$frame_5_bytes")
      for frame_index in 0 1 2 3 4; do
        [[ ${frame_shas[$frame_index]} =~ ^[0-9a-f]{64}$ &&
           ${frame_bytes[$frame_index]} =~ ^[1-9][0-9]*$ ]] ||
          fail 'Retained-media backup expectation has an invalid frame hash or size.'
      done
      expected_sets=$((expected_sets+1))
    done
    app_image=''
    while IFS= read -r candidate_image; do
      case $candidate_image in
        oscar:*) [[ -z $app_image ]] || fail 'Compose selects multiple OSCAR application images.'; app_image=$candidate_image ;;
      esac
    done < <(compose config --images)
    [[ -n $app_image ]] ||
      fail 'Could not resolve the OSCAR application image for quiesced backup inventory.'
    for service in gateway oscar postgres; do
      compose ps --status running --services | grep -Fxq "$service" ||
        fail "Backup certification requires the running $service service."
    done
    backup_services_quiesced=true
    compose stop gateway >/dev/null
    compose stop oscar >/dev/null
    for retained_record in "${retained_records[@]}"; do
      IFS='.' read -r event_token lane_token camera_token \
        frame_1_sha frame_1_bytes frame_2_sha frame_2_bytes frame_3_sha frame_3_bytes \
        frame_4_sha frame_4_bytes frame_5_sha frame_5_bytes extra <<<"$retained_record"
      frame_shas=("$frame_1_sha" "$frame_2_sha" "$frame_3_sha" "$frame_4_sha" "$frame_5_sha")
      frame_bytes=("$frame_1_bytes" "$frame_2_bytes" "$frame_3_bytes" "$frame_4_bytes" "$frame_5_bytes")
      base="files/videos/retained-media/v1/events/$event_token/lanes/$lane_token/cameras/$camera_token"
      append_quiesced_backup_member "$expected_inventory" M "$base/manifest.json" "$app_image"
      for frame_index in 0 1 2 3 4; do
        frame_name=$(printf 'frame-%02d.jpg' "$((frame_index+1))")
        append_quiesced_backup_member "$expected_inventory" J "$base/$frame_name" "$app_image" \
          "${frame_shas[$frame_index]}" "${frame_bytes[$frame_index]}"
      done
    done
    metadata_paths=$(docker run --rm --network none --read-only --cap-drop ALL \
      --security-opt no-new-privileges --workdir / --user 10001:10001 --entrypoint sh \
      --volume oscar_oscar_state:/state:ro "$app_image" -eu -c '
      root=/state/files/videos/retained-media/v1
      checkpoint=$root/.metadata-reclamation-checkpoint.json
      [ -f "$checkpoint" ] && [ ! -L "$checkpoint" ]
      printf "%s\\n" "$checkpoint"
      find "$root/retention-processed-index" -mindepth 1 -maxdepth 1 -type f -name "*.idx" -print
      if [ -d "$root/deletion-index" ] && [ ! -L "$root/deletion-index" ]; then
        find "$root/deletion-index" -mindepth 2 -maxdepth 2 -type f -name "*.idx" -print
      fi
    ' retained-backup-metadata) || fail 'Required retained-media checkpoint/index metadata is missing or unsafe.'
    processed_expected=0
    deletion_expected=0
    while IFS= read -r metadata_path; do
      [[ -n $metadata_path && $metadata_path == /state/files/videos/retained-media/v1/* ]] ||
        fail 'Retained-media metadata inventory escaped its expected root.'
      metadata_member=${metadata_path#/state/}
      case $metadata_member in
        files/videos/retained-media/v1/.metadata-reclamation-checkpoint.json)
          append_quiesced_backup_member "$expected_inventory" C "$metadata_member" "$app_image"
          ;;
        files/videos/retained-media/v1/retention-processed-index/*.idx)
          [[ ${metadata_member##*/} =~ ^[0-9]{19}-(0[0-9]|1[01])[.]idx$ ]] ||
            fail 'Retained-media processed index has a noncanonical name.'
          append_quiesced_backup_member "$expected_inventory" P "$metadata_member" "$app_image"
          processed_expected=$((processed_expected+1))
          ;;
        files/videos/retained-media/v1/deletion-index/[0-9a-f][0-9a-f]/[0-9a-f][0-9a-f][0-9a-f][0-9a-f].idx)
          append_quiesced_backup_member "$expected_inventory" D "$metadata_member" "$app_image"
          deletion_expected=$((deletion_expected+1))
          ;;
        *) fail 'Retained-media metadata inventory contains an unexpected path.' ;;
      esac
    done <<<"$metadata_paths"
    expected_member_count=$(wc -l <"$expected_inventory" | tr -d '[:space:]')
    [[ $expected_member_count == $((expected_sets * 6 + 1 + processed_expected + deletion_expected)) ]] ||
      fail 'Retained backup expectation inventory has an inconsistent exact member count.'
    output=$(sudo bash oscar.sh backup)
    backup=$(printf '%s' "$output" | sed -n 's#^Backup created: .*/##p' | tail -n1)
    [[ $backup =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || fail 'Backup command did not return a backup ID.'
    journal_confirmed_count=$(printf '%s\n' "$output" | sed -n \
      "s#^Confirmed \([0-9][0-9]*\) daily-file lane/day publication(s) from verified backup $backup\$#\1#p")
    [[ $journal_confirmed_count =~ ^[0-9]+$ && $journal_confirmed_count -le 100000 ]] ||
      fail 'Backup command did not report one bounded daily-journal confirmation outcome.'
    backup_dir=$(absolute_path "$(env_value OSCAR_BACKUP_DIR ../oscar-storage/backups)")
    root=$backup_dir/$backup
    for required in VERIFIED JOURNAL_CONFIRMED SHA256SUMS SHA256SUMS.hmac epoch.json image-inventory.txt; do
      [[ -f $root/$required && ! -L $root/$required && -s $root/$required ]] ||
        fail "Backup marker is missing, empty, linked, or non-regular: $required"
    done
    [[ -f $root/archive-generation-ids.txt && ! -L $root/archive-generation-ids.txt ]] ||
      fail 'Archive-generation inventory is missing, linked, or non-regular.'
    backup_key_file=$(absolute_path "$(env_value OSCAR_BACKUP_KEY_FILE ./secrets/backup-key.txt)")
    [[ -n $app_image && -f $backup_key_file && ! -L $backup_key_file ]] ||
      fail 'Cannot independently authenticate the backup core.'
    current=$backup_dir/CURRENT
    [[ -f $current && ! -L $current && $(stat -c %u -- "$current") == 0 &&
       $(stat -c %a -- "$current") == 600 &&
       $(wc -l <"$current" | tr -d '[:space:]') == 4 &&
       $(sed -n '1p' "$current") == format=oscar-current-backup &&
       $(sed -n '2p' "$current") == version=1 &&
       $(sed -n '3p' "$current") == "backup_id=$backup" &&
       $(sed -n '4p' "$current") =~ ^hmac_sha256=[A-Za-z0-9+/]{43}=$ ]] ||
      fail 'CURRENT does not safely and exactly identify the new single snapshot.'
    current_expected=$(sed -n 's/^hmac_sha256=//p' "$current")
    current_actual=$(sudo docker run --rm --network none --read-only --cap-drop ALL \
      --security-opt no-new-privileges --user 0 --entrypoint sh \
      --volume "$current:/current:ro" --volume "$backup_key_file:/backup-key.txt:ro" \
      "$app_image" -eu -c '
        key=$(cat /backup-key.txt)
        head -n 3 /current | openssl dgst -sha256 -hmac "$key" -binary | openssl base64 -A
      ' | tr -d '\r\n')
    [[ $current_actual == "$current_expected" ]] || fail 'CURRENT HMAC authentication failed.'
    [[ $(verify_backup_core_authentication "$root" "$backup_key_file" "$app_image") == verified ]] ||
      fail 'Independent backup HMAC/checksum/inventory verification failed.'
    hmac=$(tr -d '\r\n' <"$root/SHA256SUMS.hmac")
    [[ $hmac =~ ^[A-Za-z0-9+/]{43}=$ ]] || fail 'Backup HMAC marker is malformed.'
    verified_at=$(tr -d '\r\n' <"$root/VERIFIED")
    [[ $verified_at =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
      fail 'Backup VERIFIED marker is malformed.'
    epoch_id=$(awk -F'"' '/"backupEpochId"/ {print $4; exit}' "$root/epoch.json")
    epoch_backup=$(awk -F'"' '/"backupId"/ {print $4; exit}' "$root/epoch.json")
    epoch_format=$(awk -F'"' '/"format"/ {print $4; exit}' "$root/epoch.json")
    epoch_version=$(awk -F'[: ,]+' '/"version"/ {print $3; exit}' "$root/epoch.json")
    epoch_release=$(awk -F'"' '/"oscarVersion"/ {print $4; exit}' "$root/epoch.json")
    epoch_state=$(awk -F'"' '/"state"/ {print $4; exit}' "$root/epoch.json")
    epoch_created=$(awk -F'"' '/"createdAt"/ {print $4; exit}' "$root/epoch.json")
    valid_uuid "$epoch_id" || fail 'Backup epoch UUID is invalid.'
    [[ $epoch_backup == "$backup" && $epoch_format == oscar-backup-epoch && $epoch_version == 2 &&
          $epoch_release == 3.11.0 && $epoch_state == CREATED &&
          $epoch_created =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
      fail 'Backup epoch identity, format, state, or release is invalid.'
    [[ ! -e $root/wal-archive.tar.gz && ! -L $root/wal-archive.tar.gz ]] ||
      fail 'Schema-v2 backup unexpectedly contains cumulative wal-archive.tar.gz.'
    [[ -d $root/postgres/pg_wal && ! -L $root/postgres/pg_wal &&
       $(find "$root/postgres/pg_wal" -mindepth 1 -maxdepth 1 -type f -name '[0-9A-F][0-9A-F]*' -print | wc -l | tr -d '[:space:]') -gt 0 ]] ||
      fail 'Schema-v2 base backup does not contain streamed WAL.'
    schema2_count=0
    while IFS= read -r candidate; do
      candidate_version=$(awk -F'[: ,]+' '/"version"/ {print $3; exit}' "$candidate/epoch.json" 2>/dev/null || true)
      [[ $candidate_version != 2 ]] || schema2_count=$((schema2_count+1))
    done < <(find "$backup_dir" -mindepth 1 -maxdepth 1 -type d -name '????????T??????Z-????????' -print)
    [[ $schema2_count == 1 ]] || fail 'Single mode must retain exactly one committed schema-v2 snapshot.'
    staging_count=$(find "$backup_dir" -mindepth 1 -maxdepth 1 \
      \( -name '*.partial' -o -name '.CURRENT.tmp.*' -o -name '.deleting-*' \) -print | wc -l | tr -d '[:space:]')
    [[ $staging_count == 0 ]] || fail 'Single-backup publication left staging or deletion artifacts.'
    oscar_state_sha=$(awk '$2=="./oscar-state.tar.gz" {print $1}' "$root/SHA256SUMS")
    [[ $oscar_state_sha =~ ^[0-9a-f]{64}$ ]] || fail 'Authenticated manifest has no unique OSCAR state checksum.'
    [[ $(awk '$2=="./oscar-state.tar.gz" {count++} END {print count+0}' "$root/SHA256SUMS") == 1 ]] ||
      fail 'Authenticated manifest must contain exactly one OSCAR state entry.'
    [[ $(awk '$2=="./archive-generation-ids.txt" {count++} END {print count+0}' "$root/SHA256SUMS") == 1 ]] ||
      fail 'Authenticated manifest must contain exactly one archive-generation inventory.'
    generation_bytes=$(stat -c %s -- "$root/archive-generation-ids.txt")
    [[ $generation_bytes =~ ^[0-9]+$ && $generation_bytes -le 37000000 ]] ||
      fail 'Archive-generation inventory exceeds its 37,000,000-byte safety bound.'
    if [[ $generation_bytes -gt 0 ]]; then
      [[ $(tail -c 1 "$root/archive-generation-ids.txt" | od -An -t x1 | tr -d '[:space:]') == 0a ]] ||
        fail 'Archive-generation inventory is not canonically newline terminated.'
    fi
    generation_count=0
    generation_previous=''
    while IFS= read -r generation_id || [[ -n $generation_id ]]; do
      generation_count=$((generation_count+1))
      [[ $generation_count -le 1000000 &&
         $generation_id =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] ||
        fail 'Archive-generation inventory contains a noncanonical UUID.'
      [[ -z $generation_previous || $generation_id > $generation_previous ]] ||
        fail 'Archive-generation inventory is unsorted or contains duplicates.'
      generation_previous=$generation_id
    done <"$root/archive-generation-ids.txt"
    [[ $generation_bytes == $((generation_count * 37)) ]] ||
      fail 'Archive-generation inventory has noncanonical fixed-width LF framing.'
    generation_sha=$(sha256_file "$root/archive-generation-ids.txt")
    [[ $generation_sha =~ ^[0-9a-f]{64}$ ]] ||
      fail 'Archive-generation inventory SHA-256 is invalid.'
    [[ $(awk '$2=="./JOURNAL_CONFIRMED" {count++} END {print count+0}' "$root/SHA256SUMS") == 0 ]] ||
      fail 'Post-verification journal confirmation must remain outside the authenticated core inventory.'
    [[ $(wc -l <"$root/JOURNAL_CONFIRMED" | tr -d '[:space:]') == 5 &&
          $(grep -Fxc 'format=oscar-journal-backup-confirmation' "$root/JOURNAL_CONFIRMED") == 1 &&
          $(grep -Fxc 'version=2' "$root/JOURNAL_CONFIRMED") == 1 &&
          $(grep -Fxc "backup_id=$backup" "$root/JOURNAL_CONFIRMED") == 1 &&
          $(grep -Fxc "oscar_state_sha256=$oscar_state_sha" "$root/JOURNAL_CONFIRMED") == 1 &&
          $(grep -Ec '^hmac_sha256=[A-Za-z0-9+/]{43}=$' "$root/JOURNAL_CONFIRMED") == 1 ]] ||
      fail 'Journal-confirmation audit sidecar does not match the accepted recovery point.'
    [[ -n $app_image && -f $backup_key_file && ! -L $backup_key_file ]] ||
      fail 'Cannot authenticate the journal-confirmation audit sidecar.'
    sidecar_expected=$(sed -n 's/^hmac_sha256=//p' "$root/JOURNAL_CONFIRMED")
    sidecar_actual=$(sudo docker run --rm --network none --read-only --cap-drop ALL \
      --security-opt no-new-privileges --user 0 --entrypoint sh \
      --volume "$root/JOURNAL_CONFIRMED:/journal-confirmation:ro" \
      --volume "$backup_key_file:/backup-key.txt:ro" "$app_image" -eu -c '
        key=$(cat /backup-key.txt)
        head -n 4 /journal-confirmation |
          openssl dgst -sha256 -hmac "$key" -binary | openssl base64 -A
      ' | tr -d '\r\n')
    [[ $sidecar_actual == "$sidecar_expected" ]] ||
      fail 'Journal-confirmation audit sidecar HMAC is invalid.'
    backup_verify_log=$backup_work/backup-verify.log
    if ! sudo bash oscar.sh backup-verify "$backup" >"$backup_verify_log" 2>&1; then
      emit_command_diagnostics 'OSCAR backup verification' "$backup_verify_log"
      fail 'Supported backup verification rejected the newly created backup.'
    fi
    catalog_inventory=$backup_work/catalog-generation-ids.txt
    psql_admin --quiet --tuples-only --no-align --command "
      SELECT id::text FROM oscar_archive_generation
      WHERE state IN ('ACTIVE','SEALED') AND activated_at <= '$epoch_created'::timestamptz
      ORDER BY id;" >"$catalog_inventory"
    cmp -s "$root/archive-generation-ids.txt" "$catalog_inventory" ||
      fail 'Authenticated archive-generation inventory differs from the captured catalog epoch.'
    epoch=$(scalar "SELECT count(*) FROM oscar_backup_epoch WHERE id='$epoch_id' AND state='VERIFIED' AND manifest_path='$backup/epoch.json';")
    catalog_generation_receipt=$(scalar "SELECT archive_generation_count||'|'||archive_generation_inventory_sha256||'|'||archive_generation_inventory_bytes FROM oscar_backup_epoch WHERE id='$epoch_id' AND state='VERIFIED' AND manifest_path='$backup/epoch.json';")
    [[ $epoch == 1 && $catalog_generation_receipt == "$generation_count|$generation_sha|$generation_bytes" ]] ||
      fail 'VERIFIED catalog epoch does not exactly match the authenticated backup-time archive-generation receipt.'
    backup_reference="oscar-backup:$backup/oscar-state.tar.gz#sha256=$oscar_state_sha"
    state_listing=$backup_work/state-listing.txt
    tar -tzf "$root/oscar-state.tar.gz" >"$state_listing"
    member_count=$(wc -l <"$state_listing" | tr -d '[:space:]')
    [[ $member_count =~ ^[0-9]+$ && $member_count -le 200000 ]] ||
      fail 'OSCAR state backup member inventory exceeds its 200,000-entry safety bound.'
    if grep -Eq '(^/|(^|/)[.][.](/|$))' "$state_listing"; then
      fail 'OSCAR state backup contains an absolute or traversal member.'
    fi
    receipt_count=0; invalid_receipts=0; receipt_segments_verified=0
    receipt_root=files/.dailyfile-journal/backup-confirmations
    confirmation_set_member="$receipt_root/.sets/$backup.json"
    if ((journal_confirmed_count > 0)); then
      confirmation_set_file=$backup_work/confirmation-set.json
      copy_quiesced_confirmation_member "$confirmation_set_member" "$confirmation_set_file" \
        "$app_image" 786432
    set_bytes=$(file_size "$confirmation_set_file")
    [[ $set_bytes =~ ^[1-9][0-9]*$ && $set_bytes -le 786432 ]] ||
      fail 'Daily-journal confirmation-set marker exceeds its 768 KiB decoded safety bound.'
    set_encoded=$(openssl base64 -A -in "$confirmation_set_file" | tr -d '\r\n')
    [[ $set_encoded =~ ^[A-Za-z0-9+/]+=*$ && ${#set_encoded} -le 1048576 ]] ||
      fail 'Daily-journal confirmation-set marker has invalid bounded base64.'
    set_valid=$(scalar "WITH source AS (
        SELECT convert_from(decode('$set_encoded','base64'),'UTF8') AS text),
      doc AS (SELECT text::json AS raw, text::jsonb AS value FROM source),
      receipts AS (SELECT raw_receipt, raw_receipt::jsonb AS receipt FROM doc,
        LATERAL json_array_elements(CASE WHEN json_typeof(raw->'receipts')='array'
          THEN raw->'receipts' ELSE '[]'::json END) raw_receipt)
      SELECT jsonb_typeof(value)='object'
        AND (SELECT count(*) FROM json_object_keys(raw))=6
        AND value ?& ARRAY['schemaVersion','format','confirmationSet','receiptCount','committedAt','receipts']
        AND value->'schemaVersion'='1'::jsonb
        AND value->>'format'='oscar-dailyfile-backup-confirmation-set'
        AND value->>'confirmationSet'='$backup'
        AND jsonb_typeof(value->'receiptCount')='number'
        AND (value->>'receiptCount')::bigint=(SELECT count(*) FROM receipts)
        AND (SELECT count(*) FROM receipts)=(SELECT count(DISTINCT receipt->>'path') FROM receipts)
        AND (value->>'receiptCount')::bigint>0
        AND jsonb_typeof(value->'committedAt')='string'
        AND value->>'committedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?Z$'
        AND NOT EXISTS (SELECT 1 FROM receipts WHERE
          jsonb_typeof(receipt)<>'object'
          OR (SELECT count(*) FROM json_object_keys(raw_receipt))<>2
          OR NOT (receipt ?& ARRAY['path','sha256'])
          OR receipt->>'path' !~ '^[A-Za-z0-9._-]+/[0-9]{4}-[0-9]{2}-[0-9]{2}[.]json$'
          OR receipt->>'sha256' !~ '^[0-9a-f]{64}$')
      FROM doc;")
    [[ $set_valid == t ]] || fail 'Atomic daily-journal confirmation-set marker is invalid.'
    receipt_set_rows=$backup_work/receipt-set-rows.txt
    psql_admin --quiet --tuples-only --no-align --field-separator='|' --command "WITH doc AS (
        SELECT convert_from(decode('$set_encoded','base64'),'UTF8')::jsonb AS value)
      SELECT receipt->>'path',receipt->>'sha256' FROM doc,
        LATERAL jsonb_array_elements(value->'receipts') receipt ORDER BY receipt->>'path';" >"$receipt_set_rows"
    while IFS='|' read -r receipt_relative receipt_expected_sha receipt_extra; do
      [[ -z ${receipt_extra:-} &&
         $receipt_relative =~ ^[A-Za-z0-9._-]+/[0-9]{4}-[0-9]{2}-[0-9]{2}[.]json$ &&
         $receipt_expected_sha =~ ^[0-9a-f]{64}$ ]] ||
        fail 'Authenticated daily-journal receipt identity is outside the exact receipt layout.'
      receipt_day=${receipt_relative##*/}; receipt_day=${receipt_day%.json}
      receipt_member="$receipt_root/$receipt_relative"
      receipt_file=$backup_work/receipt-$receipt_count.json
      copy_quiesced_confirmation_member "$receipt_member" "$receipt_file" "$app_image" 786432
      receipt_bytes=$(file_size "$receipt_file")
      [[ $receipt_bytes =~ ^[1-9][0-9]*$ && $receipt_bytes -le 786432 &&
         $(sha256_file "$receipt_file") == "$receipt_expected_sha" ]] || {
        invalid_receipts=$((invalid_receipts+1)); continue; }
      encoded=$(openssl base64 -A -in "$receipt_file" | tr -d '\r\n')
      [[ $encoded =~ ^[A-Za-z0-9+/]+=*$ && ${#encoded} -le 1048576 ]] ||
        fail 'Authenticated daily-journal receipt could not be represented as bounded base64.'
      receipt_reference=$(scalar "WITH doc AS (
        SELECT convert_from(decode('$encoded','base64'),'UTF8')::jsonb AS value)
        SELECT coalesce(value->>'backupReference','') FROM doc;")
      [[ $receipt_reference == "$backup_reference" ]] || continue
      receipt_count=$((receipt_count+1))
      receipt_valid=$(scalar "WITH source AS (
          SELECT convert_from(decode('$encoded','base64'),'UTF8') AS text),
        doc AS (SELECT text::json AS raw, text::jsonb AS value FROM source),
        segments AS (
          SELECT raw_segment, raw_segment::jsonb AS segment FROM doc, LATERAL json_array_elements(
            CASE WHEN json_typeof(raw->'sealedSegments')='array'
              THEN raw->'sealedSegments' ELSE '[]'::json END) AS raw_segment)
        SELECT jsonb_typeof(value)='object'
          AND (SELECT count(*) FROM json_object_keys(raw))=10
          AND value ?& ARRAY['schemaVersion','laneId','day','windowStartInclusive',
            'windowEndExclusive','sha256','backupReference','confirmationSet','sealedSegments','confirmedAt']
          AND value->'schemaVersion'='1'::jsonb
          AND jsonb_typeof(value->'laneId')='string' AND length(value->>'laneId') BETWEEN 1 AND 256
          AND jsonb_typeof(value->'day')='string'
          AND value->>'day'='$receipt_day'
          AND jsonb_typeof(value->'windowStartInclusive')='string'
          AND jsonb_typeof(value->'windowEndExclusive')='string'
          AND value->>'windowStartInclusive' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?Z$'
          AND value->>'windowEndExclusive' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?Z$'
          AND (value->>'windowStartInclusive')::timestamptz < (value->>'windowEndExclusive')::timestamptz
          AND jsonb_typeof(value->'sha256')='string' AND value->>'sha256' ~ '^[0-9a-f]{64}$'
          AND jsonb_typeof(value->'backupReference')='string'
          AND value->>'backupReference'='$backup_reference'
          AND jsonb_typeof(value->'confirmationSet')='string'
          AND value->>'confirmationSet'='$backup'
          AND jsonb_typeof(value->'sealedSegments')='array'
          AND jsonb_array_length(value->'sealedSegments') > 0
          AND NOT EXISTS (SELECT 1 FROM segments WHERE
            jsonb_typeof(segment)<>'object'
            OR (SELECT count(*) FROM json_object_keys(raw_segment))<>3
            OR NOT (segment ?& ARRAY['name','byteCount','sha256'])
            OR jsonb_typeof(segment->'name')<>'string'
            OR segment->>'name' !~ '^[A-Za-z0-9._-]+[.]seg$'
            OR jsonb_typeof(segment->'byteCount')<>'number'
            OR segment->>'byteCount' !~ '^[1-9][0-9]*$'
            OR jsonb_typeof(segment->'sha256')<>'string'
            OR segment->>'sha256' !~ '^[0-9a-f]{64}$')
          AND jsonb_typeof(value->'confirmedAt')='string'
          AND value->>'confirmedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?Z$'
        FROM doc;")
      relative=$receipt_relative
      receipt_sha=$(sha256_file "$receipt_file")
      membership=$(scalar "WITH doc AS (
          SELECT convert_from(decode('$set_encoded','base64'),'UTF8')::jsonb AS value)
        SELECT count(*)=1 FROM doc, LATERAL jsonb_array_elements(value->'receipts') receipt
        WHERE receipt->>'path'='$relative' AND receipt->>'sha256'='$receipt_sha';")
      [[ $receipt_valid == t && $membership == t ]] || invalid_receipts=$((invalid_receipts+1))
      receipt_rows=$backup_work/receipt-segments-$receipt_count.txt
      psql_admin --quiet --tuples-only --no-align --field-separator='|' --command "WITH doc AS (
          SELECT convert_from(decode('$encoded','base64'),'UTF8')::jsonb AS value)
        SELECT value->>'laneId',segment->>'name',segment->>'byteCount',segment->>'sha256'
        FROM doc,LATERAL jsonb_array_elements(value->'sealedSegments') segment
        ORDER BY segment->>'name';" >"$receipt_rows.with-lane"
      receipt_lane=''; : >"$receipt_rows"
      while IFS='|' read -r lane_id segment_name segment_bytes segment_sha segment_extra; do
        [[ -z ${segment_extra:-} && $lane_id =~ ^urn:osh:system:lane:[A-Za-z0-9._-]{1,200}$ ]] || {
          invalid_receipts=$((invalid_receipts+1)); continue; }
        [[ -z $receipt_lane || $receipt_lane == "$lane_id" ]] || invalid_receipts=$((invalid_receipts+1))
        receipt_lane=$lane_id
        printf '%s|%s|%s\n' "$segment_name" "$segment_bytes" "$segment_sha" >>"$receipt_rows"
      done <"$receipt_rows.with-lane"
      safe_lane=$(printf '%s' "$receipt_lane" | sed 's/[^A-Za-z0-9._-]/_/g')
      if ((${#safe_lane} > 120)); then safe_lane=${safe_lane:0:120}; fi
      receipt_directory="$safe_lane-$(printf '%s' "$receipt_lane" | sha256sum | cut -c1-12)"
      verified_segments=$(verify_daily_receipt_backup_members "$root/oscar-state.tar.gz" \
        "$state_listing" "$receipt_directory" "$receipt_day" "$receipt_rows" "$backup_work" || true)
      if [[ $verified_segments =~ ^[1-9][0-9]*$ ]]; then
        receipt_segments_verified=$((receipt_segments_verified+verified_segments))
      else invalid_receipts=$((invalid_receipts+1)); fi
    done <"$receipt_set_rows"
    set_count=$(scalar "WITH doc AS (
        SELECT convert_from(decode('$set_encoded','base64'),'UTF8')::jsonb AS value)
      SELECT (value->>'receiptCount')::bigint FROM doc;")
      [[ $set_count == "$receipt_count" ]] || invalid_receipts=$((invalid_receipts+1))
      [[ $receipt_count =~ ^[1-9][0-9]*$ && $receipt_count == "$journal_confirmed_count" &&
         $invalid_receipts == 0 ]] ||
        fail 'New backup did not produce its exact valid daily-journal confirmation set.'
    else
      docker run --rm --network none --read-only --cap-drop ALL \
        --security-opt no-new-privileges --workdir / --user 10001:10001 --entrypoint sh \
        --volume oscar_oscar_state:/state:ro "$app_image" -eu -c '
          path=/state/$1
          [ ! -e "$path" ] && [ ! -L "$path" ]
        ' empty-journal-confirmation "$confirmation_set_member" ||
        fail 'Zero-candidate daily-journal confirmation unexpectedly published a set marker.'
    fi
    duck_scratch_excluded=true
    grep -Eq '^([.]/)?duckdb-tmp(/|$)' "$state_listing" && duck_scratch_excluded=false
    retained_prefix=false
    grep -Eq '^([.]/)?files/videos/retained-media/v1(/|$)' "$state_listing" && retained_prefix=true
    checkpoint_included=false
    grep -Eq '^([.]/)?files/videos/retained-media/v1/[.]metadata-reclamation-checkpoint[.]json$' "$state_listing" && checkpoint_included=true
    processed_indexes=$(grep -Ec '^([.]/)?files/videos/retained-media/v1/retention-processed-index/[0-9]{19}-(0[0-9]|1[01])[.]idx$' "$state_listing" || true)
    deletion_indexes=$(grep -Ec '^([.]/)?files/videos/retained-media/v1/deletion-index/[0-9a-f]{2}/[0-9a-f]{4}[.]idx$' "$state_listing" || true)
    retained_manifests=$(grep -Ec '^([.]/)?files/videos/retained-media/v1/events/.+/manifest[.]json$' "$state_listing" || true)
    retained_jpegs=$(grep -Ec '^([.]/)?files/videos/retained-media/v1/events/.+/frame-0[1-5][.]jpg$' "$state_listing" || true)
    exact_retained_members=$(verify_retained_backup_members \
      "$root/oscar-state.tar.gz" "$expected_inventory" "$backup_work")
    [[ $exact_retained_members == "$expected_member_count" &&
       $processed_indexes == "$processed_expected" && $deletion_indexes == "$deletion_expected" ]] ||
      fail 'Backup did not preserve the complete exact retained-media expectation inventory.'
    atomic_state_machine_exact=false
    if grep -Fq 'recover_single_backup_state "$image"' oscar-storage.sh &&
       grep -Fq 'publish_export_directory "$work" "$final"' oscar-storage.sh &&
       grep -Fq 'write_current_backup_pointer "$backup_id" "$image"' oscar-storage.sh &&
       grep -Fq 'durably_flush_tree "$work"' oscar-storage.sh; then
      atomic_state_machine_exact=true
    fi
    before_prune=$(tree_fingerprint "$backup_dir")
    prune_log=$backup_work/backup-prune.log
    set +e
    sudo bash oscar.sh backup-prune >"$prune_log" 2>&1
    prune_status=$?
    set -e
    prune_retired=false
    if [[ $prune_status -ne 0 ]] &&
       grep -Fq 'OSCAR backup-prune is retired. Create a new verified single snapshot to atomically replace CURRENT' "$prune_log" &&
       [[ $(tree_fingerprint "$backup_dir") == "$before_prune" ]]; then
      prune_retired=true
    fi
    cleanup_backup_check
    trap - EXIT
    printf '{"backupId":"%s","backupMode":"single","schemaVersion":2,"currentAuthenticated":true,"currentSnapshotCount":1,"walArchiveTarAbsent":true,"streamedWalPresent":true,"stagingArtifacts":0,"atomicStateMachineExact":%s,"pruneRetired":%s,"automaticVerification":true,"supportedVerification":true,"independentCoreAuthentication":true,"authenticatedManifest":true,"journalConfirmationAuthenticated":true,"journalConfirmedPublications":%s,"regularMarkers":true,"epochValid":true,"verifiedEpoch":%s,"archiveGenerationInventoryExact":true,"archiveGenerationCount":%s,"journalReceipts":%s,"journalReceiptReferencesValid":true,"journalReceiptSegmentsVerified":%s,"duckDbScratchExcluded":%s,"retainedMediaPrefixPresent":%s,"mediaMetadataCheckpointIncluded":%s,"processedObservationIndexesIncluded":%s,"deletionIndexesIncluded":%s,"retainedMediaManifestsIncluded":%s,"retainedMediaJpegsIncluded":%s,"retainedMediaExpectedSets":%s,"retainedMediaExpectedMembers":%s,"retainedMediaExactMembersVerified":%s,"expectedProcessedIndexes":%s,"expectedDeletionIndexes":%s,"backupMemberCount":%s,"restoreAttempted":false}\n' \
      "$backup" "$atomic_state_machine_exact" "$prune_retired" "$journal_confirmed_count" "$([[ $epoch == 1 ]] && echo true || echo false)" "$generation_count" "$receipt_count" "$receipt_segments_verified" \
      "$duck_scratch_excluded" "$retained_prefix" "$checkpoint_included" "$processed_indexes" \
      "$deletion_indexes" "$retained_manifests" "$retained_jpegs" "$expected_sets" \
      "$expected_member_count" "$exact_retained_members" "$processed_expected" "$deletion_expected" "$member_count"
    ;;

  restore-drill)
    run=${1:-}; confirmation=${2:-}; expected_archive=${3:-}; expected_backup=${4:-}
    valid_run "$run" || fail 'Invalid restore-drill run ID.'
    [[ $run =~ ^[A-Za-z0-9_]{1,96}$ ]] || fail 'Restore-drill run ID must be SQL-identifier safe.'
    [[ $confirmation == "$run:DESTRUCTIVE-RESTORE" ]] ||
      fail 'Restore drill is destructive and requires the exact per-run confirmation token.'
    [[ $(env_value OSCAR_VERSION missing) == 3.11.0 &&
       $(env_value OSCAR_BACKUP_MODE disabled) == single ]] ||
      fail 'Restore drill requires OSCAR 3.11.0 with OSCAR_BACKUP_MODE=single.'
    for expected in "$expected_archive" "$expected_backup"; do
      [[ $expected == /* && $expected != / && $expected =~ ^/[A-Za-z0-9._/-]+$ ]] ||
        fail 'Restore drill requires two canonical acknowledged storage paths.'
    done
    archive_dir=$(canonical_directory "$(absolute_path "$(env_value OSCAR_ARCHIVE_DIR ../oscar-storage/archive)")")
    backup_dir=$(canonical_directory "$(absolute_path "$(env_value OSCAR_BACKUP_DIR ../oscar-storage/backups)")")
    [[ $archive_dir == "$expected_archive" && $backup_dir == "$expected_backup" ]] ||
      fail 'Restore storage planes do not exactly match the acknowledged archive/backup paths.'
    ! paths_overlap "$archive_dir" "$backup_dir" ||
      fail 'Restore archive and backup directories must be distinct, non-overlapping planes.'
    postgres_container=$(compose ps -q postgres)
    if docker inspect "$postgres_container" --format '{{range .Mounts}}{{println .Destination}}{{end}}' |
       grep -Fqx /var/lib/postgresql/wal-archive; then
      fail 'Restore drill refuses a PostgreSQL container with an external WAL archive mount.'
    fi
    archive_mode=$(scalar 'SHOW archive_mode;')
    archive_timeout=$(scalar 'SHOW archive_timeout;')
    archive_command=$(psql_admin --tuples-only --no-align --command 'SHOW archive_command;' | sed -e 's/[[:space:]]*$//' | tail -n1)
    [[ $archive_mode == off && $archive_timeout == 0 &&
       ( -z $archive_command || $archive_command == '(disabled)' ) ]] ||
      fail 'Restore drill requires inactive PostgreSQL WAL archiving.'

    marker="$run-before"; mutated="$run-after"; durable="$run-durable"
    state_relative="files/.restore-regression/$run.canary"
    archive_day=$(date -u +%F)
    archive_observations="$archive_dir/datasets/observations"
    archive_day_root="$archive_observations/date=$archive_day"
    archive_canary="$archive_day_root/profile=restore_$run"
    safety=''
    cleanup_new_restore_drill() {
      set +e
      psql_admin --command "DROP TABLE IF EXISTS oscar_restore_regression_$run;" >/dev/null 2>&1
      compose exec -T oscar sh -c 'rm -f -- "/var/lib/oscar/$1"; rmdir -- /var/lib/oscar/files/.restore-regression 2>/dev/null || true' cleanup "$state_relative" >/dev/null 2>&1
      rmdir -- "$archive_canary" "$archive_day_root" "$archive_observations" \
        "$archive_dir/datasets" 2>/dev/null || true
      set -e
    }
    trap cleanup_new_restore_drill EXIT
    psql_admin --command "CREATE TABLE oscar_restore_regression_$run (id integer PRIMARY KEY, marker text NOT NULL); INSERT INTO oscar_restore_regression_$run VALUES (1,'$marker');" >/dev/null
    compose exec -T oscar sh -eu -c 'path=/var/lib/oscar/$1; mkdir -p -- "${path%/*}"; printf "%s\n" "$2" >"$path"' restore-state "$state_relative" "$marker"
    for directory in "$archive_dir/datasets" "$archive_observations" "$archive_day_root" "$archive_canary"; do
      if [[ ! -e $directory && ! -L $directory ]]; then
        install -d -o 10001 -g 10001 -m 0750 -- "$directory"
      fi
      [[ -d $directory && ! -L $directory && $(stat -c '%u:%g' -- "$directory") == 10001:10001 ]] ||
        fail 'Restore archive canary hierarchy is unsafe.'
    done
    source_timeline=$(scalar 'SELECT timeline_id FROM pg_control_checkpoint();')
    output=$(sudo bash oscar.sh backup)
    backup=$(printf '%s' "$output" | sed -n 's#^Backup created: .*/##p' | tail -n1)
    [[ $backup =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] ||
      fail 'Restore drill backup did not return a canonical ID.'
    root="$backup_dir/$backup"
    [[ $(sed -n '3p' "$backup_dir/CURRENT") == "backup_id=$backup" &&
       $(awk -F'[: ,]+' '/"version"/ {print $3; exit}' "$root/epoch.json") == 2 &&
       ! -e $root/wal-archive.tar.gz && ! -L $root/wal-archive.tar.gz ]] ||
      fail 'Restore drill did not create the authenticated schema-v2 CURRENT snapshot.'
    sudo bash oscar.sh backup-verify "$backup" >/dev/null
    psql_admin --command "UPDATE oscar_restore_regression_$run SET marker='$mutated' WHERE id=1;" >/dev/null
    compose exec -T oscar sh -eu -c 'printf "%s\n" "$2" >"/var/lib/oscar/$1"' mutate-state "$state_relative" "$mutated"
    rmdir -- "$archive_canary" || fail 'Could not mutate the pre-backup archive canary.'
    restore_log=$(mktemp /tmp/oscar-regression-restore.XXXXXXXX)
    if ! sudo bash oscar.sh restore --backup "$backup" --confirm "$backup" >"$restore_log" 2>&1; then
      emit_command_diagnostics 'OSCAR self-contained restore' "$restore_log"
      rm -f -- "$restore_log"
      fail 'Supported self-contained restore failed.'
    fi
    safety=$(sed -n 's#^Restore complete. Pre-restore deployment credentials were preserved at ##p' "$restore_log" | tail -n1)
    rm -f -- "$restore_log"
    [[ $safety == "$release_dir/pre-restore-$backup" && -d $safety && ! -L $safety &&
       $(stat -c '%u:%g:%a' -- "$safety") == 0:0:700 &&
       -f $safety/.env && ! -L $safety/.env &&
       -d $safety/secrets && ! -L $safety/secrets && -d $safety/tls && ! -L $safety/tls &&
       -z $(find "$safety/.env" "$safety/secrets" "$safety/tls" -type l -print -quit) ]] ||
      fail 'Restore did not preserve its pre-restore credential safety copy.'
    pre_restore_safety_copy_verified=true
    database_restored=false
    [[ $(scalar "SELECT marker FROM oscar_restore_regression_$run WHERE id=1;") == "$marker" ]] && database_restored=true
    state_restored=false
    [[ $(compose exec -T oscar sh -c 'cat "/var/lib/oscar/$1"' read-state "$state_relative" | tr -d '\r\n') == "$marker" ]] && state_restored=true
    archive_restored=false
    [[ -d $archive_canary && ! -L $archive_canary ]] && archive_restored=true
    restored_timeline=$(scalar 'SELECT timeline_id FROM pg_control_checkpoint();')
    fresh_timeline=false
    [[ $source_timeline =~ ^[1-9][0-9]*$ && $restored_timeline =~ ^[1-9][0-9]*$ &&
       $restored_timeline -gt $source_timeline ]] && fresh_timeline=true
    recovery_settings_cleared=false
    if [[ $(scalar 'SELECT NOT pg_is_in_recovery();') == t ]] &&
       compose exec -T postgres sh -c 'test ! -e /var/lib/postgresql/data/recovery.signal && test ! -e /var/lib/postgresql/data/standby.signal'; then
      recovery_settings_cleared=true
    fi
    psql_admin --command "INSERT INTO oscar_restore_regression_$run VALUES (2,'$durable'); CHECKPOINT;" >/dev/null
    compose restart postgres >/dev/null
    compose up --detach --no-deps --no-build --pull never --wait --wait-timeout 300 postgres >/dev/null
    post_promotion_write_durable=false
    [[ $(scalar "SELECT marker FROM oscar_restore_regression_$run WHERE id=2;") == "$durable" ]] &&
      post_promotion_write_durable=true
    services_healthy=true
    for service in gateway oscar postgres; do
      container=$(compose ps -q "$service")
      [[ $container =~ ^[0-9a-f]{12,64}$ &&
         $(docker inspect "$container" --format '{{.State.Status}}') == running &&
         $(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}') == healthy ]] ||
        services_healthy=false
    done
    credentials_restored=false
    if $services_healthy && [[ -s $release_dir/.env && ! -L $release_dir/.env &&
         -d $release_dir/secrets && ! -L $release_dir/secrets &&
         -d $release_dir/tls && ! -L $release_dir/tls ]]; then
      credentials_restored=true
    fi
    archive_verified=false
    sudo bash oscar.sh archive verify >/dev/null 2>&1 && archive_verified=true
    sudo bash oscar.sh backup-verify "$backup" >/dev/null
    app_image=''
    while IFS= read -r candidate_image; do
      case $candidate_image in
        oscar:*) [[ -z $app_image ]] || fail 'Compose selects multiple OSCAR application images.'; app_image=$candidate_image ;;
      esac
    done < <(compose config --images)
    backup_key_file=$(absolute_path "$(env_value OSCAR_BACKUP_KEY_FILE ./secrets/backup-key.txt)")
    current="$backup_dir/CURRENT"
    [[ -n $app_image && -f $backup_key_file && ! -L $backup_key_file &&
       -f $current && ! -L $current && $(stat -c %u -- "$current") == 0 &&
       $(stat -c %a -- "$current") == 600 &&
       $(wc -l <"$current" | tr -d '[:space:]') == 4 &&
       $(sed -n '1p' "$current") == format=oscar-current-backup &&
       $(sed -n '2p' "$current") == version=1 &&
       $(sed -n '3p' "$current") == "backup_id=$backup" &&
       $(sed -n '4p' "$current") =~ ^hmac_sha256=[A-Za-z0-9+/]{43}=$ ]] ||
      fail 'Restored CURRENT pointer is missing, unsafe, or malformed.'
    current_expected=$(sed -n 's/^hmac_sha256=//p' "$current")
    current_actual=$(sudo docker run --rm --network none --read-only --cap-drop ALL \
      --security-opt no-new-privileges --user 0 --entrypoint sh \
      --volume "$current:/current:ro" --volume "$backup_key_file:/backup-key.txt:ro" \
      "$app_image" -eu -c '
        key=$(cat /backup-key.txt)
        head -n 3 /current | openssl dgst -sha256 -hmac "$key" -binary | openssl base64 -A
      ' | tr -d '\r\n')
    current_reverified=false
    [[ $current_actual == "$current_expected" ]] && current_reverified=true
    epoch_id=$(awk -F'"' '/"backupEpochId"/ {print $4; exit}' "$root/epoch.json")
    valid_uuid "$epoch_id" || fail 'Restored backup epoch UUID is invalid.'
    verified_epoch_restored=false
    [[ $(scalar "SELECT count(*) FROM oscar_backup_epoch WHERE id='$epoch_id' AND state='VERIFIED' AND manifest_path='$backup/epoch.json' AND verified_at IS NOT NULL;") == 1 ]] &&
      verified_epoch_restored=true
    cleanup_new_restore_drill
    trap - EXIT
    printf '{"backupId":"%s","schemaVersion":2,"databaseRestored":%s,"applicationStateRestored":%s,"archiveRestored":%s,"credentialsRestored":%s,"servicesHealthy":%s,"archiveVerified":%s,"freshTimeline":%s,"recoverySettingsCleared":%s,"verifiedEpochRestored":%s,"allCanariesRestored":%s,"authenticatedBackupReverified":%s,"currentAuthenticated":%s,"noExternalWalDependency":true,"walArchiveTarAbsent":true,"postPromotionWriteDurable":%s,"preRestoreSafetyCopyVerified":%s,"preRestoreSafetyDirectory":"%s"}\n' \
      "$backup" "$database_restored" "$state_restored" "$archive_restored" "$credentials_restored" "$services_healthy" \
      "$archive_verified" "$fresh_timeline" "$recovery_settings_cleared" "$verified_epoch_restored" \
      "$($database_restored && $state_restored && $archive_restored && echo true || echo false)" \
      "$current_reverified" "$current_reverified" "$post_promotion_write_durable" \
      "$pre_restore_safety_copy_verified" "$safety"
    ;;

  fixture-cleanup)
    run=${1:-}; valid_run "$run" || fail 'Invalid run ID.'; ensure_fixture_table
    while IFS= read -r fixture_hold; do
      [[ -n $fixture_hold ]] || continue
      valid_uuid "$fixture_hold" || fail 'Fixture cleanup found a malformed regression hold ID.'
      sudo bash oscar.sh archive hold release --id "$fixture_hold" --released-by oscar-regression-cleanup >/dev/null
    done < <(psql_admin --quiet --tuples-only --no-align --command "
      SELECT h.id::text FROM oscar_retention_hold h
      JOIN oscar_regression_fixture f ON f.run_id='$run'
      LEFT JOIN oscar_archive_generation g ON g.id=f.generation_id
      WHERE h.released_at IS NULL AND h.created_by='oscar-regression'
        AND h.store_key=g.store_key AND h.id_scope=g.id_scope
        AND ((h.subject_type='ARCHIVE_GENERATION' AND h.subject_id=f.generation_id::text
              AND h.reason='regression-$run')
          OR (h.subject_type='OBSERVATION' AND h.subject_id=f.cold_id::text
              AND h.reason='regression-observation-$run')
          OR (h.subject_type='OBSERVATION' AND h.subject_id=f.hot_id::text
              AND h.reason='regression-hot-$run'))
      ORDER BY h.id;")
    # Only registered hot/cold rows are touched. Catalog evidence from a purged
    # generation is deliberately retained for auditability.
    deleted=$(scalar "WITH f AS (DELETE FROM oscar_regression_fixture WHERE run_id='$run' RETURNING cold_ids,hot_id),
      d AS (DELETE FROM obs o USING f WHERE o.id=ANY(f.cold_ids) OR o.id=f.hot_id RETURNING 1)
      SELECT count(*) FROM d;")
    printf '{"fixtureRowsDeleted":%s}\n' "$deleted"
    ;;

  *) fail "Unknown storage probe action: $action" ;;
esac
