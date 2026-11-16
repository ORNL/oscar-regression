import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {StorageProbeClient} from "../src/storage-probe.js";
import type {SuiteConfig} from "../src/types.js";

test("a lost baseline acknowledgement still invokes privileged marker cleanup", {
  skip: process.platform === "win32",
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "oscar-probe-cleanup-"));
  const log = join(directory, "ssh.log");
  const oldPath = process.env.PATH;
  const oldLog = process.env.OSCAR_TEST_SSH_LOG;
  try {
    const scp = join(directory, "scp");
    const ssh = join(directory, "ssh");
    writeFileSync(scp, "#!/bin/sh\nexit 0\n", {mode: 0o700});
    writeFileSync(ssh, `#!/bin/sh
printf '%s\\n' "$*" >> "$OSCAR_TEST_SSH_LOG"
case "$*" in
  *oscar-storage-binding*) printf '/opt/oscar-test\\n' ;;
  *mktemp\\ -d*) printf '/tmp/oscar-storage-regression.ABC12345\\n' ;;
  *alarm-media-baseline*) exit 255 ;;
  *alarm-media-cleanup*) printf '{"removed":true}\\n' ;;
  *) exit 0 ;;
esac
`, {mode: 0o700});
    chmodSync(scp, 0o700);
    chmodSync(ssh, 0o700);
    process.env.PATH = `${directory}:${oldPath ?? ""}`;
    process.env.OSCAR_TEST_SSH_LOG = log;

    const client = new StorageProbeClient({
      targetHost: "viewer.test.invalid",
      oscarSshTarget: "tester@test.invalid",
      oscarReleaseDirectory: "/opt/oscar-test",
      storageTargetAcknowledgement:
        "viewer.test.invalid|tester@test.invalid|/opt/oscar-test|DISPOSABLE-STORAGE",
      storageProbeTimeoutMs: 10_000,
    } as SuiteConfig, "run_cleanup_test");
    await assert.rejects(
      client.runJson("alarm-media-baseline", ["run_cleanup_test"]),
      /alarm-media-baseline/,
    );
    await client.cleanup();

    const commands = readFileSync(log, "utf8").trim().split(/\r?\n/);
    assert.equal(commands.length, 6);
    assert.match(commands[0]!, /oscar-storage-binding.*\/opt\/oscar-test/);
    assert.match(commands[0]!, /com\.docker\.compose\.project\.working_dir/);
    assert.match(commands[0]!, /com\.docker\.compose\.project\.config_files/);
    assert.match(commands[1]!, /mktemp -d \/tmp\/oscar-storage-regression/);
    assert.match(commands[2]!, /alarm-media-baseline.*run_cleanup_test/);
    assert.match(commands[3]!, /oscar-storage-binding.*\/opt\/oscar-test/);
    assert.match(commands[4]!, /sudo.*alarm-media-cleanup.*run_cleanup_test/);
    assert.match(commands[5]!, /rm -rf --.*oscar-storage-regression\.ABC12345/);
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    if (oldLog === undefined) delete process.env.OSCAR_TEST_SSH_LOG;
    else process.env.OSCAR_TEST_SSH_LOG = oldLog;
    rmSync(directory, {recursive: true, force: true});
  }
});

