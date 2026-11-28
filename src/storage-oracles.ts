import {createHash} from "node:crypto";
import type {BackupMode, StorageMetricSample} from "./types.js";
import {isCanonicalProductUuid} from "./product-uuid.js";
import {publicObservationId} from "./public-observation-id.js";

export const RETAINED_FRAME_POSITIONS = [
  "FIRST", "QUARTER", "MIDDLE", "THREE_QUARTERS", "LAST",
] as const;
export const MAX_RETAINED_MEDIA_SETS = 8;
export const MAX_RETAINED_FRAME_BYTES = 12 * 1024 * 1024;
export const MAX_RETAINED_FRAME_DIMENSION = 6000;
export const MAX_RETAINED_FRAME_PIXELS = 20_000_000;
export const MAX_RETAINED_EVENT_BYTES = 64 * 1024 * 1024;
export const MAX_RETAINED_EVENT_PIXELS = 120_000_000;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DUCKDB_SCRATCH_ID_PATTERN =
  /^[a-z][a-z0-9-]{0,31}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_DUCKDB_SCRATCH_IDENTITIES = 512;

export const OSCAR_STORAGE_SCHEMA_VERSION = 5;
export const OSCAR_STORAGE_SCHEMA_CHECKSUM =
  "sha256:b37753a17c972d57418545c05a2544068affc7804b8622db3a0f0c4b422c63b5";

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be text`);
  return value;
}

function integer(value: unknown, field: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return Number(value);
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function sha256(value: unknown, field: string): string {
  const result = text(value, field);
  if (!SHA256_PATTERN.test(result)) throw new Error(`${field} must be a lowercase SHA-256`);
  return result;
}

function instant(value: unknown, field: string): string {
  const result = text(value, field);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${field} must be an ISO timestamp`);
  return result;
}

export interface RetainedMediaAssessment {
  mediaSetCount: number;
  frameCount: number;
  cameraUids: string[];
  jpegQualities: number[];
  paths: string[];
  assets: Array<{
    path: string;
    bytes: number;
    sha256: string;
    width: number;
    height: number;
    contentType: "image/jpeg";
  }>;
  declaredBytes: number;
  declaredPixels: number;
  mediaSets: Array<{
    laneUid: string;
    cameraUid: string;
    manifestPath: string;
    sourceObjectKey: string;
    sourceState: "PRESERVED_FOR_ROLLBACK" | "ELIGIBLE_FOR_DELETION" | "DELETED";
    lifecycleState: "AVAILABLE" | "HELD";
  }>;
}

/** Strictly validates the authenticated event-scoped retained-media contract. */
export function assessRetainedMediaResponse(
  value: unknown,
  expectedEventId: string,
): RetainedMediaAssessment {
  const eventId = publicObservationId(expectedEventId, "retained-media public observation ID");
  const response = object(value, "retained-media response");
  if (response.schemaVersion !== 1) throw new Error("retained-media schemaVersion must be 1");
  if (publicObservationId(response.eventId, "retained-media response public observation ID") !== eventId) {
    throw new Error("retained-media eventId does not match");
  }
  if (!Array.isArray(response.mediaSets) || response.mediaSets.length < 1 ||
      response.mediaSets.length > MAX_RETAINED_MEDIA_SETS) {
    throw new Error(`retained-media response must contain 1-${MAX_RETAINED_MEDIA_SETS} media sets`);
  }

  const setIds = new Set<string>();
  const cameraUidSet = new Set<string>();
  const cameraUids: string[] = [];
  const jpegQualities: number[] = [];
  const paths: string[] = [];
  const assets: RetainedMediaAssessment["assets"] = [];
  const mediaSets: RetainedMediaAssessment["mediaSets"] = [];
  let frameCount = 0;
  let declaredBytes = 0;
  let declaredPixels = 0;
  response.mediaSets.forEach((rawSet, setIndex) => {
    const mediaSet = object(rawSet, `mediaSets[${setIndex}]`);
    const manifest = object(mediaSet.manifest, `mediaSets[${setIndex}].manifest`);
    if (manifest.schemaVersion !== 1 ||
        publicObservationId(
          manifest.eventId,
          `mediaSets[${setIndex}] manifest public observation ID`,
        ) !== eventId) {
      throw new Error(`mediaSets[${setIndex}] manifest identity is invalid`);
    }
    const laneUid = text(manifest.laneUid, `mediaSets[${setIndex}].manifest.laneUid`);
    const cameraUid = text(manifest.cameraUid, `mediaSets[${setIndex}].manifest.cameraUid`);
    const mediaSetId = sha256(manifest.mediaSetId, `mediaSets[${setIndex}].manifest.mediaSetId`);
    const expectedMediaSetId = createHash("sha256")
      .update(`${eventId}\0${laneUid}\0${cameraUid}`, "utf8")
      .digest("hex");
    if (mediaSetId !== expectedMediaSetId || setIds.has(mediaSetId)) {
      throw new Error(`mediaSets[${setIndex}] has an invalid or duplicate deterministic mediaSetId`);
    }
    setIds.add(mediaSetId);
    if (cameraUidSet.has(cameraUid)) {
      throw new Error(`mediaSets[${setIndex}] has an invalid or duplicate cameraUid`);
    }
    cameraUidSet.add(cameraUid);
    cameraUids.push(cameraUid);
    const cameraToken = Buffer.from(cameraUid, "utf8").toString("base64url");
    const manifestPath = text(mediaSet.manifestPath, `mediaSets[${setIndex}].manifestPath`);
    if (manifestPath !== `media/${eventId}/${cameraToken}/manifest.json`) {
      throw new Error(`mediaSets[${setIndex}] manifest path does not match its cameraUid`);
    }
    jpegQualities.push(integer(
      manifest.jpegQuality,
      `mediaSets[${setIndex}].manifest.jpegQuality`,
      1,
      100,
    ));
    const source = object(manifest.source, `mediaSets[${setIndex}].manifest.source`);
    const sourceObjectKey = text(source.objectKey, `mediaSets[${setIndex}].manifest.source.objectKey`)
      .replaceAll("\\", "/");
    const sourceState = text(source.state, `mediaSets[${setIndex}].manifest.source.state`);
    if (!["PRESERVED_FOR_ROLLBACK", "ELIGIBLE_FOR_DELETION", "DELETED"].includes(sourceState)) {
      throw new Error(`mediaSets[${setIndex}] has an unsupported source state`);
    }
    const lifecycleState = text(manifest.lifecycleState, `mediaSets[${setIndex}].manifest.lifecycleState`);
    if (!["AVAILABLE", "HELD"].includes(lifecycleState)) {
      throw new Error(`mediaSets[${setIndex}] is not available to the authenticated media API`);
    }
    sha256(source.sha256, `mediaSets[${setIndex}].manifest.source.sha256`);
    integer(source.bytes, `mediaSets[${setIndex}].manifest.source.bytes`, 1);
    instant(source.rollbackDeleteAfter, `mediaSets[${setIndex}].manifest.source.rollbackDeleteAfter`);
    mediaSets.push({
      laneUid,
      cameraUid,
      manifestPath,
      sourceObjectKey,
      sourceState: sourceState as RetainedMediaAssessment["mediaSets"][number]["sourceState"],
      lifecycleState: lifecycleState as RetainedMediaAssessment["mediaSets"][number]["lifecycleState"],
    });
    if (!Array.isArray(manifest.assets) || manifest.assets.length !== 5 ||
        !Array.isArray(mediaSet.assets) || mediaSet.assets.length !== 5) {
      throw new Error(`mediaSets[${setIndex}] must contain exactly five manifest and response assets`);
    }
    const positions = new Set<string>();
    const ordinals = new Set<number>();
    const canonicalAssets = new Map<string, {
      sourceFrameOrdinal: number;
      sha256: string;
      bytes: number;
      width: number;
      height: number;
    }>();
    manifest.assets.forEach((rawAsset, assetIndex) => {
      const asset = object(rawAsset, `mediaSets[${setIndex}].manifest.assets[${assetIndex}]`);
      const position = text(asset.position, `asset ${assetIndex} position`);
      if (!RETAINED_FRAME_POSITIONS.includes(position as typeof RETAINED_FRAME_POSITIONS[number])) {
        throw new Error(`mediaSets[${setIndex}] has an unsupported frame position`);
      }
      positions.add(position);
      const sourceFrameOrdinal = integer(asset.sourceFrameOrdinal, `asset ${assetIndex} ordinal`);
      ordinals.add(sourceFrameOrdinal);
      if (asset.contentType !== "image/jpeg" || asset.state !== "PUBLISHED") {
        throw new Error(`mediaSets[${setIndex}] asset ${assetIndex} is not a published JPEG`);
      }
      const bytes = integer(asset.bytes, `asset ${assetIndex} bytes`, 1, MAX_RETAINED_FRAME_BYTES);
      const width = integer(asset.width, `asset ${assetIndex} width`, 1, MAX_RETAINED_FRAME_DIMENSION);
      const height = integer(asset.height, `asset ${assetIndex} height`, 1, MAX_RETAINED_FRAME_DIMENSION);
      const pixels = width * height;
      if (pixels > MAX_RETAINED_FRAME_PIXELS) {
        throw new Error(`mediaSets[${setIndex}] asset ${assetIndex} exceeds the decoded-pixel budget`);
      }
      const digest = sha256(asset.sha256, `asset ${assetIndex} sha256`);
      canonicalAssets.set(position, {sourceFrameOrdinal, sha256: digest, bytes, width, height});
      declaredBytes += bytes;
      declaredPixels += pixels;
    });
    if (positions.size !== 5 || ordinals.size !== 5 ||
        RETAINED_FRAME_POSITIONS.some(position => !positions.has(position))) {
      throw new Error(`mediaSets[${setIndex}] does not contain five distinct canonical frames`);
    }
    const responsePositions = new Set<string>();
    mediaSet.assets.forEach((rawAsset, assetIndex) => {
      const responseAsset = object(rawAsset, `mediaSets[${setIndex}].assets[${assetIndex}]`);
      const asset = object(responseAsset.asset, `mediaSets[${setIndex}].assets[${assetIndex}].asset`);
      const position = text(asset.position, `response asset ${assetIndex} position`);
      if (responsePositions.has(position)) {
        throw new Error(`mediaSets[${setIndex}] response assets contain a duplicate frame position`);
      }
      responsePositions.add(position);
      const canonical = canonicalAssets.get(position);
      if (!canonical || canonical.sourceFrameOrdinal !== asset.sourceFrameOrdinal ||
          canonical.sha256 !== asset.sha256 || canonical.bytes !== asset.bytes ||
          canonical.width !== asset.width || canonical.height !== asset.height ||
          asset.contentType !== "image/jpeg" || asset.state !== "PUBLISHED") {
        throw new Error(`mediaSets[${setIndex}] response asset does not match its manifest`);
      }
      const path = text(responseAsset.path, `mediaSets[${setIndex}].assets[${assetIndex}].path`);
      const expectedName = `frame-0${RETAINED_FRAME_POSITIONS.indexOf(
        position as typeof RETAINED_FRAME_POSITIONS[number],
      ) + 1}.jpg`;
      const segments = path.split("/");
      if (segments.length !== 4 || segments[0] !== "media" || segments[1] !== eventId ||
          segments[2] !== cameraToken || segments[3] !== expectedName) {
        throw new Error(`mediaSets[${setIndex}] response asset path escapes the event whitelist`);
      }
      paths.push(path);
      assets.push({
        path,
        bytes: integer(asset.bytes, `response asset ${assetIndex} bytes`, 1),
        sha256: sha256(asset.sha256, `response asset ${assetIndex} sha256`),
        width: integer(asset.width, `response asset ${assetIndex} width`, 1),
        height: integer(asset.height, `response asset ${assetIndex} height`, 1),
        contentType: "image/jpeg",
      });
      frameCount++;
    });
    if (responsePositions.size !== RETAINED_FRAME_POSITIONS.length ||
        RETAINED_FRAME_POSITIONS.some(position => !responsePositions.has(position))) {
      throw new Error(`mediaSets[${setIndex}] response assets do not contain five distinct canonical frames`);
    }
  });
  if (new Set(paths).size !== paths.length) throw new Error("retained-media response has duplicate paths");
  if (declaredBytes > MAX_RETAINED_EVENT_BYTES) {
    throw new Error("retained-media response exceeds the event-wide byte budget");
  }
  if (declaredPixels > MAX_RETAINED_EVENT_PIXELS) {
    throw new Error("retained-media response exceeds the event-wide decoded-pixel budget");
  }
  return {mediaSetCount: response.mediaSets.length, frameCount, cameraUids, jpegQualities, paths, assets,
    declaredBytes, declaredPixels, mediaSets};
}

