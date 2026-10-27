#!/usr/bin/env node
// Renders every data-driven block of the README from the GitHub GraphQL API,
// using GH_PAT so private and organisation work counts. Dark and light variants of:
//   assets/stats-*.svg        big numbers + language bars (languages weighted by
//                             your commits over the last three years)
//   assets/card-stats-*.svg   this year's commits, PRs, issues, reviews, repos, stars
//   assets/card-streak-*.svg  contributions, current streak, longest streak
// Runs nightly from .github/workflows/stats.yml.
//
//   GH_PAT=... node scripts/render-stats.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USER = process.env.GITHUB_USER || "gemesquita";
const TOKEN = process.env.GH_PAT || process.env.GITHUB_TOKEN;
if (!TOKEN) { console.error("Set GH_PAT (or GITHUB_TOKEN)."); process.exit(1); }

const now = new Date();
const year = now.getUTCFullYear();
const iso = (d) => d.toISOString();
const yearsAgo = (n) => { const d = new Date(now); d.setUTCFullYear(d.getUTCFullYear() - n); return d; };
const WINDOWS = 3; // language bars look back this many years (one API window each)

const langWindow = (i) => `w${i}: contributionsCollection(from: $f${i}, to: $t${i}) {
      commitContributionsByRepository(maxRepositories: 100) {
        contributions { totalCount }
        repository { isPrivate languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } } }
      }
    }`;
const query = `query($login: String!, $yearStart: DateTime!, ${Array.from({ length: WINDOWS }, (_, i) => `$f${i}: DateTime!, $t${i}: DateTime!`).join(", ")}) {
  user(login: $login) {
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false) { nodes { stargazerCount } }
    pullRequests { totalCount }
    issues { totalCount }
    all: contributionsCollection {
      totalRepositoriesWithContributedCommits
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    }
    year: contributionsCollection(from: $yearStart) {
      totalCommitContributions totalPullRequestContributions totalIssueContributions
      totalPullRequestReviewContributions totalRepositoriesWithContributedCommits
    }
    ${Array.from({ length: WINDOWS }, (_, i) => langWindow(i)).join("\n    ")}
  }
}`;
const variables = { login: USER, yearStart: `${year}-01-01T00:00:00Z` };
for (let i = 0; i < WINDOWS; i++) { variables[`f${i}`] = iso(yearsAgo(i + 1)); variables[`t${i}`] = iso(yearsAgo(i)); }

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "render-stats" },
  body: JSON.stringify({ query, variables }),
});
const json = await res.json();
if (!json.data) { console.error(JSON.stringify(json, null, 2)); process.exit(1); }
const u = json.data.user;

// ---------- figures ----------
const contributions = u.all.contributionCalendar.totalContributions;
const commits = u.year.totalCommitContributions;
const repos = u.all.totalRepositoriesWithContributedCommits;
const stars = u.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);

const days = u.all.contributionCalendar.weeks.flatMap((w) => w.contributionDays).sort((a, b) => a.date.localeCompare(b.date));
let current = { len: 0, from: null, to: null }, longest = { len: 0, from: null, to: null }, run = { len: 0, from: null, to: null };
for (const d of days) {
  if (d.contributionCount > 0) { run = run.len ? { len: run.len + 1, from: run.from, to: d.date } : { len: 1, from: d.date, to: d.date }; if (run.len > longest.len) longest = { ...run }; }
  else run = { len: 0, from: null, to: null };
}
// the current streak survives an empty "today"
const last = days[days.length - 1];
if (last && last.contributionCount === 0) {
  let i = days.length - 2, len = 0, from = null;
  while (i >= 0 && days[i].contributionCount > 0) { from = days[i].date; len++; i--; }
  current = { len, from, to: len ? days[days.length - 2].date : null };
} else current = { ...run };

// languages: each repo's language mix weighted by your commits there, summed over the windows
const SKIP = new Set(["PLpgSQL", "HTML", "CSS", "SCSS", "Makefile", "Dockerfile", "Jupyter Notebook", "Shell", "PowerShell", "Batchfile"]);
const weight = {};
for (let i = 0; i < WINDOWS; i++) for (const c of u[`w${i}`].commitContributionsByRepository) {
  const edges = c.repository.languages.edges.filter((e) => !SKIP.has(e.node.name));
  const repoTotal = edges.reduce((s, e) => s + e.size, 0);
  // anonymised breakdown for the Actions log (no repo names: the log is public)
  console.log(`y-${i + 1} ${c.repository.isPrivate ? "private" : "public "} ${String(c.contributions.totalCount).padStart(4)} commits  ${edges.slice(0, 3).map((e) => `${e.node.name} ${Math.round((e.size / (repoTotal || 1)) * 100)}%`).join(", ") || "(no code languages)"}`);
  if (!repoTotal) continue;
  for (const e of edges) weight[e.node.name] = (weight[e.node.name] || 0) + (e.size / repoTotal) * c.contributions.totalCount;
}
const total = Object.values(weight).reduce((a, b) => a + b, 0) || 1;
const langs = Object.entries(weight).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n]) => [name, Math.max(1, Math.round((n / total) * 100))]);

// ---------- drawing ----------
const fmt = (n) => n.toLocaleString("en-US");
// short form, e.g. "Oct 26 '25", so a date range fits inside a third of the streak card
const date = (s) => { if (!s) return ""; const d = new Date(s + "T00:00:00Z"); return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} '${String(d.getUTCFullYear()).slice(2)}`; };
const SANS = "'Helvetica Neue', Helvetica, Arial, 'Segoe UI', sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const THEMES = {
  dark: { fg: "#e6edf3", mute: "#8b949e", line: "#30363d", bar: "#21262d" },
  light: { fg: "#0b0b0b", mute: "#6f6f6c", line: "#dcdcdc", bar: "#ececea" },
};