test("a failed privileged marker cleanup remains retryable before helper removal", {
  skip: process.platform === "win32",
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "oscar-probe-cleanup-retry-"));
  const log = join(directory, "ssh.log");
  const allowCleanup = join(directory, "allow-cleanup");
  const oldPath = process.env.PATH;
  const oldLog = process.env.OSCAR_TEST_SSH_LOG;
  const oldAllowCleanup = process.env.OSCAR_TEST_ALLOW_CLEANUP;
  try {
    writeFileSync(join(directory, "scp"), "#!/bin/sh\nexit 0\n", {mode: 0o700});
    writeFileSync(join(directory, "ssh"), `#!/bin/sh
printf '%s\\n' "$*" >> "$OSCAR_TEST_SSH_LOG"
case "$*" in
  *oscar-storage-binding*) printf '/opt/oscar-test\\n' ;;
  *mktemp\\ -d*) printf '/tmp/oscar-storage-regression.DEF67890\\n' ;;
  *alarm-media-baseline*) exit 255 ;;
  *alarm-media-cleanup*)
    test -f "$OSCAR_TEST_ALLOW_CLEANUP" || exit 1
    printf '{"removed":true}\\n'
    ;;
  *) exit 0 ;;
esac
`, {mode: 0o700});
    process.env.PATH = `${directory}:${oldPath ?? ""}`;
    process.env.OSCAR_TEST_SSH_LOG = log;
    process.env.OSCAR_TEST_ALLOW_CLEANUP = allowCleanup;

    const client = new StorageProbeClient({
      targetHost: "viewer.test.invalid",
      oscarSshTarget: "tester@test.invalid",
      oscarReleaseDirectory: "/opt/oscar-test",
      storageTargetAcknowledgement:
        "viewer.test.invalid|tester@test.invalid|/opt/oscar-test|DISPOSABLE-STORAGE",
      storageProbeTimeoutMs: 10_000,
    } as SuiteConfig, "run_cleanup_retry_test");
    await assert.rejects(client.runJson("alarm-media-baseline", ["run_cleanup_retry_test"]));
    await assert.rejects(client.cleanup(), /privileged alarm-media baseline marker/);
    let commands = readFileSync(log, "utf8").trim().split(/\r?\n/);
    assert.equal(commands.length, 5);
    assert.doesNotMatch(commands.join("\n"), /rm -rf --/);

    writeFileSync(allowCleanup, "ready\n");
    await client.cleanup();
    commands = readFileSync(log, "utf8").trim().split(/\r?\n/);
    assert.equal(commands.length, 8);
    assert.match(commands[6]!, /sudo.*alarm-media-cleanup.*run_cleanup_retry_test/);
    assert.match(commands[7]!, /rm -rf --.*oscar-storage-regression\.DEF67890/);
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    if (oldLog === undefined) delete process.env.OSCAR_TEST_SSH_LOG;
    else process.env.OSCAR_TEST_SSH_LOG = oldLog;
    if (oldAllowCleanup === undefined) delete process.env.OSCAR_TEST_ALLOW_CLEANUP;
    else process.env.OSCAR_TEST_ALLOW_CLEANUP = oldAllowCleanup;
    rmSync(directory, {recursive: true, force: true});
  }
});

test("storage probe binds Viewer host, SSH target, and release before any remote write", () => {
  assert.throws(() => new StorageProbeClient({
    targetHost: "viewer.test.invalid",
    oscarSshTarget: "tester@test.invalid",
    oscarReleaseDirectory: "/opt/oscar-test",
    storageTargetAcknowledgement:
      "other.test.invalid|tester@test.invalid|/opt/oscar-test|DISPOSABLE-STORAGE",
    storageProbeTimeoutMs: 10_000,
  } as SuiteConfig, "binding_test"), /OSCAR_STORAGE_TARGET_ACK/);
});

