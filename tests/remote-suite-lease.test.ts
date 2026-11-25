import assert from "node:assert/strict";
import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {remoteLeaseShell, windowsLeasePowerShell} from "../src/remote-suite-lease.js";

function startLease(
  script: string,
  token: string,
  releaseDirectory = "/srv/oscar/release",
): ChildProcessWithoutNullStreams {
  return spawn("bash", ["-ceu", script, "lease-test", releaseDirectory, token], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

async function waitForText(child: ChildProcessWithoutNullStreams, text: string): Promise<void> {
  child.stdout.setEncoding("utf8");
  let output = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${text}`)), 5_000);
    child.stdout.on("data", chunk => {
      output += String(chunk);
      if (output.includes(text)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`lease exited early with ${String(code)}`)));
  });
}

async function exitCode(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
}

test("remote lease shell rejects contention and releases for the next runner", async () => {
  if (process.platform === "win32") return;
  try { execFileSync("flock", ["--version"], {stdio: "ignore"}); } catch { return; }
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "oscar-regression-lease-")));
  const lockRoot = join(root, "locks");
  const release = join(root, "release");
  const otherRelease = join(root, "other-release");
  mkdirSync(release);
  mkdirSync(otherRelease);
  const script = remoteLeaseShell(lockRoot, process.getuid?.() ?? 0);
  const firstToken = "1".repeat(64);
  const secondToken = "2".repeat(64);
  const thirdToken = "3".repeat(64);
  const first = startLease(script, firstToken, release);
  try {
    await waitForText(first, `OSCAR_REGRESSION_LEASE_ACQUIRED:${firstToken}`);

    const second = startLease(script, secondToken, otherRelease);
    let secondOutput = "";
    second.stdout.setEncoding("utf8");
    second.stdout.on("data", chunk => { secondOutput += String(chunk); });
    assert.equal(await exitCode(second), 75);
    assert.match(secondOutput, /OSCAR_REGRESSION_LEASE_CONTENDED/);

    const firstExited = exitCode(first);
    first.stdin.end(`release:${firstToken}\n`);
    assert.equal(await firstExited, 0);

    const third = startLease(script, thirdToken, release);
    await waitForText(third, `OSCAR_REGRESSION_LEASE_ACQUIRED:${thirdToken}`);
    const thirdExited = exitCode(third);
    third.stdin.end(`release:${thirdToken}\n`);
    assert.equal(await thirdExited, 0);
  } finally {
    first.kill("SIGKILL");
    rmSync(root, {recursive: true, force: true});
  }
});

test("remote lease shell releases automatically when its runner input closes", async () => {
  if (process.platform === "win32") return;
  try { execFileSync("flock", ["--version"], {stdio: "ignore"}); } catch { return; }
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "oscar-regression-lease-eof-")));
  const release = join(root, "release");
  mkdirSync(release);
  const script = remoteLeaseShell(join(root, "locks"), process.getuid?.() ?? 0);
  const token = "4".repeat(64);
  const lease = startLease(script, token, release);
  try {
    await waitForText(lease, `OSCAR_REGRESSION_LEASE_ACQUIRED:${token}`);
    const exited = exitCode(lease);
    lease.stdin.end();
    assert.equal(await exited, 0);
  } finally {
    lease.kill("SIGKILL");
    rmSync(root, {recursive: true, force: true});
  }
});

test("remote lease refuses a symlinked release directory before creating the lock", () => {
  if (process.platform === "win32") return;
  try { execFileSync("flock", ["--version"], {stdio: "ignore"}); } catch { return; }
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "oscar-regression-lease-link-")));
  try {
    const release = join(root, "release");
    const linked = join(root, "linked-release");
    mkdirSync(release);
    symlinkSync(release, linked);
    assert.throws(() => execFileSync("bash", [
      "-ceu", remoteLeaseShell(join(root, "locks"), process.getuid?.() ?? 0),
      "lease-test", linked, "5".repeat(64),
    ], {stdio: "ignore"}));
    assert.throws(() => execFileSync("test", ["-e", join(root, "locks")], {stdio: "ignore"}));
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test("windows lease PowerShell polls release signal and parent SSH liveness without stdin blocking", () => {
  const token = "a".repeat(64);
  const script = windowsLeasePowerShell("C:\\oscar\\3.12.0-rc1\\oscar-3.11.15", token);
  assert.match(script, /FileShare\]::None/);
  assert.match(script, /release-.*\+.*\.signal/);
  assert.match(script, /ParentProcessId/);
  assert.doesNotMatch(script, /ReadLine\(\)/);
});
