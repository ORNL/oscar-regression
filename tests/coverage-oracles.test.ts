import assert from "node:assert/strict";
import {resolve} from "node:path";
import test from "node:test";
import {
  assessDashboardWidgetCustomization,
  assessLaneViewStatusTableFaults,
  assessLiveVideoStartupAndAdvance,
  assessMultiCameraFeedCycle,
  assessViewerCachePolicy,
  canonicalAlarmTransferDocumentJson,
  importedAlarmChartsRendered,
  LIVE_VIDEO_MAX_STARTUP_MS,
  liveLaneTelemetryChartsAdvancing,
  liveLaneTelemetryChartsRendered,
  operationalViewScopePair,
  scopedUuidOperationalViewChecksEnabled,
} from "../src/coverage-oracles.js";
import {loadLaneConfigOracle, type LaneConfigOracle} from "../src/lane-config.js";

test("cache policy accepts private immutable assets and a non-cacheable protected error", () => {
  const result = assessViewerCachePolicy({
    authenticatedAsset: {
      status: 200,
      cacheControl: "private, max-age=31536000, immutable",
    },
    serviceWorker: {status: 200, cacheControl: "no-cache"},
    unauthenticatedAsset: {status: 401, cacheControl: ""},
  });

  assert.deepEqual(result, {
    authenticatedAssetValid: true,
    serviceWorkerValid: true,
    unauthenticatedAssetProtected: true,
    unauthenticatedAssetNotCacheable: true,
    passed: true,
  });
});

test("cache policy rejects public or long-lived authentication errors", () => {
  for (const cacheControl of [
    "private, max-age=31536000, immutable",
    "public, no-cache",
    "s-maxage=60",
  ]) {
    const result = assessViewerCachePolicy({
      authenticatedAsset: {status: 200, cacheControl: "private, max-age=31536000, immutable"},
      serviceWorker: {status: 200, cacheControl: "no-cache"},
      unauthenticatedAsset: {status: 401, cacheControl},
    });
    assert.equal(result.unauthenticatedAssetNotCacheable, false, cacheControl);
    assert.equal(result.passed, false, cacheControl);
  }

  const unprotected = assessViewerCachePolicy({
    authenticatedAsset: {status: 200, cacheControl: "private, max-age=31536000, immutable"},
    serviceWorker: {status: 200, cacheControl: "no-cache"},
    unauthenticatedAsset: {status: 200, cacheControl: "no-cache"},
  });
  assert.equal(unprotected.unauthenticatedAssetProtected, false);
  assert.equal(unprotected.passed, false);
});

test("operational-view probe chooses a real member view and a populated non-member view", () => {
  const oracle = loadLaneConfigOracle(resolve("fixtures/oscar-50-lane-config.csv"));
  assert.deepEqual(operationalViewScopePair(oracle, "Lane50"), {
    assignedView: "pedestrian",
    nonMemberView: "east-gate",
  });
  assert.deepEqual(operationalViewScopePair(oracle, "Lane01"), {
    assignedView: "east-gate",
    nonMemberView: "west-gate",
  });
});

test("operational-view probe rejects missing lanes and an oracle without a non-member scope", () => {
  const oracle = loadLaneConfigOracle(resolve("fixtures/oscar-50-lane-config.csv"));
  assert.throws(() => operationalViewScopePair(oracle, "Lane99"), /does not contain Lane99/);

  const oneViewOracle: LaneConfigOracle = {
    path: "fixture.csv",
    sha256: "fixture",
    lanes: [{name: "Lane01", uniqueId: "lane-01", operationalViews: ["east-gate"]}],
    lanesByView: new Map([["east-gate", ["Lane01"]]]),
  };
  assert.throws(
    () => operationalViewScopePair(oneViewOracle, "Lane01"),
    /no non-member operational view/,
  );
});

test("scoped UUID checks skip only disabled or auto-detected legacy view workflows", () => {
  assert.equal(scopedUuidOperationalViewChecksEnabled("disabled", true), false);
  assert.equal(scopedUuidOperationalViewChecksEnabled("auto", false), false);
  assert.equal(scopedUuidOperationalViewChecksEnabled("auto", true), true);
  assert.equal(scopedUuidOperationalViewChecksEnabled("required", false), true);
});