test("storage probe refuses a remotely symlinked or noncanonical release before scp", {
  skip: process.platform === "win32",
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "oscar-probe-binding-refusal-"));
  const sshLog = join(directory, "ssh.log");
  const scpLog = join(directory, "scp.log");
  const oldPath = process.env.PATH;
  const oldSshLog = process.env.OSCAR_TEST_SSH_LOG;
  const oldScpLog = process.env.OSCAR_TEST_SCP_LOG;
  try {
    writeFileSync(join(directory, "ssh"), `#!/bin/sh
printf '%s\\n' "$*" >> "$OSCAR_TEST_SSH_LOG"
# Simulate realpath resolving a release symlink to a different canonical path.
printf '/srv/releases/oscar-real\\n'
`, {mode: 0o700});
    writeFileSync(join(directory, "scp"), `#!/bin/sh
printf '%s\\n' "$*" >> "$OSCAR_TEST_SCP_LOG"
exit 0
`, {mode: 0o700});
    process.env.PATH = `${directory}:${oldPath ?? ""}`;
    process.env.OSCAR_TEST_SSH_LOG = sshLog;
    process.env.OSCAR_TEST_SCP_LOG = scpLog;
    const client = new StorageProbeClient({
      targetHost: "viewer.test.invalid",
      oscarSshTarget: "tester@test.invalid",
      oscarReleaseDirectory: "/opt/oscar-test",
      storageTargetAcknowledgement:
        "viewer.test.invalid|tester@test.invalid|/opt/oscar-test|DISPOSABLE-STORAGE",
      storageProbeTimeoutMs: 10_000,
    } as SuiteConfig, "binding_refusal_test");
    await assert.rejects(client.runJson("platform"), /not the uniquely running Compose release/);
    assert.match(readFileSync(sshLog, "utf8"), /oscar-storage-binding/);
    assert.throws(() => readFileSync(scpLog, "utf8"), /ENOENT/);
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    if (oldSshLog === undefined) delete process.env.OSCAR_TEST_SSH_LOG;
    else process.env.OSCAR_TEST_SSH_LOG = oldSshLog;
    if (oldScpLog === undefined) delete process.env.OSCAR_TEST_SCP_LOG;
    else process.env.OSCAR_TEST_SCP_LOG = oldScpLog;
    rmSync(directory, {recursive: true, force: true});
  }
});

test("restore probes use their separate long-running timeout", {
  skip: process.platform === "win32",
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "oscar-probe-restore-timeout-"));
  const oldPath = process.env.PATH;
  try {
    writeFileSync(join(directory, "scp"), "#!/bin/sh\nexit 0\n", {mode: 0o700});
    writeFileSync(join(directory, "ssh"), `#!/bin/sh
case "$*" in
  *oscar-storage-binding*) printf '/opt/oscar-test\\n' ;;
  *mktemp\\ -d*) printf '/tmp/oscar-storage-regression.LONG1234\\n' ;;
  *oscar-storage-restore-wrapper*) sleep 0.1; printf '{"restored":true}\\n' ;;
  *) exit 0 ;;
esac
`, {mode: 0o700});
    process.env.PATH = `${directory}:${oldPath ?? ""}`;
    const client = new StorageProbeClient({
      targetHost: "viewer.test.invalid",
      oscarSshTarget: "tester@test.invalid",
      oscarReleaseDirectory: "/opt/oscar-test",
      storageTargetAcknowledgement:
        "viewer.test.invalid|tester@test.invalid|/opt/oscar-test|DISPOSABLE-STORAGE",
      storageProbeTimeoutMs: 20,
      storageRestoreProbeTimeoutMs: 1_000,
    } as SuiteConfig, "restore_timeout_test");
    assert.deepEqual(await client.runJson("restore-drill", ["restore_timeout_test"]), {
      restored: true,
    });
    assert.deepEqual(await client.runJson("backup-check", ["backup_timeout_test"]), {
      restored: true,
    });
    await client.cleanup();
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    rmSync(directory, {recursive: true, force: true});
  }
});

