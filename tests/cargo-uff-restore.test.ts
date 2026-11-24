import assert from "node:assert/strict";
import test from "node:test";
import {buildCargoUffRestorePayload} from "../src/scenarios.js";

test("buildCargoUffRestorePayload returns undefined when Cargo UFF was disabled prior to regression", () => {
  assert.equal(buildCargoUffRestorePayload(undefined, {}), undefined);
  assert.equal(buildCargoUffRestorePayload({enabled: false, sourceType: "smb"}, {cargoUffSmbShare: "\\\\nas.port.local\\oscar-uff"}), undefined);
});

test("buildCargoUffRestorePayload reconstructs SMB save-config payload with env password fallback", () => {
  const payload = buildCargoUffRestorePayload(
    {
      enabled: true,
      sourceType: "smb",
      shareUrl: "\\\\nas.port.local\\oscar-uff",
      subPath: "smb-date-archive",
      domain: "WORKGROUP",
      username: "nii_reader",
      correlationWindowMinutes: 45,
      allowFuzzyOcrMatch: true,
    },
    {
      cargoUffSmbPassword: "synthetic-test-secret",
    },
  );
  assert.deepEqual(payload, {
    action: "save-config",
    enabled: true,
    sourceType: "smb",
    shareUrl: "\\\\nas.port.local\\oscar-uff",
    subPath: "smb-date-archive",
    domain: "WORKGROUP",
    username: "nii_reader",
    password: "synthetic-test-secret",
    correlationWindowMinutes: 45,
    allowFuzzyOcrMatch: true,
  });
});

test("buildCargoUffRestorePayload reconstructs local directory save-config payload", () => {
  const payload = buildCargoUffRestorePayload(
    {
      enabled: true,
      sourceType: "local",
      localPath: "/srv/oscar/uff-drop",
      correlationWindowMinutes: 30,
      allowFuzzyOcrMatch: false,
    },
    {},
  );
  assert.deepEqual(payload, {
    action: "save-config",
    enabled: true,
    sourceType: "local",
    localPath: "/srv/oscar/uff-drop",
    correlationWindowMinutes: 30,
    allowFuzzyOcrMatch: false,
  });
});