test("imported chart oracle requires the expected series color on each visible canvas", () => {
  const gamma = {
    width: 640, height: 320, clientWidth: 640, clientHeight: 320,
    gammaPlotPixels: 40, neutronPlotPixels: 0,
  };
  const neutron = {...gamma, gammaPlotPixels: 0, neutronPlotPixels: 30};
  const legendOnly = {...gamma, gammaPlotPixels: 0};
  assert.equal(importedAlarmChartsRendered(["gamma", "neutron"], [gamma, neutron]), true);
  assert.equal(importedAlarmChartsRendered(["gamma", "neutron"], [gamma]), false);
  assert.equal(importedAlarmChartsRendered(["gamma"], [legendOnly]), false);
  assert.equal(importedAlarmChartsRendered(["gamma", "neutron"], [neutron, gamma]), false);
  assert.equal(importedAlarmChartsRendered([], []), false);
});

test("live lane chart oracle requires painted Gamma and Neutron series, not empty canvases", () => {
  const gamma = {
    width: 640, height: 320, clientWidth: 640, clientHeight: 320,
    gammaPlotPixels: 40, neutronPlotPixels: 0,
  };
  const neutron = {...gamma, gammaPlotPixels: 0, neutronPlotPixels: 30};
  assert.equal(liveLaneTelemetryChartsRendered(gamma, neutron), true);
  assert.equal(liveLaneTelemetryChartsRendered({...gamma, gammaPlotPixels: 0}, neutron), false);
  assert.equal(liveLaneTelemetryChartsRendered(gamma, {...neutron, neutronPlotPixels: 0}), false);
  assert.equal(liveLaneTelemetryChartsRendered({...gamma, clientWidth: 0}, neutron), false);
});

test("canonical alarm document comparison ignores export-only QR metadata", () => {
  const canonical = {
    payload: {schema: "org.oscar.alarm-transfer", event: {observationId: "event-1"}},
    integrity: {algorithm: "SHA-256", digest: "abc"},
    transport: "OSCAR-ALARM:1:payload/digest",
  };
  assert.equal(
    canonicalAlarmTransferDocumentJson({...canonical, qrCharacters: 1170, qrFits: true}),
    canonicalAlarmTransferDocumentJson(canonical),
  );
  assert.notEqual(
    canonicalAlarmTransferDocumentJson(canonical),
    canonicalAlarmTransferDocumentJson({...canonical, transport: `${canonical.transport}-changed`}),
  );
  assert.throws(
    () => canonicalAlarmTransferDocumentJson({payload: canonical.payload}),
    /missing payload, integrity, or transport/,
  );
});

test("liveLaneTelemetryChartsAdvancing requires both Gamma and Neutron canvas digests to advance over time", () => {
  const initialGamma = {
    width: 640, height: 320, clientWidth: 640, clientHeight: 320,
    gammaPlotPixels: 40, neutronPlotPixels: 0, canvasDigest: "a1b2c3d4",
  };
  const initialNeutron = {
    width: 640, height: 320, clientWidth: 640, clientHeight: 320,
    gammaPlotPixels: 0, neutronPlotPixels: 30, canvasDigest: "11223344",
  };
  const nextGamma = {...initialGamma, gammaPlotPixels: 44, canvasDigest: "a1b2c3ff"};
  const nextNeutron = {...initialNeutron, neutronPlotPixels: 33, canvasDigest: "11223399"};

  assert.equal(
    liveLaneTelemetryChartsAdvancing(
      {gamma: initialGamma, neutron: initialNeutron},
      {gamma: nextGamma, neutron: nextNeutron},
    ),
    true,
  );
  // Frozen Gamma chart (same digest) fails
  assert.equal(
    liveLaneTelemetryChartsAdvancing(
      {gamma: initialGamma, neutron: initialNeutron},
      {gamma: initialGamma, neutron: nextNeutron},
    ),
    false,
  );
  // Frozen Neutron chart (same digest) fails
  assert.equal(
    liveLaneTelemetryChartsAdvancing(
      {gamma: initialGamma, neutron: initialNeutron},
      {gamma: nextGamma, neutron: initialNeutron},
    ),
    false,
  );
});

