import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {
  archiveScratchRestartIsSafe,
  archiveScratchIsSafe,
  assessArchiveHealth,
  assessArchiveScratchRestart,
  assessArchiveScratch,
  assessImmutableStageHealth,
  assessDailyFilePublication,
  assessJpeg,
  assessMediaMetadataHealth,
  assessRetainedMediaResponse,
  assessRetentionRuntimeHealth,
  assessStoragePlatform,
  encodeOshBigId,
  immutableStageHealthIsSafe,
  mediaMetadataHealthIsSafe,
  OSCAR_STORAGE_SCHEMA_CHECKSUM,
  parseBaselineJpeg,
  retentionRuntimeReady,
  storagePlatformHasExactReleaseIdentity,
  storageMetricFromProbe,
} from "../src/storage-oracles.js";

const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

function retainedResponse(eventId = "00000000-0000-4000-8000-000000000001") {
  const laneUid = "lane-01";
  const cameraUid = "camera-01";
  const cameraToken = Buffer.from(cameraUid).toString("base64url");
  const positions = ["FIRST", "QUARTER", "MIDDLE", "THREE_QUARTERS", "LAST"];
  const assets = positions.map((position, index) => ({
    position, sourceFrameOrdinal: index + 1, contentType: "image/jpeg", state: "PUBLISHED",
    bytes: 4, width: 1, height: 1, sha256: "a".repeat(64),
  }));
  return {eventId, response: {schemaVersion: 1, eventId, mediaSets: [{
    manifest: {schemaVersion: 1, eventId, lifecycleState: "AVAILABLE",
      mediaSetId: digest(`${eventId}\0${laneUid}\0${cameraUid}`), laneUid, cameraUid, jpegQuality: 85,
      source: {objectKey: "videos/clips/camera-01/2026-10-18_00-00-00_000-g1.mp4",
        state: "PRESERVED_FOR_ROLLBACK", sha256: "b".repeat(64), bytes: 100,
        rollbackDeleteAfter: "2026-10-18T00:00:00Z"}, assets},
    manifestPath: `media/${eventId}/${cameraToken}/manifest.json`,
    assets: assets.map((asset, index) => ({asset, path: `media/${eventId}/${cameraToken}/frame-0${index + 1}.jpg`})),
  }]}};
}

test("retained-media oracle requires exactly five canonical JPEG assets", () => {
  const fixture = retainedResponse();
  const result = assessRetainedMediaResponse(fixture.response, fixture.eventId);
  assert.equal(result.frameCount, 5);
  assert.equal(result.assets.length, 5);
  assert.equal(result.mediaSets[0]?.sourceObjectKey,
    "videos/clips/camera-01/2026-10-18_00-00-00_000-g1.mp4");
  fixture.response.mediaSets[0]!.manifest.assets.pop();
  assert.throws(() => assessRetainedMediaResponse(fixture.response, fixture.eventId), /exactly five/);
});

test("retained-media oracle preserves a short OSCAR public observation ID exactly", () => {
  const fixture = retainedResponse("0i4d0ko");
  const result = assessRetainedMediaResponse(fixture.response, fixture.eventId);
  assert.equal(result.frameCount, 5);
  assert.ok(result.paths.every(path => path.startsWith("media/0i4d0ko/")));
});

test("retained-media oracle exposes only source-bound available manifests", () => {
  const blankSource = retainedResponse();
  blankSource.response.mediaSets[0]!.manifest.source.objectKey = "";
  assert.throws(() => assessRetainedMediaResponse(blankSource.response, blankSource.eventId), /objectKey/);

  const failedSource = retainedResponse();
  failedSource.response.mediaSets[0]!.manifest.source.state = "FAILED";
  assert.throws(() => assessRetainedMediaResponse(failedSource.response, failedSource.eventId), /source state/);

  const deleting = retainedResponse();
  deleting.response.mediaSets[0]!.manifest.lifecycleState = "DELETING";
  assert.throws(() => assessRetainedMediaResponse(deleting.response, deleting.eventId), /not available/);
});

test("retained-media oracle requires unique deterministic lowercase SHA-256 media-set IDs", () => {
  const valid = retainedResponse();
  assert.equal(assessRetainedMediaResponse(valid.response, valid.eventId).mediaSetCount, 1);

  const malformed = retainedResponse();
  malformed.response.mediaSets[0]!.manifest.mediaSetId = "123e4567-e89b-42d3-a456-426614174000";
  assert.throws(() => assessRetainedMediaResponse(malformed.response, malformed.eventId),
    /lowercase SHA-256/);

  const uppercase = retainedResponse();
  uppercase.response.mediaSets[0]!.manifest.mediaSetId = uppercase.response.mediaSets[0]!.manifest.mediaSetId.toUpperCase();
  assert.throws(() => assessRetainedMediaResponse(uppercase.response, uppercase.eventId),
    /lowercase SHA-256/);

  const wrongIdentity = retainedResponse();
  wrongIdentity.response.mediaSets[0]!.manifest.mediaSetId = "c".repeat(64);
  assert.throws(() => assessRetainedMediaResponse(wrongIdentity.response, wrongIdentity.eventId),
    /deterministic mediaSetId/);

  const duplicate = retainedResponse();
  duplicate.response.mediaSets.push(structuredClone(duplicate.response.mediaSets[0]!));
  assert.throws(() => assessRetainedMediaResponse(duplicate.response, duplicate.eventId),
    /duplicate deterministic mediaSetId/);
});

