#!/usr/bin/env node
// Renders assets/stats-dark.svg and assets/stats-light.svg: three big numbers
// (contributions in 12 months, commits this year, repos contributed to) and the top language bars, pulled
// from the GitHub GraphQL API. Runs nightly from .github/workflows/stats.yml.
//
//   GITHUB_TOKEN=... node scripts/render-stats.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USER = process.env.GITHUB_USER || "gemesquita";
const TOKEN = process.env.GH_PAT || process.env.GITHUB_TOKEN;
if (!TOKEN) { console.error("Set GITHUB_TOKEN (or GH_PAT)."); process.exit(1); }

const year = new Date().getUTCFullYear();
const query = `query($login: String!, $from: DateTime!) {
  user(login: $login) {
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
      nodes { stargazerCount languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } } }
    }
    all: contributionsCollection { totalRepositoriesWithContributedCommits contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } }
    year: contributionsCollection(from: $from) { totalCommitContributions }
  }
}`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "render-stats" },
  body: JSON.stringify({ query, variables: { login: USER, from: `${year}-01-01T00:00:00Z` } }),
});
const json = await res.json();
if (!json.data) { console.error(JSON.stringify(json, null, 2)); process.exit(1); }
const u = json.data.user;

const contributions = u.all.contributionCalendar.totalContributions;
const commits = u.year.totalCommitContributions;
const repos = u.all.totalRepositoriesWithContributedCommits;

// generated or markup languages that would crowd out the real ones
const SKIP = new Set(["PLpgSQL", "HTML", "CSS", "SCSS", "Makefile", "Dockerfile", "Jupyter Notebook", "Shell"]);
const bytes = {};
for (const r of u.repositories.nodes) for (const e of r.languages.edges) if (!SKIP.has(e.node.name)) bytes[e.node.name] = (bytes[e.node.name] || 0) + e.size;
const total = Object.values(bytes).reduce((a, b) => a + b, 0) || 1;
const langs = Object.entries(bytes).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, n]) => [name, Math.round((n / total) * 100)]);

const fmt = (n) => n.toLocaleString("en-US");
function svg({ fg, mute, line, bar }) {
  const W = 830, colW = W / 3;
  const nums = [[contributions, "contributions · 12 months"], [commits, `commits · ${year}`], [repos, "repos contributed to"]];
  const sans = "'Helvetica Neue', Helvetica, Arial, 'Segoe UI', sans-serif";
  const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="252" viewBox="0 0 ${W} 252" role="img" aria-label="${fmt(contributions)} contributions in 12 months, ${fmt(commits)} commits in ${year}, ${repos} repositories contributed to">\n`;
  s += `<line x1="0" y1="1" x2="${W}" y2="1" stroke="${fg}" stroke-width="1.5"/>\n`;
  nums.forEach(([v, label], i) => {
    const x = i * colW;
    if (i > 0) s += `<line x1="${x}" y1="2" x2="${x}" y2="128" stroke="${line}"/>\n`;
    s += `<text x="${x + 18}" y="92" font-family="${sans}" font-size="68" font-weight="800" letter-spacing="-3" fill="${fg}">${fmt(v)}</text>\n`;
    s += `<text x="${x + 20}" y="118" font-family="${mono}" font-size="11" letter-spacing="2.5" fill="${mute}">${label.toUpperCase()}</text>\n`;
  });
  langs.forEach(([name, pct], i) => {
    const y = 160 + i * 24;
    s += `<text x="0" y="${y}" font-family="${mono}" font-size="11" fill="${mute}">${name}</text>\n`;
    s += `<text x="${W}" y="${y}" text-anchor="end" font-family="${mono}" font-size="11" fill="${mute}">${pct}%</text>\n`;
    s += `<rect x="0" y="${y + 6}" width="${W}" height="6" fill="${bar}"/>\n`;
    s += `<rect x="0" y="${y + 6}" width="${(W * pct) / 100}" height="6" fill="${fg}"/>\n`;
  });
  return s + `</svg>\n`;
}

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "stats-dark.svg"), svg({ fg: "#e6edf3", mute: "#8b949e", line: "#30363d", bar: "#21262d" }));
writeFileSync(resolve(dir, "stats-light.svg"), svg({ fg: "#0b0b0b", mute: "#6f6f6c", line: "#dcdcdc", bar: "#ececea" }));
console.log({ contributions, commits, repos, langs });