test("assessLiveVideoStartupAndAdvance enforces bounded cold startup latency and active playback", () => {
  assert.equal(
    assessLiveVideoStartupAndAdvance({
      readyState: 4,
      width: 640,
      height: 480,
      paused: false,
      advanced: true,
      startupMs: 850,
    }),
    true,
  );
  // Legacy >30s cold-start delay fails against LIVE_VIDEO_MAX_STARTUP_MS
  assert.equal(
    assessLiveVideoStartupAndAdvance({
      readyState: 4,
      width: 640,
      height: 480,
      paused: false,
      advanced: true,
      startupMs: LIVE_VIDEO_MAX_STARTUP_MS + 1,
    }),
    false,
  );
  assert.equal(
    assessLiveVideoStartupAndAdvance({
      readyState: 4,
      width: 640,
      height: 480,
      paused: true,
      advanced: true,
      startupMs: 500,
    }),
    false,
  );
});

test("assessMultiCameraFeedCycle validates 3-camera lanes (emulator + 2 Axis streams) with distinct manifests", () => {
  const feeds = [
    {index: 0, m3u8Url: "https://host/live/cam0/index.m3u8", readyState: 4, width: 1280, height: 720, advanced: true},
    {index: 1, m3u8Url: "https://host/live/cam1/index.m3u8", readyState: 4, width: 640, height: 480, advanced: true},
    {index: 2, m3u8Url: "https://host/live/cam2/index.m3u8", readyState: 4, width: 1920, height: 1080, advanced: true},
  ];
  assert.equal(assessMultiCameraFeedCycle(3, feeds), true);
  // Duplicate manifest URL fails
  assert.equal(
    assessMultiCameraFeedCycle(3, [
      feeds[0]!,
      {...feeds[1]!, m3u8Url: feeds[0]!.m3u8Url},
      feeds[2]!,
    ]),
    false,
  );
  // Stalled camera fails
  assert.equal(
    assessMultiCameraFeedCycle(3, [
      feeds[0]!,
      feeds[1]!,
      {...feeds[2]!, advanced: false},
    ]),
    false,
  );
});

test("assessDashboardWidgetCustomization and assessLaneViewStatusTableFaults validate widget state and fault rows", () => {
  assert.equal(
    assessDashboardWidgetCustomization({
      initialAllVisible: true,
      laneStatusHiddenInDom: true,
      storedWhenLaneStatusHidden: {laneStatus: false, eventTable: true, quickView: true},
      allHiddenResetPromptVisible: true,
      restoredAfterResetInDom: true,
      storedAfterReset: {laneStatus: true, eventTable: true, quickView: true},
    }),
    true,
  );
  assert.equal(
    assessDashboardWidgetCustomization({
      initialAllVisible: true,
      laneStatusHiddenInDom: true,
      storedWhenLaneStatusHidden: {laneStatus: true, eventTable: true, quickView: true},
      allHiddenResetPromptVisible: true,
      restoredAfterResetInDom: true,
      storedAfterReset: {laneStatus: true, eventTable: true, quickView: true},
    }),
    false,
  );

  const expectedFaults = [
    "Fault - Gamma High",
    "Fault - Gamma Low",
    "Fault - Neutron High",
    "Tamper",
  ];
  const validRows = [
    {status: "Fault — Gamma High", timestamp: "11/8/2026, 11:30:01 PM"},
    {status: "Fault - Gamma Low", timestamp: "11/8/2026, 11:30:15 PM"},
    {status: "Fault — Neutron High", timestamp: "11/8/2026, 11:30:30 PM"},
    {status: "Tamper", timestamp: "11/8/2026, 11:30:45 PM"},
  ];
  assert.equal(assessLaneViewStatusTableFaults(validRows, expectedFaults), true);
  assert.equal(
    assessLaneViewStatusTableFaults(
      [{status: "Tamper", timestamp: "Invalid Date"}, ...validRows.slice(0, 3)],
      expectedFaults,
    ),
    false,
  );
});
