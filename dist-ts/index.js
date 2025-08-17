"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
function cleanupCommitMessage(message) {
    return message
        .split(/\r?\n/)
        .filter((line) => !/^\s*(Signed-off-by:|Closes:|Refs:)/i.test(line) && line.trim() !== "")
        .join("\n")
        .trim();
}
function parseConventionalCommits(commits, overrides) {
    const categories = {
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
    const plainLog = [];
    const issues = [];
    for (const commit of commits) {
        const message = overrides[commit.message] ?? commit.message;
        // Merge-Commits überspringen (fix: richtige Regex-Literale statt Strings)
        if (/^Merge pull request #\d+ from .+/m.test(message) ||
            /^Merge branch \S+ into \S+/m.test(message)) {
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
            const type = match[1];
            const breaking = !!match[3] || /BREAKING[\-\s]CHANGE[\:\s]/i.test(message);
            const text = match[4];
            categories[type].push(text);
            plainLog.push(message.trim());
            if (breaking) {
                major = true;
            }
            else if (type === "feat") {
                minor = true;
            }
            else if (type === "fix") {
                patch = true;
            }
        }
        else {
            if (!issues.includes(message)) {
                issues.push(message);
            }
        }
    }
    return { categories, major, minor, patch, plainLog, issues };
}
function formatMarkdownLog(categories) {
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
function semVerFromFlags(major, minor, patch) {
    if (major)
        return "MAJOR";
    if (minor)
        return "MINOR";
    if (patch)
        return "PATCH";
    return "PATCH"; // Fallback
}
async function run() {
    try {
        const token = core.getInput("token");
        const baseTag = core.getInput("baseTag");
        const headTag = core.getInput("headTag");
        const overridesRaw = core.getInput("overrides") || "{}";
        console.log(overridesRaw);
        let overrides = {};
        try {
            overrides = JSON.parse(overridesRaw);
        }
        catch (e) {
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
        const commits = data.commits.map((c) => ({
            sha: c.sha,
            message: cleanupCommitMessage(c.commit.message),
        }));
        const { categories, major, minor, patch, plainLog, issues } = parseConventionalCommits(commits, overrides);
        const log = plainLog.join("\n");
        const markdownLog = formatMarkdownLog(categories);
        const semVerChange = semVerFromFlags(major, minor, patch);
        core.setOutput("baseTag", baseTag);
        core.setOutput("headTag", headTag);
        core.setOutput("log", log);
        core.setOutput("markdownLog", markdownLog);
        core.setOutput("semVerChange", semVerChange);
        core.setOutput("issues", issues);
    }
    catch (error) {
        core.setFailed(error.message);
    }
}
// Direkt ausführen, wenn als Hauptdatei genutzt
run();