test("retained-media oracle rejects event path traversal and duplicate positions", () => {
  const fixture = retainedResponse();
  fixture.response.mediaSets[0]!.assets[0]!.path = `media/${fixture.eventId}/../frame-01.jpg`;
  assert.throws(() => assessRetainedMediaResponse(fixture.response, fixture.eventId), /whitelist/);
  const duplicate = retainedResponse();
  duplicate.response.mediaSets[0]!.manifest.assets[1]!.position = "FIRST";
  assert.throws(() => assessRetainedMediaResponse(duplicate.response, duplicate.eventId), /five distinct/);

  const duplicateResponse = retainedResponse();
  const first = duplicateResponse.response.mediaSets[0]!.assets[0]!.asset;
  duplicateResponse.response.mediaSets[0]!.assets = Array.from({length: 5}, () => ({
    asset: first,
    path: `media/${duplicateResponse.eventId}/${Buffer.from("camera-01").toString("base64url")}/frame-01.jpg`,
  }));
  assert.throws(() => assessRetainedMediaResponse(duplicateResponse.response, duplicateResponse.eventId),
    /duplicate frame position/);

  const wrongCameraPath = retainedResponse();
  wrongCameraPath.response.mediaSets[0]!.assets[0]!.path =
    `media/${wrongCameraPath.eventId}/another-camera/frame-01.jpg`;
  assert.throws(() => assessRetainedMediaResponse(wrongCameraPath.response, wrongCameraPath.eventId),
    /event whitelist/);

  const wrongManifestPath = retainedResponse();
  wrongManifestPath.response.mediaSets[0]!.manifestPath =
    `media/${wrongManifestPath.eventId}/another-camera/manifest.json`;
  assert.throws(() => assessRetainedMediaResponse(wrongManifestPath.response, wrongManifestPath.eventId),
    /manifest path does not match/);

  const mismatchedResponseAsset = retainedResponse();
  mismatchedResponseAsset.response.mediaSets[0]!.assets[0]!.asset = {
    ...mismatchedResponseAsset.response.mediaSets[0]!.assets[0]!.asset,
    sourceFrameOrdinal: 5,
  };
  assert.throws(() => assessRetainedMediaResponse(mismatchedResponseAsset.response, mismatchedResponseAsset.eventId),
    /does not match its manifest/);
});

test("retained-media oracle enforces frame and event-wide resource budgets", () => {
  const oversizedFrame = retainedResponse();
  oversizedFrame.response.mediaSets[0]!.manifest.assets[0]!.width = 6000;
  oversizedFrame.response.mediaSets[0]!.manifest.assets[0]!.height = 6000;
  oversizedFrame.response.mediaSets[0]!.assets[0]!.asset.width = 6000;
  oversizedFrame.response.mediaSets[0]!.assets[0]!.asset.height = 6000;
  assert.throws(() => assessRetainedMediaResponse(oversizedFrame.response, oversizedFrame.eventId),
    /decoded-pixel budget/);

  const oversizedEvent = retainedResponse();
  const first = oversizedEvent.response.mediaSets[0]!;
  for (const asset of first.manifest.assets) asset.bytes = 10 * 1024 * 1024;
  for (const asset of first.assets) asset.asset.bytes = 10 * 1024 * 1024;
  const second = structuredClone(first);
  second.manifest.cameraUid = "camera-02";
  second.manifest.mediaSetId = digest(`${oversizedEvent.eventId}\0${second.manifest.laneUid}\0${second.manifest.cameraUid}`);
  const firstToken = Buffer.from("camera-01").toString("base64url");
  const secondToken = Buffer.from("camera-02").toString("base64url");
  second.manifestPath = second.manifestPath.replace(firstToken, secondToken);
  for (const asset of second.assets) asset.path = asset.path.replace(firstToken, secondToken);
  oversizedEvent.response.mediaSets.push(second);
  assert.throws(() => assessRetainedMediaResponse(oversizedEvent.response, oversizedEvent.eventId),
    /event-wide byte budget/);
});

const baselineJpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAACAAIDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAE1/f//Z",
  "base64",
);

