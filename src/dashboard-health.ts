export interface HealthObservationBatch {
  streamIds: string[];
  limit: number | null;
}

export const DASHBOARD_HEALTH_MAX_BATCH_STREAMS = 10;
export const DASHBOARD_HEALTH_MAX_IN_FLIGHT = 2;
export const DASHBOARD_HEALTH_FIXTURE_ROUTE_TIMEOUT_MS = 30_000;

/**
 * Playwright invokes route handlers outside the scenario's awaited call tree.
 * Convert an intercepted fixture request failure into an observed result and a
 * best-effort aborted request so a rejected route.fetch cannot terminate Node
 * as an unhandled promise rejection before the reporter finalizes the run.
 */
export async function guardDashboardHealthFixtureRoute(
  operation: () => Promise<void>,
  onFailure: (error: unknown) => void,
  abort: () => Promise<void>,
): Promise<boolean> {
  try {
    await operation();
    return true;
  } catch (error) {
    onFailure(error);
    await abort().catch(() => undefined);
    return false;
  }
}

export interface HealthBatchAssessment {
  passed: boolean;
  validSizes: boolean;
  shared: boolean;
  boundedConcurrency: boolean;
}

export interface DashboardConnectionSnapshot {
  testId: string;
  componentId?: string | null;
  state: string | null;
  label: string;
}

export interface DashboardConnectionAssessment {
  passed: boolean;
  online: number;
  missing: string[];
  unexpected: string[];
  duplicates: string[];
  unresolved: string[];
}

/** Match the RPM's own Status-of-Health state without accepting a camera state later in the row. */
export function healthRowHasRpmConnectionState(
  text: string,
  state: "online" | "offline",
): boolean {
  const expected = state === "online" ? "Online" : "Offline";
  return new RegExp(`\\bRPM\\s*\\([^)]*\\)\\s*·\\s*${expected}\\b`, "i").test(text);
}

export interface ConnectionRewriteSummary {
  matched: number;
  offlineMatched: number;
}

export interface DashboardTamperIndicatorSnapshot {
  laneId: string;
  state: string | null;
  label: string;
}