test("a timed-out restore waits for authoritative remote termination before rejecting", {
  skip: process.platform === "win32",
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "oscar-probe-restore-terminal-"));
  const done = join(directory, "restore-done");
  const log = join(directory, "ssh.log");
  const restoreCommand = join(directory, "restore-command.sh");
  const oldPath = process.env.PATH;
  const oldDone = process.env.OSCAR_TEST_RESTORE_DONE;
  const oldLog = process.env.OSCAR_TEST_SSH_LOG;
  const oldRestoreCommand = process.env.OSCAR_TEST_RESTORE_COMMAND;
  try {
    writeFileSync(join(directory, "scp"), "#!/bin/sh\nexit 0\n", {mode: 0o700});
    writeFileSync(join(directory, "ssh"), `#!/bin/sh
printf '%s\\n' "$*" >> "$OSCAR_TEST_SSH_LOG"
last=''
for argument do last=$argument; done
case "$*" in
  *oscar-storage-binding*) printf '/opt/oscar-test\\n' ;;
  *mktemp\\ -d*) printf '/tmp/oscar-storage-regression.WAIT1234\\n' ;;
  *oscar-storage-restore-wrapper*)
    printf '%s\\n' "$last" > "$OSCAR_TEST_RESTORE_COMMAND"
    (sleep 0.2; printf 'done\\n' > "$OSCAR_TEST_RESTORE_DONE") >/dev/null 2>&1 &
    exec sleep 5
    ;;
  *oscar-storage-restore-state*)
    if test -f "$OSCAR_TEST_RESTORE_DONE"; then printf 'complete:0\\n';
    else printf 'running\\n'; fi
    ;;
  *) exit 0 ;;
esac
`, {mode: 0o700});
    process.env.PATH = `${directory}:${oldPath ?? ""}`;
    process.env.OSCAR_TEST_RESTORE_DONE = done;
    process.env.OSCAR_TEST_SSH_LOG = log;
    process.env.OSCAR_TEST_RESTORE_COMMAND = restoreCommand;
    const client = new StorageProbeClient({
      targetHost: "viewer.test.invalid",
      oscarSshTarget: "tester@test.invalid",
      oscarReleaseDirectory: "/opt/oscar-test",
      storageTargetAcknowledgement:
        "viewer.test.invalid|tester@test.invalid|/opt/oscar-test|DISPOSABLE-STORAGE",
      storageProbeTimeoutMs: 10_000,
      storageRestoreProbeTimeoutMs: 50,
    } as SuiteConfig, "restore_terminal_test");
    const started = Date.now();
    await assert.rejects(
      client.runJson("restore-drill", ["restore_terminal_test"]),
      /remote command reached a terminal state before post-restore checks resumed/,
    );
    assert.ok(Date.now() - started >= 1_500, "restore rejection did not wait for a terminal poll");
    const commands = readFileSync(log, "utf8");
    assert.match(commands, /oscar-storage-restore-wrapper/);
    assert.match(commands, /setsid/);
    assert.match(commands, /restore-drill\.ready/);
    assert.match(commands, /restore-drill\.cancelled/);
    assert.match(commands, /mv -T -- \"\$ready_path\" \"\$active_path\"/);
    assert.match(commands, /status_path\.tmp/);
    assert.match(commands, /\/proc\/\$self\/stat/);
    assert.match(commands, /oscar-storage-restore-state/);
    assert.match(commands, /ps -eo pid=,pgid=,sid=/);
    assert.match(commands, /\$2 == pgid \|\| \$3 == sid/);
    const syntax = spawnSync("bash", ["-n", "-c", readFileSync(restoreCommand, "utf8")], {
      encoding: "utf8",
    });
    assert.equal(syntax.status, 0, syntax.stderr);
    await client.cleanup();
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    if (oldDone === undefined) delete process.env.OSCAR_TEST_RESTORE_DONE;
    else process.env.OSCAR_TEST_RESTORE_DONE = oldDone;
    if (oldLog === undefined) delete process.env.OSCAR_TEST_SSH_LOG;
    else process.env.OSCAR_TEST_SSH_LOG = oldLog;
    if (oldRestoreCommand === undefined) delete process.env.OSCAR_TEST_RESTORE_COMMAND;
    else process.env.OSCAR_TEST_RESTORE_COMMAND = oldRestoreCommand;
    rmSync(directory, {recursive: true, force: true});
  }
});