export interface BaselineJpegInfo {
  width: number;
  height: number;
  components: number;
  scans: number;
}

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

/**
 * Parses only the bounded structure needed by OSCAR's retained-frame contract.
 * It rejects progressive/lossless/arithmetic JPEGs, malformed segment lengths,
 * truncated entropy data, multiple scans, trailing bytes, and oversized decoded
 * dimensions. Actual codec decodability is checked separately in Chromium.
 */
export function parseBaselineJpeg(bytes: Buffer): BaselineJpegInfo {
  if (bytes.length < 12 || bytes.length > MAX_RETAINED_FRAME_BYTES) {
    throw new Error("JPEG byte length is outside the retained-frame budget");
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("JPEG has no SOI marker");

  let offset = 2;
  let frame: BaselineJpegInfo | undefined;
  let hasQuantizationTable = false;
  let hasHuffmanTable = false;
  let scans = 0;
  let foundEnd = false;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error("JPEG marker prefix is missing");
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) throw new Error("JPEG ends in marker padding");
    const marker = bytes[offset] ?? 0;
    offset++;
    if (marker === 0x00) throw new Error("JPEG has stuffed data outside a scan");
    if (marker === 0xd9) {
      foundEnd = true;
      if (offset !== bytes.length) throw new Error("JPEG has trailing bytes after EOI");
      break;
    }
    if (marker === 0xd8) throw new Error("JPEG contains a nested SOI marker");
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw new Error("JPEG segment length is truncated");
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      throw new Error("JPEG segment exceeds the bounded input");
    }
    const payloadStart = offset + 2;
    const payloadEnd = offset + segmentLength;

    if (isStartOfFrame(marker)) {
      if (marker !== 0xc0) throw new Error("JPEG is not baseline sequential DCT");
      if (frame) throw new Error("JPEG contains multiple frame headers");
      if (segmentLength < 8) throw new Error("JPEG baseline frame header is truncated");
      const precision = bytes[payloadStart] ?? 0;
      const height = bytes.readUInt16BE(payloadStart + 1);
      const width = bytes.readUInt16BE(payloadStart + 3);
      const components = bytes[payloadStart + 5] ?? 0;
      if (precision !== 8) throw new Error("JPEG baseline precision must be 8 bits");
      if (components !== 3 || segmentLength !== 8 + components * 3) {
        throw new Error("JPEG must contain one three-component baseline frame");
      }
      if (width < 1 || height < 1 || width > MAX_RETAINED_FRAME_DIMENSION ||
          height > MAX_RETAINED_FRAME_DIMENSION || width * height > MAX_RETAINED_FRAME_PIXELS) {
        throw new Error("JPEG decoded dimensions exceed the retained-frame budget");
      }
      frame = {width, height, components, scans: 0};
    } else if (marker === 0xdb) {
      hasQuantizationTable = true;
    } else if (marker === 0xc4) {
      hasHuffmanTable = true;
    } else if (marker === 0xcc) {
      throw new Error("JPEG arithmetic coding is not permitted");
    }

    offset = payloadEnd;
    if (marker !== 0xda) continue;
    scans++;
    if (scans !== 1) throw new Error("JPEG must contain exactly one baseline scan");
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      let markerOffset = offset + 1;
      while (markerOffset < bytes.length && bytes[markerOffset] === 0xff) markerOffset++;
      if (markerOffset >= bytes.length) throw new Error("JPEG entropy data is truncated");
      const scanMarker = bytes[markerOffset] ?? 0;
      if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
        offset = markerOffset + 1;
        continue;
      }
      offset = markerOffset - 1;
      break;
    }
  }
  if (!foundEnd || !frame || scans !== 1 || !hasQuantizationTable || !hasHuffmanTable) {
    throw new Error("JPEG is missing required baseline structure");
  }
  return {...frame, scans};
}

export function assessJpeg(
  bytes: Buffer,
  expectedBytes: number,
  expectedSha256: string,
  expectedWidth?: number,
  expectedHeight?: number,
): boolean {
  if (bytes.length !== expectedBytes ||
      createHash("sha256").update(bytes).digest("hex") !== expectedSha256) return false;
  try {
    const parsed = parseBaselineJpeg(bytes);
    return (expectedWidth === undefined || parsed.width === expectedWidth) &&
      (expectedHeight === undefined || parsed.height === expectedHeight);
  } catch {
    return false;
  }
}

export interface DailyFileManifest {
  schemaVersion: number;
  laneId: string;
  windowStartInclusive: string;
  windowEndExclusive: string;
  dataFile: string;
  recordCount: number;
  byteCount: number;
  sha256: string;
}

export function assessDailyFilePublication(
  manifestValue: unknown,
  csv: Buffer,
  expectedLaneId?: string,
): DailyFileManifest {
  const manifest = object(manifestValue, "daily-file manifest");
  const result: DailyFileManifest = {
    schemaVersion: integer(manifest.schemaVersion, "schemaVersion", 1),
    laneId: text(manifest.laneId, "laneId"),
    windowStartInclusive: instant(manifest.windowStartInclusive, "windowStartInclusive"),
    windowEndExclusive: instant(manifest.windowEndExclusive, "windowEndExclusive"),
    dataFile: text(manifest.dataFile, "dataFile"),
    recordCount: integer(manifest.recordCount, "recordCount"),
    byteCount: integer(manifest.byteCount, "byteCount"),
    sha256: sha256(manifest.sha256, "sha256"),
  };
  if (result.schemaVersion !== 1) throw new Error("daily-file schemaVersion must be 1");
  if (expectedLaneId && result.laneId !== expectedLaneId) throw new Error("daily-file laneId does not match");
  if (Date.parse(result.windowEndExclusive) <= Date.parse(result.windowStartInclusive)) {
    throw new Error("daily-file window must be non-empty");
  }
  if (result.byteCount !== csv.length || createHash("sha256").update(csv).digest("hex") !== result.sha256) {
    throw new Error("daily-file bytes do not match the manifest");
  }
  const records = csv.length === 0 ? 0 : csv.toString("utf8").split(/\r?\n/).filter(Boolean).length;
  if (records !== result.recordCount) throw new Error("daily-file record count does not match the manifest");
  return result;
}