test("bounded JPEG oracle parses baseline structure, dimensions, sizes, and hashes", () => {
  assert.deepEqual(parseBaselineJpeg(baselineJpeg), {width: 2, height: 2, components: 3, scans: 1});
  assert.equal(assessJpeg(baselineJpeg, baselineJpeg.length, digest(baselineJpeg), 2, 2), true);
  assert.equal(assessJpeg(baselineJpeg, baselineJpeg.length, digest(baselineJpeg), 3, 2), false);
  assert.equal(assessJpeg(Buffer.from("not-jpeg"), 8, digest("not-jpeg")), false);
});

test("bounded JPEG oracle rejects progressive, truncated, corrupt-length, trailing, and fake fixtures", () => {
  const sof = baselineJpeg.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(sof > 0);
  const progressive = Buffer.from(baselineJpeg);
  progressive[sof + 1] = 0xc2;
  assert.throws(() => parseBaselineJpeg(progressive), /not baseline/);

  const scan = baselineJpeg.indexOf(Buffer.from([0xff, 0xda]));
  assert.ok(scan > 0);
  const arithmetic = Buffer.concat([
    baselineJpeg.subarray(0, scan),
    Buffer.from([0xff, 0xcc, 0x00, 0x04, 0x00, 0x00]),
    baselineJpeg.subarray(scan),
  ]);
  assert.throws(() => parseBaselineJpeg(arithmetic), /arithmetic coding/);

  assert.throws(() => parseBaselineJpeg(baselineJpeg.subarray(0, -1)), /truncated|missing/);
  const quantization = baselineJpeg.indexOf(Buffer.from([0xff, 0xdb]));
  assert.ok(quantization > 0);
  const corruptLength = Buffer.from(baselineJpeg);
  corruptLength[quantization + 2] = 0xff;
  corruptLength[quantization + 3] = 0xff;
  assert.throws(() => parseBaselineJpeg(corruptLength), /exceeds/);
  assert.throws(() => parseBaselineJpeg(Buffer.concat([baselineJpeg, Buffer.from([0x00])])), /trailing/);
  assert.equal(assessJpeg(Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]), 5,
    digest(Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]))), false);
});

test("daily-file oracle verifies sizes, counts, and hashes", () => {
  const csv = Buffer.from("a,b\nc,d\n");
  const manifest = {schemaVersion: 1, laneId: "Lane01", windowStartInclusive: "2026-10-16T04:00:00Z",
    windowEndExclusive: "2026-10-17T04:00:00Z", dataFile: "Lane01_2026-10-16.csv",
    recordCount: 2, byteCount: csv.length, sha256: digest(csv)};
  assert.equal(assessDailyFilePublication(manifest, csv, "Lane01").recordCount, 2);
  assert.throws(() => assessDailyFilePublication({...manifest, recordCount: 3}, csv), /record count/);
});