test("an SSH-255 launch race is cancelled before a delayed restore can claim its gate", {
  skip: process.platform === "win32",
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "oscar-probe-restore-cancel-"));
  const ready = join(directory, "ready");
  const active = join(directory, "active");
  const cancelled = join(directory, "cancelled");
  const launched = join(directory, "launched");
  const oldPath = process.env.PATH;
  const oldReady = process.env.OSCAR_TEST_GATE_READY;
  const oldActive = process.env.OSCAR_TEST_GATE_ACTIVE;
  const oldCancelled = process.env.OSCAR_TEST_GATE_CANCELLED;
  const oldLaunched = process.env.OSCAR_TEST_GATE_LAUNCHED;
  try {
    writeFileSync(join(directory, "scp"), "#!/bin/sh\nexit 0\n", {mode: 0o700});
    writeFileSync(join(directory, "ssh"), `#!/bin/sh
case "$*" in
  *oscar-storage-binding*) printf '/opt/oscar-test\\n' ;;
  *mktemp\\ -d*) printf '/tmp/oscar-storage-regression.RACE1234\\n' ;;
  *oscar-storage-restore-arm*) printf 'armed\\n' > "$OSCAR_TEST_GATE_READY" ;;
  *oscar-storage-restore-wrapper*)
    (sleep 0.2
     if mv "$OSCAR_TEST_GATE_READY" "$OSCAR_TEST_GATE_ACTIVE" 2>/dev/null; then
       printf 'launched\\n' > "$OSCAR_TEST_GATE_LAUNCHED"
     fi) >/dev/null 2>&1 &
    exit 255
    ;;
  *oscar-storage-restore-state*)
    if mv "$OSCAR_TEST_GATE_READY" "$OSCAR_TEST_GATE_CANCELLED" 2>/dev/null; then
      printf 'cancelled\\n'
    elif test -f "$OSCAR_TEST_GATE_ACTIVE"; then
      printf 'running\\n'
    elif test -f "$OSCAR_TEST_GATE_CANCELLED"; then
      printf 'cancelled\\n'
    else
      exit 74
    fi
    ;;
  *) exit 0 ;;
esac
`, {mode: 0o700});
    process.env.PATH = `${directory}:${oldPath ?? ""}`;
    process.env.OSCAR_TEST_GATE_READY = ready;
    process.env.OSCAR_TEST_GATE_ACTIVE = active;
    process.env.OSCAR_TEST_GATE_CANCELLED = cancelled;
    process.env.OSCAR_TEST_GATE_LAUNCHED = launched;
    const client = new StorageProbeClient({
      targetHost: "viewer.test.invalid",
      oscarSshTarget: "tester@test.invalid",
      oscarReleaseDirectory: "/opt/oscar-test",
      storageTargetAcknowledgement:
        "viewer.test.invalid|tester@test.invalid|/opt/oscar-test|DISPOSABLE-STORAGE",
      storageProbeTimeoutMs: 10_000,
      storageRestoreProbeTimeoutMs: 1_000,
    } as SuiteConfig, "restore_launch_race_test");
    await assert.rejects(client.runJson("restore-drill", ["restore_launch_race_test"]));
    await new Promise(resolveDelay => setTimeout(resolveDelay, 400));
    assert.equal(existsSync(cancelled), true, "termination poll did not cancel the armed launch");
    assert.equal(existsSync(active), false, "late wrapper claimed a cancelled launch gate");
    assert.equal(existsSync(launched), false, "restore launched after SSH-255 cancellation");
    await client.cleanup();
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    for (const [name, value] of [
      ["OSCAR_TEST_GATE_READY", oldReady],
      ["OSCAR_TEST_GATE_ACTIVE", oldActive],
      ["OSCAR_TEST_GATE_CANCELLED", oldCancelled],
      ["OSCAR_TEST_GATE_LAUNCHED", oldLaunched],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, {recursive: true, force: true});
  }
});

