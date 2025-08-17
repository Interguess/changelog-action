/*
 * MIT License
 *
 * Copyright (c) 2025 Interguess.com
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the 'Software'), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import * as core from "@actions/core";
import * as github from "@actions/github";

type Commit = {
  sha: string;
  message: string;
};

type ChangeType =
  | "feat"
  | "fix"
  | "chore"
  | "docs"
  | "style"
  | "refactor"
  | "test"
  | "perf"
  | "ci"
  | "build"
  | "revert";

function cleanupCommitMessage(message: string): string {
  return message
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/^\s*(Signed-off-by:|Closes:|Refs:)/i.test(line) && line.trim() !== "",
    )
    .join("\n")
    .trim();
}

function parseConventionalCommits(
  commits: Commit[],
  overrides: Record<string, string>,
) {
  const categories: Record<ChangeType, string[]> = {
    feat: [],
    fix: [],
    chore: [],
    docs: [],
    style: [],
    refactor: [],
    test: [],
    perf: [],
    ci: [],
    build: [],
    revert: [],
  };

  let major = false;
  let minor = false;
  let patch = false;

  const plainLog: string[] = [];
  const issues: string[] = [];
  for (const commit of commits) {
    const message = overrides[commit.message] ?? commit.message;

    // Merge-Commits überspringen (fix: richtige Regex-Literale statt Strings)
    if (
      /^Merge pull request #\d+ from .+/m.test(message) ||
      /^Merge branch \S+ into \S+/m.test(message)
    ) {
      continue;
    }

    /**
     * Regex Erklärung:
     * ^(\w+)           → typ (feat, fix, ...)
     * (\([\w\-]+\))?   → optionaler scope (z. B. (ui))
     * (!)?:            → optionales Ausrufezeichen für Breaking Change + Doppelpunkt
     * (.+)$            → Commit-Beschreibung
     */
    const match = message.match(/^(\w+)(\([\w\-]+\))?(!)?: (.+)$/m);

    if (match && categories.hasOwnProperty(match[1])) {
      const type = match[1] as ChangeType;
      const breaking =
        !!match[3] || /BREAKING[\-\s]CHANGE[\:\s]/i.test(message);
      const text = match[4];

      categories[type].push(text);
      plainLog.push(message.trim());

      if (breaking) {
        major = true;
      } else if (type === "feat") {
        minor = true;
      } else if (type === "fix") {
        patch = true;
      }
    } else {
      if (!issues.includes(message)) {
        issues.push(message);
      }
    }
  }

  return { categories, major, minor, patch, plainLog, issues };
}

function formatMarkdownLog(categories: Record<ChangeType, string[]>) {
  let out = "";
  for (const [type, entries] of Object.entries(categories)) {
    if (entries.length > 0) {
      out += `### ${type}\n`;
      for (const entry of entries) {
        out += `- ${entry}\n`;
      }
      out += "\n";
    }
  }
  return out.trim();
}

function semVerFromFlags(
  major: boolean,
  minor: boolean,
  patch: boolean,
): "MAJOR" | "MINOR" | "PATCH" {
  if (major) return "MAJOR";
  if (minor) return "MINOR";
  if (patch) return "PATCH";
  return "PATCH"; // Fallback
}

export async function run(): Promise<void> {
  try {
    const token = core.getInput("token");
    const baseTag = core.getInput("baseTag");
    const headTag = core.getInput("headTag");
    const overridesRaw = core.getInput("overrides") || "{}";
    console.log(overridesRaw);

    let overrides: Record<string, string> = {};
    try {
      overrides = JSON.parse(overridesRaw);
    } catch (e) {
      core.setFailed("Invalid overrides JSON: " + e);
      return;
    }

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    // Vergleiche die beiden Tags (holt alle Commits zwischen baseTag..headTag)
    const { data } = await octokit.rest.repos.compareCommits({
      owner,
      repo,
      base: baseTag,
      head: headTag,
    });

    const commits: Commit[] = data.commits.map(
      (c: { sha: any; commit: { message: string } }) => ({
        sha: c.sha,
        message: cleanupCommitMessage(c.commit.message),
      }),
    );

    const { categories, major, minor, patch, plainLog, issues } =
      parseConventionalCommits(commits, overrides);

    const log = plainLog.join("\n");
    const markdownLog = formatMarkdownLog(categories);
    const semVerChange = semVerFromFlags(major, minor, patch);

    core.setOutput("baseTag", baseTag);
    core.setOutput("headTag", headTag);
    core.setOutput("log", log);
    core.setOutput("markdownLog", markdownLog);
    core.setOutput("semVerChange", semVerChange);
    core.setOutput("issues", issues);
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}

// Direkt ausführen, wenn als Hauptdatei genutzt
run();