export interface StoragePlatformProbe {
  expectedRelease: string;
  configuredRelease: string;
  templateRelease: string;
  deploymentId: string;
  backupMode: BackupMode;
  storageRoots: {
    archive: StorageRootIdentity;
    backup: StorageRootIdentity | null;
  };
  storageLock: {
    directory: string;
    file: string;
    stablePath: boolean;
    private: boolean;
    behaviorTested: boolean;
    concurrentRejected: boolean;
  };
  postgresWal: {
    archiveMode: string;
    archiveTimeout: string;
    archiveCommand: string;
    archiveCommandInactive: boolean;
    externalWalMountAbsent: boolean;
  };
  legacyWalArchive: {
    configured: boolean;
    present: boolean;
    bytes: number;
  };
  archiveObjectHelper: StorageHelperIdentity & {
    cliExportIntegrated: boolean;
    cliPurgeIntegrated: boolean;
  };
  restoreHelpers: {
    prepare: StorageHelperIdentity;
  };
  atomicPublisher: {
    helperPath: string;
    sourceStampPath: string;
    packagedSourceSha256: string;
    deployedSourceSha256: string;
    deployedBinarySha256: string;
    regularExecutable: boolean;
    sourceStampRegular: boolean;
    behaviorTested: boolean;
    firstPublishSucceeded: boolean;
    collisionRejected: boolean;
    sourcePreserved: boolean;
    destinationPreserved: boolean;
  };
  backupIsolation: {
    appBackupRootAbsent: boolean;
    postgresBackupRootAbsent: boolean;
    isolatedBasebackupWired: boolean;
  };
  nativeRuntime: {
    entrypointPath: string;
    packagedEntrypointSha256: string;
    deployedEntrypointSha256: string;
    entrypointRegularExecutable: boolean;
    containerEntrypointExact: boolean;
    managedPropertiesAfterJavaOpts: boolean;
    tmpPath: string;
    tmpMountType: string;
    tmpReadWrite: boolean;
    tmpNoexec: boolean;
    tmpNosuid: boolean;
    tmpNodev: boolean;
    nativePath: string;
    nativeMountType: string;
    nativeReadWrite: boolean;
    nativeNoexecAbsent: boolean;
    nativeNosuid: boolean;
    nativeNodev: boolean;
    nativeDirectory: boolean;
    nativeExecutable: boolean;
    runtimeUid: number;
    runtimeGid: number;
    nativeOwnerUid: number;
    nativeOwnerGid: number;
    nativeMode: string;
    nativeSizeBytes: number;
    javaProcessCount: number;
    javaTmpPropertyCount: number;
    effectiveJavaTmp: string;
    javaCppCachePropertyCount: number;
    effectiveJavaCppCache: string;
    dataTmpPropertyCount: number;
    effectiveDataTmp: string;
  };
  appImage: StorageImageIdentity;
  postgisImage: StorageImageIdentity;
  gatewayImage: StorageImageIdentity;
  dataChecksums: string;
  pgStatStatementsInstalled: boolean;
  pgStatStatementsPreloaded: boolean;
  schemaVersion: number;
  schemaChecksum: string;
  archiveMarker: {
    present: boolean;
    exact: boolean;
    format: string;
    version: string;
    dataChecksums: string;
    initializedAt: string;
  };
  batchRewriteConfigured: boolean;
  batchRewriteObservedCalls: number;
  batchRewriteObservedRows: number;
  dailyJournalConfigured: boolean;
  archiveEnabled: boolean | null;
  storageMode: string;
  parquetPrimaryArchiveDelayMinutes: number | null;
  immutableStageWindowMinutes: number | null;
  maximumFuturePhenomenonSkewMinutes: number | null;
  parquetPrimaryIntervalMinutes: number | null;
  maximumStagePartitionsPerCycle: number | null;
  archiveIntervalMinutes: number | null;
  hotRetentionDays: number | null;
  deleteHotAfterArchive: boolean | null;
  rollbackGraceDays: number | null;
  maximumGenerationsPerCycle: number | null;
  maximumVerificationsPerCycle: number | null;
  maximumDeletionsPerCycle: number | null;
  outputNames: string[];
  observationIndexes: {
    genericPayloadGinAbsent: boolean;
    requiredCount: number;
    requiredPresent: number;
    missingNames: string[];
    eventPathGinExact: boolean;
    numericEventIndexesExact: boolean;
  };
  packagedDefaults: {
    archiveEnabled: boolean | null;
    storageMode: string;
    parquetPrimaryArchiveDelayMinutes: number | null;
    immutableStageWindowMinutes: number | null;
    maximumFuturePhenomenonSkewMinutes: number | null;
    parquetPrimaryIntervalMinutes: number | null;
    maximumStagePartitionsPerCycle: number | null;
    archiveIntervalMinutes: number | null;
    hotRetentionDays: number | null;
    rollbackGraceDays: number | null;
    maximumGenerationsPerCycle: number | null;
    maximumVerificationsPerCycle: number | null;
    maximumDeletionsPerCycle: number | null;
    outputNames: string[];
    deleteHotAfterArchive: boolean | null;
    videoRetentionDays: number | null;
    videoQueryPeriodMinutes: number | null;
    maximumCatchUpHours: number | null;
    lateArrivalOverlapHours: number | null;
    lateArrivalScanPeriodMinutes: number | null;
    lateArrivalCatchUpHours: number | null;
    reconciliationCatchUpHours: number | null;
    reconciliationPeriodHours: number | null;
    occupancyStreamRefreshMinutes: number | null;
    retainedFrameCount: number | null;
    jpegQuality: number | null;
    sourceRollbackGraceHours: number | null;
    metadataReclamationWorkLimit: number | null;
    maintenanceWorkLimit: number | null;
    frameRetentionEnabled: boolean | null;
    sealedJournalRetentionDays: number | null;
    requireBackupBeforeSealedJournalDeletion: boolean | null;
  };
  archiveResources: {
    memoryLimitMegabytes: number | null;
    threads: number | null;
    maximumTemporaryMegabytes: number | null;
    maximumConcurrentSessions: number | null;
    sessionAcquireTimeoutSeconds: number | null;
    temporaryDirectory: string;
  };
  archiveScratch: ArchiveScratchProbe;
  dailyJournal: {
    rootDirectory: string;
    journalDirectory: string;
    publicationDirectory: string;
    zoneId: string;
    observationMode: string;
    fsyncIntervalMillis: number | null;
    maxUnforcedRecords: number | null;
    maxUnforcedBytes: number | null;
    maxSegmentBytes: number | null;
    maxSegmentAgeSeconds: number | null;
    maxRecordBytes: number | null;
    sealedJournalRetentionDays: number | null;
    requireBackupBeforeSealedJournalDeletion: boolean | null;
    observationLifecycleDelegated: boolean | null;
    purgeWorkLimit: number | null;
  };
  videoRetention: {
    enabled: boolean | null;
    timeToRetentionDays: number | null;
    queryPeriodMinutes: number | null;
    maximumCatchUpHours: number | null;
    lateArrivalOverlapHours: number | null;
    lateArrivalScanPeriodMinutes: number | null;
    lateArrivalCatchUpHours: number | null;
    reconciliationCatchUpHours: number | null;
    reconciliationPeriodHours: number | null;
    occupancyStreamRefreshMinutes: number | null;
    frameCount: number | null;
    jpegQuality: number | null;
    sourceRollbackGraceHours: number | null;
    metadataReclamationWorkLimit: number | null;
    maintenanceWorkLimit: number | null;
  };
}

export interface ImmutableStageHealthProbe {
  applicable: boolean;
  storageMode: string;
  attachedChildCount: number;
  detachedChildCount: number;
  stageRowCount: number;
  oldestReceivedAt: string | null;
  oldestReceivedAtAgeSeconds: number;
  stagingSloSeconds: number;
  stagingSloExceeded: boolean;
  exactSidecarOwnerCount: number;
  ownedStageRowCount: number;
  attachedUnownedRowCount: number;
  detachedUnownedRowCount: number;
  orphanRegistryOwnerCount: number;
  orphanGenerationOwnerCount: number;
  ownersMissingPhysicalRowCount: number;
  markerNonNullRowCount: number;
  immutableRouteMismatchRowCount: number;
  parentOnlyRowCount: number;
  parentImmutableRowCount: number;
  missingRelationCount: number;
  inheritanceMismatchCount: number;
  sampleConsistent: boolean;
}

export interface ArchiveScratchProbe {
  present: boolean;
  realDirectory: boolean;
  ownerUid: number | null;
  ownerGid: number | null;
  mode: string;
  archiveDisjoint: boolean;
  leaseFilePresent: boolean;
  leaseFileRegular: boolean;
  leaseFileOwnerUid: number | null;
  leaseFileOwnerGid: number | null;
  leaseFileMode: string;
  entryCount: number;
  unexpectedEntryCount: number;
}

export interface ArchiveScratchRestartAssessment {
  before: string[];
  after: string[];
  stale: string[];
}

export interface RetentionRuntimeHealthProbe {
  checkpointPresent: boolean;
  checkpointValid: boolean;
  checkpointSchemaVersion: number | null;
  processedThrough: string | null;
  updatedAt: string | null;
  cursorLagSeconds: number | null;
}

export interface MediaMetadataHealthProbe {
  rootPresent: boolean;
  checkpointPresent: boolean;
  checkpointValid: boolean;
  checkpointSchemaVersion: number | null;
  totalEntries: number;
  regularFiles: number;
  directories: number;
  processedIndexFiles: number;
  processedIndexBytes: number;
  deletionIndexFiles: number;
  deletionIndexBytes: number;
  retainedManifestFiles: number;
  retainedJpegFiles: number;
  legacyProcessedMarkerFiles: number;
  legacyDeletionTombstones: number;
  partialArtifacts: number;
  unsafeEntries: number;
  indexFormatFailures: number;
}

export interface StorageRootIdentity {
  format: string;
  version: string;
  deploymentId: string;
  rootKind: string;
  adoption: string;
  claimedAt: string;
  adoptedAt: string;
  adoptedBy: string;
  markerOwner: number;
  markerGroup: number;
  markerMode: string;
  rootOwner: number;
  rootGroup: number;
  rootMode: string;
  exact: boolean;
}

export interface StorageHelperIdentity {
  helperPath: string;
  packagedSha256: string;
  deployedSha256: string;
  regularExecutable: boolean;
}

export interface StorageImageIdentity {
  reference: string;
  imageId: string;
  containerImageId: string;
  repoDigests: string[];
  versionLabel: string;
  storageProfileLabel: string;
}

function rootIdentity(value: unknown, field: string): StorageRootIdentity {
  const marker = object(value, field);
  return {
    format: text(marker.format, `${field}.format`),
    version: text(marker.version, `${field}.version`),
    deploymentId: text(marker.deploymentId, `${field}.deploymentId`),
    rootKind: text(marker.rootKind, `${field}.rootKind`),
    adoption: text(marker.adoption, `${field}.adoption`),
    claimedAt: text(marker.claimedAt, `${field}.claimedAt`),
    adoptedAt: text(marker.adoptedAt, `${field}.adoptedAt`),
    adoptedBy: text(marker.adoptedBy, `${field}.adoptedBy`),
    markerOwner: integer(marker.markerOwner, `${field}.markerOwner`),
    markerGroup: integer(marker.markerGroup, `${field}.markerGroup`),
    markerMode: text(marker.markerMode, `${field}.markerMode`),
    rootOwner: integer(marker.rootOwner, `${field}.rootOwner`),
    rootGroup: integer(marker.rootGroup, `${field}.rootGroup`),
    rootMode: text(marker.rootMode, `${field}.rootMode`),
    exact: marker.exact === true,
  };
}