test("platform/metric contracts preserve PostgreSQL, archive, and batch counters", () => {
  const deploymentId = "123e4567-e89b-42d3-a456-426614174000";
  const image = {reference: "oscar:3.9.2", imageId: `sha256:${"a".repeat(64)}`,
    containerImageId: `sha256:${"a".repeat(64)}`, repoDigests: [], versionLabel: "3.9.2",
    storageProfileLabel: ""};
  const helper = {helperPath: "/usr/local/bin/oscar-archive-object",
    packagedSha256: "b".repeat(64), deployedSha256: "b".repeat(64), regularExecutable: true,
    cliExportIntegrated: true, cliPurgeIntegrated: true};
  const root = (rootKind: string, rootGroup: number, rootMode: string) => ({
    format: "oscar-storage-root-identity", version: "1", deploymentId, rootKind,
    adoption: "new", claimedAt: "2026-10-17T12:00:00Z", adoptedAt: "none", adoptedBy: "none",
    markerOwner: 0, markerGroup: 0, markerMode: "600", rootOwner: 0, rootGroup, rootMode, exact: true,
  });
  const platform = assessStoragePlatform({expectedRelease: "3.9.2", configuredRelease: "3.9.2",
    templateRelease: "3.9.2", deploymentId, backupMode: "single",
    storageRoots: {archive: root("archive", 10001, "1770"), backup: root("backup", 0, "700"),
    },
    storageLock: {directory: "/run/lock/oscar-storage", file: `/run/lock/oscar-storage/${deploymentId}.lock`,
      stablePath: true, private: true, behaviorTested: true, concurrentRejected: true},
    postgresWal: {archiveMode: "off", archiveTimeout: "0", archiveCommand: "(disabled)",
      archiveCommandInactive: true, externalWalMountAbsent: true},
    legacyWalArchive: {configured: false, present: false, bytes: 0},
    archiveObjectHelper: helper, appImage: image,
    restoreHelpers: {
      prepare: {...helper, helperPath: "/usr/local/bin/oscar-prepare-restore"},
    },
    atomicPublisher: {helperPath: "/usr/local/bin/oscar-atomic-publish",
      sourceStampPath: "/usr/local/share/oscar-atomic-publish.source.sha256",
      packagedSourceSha256: "c".repeat(64), deployedSourceSha256: "c".repeat(64),
      deployedBinarySha256: "d".repeat(64), regularExecutable: true, sourceStampRegular: true,
      behaviorTested: true, firstPublishSucceeded: true, collisionRejected: true,
      sourcePreserved: true, destinationPreserved: true},
    backupIsolation: {appBackupRootAbsent: true, postgresBackupRootAbsent: true,
      isolatedBasebackupWired: true},
    nativeRuntime: {
      entrypointPath: "/usr/local/bin/oscar-entrypoint",
      packagedEntrypointSha256: "e".repeat(64), deployedEntrypointSha256: "e".repeat(64),
      entrypointRegularExecutable: true, containerEntrypointExact: true,
      managedPropertiesAfterJavaOpts: true,
      tmpPath: "/tmp", tmpMountType: "tmpfs", tmpReadWrite: true, tmpNoexec: true,
      tmpNosuid: true, tmpNodev: true,
      nativePath: "/run/oscar-native", nativeMountType: "tmpfs", nativeReadWrite: true,
      nativeNoexecAbsent: true, nativeNosuid: true, nativeNodev: true,
      nativeDirectory: true, nativeExecutable: true,
      runtimeUid: 10001, runtimeGid: 10001, nativeOwnerUid: 10001, nativeOwnerGid: 10001,
      nativeMode: "700", nativeSizeBytes: 256 * 1024 * 1024,
      javaProcessCount: 1, javaTmpPropertyCount: 1, effectiveJavaTmp: "/run/oscar-native",
      javaCppCachePropertyCount: 1, effectiveJavaCppCache: "/run/oscar-native/javacpp",
      dataTmpPropertyCount: 1, effectiveDataTmp: "/tmp",
    },
    postgisImage: {...image, reference: "oscar-postgis:3.9.2", storageProfileLabel: "3.9.2"},
    gatewayImage: {...image, reference: "nginxinc/nginx-unprivileged:1.28.1-alpine", versionLabel: ""},
    dataChecksums: "on", pgStatStatementsInstalled: true,
    pgStatStatementsPreloaded: true, schemaVersion: 5,
    schemaChecksum: OSCAR_STORAGE_SCHEMA_CHECKSUM,
    archiveMarker: {present: true, exact: true, format: "oscar-storage-profile", version: "3.9.2",
      dataChecksums: "on", initializedAt: "2026-10-17T12:00:00Z"},
    batchRewriteConfigured: true, batchRewriteObservedCalls: 2,
    batchRewriteObservedRows: 100, dailyJournalConfigured: true, archiveEnabled: true,
    storageMode: "PARQUET_PRIMARY", parquetPrimaryArchiveDelayMinutes: 5,
    immutableStageWindowMinutes: 30, maximumFuturePhenomenonSkewMinutes: 5,
    parquetPrimaryIntervalMinutes: 1, maximumStagePartitionsPerCycle: 8,
    archiveIntervalMinutes: 60, maximumGenerationsPerCycle: 2,
    maximumVerificationsPerCycle: 2, maximumDeletionsPerCycle: 2,
    outputNames: ["gammaCounts", "gammaThreshold", "neutronCounts", "setupGamma", "setupNeutron",
      "speed", "backgroundReport", "foregroundReport", "status",
      "emlContextual", "emlScanContextual", "emlAnalysis", "dailyFile",
      "connectionStatus", "occupancyStatus", "tamper", "occupancy",
      "adjudication", "report", "siteStatistics", "nationalSummary"],
    observationIndexes: {genericPayloadGinAbsent: true, requiredCount: 15,
      requiredPresent: 15, missingNames: [], eventPathGinExact: true,
      numericEventIndexesExact: true},
    hotRetentionDays: 1, deleteHotAfterArchive: true, rollbackGraceDays: 1,
    packagedDefaults: {archiveEnabled: true, storageMode: "PARQUET_PRIMARY",
      parquetPrimaryArchiveDelayMinutes: 5, immutableStageWindowMinutes: 30,
      maximumFuturePhenomenonSkewMinutes: 5, parquetPrimaryIntervalMinutes: 1,
      maximumStagePartitionsPerCycle: 8, archiveIntervalMinutes: 60,
      hotRetentionDays: 2, rollbackGraceDays: 3,
      maximumGenerationsPerCycle: 2, maximumVerificationsPerCycle: 2,
      maximumDeletionsPerCycle: 2,
      outputNames: ["gammaCounts", "gammaThreshold", "neutronCounts", "setupGamma", "setupNeutron",
        "speed", "backgroundReport", "foregroundReport", "status",
        "emlContextual", "emlScanContextual", "emlAnalysis", "dailyFile",
        "connectionStatus", "occupancyStatus", "tamper", "occupancy",
        "adjudication", "report", "siteStatistics", "nationalSummary"],
      deleteHotAfterArchive: true, videoRetentionDays: 0, videoQueryPeriodMinutes: 5,
      maximumCatchUpHours: 6, lateArrivalOverlapHours: 24,
      lateArrivalScanPeriodMinutes: 360, lateArrivalCatchUpHours: 2,
      reconciliationCatchUpHours: 24, reconciliationPeriodHours: 24,
      occupancyStreamRefreshMinutes: 15, retainedFrameCount: 5,
      jpegQuality: 85, sourceRollbackGraceHours: 24,
      metadataReclamationWorkLimit: 200, maintenanceWorkLimit: 200,
      frameRetentionEnabled: true, sealedJournalRetentionDays: 30,
      requireBackupBeforeSealedJournalDeletion: false},
    archiveResources: {memoryLimitMegabytes: 256, threads: 2,
      maximumTemporaryMegabytes: 4096, maximumConcurrentSessions: 2,
      sessionAcquireTimeoutSeconds: 30, temporaryDirectory: "/var/lib/oscar/duckdb-tmp"},
    archiveScratch: {present: true, realDirectory: true, ownerUid: 10001, ownerGid: 10001,
      mode: "700", archiveDisjoint: true, leaseFilePresent: true, leaseFileRegular: true,
      leaseFileOwnerUid: 10001, leaseFileOwnerGid: 10001, leaseFileMode: "600",
      entryCount: 0, unexpectedEntryCount: 0},
    dailyJournal: {rootDirectory: "files", journalDirectory: ".dailyfile-journal",
      publicationDirectory: "dailyfiles", zoneId: "UTC", observationMode: "LATEST",
      fsyncIntervalMillis: 1000, maxUnforcedRecords: 128, maxUnforcedBytes: 1048576,
      maxSegmentBytes: 67108864, maxSegmentAgeSeconds: 900, maxRecordBytes: 4194304,
      sealedJournalRetentionDays: 30, requireBackupBeforeSealedJournalDeletion: false,
      observationLifecycleDelegated: true, purgeWorkLimit: 50},
    videoRetention: {enabled: true, timeToRetentionDays: 0, queryPeriodMinutes: 1,
      maximumCatchUpHours: 6, lateArrivalOverlapHours: 24,
      lateArrivalScanPeriodMinutes: 360, lateArrivalCatchUpHours: 2,
      reconciliationCatchUpHours: 24, reconciliationPeriodHours: 24,
      occupancyStreamRefreshMinutes: 15,
      frameCount: 5, jpegQuality: 85, sourceRollbackGraceHours: 24,
      metadataReclamationWorkLimit: 200, maintenanceWorkLimit: 200}});
  assert.equal(platform.schemaVersion, 5);
  assert.equal(platform.appImage.imageId, platform.appImage.containerImageId);
  assert.equal(platform.archiveMarker.exact, true);
  assert.equal(platform.backupMode, "single");
  assert.equal(platform.nativeRuntime.nativeSizeBytes, 256 * 1024 * 1024);
  assert.deepEqual(platform.videoRetention, {enabled: true, timeToRetentionDays: 0,
    queryPeriodMinutes: 1, maximumCatchUpHours: 6, lateArrivalOverlapHours: 24,
    lateArrivalScanPeriodMinutes: 360, lateArrivalCatchUpHours: 2,
    reconciliationCatchUpHours: 24, reconciliationPeriodHours: 24,
    occupancyStreamRefreshMinutes: 15, frameCount: 5, jpegQuality: 85, sourceRollbackGraceHours: 24,
    metadataReclamationWorkLimit: 200, maintenanceWorkLimit: 200});
  assert.deepEqual(platform.archiveResources, {memoryLimitMegabytes: 256, threads: 2,
    maximumTemporaryMegabytes: 4096, maximumConcurrentSessions: 2,
    sessionAcquireTimeoutSeconds: 30, temporaryDirectory: "/var/lib/oscar/duckdb-tmp"});
  assert.equal(archiveScratchIsSafe(platform.archiveScratch), true);
  assert.equal(storagePlatformHasExactReleaseIdentity(platform, "3.9.2"), true);
  assert.equal(storagePlatformHasExactReleaseIdentity(
    {...platform, configuredRelease: "4.0.0"},
    "3.9.2",
  ), false);
  assert.equal(storagePlatformHasExactReleaseIdentity(
    {...platform, schemaVersion: 6},
    "3.9.2",
  ), false);
  assert.equal(storagePlatformHasExactReleaseIdentity(
    {...platform, schemaChecksum: `sha256:${"0".repeat(64)}`},
    "3.9.2",
  ), false);
  const activeScratch = {...platform.archiveScratch, entryCount: 1};
  assert.equal(archiveScratchIsSafe(activeScratch), false);
  assert.equal(storagePlatformHasExactReleaseIdentity(
    {...platform, archiveScratch: activeScratch},
    "3.9.2",
  ), true, "release identity permits a transient active operation; scenario hygiene must poll empty");
  assert.equal(storagePlatformHasExactReleaseIdentity(
    {...platform, archiveResources: {...platform.archiveResources, maximumConcurrentSessions: 3}},
    "3.9.2",
  ), false);
  assert.equal(storagePlatformHasExactReleaseIdentity(
    {...platform, archiveResources: {...platform.archiveResources, sessionAcquireTimeoutSeconds: 31}},
    "3.9.2",
  ), false);
  assert.equal(storagePlatformHasExactReleaseIdentity(
    {...platform, dailyJournal: {...platform.dailyJournal, observationMode: "FULL"}},
    "3.9.2",
  ), false);
  assert.equal(storagePlatformHasExactReleaseIdentity(
    {...platform, dailyJournal: {
      ...platform.dailyJournal, requireBackupBeforeSealedJournalDeletion: true}},
    "3.9.2",
  ), false, "disabled-by-default backup must not leave private journals unbounded");
  assert.equal(storagePlatformHasExactReleaseIdentity(
    {...platform, packagedDefaults: {
      ...platform.packagedDefaults, requireBackupBeforeSealedJournalDeletion: true}},
    "3.9.2",
  ), false, "the packaged lifecycle must expose the no-backup journal policy");
  assert.equal(storagePlatformHasExactReleaseIdentity(
    {...platform, archiveMarker: {...platform.archiveMarker, initializedAt: "not-an-instant"}},
    "3.9.2",
  ), false);
  assert.equal(storagePlatformHasExactReleaseIdentity(
    {...platform, storageRoots: {...platform.storageRoots,
      backup: {...platform.storageRoots.backup!, rootKind: "archive"}}},
    "3.9.2",
  ), false);
  assert.equal(storagePlatformHasExactReleaseIdentity(
    {...platform, postgresWal: {...platform.postgresWal, archiveMode: "on"}},
    "3.9.2",
  ), false);
  assert.equal(storagePlatformHasExactReleaseIdentity(
    {...platform, postgresWal: {...platform.postgresWal, externalWalMountAbsent: false}},
    "3.9.2",
  ), false);
  assert.equal(storagePlatformHasExactReleaseIdentity(
    {...platform, storageLock: {...platform.storageLock, concurrentRejected: false}},
    "3.9.2",
  ), false);
  assert.equal(storagePlatformHasExactReleaseIdentity(
    {...platform, archiveObjectHelper: {...platform.archiveObjectHelper, cliPurgeIntegrated: false}},
    "3.9.2",
  ), false);
  assert.equal(storagePlatformHasExactReleaseIdentity(
    {...platform, atomicPublisher: {...platform.atomicPublisher, collisionRejected: false}},
    "3.9.2",
  ), false);
  assert.equal(storagePlatformHasExactReleaseIdentity(
    {...platform, atomicPublisher: {...platform.atomicPublisher,
      deployedSourceSha256: "e".repeat(64)}},
    "3.9.2",
  ), false);
  assert.equal(storagePlatformHasExactReleaseIdentity(
    {...platform, backupIsolation: {...platform.backupIsolation,
      postgresBackupRootAbsent: false}},
    "3.9.2",
  ), false);
  for (const nativeRuntime of [
    {...platform.nativeRuntime, deployedEntrypointSha256: "f".repeat(64)},
    {...platform.nativeRuntime, entrypointRegularExecutable: false},
    {...platform.nativeRuntime, containerEntrypointExact: false},
    {...platform.nativeRuntime, managedPropertiesAfterJavaOpts: false},
    {...platform.nativeRuntime, tmpNoexec: false},
    {...platform.nativeRuntime, nativeMountType: "overlay"},
    {...platform.nativeRuntime, nativeNoexecAbsent: false},
    {...platform.nativeRuntime, nativeExecutable: false},
    {...platform.nativeRuntime, nativeMode: "755"},
    {...platform.nativeRuntime, nativeOwnerUid: 0},
    {...platform.nativeRuntime, nativeSizeBytes: 512 * 1024 * 1024},
    {...platform.nativeRuntime, javaProcessCount: 2},
    {...platform.nativeRuntime, javaTmpPropertyCount: 0},
    {...platform.nativeRuntime, effectiveJavaTmp: "/tmp"},
    {...platform.nativeRuntime, javaCppCachePropertyCount: 0},
    {...platform.nativeRuntime, effectiveJavaCppCache: "/var/lib/oscar/.javacpp/cache"},
    {...platform.nativeRuntime, dataTmpPropertyCount: 0},
    {...platform.nativeRuntime, effectiveDataTmp: "/run/oscar-native"},
  ]) {
    assert.equal(storagePlatformHasExactReleaseIdentity({...platform, nativeRuntime}, "3.9.2"), false);
  }
  const disabled = {...platform, backupMode: "disabled" as const,
    storageRoots: {...platform.storageRoots, backup: null}};
  assert.equal(storagePlatformHasExactReleaseIdentity(disabled, "3.9.2", "disabled"), true);
  assert.equal(storagePlatformHasExactReleaseIdentity(disabled, "3.9.2", "single"), false);
  const metric = storageMetricFromProbe("batch", {databaseSizeBytes: "100", observationInsertCalls: 2,
    observationInsertRows: 20, observationRowsPerCall: 10});
  assert.equal(metric.databaseSizeBytes, 100);
  assert.equal(metric.observationRowsPerCall, 10);
});