export interface DashboardTamperBaselineAssessment {
  passed: boolean;
  laneCount: number;
  uniqueLaneCount: number;
  clearCount: number;
  unknownLaneIds: string[];
  activeLaneIds: string[];
  invalidLaneIds: string[];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function itemProperties(item: JsonRecord): JsonRecord {
  return isRecord(item.properties) ? item.properties : item;
}

function connectionResult(item: JsonRecord): JsonRecord | undefined {
  const properties = itemProperties(item);
  return isRecord(item.result)
    ? item.result
    : isRecord(properties.result)
      ? properties.result
      : undefined;
}

function observationStreamId(item: JsonRecord): string | null {
  const properties = itemProperties(item);
  const value = item["datastream@id"] ?? properties["datastream@id"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Recognize the batched latest-observation requests used by the shared lane
 * health snapshot. Other observation traffic must not affect the polling
 * concurrency oracle.
 */
export function parseHealthObservationBatch(rawUrl: string): HealthObservationBatch | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!/\/observations\/?$/.test(url.pathname) ||
      url.searchParams.get("resultTime")?.toLowerCase() !== "latest") {
    return null;
  }

  const streamIds = (url.searchParams.get("dataStream") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (streamIds.length === 0) return null;

  const rawLimit = url.searchParams.get("limit");
  const parsedLimit = rawLimit === null ? null : Number(rawLimit);
  return {
    streamIds,
    limit: parsedLimit !== null && Number.isInteger(parsedLimit) ? parsedLimit : null,
  };
}

/** Enforce the Viewer dashboard's bounded shared latest-observation request contract. */
export function assessHealthObservationBatches(
  batches: readonly HealthObservationBatch[],
  expectedLaneCount: number,
  peakInFlight: number,
): HealthBatchAssessment {
  const validSizes = batches.every((batch) => batch.streamIds.length > 0 &&
    batch.streamIds.length <= DASHBOARD_HEALTH_MAX_BATCH_STREAMS &&
    batch.limit === batch.streamIds.length);
  const shared = expectedLaneCount <= 1 ||
    (batches.length < expectedLaneCount && batches.some((batch) => batch.streamIds.length > 1));
  const boundedConcurrency = peakInFlight <= DASHBOARD_HEALTH_MAX_IN_FLIGHT;
  return {
    passed: batches.length > 0 && validSizes && shared && boundedConcurrency,
    validSizes,
    shared,
    boundedConcurrency,
  };
}

/** Build the exact Dashboard connection-chip identities expected for the configured lanes. */
export function expectedDashboardConnectionIds(
  laneNames: readonly string[],
  cameraPerLane: boolean,
): string[] {
  return laneNames.flatMap((laneName) => [
    `lane-health-${laneName}-rpm`,
    ...(cameraPerLane ? [`lane-health-${laneName}-camera`] : []),
  ]);
}

/**
 * Require every expected chip, and only those chips, to resolve to an
 * accessible Online state. The scenario applies this oracle inside a bounded
 * poll so a permanently Waiting/Unknown chip cannot pass on aggregate counts.
 */
export function assessDashboardConnectionResolution(
  snapshots: readonly DashboardConnectionSnapshot[],
  expectedIds: readonly string[],
  expectedCameraCount?: number,
): DashboardConnectionAssessment {
  const hasExplicitCameraIds = expectedIds.some((id) => id.endsWith("-camera"));
  if (expectedCameraCount !== undefined && !hasExplicitCameraIds) {
    const expectedRpms = new Set(expectedIds);
    const allowedCameraIds = expectedCameraCount > 0
      ? new Set(expectedIds.map((id) => id.replace(/-rpm$/, "-camera")))
      : new Set<string>();
    const seenRpms = new Set<string>();
    const duplicates = new Set<string>();
    const unexpectedSet = new Set<string>();
    const seenCameraComponents = new Set<string>();
    const cameraCountsByTestId = new Map<string, number>();
    const missingComponentTestIds = new Set<string>();
    let cameraCount = 0;

    for (const snapshot of snapshots) {
      if (snapshot.testId.endsWith("-camera")) {
        cameraCount++;
        cameraCountsByTestId.set(snapshot.testId, (cameraCountsByTestId.get(snapshot.testId) ?? 0) + 1);
        if (!allowedCameraIds.has(snapshot.testId)) {
          unexpectedSet.add(snapshot.testId);
        }
        const componentId = snapshot.componentId?.trim() ?? "";
        if (componentId.length > 0) {
          if (seenCameraComponents.has(componentId)) {
            duplicates.add(snapshot.testId);
          }
          seenCameraComponents.add(componentId);
        } else {
          missingComponentTestIds.add(snapshot.testId);
        }
      } else {
        if (seenRpms.has(snapshot.testId)) {
          duplicates.add(snapshot.testId);
        }
        seenRpms.add(snapshot.testId);
        if (!expectedRpms.has(snapshot.testId)) {
          unexpectedSet.add(snapshot.testId);
        }
      }
    }

    for (const testId of missingComponentTestIds) {
      if ((cameraCountsByTestId.get(testId) ?? 0) > 1) {
        duplicates.add(testId);
      }
    }

    const missing = [...expectedRpms].filter((testId) => !seenRpms.has(testId)).sort();
    if (cameraCount < expectedCameraCount) {
      missing.push(`camera-count:${cameraCount}/${expectedCameraCount}`);
    } else if (cameraCount > expectedCameraCount) {
      unexpectedSet.add(`camera-count:${cameraCount}/${expectedCameraCount}`);
    }
    const unexpected = [...unexpectedSet].sort();
    const unresolved = snapshots
      .filter(({state, label}) => state !== "online" || !/online/i.test(label))
      .map(({testId, componentId, state}) =>
        `${componentId ? `${testId}[${componentId}]` : testId}:${state ?? "missing-state"}`)
      .sort();
    const online = snapshots.length - unresolved.length;
    const expectedTotal = expectedIds.length + expectedCameraCount;
    return {
      passed: snapshots.length === expectedTotal && missing.length === 0 && unexpected.length === 0 &&
        duplicates.size === 0 && unresolved.length === 0,
      online,
      missing,
      unexpected,
      duplicates: [...duplicates].sort(),
      unresolved,
    };
  }

  const expected = new Set(expectedIds);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const snapshot of snapshots) {
    if (seen.has(snapshot.testId)) duplicates.add(snapshot.testId);
    seen.add(snapshot.testId);
  }
  const missing = [...expected].filter((testId) => !seen.has(testId)).sort();
  const unexpected = [...seen].filter((testId) => !expected.has(testId)).sort();
  const unresolved = snapshots
    .filter(({state, label}) => state !== "online" || !/online/i.test(label))
    .map(({testId, state}) => `${testId}:${state ?? "missing-state"}`)
    .sort();
  const online = snapshots.length - unresolved.length;
  return {
    passed: snapshots.length === expectedIds.length && missing.length === 0 && unexpected.length === 0 &&
      duplicates.size === 0 && unresolved.length === 0,
    online,
    missing,
    unexpected,
    duplicates: [...duplicates].sort(),
    unresolved,
  };
}

/**
 * Dashboard clear fault states intentionally have no compact icon. After the
 * live latest-observation batches have settled, one card per expected lane and
 * no Tamper indicator is therefore the user-visible known-clear baseline.
 */
export function assessDashboardKnownClearTamper(
  laneIds: readonly string[],
  indicators: readonly DashboardTamperIndicatorSnapshot[],
  expectedLaneCount: number,
): DashboardTamperBaselineAssessment {
  const uniqueLaneIds = new Set(laneIds);
  const unknownLaneIds = indicators
    .filter(({state}) => state === "unknown")
    .map(({laneId}) => laneId)
    .sort();
  const activeLaneIds = indicators
    .filter(({state}) => state === "active")
    .map(({laneId}) => laneId)
    .sort();
  const invalidLaneIds = indicators
    .filter(({laneId, state, label}) =>
      !uniqueLaneIds.has(laneId) ||
      (state !== "unknown" && state !== "active") ||
      !/^Tamper: (?:Unknown|Fault)$/.test(label))
    .map(({laneId}) => laneId)
    .sort();
  const lanesAreCanonical = laneIds.length === expectedLaneCount &&
    uniqueLaneIds.size === expectedLaneCount && laneIds.every(Boolean);
  const passed = lanesAreCanonical && indicators.length === 0;
  const indicatedLaneIds = new Set(indicators.map(({laneId}) => laneId));
  const clearCount = [...uniqueLaneIds].filter((laneId) => !indicatedLaneIds.has(laneId)).length;

  return {
    passed,
    laneCount: laneIds.length,
    uniqueLaneCount: uniqueLaneIds.size,
    clearCount,
    unknownLaneIds,
    activeLaneIds,
    invalidLaneIds,
  };
}

/**
 * Browser-only deterministic fixture used to prove that RPM and every camera
 * render independently as Offline. It rewrites connection observations in a
 * copied HTTP response and never changes SensorHub or emulator state.
 */
export function forceConnectionObservationsOffline(payload: unknown): number {
  if (!isRecord(payload) || !Array.isArray(payload.items)) return 0;

  let matched = 0;
  for (const item of payload.items) {
    if (!isRecord(item)) continue;
    const result = connectionResult(item);
    if (!result) continue;

    if (typeof result.isConnected === "boolean") {
      result.isConnected = false;
      matched++;
    } else if (typeof result.connection === "boolean") {
      result.connection = false;
      matched++;
    }
  }
  return matched;
}

/**
 * Drive one identified connection observation Offline while normalizing every
 * other connection observation to Online. The target is a datastream ID read
 * from the live camera system metadata, so the fixture does not depend on API
 * result ordering or generated component IDs.
 */
export function forceSingleConnectionObservationOffline(
  payload: unknown,
  targetStreamId: string,
): ConnectionRewriteSummary {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    return {matched: 0, offlineMatched: 0};
  }

