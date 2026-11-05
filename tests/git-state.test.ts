import assert from "node:assert/strict";
import test from "node:test";
import {suiteGitCommit, type GitCommandRunner} from "../src/git-state.js";
import type {Profile} from "../src/types.js";

const COMMIT = "a".repeat(40);

function runner(status = "", commit = COMMIT): GitCommandRunner {
  return (args) => {
    if (args[0] === "rev-parse") return `${commit}\n`;
    if (args[0] === "status") return status;
    throw new Error(`unexpected git command: ${args.join(" ")}`);
  };
}

test("strict certification profiles require a clean canonical suite commit", () => {
  for (const profile of ["3.9.2-release", "3.11.0-release", "restore-drill"] as const) {
    assert.equal(suiteGitCommit(profile, runner()), COMMIT);
    assert.throws(
      () => suiteGitCommit(profile, runner(" M src/scenarios.ts\n?? local-helper.mjs\n")),
      new RegExp(`${profile.replaceAll(".", "\\.")} requires a clean suite working tree`),
    );
    assert.throws(
      () => suiteGitCommit(profile, runner("", "abc123")),
      /requires a canonical 40-hex suite HEAD/,
    );
  }
});

test("non-certification profiles record dirty or unavailable identity without claiming an exact commit", () => {
  for (const profile of ["smoke", "full"] as const) {
    assert.equal(suiteGitCommit(profile, runner("?? investigation.txt\n")), `${COMMIT}-dirty`);
    assert.equal(suiteGitCommit(profile, runner("", "not-a-commit")), "uncommitted-or-unavailable");
    assert.equal(suiteGitCommit(profile, () => { throw new Error("git unavailable"); }),
      "uncommitted-or-unavailable");
  }
});

test("strict certification refuses an unavailable Git checkout", () => {
  for (const profile of ["3.9.2-release", "3.11.0-release", "restore-drill"] as Profile[]) {
    assert.throws(
      () => suiteGitCommit(profile, () => { throw new Error("git unavailable"); }),
      /requires an available clean Git suite checkout with a canonical HEAD/,
    );
  }
});