test("archive scratch and retained-media metadata contracts fail closed", () => {
  const safeScratch = assessArchiveScratch({present: true, realDirectory: true,
    ownerUid: 10001, ownerGid: 10001, mode: "700", archiveDisjoint: true,
    leaseFilePresent: true, leaseFileRegular: true, leaseFileOwnerUid: 10001,
    leaseFileOwnerGid: 10001, leaseFileMode: "600", entryCount: 0,
    unexpectedEntryCount: 0});
  assert.equal(archiveScratchIsSafe(safeScratch), true);
  const absentScratch = assessArchiveScratch({present: false, realDirectory: false,
    ownerUid: null, ownerGid: null, mode: "", archiveDisjoint: true,
    leaseFilePresent: false, leaseFileRegular: false, leaseFileOwnerUid: null,
    leaseFileOwnerGid: null, leaseFileMode: "", entryCount: 0, unexpectedEntryCount: 0});
  assert.equal(archiveScratchIsSafe(absentScratch), false,
    "the permanent product lease is required even before the first operation");
  for (const unsafeLease of [
    {...safeScratch, leaseFilePresent: false},
    {...safeScratch, leaseFileRegular: false},
    {...safeScratch, leaseFileOwnerUid: 0},
    {...safeScratch, leaseFileOwnerGid: 0},
    {...safeScratch, leaseFileMode: "644"},
  ]) assert.equal(archiveScratchIsSafe(unsafeLease), false);
  assert.equal(archiveScratchIsSafe({...safeScratch, unexpectedEntryCount: 1}), false);
  assert.equal(archiveScratchIsSafe({...safeScratch, entryCount: 1}), false);
  const metadataHealth = assessMediaMetadataHealth({rootPresent: true, checkpointPresent: true,
    checkpointValid: true, checkpointSchemaVersion: 2,
    totalEntries: 100_001, regularFiles: 90_001, directories: 10_000, processedIndexFiles: 1,
    processedIndexBytes: 52, deletionIndexFiles: 0, deletionIndexBytes: 0,
    retainedManifestFiles: 1, retainedJpegFiles: 5, legacyProcessedMarkerFiles: 0,
    legacyDeletionTombstones: 0, partialArtifacts: 0, unsafeEntries: 0,
    indexFormatFailures: 0});
  assert.equal(mediaMetadataHealthIsSafe(metadataHealth, true), true);
  assert.equal(mediaMetadataHealthIsSafe({...metadataHealth, totalEntries: 100_002}, true), false);
  assert.equal(mediaMetadataHealthIsSafe({...metadataHealth, indexFormatFailures: 1}, false), false);
  assert.equal(mediaMetadataHealthIsSafe({...metadataHealth, checkpointSchemaVersion: 1}, true), false);
  assert.equal(mediaMetadataHealthIsSafe({...metadataHealth, checkpointPresent: false,
    checkpointValid: false, checkpointSchemaVersion: null}, false), false);
  assert.equal(mediaMetadataHealthIsSafe({...metadataHealth, retainedJpegFiles: 4}, true), false);
});