  let matched = 0;
  let offlineMatched = 0;
  for (const item of payload.items) {
    if (!isRecord(item)) continue;
    const result = connectionResult(item);
    if (!result) continue;

    const hasIsConnected = typeof result.isConnected === "boolean";
    const hasConnection = typeof result.connection === "boolean";
    if (!hasIsConnected && !hasConnection) continue;

    const offline = observationStreamId(item) === targetStreamId;
    if (hasIsConnected) result.isConnected = !offline;
    if (hasConnection) result.connection = !offline;
    matched++;
    if (offline) offlineMatched++;
  }
  return {matched, offlineMatched};
}

/** Return connection-status datastream IDs from a raw or parser-wrapped API collection. */
export function connectionDataStreamIds(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) return [];

  const ids = new Set<string>();
  for (const item of payload.items) {
    if (!isRecord(item)) continue;
    const nested = isRecord(item.properties) ? item.properties : undefined;
    const observedProperties = Array.isArray(item.observedProperties)
      ? item.observedProperties
      : nested?.observedProperties;
    if (!Array.isArray(observedProperties)) continue;
    const definitions = observedProperties
      .map((property) => isRecord(property) ? property.definition : undefined)
      .filter((definition): definition is string => typeof definition === "string");
    const isConnection = definitions.some((definition) =>
      definition === "http://www.opengis.net/def/ConnectionStatus" ||
      definition === "http://www.opengis.net/def/property/OGC/0/ConnectionStatus");
    const id = item.id ?? nested?.id;
    if (isConnection && typeof id === "string" && id.length > 0) ids.add(id);
  }
  return [...ids];
}