function bigNumbers({ fg, mute, line, bar }) {
  const W = 830, colW = W / 3, H = 160 + langs.length * 24 + 4;
  const nums = [[contributions, "contributions · 12 months"], [commits, `commits · ${year}`], [repos, "repos contributed to"]];
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${fmt(contributions)} contributions in 12 months, ${fmt(commits)} commits in ${year}, ${repos} repositories contributed to">\n`;
  s += `<line x1="0" y1="1" x2="${W}" y2="1" stroke="${fg}" stroke-width="1.5"/>\n`;
  nums.forEach(([v, label], i) => {
    const x = i * colW;
    if (i > 0) s += `<line x1="${x}" y1="2" x2="${x}" y2="128" stroke="${line}"/>\n`;
    s += `<text x="${x + 18}" y="92" font-family="${SANS}" font-size="68" font-weight="800" letter-spacing="-3" fill="${fg}">${fmt(v)}</text>\n`;
    s += `<text x="${x + 20}" y="118" font-family="${MONO}" font-size="11" letter-spacing="2.5" fill="${mute}">${label.toUpperCase()}</text>\n`;
  });
  langs.forEach(([name, pct], i) => {
    const y = 160 + i * 24;
    s += `<text x="0" y="${y}" font-family="${MONO}" font-size="11" fill="${mute}">${name}</text>\n`;
    s += `<text x="${W}" y="${y}" text-anchor="end" font-family="${MONO}" font-size="11" fill="${mute}">${pct}%</text>\n`;
    s += `<rect x="0" y="${y + 6}" width="${W}" height="6" fill="${bar}"/>\n<rect x="0" y="${y + 6}" width="${(W * pct) / 100}" height="6" fill="${fg}"/>\n`;
  });
  return s + `</svg>\n`;
}

function statsCard({ fg, mute, line }) {
  const W = 410, H = 196;
  const rows = [
    ["Commits", commits], ["Pull requests", u.year.totalPullRequestContributions], ["Issues", u.year.totalIssueContributions],
    ["Reviews", u.year.totalPullRequestReviewContributions], ["Repos contributed to", u.year.totalRepositoriesWithContributedCommits],
  ];
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="GitHub activity in ${year}">\n`;
  s += `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${line}"/>\n`;
  s += `<text x="20" y="30" font-family="${MONO}" font-size="11" letter-spacing="2.5" fill="${mute}">${year} SO FAR</text>\n`;
  s += `<text x="${W - 20}" y="30" text-anchor="end" font-family="${MONO}" font-size="11" letter-spacing="2.5" fill="${mute}">${fmt(stars)} STARS · ${fmt(u.pullRequests.totalCount)} PRS ALL TIME</text>\n`;
  rows.forEach(([label, v], i) => {
    const y = 64 + i * 26;
    s += `<line x1="20" y1="${y - 17}" x2="${W - 20}" y2="${y - 17}" stroke="${line}" stroke-dasharray="1 3"/>\n`;
    s += `<text x="20" y="${y}" font-family="${SANS}" font-size="14" fill="${fg}">${label}</text>\n`;
    s += `<text x="${W - 20}" y="${y}" text-anchor="end" font-family="${SANS}" font-size="15" font-weight="800" fill="${fg}">${fmt(v)}</text>\n`;
  });
  return s + `</svg>\n`;
}

function streakCard({ fg, mute, line }) {
  const W = 410, H = 196;
  // all three columns share the same baselines: number, label, date range
  const col = (cx, n, label, dates, big) => {
    // the ringed number sits higher than the side numbers so the ring clears the label row
    let s = `<text x="${cx}" y="${big ? 82 : 100}" text-anchor="middle" font-family="${SANS}" font-size="${big ? 40 : 32}" font-weight="800" letter-spacing="-1.5" fill="${fg}">${fmt(n)}</text>\n`;
    s += `<text x="${cx}" y="142" text-anchor="middle" font-family="${MONO}" font-size="10" letter-spacing="1.5" fill="${mute}">${label}</text>\n`;
    s += `<text x="${cx}" y="160" text-anchor="middle" font-family="${MONO}" font-size="7.5" fill="${mute}">${dates}</text>\n`;
    return s;
  };
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${fmt(contributions)} contributions in the last year, current streak ${current.len} days, longest streak ${longest.len} days">\n`;
  s += `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${line}"/>\n`;
  s += `<circle cx="205" cy="68" r="38" fill="none" stroke="${fg}" stroke-width="2"/>\n`;
  s += col(72, contributions, "CONTRIBUTIONS", `${date(days[0]?.date)} – present`, false);
  s += col(205, current.len, "CURRENT STREAK", current.len ? `${date(current.from)} – ${date(current.to)}` : "no active streak", true);
  s += col(338, longest.len, "LONGEST STREAK", longest.len ? `${date(longest.from)} – ${date(longest.to)}` : "", false);
  return s + `</svg>\n`;
}

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(dir, { recursive: true });
for (const [name, t] of Object.entries(THEMES)) {
  writeFileSync(resolve(dir, `stats-${name}.svg`), bigNumbers(t));
  writeFileSync(resolve(dir, `card-stats-${name}.svg`), statsCard(t));
  writeFileSync(resolve(dir, `card-streak-${name}.svg`), streakCard(t));
}
console.log({ contributions, commits, repos, stars, current: current.len, longest: longest.len, langs });