function helperIdentity(value: unknown, field: string): StorageHelperIdentity {
  const helper = object(value, field);
  return {
    helperPath: text(helper.helperPath, `${field}.helperPath`),
    packagedSha256: sha256(helper.packagedSha256, `${field}.packagedSha256`),
    deployedSha256: sha256(helper.deployedSha256, `${field}.deployedSha256`),
    regularExecutable: helper.regularExecutable === true,
  };
}

function stringArray(value: unknown, field: string, maximum = 64): string[] {
  if (!Array.isArray(value) || value.length > maximum ||
      value.some(item => typeof item !== "string" || !item.trim())) {
    throw new Error(`${field} must be an array of at most ${maximum} non-empty strings`);
  }
  const result = value as string[];
  if (new Set(result).size !== result.length) throw new Error(`${field} contains duplicates`);
  return result;
}

function imageIdentity(value: unknown, field: string): StorageImageIdentity {
  const image = object(value, field);
  const imageId = text(image.imageId, `${field}.imageId`);
  const containerImageId = text(image.containerImageId, `${field}.containerImageId`);
  if (!/^sha256:[0-9a-f]{64}$/.test(imageId) || !/^sha256:[0-9a-f]{64}$/.test(containerImageId)) {
    throw new Error(`${field} image IDs must be immutable SHA-256 identities`);
  }
  const repoDigests = stringArray(image.repoDigests, `${field}.repoDigests`);
  if (repoDigests.some(digest => !/^[A-Za-z0-9._/:@+-]+@sha256:[0-9a-f]{64}$/.test(digest))) {
    throw new Error(`${field}.repoDigests contains a non-immutable digest`);
  }
  return {
    reference: text(image.reference, `${field}.reference`),
    imageId,
    containerImageId,
    repoDigests,
    versionLabel: typeof image.versionLabel === "string" ? image.versionLabel : "",
    storageProfileLabel: typeof image.storageProfileLabel === "string" ? image.storageProfileLabel : "",
  };
}

