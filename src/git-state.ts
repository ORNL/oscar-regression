import {execFileSync} from "node:child_process";
import type {Profile} from "./types.js";

export type GitCommandRunner = (args: string[]) => string;

const STRICT_IDENTITY_PROFILES = new Set<Profile>(["3.9.2-release", "3.11.0-release", "restore-drill"]);

function defaultGitRunner(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

export function suiteGitCommit(
  profile: Profile,
  runGit: GitCommandRunner = defaultGitRunner,
): string {
  const strict = STRICT_IDENTITY_PROFILES.has(profile);
  try {
    const commit = runGit(["rev-parse", "--verify", "HEAD"]).trim();
    const status = runGit(["status", "--porcelain=v1", "--untracked-files=all"]).trim();
    if (!/^[0-9a-f]{40}$/u.test(commit)) {
      if (strict) throw new Error(`${profile} requires a canonical 40-hex suite HEAD`);
      return "uncommitted-or-unavailable";
    }
    if (status) {
      const entries = status.split(/\r?\n/u).filter(Boolean).length;
      if (strict) {
        throw new Error(
          `${profile} requires a clean suite working tree; found ${entries} tracked or untracked change(s)`,
        );
      }
      return `${commit}-dirty`;
    }
    return commit;
  } catch (error) {
    if (strict) {
      if (error instanceof Error && error.message.startsWith(`${profile} requires`)) throw error;
      throw new Error(`${profile} requires an available clean Git suite checkout with a canonical HEAD`);
    }
    return "uncommitted-or-unavailable";
  }
}
