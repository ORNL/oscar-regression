import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import test from "node:test";
import {
  assertMutationAllowed,
  loadConfig,
  MIN_EXTENDED_OCCUPANCY_SECONDS,
  requiresRemoteSuiteLease,
} from "../src/config.js";

const baseEnvironment = {
  OSCAR_BASE_URL: "https://192.0.2.10",
  OSCAR_USERNAME: "admin",
  OSCAR_PASSWORD: "test-only",
  OSCAR_TEST_TARGET_ACK: "192.0.2.10",
  RPM_EMULATOR_URL: "http://192.0.2.20:8000",
  RPM_EMULATOR_TARGET_ACK: "192.0.2.20",
  TEST_RPM_ID: "rpm-50",
  TEST_LANE_LABEL: "Lane50",
  RPM_LANE_MAPPING_ACK: "rpm-50:Lane50",
  OPERATIONAL_VIEW_WORKFLOW: "auto",
  OSCAR_LANE_CONFIG_PATH: resolve("fixtures/oscar-50-lane-config.csv"),
  EVENT_UUID_WORKFLOW: "auto",
  ALARM_TRANSFER_CAMERA_WORKFLOW: "auto",
};

const configurationEnvironmentNames = [...readFileSync(resolve(".env.example"), "utf8")
  .matchAll(/^(?:#\s*)?([A-Z][A-Z0-9_]*)=/gm)]
  .map((match) => match[1])
  .filter((name): name is string => Boolean(name));

function withEnvironment(values: Record<string, string>, operation: () => void): void {
  const names = [...new Set([...configurationEnvironmentNames, ...Object.keys(values)])];
  const original = new Map(names.map((name) => [name, process.env[name]]));
  // Keep every documented key defined-but-empty so loadConfig() cannot refill
  // test state from a runner's private .env file.
  for (const name of names) process.env[name] = "";
  Object.assign(process.env, values);
  try { operation(); } finally {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("full profile requires exact OSCAR, emulator, and RPM/lane acknowledgements", () => {
  withEnvironment({...baseEnvironment,
    OSCAR_SSH_TARGET: "tester@192.0.2.10",
    OSCAR_RELEASE_DIR: "/opt/oscar-test"}, () => {
    const valid = loadConfig(["--profile", "full", "--scenario", "rpm-faults"]);
    assert.doesNotThrow(() => assertMutationAllowed(valid));

    assert.throws(
      () => assertMutationAllowed({...valid, rpmEmulatorAcknowledgement: "wrong-host"}),
      /RPM_EMULATOR_TARGET_ACK/,
    );
    assert.throws(
      () => assertMutationAllowed({...valid, rpmLaneMappingAcknowledgement: "rpm-49:Lane49"}),
      /RPM_LANE_MAPPING_ACK/,
    );
  });
});

test("configuration rejects unknown scenarios and partial integer values", () => {
  withEnvironment(baseEnvironment, () => {
    assert.throws(() => loadConfig(["--scenario", "rpm-fualts"]), /Unknown --scenario/);
    process.env.EXPECTED_LANE_COUNT = "50junk";
    assert.throws(() => loadConfig([]), /whole-number integer/);
    delete process.env.EXPECTED_LANE_COUNT;
  });
});

test("configuration accepts UUID workflow modes and the event-uuid scenario", () => {
  withEnvironment({...baseEnvironment, EVENT_UUID_WORKFLOW: "required"}, () => {
    const config = loadConfig(["--profile", "full", "--scenario", "event-uuid"]);
    assert.equal(config.eventUuidWorkflow, "required");
    assert.deepEqual([...config.scenarioFilter], ["event-uuid"]);
  });

  withEnvironment({...baseEnvironment, EVENT_UUID_WORKFLOW: "sometimes"}, () => {
    assert.throws(() => loadConfig([]), /EVENT_UUID_WORKFLOW must be auto, required, or disabled/);
  });
});

test("configuration accepts camera workflow modes and the alarm-transfer-camera scenario", () => {
  for (const mode of ["auto", "required", "disabled"] as const) {
    withEnvironment({...baseEnvironment, ALARM_TRANSFER_CAMERA_WORKFLOW: mode}, () => {
      const config = loadConfig(["--scenario", "alarm-transfer-camera"]);
      assert.equal(config.alarmTransferCameraWorkflow, mode);
      assert.deepEqual([...config.scenarioFilter], ["alarm-transfer-camera"]);
    });
  }

  withEnvironment({...baseEnvironment, ALARM_TRANSFER_CAMERA_WORKFLOW: "sometimes"}, () => {
    assert.throws(
      () => loadConfig([]),
      /ALARM_TRANSFER_CAMERA_WORKFLOW must be auto, required, or disabled/,
    );
  });
});

test("configuration accepts the dashboard-health scenario", () => {
  withEnvironment(baseEnvironment, () => {
    const config = loadConfig(["--scenario", "dashboard-health"]);
    assert.deepEqual([...config.scenarioFilter], ["dashboard-health"]);
  });
});

test("full storage lifecycle requires an exact disposable-storage acknowledgement", () => {
  withEnvironment({...baseEnvironment, STORAGE_WORKFLOW: "required", OSCAR_SSH_TARGET: "tester@192.0.2.10",
    OSCAR_RELEASE_DIR: "/opt/oscar-test",
    OSCAR_STORAGE_TARGET_ACK: "192.0.2.10|tester@192.0.2.10|/opt/oscar-test|DISPOSABLE-STORAGE"}, () => {
    const config = loadConfig(["--profile", "full", "--scenario", "storage-lifecycle"]);
    assert.doesNotThrow(() => assertMutationAllowed(config));
    assert.throws(() => assertMutationAllowed({...config, storageTargetAcknowledgement: "wrong"}),
      /OSCAR_STORAGE_TARGET_ACK/);
  });
});

test("smoke storage probes require the exact Viewer, SSH, and canonical release acknowledgement", () => {
  const environment = {...baseEnvironment, STORAGE_WORKFLOW: "required",
    OSCAR_SSH_TARGET: "tester@192.0.2.10", OSCAR_RELEASE_DIR: "/opt/oscar-test",
    OSCAR_STORAGE_TARGET_ACK: "192.0.2.10|tester@192.0.2.10|/opt/oscar-test|DISPOSABLE-STORAGE"};
  withEnvironment(environment, () => {
    const config = loadConfig(["--profile", "smoke", "--scenario", "storage-health"]);
    assert.doesNotThrow(() => assertMutationAllowed(config));
    assert.throws(
      () => assertMutationAllowed({...config, storageTargetAcknowledgement:
        "192.0.2.10|wrong@192.0.2.10|/opt/oscar-test|DISPOSABLE-STORAGE"}),
      /OSCAR_STORAGE_TARGET_ACK/,
    );
    assert.throws(
      () => assertMutationAllowed({...config, storageTargetAcknowledgement: ""}),
      /OSCAR_STORAGE_TARGET_ACK/,
    );
  });
});

test("3.9.2 storage defaults to required while full runs always require the remote lease target", () => {
  withEnvironment({...baseEnvironment, STORAGE_WORKFLOW: " "}, () => {
    const config = loadConfig(["--profile", "full"]);
    assert.equal(config.storageWorkflow, "required");
    assert.throws(() => assertMutationAllowed(config), /OSCAR_SSH_TARGET and OSCAR_RELEASE_DIR/);
  });
  withEnvironment({...baseEnvironment, STORAGE_WORKFLOW: "auto"}, () => {
    const config = loadConfig(["--profile", "full"]);
    assert.throws(() => assertMutationAllowed(config), /remote suite lease/);
  });
  withEnvironment({...baseEnvironment, STORAGE_WORKFLOW: "auto",
    OSCAR_SSH_TARGET: "tester@192.0.2.10", OSCAR_RELEASE_DIR: "/opt/oscar-test",
    OSCAR_STORAGE_TARGET_ACK:
      "192.0.2.10|tester@192.0.2.10|/opt/oscar-test|DISPOSABLE-STORAGE"}, () => {
    assert.doesNotThrow(() => assertMutationAllowed(
      loadConfig(["--profile", "full", "--scenario", "rpm-faults"]),
    ));
  });
});

test("3.9.2 release certification is unfiltered and requires every release gate", () => {
  const releaseEnvironment = {
    ...baseEnvironment,
    OPERATIONAL_VIEW_WORKFLOW: "required",
    EVENT_UUID_WORKFLOW: "required",
    ALARM_TRANSFER_CAMERA_WORKFLOW: "required",
    STORAGE_WORKFLOW: "required",
    STORAGE_BACKUP_WORKFLOW: "required",
    OSCAR_BACKUP_MODE: "disabled",
    OSCAR_SSH_TARGET: "tester@192.0.2.10",
    OSCAR_RELEASE_DIR: "/opt/oscar-test",
    OSCAR_STORAGE_TARGET_ACK:
      "192.0.2.10|tester@192.0.2.10|/opt/oscar-test|DISPOSABLE-STORAGE",
    OSCAR_BUILD_LABEL: "oscar-3.9.2-candidate-abc123",
  };
  withEnvironment(releaseEnvironment, () => {
    const config = loadConfig(["--profile", "3.9.2-release"]);
    assert.equal(config.profile, "3.9.2-release");
    assert.equal(config.storageBackupMode, "disabled");
    assert.equal(config.releaseRestoreEvidenceDirectory, undefined);
    assert.equal(requiresRemoteSuiteLease(config), true);
    assert.doesNotThrow(() => assertMutationAllowed(config));
    assert.throws(
      () => loadConfig(["--profile", "3.9.2-release", "--scenario", "event-uuid"]),
      /unfiltered full certification/,
    );
  });
  for (const [name, value] of [
    ["OPERATIONAL_VIEW_WORKFLOW", "auto"],
    ["EVENT_UUID_WORKFLOW", "auto"],
    ["ALARM_TRANSFER_CAMERA_WORKFLOW", "disabled"],
    ["STORAGE_WORKFLOW", "auto"],
    ["STORAGE_BACKUP_WORKFLOW", "auto"],
  ] as const) {
    withEnvironment({...releaseEnvironment, [name]: value}, () => {
      assert.throws(() => loadConfig(["--profile", "3.9.2-release"]), /requires .* workflows/);
    });
  }
  withEnvironment({...releaseEnvironment, OSCAR_BUILD_LABEL: ""}, () => {
    assert.throws(() => loadConfig(["--profile", "3.9.2-release"]), /OSCAR_BUILD_LABEL/);
  });
  withEnvironment({...releaseEnvironment, OSCAR_BACKUP_MODE: "single",
    OSCAR_3_9_2_RESTORE_EVIDENCE_DIR: ""}, () => {
    assert.throws(() => loadConfig(["--profile", "3.9.2-release"]), /RESTORE_EVIDENCE_DIR/);
  });
  withEnvironment({...releaseEnvironment, OSCAR_BACKUP_MODE: "single",
    OSCAR_3_9_2_RESTORE_EVIDENCE_DIR: "/tmp/oscar-restore-evidence"}, () => {
    assert.equal(loadConfig(["--profile", "3.9.2-release"]).storageBackupMode, "single");
  });
  withEnvironment({...releaseEnvironment,
    OSCAR_BUILD_LABEL: "oscar-3.11.0-candidate-def456",
    EML_WORKFLOW: "auto"}, () => {
    assert.throws(() => loadConfig(["--profile", "3.11.0-release"]), /requires .* workflows/);
  });
  withEnvironment({...releaseEnvironment,
    OSCAR_BUILD_LABEL: "oscar-3.11.0-candidate-def456",
    EML_WORKFLOW: "required",
    OSCAR_EML_PLUGIN_PATH: ""}, () => {
    assert.throws(() => loadConfig(["--profile", "3.11.0-release"]), /OSCAR_EML_PLUGIN_PATH/);
  });
  withEnvironment({...releaseEnvironment,
    OSCAR_BUILD_LABEL: "oscar-3.11.0-candidate-def456",
    EML_WORKFLOW: "required",
    OSCAR_EML_PLUGIN_PATH: "fixtures/oscar-50-lane-config.csv"}, () => {
    assert.throws(() => loadConfig(["--profile", "3.11.0-release"]), /must end with \.jar/);
  });
  const tempEmlDir = mkdtempSync(join(tmpdir(), "oscar-eml-cfg-"));
  const tempEmlJar = join(tempEmlDir, "synthetic-plugin.jar");
  writeFileSync(tempEmlJar, "PK\x03\x04");
  try {
    withEnvironment({...releaseEnvironment,
      OSCAR_BUILD_LABEL: "oscar-3.11.0-candidate-def456",
      EML_WORKFLOW: "required",
      OSCAR_EML_PLUGIN_PATH: tempEmlJar,
      OSCAR_BACKUP_MODE: "single",
      OSCAR_3_11_0_RESTORE_EVIDENCE_DIR: "/tmp/oscar-311-restore-evidence"}, () => {
      const config = loadConfig(["--profile", "3.11.0-release"]);
      assert.equal(config.profile, "3.11.0-release");
      assert.equal(config.emlWorkflow, "required");
      assert.equal(config.emlPluginPath, tempEmlJar);
      assert.equal(config.releaseRestoreEvidenceDirectory, "/tmp/oscar-311-restore-evidence");
      assert.equal(requiresRemoteSuiteLease(config), true);
    });
  } finally {
    rmSync(tempEmlDir, {recursive: true, force: true});
  }
});

test("retained-media configuration accepts bounded OSCAR public observation identities", () => {
  withEnvironment({...baseEnvironment,
    STORAGE_RETAINED_EVENT_ID: "0i4d0ko",
    STORAGE_LEGACY_EVENT_ID: "obs/legacy"}, () => {
    assert.equal(loadConfig([]).storageRetainedEventId, "0i4d0ko");
    assert.equal(loadConfig([]).storageLegacyEventId, "obs/legacy");
  });
  withEnvironment({...baseEnvironment, STORAGE_RETAINED_EVENT_ID: "x".repeat(129)}, () => {
    assert.throws(() => loadConfig([]), /public observation ID/);
  });
});

test("remote suite lease covers full, restore, and every configured storage mutator", () => {
  withEnvironment(baseEnvironment, () => {
    assert.equal(requiresRemoteSuiteLease(loadConfig(["--profile", "smoke", "--scenario", "event-uuid"])), false);
  });
  withEnvironment({...baseEnvironment, STORAGE_WORKFLOW: "required",
    OSCAR_SSH_TARGET: "tester@192.0.2.10", OSCAR_RELEASE_DIR: "/opt/oscar-test"}, () => {
    assert.equal(requiresRemoteSuiteLease(
      loadConfig(["--profile", "smoke", "--scenario", "storage-health"]),
    ), true);
  });
  withEnvironment({...baseEnvironment, STORAGE_WORKFLOW: "disabled"}, () => {
    assert.equal(requiresRemoteSuiteLease(
      loadConfig(["--profile", "smoke", "--scenario", "map-national-servers"]),
    ), true);
    assert.equal(requiresRemoteSuiteLease(
      loadConfig(["--profile", "smoke", "--scenario", "lane-video"]),
    ), true);
    assert.throws(
      () => assertMutationAllowed(loadConfig([
        "--profile", "smoke", "--scenario", "map-national-servers",
      ])),
      /every mutating run requires OSCAR_SSH_TARGET/,
    );
  });
});

test("restore drill is isolated from ordinary profiles and requires exact target, data-loss, and path acknowledgements", () => {
  const restoreEnvironment = {
    ...baseEnvironment,
    STORAGE_WORKFLOW: "required",
    STORAGE_BACKUP_WORKFLOW: "required",
    OSCAR_BACKUP_MODE: "single",
    OSCAR_SSH_TARGET: "tester@192.0.2.10",
    OSCAR_RELEASE_DIR: "/opt/oscar-restore-test",
    OSCAR_STORAGE_TARGET_ACK:
      "192.0.2.10|tester@192.0.2.10|/opt/oscar-restore-test|DISPOSABLE-STORAGE",
    OSCAR_RESTORE_TARGET_ACK: "192.0.2.10|tester@192.0.2.10|/opt/oscar-restore-test|ISOLATED-RESTORE",
    OSCAR_RESTORE_DISPOSABLE_ACK: "192.0.2.10:DISPOSABLE-NO-PRODUCTION-DATA",
    OSCAR_RESTORE_DATA_LOSS_ACK: "I-ACCEPT-DESTRUCTIVE-RESTORE",
    OSCAR_RESTORE_ARCHIVE_DIR: "/srv/oscar-restore/archive",
    OSCAR_RESTORE_BACKUP_DIR: "/srv/oscar-restore/backups",
    OSCAR_RESTORE_PATHS_ACK: "/srv/oscar-restore/archive|/srv/oscar-restore/backups|DEDICATED-RESTORE-PATHS",
  };
  withEnvironment(restoreEnvironment, () => {
    const config = loadConfig(["--profile", "restore-drill"]);
    assert.equal(config.profile, "restore-drill");
    assert.doesNotThrow(() => assertMutationAllowed(config));
    for (const [field, expected] of [
      ["restoreTargetAcknowledgement", /OSCAR_RESTORE_TARGET_ACK/],
      ["restoreDisposableAcknowledgement", /OSCAR_RESTORE_DISPOSABLE_ACK/],
      ["restoreDataLossAcknowledgement", /OSCAR_RESTORE_DATA_LOSS_ACK/],
      ["restorePathsAcknowledgement", /OSCAR_RESTORE_PATHS_ACK/],
    ] as const) {
      assert.throws(() => assertMutationAllowed({...config, [field]: "wrong"}), expected);
    }
    assert.throws(
      () => loadConfig(["--profile", "restore-drill", "--scenario", "storage-health"]),
      /may run only storage-restore-drill/,
    );
    assert.throws(
      () => loadConfig(["--profile", "full", "--scenario", "storage-restore-drill"]),
      /requires --profile restore-drill/,
    );
    assert.throws(() => assertMutationAllowed({
      ...config, restoreBackupDirectory: config.restoreArchiveDirectory!,
    }), /distinct, non-overlapping planes/);
    assert.throws(
      () => assertMutationAllowed({...config, storageBackupWorkflow: "auto"}),
      /STORAGE_BACKUP_WORKFLOW must be required/,
    );
  });
});

test("restore drill rejects noncanonical or root storage planes", () => {
  withEnvironment({...baseEnvironment, OSCAR_RESTORE_ARCHIVE_DIR: "/srv/oscar/../archive"}, () => {
    assert.throws(() => loadConfig(["--profile", "restore-drill"]), /parent-directory|canonical, non-root/);
  });
  withEnvironment({...baseEnvironment, OSCAR_RESTORE_BACKUP_DIR: "/"}, () => {
    assert.throws(() => loadConfig(["--profile", "restore-drill"]), /canonical, non-root/);
  });
});

test("storage paths, modes, and numeric bounds fail closed", () => {
  withEnvironment({...baseEnvironment, OSCAR_RELEASE_DIR: "relative/release"}, () => {
    assert.throws(() => loadConfig(["--scenario", "storage-health"]), /absolute remote POSIX path/);
  });
  withEnvironment({...baseEnvironment, STORAGE_WORKFLOW: "maybe"}, () => {
    assert.throws(() => loadConfig([]), /STORAGE_WORKFLOW must be auto, required, or disabled/);
  });
  withEnvironment({...baseEnvironment, OSCAR_BACKUP_MODE: "DISABLED"}, () => {
    assert.throws(() => loadConfig([]), /literal lowercase value disabled or single/);
  });
  withEnvironment(baseEnvironment, () => {
    const config = loadConfig([]);
    assert.equal(config.storageBackupMode, "disabled");
    assert.equal(config.storageHotRetentionDays, 1,
      "disposable lifecycle defaults to the documented accelerated one-day policy");
  });
  withEnvironment({...baseEnvironment, OSCAR_RELEASE_DIR: "/opt/oscar/./release"}, () => {
    assert.throws(() => loadConfig(["--scenario", "storage-health"]), /canonical, non-root/);
  });
  withEnvironment({...baseEnvironment, OSCAR_RELEASE_DIR: "/"}, () => {
    assert.throws(() => loadConfig(["--scenario", "storage-health"]), /canonical, non-root/);
  });
  withEnvironment({...baseEnvironment, STORAGE_HOT_RETENTION_DAYS: "0"}, () => {
    assert.throws(() => loadConfig([]), /STORAGE_HOT_RETENTION_DAYS must be an integer >= 1/);
  });
  withEnvironment(baseEnvironment, () => {
    const config = loadConfig([]);
    assert.equal(config.storageProbeTimeoutMs, 1_800_000);
    assert.equal(config.storageRestoreProbeTimeoutMs, 7_200_000);
  });
  withEnvironment({...baseEnvironment, STORAGE_RESTORE_PROBE_TIMEOUT_MS: "599999"}, () => {
    assert.throws(
      () => loadConfig([]),
      /STORAGE_RESTORE_PROBE_TIMEOUT_MS must be an integer >= 600000/,
    );
  });
  withEnvironment({...baseEnvironment, STORAGE_RESTORE_PROBE_TIMEOUT_MS: "28800001"}, () => {
    assert.throws(
      () => loadConfig([]),
      /STORAGE_RESTORE_PROBE_TIMEOUT_MS must be an integer between 600000 and 28800000/,
    );
  });
});

test("extended occupancy reserves reconnect and post-threshold observation time", () => {
  withEnvironment(baseEnvironment, () => {
    assert.equal(MIN_EXTENDED_OCCUPANCY_SECONDS, 150);
    assert.equal(loadConfig([]).extendedOccupancySeconds, 150);
  });
  withEnvironment({...baseEnvironment, EXTENDED_OCCUPANCY_SECONDS: "149"}, () => {
    assert.throws(
      () => loadConfig([]),
      /EXTENDED_OCCUPANCY_SECONDS must be an integer >= 150/,
    );
  });
  withEnvironment({...baseEnvironment, EXTENDED_OCCUPANCY_SECONDS: "180"}, () => {
    assert.equal(loadConfig([]).extendedOccupancySeconds, 180);
  });
});

test("configuration loads the lane membership oracle and operational-view workflow mode", () => {
  withEnvironment({...baseEnvironment, OPERATIONAL_VIEW_WORKFLOW: "required"}, () => {
    const config = loadConfig(["--scenario", "operational-views"]);
    assert.equal(config.operationalViewWorkflow, "required");
    assert.equal(config.oscarLaneConfigPath, resolve("fixtures/oscar-50-lane-config.csv"));
    assert.ok(config.laneConfigOracle);
    assert.equal(config.laneConfigOracle.lanes.length, 50);
    assert.deepEqual(config.laneConfigOracle.lanesByView.get("east-gate"),
      Array.from({length: 10}, (_, index) => `Lane${String(index + 1).padStart(2, "0")}`));
  });

  withEnvironment({...baseEnvironment, OPERATIONAL_VIEW_WORKFLOW: "sometimes"}, () => {
    assert.throws(() => loadConfig([]), /OPERATIONAL_VIEW_WORKFLOW must be auto, required, or disabled/);
  });
});

test("operational-view modes default to a required gate and preserve explicit legacy behavior", () => {
  withEnvironment({...baseEnvironment, OPERATIONAL_VIEW_WORKFLOW: " "}, () => {
    assert.equal(loadConfig([]).operationalViewWorkflow, "required");
  });

  withEnvironment({
    ...baseEnvironment,
    OPERATIONAL_VIEW_WORKFLOW: "disabled",
    OSCAR_LANE_CONFIG_PATH: resolve("fixtures/does-not-exist.csv"),
    EXPECTED_LANE_COUNT: "10",
  }, () => {
    const config = loadConfig([]);
    assert.equal(config.operationalViewWorkflow, "disabled");
    assert.equal(config.laneConfigOracle, undefined);
  });

  const root = mkdtempSync(join(tmpdir(), "oscar-noncanonical-config-"));
  const legacyFixture = join(root, "ten-lanes.csv");
  const canonicalLines = readFileSync(resolve("fixtures/oscar-50-lane-config.csv"), "utf8")
    .trimEnd().split(/\r?\n/);
  writeFileSync(legacyFixture, `${canonicalLines.slice(0, 11).join("\n")}\n`);
  withEnvironment({
    ...baseEnvironment,
    OPERATIONAL_VIEW_WORKFLOW: "auto",
    OSCAR_LANE_CONFIG_PATH: legacyFixture,
    EXPECTED_LANE_COUNT: "10",
  }, () => {
    const config = loadConfig([]);
    assert.equal(config.operationalViewWorkflow, "auto");
    assert.equal(config.laneConfigOracle?.lanes.length, 10);
    assert.deepEqual([...config.laneConfigOracle?.lanesByView.keys() ?? []].sort(),
      ["east-gate", "entrance", "exit"]);
  });
});

test("configuration rejects missing and empty CLI flag values", () => {
  withEnvironment(baseEnvironment, () => {
    for (const args of [
      ["--profile"],
      ["--scenario"],
      ["--scenario", ""],
      ["--scenario", "   "],
      ["--scenario", ","],
      ["--profile", "--scenario", "rpm-faults"],
    ]) {
      assert.throws(() => loadConfig(args), /requires/);
    }
  });
});

test("configuration rejects duplicate CLI flags", () => {
  withEnvironment(baseEnvironment, () => {
    assert.throws(
      () => loadConfig(["--profile", "full", "--profile", "smoke"]),
      /Duplicate argument --profile/,
    );
    assert.throws(
      () => loadConfig(["--scenario", "rpm-faults", "--scenario", "adjudication"]),
      /Duplicate argument --scenario/,
    );
  });
});

test("configuration rejects unknown flags and positional arguments", () => {
  withEnvironment(baseEnvironment, () => {
    assert.throws(
      () => loadConfig(["--scenaro", "rpm-faults"]),
      /Unknown argument --scenaro/,
    );
    assert.throws(
      () => loadConfig(["rpm-faults"]),
      /Unexpected positional argument rpm-faults/,
    );
    assert.throws(
      () => loadConfig(["--scenario=rpm-faults"]),
      /Unknown argument --scenario=rpm-faults/,
    );
  });
});

test("configuration requires HTTPS for OSCAR", () => {
  withEnvironment({...baseEnvironment, OSCAR_BASE_URL: "http://192.0.2.10"}, () => {
    assert.throws(() => loadConfig([]), /OSCAR_BASE_URL must use https/);
  });
});

test("configuration rejects embedded OSCAR and emulator URL credentials", () => {
  withEnvironment({...baseEnvironment, OSCAR_BASE_URL: "https://admin:secret@192.0.2.10"}, () => {
    assert.throws(() => loadConfig([]), /OSCAR_BASE_URL must not include embedded credentials/);
  });
  withEnvironment({...baseEnvironment, RPM_EMULATOR_URL: "http://operator:secret@192.0.2.20:8000"}, () => {
    assert.throws(() => loadConfig([]), /RPM_EMULATOR_URL must not include embedded credentials/);
  });
});