export function assessStoragePlatform(value: unknown): StoragePlatformProbe {
  const probe = object(value, "storage platform probe");
  const roots = object(probe.storageRoots, "storageRoots");
  const lock = object(probe.storageLock, "storageLock");
  const wal = object(probe.postgresWal, "postgresWal");
  const legacyWal = object(probe.legacyWalArchive, "legacyWalArchive");
  const backupMode = text(probe.backupMode, "backupMode");
  if (backupMode !== "disabled" && backupMode !== "single") {
    throw new Error("backupMode must be disabled or single");
  }
  return {
    expectedRelease: text(probe.expectedRelease, "expectedRelease"),
    configuredRelease: text(probe.configuredRelease, "configuredRelease"),
    templateRelease: text(probe.templateRelease, "templateRelease"),
    deploymentId: text(probe.deploymentId, "deploymentId"),
    backupMode,
    storageRoots: {
      archive: rootIdentity(roots.archive, "storageRoots.archive"),
      backup: roots.backup === null ? null : rootIdentity(roots.backup, "storageRoots.backup"),
    },
    storageLock: {
      directory: text(lock.directory, "storageLock.directory"),
      file: text(lock.file, "storageLock.file"),
      stablePath: lock.stablePath === true,
      private: lock.private === true,
      behaviorTested: lock.behaviorTested === true,
      concurrentRejected: lock.concurrentRejected === true,
    },
    postgresWal: {
      archiveMode: text(wal.archiveMode, "postgresWal.archiveMode"),
      archiveTimeout: text(wal.archiveTimeout, "postgresWal.archiveTimeout"),
      archiveCommand: typeof wal.archiveCommand === "string" ? wal.archiveCommand : "",
      archiveCommandInactive: wal.archiveCommandInactive === true,
      externalWalMountAbsent: wal.externalWalMountAbsent === true,
    },
    legacyWalArchive: {
      configured: legacyWal.configured === true,
      present: legacyWal.present === true,
      bytes: integer(legacyWal.bytes, "legacyWalArchive.bytes"),
    },
    archiveObjectHelper: (() => {
      const helper = object(probe.archiveObjectHelper, "archiveObjectHelper");
      return {
        ...helperIdentity(helper, "archiveObjectHelper"),
        cliExportIntegrated: helper.cliExportIntegrated === true,
        cliPurgeIntegrated: helper.cliPurgeIntegrated === true,
      };
    })(),
    restoreHelpers: (() => {
      const helpers = object(probe.restoreHelpers, "restoreHelpers");
      return {
        prepare: helperIdentity(helpers.prepare, "restoreHelpers.prepare"),
      };
    })(),
    atomicPublisher: (() => {
      const publisher = object(probe.atomicPublisher, "atomicPublisher");
      return {
        helperPath: text(publisher.helperPath, "atomicPublisher.helperPath"),
        sourceStampPath: text(publisher.sourceStampPath, "atomicPublisher.sourceStampPath"),
        packagedSourceSha256: sha256(
          publisher.packagedSourceSha256,
          "atomicPublisher.packagedSourceSha256",
        ),
        deployedSourceSha256: sha256(
          publisher.deployedSourceSha256,
          "atomicPublisher.deployedSourceSha256",
        ),
        deployedBinarySha256: sha256(
          publisher.deployedBinarySha256,
          "atomicPublisher.deployedBinarySha256",
        ),
        regularExecutable: publisher.regularExecutable === true,
        sourceStampRegular: publisher.sourceStampRegular === true,
        behaviorTested: publisher.behaviorTested === true,
        firstPublishSucceeded: publisher.firstPublishSucceeded === true,
        collisionRejected: publisher.collisionRejected === true,
        sourcePreserved: publisher.sourcePreserved === true,
        destinationPreserved: publisher.destinationPreserved === true,
      };
    })(),
    backupIsolation: (() => {
      const isolation = object(probe.backupIsolation, "backupIsolation");
      return {
        appBackupRootAbsent: isolation.appBackupRootAbsent === true,
        postgresBackupRootAbsent: isolation.postgresBackupRootAbsent === true,
        isolatedBasebackupWired: isolation.isolatedBasebackupWired === true,
      };
    })(),
    nativeRuntime: (() => {
      const runtime = object(probe.nativeRuntime, "nativeRuntime");
      return {
        entrypointPath: text(runtime.entrypointPath, "nativeRuntime.entrypointPath"),
        packagedEntrypointSha256: sha256(
          runtime.packagedEntrypointSha256,
          "nativeRuntime.packagedEntrypointSha256",
        ),
        deployedEntrypointSha256: sha256(
          runtime.deployedEntrypointSha256,
          "nativeRuntime.deployedEntrypointSha256",
        ),
        entrypointRegularExecutable: runtime.entrypointRegularExecutable === true,
        containerEntrypointExact: runtime.containerEntrypointExact === true,
        managedPropertiesAfterJavaOpts: runtime.managedPropertiesAfterJavaOpts === true,
        tmpPath: text(runtime.tmpPath, "nativeRuntime.tmpPath"),
        tmpMountType: text(runtime.tmpMountType, "nativeRuntime.tmpMountType"),
        tmpReadWrite: runtime.tmpReadWrite === true,
        tmpNoexec: runtime.tmpNoexec === true,
        tmpNosuid: runtime.tmpNosuid === true,
        tmpNodev: runtime.tmpNodev === true,
        nativePath: text(runtime.nativePath, "nativeRuntime.nativePath"),
        nativeMountType: text(runtime.nativeMountType, "nativeRuntime.nativeMountType"),
        nativeReadWrite: runtime.nativeReadWrite === true,
        nativeNoexecAbsent: runtime.nativeNoexecAbsent === true,
        nativeNosuid: runtime.nativeNosuid === true,
        nativeNodev: runtime.nativeNodev === true,
        nativeDirectory: runtime.nativeDirectory === true,
        nativeExecutable: runtime.nativeExecutable === true,
        runtimeUid: integer(runtime.runtimeUid, "nativeRuntime.runtimeUid"),
        runtimeGid: integer(runtime.runtimeGid, "nativeRuntime.runtimeGid"),
        nativeOwnerUid: integer(runtime.nativeOwnerUid, "nativeRuntime.nativeOwnerUid"),
        nativeOwnerGid: integer(runtime.nativeOwnerGid, "nativeRuntime.nativeOwnerGid"),
        nativeMode: text(runtime.nativeMode, "nativeRuntime.nativeMode"),
        nativeSizeBytes: integer(runtime.nativeSizeBytes, "nativeRuntime.nativeSizeBytes"),
        javaProcessCount: integer(runtime.javaProcessCount, "nativeRuntime.javaProcessCount"),
        javaTmpPropertyCount: integer(
          runtime.javaTmpPropertyCount,
          "nativeRuntime.javaTmpPropertyCount",
        ),
        effectiveJavaTmp: text(runtime.effectiveJavaTmp, "nativeRuntime.effectiveJavaTmp"),
        javaCppCachePropertyCount: integer(
          runtime.javaCppCachePropertyCount,
          "nativeRuntime.javaCppCachePropertyCount",
        ),
        effectiveJavaCppCache: text(
          runtime.effectiveJavaCppCache,
          "nativeRuntime.effectiveJavaCppCache",
        ),
        dataTmpPropertyCount: integer(
          runtime.dataTmpPropertyCount,
          "nativeRuntime.dataTmpPropertyCount",
        ),
        effectiveDataTmp: text(runtime.effectiveDataTmp, "nativeRuntime.effectiveDataTmp"),
      };
    })(),
    appImage: imageIdentity(probe.appImage, "appImage"),
    postgisImage: imageIdentity(probe.postgisImage, "postgisImage"),
    gatewayImage: imageIdentity(probe.gatewayImage, "gatewayImage"),
    dataChecksums: text(probe.dataChecksums, "dataChecksums"),
    pgStatStatementsInstalled: probe.pgStatStatementsInstalled === true,
    pgStatStatementsPreloaded: probe.pgStatStatementsPreloaded === true,
    schemaVersion: integer(probe.schemaVersion, "schemaVersion"),
    schemaChecksum: text(probe.schemaChecksum, "schemaChecksum"),
    archiveMarker: (() => {
      const marker = object(probe.archiveMarker, "archiveMarker");
      return {
        present: marker.present === true,
        exact: marker.exact === true,
        format: typeof marker.format === "string" ? marker.format : "",
        version: typeof marker.version === "string" ? marker.version : "",
        dataChecksums: typeof marker.dataChecksums === "string" ? marker.dataChecksums : "",
        initializedAt: typeof marker.initializedAt === "string" ? marker.initializedAt : "",
      };
    })(),
    batchRewriteConfigured: probe.batchRewriteConfigured === true,
    batchRewriteObservedCalls: integer(
      probe.batchRewriteObservedCalls,
      "batchRewriteObservedCalls",
    ),
    batchRewriteObservedRows: integer(
      probe.batchRewriteObservedRows,
      "batchRewriteObservedRows",
    ),
    dailyJournalConfigured: probe.dailyJournalConfigured === true,
    archiveEnabled: typeof probe.archiveEnabled === "boolean" ? probe.archiveEnabled : null,
    storageMode: text(probe.storageMode, "storageMode"),
    parquetPrimaryArchiveDelayMinutes: nullableNumber(probe.parquetPrimaryArchiveDelayMinutes),
    immutableStageWindowMinutes: nullableNumber(probe.immutableStageWindowMinutes),
    maximumFuturePhenomenonSkewMinutes:
      nullableNumber(probe.maximumFuturePhenomenonSkewMinutes),
    parquetPrimaryIntervalMinutes: nullableNumber(probe.parquetPrimaryIntervalMinutes),
    maximumStagePartitionsPerCycle: nullableNumber(probe.maximumStagePartitionsPerCycle),
    archiveIntervalMinutes: nullableNumber(probe.archiveIntervalMinutes),
    hotRetentionDays: nullableNumber(probe.hotRetentionDays),
    deleteHotAfterArchive: typeof probe.deleteHotAfterArchive === "boolean"
      ? probe.deleteHotAfterArchive : null,
    rollbackGraceDays: nullableNumber(probe.rollbackGraceDays),
    maximumGenerationsPerCycle: nullableNumber(probe.maximumGenerationsPerCycle),
    maximumVerificationsPerCycle: nullableNumber(probe.maximumVerificationsPerCycle),
    maximumDeletionsPerCycle: nullableNumber(probe.maximumDeletionsPerCycle),
    outputNames: stringArray(probe.outputNames, "outputNames"),
    observationIndexes: (() => {
      const indexes = object(probe.observationIndexes, "observationIndexes");
      return {
        genericPayloadGinAbsent: indexes.genericPayloadGinAbsent === true,
        requiredCount: integer(indexes.requiredCount, "observationIndexes.requiredCount", 1),
        requiredPresent: integer(indexes.requiredPresent, "observationIndexes.requiredPresent"),
        missingNames: stringArray(indexes.missingNames, "observationIndexes.missingNames"),
        eventPathGinExact: indexes.eventPathGinExact === true,
        numericEventIndexesExact: indexes.numericEventIndexesExact === true,
      };
    })(),
    packagedDefaults: (() => {
      const defaults = object(probe.packagedDefaults, "packagedDefaults");
      return {
        archiveEnabled: typeof defaults.archiveEnabled === "boolean"
          ? defaults.archiveEnabled : null,
        storageMode: text(defaults.storageMode, "packagedDefaults.storageMode"),
        parquetPrimaryArchiveDelayMinutes:
          nullableNumber(defaults.parquetPrimaryArchiveDelayMinutes),
        immutableStageWindowMinutes: nullableNumber(defaults.immutableStageWindowMinutes),
        maximumFuturePhenomenonSkewMinutes:
          nullableNumber(defaults.maximumFuturePhenomenonSkewMinutes),
        parquetPrimaryIntervalMinutes: nullableNumber(defaults.parquetPrimaryIntervalMinutes),
        maximumStagePartitionsPerCycle:
          nullableNumber(defaults.maximumStagePartitionsPerCycle),
        archiveIntervalMinutes: nullableNumber(defaults.archiveIntervalMinutes),
        hotRetentionDays: nullableNumber(defaults.hotRetentionDays),
        rollbackGraceDays: nullableNumber(defaults.rollbackGraceDays),
        maximumGenerationsPerCycle: nullableNumber(defaults.maximumGenerationsPerCycle),
        maximumVerificationsPerCycle: nullableNumber(defaults.maximumVerificationsPerCycle),
        maximumDeletionsPerCycle: nullableNumber(defaults.maximumDeletionsPerCycle),
        outputNames: stringArray(defaults.outputNames, "packagedDefaults.outputNames"),
        deleteHotAfterArchive: typeof defaults.deleteHotAfterArchive === "boolean"
          ? defaults.deleteHotAfterArchive : null,
        videoRetentionDays: nullableNumber(defaults.videoRetentionDays),
        videoQueryPeriodMinutes: nullableNumber(defaults.videoQueryPeriodMinutes),
        maximumCatchUpHours: nullableNumber(defaults.maximumCatchUpHours),
        lateArrivalOverlapHours: nullableNumber(defaults.lateArrivalOverlapHours),
        lateArrivalScanPeriodMinutes: nullableNumber(defaults.lateArrivalScanPeriodMinutes),
        lateArrivalCatchUpHours: nullableNumber(defaults.lateArrivalCatchUpHours),
        reconciliationCatchUpHours: nullableNumber(defaults.reconciliationCatchUpHours),
        reconciliationPeriodHours: nullableNumber(defaults.reconciliationPeriodHours),
        occupancyStreamRefreshMinutes: nullableNumber(defaults.occupancyStreamRefreshMinutes),
        retainedFrameCount: nullableNumber(defaults.retainedFrameCount),
        jpegQuality: nullableNumber(defaults.jpegQuality),
        sourceRollbackGraceHours: nullableNumber(defaults.sourceRollbackGraceHours),
        metadataReclamationWorkLimit: nullableNumber(defaults.metadataReclamationWorkLimit),
        maintenanceWorkLimit: nullableNumber(defaults.maintenanceWorkLimit),
        frameRetentionEnabled: typeof defaults.frameRetentionEnabled === "boolean"
          ? defaults.frameRetentionEnabled : null,
        sealedJournalRetentionDays: nullableNumber(defaults.sealedJournalRetentionDays),
        requireBackupBeforeSealedJournalDeletion:
          typeof defaults.requireBackupBeforeSealedJournalDeletion === "boolean"
            ? defaults.requireBackupBeforeSealedJournalDeletion : null,
      };
    })(),
    archiveResources: (() => {
      const resources = object(probe.archiveResources, "archiveResources");
      return {
        memoryLimitMegabytes: nullableNumber(resources.memoryLimitMegabytes),
        threads: nullableNumber(resources.threads),
        maximumTemporaryMegabytes: nullableNumber(resources.maximumTemporaryMegabytes),
        maximumConcurrentSessions: nullableNumber(resources.maximumConcurrentSessions),
        sessionAcquireTimeoutSeconds: nullableNumber(resources.sessionAcquireTimeoutSeconds),
        temporaryDirectory: text(resources.temporaryDirectory, "archiveResources.temporaryDirectory"),
      };
    })(),
    archiveScratch: assessArchiveScratch(probe.archiveScratch),
    dailyJournal: (() => {
      const journal = object(probe.dailyJournal, "dailyJournal");
      return {
        rootDirectory: text(journal.rootDirectory, "dailyJournal.rootDirectory"),
        journalDirectory: text(journal.journalDirectory, "dailyJournal.journalDirectory"),
        publicationDirectory: text(journal.publicationDirectory, "dailyJournal.publicationDirectory"),
        zoneId: text(journal.zoneId, "dailyJournal.zoneId"),
        observationMode: text(journal.observationMode, "dailyJournal.observationMode"),
        fsyncIntervalMillis: nullableNumber(journal.fsyncIntervalMillis),
        maxUnforcedRecords: nullableNumber(journal.maxUnforcedRecords),
        maxUnforcedBytes: nullableNumber(journal.maxUnforcedBytes),
        maxSegmentBytes: nullableNumber(journal.maxSegmentBytes),
        maxSegmentAgeSeconds: nullableNumber(journal.maxSegmentAgeSeconds),
        maxRecordBytes: nullableNumber(journal.maxRecordBytes),
        sealedJournalRetentionDays: nullableNumber(journal.sealedJournalRetentionDays),
        requireBackupBeforeSealedJournalDeletion:
          typeof journal.requireBackupBeforeSealedJournalDeletion === "boolean"
            ? journal.requireBackupBeforeSealedJournalDeletion : null,
        observationLifecycleDelegated: typeof journal.observationLifecycleDelegated === "boolean"
          ? journal.observationLifecycleDelegated : null,
        purgeWorkLimit: nullableNumber(journal.purgeWorkLimit),
      };
    })(),
    videoRetention: (() => {
      const retention = object(probe.videoRetention, "videoRetention");
      return {
        enabled: typeof retention.enabled === "boolean" ? retention.enabled : null,
        timeToRetentionDays: nullableNumber(retention.timeToRetentionDays),
        queryPeriodMinutes: nullableNumber(retention.queryPeriodMinutes),
        maximumCatchUpHours: nullableNumber(retention.maximumCatchUpHours),
        lateArrivalOverlapHours: nullableNumber(retention.lateArrivalOverlapHours),
        lateArrivalScanPeriodMinutes: nullableNumber(retention.lateArrivalScanPeriodMinutes),
        lateArrivalCatchUpHours: nullableNumber(retention.lateArrivalCatchUpHours),
        reconciliationCatchUpHours: nullableNumber(retention.reconciliationCatchUpHours),
        reconciliationPeriodHours: nullableNumber(retention.reconciliationPeriodHours),
        occupancyStreamRefreshMinutes: nullableNumber(retention.occupancyStreamRefreshMinutes),
        frameCount: nullableNumber(retention.frameCount),
        jpegQuality: nullableNumber(retention.jpegQuality),
        sourceRollbackGraceHours: nullableNumber(retention.sourceRollbackGraceHours),
        metadataReclamationWorkLimit: nullableNumber(retention.metadataReclamationWorkLimit),
        maintenanceWorkLimit: nullableNumber(retention.maintenanceWorkLimit),
      };
    })(),
  };
}