test("invalid restore control state remains nonterminal until authoritative repair", {
  skip: process.platform === "win32",
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "oscar-probe-restore-state-"));
  const counter = join(directory, "poll-count");
  const oldPath = process.env.PATH;
  const oldCounter = process.env.OSCAR_TEST_STATE_COUNTER;
  try {
    writeFileSync(join(directory, "scp"), "#!/bin/sh\nexit 0\n", {mode: 0o700});
    writeFileSync(join(directory, "ssh"), `#!/bin/sh
case "$*" in
  *oscar-storage-binding*) printf '/opt/oscar-test\\n' ;;
  *mktemp\\ -d*) printf '/tmp/oscar-storage-regression.STATE123\\n' ;;
  *oscar-storage-restore-arm*) exit 0 ;;
  *oscar-storage-restore-wrapper*) exit 255 ;;
  *oscar-storage-restore-state*)
    count=0
    test ! -f "$OSCAR_TEST_STATE_COUNTER" || count=$(cat "$OSCAR_TEST_STATE_COUNTER")
    count=$((count + 1))
    printf '%s\\n' "$count" > "$OSCAR_TEST_STATE_COUNTER"
    if test "$count" -eq 1; then exit 74; fi
    if test "$count" -eq 2; then printf 'malformed-control-state\\n'; exit 0; fi
    printf 'complete:0\\n'
    ;;
  *) exit 0 ;;
esac
`, {mode: 0o700});
    process.env.PATH = `${directory}:${oldPath ?? ""}`;
    process.env.OSCAR_TEST_STATE_COUNTER = counter;
    const client = new StorageProbeClient({
      targetHost: "viewer.test.invalid",
      oscarSshTarget: "tester@test.invalid",
      oscarReleaseDirectory: "/opt/oscar-test",
      storageTargetAcknowledgement:
        "viewer.test.invalid|tester@test.invalid|/opt/oscar-test|DISPOSABLE-STORAGE",
      storageProbeTimeoutMs: 10_000,
      storageRestoreProbeTimeoutMs: 1_000,
    } as SuiteConfig, "restore_invalid_state_test");
    const started = Date.now();
    await assert.rejects(client.runJson("restore-drill", ["restore_invalid_state_test"]));
    assert.ok(Date.now() - started >= 3_500, "invalid state did not retain the disruption wait");
    assert.equal(readFileSync(counter, "utf8").trim(), "3");
    await client.cleanup();
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    if (oldCounter === undefined) delete process.env.OSCAR_TEST_STATE_COUNTER;
    else process.env.OSCAR_TEST_STATE_COUNTER = oldCounter;
    rmSync(directory, {recursive: true, force: true});
  }
});