test("restart scratch oracle rejects every surviving pre-restart identity", () => {
  const before = "cold-query-11111111-1111-4111-8111-111111111111";
  const afterOnly = "metadata-query-22222222-2222-4222-8222-222222222222";
  const newOnly = assessArchiveScratchRestart({
    scratchBeforeRestartCount: 1,
    scratchAfterRestartCount: 1,
    staleScratchAfterRestartCount: 0,
    scratchBeforeRestart: [before],
    scratchAfterRestart: [afterOnly],
    staleScratchAfterRestart: [],
  });
  assert.equal(archiveScratchRestartIsSafe(newOnly), true,
    "a genuinely new post-start session must be allowed");

  const survivor = assessArchiveScratchRestart({
    scratchBeforeRestartCount: 1,
    scratchAfterRestartCount: 2,
    staleScratchAfterRestartCount: 1,
    scratchBeforeRestart: [before],
    scratchAfterRestart: [before, afterOnly],
    staleScratchAfterRestart: [before],
  });
  assert.equal(archiveScratchRestartIsSafe(survivor), false);

  assert.throws(() => assessArchiveScratchRestart({
    scratchBeforeRestartCount: 1,
    scratchAfterRestartCount: 2,
    staleScratchAfterRestartCount: 0,
    scratchBeforeRestart: [before],
    scratchAfterRestart: [before, afterOnly],
    staleScratchAfterRestart: [],
  }), /exact pre\/post identity intersection/);
  assert.throws(() => assessArchiveScratchRestart({
    scratchBeforeRestartCount: 1,
    scratchAfterRestartCount: 0,
    staleScratchAfterRestartCount: 0,
    scratchBeforeRestart: ["../unsafe"],
    scratchAfterRestart: [],
    staleScratchAfterRestart: [],
  }), /canonical DuckDB scratch identity/);
});