export function assessImmutableStageHealth(value: unknown): ImmutableStageHealthProbe {
  const probe = object(value, "immutable stage health probe");
  const applicable = probe.applicable === true;
  const storageMode = text(probe.storageMode, "storageMode");
  if (!applicable) {
    return {
      applicable, storageMode, attachedChildCount: 0, detachedChildCount: 0,
      stageRowCount: 0, oldestReceivedAt: null, oldestReceivedAtAgeSeconds: 0,
      stagingSloSeconds: 3600, stagingSloExceeded: false, exactSidecarOwnerCount: 0,
      ownedStageRowCount: 0, attachedUnownedRowCount: 0, detachedUnownedRowCount: 0,
      orphanRegistryOwnerCount: 0, orphanGenerationOwnerCount: 0,
      ownersMissingPhysicalRowCount: 0, markerNonNullRowCount: 0,
      immutableRouteMismatchRowCount: 0, parentOnlyRowCount: 0,
      parentImmutableRowCount: 0, missingRelationCount: 0,
      inheritanceMismatchCount: 0, sampleConsistent: true,
    };
  }
  const oldest = probe.oldestReceivedAt;
  if (oldest !== null && (typeof oldest !== "string" || !Number.isFinite(Date.parse(oldest)))) {
    throw new Error("oldestReceivedAt must be null or an ISO timestamp");
  }
  return {
    applicable, storageMode,
    attachedChildCount: integer(probe.attachedChildCount, "attachedChildCount"),
    detachedChildCount: integer(probe.detachedChildCount, "detachedChildCount"),
    stageRowCount: integer(probe.stageRowCount, "stageRowCount"),
    oldestReceivedAt: oldest,
    oldestReceivedAtAgeSeconds:
      integer(probe.oldestReceivedAtAgeSeconds, "oldestReceivedAtAgeSeconds"),
    stagingSloSeconds: integer(probe.stagingSloSeconds, "stagingSloSeconds", 1),
    stagingSloExceeded: probe.stagingSloExceeded === true,
    exactSidecarOwnerCount:
      integer(probe.exactSidecarOwnerCount, "exactSidecarOwnerCount"),
    ownedStageRowCount: integer(probe.ownedStageRowCount, "ownedStageRowCount"),
    attachedUnownedRowCount:
      integer(probe.attachedUnownedRowCount, "attachedUnownedRowCount"),
    detachedUnownedRowCount:
      integer(probe.detachedUnownedRowCount, "detachedUnownedRowCount"),
    orphanRegistryOwnerCount:
      integer(probe.orphanRegistryOwnerCount, "orphanRegistryOwnerCount"),
    orphanGenerationOwnerCount:
      integer(probe.orphanGenerationOwnerCount, "orphanGenerationOwnerCount"),
    ownersMissingPhysicalRowCount:
      integer(probe.ownersMissingPhysicalRowCount, "ownersMissingPhysicalRowCount"),
    markerNonNullRowCount: integer(probe.markerNonNullRowCount, "markerNonNullRowCount"),
    immutableRouteMismatchRowCount:
      integer(probe.immutableRouteMismatchRowCount, "immutableRouteMismatchRowCount"),
    parentOnlyRowCount: integer(probe.parentOnlyRowCount, "parentOnlyRowCount"),
    parentImmutableRowCount:
      integer(probe.parentImmutableRowCount, "parentImmutableRowCount"),
    missingRelationCount: integer(probe.missingRelationCount, "missingRelationCount"),
    inheritanceMismatchCount:
      integer(probe.inheritanceMismatchCount, "inheritanceMismatchCount"),
    sampleConsistent: probe.sampleConsistent === true,
  };
}

export function immutableStageHealthIsSafe(value: ImmutableStageHealthProbe): boolean {
  if (!value.applicable) return value.storageMode !== "PARQUET_PRIMARY";
  return value.storageMode === "PARQUET_PRIMARY" && value.sampleConsistent &&
    value.stagingSloSeconds === 3600 && !value.stagingSloExceeded &&
    value.oldestReceivedAtAgeSeconds <= value.stagingSloSeconds &&
    (value.stageRowCount === 0) === (value.oldestReceivedAt === null) &&
    value.stageRowCount === value.ownedStageRowCount + value.attachedUnownedRowCount +
      value.detachedUnownedRowCount &&
    value.exactSidecarOwnerCount === value.ownedStageRowCount &&
    value.detachedUnownedRowCount === 0 && value.orphanRegistryOwnerCount === 0 &&
    value.orphanGenerationOwnerCount === 0 && value.ownersMissingPhysicalRowCount === 0 &&
    value.markerNonNullRowCount === 0 && value.immutableRouteMismatchRowCount === 0 &&
    value.parentImmutableRowCount === 0 && value.missingRelationCount === 0 &&
    value.inheritanceMismatchCount === 0;
}

export function assessArchiveScratch(value: unknown): ArchiveScratchProbe {
  const scratch = object(value, "archive scratch");
  return {
    present: scratch.present === true,
    realDirectory: scratch.realDirectory === true,
    ownerUid: nullableNumber(scratch.ownerUid),
    ownerGid: nullableNumber(scratch.ownerGid),
    mode: typeof scratch.mode === "string" ? scratch.mode : "",
    archiveDisjoint: scratch.archiveDisjoint === true,
    leaseFilePresent: scratch.leaseFilePresent === true,
    leaseFileRegular: scratch.leaseFileRegular === true,
    leaseFileOwnerUid: nullableNumber(scratch.leaseFileOwnerUid),
    leaseFileOwnerGid: nullableNumber(scratch.leaseFileOwnerGid),
    leaseFileMode: typeof scratch.leaseFileMode === "string" ? scratch.leaseFileMode : "",
    entryCount: integer(scratch.entryCount, "archiveScratch.entryCount"),
    unexpectedEntryCount: integer(
      scratch.unexpectedEntryCount,
      "archiveScratch.unexpectedEntryCount",
    ),
  };
}

function scratchIdentityArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_DUCKDB_SCRATCH_IDENTITIES) {
    throw new Error(`${field} must be an array of at most ${MAX_DUCKDB_SCRATCH_IDENTITIES} identities`);
  }
  const identities = value.map((candidate, index) => {
    if (typeof candidate !== "string" || !DUCKDB_SCRATCH_ID_PATTERN.test(candidate)) {
      throw new Error(`${field}[${index}] is not a canonical DuckDB scratch identity`);
    }
    return candidate;
  });
  const canonical = [...new Set(identities)].sort();
  if (canonical.length !== identities.length ||
      canonical.some((identity, index) => identity !== identities[index])) {
    throw new Error(`${field} must contain unique identities in canonical order`);
  }
  return identities;
}

/** Validates the exact pre/post scratch identity intersection around a supported restart. */
export function assessArchiveScratchRestart(value: unknown): ArchiveScratchRestartAssessment {
  const restart = object(value, "archive scratch restart");
  const before = scratchIdentityArray(restart.scratchBeforeRestart, "scratchBeforeRestart");
  const after = scratchIdentityArray(restart.scratchAfterRestart, "scratchAfterRestart");
  const stale = scratchIdentityArray(
    restart.staleScratchAfterRestart,
    "staleScratchAfterRestart",
  );
  const beforeCount = integer(
    restart.scratchBeforeRestartCount,
    "scratchBeforeRestartCount",
    0,
    MAX_DUCKDB_SCRATCH_IDENTITIES,
  );
  const afterCount = integer(
    restart.scratchAfterRestartCount,
    "scratchAfterRestartCount",
    0,
    MAX_DUCKDB_SCRATCH_IDENTITIES,
  );
  const staleCount = integer(
    restart.staleScratchAfterRestartCount,
    "staleScratchAfterRestartCount",
    0,
    MAX_DUCKDB_SCRATCH_IDENTITIES,
  );
  if (beforeCount !== before.length || afterCount !== after.length || staleCount !== stale.length) {
    throw new Error("DuckDB scratch restart counts do not match their identity arrays");
  }
  const afterSet = new Set(after);
  const expectedStale = before.filter(identity => afterSet.has(identity));
  if (expectedStale.length !== stale.length ||
      expectedStale.some((identity, index) => identity !== stale[index])) {
    throw new Error("staleScratchAfterRestart is not the exact pre/post identity intersection");
  }
  return {before, after, stale};
}

export function archiveScratchRestartIsSafe(value: ArchiveScratchRestartAssessment): boolean {
  return value.stale.length === 0;
}

export function assessRetentionRuntimeHealth(value: unknown): RetentionRuntimeHealthProbe {
  const probe = object(value, "retention runtime health probe");
  const parsedInstant = (candidate: unknown, field: string): string | null => {
    if (candidate === null || candidate === undefined) return null;
    return instant(candidate, field);
  };
  return {
    checkpointPresent: probe.checkpointPresent === true,
    checkpointValid: probe.checkpointValid === true,
    checkpointSchemaVersion: nullableNumber(probe.checkpointSchemaVersion),
    processedThrough: parsedInstant(probe.processedThrough, "processedThrough"),
    updatedAt: parsedInstant(probe.updatedAt, "updatedAt"),
    cursorLagSeconds: nullableNumber(probe.cursorLagSeconds),
  };
}

export function retentionRuntimeReady(
  value: RetentionRuntimeHealthProbe,
  maximumCursorLagSeconds: number,
): boolean {
  return value.checkpointPresent && value.checkpointValid &&
    value.checkpointSchemaVersion === 1 && value.processedThrough !== null &&
    value.updatedAt !== null && Number.isFinite(value.cursorLagSeconds) &&
    (value.cursorLagSeconds as number) >= 0 &&
    (value.cursorLagSeconds as number) <= maximumCursorLagSeconds;
}

