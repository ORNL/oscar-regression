import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import test from "node:test";

const probePath = resolve("scripts/oscar-storage-regression-probe.sh");
const probe = readFileSync(probePath, "utf8");
const scenarios = readFileSync(resolve("src/scenarios.ts"), "utf8");
const storageClient = readFileSync(resolve("src/storage-probe.ts"), "utf8");

function embeddedComposeShell(functionName: string, argumentZero: string): string {
  const functionStart = probe.indexOf(`${functionName}() {`);
  assert.ok(functionStart >= 0, `missing ${functionName}`);
  const marker = "compose exec -T oscar sh -eu -c '\n";
  const scriptStart = probe.indexOf(marker, functionStart);
  assert.ok(scriptStart >= 0, `missing embedded shell for ${functionName}`);
  const contentStart = scriptStart + marker.length;
  const contentEnd = probe.indexOf(`\n  ' ${argumentZero}`, contentStart);
  assert.ok(contentEnd >= 0, `missing embedded shell terminator for ${functionName}`);
  return probe.slice(contentStart, contentEnd);
}

function entrypointContractAccepts(entrypoint: string): boolean {
  const helper = probe.match(/^entrypoint_has_managed_tmp_contract\(\) \{\n[\s\S]*?^\}/mu)?.[0];
  assert.ok(helper, "missing entrypoint temp-contract helper");
  try {
    execFileSync("bash", ["-c", `set -Eeuo pipefail
${helper}
candidate=$(mktemp)
trap 'rm -f -- "$candidate"' EXIT
cat >"$candidate"
entrypoint_has_managed_tmp_contract "$candidate"`], {
      input: entrypoint,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function runProbeQueryHelpers(helperSource: string): string {
  return execFileSync("bash", ["-c", `set -Eeuo pipefail
psql_admin() {
  local quiet=false argument query
  for argument in "$@"; do [[ $argument == --quiet ]] && quiet=true; done
  query=\${!#}
  if [[ $query == *json* ]]; then printf '%s\\n' '{"ok":true}'
  else printf '%s\\n' '1'; fi
  $quiet || printf '%s\\n' 'UPDATE 1'
}
${helperSource}
scalar_value=$(scalar 'UPDATE fixture SET value=1 RETURNING 1')
json_value=$(json_query 'UPDATE fixture SET value=1 RETURNING json')
printf '%s\\t%s' "$scalar_value" "$json_value"`], {encoding: "utf8"});
}

function runHoldOutputParser(
  output: string,
  storeKey = "obs",
  idScope = "4",
  resolution = "GENERATION_EXACT",
): string {
  const validUuid = probe.match(/^valid_uuid\(\) \{[^\n]+\}$/mu)?.[0];
  const parser = probe.match(/^retention_hold_id_from_output\(\) \{\n[\s\S]*?^\}/mu)?.[0];
  assert.ok(validUuid && parser, "missing retention-hold output parser");
  return execFileSync("bash", ["-c", `set -Eeuo pipefail
${validUuid}
${parser}
retention_hold_id_from_output "$1" "$2" "$3" "$4"`,
  "hold-parser", output, storeKey, idScope, resolution], {
    encoding: "utf8",
  });
}

function structuralStorageFixtureAccepted(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const object = (candidate: unknown): candidate is Record<string, unknown> =>
    Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate);
  const exactly = (className: string) => value.filter(candidate =>
    object(candidate) && candidate.objClass === className);
  const daily = exactly("com.botts.impl.service.dailyfile.DailyFileJournalServiceConfig");
  const oscar = exactly("com.botts.impl.service.oscar.OSCARServiceConfig");
  const databases = exactly("org.sensorhub.impl.database.system.SystemDriverDatabaseConfig");
  if (daily.length !== 1 || oscar.length !== 1 || databases.length !== 1) return false;
  const media = object(oscar[0]!.videoRetentionConfig) ? oscar[0]!.videoRetentionConfig : undefined;
  const db = object(databases[0]!.dbConfig) ? databases[0]!.dbConfig : undefined;
  const archive = object(db) && object(db.archive) ? db.archive : undefined;
  return object(media) && object(db) && object(archive) &&
    typeof media.enableFrameRetention === "boolean" &&
    typeof media.frameRetentionCount === "number" &&
    typeof db.useBatch === "boolean" && db.useBatch === true &&
    archive.storageMode === "PARQUET_PRIMARY" &&
    typeof archive.parquetPrimaryArchiveDelayMinutes === "number" &&
    typeof archive.immutableStageWindowMinutes === "number" &&
    typeof archive.maximumFuturePhenomenonSkewMinutes === "number" &&
    typeof archive.parquetPrimaryIntervalMinutes === "number" &&
    typeof archive.maximumStagePartitionsPerCycle === "number" &&
    typeof archive.maximumGenerationsPerCycle === "number" &&
    typeof archive.maximumVerificationsPerCycle === "number" &&
    typeof archive.maximumDeletionsPerCycle === "number" &&
    Array.isArray(archive.outputNames) && archive.outputNames.length === 5 &&
    typeof archive.hotRetentionDays === "number" &&
    typeof archive.deleteHotAfterArchive === "boolean" &&
    typeof daily[0]!.maxSegmentBytes === "number";
}

test("query helpers suppress DML command tags before parsing scalar and JSON rows", () => {
  const scalarHelper = probe.match(/^scalar\(\) \{[^\n]+\}$/mu)?.[0];
  const jsonHelper = probe.match(/^json_query\(\) \{[^\n]+\}$/mu)?.[0];
  assert.ok(scalarHelper && jsonHelper, "missing storage query helpers");
  const helpers = `${scalarHelper}\n${jsonHelper}`;
  assert.match(scalarHelper, /psql_admin --quiet --tuples-only --no-align/);
  assert.match(jsonHelper, /psql_admin --quiet --tuples-only --no-align/);
  assert.match(scalarHelper, /<\/dev\/null/);
  assert.match(jsonHelper, /<\/dev\/null/);
  assert.equal(runProbeQueryHelpers(helpers), '1\t{"ok":true}');

  const legacyHelpers = helpers.replaceAll(" --quiet", "");
  assert.equal(runProbeQueryHelpers(legacyHelpers), "1UPDATE1\tUPDATE 1");
});

test("retention-hold parser accepts the canonical scoped CLI line and rejects ambiguity", () => {
  const id = "ee6dda6f-af28-4f9c-951f-97b80c231cd5";
  const canonical = `Retention hold created: ${id} (store=obs, id-scope=4, resolution=GENERATION_EXACT)`;
  assert.equal(runHoldOutputParser(`administrative preface\n${canonical}\n`), id);
  assert.throws(() => runHoldOutputParser(canonical, "other_store", "4"));
  assert.throws(() => runHoldOutputParser(canonical, "obs", "5"));
  assert.throws(() => runHoldOutputParser(canonical, "obs", "4", "HOT_EXACT"));
  assert.throws(() => runHoldOutputParser(`Retention hold created: ${id}`));
  assert.throws(() => runHoldOutputParser(
    `Retention hold created: ${id} (store=obs, id-scope=4, resolution=UNKNOWN)`,
  ));
  assert.throws(() => runHoldOutputParser(
    `Retention hold created: ${id} (store=obs, id-scope=4, resolution=LEGACY_UNKNOWN)`,
  ));
  assert.throws(() => runHoldOutputParser(`${canonical}\n${canonical}`));
  assert.throws(() => runHoldOutputParser(canonical.toUpperCase()));
});

test("shell UUID validation enforces canonical version and variant bits", () => {
  const helper = probe.match(/^valid_uuid\(\) \{[^\n]+\}$/mu)?.[0];
  assert.ok(helper);
  const accepted = execFileSync("bash", ["-c", `set -Eeuo pipefail
${helper}
valid_uuid "$1"
printf accepted`, "uuid", "123e4567-e89b-42d3-a456-426614174000"], {encoding: "utf8"});
  assert.equal(accepted, "accepted");
  for (const value of [
    "123E4567-E89B-42D3-A456-426614174000",
    "123e4567-e89b-02d3-a456-426614174000",
    "123e4567-e89b-42d3-7456-426614174000",
    "00000000-0000-0000-0000-000000000000",
  ]) assert.throws(() => execFileSync("bash", ["-c", `${helper}; valid_uuid "$1"`, "uuid", value]));
});

test("storage probe remains valid Bash and gates exact 3.9.2 image identity", () => {
  assert.doesNotThrow(() => execFileSync("bash", ["-n", probePath]));
  for (const required of [
    "expected_release=3.11.0",
    "org.opencontainers.image.version",
    "com.botts.oscar.storage-profile",
    "nginxinc/nginx-unprivileged:",
    "containerImageId",
    "repoDigests",
    "oscar-storage-profile",
  ]) assert.ok(probe.includes(required), `missing probe identity contract: ${required}`);
  assert.match(probe, /docker compose --project-name oscar --env-file \.env --file compose\.yaml/);
  assert.match(probe, /env -u OSCAR_ARCHIVE_DIR/);
  assert.doesNotMatch(probe, /lock_directory=\$\{OSCAR_STORAGE_LOCK_DIR/);
});

test("DuckDB scratch health and restart inventories are valid target POSIX shell", () => {
  for (const [functionName, argumentZero, hereDocument] of [
    ["archive_scratch_json", "scratch-health", "OSCAR_SCRATCH_CLASSIFIER"],
    ["archive_scratch_inventory", "scratch-inventory", "OSCAR_SCRATCH_CHILD"],
  ] as const) {
    const embedded = embeddedComposeShell(functionName, argumentZero);
    assert.doesNotThrow(
      () => execFileSync("sh", ["-n"], {input: embedded, stdio: ["pipe", "pipe", "pipe"]}),
      `${functionName} must parse under the same POSIX sh used in the OSCAR container`,
    );
    const payloadStartMarker = `<<\\${hereDocument}\n`;
    const payloadStart = embedded.indexOf(payloadStartMarker);
    const payloadEnd = embedded.indexOf(`\n${hereDocument}\n`, payloadStart + payloadStartMarker.length);
    assert.ok(payloadStart >= 0 && payloadEnd > payloadStart, `missing ${hereDocument}`);
    const payload = embedded.slice(payloadStart + payloadStartMarker.length, payloadEnd);
    assert.doesNotThrow(
      () => execFileSync("sh", ["-n"], {input: payload, stdio: ["pipe", "pipe", "pipe"]}),
      `${hereDocument} must parse under the same POSIX sh used in the OSCAR container`,
    );
  }
});

test("alarm-media probe scopes a no-replace baseline and removes every temporary marker", () => {
  const start = probe.indexOf("  alarm-media-baseline)");
  const end = probe.indexOf("  platform)", start);
  const block = probe.slice(start, end);
  assert.ok(start > 0 && end > start, "missing alarm-media probe actions");
  for (const required of [
    "alarm-media-baseline)",
    "alarm-media-cleanup)",
    "alarm-media-source-status)",
    "alarm-media-ledger)",
    "alarm-media-forensics)",
    "alarm_all_camera_artifacts",
    "baseline-final",
    "baseline-partial",
    "new-final",
    "newFinalizedOrphans",
    "newPartialArtifacts",
    "expectedAlreadyPresentAtBaseline",
  ]) assert.ok(block.includes(required), `missing alarm-media forensic contract: ${required}`);
  assert.match(block, /ln -- "\$marker_tmp" "\$marker"/);
  assert.doesNotMatch(block, /mv -- "\$marker_tmp" "\$marker"/);
  assert.match(block, /chmod 600 "\$marker_tmp"/);
  assert.match(block, /version\\t2/);
  assert.match(block, /file_owner_id "\$marker"/);
  assert.match(block, /file_mode "\$marker"/);
  assert.match(block, /cut -d\/ -f3 "\$forensic_tmp\/expected"/);
  assert.match(block, /camera\[path\[3\]\]/);
  assert.match(block, /comm -13 "\$forensic_tmp\/baseline-final" "\$forensic_tmp\/current-final"/);
  assert.match(block, /rm -f -- "\$marker"/);
  assert.match(block, /trap cleanup_alarm_baseline EXIT/);
  assert.match(block, /trap cleanup_alarm_forensics EXIT/);
  assert.match(block, /printf "MISSING\\\\n"/);
  assert.match(block, /printf '\{"exists":true,"ledger":%s\}\\n'/);
  assert.doesNotMatch(block, /printf "\{\\\\"exists/);
  assert.match(probe, /-g\[1-9\]\[0-9\]\*\\\.mp4/);
});

test("generated alarm-media scenario binds public observations, MP4 metadata, manifests, and ledgers", () => {
  const start = scenarios.indexOf("private async configuredAlarmCameraUids");
  const end = scenarios.indexOf("private storageUnavailable", start);
  const block = scenarios.slice(start, end);
  assert.ok(start > 0 && end > start, "missing generated alarm-media scenario coverage");
  for (const required of [
    "/sensorhub/api/observations/",
    "/sensorhub/api/systems?searchMembers=true",
    "cameraUidsForSystemComponents",
    "laneUidForSystemName",
    "assessAlarmVideoObservation",
    "assertAlarmVideoAssociationUnique",
    "loadedmetadata",
    "alarm-media-source-status",
    "/sensorhub/buckets/videos/media/",
    "assessRetainedMediaResponse",
    "sourceByCamera.get(mediaSet.cameraUid) !== mediaSet.sourceObjectKey",
    "mediaSet.laneUid !== expectedLaneUid",
    "alarm-media-ledger",
    'ledger.attempts === 1',
    'ledger.failure === ""',
    "alarm-media-forensics",
    "alarmMediaForensicsPassed",
  ]) assert.ok(block.includes(required), `missing generated alarm-media assertion: ${required}`);
  const metadataBlock = block.slice(block.indexOf("private async browserMp4Metadata"),
    block.indexOf("private async captureAlarmMedia"));
  assert.doesNotMatch(metadataBlock, /const finish\s*=/,
    "browser-evaluated callbacks must not capture the tsx __name helper");
  assert.match(block, /Buffer\.from\(item\.association\.eventId, "utf8"\)\.toString\("base64url"\)/);
  assert.match(block, /generated\.flatMap\(item =>[\s\S]*item\.association\.paths/);
  assert.doesNotMatch(block, /new Set\(generated\.flatMap/);
  assert.match(block, /"alarm-media-baseline", \[this\.alarmMediaRunKey\(\)\]\)/);
  assert.match(block, /if \(!this\.selected\("storage-lifecycle"\)/);
  assert.doesNotMatch(block, /baselineCreated:[\s\S]{0,120}cameras:/);
  assert.doesNotMatch(block, /originalRpmConfig\?\.camera_ids/);
});

test("storage probe client registers privileged alarm baseline cleanup before an uncertain remote outcome", () => {
  const client = storageClient;
  const register = client.indexOf(
    'if (action === "alarm-media-baseline" && alarmRun) this.alarmBaselineRuns.add(alarmRun)',
  );
  const remote = client.indexOf('await execFileAsync("ssh"', register);
  assert.ok(register > 0 && remote > register);
  const cleanup = client.slice(client.indexOf("async cleanup(): Promise<void>"));
  assert.match(cleanup, /for \(const run of this\.alarmBaselineRuns\)/);
  assert.match(cleanup, /"sudo", "-n", "bash", this\.remoteScript/);
  assert.match(cleanup, /"alarm-media-cleanup", run/);
  assert.match(cleanup, /baselineCleanupError \?\?= error/);
  assert.match(cleanup, /Unable to remove a privileged alarm-media baseline marker/);
  assert.match(cleanup, /removeRemoteWorkspace/);
  assert.doesNotMatch(cleanup, /rm -f -- \/tmp\/oscar-alarm-media/);
  assert.match(cleanup, /this\.alarmBaselineRuns\.clear\(\)/);
});

test("stage ownership witness receives the archive deadline plus a bounded transport margin", () => {
  const run = storageClient.slice(
    storageClient.indexOf("async runJson<T>"),
    storageClient.indexOf("async cleanup(): Promise<void>"),
  );
  assert.match(run, /action === "stage-lifecycle-witness"/);
  assert.match(run, /this\.config\.storageArchiveTimeoutMs \+ 60_000/);
  assert.match(run, /Math\.max\([\s\S]*this\.config\.storageProbeTimeoutMs/);
});

test("restore control state is pre-armed, descendant-aware, and fail-closed", () => {
  const state = storageClient.slice(
    storageClient.indexOf("private async waitForRestoreTermination"),
    storageClient.indexOf("private async restoreCommand"),
  );
  const wrapper = storageClient.slice(
    storageClient.indexOf("private async restoreCommand"),
    storageClient.indexOf("async install()"),
  );
  for (const required of [
    '[ -e \\"$control_path\\" ] || [ -L \\"$control_path\\" ]',
    "0:0:600",
    "ready + active + cancelled",
    'mv -T -- \\"$ready_path\\" \\"$cancelled_path\\"',
    "complete:%s",
    "ps -eo pid=,pgid=,sid=",
    "$2 == pgid || $3 == sid",
  ]) assert.ok(state.includes(required), `missing fail-closed restore state contract: ${required}`);
  assert.doesNotMatch(state, /not-started/);
  assert.ok(state.indexOf("ps -eo pid=,pgid=,sid=") < state.lastIndexOf("complete:%s"),
    "terminal status must not outrank exact session-member discovery");
  for (const required of [
    "oscar-storage-restore-arm",
    "not-launched",
    'mv -T -- \\"$ready_path\\" \\"$active_path\\"',
    "setsid --fork --wait",
    "wait_for_session_quiet",
    "trap finalize_wrapper EXIT",
    "publish_status",
  ]) assert.ok(wrapper.includes(required), `missing restore wrapper lifecycle contract: ${required}`);
  assert.ok(wrapper.indexOf("mv -fT --") < wrapper.indexOf('exec \\"${command[@]}\\"'),
    "session identity must be published before the product restore can execute");
});

test("platform probe binds roots, the stable lock, and exact helper provenance and behavior", () => {
  const block = probe.slice(probe.indexOf("  platform)"), probe.indexOf("  snapshot)"));
  for (const required of [
    "OSCAR_DEPLOYMENT_ID",
    "OSCAR_BACKUP_MODE",
    "archive_identity",
    "backup_identity",
    "/run/lock/oscar-storage",
    "$deployment_id.lock",
    "Another OSCAR storage administration command is already running.",
    "/usr/local/bin/oscar-archive-object",
    "/usr/local/bin/oscar-prepare-restore",
    "/usr/local/bin/oscar-atomic-publish",
    "/usr/local/share/oscar-atomic-publish.source.sha256",
    "archive_command_inactive",
    "external_wal_mount_absent",
    "legacyWalArchive",
    "packagedSha256",
    "deployedSha256",
    "archive_export_helper_wired",
    "archive_purge_helper_wired",
    "cliExportIntegrated",
    "cliPurgeIntegrated",
    "packagedSourceSha256",
    "deployedSourceSha256",
    "deployedBinarySha256",
    "collisionRejected",
    "sourcePreserved",
    "destinationPreserved",
    "appBackupRootAbsent",
    "postgresBackupRootAbsent",
    "isolatedBasebackupWired",
  ]) assert.ok(block.includes(required), `missing platform hardening contract: ${required}`);
  assert.match(block, /archive_object_helper copy "\\\$relative" "\\\$expected_sha" ro "\\\$partial"/);
  assert.match(block,
    /archive_object_helper delete "\\\$relative" "\\\$expected_sha" rw <\/dev\/null/);
  assert.match(block, /oscar-atomic-publish "\$root" source published/);
  assert.match(block, /oscar-atomic-publish "\$root" challenger published/);
  assert.match(block, /test "\$status" -ne 0/);
  assert.match(block, /--network "container:\$postgres_container"/);
  assert.match(block, /--volume "\$work\/postgres:\/backup"/);
  assert.match(block, /grep -Fqx \/var\/lib\/oscar\/backups/);
  assert.match(block, /grep -Fqx \/var\/lib\/postgresql\/backups/);
  for (const required of [".oscar-storage-root", "format=oscar-storage-root-identity", "version=1",
    "root_kind=$expected_kind"]) {
    assert.ok(probe.includes(required), `missing root-marker contract: ${required}`);
  }
  assert.match(block, /archive_mode=\$\(scalar 'SHOW archive_mode;'\)/);
  assert.match(block, /archive_timeout=\$\(scalar 'SHOW archive_timeout;'\)/);
});

test("platform probe verifies the live split native and untrusted-data temp contract", () => {
  const block = probe.slice(probe.indexOf("  platform)"), probe.indexOf("  snapshot)"));
  for (const required of [
    "/proc/self/mountinfo",
    "packaged_entrypoint=docker/oscar/entrypoint.sh",
    "/usr/local/bin/oscar-entrypoint",
    "packagedEntrypointSha256",
    "deployedEntrypointSha256",
    "containerEntrypointExact",
    "managedPropertiesAfterJavaOpts",
    "native_path=/run/oscar-native",
    "mount_has_option /tmp noexec",
    'mount_has_option "$native_path" noexec',
    'stat -c "%u:%g:%a" "$native_path"',
    'stat -f -c "%S:%b" "$native_path"',
    'cp /bin/true "$exec_probe"',
    'readlink "$process/exe"',
    '-Djava.io.tmpdir=*',
    '-Dorg.bytedeco.javacpp.cachedir=*',
    '-Doscar.data.tmpdir=*',
    'effective_java_tmp=${argument#-Djava.io.tmpdir=}',
    'effective_javacpp_cache=${argument#-Dorg.bytedeco.javacpp.cachedir=}',
    'effective_data_tmp=${argument#-Doscar.data.tmpdir=}',
    '"nativeRuntime"',
    '"nativeNoexecAbsent"',
    '"nativeSizeBytes"',
    '"javaTmpPropertyCount"',
    '"javaCppCachePropertyCount"',
    '"dataTmpPropertyCount"',
  ]) assert.ok(block.includes(required), `missing live JVM temp contract: ${required}`);
  assert.match(block, /rm -f -- "\$exec_probe"/);
  assert.ok(!block.includes('mount_has_option "$native_path" exec'));
});

test("entrypoint contract requires one managed property tail after JAVA_OPTS", () => {
  const valid = `NATIVE_TMP_DIR=/run/oscar-native
readonly NATIVE_TMP_DIR
exec java \${JAVA_OPTS:-} \\
  -Djava.io.tmpdir="\${NATIVE_TMP_DIR}" \\
  -Dorg.bytedeco.javacpp.cachedir="\${NATIVE_TMP_DIR}/javacpp" \\
  -Doscar.data.tmpdir=/tmp \\
  com.example.Main
`;
  assert.equal(entrypointContractAccepts(valid), true);
  assert.equal(entrypointContractAccepts(valid.replace(
    "exec java ${JAVA_OPTS:-} \\\n  -Djava.io.tmpdir=\"${NATIVE_TMP_DIR}\"",
    "-Djava.io.tmpdir=\"${NATIVE_TMP_DIR}\" \\\nexec java ${JAVA_OPTS:-}",
  )), false);
  assert.equal(entrypointContractAccepts(valid.replace(
    "-Dorg.bytedeco.javacpp.cachedir=\"${NATIVE_TMP_DIR}/javacpp\" \\\n  -Doscar.data.tmpdir=/tmp",
    "-Doscar.data.tmpdir=/tmp \\\n  -Dorg.bytedeco.javacpp.cachedir=\"${NATIVE_TMP_DIR}/javacpp\"",
  )), false);
  assert.equal(entrypointContractAccepts(valid.replace(
    "  -Dorg.bytedeco.javacpp.cachedir=\"${NATIVE_TMP_DIR}/javacpp\" \\\n",
    "",
  )), false);
  assert.equal(entrypointContractAccepts(valid.replace(
    "  -Doscar.data.tmpdir=/tmp \\",
    "  -Doscar.data.tmpdir=/tmp \\\n  -Doscar.data.tmpdir=/tmp \\",
  )), false);
});

test("platform config uses structural JSON extraction and rejects decoys, duplicates, and type mismatch", () => {
  const block = probe.slice(probe.indexOf("  platform)"), probe.indexOf("  snapshot)"));
  const helper = probe.match(/^platform_config_fields\(\) \{\n[\s\S]*?^\}/mu)?.[0];
  assert.ok(helper, "missing structural config helper");
  const configContract = `${helper}\n${block}`;
  for (const required of [
    "json_array_elements", "json_each", "json_typeof", "WITH ORDINALITY",
    "count(*) FROM candidates WHERE kind = 'daily'", "count(*) FROM candidates WHERE kind = 'oscar'",
    "count(*) FROM candidates WHERE kind = 'database'", "GROUP BY key HAVING count(*) <> 1",
    "OscarTieredObsSystemDatabaseConfig", "useBatch", "videoRetentionConfig",
  ]) assert.ok(helper.includes(required), `missing structural config contract: ${required}`);
  assert.doesNotMatch(block, /config_text_matches|daily_config_text|oscar_config_text/);
  assert.doesNotMatch(block, /sed -n 's\/\.\*"(?:intervalMinutes|frameRetentionCount|maxSegmentBytes)/);
  for (const field of [
    "timeToRetention", "videoQueryPeriod", "maximumCatchUpHours", "lateArrivalOverlapHours",
    "lateArrivalScanPeriodMinutes", "lateArrivalCatchUpHours", "reconciliationCatchUpHours",
    "reconciliationPeriodHours", "occupancyStreamRefreshMinutes",
    "enableFrameRetention", "frameRetentionCount", "jpegQuality",
    "sourceRollbackGraceHours", "maintenanceWorkLimit", "metadataReclamationWorkLimit",
    "duckDbMemoryLimitMegabytes", "duckDbThreads", "duckDbMaximumTemporaryMegabytes",
    "duckDbMaximumConcurrentSessions", "duckDbSessionAcquireTimeoutSeconds",
    "duckDbTemporaryDirectory", "archiveResources", "schemaChecksum", "archiveScratch",
    "archiveEnabled", "storageMode", "PARQUET_PRIMARY", "parquetPrimaryArchiveDelayMinutes",
    "immutableStageWindowMinutes", "maximumFuturePhenomenonSkewMinutes",
    "parquetPrimaryIntervalMinutes", "maximumStagePartitionsPerCycle",
    "maximumGenerationsPerCycle", "maximumVerificationsPerCycle", "maximumDeletionsPerCycle",
    "outputNames", "observationIndexes", "genericPayloadGinAbsent", "obs_data_idx",
    "obs_result_path_ops_idx", "numericEventIndexesExact",
    "hotRetentionDays", "packagedDefaults", "/opt/oscar/config.json",
    "dailyJournal", "rootDirectory", "journalDirectory", "publicationDirectory",
    "dailyFileObservationMode", "fsyncIntervalMillis", "maxUnforcedRecords", "maxUnforcedBytes",
    "maxSegmentBytes", "maxSegmentAgeSeconds", "maxRecordBytes", "sealedJournalRetentionDays",
    "requireBackupBeforeSealedJournalDeletion",
    "delegateObservationLifecycleToDatabase", "dailyFilePurgeWorkLimit",
  ]) assert.ok(configContract.includes(field), `missing bounded-storage preflight field: ${field}`);
  assert.match(block, /config=\/var\/lib\/oscar\/config[.]json/);
  assert.match(block, /test -f "\$path" && test ! -L "\$path"/);
  assert.match(block, /size.*-le 16777216/);
  assert.match(block, /WHERE version=5/);
  assert.match(block, /archive_scratch_json "\$duck_temp_dir" \/var\/lib\/oscar\/archive/);

  const daily = {objClass: "com.botts.impl.service.dailyfile.DailyFileJournalServiceConfig",
    moduleClass: "com.botts.impl.service.dailyfile.DailyFileJournalService", maxSegmentBytes: 67_108_864};
  const oscar = {objClass: "com.botts.impl.service.oscar.OSCARServiceConfig",
    moduleClass: "com.botts.impl.service.oscar.OSCARServiceModule",
    videoRetentionConfig: {enableFrameRetention: true, frameRetentionCount: 5}};
  const database = {objClass: "org.sensorhub.impl.database.system.SystemDriverDatabaseConfig",
    moduleClass: "org.sensorhub.impl.database.system.SystemDriverDatabase",
    dbConfig: {objClass: "org.sensorhub.impl.datastore.postgis.database.OscarTieredObsSystemDatabaseConfig",
      useBatch: true, archive: {storageMode: "PARQUET_PRIMARY",
        parquetPrimaryArchiveDelayMinutes: 5, immutableStageWindowMinutes: 30,
        maximumFuturePhenomenonSkewMinutes: 5, parquetPrimaryIntervalMinutes: 1,
        maximumStagePartitionsPerCycle: 8, maximumGenerationsPerCycle: 2,
        maximumVerificationsPerCycle: 2, maximumDeletionsPerCycle: 2,
        outputNames: ["gammaCounts", "gammaThreshold", "neutronCounts", "setupGamma", "setupNeutron"],
        hotRetentionDays: 2, deleteHotAfterArchive: true}}};
  const valid = [daily, oscar, database];
  assert.equal(structuralStorageFixtureAccepted(valid), true);
  assert.equal(structuralStorageFixtureAccepted([
    {objClass: "decoy", frameRetentionCount: 999, deleteHotAfterArchive: true}, ...valid,
  ]), true, "an unrelated decoy cannot supply scoped values");
  assert.equal(structuralStorageFixtureAccepted([...valid, structuredClone(daily)]), false,
    "a duplicate expected module must fail");
  const wrongType = structuredClone(valid);
  (wrongType[1] as typeof oscar).videoRetentionConfig.frameRetentionCount = "5" as unknown as number;
  assert.equal(structuralStorageFixtureAccepted(wrongType), false,
    "a shape-compatible string cannot satisfy a numeric storage field");
  assert.ok(block.includes("AND query ~ '[)][[:space:]]*,[[:space:]]*[(]'"));
  assert.match(block, /SELECT oid AS dbid FROM pg_database WHERE datname = current_database\(\)/);
  assert.match(block, /JOIN current_db USING \(dbid\)/);
  assert.match(block, /\$batch_rows -gt \$batch_calls/);
  assert.doesNotMatch(block, /reWriteBatchedInserts|OscarTieredObsSystemDatabase\|/);
});

test("archive health aggregates generations independently from archive objects", () => {
  const block = probe.slice(probe.indexOf("  archive-health)"), probe.indexOf("  journal-status)"));
  assert.match(block, /WITH generations AS/);
  assert.match(block, /objects AS/);
  assert.match(block, /incomplete AS/);
  assert.doesNotMatch(block, /FROM oscar_archive_generation g LEFT JOIN oscar_archive_object/);
  assert.match(block, /archivePartialArtifacts/);
  assert.match(block, /walPartialArtifacts/);
  assert.equal(block.match(/'activeHolds'/g)?.length, 1, "archive-health JSON must contain activeHolds once");
});

test("storage gates require the shipped Parquet-primary policy and fresh index catalog", () => {
  const storageStart = scenarios.indexOf("private async storageHealth");
  const storageEnd = scenarios.indexOf("private async storageRestoreDrill", storageStart);
  const block = scenarios.slice(storageStart, storageEnd);
  for (const required of [
    'storageMode: "PARQUET_PRIMARY"',
    "parquetPrimaryArchiveDelayMinutes: 5",
    "immutableStageWindowMinutes: 30",
    "maximumFuturePhenomenonSkewMinutes: 5",
    "parquetPrimaryIntervalMinutes: 1",
    "maximumStagePartitionsPerCycle: 8",
    "archiveIntervalMinutes: 60",
    "rollbackGraceDays: 3",
    "maximumGenerationsPerCycle: 2",
    "maximumVerificationsPerCycle: 2",
    "maximumDeletionsPerCycle: 2",
    '"gammaCounts"', '"gammaThreshold"', '"neutronCounts"', '"setupGamma"', '"setupNeutron"',
    '"speed"', '"backgroundReport"', '"foregroundReport"', '"status"',
    '"emlContextual"', '"emlScanContextual"', '"emlAnalysis"',
    "REGRESSION_ARCHIVE_POLICY", "PARQUET_PRIMARY_OUTPUT_NAMES",
    "genericPayloadGinAbsent", "requiredPresent === indexes.requiredCount",
    "eventPathGinExact", "numericEventIndexesExact", "assessImmutableStageHealth",
    "immutableStageHealthIsSafe",
  ]) assert.ok(block.includes(required) || scenarios.includes(required),
    `missing Parquet-primary release gate: ${required}`);
  assert.doesNotMatch(block, /rollbackGraceDays:\s*1[\s\S]{0,100}SHIPPING_STORAGE_POLICY/);
});

test("stage health is read-only, mode-aware, and reports exact short-stage invariants", () => {
  const block = probe.slice(probe.indexOf("  stage-health)"), probe.indexOf("  archive-health)"));
  for (const required of [
    "PARQUET_PRIMARY", "HOT_RETENTION", "attachedChildCount", "detachedChildCount",
    "received_at", "stagingSloSeconds\":3600", "exactSidecarOwnerCount",
    "attachedUnownedRowCount", "detachedUnownedRowCount", "orphanRegistryOwnerCount",
    "orphanGenerationOwnerCount", "ownersMissingPhysicalRowCount", "archivegenerationid IS NOT NULL",
    "markerNonNullRowCount", "parentImmutableRowCount", "ONLY obs", "route.immutable",
    "missingRelationCount", "inheritanceMismatchCount", "sampleConsistent",
    "relpersistence='p'", "extract(epoch FROM window_start)::bigint % ($stage_window*60)=0",
  ]) assert.ok(block.includes(required), `missing immutable-stage health field: ${required}`);
  assert.doesNotMatch(block, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/);
});

test("primary lifecycle samples natural whole-child retirement without product mutation", () => {
  const block = probe.slice(
    probe.indexOf("  stage-lifecycle-select)"), probe.indexOf("  fixture-create)"));
  for (const required of [
    "Stage lifecycle selection requires PARQUET_PRIMARY", "state='ATTACHED'",
    "window_end<=clock_timestamp()", "make_interval(mins=>$archive_delay)", "received_at",
    "relpersistence='p'", "extract(epoch FROM window_start)::bigint % ($stage_window*60)=0",
    "oscar_obs_stage_owner", "archivegenerationid IS NOT NULL",
    "stage-lifecycle-witness)", "LOCK TABLE $child_table IN ACCESS SHARE MODE",
    "unowned_stage_rows=0", "missing_physical_owners=0",
    "fullOwnershipObserved", "ownerGenerationCount", "invalidOwnerGenerationCount",
    "ownerGenerationRowCount", "generationIds", "pg_sleep(0.1)",
    "stage-lifecycle-status)", "oscar_archive_id_block", "oscar_archive_schema",
    "generation.state IN ('ACTIVE','SEALED')", "parityVerified", "generationRowCount",
    "windowGenerations", "nonSealedGenerationCount", "profile='RAW_GATED'",
    "pg_inherits", "coldHotPresent", "sampleConsistent", "stage-lifecycle-hot)",
    "partition.state='ATTACHED'", "observation.tableoid",
  ]) assert.ok(block.includes(required), `missing read-only whole-child probe: ${required}`);
  assert.doesNotMatch(block, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/);
});

test("journal status validates exact bounded v1 manifests and direct lane state", () => {
  const block = probe.slice(probe.indexOf("  journal-status)"), probe.indexOf("  journal-restart)"));
  for (const required of [
    "total", "100000", "manifest_size", "1048576", "manifest_encoded",
    "json_object_keys(raw))=12", "OSCAR_LEGACY_DAILY_CSV", "checksumAlgorithm", "SHA-256",
    "windowStartInclusive", "windowEndExclusive", "dataFile", "publishedAt", "unsafeLinks",
    "unsafeEntries",
    "bounded", "journal-lane-state)", "urn:osh:system:lane:", "directory_id",
    "sha256sum | cut -c1-12", "lane.id", "-mindepth 2 -maxdepth 2",
    "openSegments", "sealedSegments", "unsafeEntries", "journal-metadata.v1.json",
    "eligiblePriorDayDirectories", "currentDayDirectories", "currentDayOpenSegments",
    "currentDaySealedSegments", "currentDayBytes", "journalIntegrityFailures",
    "444a4e4c00000001", "journal_zone", "journal_today", "lifecycleIndexVersion",
  ]) assert.ok(block.includes(required), `missing direct-journal validation contract: ${required}`);
  assert.match(block, /json_object_keys\(raw\)\)=3/);
  assert.match(block, /value->'lifecycleIndexVersion'='1'::jsonb/);
  assert.ok(block.includes(
    "^/var/lib/oscar/files/dailyfiles/[A-Za-z0-9._-]+-[0-9a-f]{12}_[0-9]{4}",
  ));
  assert.ok(block.includes(
    "value->>'dataFile' ~ '^[A-Za-z0-9._-]+-[0-9a-f]{12}_[0-9]{4}",
  ));
  const publicationPattern = block.match(/\[\[ ! \$manifest =~ (\^[^ ]+) \]\]/u)?.[1];
  assert.ok(publicationPattern, "missing executable flat publication-path pattern");
  const canonicalManifest =
    "/var/lib/oscar/files/dailyfiles/Lane50-0123456789ab_2026-10-18.csv.manifest.v1.json";
  execFileSync("bash", ["-c", `[[ $1 =~ ${publicationPattern} ]]`, "manifest-path", canonicalManifest]);
  assert.throws(() => execFileSync("bash", ["-c", `[[ $1 =~ ${publicationPattern} ]]`,
    "manifest-path", "/var/lib/oscar/files/dailyfiles/Lane50/2026-10-18.csv.manifest.v1.json"]));
  assert.match(block, /-name "[*][.]partial[.]\*"/);
  assert.match(block, /\(value->>'recordCount'\)::bigint=\$actual_records/);
  assert.match(block, /\(value->>'byteCount'\)::bigint=\$actual_bytes/);
  assert.match(block, /value->>'sha256'='\$actual_sha'/);
  assert.match(block, /value->>'dataFile'='\$csv_name'/);
  assert.match(block, /'\$csv_day'::date::timestamp AT TIME ZONE '\$journal_zone'/);
  assert.match(block, /publishedAt'\)::timestamptz >=/);
  assert.match(block, /mapfile -t manifest_paths/);
  assert.match(block, /for manifest in "\$\{manifest_paths\[@\]\}"/);
  assert.doesNotMatch(block, /for manifest in \$\(find/);
  assert.match(block, /awk -v today="\$today" "\\\$0 ~ \/\^\[0-9\]\{4\}/);
  assert.match(block, /awk "\{ total \+= \\\$1 \} END \{ printf \\"%\.0f\\n\\", total\+0 \}"/);
  assert.doesNotMatch(block, /awk -v today="\$today" '\$0/,
    "the container-shell program must not terminate the host's single-quoted sh -c argument");
});

test("journal inventory serializes one intact POSIX shell payload", () => {
  const block = probe.slice(probe.indexOf("  journal-status)"), probe.indexOf("  journal-restart)"));
  const start = block.indexOf("    inventory=$(compose exec -T oscar sh -eu -c '");
  const end = block.indexOf("\n    IFS='|' read -r publications", start);
  assert.ok(start >= 0 && end > start, "missing journal inventory command substitution");
  const assignment = block.slice(start, end);
  const root = mkdtempSync(resolve(tmpdir(), "oscar-journal-payload-"));
  const capture = resolve(root, "payload.sh");
  try {
    execFileSync("bash", ["-c", `set -Eeuo pipefail
capture=$1
compose() {
  [[ $# -eq 9 ]] || { printf 'unexpected compose argv count: %s\\n' "$#" >&2; return 90; }
  [[ $1 == exec && $2 == -T && $3 == oscar && $4 == sh && $5 == -eu && $6 == -c ]] || return 91
  [[ $8 == journal-inventory && $9 == 2026-10-18 ]] || return 92
  printf '%s' "$7" >"$capture"
  printf '%s\\n' '0|0|0|0|0|0|0|0|0|0|0|0|0|0'
}
fail() { printf '%s\\n' "$*" >&2; return 93; }
journal_today=2026-10-18
${assignment}
`, "journal-payload", capture], {stdio: ["ignore", "pipe", "pipe"]});
    const serialized = readFileSync(capture, "utf8");
    assert.match(serialized, /awk -v today="\$today" "\\\$0 ~/);
    assert.doesNotThrow(() => execFileSync("sh", ["-n", "-c", serialized], {
      stdio: ["ignore", "pipe", "pipe"],
    }));
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test("journal restart prefix oracle rejects truncation masked by later growth", () => {
  const helper = probe.match(/^journal_prefix_matches\(\) \{\n[\s\S]*?^\}/mu)?.[0];
  assert.ok(helper, "missing journal prefix helper");
  const root = mkdtempSync(resolve(tmpdir(), "oscar-journal-prefix-"));
  const candidate = resolve(root, "000001.open");
  const original = Buffer.from("durable-prefix-before-restart\n", "utf8");
  const digest = createHash("sha256").update(original).digest("hex");
  const run = () => execFileSync("bash", ["-c", `set -Eeuo pipefail
${helper}
journal_prefix_matches "$1" "$2" "$3"`, "prefix", digest, String(original.length), candidate]);
  try {
    writeFileSync(candidate, original);
    appendFileSync(candidate, "legitimate-growth\n");
    assert.doesNotThrow(run);
    writeFileSync(candidate, Buffer.concat([
      Buffer.from("TRUNCATED-AND-REPLACED!!!!!!!\n"),
      Buffer.alloc(original.length + 32, 0x78),
    ]));
    assert.throws(run, "growth after truncation must not satisfy byte-count monotonicity");
    writeFileSync(candidate, original.subarray(0, 5));
    assert.throws(run, "a shorter successor must fail");
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test("journal restart exercises dependency-ordered launcher shutdown", () => {
  const block = probe.slice(
    probe.indexOf("  journal-restart)"),
    probe.indexOf("  fixture-create)", probe.indexOf("  journal-restart)")),
  );
  assert.match(block, /sudo bash oscar[.]sh restart/);
  assert.doesNotMatch(block, /compose restart oscar/);
  assert.match(block, /compose logs --since "\$restart_started" oscar postgres/);
  assert.match(block, /mapfile -t before_rows <"\$before_inventory"/);
  assert.match(block, /for before_row in "\$\{before_rows\[@\]\}"/);
  assert.match(block, /segments_verified == "\$segments_before"/);
  assert.doesNotMatch(block, /done <"\$before_inventory"/);
  const scratchBefore = block.indexOf('archive_scratch_inventory >"$scratch_before"');
  const supportedRestart = block.indexOf('sudo bash oscar.sh restart');
  const scratchAfter = block.indexOf('archive_scratch_inventory >"$scratch_after"');
  assert.ok(scratchBefore >= 0 && supportedRestart > scratchBefore,
    "all validated scratch identities must be captured immediately before restart");
  assert.ok(scratchAfter > supportedRestart,
    "all validated scratch identities must be captured after restart");
  assert.match(block, /comm -12 "\$scratch_before" "\$scratch_after" >"\$stale_scratch"/);
  for (const required of [
    "BasicEventHandler", "DataStreamTransactionHandler", "DatabasePurger",
    "ModuleRegistry", "journal-restart-partials", '! -newermt "$cutoff"',
    "Timed out waiting for camera", "command queue is quarantined",
    "Timed out waiting for video files", "stale or mismatched saved-video result",
    '"shutdownErrors":%s', '"cameraRecordingErrors":%s',
    '"scratchBeforeRestartCount":%s', '"scratchAfterRestartCount":%s',
    '"staleScratchAfterRestartCount":%s', '"scratchBeforeRestart":%s',
    '"scratchAfterRestart":%s', '"staleScratchAfterRestart":%s',
  ]) assert.ok(block.includes(required), `missing ordered-restart oracle: ${required}`);
  assert.doesNotMatch(block, /FATAL:[^'\n]*terminating connection due to administrator command/,
    "normal PostgreSQL disconnects during the supported restart are not shutdown failures");
});

test("scratch inventory ignores only the exact safe permanent lease", () => {
  const start = probe.indexOf("archive_scratch_inventory() {");
  const end = probe.indexOf("scratch_inventory_json() {", start);
  const block = probe.slice(start, end);
  assert.ok(start >= 0 && end > start, "missing archive scratch inventory helper");
  assert.match(block, /\[ -d "\$root" \] && \[ ! -L "\$root" \]/);
  assert.match(block, /lease="\$root\/\.oscar-duckdb\.lock"/);
  assert.match(block, /\[ -f "\$lease" \] && \[ ! -L "\$lease" \]/);
  assert.match(block, /stat -c %u -- "\$lease"\)" = 10001/);
  assert.match(block, /stat -c %g -- "\$lease"\)" = 10001/);
  assert.match(block, /stat -c %a -- "\$lease"\)" = 600/);
  assert.match(block, /-print0 >"\$work\/first\.raw"/);
  assert.match(block, /sort -zu "\$work\/first\.raw"/);
  assert.match(block, /cmp -s "\$work\/first\.sorted" "\$work\/second\.sorted" \|\| exit 25/);
  assert.match(block, /validator="\$work\/validator[.]sh"/);
  assert.match(block, /chmod 600 "\$validator"/);
  assert.match(block, /xargs -0 -r sh -eu "\$validator" "\$root" "\$lease"/);
  assert.match(block, /\[ -d "\$child" \] && \[ ! -L "\$child" \]/);
  assert.match(block, /real_child=\$\(realpath -e -- "\$child"\)/);
  assert.match(block, /stat -c %d:%i -- "\$lease"/);
  assert.doesNotMatch(block, /find[^\n]*\|/,
    "an authoritative find failure must not be masked by a successful pipeline tail");
});

test("scratch health reports the lease, operation count, and every unexpected entry", () => {
  const start = probe.indexOf("archive_scratch_json() {");
  const end = probe.indexOf("archive_scratch_inventory() {", start);
  const block = probe.slice(start, end);
  assert.ok(start >= 0 && end > start, "missing archive scratch health helper");
  for (const field of [
    "leaseFilePresent", "leaseFileRegular", "leaseFileOwnerUid", "leaseFileOwnerGid",
    "leaseFileMode", "entryCount", "unexpectedEntryCount",
  ]) assert.ok(block.includes(field), `scratch health is missing ${field}`);
  assert.match(block, /-print0 >"\$work\/first\.raw"/);
  assert.match(block, /cmp -s "\$work\/first\.sorted" "\$work\/second\.sorted"/);
  assert.match(block, /classifier="\$work\/classifier[.]sh"/);
  assert.match(block, /chmod 600 "\$classifier"/);
  assert.match(block, /xargs -0 -r sh -eu "\$classifier" "\$scratch" "\$lease"/);
  assert.match(block, /printf "operation\\n"/);
  assert.match(block, /printf "unexpected\\n"/);
  assert.match(block, /unexpected=\$\(grep -c "\^unexpected\$"/);
  assert.match(block, /inventory_stable.*unexpected=\$\(\(unexpected\+1\)\)/s);
  assert.doesNotMatch(block, /find[^\n]*\|/,
    "scratch health must observe a find failure rather than count partial output");
  assert.doesNotMatch(block, /entries=\$\(find "\$scratch" -mindepth 1 -maxdepth 1 -print/,
    "the permanent lease must not be counted as active operation work");
});

test("archive maintenance idle counts operation directories rather than the permanent lease", () => {
  const start = probe.indexOf("  archive-maintenance-idle)");
  const end = probe.indexOf("  fixture-status)", start);
  const block = probe.slice(start, end);
  assert.ok(start >= 0 && end > start, "missing archive maintenance idle action");
  assert.match(block, /scratch_inventory=\$\(archive_scratch_inventory\)/);
  assert.match(block, /scratch_entries=0/);
  assert.match(block, /scratch_entries=\$\(grep -c \. <<<"\$scratch_inventory"\)/);
  assert.doesNotMatch(block, /find "\$root" -mindepth 1 -maxdepth 1 -print \| wc -l/);
});

test("camera recording log probe uses one exact guarded window and count-only output", () => {
  const start = probe.indexOf("  camera-recording-log-start)");
  const end = probe.indexOf("  alarm-media-baseline)", start);
  const block = probe.slice(start, end);
  assert.ok(start >= 0 && end > start, "camera-recording log actions are missing");
  assert.match(block, /date --utc \+%Y-%m-%dT%H:%M:%S\.%NZ/);
  assert.match(block, /compose logs --since "\$camera_log_started_at" oscar/);
  for (const field of [
    "timeoutQuarantines", "queueRejections", "recordingResultTimeouts",
    "staleGenerationResults", "cameraCommandFailures",
  ]) assert.ok(block.includes(`\\"${field}\\"`) || block.includes(`"${field}"`), `missing ${field}`);
  assert.doesNotMatch(block, /cat -- "\$camera_log"/);
});

test("alarm scenario queues back-to-back short occupancies before Viewer resolution", () => {
  const start = scenarios.indexOf("  private async alarms()");
  const end = scenarios.indexOf("  private async exportSelectedAlarm", start);
  const block = scenarios.slice(start, end);
  assert.ok(start >= 0 && end > start, "alarm scenario is missing");
  assert.match(block, /shortAlarmConfig\(this\.originalRpmConfig\)/);
  const triggers = block.indexOf("for (const type of");
  const resolutions = block.indexOf("for (const {type, trigger} of generated)");
  assert.ok(triggers >= 0 && resolutions > triggers,
    "both short alarms must trigger before either event is resolved");
  assert.match(block, /camera-recording-log-check/);
  assert.match(block, /counts\.every\(count => Number\.isSafeInteger\(count\) && count === 0\)/);
  assert.match(block, /findAlarmRow\(page, new RegExp\(type, "i"\), trigger\)/,
    "alarm lookup must retain the exact creating trigger instead of trusting a reusable occupancy count");
});

test("media metadata probe validates compact checkpoint and exact binary indexes", () => {
  const start = probe.indexOf("media_metadata_health_json()");
  const end = probe.indexOf("\n}\n", start);
  const helper = probe.slice(start, end + 2);
  for (const required of [
    ".metadata-reclamation-checkpoint.json", "checkpoint_schema",
    "earliestProcessedObservationEpochHour", "retention-processed-index", "deletion-index",
    "totalEntries", "regularFiles", "directories", "legacyProcessedMarkerFiles",
    "legacyDeletionTombstones", "indexFormatFailures", "find \"$root\" -xdev",
    "4f534341524d50490000000100000024", "4f534341524d44490000000100000024",
  ]) assert.ok(helper.includes(required), `missing media metadata health contract: ${required}`);
  assert.match(helper, /\^\[0-9\]\{19\}-\(0\[0-9\]\|1\[01\]\)\[.]idx\$/);
  assert.match(helper, /\(\(\(size-16\)%36\)\)/);
  assert.doesNotMatch(helper, /records[^\n]*-gt 100000/,
    "valid high-rate five-minute index files must stream rather than fail format validation");
  assert.doesNotMatch(helper, /total_entries[^\n]*(?:-gt|-le)\s*100000/,
    "valid retained trees over 100,000 entries must be inventoried rather than rejected");
  assert.match(helper, /find "\$root" -xdev -mindepth 1 -printf "%y\\t%P\\n" >"\$inventory_file"/,
    "inventory generation must preserve a failing find status instead of hiding it in a pipe");
  assert.doesNotMatch(helper, /find "\$root" -xdev -mindepth 1 -printf[^\n]*[|][^\n]*awk/);
  assert.match(helper, /-name "\*\$newline\*" -o -name "\*\$tab\*"/,
    "filenames that can corrupt the line-oriented inventory must fail closed");
  assert.match(probe, /  media-metadata-health\)/);
  assert.match(probe, /  retention-runtime-health\)/);
  assert.match(probe, /  archive-scratch-health\)/);
});

test("storage snapshot emits activeHolds exactly once", () => {
  const block = probe.slice(probe.indexOf("  snapshot)"), probe.indexOf("  archive-health)"));
  assert.equal(block.match(/'activeHolds'/g)?.length, 1);
  assert.equal(
    block.match(/awk '\{print \\\$1\+0\}'/g)?.length,
    3,
    "snapshot byte probes must escape awk's positional field from the outer set -u shell",
  );
  assert.ok(
    !block.includes("awk '{print \\\\$1+0}'"),
    "a doubled backslash leaves $1 exposed to the outer shell",
  );
  for (const field of [
    "retainedMediaManifestFiles", "retainedMediaJpegFiles", "processedObservationIndexFiles",
    "processedObservationIndexBytes", "deletionIndexFiles", "deletionIndexBytes",
    "legacyProcessedMarkerFiles", "legacyDeletionTombstones", "mediaMetadataCheckpointBytes",
    "statementTempBlocksWritten", "observationDeleteCalls", "observationDeleteRows",
    "observationRowsPerDeleteCall", "legacySingletonObservationDeleteCalls",
    "batchedObservationDeleteCalls", "batchedObservationDeleteRows",
    "batchedObservationRowsPerDeleteCall",
  ]) assert.ok(block.includes(field), `missing media storage metric: ${field}`);
  assert.match(block, /current_db AS \(SELECT oid FROM pg_database WHERE datname=current_database\(\)\)/);
  assert.equal(block.match(/dbid=current_db[.]oid/g)?.length, 2,
    "insert/delete statement metrics must be scoped to the OSCAR database");
  assert.ok(block.includes("obs([[:space:]]|[(])"),
    "insert metrics must not include obs-prefixed tables");
  assert.ok(block.includes("obs([[:space:]]|$)"),
    "delete metrics must not include obs-prefixed tables");
  assert.ok(block.includes("oscar_obs_stage_[a-z0-9_]+([[:space:]]|$)"),
    "delete metrics must include dynamic immutable stage child relations");
});

test("backup check authenticates markers, epoch, verification, and exact journal outcomes", () => {
  const block = probe.slice(probe.indexOf("  backup-check)"), probe.indexOf("  restore-drill)"));
  const liveMember = probe.slice(probe.indexOf("append_live_backup_member()"),
    probe.indexOf("verify_retained_backup_members()"));
  assert.match(liveMember, /awk "\{print \\\$1\}"/,
    "the inner container shell must receive one escaped awk field reference");
  assert.doesNotMatch(liveMember, /awk "\{print \\\\\$1\}"/,
    "a doubled backslash is passed through to awk as an invalid character");
  for (const required of [
    "SHA256SUMS.hmac",
    "JOURNAL_CONFIRMED",
    "epoch.json",
    "image-inventory.txt",
    "archive-generation-ids.txt",
    "backup-verify",
    "oscar-backup-epoch",
    "journalReceipts",
    "journalConfirmedPublications",
    "backup-confirmations",
    "journalConfirmationAuthenticated",
    "archiveGenerationInventoryExact",
    "oscar-dailyfile-backup-confirmation-set",
    "confirmationSet",
    "oscar-backup:$backup/oscar-state.tar.gz#sha256=$oscar_state_sha",
    "duckDbScratchExcluded",
    "retainedMediaPrefixPresent",
    "mediaMetadataCheckpointIncluded",
    "processedObservationIndexesIncluded",
    "deletionIndexesIncluded",
    "retainedMediaManifestsIncluded",
    "retainedMediaJpegsIncluded",
    "currentAuthenticated",
    "currentSnapshotCount",
    "walArchiveTarAbsent",
    "streamedWalPresent",
    "atomicStateMachineExact",
    "pruneRetired",
  ]) assert.ok(block.includes(required), `missing backup contract: ${required}`);
  assert.match(block, /-f \$root\/\$required && ! -L \$root\/\$required/);
  assert.match(block, /-f \$root\/archive-generation-ids\.txt && ! -L \$root\/archive-generation-ids\.txt/);
  assert.doesNotMatch(
    block,
    /-s \$root\/archive-generation-ids\.txt/,
    "a zero-generation inventory is the canonical empty file and must remain valid",
  );
  assert.match(block, /convert_from\(decode\('\$encoded','base64'\),'UTF8'\)::jsonb/);
  assert.match(block, /json_object_keys\(raw\)\)=10/);
  assert.match(block, /value->>'day'='\$receipt_day'/);
  assert.match(block, /value \?& ARRAY\['schemaVersion','laneId','day','windowStartInclusive'/);
  assert.match(block, /json_array_elements/);
  assert.match(block, /\$2=="\.\/JOURNAL_CONFIRMED" \{count\+\+\} END \{print count\+0\}' "\$root\/SHA256SUMS"\) == 0/);
  assert.match(block, /grep -Fxc 'version=2'/);
  assert.match(block, /hmac_sha256=/);
  assert.match(block, /openssl dgst -sha256 -hmac/);
  assert.match(block, /\.sets\/\$backup\.json/);
  assert.match(block, /receipt->>'path'='\$relative' AND receipt->>'sha256'='\$receipt_sha'/);
  assert.match(block, /archive-generation-ids\.txt" \{count\+\+\} END \{print count\+0\}' "\$root\/SHA256SUMS"\) == 1/);
  assert.match(block, /generation_bytes -le 37000000/);
  assert.match(block, /generation_count -le 1000000/);
  assert.match(block, /generation_bytes == \$\(\(generation_count \* 37\)\)/);
  assert.match(block, /generation_sha=\$\(sha256_file "\$root\/archive-generation-ids\.txt"\)/);
  assert.match(block, /archive_generation_count\|\|'\|'\|\|archive_generation_inventory_sha256\|\|'\|'\|\|archive_generation_inventory_bytes/);
  assert.match(block, /catalog_generation_receipt == "\$generation_count\|\$generation_sha\|\$generation_bytes"/);
  assert.doesNotMatch(block, /array_to_string\(archive_generation_ids/);
  assert.doesNotMatch(block, /paste -sd,/);
  assert.match(block, /tar -tzf "\$root\/oscar-state[.]tar[.]gz"/);
  assert.match(block, /duckdb-tmp/);
  assert.match(block, /retention-processed-index\/\[0-9\]\{19\}-\(0\[0-9\]\|1\[01\]\)/);
  assert.match(block, /verify_retained_backup_members/);
  assert.match(block, /append_quiesced_backup_member/);
  assert.match(block, /copy_quiesced_confirmation_member "\$confirmation_set_member"/);
  assert.match(block, /copy_quiesced_confirmation_member "\$receipt_member"/);
  assert.match(block, /if \(\(journal_confirmed_count > 0\)\); then/);
  assert.match(block, /Zero-candidate daily-journal confirmation unexpectedly published a set marker/);
  assert.match(block, /receipt_count == "\$journal_confirmed_count"/);
  assert.doesNotMatch(block, /tar -xOf "\$root\/oscar-state[.]tar[.]gz" -- "\$confirmation_set_raw"/,
    "the post-verification confirmation set is live authorization, not a member of its prior snapshot");
  assert.match(block, /compose stop gateway/);
  assert.match(block, /compose stop oscar/);
  assert.match(block, /sudo bash oscar[.]sh start/);
  assert.doesNotMatch(block, /Backup certification requires at least one processed-observation index/);
  assert.match(block, /expected-retained-members[.]txt/);
  assert.match(block, /retainedMediaExactMembersVerified/);
  assert.match(block, /expectedProcessedIndexes/);
  assert.match(block, /expectedDeletionIndexes/);
  assert.match(block, /frame-%02d[.]jpg/);
  assert.doesNotMatch(block, /grep -Fq "\\"backupReference/);
});

test("disabled backup mode rejects every backup-family command before mutation", () => {
  const start = probe.indexOf("  backup-mode-check)");
  const end = probe.indexOf("  snapshot)", start);
  const block = probe.slice(start, end);
  for (const required of [
    "OSCAR backups are disabled.",
    "--backup-dir <safe-absolute-backup-path>",
    "bash oscar.sh backup",
    "bash oscar.sh backup-verify",
    "bash oscar.sh backup-prune",
    "bash oscar.sh restore",
    "launcher_message_count",
    "tree_fingerprint",
    "running_services_fingerprint",
    "SELECT pg_switch_wal()",
    "backupEpochsUnchanged",
    "legacyWalTreeUnchanged",
  ]) assert.ok(block.includes(required), `missing disabled backup oracle: ${required}`);
  assert.ok(!block.includes("absolute-secondary-drive-path"),
    "disabled backup oracle must not require a separate physical drive");
});

test("privileged command diagnostics use private workspaces, not fixed root logs", () => {
  assert.match(probe, /^umask 077$/m);
  for (const prefix of [
    "oscar-regression-archive-verify", "oscar-regression-activation-",
    "oscar-regression-backup-check",
  ]) assert.ok(probe.includes(`mktemp -d \"/tmp/${prefix}`) || probe.includes(`mktemp -d /tmp/${prefix}`));
  for (const fixed of [
    "/tmp/oscar-regression-archive-verify.log",
    "/tmp/oscar-regression-activation-holder-",
    "/tmp/oscar-regression-backup-verify.log",
    "/tmp/oscar-regression-restore-backup-verify.log",
    "/tmp/oscar-regression-restore.log",
    "/tmp/oscar-regression-restore-archive-verify.log",
  ]) assert.ok(!probe.includes(fixed), `fixed privileged log remains: ${fixed}`);
  assert.match(probe, /emit_command_diagnostics/);
});

test("restore drill qualifies the self-contained single snapshot without an external WAL plane", () => {
  const start = probe.indexOf("  restore-drill)");
  const end = probe.indexOf("  fixture-cleanup)", start);
  const block = probe.slice(start, end);
  for (const required of [
    'confirmation == "$run:DESTRUCTIVE-RESTORE"',
    "OSCAR_BACKUP_MODE disabled) == single",
    "expected_archive=${3:-}; expected_backup=${4:-}",
    "archive and backup directories must be distinct",
    "grep -Fqx /var/lib/postgresql/wal-archive",
    "SHOW archive_mode",
    "SHOW archive_timeout",
    "backup_dir/CURRENT",
    "! -e $root/wal-archive.tar.gz",
    'oscar.sh backup-verify "$backup"',
    'oscar.sh restore --backup "$backup" --confirm "$backup"',
    "SELECT timeline_id FROM pg_control_checkpoint()",
    "restored_timeline -gt $source_timeline",
    "SELECT NOT pg_is_in_recovery()",
    "post_promotion_write_durable",
    "current_actual",
    "openssl dgst -sha256 -hmac",
    "preRestoreSafetyCopyVerified",
    "noExternalWalDependency",
    "schemaVersion\":2",
  ]) assert.ok(block.includes(required), `missing self-contained restore contract: ${required}`);
  assert.doesNotMatch(block, /OSCAR_RESTORE_WAL_ARCHIVE_DIR|expected_wal|wal_dir=|walRestored|timelineHistoryArchived|newTimelineWalArchived/);
  assert.doesNotMatch(probe, /restore-drill-legacy-unused/);
});

test("lifecycle uses the scoped 3.9.2 archive administration interface", () => {
  const exportBlock = probe.slice(probe.indexOf("  export-check)"), probe.indexOf("  fixture-controls)"));
  const hotBlock = probe.slice(probe.indexOf("  fixture-hot-hold-create)"), probe.indexOf("  fixture-controls)"));
  const controlBlock = probe.slice(probe.indexOf("  fixture-controls)"), probe.indexOf("  backup-check)"));
  assert.match(exportBlock, /archive export --store-key "\$store_key" --id-scope "\$id_scope"/);
  for (const operation of ["hold create", "dry-run", "purge"]) {
    assert.ok(
      controlBlock.includes(`archive ${operation} --store-key "$store_key" --id-scope "$id_scope"`),
      `missing scoped archive operation: ${operation}`,
    );
  }
  assert.match(controlBlock, /--generation "\$generation"/);
  assert.match(controlBlock, /--observation "\$cold_id"/);
  assert.ok(controlBlock.includes("generationHoldCreated"));
  assert.ok(controlBlock.includes("observationHoldCreated"));
  assert.ok(controlBlock.includes("generationHoldEnforced"));
  assert.ok(controlBlock.includes("coldObservationHoldEnforced"));
  assert.match(controlBlock, /hold_count FROM oscar_deletion_plan/);
  assert.match(controlBlock, /count\(\*\) FROM oscar_deletion_plan_item/);
  assert.match(controlBlock, /retention_hold_id_from_output "\$hold_output" "\$store_key" "\$id_scope" GENERATION_EXACT/);
  assert.match(controlBlock, /retention_hold_id_from_output "\$observation_hold_output" "\$store_key" "\$id_scope" COLD_RANGE_CONSERVATIVE/);
  assert.match(controlBlock, /resolution_mode='GENERATION_EXACT'/);
  assert.match(controlBlock, /resolution_mode='COLD_RANGE_CONSERVATIVE'/);
  assert.match(controlBlock, /created_by='oscar-regression'/);
  assert.match(controlBlock, /reason='regression-\$run'/);
  assert.match(controlBlock, /reason='regression-observation-\$run'/);
  for (const required of [
    "fixture-hot-hold-create)", "fixture-hot-hold-release)", "HOT_EXACT",
    "regression-hot-$run", "hotId", "listed", "released",
  ]) assert.ok(hotBlock.includes(required), `missing exact hot-hold contract: ${required}`);
  assert.match(hotBlock, /retention_hold_id_from_output "\$hot_output" "\$store_key" "\$id_scope" HOT_EXACT/);
});

test("legacy HOT_RETENTION fixture controls remain isolated from the primary stage path", () => {
  const allocator = probe.slice(probe.indexOf("create_observation_fixture()"), probe.indexOf("\n\ncase $action"));
  for (const required of [
    "INSERT INTO oscar_regression_fixture_allocator(singleton,leased_high_water)",
    "ON CONFLICT (singleton) DO UPDATE",
    "oscar_regression_fixture_allocator.leased_high_water",
    "EXCLUDED.leased_high_water-1099511627778",
    "max(id) FROM obs",
    "max(max_id) FROM oscar_archive_generation",
    "RETURNING leased_high_water cold_id,leased_high_water-3 hot_id",
    "9223370937343148029",
    "INSERT INTO obs(id,datastreamid",
    "cold_id::text",
    "hot_id::text",
    "oscar_archive_id_block",
    "oscar_obs_overlay",
    "fixture_archive_time_sql()",
    "min(window_start) FROM oscar_archive_generation",
    "min(window_start) FROM oscar_archive_job",
    "interval '2 hours'",
  ]) assert.ok(allocator.includes(required), `missing collision-safe fixture allocation contract: ${required}`);
  const allocatorTable = probe.slice(probe.indexOf("ensure_fixture_table()"), probe.indexOf("create_observation_fixture()"));
  assert.match(allocatorTable, /oscar_regression_fixture_allocator/);
  assert.match(allocatorTable, /singleton boolean PRIMARY KEY/);
  assert.match(allocatorTable, /cold_ids bigint\[\]/);
  assert.doesNotMatch(allocator, /pg_advisory_xact_lock/);
  assert.match(allocator, /WHERE id BETWEEN a\.hot_id AND a\.cold_id/);
  assert.match(allocator, /generate_series\(0,2\)/);
  assert.match(allocator, /FROM cold_set,hot RETURNING \*/);

  const create = probe.slice(probe.indexOf("  fixture-create)"), probe.indexOf("  fixture-create-race)"));
  const race = probe.slice(probe.indexOf("  fixture-create-race)"), probe.indexOf("  fixture-status)"));
  assert.match(create, /create_observation_fixture "\$run"/);
  assert.match(race, /create_observation_fixture "\$run"/);
  assert.match(race, /sampled_at-interval '2 minutes'/);
  assert.match(race, /sampled_at-interval '1 minute'/);
  assert.match(race, /BEFORE UPDATE OF archivegenerationid/);
  assert.match(race, /pg_advisory_xact_lock/);
  assert.match(race, /pg_temp\.oscar_archive_activation_row WHERE observation_id=\$cold_id/);
  assert.match(race, /resulttime=resulttime\+interval '1 microsecond'/);
  assert.match(race, /fixture_archive_time_sql "\$retention" 'clock_timestamp\(\)'/);
  assert.match(race, /j\.state='FAILED'/);
  assert.match(race, /staleActivationRejected/);

  const status = probe.slice(probe.indexOf("  fixture-status)"), probe.indexOf("  fixture-accelerate)"));
  assert.match(status, /g\.row_count=cardinality\(f\.cold_ids\)/);
  assert.match(status, /g\.min_id=\(SELECT min\(id\) FROM unnest\(f\.cold_ids\)/);
  assert.match(status, /o\.archivegenerationid=g\.id/);
  assert.match(status, /exactRowOwnership/);
  assert.match(status, /o\.id IN \(SELECT unnest\(cold_ids\) FROM f\)/);
  assert.doesNotMatch(status, /count\(\*\)=cardinality\(f\.cold_ids\)\s+FROM obs o,f,g/);

  const cleanupStart = probe.indexOf("  fixture-cleanup)");
  const cleanup = probe.slice(cleanupStart, probe.indexOf("  *) fail", cleanupStart));
  assert.match(cleanup, /DELETE FROM oscar_regression_fixture WHERE run_id='\$run' RETURNING cold_ids,hot_id/);
  assert.match(cleanup, /DELETE FROM obs o USING f WHERE o\.id=ANY\(f\.cold_ids\) OR o\.id=f\.hot_id/);
  assert.doesNotMatch(cleanup, /DELETE FROM obs(?:\s+WHERE|;)/);

  const archiveHelper = probe.slice(probe.indexOf("  archive-helper-check)"), probe.indexOf("  fixture-hot-hold-create)"));
  assert.match(archiveHelper, /oscar-archive-object verify/);
  assert.match(archiveHelper, /oscar-archive-object copy/);
  assert.match(archiveHelper, /mismatchRejected/);
  assert.match(archiveHelper, /traversalRejected/);

  assert.doesNotMatch(probe, /^  wal-helper-check\)/m);
});

test("retained-media scenario browser-decodes every assessed frame", () => {
  const start = scenarios.indexOf("action: \"verify exact-five retained JPEG API\"");
  const end = scenarios.indexOf("await this.verifyRetainedMediaGallery(", start);
  const originStart = scenarios.lastIndexOf("const page = await this.browser.oscarPage()", start);
  const block = scenarios.slice(originStart, end);
  assert.ok(originStart > 0 && start > originStart && end > start);
  assert.match(block, /await this\.goto\(page, "\/"\)/);
  assert.doesNotMatch(block, /await this\.goto\(page, "\/dashboard"\)/);
  assert.match(block, /for \(const asset of assessed\.assets\)/);
  assert.match(block, /page\.evaluate\(boundedFetch/);
  assert.match(block, /maxBytes: Math\.min\(asset\.bytes, MAX_RETAINED_FRAME_BYTES\)/);
  assert.match(block, /image\.decodedWidth === asset\.width && image\.decodedHeight === asset\.height/);
  assert.doesNotMatch(block, /response\.body\(\)|response\.json\(\)|image\.body\(\)/);
  assert.match(block, /assessed\.jpegQualities\.every\(quality => quality === 85\)/);
});

test("storage lifecycle refuses mutation when exact release/profile preflight fails", () => {
  const start = scenarios.indexOf("private async storageLifecycle");
  const stageSelect = scenarios.indexOf('"stage-lifecycle-select"', start);
  const refusal = scenarios.indexOf("Storage lifecycle mutation refused", start);
  assert.ok(start > 0 && refusal > start && stageSelect > refusal);
  const block = scenarios.slice(start, stageSelect);
  assert.match(block, /if \(!profileAccepted\)/);
  assert.match(block, /media\.enabled === REGRESSION_MEDIA_RETENTION\.enabled/);
  assert.match(block, /media\.timeToRetentionDays === REGRESSION_MEDIA_RETENTION\.timeToRetentionDays/);
  assert.match(block, /media\.queryPeriodMinutes === REGRESSION_MEDIA_RETENTION\.queryPeriodMinutes/);
  assert.match(block, /media\.maximumCatchUpHours === REGRESSION_MEDIA_RETENTION\.maximumCatchUpHours/);
  assert.match(block, /media\.lateArrivalOverlapHours === REGRESSION_MEDIA_RETENTION\.lateArrivalOverlapHours/);
  assert.match(block, /media\.lateArrivalScanPeriodMinutes ===/);
  assert.match(block, /media\.lateArrivalCatchUpHours === REGRESSION_MEDIA_RETENTION\.lateArrivalCatchUpHours/);
  assert.match(block, /media\.reconciliationCatchUpHours ===/);
  assert.match(block, /media\.reconciliationPeriodHours ===/);
  assert.match(block, /media\.occupancyStreamRefreshMinutes ===/);
  assert.match(block, /media\.frameCount === REGRESSION_MEDIA_RETENTION\.frameCount/);
  assert.match(block, /media\.jpegQuality === REGRESSION_MEDIA_RETENTION\.jpegQuality/);
  assert.match(block, /media\.sourceRollbackGraceHours === REGRESSION_MEDIA_RETENTION\.sourceRollbackGraceHours/);
  assert.match(block, /media\.maintenanceWorkLimit === REGRESSION_MEDIA_RETENTION\.maintenanceWorkLimit/);
  assert.ok(block.indexOf("verifyGeneratedAlarmRetention") > block.indexOf("if (!profileAccepted)"));
});

test("lifecycle-only required storage refuses zero-media certification before lane mutation", () => {
  const start = scenarios.indexOf("private async storageLifecycle");
  const end = scenarios.indexOf("private async storageRestoreDrill", start);
  const block = scenarios.slice(start, end);
  const refusal = block.indexOf(
    "Storage lifecycle mutation refused without generated or explicitly configured retained-media proof",
  );
  const journalMutation = block.indexOf("prove direct journal append");
  assert.ok(refusal > 0 && journalMutation > refusal);
  assert.match(block, /this\.generatedAlarmMedia\.size === 0 && this\.retainedBackupExpectations\.size === 0/);
  assert.match(block, /proveConfiguredRetainedMediaEvent/);
  assert.match(block, /no exact retained-media set completed certification/);
});

test("Parquet-primary lifecycle observes natural stage retirement without fixture DML", () => {
  const start = scenarios.indexOf("private async storageLifecycle");
  const end = scenarios.indexOf("private async storageRestoreDrill", start);
  const block = scenarios.slice(start, end);
  for (const required of [
    "stage-lifecycle-select", "stage-lifecycle-witness", "stage-lifecycle-status",
    "stage-lifecycle-hot",
    "completed nonempty 30-minute immutable stage child",
    "witness exact multi-generation ownership before retirement",
    "checksum/parity-verified whole-child retirement", "sameWitnessedGenerationIds",
    "witness.ownerCount === stageSample.rowCount",
    "witness.ownerGenerationRowCount === stageSample.rowCount",
    "value.windowGenerations.generationCount === witness.ownerGenerationCount",
    "value.windowGenerations.generationRowCount === stageSample.rowCount",
    "registryState === null", "!retired.relationPresent", "!retired.coldHotPresent",
    "archived.generationId === witness.selectedGenerationId",
  ]) assert.ok(block.includes(required), `missing natural stage lifecycle contract: ${required}`);
  for (const forbidden of [
    "fixture-create", "fixture-create-race", "fixture-accelerate", "fixture-cleanup",
    "fixture-hot-hold-create", "fixture-controls", "request.delete(",
  ]) assert.ok(!block.includes(forbidden), `primary lifecycle invokes legacy mutation: ${forbidden}`);
});

test("storage lifecycle proves direct journal, whole-child retirement, retrieval, scratch, and backup", () => {
  const start = scenarios.indexOf("private async storageLifecycle");
  const end = scenarios.indexOf("private async storageRestoreDrill", start);
  const block = scenarios.slice(start, end);
  for (const required of [
    "OSCAR_STORAGE_SCHEMA_CHECKSUM", "journal-lane-state", "prove direct journal append",
    "status.tamper_fault", "reserved lane journal bytes to advance", "verify compact media metadata",
    "mediaMetadataHealthIsSafe", "stage-lifecycle-select", "stage-lifecycle-witness",
    "stage-lifecycle-status",
    "stage-lifecycle-hot", "archive-scratch-health",
    "return {passed: clean, value: clean",
    "storage-lifecycle-export-disruption", 'this.metrics.setPhase("storage-lifecycle-post-export")',
    "storage-lifecycle-restart-disruption", 'this.metrics.setPhase("storage-lifecycle-post-restart")',
    "storage-lifecycle-backup-disruption", 'this.metrics.setPhase("storage-lifecycle-post-backup")',
    "await this.metrics.sample()", "retained-media indexes to repopulate and stabilize after restart",
    "REGRESSION_MEDIA_RETENTION.queryPeriodMinutes * 60_000 + 15_000",
    "verify accelerated retained-media worker is active", "retention-runtime-health",
    "retentionRuntimeReady", "REGRESSION_MEDIA_CURSOR_MAX_LAG_SECONDS",
    "&order=asc", "&order=desc",
    "verify clean DuckDB scratch before stage observation", "scratchAccepted",
    "archiveScratchIsSafe(value)", "duckDbScratchExcluded",
    "mediaMetadataCheckpointIncluded", "processedObservationIndexesIncluded",
    "deletionIndexesIncluded",
    "retainedMediaExpectedSets", "retainedMediaExpectedMembers",
    "retainedMediaExactMembersVerified", "expectedProcessedIndexes", "expectedDeletionIndexes",
    "retire one verified immutable child as a whole relation",
    "query cold event by ID", "query mixed hot/cold range",
    'record?.["datastream@id"] === streamPublicId',
    "ascColdIndex < ascHotIndex", "descHotIndex < descColdIndex",
    "verify bounded database work amplification", "legacySingletonObservationDeleteCalls",
    "deleteCalls === 0", "deleteRows === 0",
    "singletonDeletes === 0", "batchedDeleteCalls === 0", "batchedDeleteRows === 0",
    "unaccountedSingletonDeletes === 0",
    "512 * 1024 * 1024", "65_536",
  ]) assert.ok(block.includes(required), `missing 3.9.2 storage lifecycle assertion: ${required}`);
  assert.match(block, /lane\.bytes >= directJournalAfterAppend!\.bytes/);
});

test("restore drill re-runs release identity and scopes metrics disruption to the supported restore", () => {
  const start = scenarios.indexOf("private async storageRestoreDrill");
  const end = scenarios.indexOf("private async extendedOccupancy", start);
  const block = scenarios.slice(start, end);
  assert.equal(block.match(/storagePlatformHasExactReleaseIdentity/g)?.length, 2);
  assert.match(block, /const before = assessStoragePlatform/);
  assert.match(block, /const after = assessStoragePlatform/);
  assert.match(block, /expectRemoteMetricDisruptionPhase\(restoreDisruptionPhase\)/);
  const disruption = block.indexOf('this.metrics.setPhase(restoreDisruptionPhase)');
  const restore = block.indexOf('"restore-drill"', disruption);
  const steady = block.indexOf('this.metrics.setPhase("storage-restore-drill-post")', restore);
  assert.ok(disruption > 0 && restore > disruption && steady > restore);
});

test("retained-media gallery measures concurrency and proves selected content loaded", () => {
  const start = scenarios.indexOf("private async verifyRetainedMediaGallery");
  const end = scenarios.indexOf("private async storageHealth", start);
  const block = scenarios.slice(start, end);
  assert.match(block, /peakInFlightFrameRequests <= 3/);
  assert.match(block, /initialRequests === cameras/);
  assert.match(block, /selectedFrameRequested && selectedFrameLoaded/);
  assert.match(block, /image\.naturalWidth > 0/);
  assert.match(block, /source !== initialSource/);
});

test("full retained-media proof self-seeds without weakening smoke fixture requirements", () => {
  const policyStart = scenarios.indexOf("private fullRunCanSelfSeedRetainedMedia");
  const policyEnd = scenarios.indexOf("private async check", policyStart);
  const policy = scenarios.slice(policyStart, policyEnd);
  assert.match(policy, /\["full", "3\.9\.2-release", "3\.11\.0-release"\]\.includes\(this\.config\.profile\)/);
  assert.match(policy, /this\.selected\("storage-lifecycle"\)/);
  for (const producer of ["rpm-alarms", "event-uuid", "adjudication", "eml-auto-adjudication"]) {
    assert.ok(policy.includes(`"${producer}"`), `missing retained-media producer ${producer}`);
  }

  const healthStart = scenarios.indexOf("private async storageHealth");
  const lifecycleStart = scenarios.indexOf("private async storageLifecycle", healthStart);
  const health = scenarios.slice(healthStart, lifecycleStart);
  assert.match(health, /if \(this\.fullRunCanSelfSeedRetainedMedia\(\)\)/);
  assert.match(health, /this\.retainedMediaProofDeferred = true/);
  assert.match(health, /full profile will self-seed an exact alarm UUID/);
  assert.match(health, /STORAGE_RETAINED_EVENT_ID is missing and this run cannot self-seed/);
  assert.match(health, /daily-journal inventory to reach an atomic clean boundary/);
  assert.match(health, /candidate => assessDailyJournalStatus\(candidate\)\.passed/);
  assert.match(health, /retained-media metadata to reach an atomic clean boundary/);
  assert.match(health, /candidate => mediaMetadataHealthIsSafe\(candidate, requirePopulated\)/);

  const generatedStart = scenarios.indexOf("private async verifyGeneratedAlarmRetention");
  const generatedEnd = scenarios.indexOf("private storageUnavailable", generatedStart);
  const generated = scenarios.slice(generatedStart, generatedEnd);
  assert.match(generated, /"self-seed retained-media proof"/);
  assert.match(generated, /generated events=\$\{this\.generatedAlarmMedia\.size\}/);
  assert.match(generated, /const galleryEventId = generated\[0\]!\.association\.eventId/);
  assert.match(generated, /"render self-seeded retained-media gallery"/);
  assert.match(generated, /await this\.verifyRetainedMediaGallery\(/);
});

test("storage-health and storage-lifecycle verify ConSys API query latency and datastream bloat in the moment and over time", () => {
  const healthStart = scenarios.indexOf("private async storageHealth");
  const lifecycleStart = scenarios.indexOf("private async storageLifecycle", healthStart);
  const restoreStart = scenarios.indexOf("private async storageRestoreDrill", lifecycleStart);
  const health = scenarios.slice(healthStart, lifecycleStart);
  const lifecycle = scenarios.slice(lifecycleStart, restoreStart);

  assert.match(health, /verify ConSys API and browser observation query latency and database bloat/);
  assert.match(health, /this\.measureConSysQueryLatencies\(latencyPage\)/);
  assert.match(health, /dsBytes <= 32 \* 1024 \* 1024/);
  assert.match(health, /connRows <= 18_000/);

  assert.match(lifecycle, /verify bounded datastream bloat and query latency drift across archival/);
  assert.match(lifecycle, /latencyBefore = await this\.measureConSysQueryLatencies\(beforeLatencyPage\)/);
  assert.match(lifecycle, /const latencyAfter = await this\.measureConSysQueryLatencies\(apiPage\)/);
  assert.match(lifecycle, /dsDelta <= 4 \* 1024 \* 1024/);
});