test("retained-media runtime requires a valid current durable scan cursor", () => {
  const runtime = assessRetentionRuntimeHealth({checkpointPresent: true,
    checkpointValid: true, checkpointSchemaVersion: 1,
    processedThrough: "2026-10-19T19:00:00Z", updatedAt: "2026-10-19T19:01:00Z",
    cursorLagSeconds: 120});
  assert.equal(retentionRuntimeReady(runtime, 180), true);
  assert.equal(retentionRuntimeReady({...runtime, cursorLagSeconds: 181}, 180), false);
  assert.equal(retentionRuntimeReady({...runtime, checkpointValid: false}, 180), false);
  assert.equal(retentionRuntimeReady({...runtime, checkpointSchemaVersion: 2}, 180), false);
  assert.throws(() => assessRetentionRuntimeHealth({...runtime, processedThrough: "invalid"}),
    /ISO timestamp/);
});

test("archive health counts partial archive and WAL artifacts independently", () => {
  const health = assessArchiveHealth({activeGenerations: 1, sealedGenerations: 2, archiveRows: 3,
    archiveBytes: 4, failedJobs: 0, parityFailures: 0, activeHolds: 0,
    incompleteActiveObjects: 0, archivePartialArtifacts: 1, walPartialArtifacts: 2,
    checksumVerificationPassed: true});
  assert.equal(health.archivePartialArtifacts, 1);
  assert.equal(health.walPartialArtifacts, 2);
});