export function archiveScratchIsSafe(value: ArchiveScratchProbe): boolean {
  return archiveScratchRootIsSafe(value) && value.entryCount === 0;
}

function archiveScratchRootIsSafe(value: ArchiveScratchProbe): boolean {
  return value.present && value.realDirectory && value.ownerUid === 10001 &&
    value.ownerGid === 10001 && value.mode === "700" && value.archiveDisjoint &&
    value.leaseFilePresent && value.leaseFileRegular && value.leaseFileOwnerUid === 10001 &&
    value.leaseFileOwnerGid === 10001 && value.leaseFileMode === "600" &&
    value.unexpectedEntryCount === 0;
}

export function assessMediaMetadataHealth(value: unknown): MediaMetadataHealthProbe {
  const probe = object(value, "media metadata health probe");
  return {
    rootPresent: probe.rootPresent === true,
    checkpointPresent: probe.checkpointPresent === true,
    checkpointValid: probe.checkpointValid === true,
    checkpointSchemaVersion: nullableNumber(probe.checkpointSchemaVersion),
    totalEntries: integer(probe.totalEntries, "totalEntries"),
    regularFiles: integer(probe.regularFiles, "regularFiles"),
    directories: integer(probe.directories, "directories"),
    processedIndexFiles: integer(probe.processedIndexFiles, "processedIndexFiles"),
    processedIndexBytes: integer(probe.processedIndexBytes, "processedIndexBytes"),
    deletionIndexFiles: integer(probe.deletionIndexFiles, "deletionIndexFiles"),
    deletionIndexBytes: integer(probe.deletionIndexBytes, "deletionIndexBytes"),
    retainedManifestFiles: integer(probe.retainedManifestFiles, "retainedManifestFiles"),
    retainedJpegFiles: integer(probe.retainedJpegFiles, "retainedJpegFiles"),
    legacyProcessedMarkerFiles: integer(
      probe.legacyProcessedMarkerFiles,
      "legacyProcessedMarkerFiles",
    ),
    legacyDeletionTombstones: integer(probe.legacyDeletionTombstones, "legacyDeletionTombstones"),
    partialArtifacts: integer(probe.partialArtifacts, "partialArtifacts"),
    unsafeEntries: integer(probe.unsafeEntries, "unsafeEntries"),
    indexFormatFailures: integer(probe.indexFormatFailures, "indexFormatFailures"),
  };
}

export function mediaMetadataHealthIsSafe(
  value: MediaMetadataHealthProbe,
  requirePopulated: boolean,
): boolean {
  const structurallySafe = value.partialArtifacts === 0 && value.unsafeEntries === 0 &&
    value.indexFormatFailures === 0 && value.legacyProcessedMarkerFiles === 0 &&
    value.legacyDeletionTombstones === 0 &&
    value.totalEntries === value.regularFiles + value.directories &&
    (!value.checkpointPresent ||
      (value.checkpointValid && value.checkpointSchemaVersion === 2)) &&
    (value.processedIndexFiles === 0 ||
      (value.checkpointPresent && value.checkpointValid && value.checkpointSchemaVersion === 2));
  if (!structurallySafe) return false;
  if (!requirePopulated) return true;
  return value.rootPresent && value.checkpointPresent && value.checkpointValid &&
    value.checkpointSchemaVersion === 2 && value.processedIndexFiles > 0 &&
    value.processedIndexBytes >= 52 && value.retainedManifestFiles > 0 &&
    value.retainedJpegFiles >= value.retainedManifestFiles * 5;
}

export function storagePlatformHasExactReleaseIdentity(
  value: StoragePlatformProbe,
  release: string,
  expectedBackupMode: BackupMode = value.backupMode,
): boolean {
  const roots: Array<[StorageRootIdentity, string, number, string]> = [
    [value.storageRoots.archive, "archive", 10001, "1770"],
  ];
  if (expectedBackupMode === "single") {
    if (value.storageRoots.backup === null) return false;
    roots.push([value.storageRoots.backup, "backup", 0, "700"]);
  } else if (value.storageRoots.backup !== null) {
    return false;
  }
  const rootsExact = roots.every(([root, kind, group, mode]) => root.exact &&
    root.format === "oscar-storage-root-identity" && root.version === "1" &&
    root.deploymentId === value.deploymentId && root.rootKind === kind &&
    ["new", "explicit-existing"].includes(root.adoption) &&
    Number.isFinite(Date.parse(root.claimedAt)) &&
    ((root.adoption === "new" && root.adoptedAt === "none" && root.adoptedBy === "none") ||
      (root.adoption === "explicit-existing" && Number.isFinite(Date.parse(root.adoptedAt)) &&
        root.adoptedBy !== "none")) &&
    root.markerOwner === 0 && root.markerGroup === 0 && root.markerMode === "600" &&
    root.rootOwner === 0 && root.rootGroup === group && root.rootMode === mode);
  const helperExact = (helper: StorageHelperIdentity, path: string) =>
    helper.helperPath === path && helper.regularExecutable &&
    helper.packagedSha256 === helper.deployedSha256;
  return value.expectedRelease === release &&
    value.configuredRelease === release &&
    value.templateRelease === release &&
    value.backupMode === expectedBackupMode &&
    isCanonicalProductUuid(value.deploymentId) &&
    rootsExact &&
    value.storageLock.file === `${value.storageLock.directory}/${value.deploymentId}.lock` &&
    value.storageLock.stablePath && value.storageLock.private &&
    value.storageLock.behaviorTested && value.storageLock.concurrentRejected &&
    value.dataChecksums === "on" && value.pgStatStatementsInstalled &&
    value.pgStatStatementsPreloaded && value.batchRewriteConfigured &&
    value.batchRewriteObservedCalls > 0 &&
    value.batchRewriteObservedRows > value.batchRewriteObservedCalls &&
    value.dailyJournalConfigured &&
    value.postgresWal.archiveMode === "off" && value.postgresWal.archiveTimeout === "0" &&
    value.postgresWal.archiveCommandInactive &&
    ["", "(disabled)"].includes(value.postgresWal.archiveCommand) &&
    value.postgresWal.externalWalMountAbsent &&
    helperExact(value.archiveObjectHelper, "/usr/local/bin/oscar-archive-object") &&
    value.archiveObjectHelper.cliExportIntegrated && value.archiveObjectHelper.cliPurgeIntegrated &&
    helperExact(value.restoreHelpers.prepare, "/usr/local/bin/oscar-prepare-restore") &&
    value.atomicPublisher.helperPath === "/usr/local/bin/oscar-atomic-publish" &&
    value.atomicPublisher.sourceStampPath ===
      "/usr/local/share/oscar-atomic-publish.source.sha256" &&
    value.atomicPublisher.packagedSourceSha256 === value.atomicPublisher.deployedSourceSha256 &&
    value.atomicPublisher.regularExecutable && value.atomicPublisher.sourceStampRegular &&
    value.atomicPublisher.behaviorTested && value.atomicPublisher.firstPublishSucceeded &&
    value.atomicPublisher.collisionRejected && value.atomicPublisher.sourcePreserved &&
    value.atomicPublisher.destinationPreserved &&
    value.backupIsolation.appBackupRootAbsent &&
    value.backupIsolation.postgresBackupRootAbsent &&
    value.backupIsolation.isolatedBasebackupWired &&
    value.nativeRuntime.entrypointPath === "/usr/local/bin/oscar-entrypoint" &&
    value.nativeRuntime.packagedEntrypointSha256 ===
      value.nativeRuntime.deployedEntrypointSha256 &&
    value.nativeRuntime.entrypointRegularExecutable &&
    value.nativeRuntime.containerEntrypointExact &&
    value.nativeRuntime.managedPropertiesAfterJavaOpts &&
    value.nativeRuntime.tmpPath === "/tmp" &&
    value.nativeRuntime.tmpMountType === "tmpfs" &&
    value.nativeRuntime.tmpReadWrite && value.nativeRuntime.tmpNoexec &&
    value.nativeRuntime.tmpNosuid && value.nativeRuntime.tmpNodev &&
    value.nativeRuntime.nativePath === "/run/oscar-native" &&
    value.nativeRuntime.nativeMountType === "tmpfs" &&
    value.nativeRuntime.nativeReadWrite && value.nativeRuntime.nativeNoexecAbsent &&
    value.nativeRuntime.nativeNosuid && value.nativeRuntime.nativeNodev &&
    value.nativeRuntime.nativeDirectory && value.nativeRuntime.nativeExecutable &&
    value.nativeRuntime.runtimeUid === 10001 && value.nativeRuntime.runtimeGid === 10001 &&
    value.nativeRuntime.nativeOwnerUid === 10001 &&
    value.nativeRuntime.nativeOwnerGid === 10001 &&
    value.nativeRuntime.nativeMode === "700" &&
    value.nativeRuntime.nativeSizeBytes === 256 * 1024 * 1024 &&
    value.nativeRuntime.javaProcessCount === 1 &&
    value.nativeRuntime.javaTmpPropertyCount >= 1 &&
    value.nativeRuntime.effectiveJavaTmp === "/run/oscar-native" &&
    value.nativeRuntime.javaCppCachePropertyCount >= 1 &&
    value.nativeRuntime.effectiveJavaCppCache === "/run/oscar-native/javacpp" &&
    value.nativeRuntime.dataTmpPropertyCount >= 1 &&
    value.nativeRuntime.effectiveDataTmp === "/tmp" &&
    value.appImage.reference === `oscar:${release}` &&
    value.postgisImage.reference === `oscar-postgis:${release}` &&
    (
      /^(?:3\.(?:9|10)\.|3\.11\.0$)/.test(release)
        ? value.gatewayImage.reference === "nginxinc/nginx-unprivileged:1.28.1-alpine"
        : (
            value.gatewayImage.reference === "nginx/nginx-unprivileged:1.30.7-alpine" ||
            value.gatewayImage.reference === "nginx/nginx-unprivileged:1.30.8-alpine"
          )
    ) &&
    value.appImage.imageId === value.appImage.containerImageId &&
    value.postgisImage.imageId === value.postgisImage.containerImageId &&
    value.gatewayImage.imageId === value.gatewayImage.containerImageId &&
    value.appImage.versionLabel === release &&
    value.postgisImage.versionLabel === release &&
    value.postgisImage.storageProfileLabel === release &&
    value.archiveMarker.present &&
    value.archiveMarker.exact &&
    value.archiveMarker.format === "oscar-storage-profile" &&
    (value.archiveMarker.version === release ||
      (/^3\.11\.\d+$/.test(release) && /^3\.11\.\d+$/.test(value.archiveMarker.version)) ||
      (/^3\.12\.\d+$/.test(release) && /^3\.(?:11|12)\.\d+$/.test(value.archiveMarker.version))) &&
    value.archiveMarker.dataChecksums === "on" &&
    Number.isFinite(Date.parse(value.archiveMarker.initializedAt)) &&
    value.schemaVersion === OSCAR_STORAGE_SCHEMA_VERSION &&
    value.schemaChecksum === OSCAR_STORAGE_SCHEMA_CHECKSUM &&
    value.archiveEnabled === true &&
    value.archiveResources.memoryLimitMegabytes === 256 &&
    value.archiveResources.threads === 2 &&
    value.archiveResources.maximumTemporaryMegabytes === 4096 &&
    value.archiveResources.maximumConcurrentSessions === 2 &&
    value.archiveResources.sessionAcquireTimeoutSeconds === 30 &&
    value.archiveResources.temporaryDirectory === "/var/lib/oscar/duckdb-tmp" &&
    archiveScratchRootIsSafe(value.archiveScratch) &&
    value.videoRetention.metadataReclamationWorkLimit === 200 &&
    value.dailyJournal.rootDirectory === "files" &&
    value.dailyJournal.journalDirectory === ".dailyfile-journal" &&
    value.dailyJournal.publicationDirectory === "dailyfiles" &&
    value.dailyJournal.zoneId === "UTC" &&
    value.dailyJournal.observationMode === "LATEST" &&
    value.dailyJournal.fsyncIntervalMillis === 1000 &&
    value.dailyJournal.maxUnforcedRecords === 128 &&
    value.dailyJournal.maxUnforcedBytes === 1_048_576 &&
    value.dailyJournal.maxSegmentBytes === 67_108_864 &&
    value.dailyJournal.maxSegmentAgeSeconds === 900 &&
    value.dailyJournal.maxRecordBytes === 4_194_304 &&
    value.dailyJournal.sealedJournalRetentionDays === 30 &&
    value.dailyJournal.requireBackupBeforeSealedJournalDeletion === false &&
    value.packagedDefaults.sealedJournalRetentionDays === 30 &&
    value.packagedDefaults.requireBackupBeforeSealedJournalDeletion === false &&
    value.dailyJournal.observationLifecycleDelegated === true &&
    value.dailyJournal.purgeWorkLimit === 50;
}

