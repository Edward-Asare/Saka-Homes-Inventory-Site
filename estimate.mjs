#!/usr/bin/env node
// pre.dev code licensing: local value estimate.
//
// Runs the SAME counter our pipeline runs when it prices a repo. The five
// functions below are extracted verbatim from the production backend at the
// moment you downloaded this file; the allow-list, skip-list, per-path budget
// and rates are the live production values. Nothing leaves your machine.
//
// Usage:  node estimate.mjs <repo> [<repo> ...]
//
// Each argument is a git repository, or a plain folder holding several (one
// level deep), so an agency can price a whole clients directory in one run.
// One row per repo, then a total. Needs git and Node 18 or newer.
import { spawnSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { basename, join, resolve } from 'path';

const RATE_SOURCE = 100;
const RATE_HISTORY = 40;
const TEXT_TO_CODE_MULTIPLIER = 10;
const GIT_PLUMBING_MAXBUFFER = 536870912;
const TOKEN_CODE_EXTENSIONS = new Set([".js",".jsx",".ts",".tsx",".mjs",".cjs",".py",".rs",".sol",".go",".java",".kt",".kts",".swift",".m",".mm",".c",".h",".cpp",".cc",".hpp",".cs",".rb",".php",".scala",".dart",".lua",".r",".jl",".clj",".ex",".exs",".erl",".hs",".fs",".pl",".coffee",".elm",".gd",".vy",".cairo",".move",".sh",".bash",".zsh",".ps1",".sql",".graphql",".gql",".proto",".css",".scss",".sass",".less",".vue",".svelte",".gradle",".cmake"]);
const TOKEN_TEXT_EXTENSIONS = new Set([".html",".htm",".yaml",".yml",".toml",".md",".rst",".xml",".plist",".pbxproj",".storyboard",".xib",".json"]);
const TOKEN_SKIP_DIRS = new Set(["node_modules","Pods","Carthage",".gradle","vendor","bower_components","dist","build","out",".next",".nuxt",".turbo",".parcel-cache","target","DerivedData","xcuserdata","__pycache__",".cache",".git"]);
const PATH_HISTORY_BUDGET = 104857600;
const NO_HEAD = /not a valid object name|unknown revision|bad revision|ambiguous argument/i;

function assertGitOk(res, what, repo, tolerate) {
  if (res.error)
    throw Error(`git ${what} failed for ${repo}: ${res.error.message}`);
  if (res.status !== 0) {
    const stderr = String(res.stderr || "").trim();
    if (tolerate && tolerate.test(stderr))
      return;
    throw Error(`git ${what} exited ${res.status} for ${repo}: ${stderr.slice(0, 200)}`);
  }
}

function tokenExt(path) {
  const fn = (path.split("/").pop() || "").toLowerCase(), dot = fn.lastIndexOf(".");
  return dot === -1 ? "" : fn.slice(dot);
}

function tokenClass(path) {
  if (path.split("/").some((part) => TOKEN_SKIP_DIRS.has(part)))
    return null;
  const ext = tokenExt(path);
  if (TOKEN_CODE_EXTENSIONS.has(ext))
    return "code";
  if (TOKEN_TEXT_EXTENSIONS.has(ext))
    return "text";
  return null;
}

function sourceBytesByClass(bareRepoPath) {
  const res = spawnSync("git", ["-C", bareRepoPath, "ls-tree", "-r", "-l", "-z", "HEAD"], { maxBuffer: GIT_PLUMBING_MAXBUFFER, encoding: "utf-8", timeout: 600000 });
  assertGitOk(res, "ls-tree", bareRepoPath, NO_HEAD);
  const bytes = { code: 0, text: 0 }, textPaths = [];
  for (const rec of (res.stdout || "").split("\x00")) {
    const tab = rec.indexOf("\t");
    if (tab === -1)
      continue;
    const meta = rec.slice(0, tab).trim().split(/\s+/), path = rec.slice(tab + 1);
    if (meta.length < 4 || meta[1] !== "blob")
      continue;
    const size = parseInt(meta[3], 10);
    if (!Number.isFinite(size))
      continue;
    const cls = tokenClass(path);
    if (cls)
      bytes[cls] += size;
    if (cls === "text")
      textPaths.push({ path, bytes: size });
  }
  textPaths.sort((a, b) => b.bytes - a.bytes);
  return { ...bytes, topText: textPaths.slice(0, 8) };
}

function historyBytesByClass(bareRepoPath) {
  const rev = spawnSync("git", ["-C", bareRepoPath, "rev-list", "--all", "--objects"], { maxBuffer: GIT_PLUMBING_MAXBUFFER, encoding: "utf-8", timeout: 600000 });
  assertGitOk(rev, "rev-list", bareRepoPath);
  const shaPath = new Map;
  for (const line of (rev.stdout || "").split(`
`)) {
    const sp = line.indexOf(" ");
    if (sp === -1)
      continue;
    const sha = line.slice(0, sp), path = line.slice(sp + 1);
    if (path && !shaPath.has(sha))
      shaPath.set(sha, path);
  }
  const bytes = { code: 0, text: 0 };
  if (shaPath.size === 0)
    return { ...bytes, topText: [] };
  const check = spawnSync("git", ["-C", bareRepoPath, "cat-file", "--batch-check"], {
    input: Array.from(shaPath.keys()).join(`
`) + `
`,
    maxBuffer: GIT_PLUMBING_MAXBUFFER,
    encoding: "utf-8",
    timeout: 600000
  });
  assertGitOk(check, "cat-file", bareRepoPath);
  const pathBytes = new Map;
  for (const line of (check.stdout || "").split(`
`)) {
    const f = line.split(/\s+/);
    if (f.length < 3 || f[1] !== "blob")
      continue;
    const path = shaPath.get(f[0]) || "";
    if (!tokenClass(path))
      continue;
    const size = parseInt(f[2], 10);
    if (!Number.isFinite(size))
      continue;
    pathBytes.set(path, (pathBytes.get(path) || 0) + size);
  }
  const textPaths = [];
  for (const [path, b] of pathBytes) {
    const charged = Math.min(b, PATH_HISTORY_BUDGET), cls = tokenClass(path);
    bytes[cls] += charged;
    if (cls === "text")
      textPaths.push({ path, bytes: charged });
  }
  textPaths.sort((a, b) => b.bytes - a.bytes);
  return { ...bytes, topText: textPaths.slice(0, 8) };
}

function tokenCountsFromGit(repoPath) {
  const src = sourceBytesByClass(repoPath), all = historyBytesByClass(repoPath), historyCode = Math.max(all.code - src.code, 0), historyTextRaw = Math.max(all.text - src.text, 0), sourceText = Math.min(src.text, src.code * TEXT_TO_CODE_MULTIPLIER), historyText = Math.min(historyTextRaw, historyCode * TEXT_TO_CODE_MULTIPLIER), tokens = (bytes) => Math.floor(bytes / 4), topTextPaths = [
    ...src.topText.map((p) => ({ path: p.path, tokens: tokens(p.bytes), where: "head" })),
    ...all.topText.map((p) => ({ path: p.path, tokens: tokens(p.bytes), where: "history" }))
  ].sort((a, b) => b.tokens - a.tokens).slice(0, 10);
  return {
    sourceTokens: tokens(src.code + sourceText),
    historyTokens: tokens(historyCode + historyText),
    sourceCodeTokens: tokens(src.code),
    sourceTextTokens: tokens(sourceText),
    historyCodeTokens: tokens(historyCode),
    historyTextTokens: tokens(historyText),
    sourceTextClippedTokens: tokens(src.text - sourceText),
    historyTextClippedTokens: tokens(historyTextRaw - historyText),
    topTextPaths
  };
}

// ---- main ----
const gitProbe = spawnSync('git', ['--version'], { encoding: 'utf-8' });
if (gitProbe.error || gitProbe.status !== 0) {
    console.error('git is required but was not found on PATH.');
    process.exit(1);
}
const isDir = (p) => {
    try {
        return statSync(p).isDirectory();
    } catch (e) {
        return false;
    }
};
// The repository a path belongs to: itself when bare, else its work-tree root,
// so a subfolder of a clone prices the whole clone rather than a slice of it.
const repoRoot = (p) => {
    const bare = spawnSync('git', ['-C', p, 'rev-parse', '--is-bare-repository'], {
        encoding: 'utf-8'
    });
    if (bare.status !== 0) return null;
    if (bare.stdout.trim() === 'true') return p;
    const top = spawnSync('git', ['-C', p, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf-8'
    });
    return top.status === 0 ? top.stdout.trim() || p : p;
};
// Expand the arguments: a repo is itself; a plain folder contributes every
// repo directly inside it. Deduped so a repo named twice is priced once.
const args = process.argv.length > 2 ? process.argv.slice(2) : ['.'];
const targets = [];
const skipped = [];
for (const arg of args) {
    const p = resolve(arg);
    if (!isDir(p)) {
        skipped.push(arg + ': not a directory');
        continue;
    }
    const root = repoRoot(p);
    if (root) {
        if (!targets.includes(root)) targets.push(root);
        continue;
    }
    const inside = readdirSync(p, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => join(p, d.name))
        .filter((c) => repoRoot(c) === c)
        .sort();
    if (inside.length === 0) {
        skipped.push(arg + ': not a git repository, and none found inside it');
        continue;
    }
    for (const c of inside) if (!targets.includes(c)) targets.push(c);
}
for (const line of skipped) console.error('skipped ' + line);
if (targets.length === 0) {
    console.error('Nothing to estimate. Pass a git repository, or a folder of them.');
    process.exit(1);
}

const fmt = (n) => n.toLocaleString('en-US');
const usd = (n) =>
    '$' +
    n.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
const value = (src, hist) => (src / 1e6) * RATE_SOURCE + (hist / 1e6) * RATE_HISTORY;
// Label each repo by folder name; two repos sharing a name (client-a/api,
// client-b/api) get their parent folder prepended, and the full path only if
// that still collides. Unique names stay short.
const seg = (t, n) => t.split(/[\/]+/).filter(Boolean).slice(-n).join('/');
const labels = targets.map((t) => seg(t, 1) || t);
for (const n of [2, 3]) {
    const counts = new Map();
    for (const l of labels) counts.set(l, (counts.get(l) || 0) + 1);
    labels.forEach((l, i) => {
        if (counts.get(l) > 1) labels[i] = n === 3 ? targets[i] : seg(targets[i], n);
    });
}
const totalLabel = 'total (' + targets.length + (targets.length === 1 ? ' repo)' : ' repos)');
const partialLabel = (n) => 'total (' + n + ' of ' + targets.length + ')';
const W = {
    name: Math.max(totalLabel.length, partialLabel(0).length, ...labels.map((l) => l.length)),
    num: 16,
    usd: 14
};
const row = (name, src, hist, val) =>
    '  ' +
    name.padEnd(W.name) +
    src.padStart(W.num) +
    hist.padStart(W.num) +
    val.padStart(W.usd);

console.log('');
console.log('pre.dev code licensing estimate');
console.log('counting rule: markup, data, config and docs count up to ' + TEXT_TO_CODE_MULTIPLIER + 'x the code beside them;');
console.log('history charges at most ' + PATH_HISTORY_BUDGET / (1024 * 1024) + 'MB per path; generated, vendored and data-dump paths are skipped.');
console.log('');
console.log(row('repository', 'source tokens', 'history tokens', 'value'));
let totalSrc = 0;
let totalHist = 0;
let failed = 0;
// Rows print as each repo finishes, so a big history doubles as progress.
targets.forEach((repo, i) => {
    try {
        const counts = tokenCountsFromGit(repo);
        const src = counts.sourceTokens;
        const hist = counts.historyTokens;
        totalSrc += src;
        totalHist += hist;
        console.log(row(labels[i], fmt(src), fmt(hist), usd(value(src, hist))));
        // What the line left out, so a number that looks small explains itself.
        const clipped = counts.sourceTextClippedTokens + counts.historyTextClippedTokens;
        if (clipped > 0) {
            console.log(
                '  ' + ''.padEnd(W.name) + '  beyond the line, not priced: ' + fmt(counts.sourceTextClippedTokens) +
                    ' source / ' + fmt(counts.historyTextClippedTokens) + ' history tokens'
            );
            for (const p of (counts.topTextPaths || []).slice(0, 3)) {
                console.log('  ' + ''.padEnd(W.name) + '    ' + p.path + '  ' + fmt(p.tokens) + ' (' + p.where + ')');
            }
        }
    } catch (err) {
        failed++;
        const msg = String((err && err.message) || err).replace(/\s+/g, ' ');
        console.log('  ' + labels[i].padEnd(W.name) + '  error: ' + msg.slice(0, 120));
    }
});
if (targets.length > 1) {
    const counted = targets.length - failed;
    console.log('  ' + '-'.repeat(W.name + W.num * 2 + W.usd));
    console.log(
        row(
            counted === targets.length ? totalLabel : partialLabel(counted),
            fmt(totalSrc),
            fmt(totalHist),
            usd(value(totalSrc, totalHist))
        )
    );
}
console.log('');
console.log(
    'value = source x $' + RATE_SOURCE + '/M + history x $' + RATE_HISTORY + '/M, per non-exclusive licence.'
);
console.log('Source counts code files at HEAD; history counts every unique revision');
console.log('across all refs (capped at ' + PATH_HISTORY_BUDGET / (1024 * 1024) + 'MB per path); tokens = bytes / 4.');
console.log('Markup, data, config and docs (.html, .json, .md, .yaml, ...) are priced up to ' + TEXT_TO_CODE_MULTIPLIER + 'x the');
console.log('code they accompany, at HEAD and in history separately. Text beyond that line is listed');
console.log('above and not priced; on the dashboard such a repo is flagged and may be priced in full.');
console.log('The functions in this file are the production counter, extracted verbatim,');
console.log('so these numbers match what your dashboard will show after you sync.');
if (failed) process.exit(1);