test("immutable-stage health requires exact ownership and mutable-only parent rows", () => {
  const healthy = assessImmutableStageHealth({
    applicable: true, storageMode: "PARQUET_PRIMARY", attachedChildCount: 2,
    detachedChildCount: 0, stageRowCount: 12,
    oldestReceivedAt: "2026-10-25T12:00:00.000000Z", oldestReceivedAtAgeSeconds: 900,
    stagingSloSeconds: 3600, stagingSloExceeded: false, exactSidecarOwnerCount: 8,
    ownedStageRowCount: 8, attachedUnownedRowCount: 4, detachedUnownedRowCount: 0,
    orphanRegistryOwnerCount: 0, orphanGenerationOwnerCount: 0,
    ownersMissingPhysicalRowCount: 0, markerNonNullRowCount: 0,
    immutableRouteMismatchRowCount: 0, parentOnlyRowCount: 3, parentImmutableRowCount: 0,
    missingRelationCount: 0, inheritanceMismatchCount: 0, sampleConsistent: true,
  });
  assert.equal(immutableStageHealthIsSafe(healthy), true);
  assert.equal(immutableStageHealthIsSafe({...healthy, markerNonNullRowCount: 1}), false);
  assert.equal(immutableStageHealthIsSafe({...healthy, detachedUnownedRowCount: 1,
    stageRowCount: 13}), false);
  assert.equal(immutableStageHealthIsSafe({...healthy, parentImmutableRowCount: 1}), false);
  assert.equal(immutableStageHealthIsSafe({...healthy, oldestReceivedAtAgeSeconds: 3601,
    stagingSloExceeded: true}), false);

  const hotRetention = assessImmutableStageHealth({applicable: false,
    storageMode: "HOT_RETENTION"});
  assert.equal(immutableStageHealthIsSafe(hotRetention), true);
});

test("OSH BigId encoding is deterministic and rejects unsafe IDs", () => {
  assert.equal(encodeOshBigId(4, 1n), "0g0g");
  assert.equal(encodeOshBigId(4, 300n), "0im04");
  assert.throws(() => encodeOshBigId(-1, 1n), /scope/);
  assert.throws(() => encodeOshBigId(4, 0n), /positive/);
});