export interface ArchiveHealthProbe {
  activeGenerations: number;
  sealedGenerations: number;
  archiveRows: number;
  archiveBytes: number;
  failedJobs: number;
  parityFailures: number;
  activeHolds: number;
  incompleteActiveObjects: number;
  archivePartialArtifacts: number;
  walPartialArtifacts: number;
  checksumVerificationPassed: boolean;
}

export interface CompactionHealthProbe {
  rawGatedGenerations: number;
  rawEventsGenerations: number;
  rawTelemetryGenerations: number;
  dailyEventsGenerations: number;
  dailyTelemetryGenerations: number;
  monthlyEventsGenerations: number;
  deletingGenerations: number;
  invalidCompactedGenerations: number;
  nonZeroDeletingRowCount: number;
  unpopulatedCompactedSummaries: number;
  telemetryOcrBloomViolations: number;
  streamSeparationViolations: number;
  orphanCatalogReferenceCount: number;
}

export function assessCompactionHealth(value: unknown): CompactionHealthProbe {
  const probe = object(value, "compaction health probe");
  return {
    rawGatedGenerations: integer(probe.rawGatedGenerations, "rawGatedGenerations"),
    rawEventsGenerations: integer(probe.rawEventsGenerations, "rawEventsGenerations"),
    rawTelemetryGenerations: integer(probe.rawTelemetryGenerations, "rawTelemetryGenerations"),
    dailyEventsGenerations: integer(probe.dailyEventsGenerations, "dailyEventsGenerations"),
    dailyTelemetryGenerations: integer(probe.dailyTelemetryGenerations, "dailyTelemetryGenerations"),
    monthlyEventsGenerations: integer(probe.monthlyEventsGenerations, "monthlyEventsGenerations"),
    deletingGenerations: integer(probe.deletingGenerations, "deletingGenerations"),
    invalidCompactedGenerations: integer(probe.invalidCompactedGenerations, "invalidCompactedGenerations"),
    nonZeroDeletingRowCount: integer(probe.nonZeroDeletingRowCount, "nonZeroDeletingRowCount"),
    unpopulatedCompactedSummaries: integer(probe.unpopulatedCompactedSummaries, "unpopulatedCompactedSummaries"),
    telemetryOcrBloomViolations: integer(probe.telemetryOcrBloomViolations, "telemetryOcrBloomViolations"),
    streamSeparationViolations: integer(probe.streamSeparationViolations, "streamSeparationViolations"),
    orphanCatalogReferenceCount: integer(probe.orphanCatalogReferenceCount, "orphanCatalogReferenceCount"),
  };
}

export function compactionHealthIsSafe(probe: CompactionHealthProbe): boolean {
  return probe.invalidCompactedGenerations === 0 &&
    probe.nonZeroDeletingRowCount === 0 &&
    probe.unpopulatedCompactedSummaries === 0 &&
    probe.telemetryOcrBloomViolations === 0 &&
    probe.streamSeparationViolations === 0 &&
    probe.orphanCatalogReferenceCount === 0;
}

export function assessArchiveHealth(value: unknown): ArchiveHealthProbe {
  const probe = object(value, "archive health probe");
  return {
    activeGenerations: integer(probe.activeGenerations, "activeGenerations"),
    sealedGenerations: integer(probe.sealedGenerations, "sealedGenerations"),
    archiveRows: integer(probe.archiveRows, "archiveRows"),
    archiveBytes: integer(probe.archiveBytes, "archiveBytes"),
    failedJobs: integer(probe.failedJobs, "failedJobs"),
    parityFailures: integer(probe.parityFailures, "parityFailures"),
    activeHolds: integer(probe.activeHolds, "activeHolds"),
    incompleteActiveObjects: integer(probe.incompleteActiveObjects, "incompleteActiveObjects"),
    archivePartialArtifacts: integer(probe.archivePartialArtifacts, "archivePartialArtifacts"),
    walPartialArtifacts: integer(probe.walPartialArtifacts, "walPartialArtifacts"),
    checksumVerificationPassed: probe.checksumVerificationPassed === true,
  };
}

export function storageMetricFromProbe(
  phase: string,
  value: unknown,
): Omit<StorageMetricSample, "runId" | "timestamp"> {
  const probe = object(value, "storage metric probe");
  const fields = [
    "databaseSizeBytes", "observationTableBytes", "observationIndexBytes", "walBytes",
    "tempBytes", "tuplesInserted", "tuplesUpdated", "tuplesDeleted", "transactionCommits",
    "transactionRollbacks", "observationInsertCalls", "observationInsertRows",
    "observationRowsPerCall", "statementTempBlocksWritten", "observationDeleteCalls",
    "observationDeleteRows", "observationRowsPerDeleteCall",
    "legacySingletonObservationDeleteCalls", "batchedObservationDeleteCalls",
    "batchedObservationDeleteRows", "batchedObservationRowsPerDeleteCall",
    "activeArchiveGenerations", "sealedArchiveGenerations",
    "archiveRows", "archiveBytes", "failedArchiveJobs", "failedParityReceipts", "activeHolds",
    "verifiedBackups", "journalBytes", "dailyFileBytes", "retainedMediaBytes",
    "retainedMediaManifestFiles", "retainedMediaJpegFiles", "processedObservationIndexFiles",
    "processedObservationIndexBytes", "deletionIndexFiles", "deletionIndexBytes",
    "legacyProcessedMarkerFiles", "legacyDeletionTombstones", "mediaMetadataCheckpointBytes",
    "backupBytes", "datastreamsTableBytes", "datastreamsUpdates", "datastreamsHotUpdates",
    "connectionStatusRowsLastHour", "archiveSchemaDatastreamIndexPresent",
  ] as const;
  const numbers = Object.fromEntries(fields.map(field => [field, nullableNumber(probe[field])])) as
    Record<typeof fields[number], number | null>;
  return {phase, ...numbers, note: typeof probe.note === "string" ? probe.note : ""};
}

/** OSH public IDs are base32hex(varint(scope) + varlong(local ID)), without padding. */
export function encodeOshBigId(scope: number, localId: bigint): string {
  if (!Number.isSafeInteger(scope) || scope < 0) throw new Error("scope must be a non-negative integer");
  if (localId <= 0n || localId > 0x7fffffffffffffffn) throw new Error("local ID must be a positive signed 64-bit value");
  const bytes: number[] = [];
  const appendVarint = (input: bigint) => {
    let value = input;
    do {
      const bits = Number(value & 0x7fn);
      value >>= 7n;
      bytes.push(bits | (value === 0n ? 0 : 0x80));
    } while (value !== 0n);
  };
  appendVarint(BigInt(scope));
  appendVarint(localId);
  const alphabet = "0123456789abcdefghijklmnopqrstuv";
  let accumulator = 0;
  let bitCount = 0;
  let encoded = "";
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      encoded += alphabet[(accumulator >>> bitCount) & 31];
      accumulator &= (1 << bitCount) - 1;
    }
  }
  if (bitCount > 0) encoded += alphabet[(accumulator << (5 - bitCount)) & 31];
  return encoded;
}

export function parseCollectionIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(item => {
      if (!item || typeof item !== "object") return [];
      const id = (item as Record<string, unknown>).id;
      return typeof id === "string" ? [id] : [];
    });
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const items = Array.isArray(record.items) ? record.items
    : Array.isArray(record.results) ? record.results : [];
  return parseCollectionIds(items);
}