test("the Linux restore wrapper publishes terminal state only after its session is quiescent", async () => {
  if (process.platform !== "linux") {
    const source = readFileSync(new URL("../src/storage-probe.ts", import.meta.url), "utf8");
    assert.match(source, /setsid --fork --wait/);
    assert.match(source, /\$2 == pgid \|\| \$3 == sid/);
    assert.match(source, /wait_for_session_quiet/);
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "oscar-probe-real-wrapper-"));
  const workspace = mkdtempSync("/tmp/oscar-storage-regression.");
  const marker = join(directory, "probe-launched");
  const fakeProbe = join(directory, "probe.sh");
  const oldPath = process.env.PATH;
  const oldWorkspace = process.env.OSCAR_TEST_REMOTE_WORKSPACE;
  const oldProbe = process.env.OSCAR_TEST_FAKE_PROBE;
  const oldMarker = process.env.OSCAR_TEST_PROBE_MARKER;
  const oldSetsidFail = process.env.OSCAR_TEST_SETSID_FAIL;
  try {
    writeFileSync(fakeProbe, `#!/bin/bash
set -eu
printf 'launched\\n' > "$OSCAR_TEST_PROBE_MARKER"
(sleep 0.4) &
printf '{"restored":true}\\n'
`, {mode: 0o700});
    writeFileSync(join(directory, "sudo"), `#!/bin/sh
test "\${1:-}" != -n || shift
exec "$@"
`, {mode: 0o700});
    writeFileSync(join(directory, "stat"), `#!/bin/sh
if test "\${1:-}" = -c && test "\${2:-}" = %u:%g:%a; then
  shift 2
  test "\${1:-}" != -- || shift
  mode=$(/usr/bin/stat -c %a -- "$1") || exit
  printf '0:0:%s\\n' "$mode"
else
  exec /usr/bin/stat "$@"
fi
`, {mode: 0o700});
    writeFileSync(join(directory, "setsid"), `#!/bin/sh
if test "\${OSCAR_TEST_SETSID_FAIL:-}" = 1; then
  while test "$#" -gt 0; do
    case "$1" in --fork|--wait) shift ;; *) break ;; esac
  done
  exec "$@"
fi
exec /usr/bin/setsid "$@"
`, {mode: 0o700});
    writeFileSync(join(directory, "scp"), `#!/bin/sh
mkdir -p "$OSCAR_TEST_REMOTE_WORKSPACE"
cp "$OSCAR_TEST_FAKE_PROBE" "$OSCAR_TEST_REMOTE_WORKSPACE/probe.sh"
chmod 0700 "$OSCAR_TEST_REMOTE_WORKSPACE/probe.sh"
`, {mode: 0o700});
    writeFileSync(join(directory, "ssh"), `#!/bin/sh
last=''
for argument do last=$argument; done
case "$*" in
  *oscar-storage-binding*) printf '/tmp/oscar-storage-release.test\\n' ;;
  *mktemp\\ -d*) printf '%s\\n' "$OSCAR_TEST_REMOTE_WORKSPACE" ;;
  *) exec /bin/sh -c "$last" ;;
esac
`, {mode: 0o700});
    process.env.PATH = `${directory}:${oldPath ?? ""}`;
    process.env.OSCAR_TEST_REMOTE_WORKSPACE = workspace;
    process.env.OSCAR_TEST_FAKE_PROBE = fakeProbe;
    process.env.OSCAR_TEST_PROBE_MARKER = marker;

    const config = {
      targetHost: "viewer.test.invalid",
      oscarSshTarget: "tester@test.invalid",
      oscarReleaseDirectory: "/tmp/oscar-storage-release.test",
      storageTargetAcknowledgement:
        "viewer.test.invalid|tester@test.invalid|/tmp/oscar-storage-release.test|DISPOSABLE-STORAGE",
      storageProbeTimeoutMs: 10_000,
      storageRestoreProbeTimeoutMs: 5_000,
    } as SuiteConfig;
    const client = new StorageProbeClient(config, "real_wrapper_descendant_test");
    const started = Date.now();
    assert.deepEqual(await client.runJson("restore-drill", ["real_wrapper_descendant_test"]), {
      restored: true,
    });
    assert.ok(Date.now() - started >= 300, "wrapper published before a same-session child exited");
    assert.equal(readFileSync(marker, "utf8").trim(), "launched");
    await client.cleanup();

    rmSync(marker, {force: true});
    mkdirSync(workspace, {recursive: true});
    process.env.OSCAR_TEST_SETSID_FAIL = "1";
    const failed = new StorageProbeClient(config, "real_wrapper_setup_failure_test");
    await assert.rejects(failed.runJson("restore-drill", ["real_wrapper_setup_failure_test"]));
    assert.equal(existsSync(marker), false, "probe launched after session-identity setup failed");
    await failed.cleanup();
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    for (const [name, value] of [
      ["OSCAR_TEST_REMOTE_WORKSPACE", oldWorkspace],
      ["OSCAR_TEST_FAKE_PROBE", oldProbe],
      ["OSCAR_TEST_PROBE_MARKER", oldMarker],
      ["OSCAR_TEST_SETSID_FAIL", oldSetsidFail],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(workspace, {recursive: true, force: true});
    rmSync(directory, {recursive: true, force: true});
  }
});
