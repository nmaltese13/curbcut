/**
 * Scan a URL from the command line and print a report.
 * Usage: npm run scan -- https://example.com [--fix]
 */
import { scanSinglePage } from '../src/scan/runner.js';
import { buildRemediationPlan } from '../src/scan/fixer.js';
import { closeBrowser } from '../src/scan/render.js';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const wantFix = args.includes('--fix');
const asJson = args.includes('--json');

if (!url) {
  console.error('Usage: npm run scan -- <url> [--fix] [--json]');
  process.exit(1);
}

const COLORS = {
  critical: '\x1b[31m', serious: '\x1b[33m', moderate: '\x1b[36m', minor: '\x1b[90m',
  reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', dim: '\x1b[2m',
};

function bar(score) {
  const filled = Math.round(score / 5);
  const color = score >= 90 ? COLORS.green : score >= 70 ? COLORS.moderate : score >= 50 ? COLORS.serious : COLORS.critical;
  return `${color}${'█'.repeat(filled)}${COLORS.dim}${'░'.repeat(20 - filled)}${COLORS.reset}`;
}

try {
  const result = await scanSinglePage(url);

  if (asJson) {
    console.log(JSON.stringify(
      { url: result.url, score: result.score, renderMode: result.renderMode,
        totals: result.totals, coverage: result.coverage, findings: result.findings },
      null, 2
    ));
    await closeBrowser();
    // Exit code only: process.exit() here would truncate piped stdout.
    process.exitCode = result.totals.definite > 0 ? 1 : 0;
  } else {

  console.log(`\n${COLORS.bold}${result.url}${COLORS.reset}`);
  console.log(`${bar(result.score)}  ${COLORS.bold}${result.score}/100${COLORS.reset}\n`);

  console.log(`${result.totals.definite} confirmed · ${result.totals.review} need review · ${result.stats.elements} elements checked`);

  if (!result.coverage.complete) {
    console.log(`\n${COLORS.serious}⚠ ${result.coverage.note}${COLORS.reset}`);
  }

  const groups = new Map();
  for (const finding of result.findings) {
    if (!groups.has(finding.ruleId)) groups.set(finding.ruleId, []);
    groups.get(finding.ruleId).push(finding);
  }

  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const sorted = [...groups.entries()].sort(
    (a, b) => order[a[1][0].impact] - order[b[1][0].impact] || b[1].length - a[1].length
  );

  console.log('');
  for (const [ruleId, items] of sorted) {
    const first = items[0];
    const color = COLORS[first.impact];
    console.log(`${color}${first.impact.padEnd(8)}${COLORS.reset} ${COLORS.bold}${first.title}${COLORS.reset} ${COLORS.dim}(${items.length}× · WCAG ${first.wcag.join(', ')} · ${first.confidence})${COLORS.reset}`);
    for (const item of items.slice(0, 3)) {
      console.log(`  ${COLORS.dim}line ${item.line ?? '?'}${COLORS.reset}  ${item.snippet?.slice(0, 92) || item.selector}`);
    }
    if (items.length > 3) console.log(`  ${COLORS.dim}…and ${items.length - 3} more${COLORS.reset}`);
    console.log('');
  }

  if (wantFix) {
    const plan = buildRemediationPlan(result.html, result.findings, { filename: 'page.html' });
    console.log(`${COLORS.bold}Remediation plan${COLORS.reset}`);
    console.log(`${COLORS.green}${plan.counts.automatic} automatic${COLORS.reset} · ${plan.counts.manual} need a person\n`);
    if (plan.diff) {
      for (const line of plan.diff.split('\n')) {
        if (line.startsWith('+')) console.log(`${COLORS.green}${line}${COLORS.reset}`);
        else if (line.startsWith('-')) console.log(`${COLORS.critical}${line}${COLORS.reset}`);
        else console.log(`${COLORS.dim}${line}${COLORS.reset}`);
      }
    }
    if (plan.cssSnippet) {
      console.log(`\n${COLORS.bold}Contrast adjustments${COLORS.reset}`);
      console.log(COLORS.dim + plan.cssSnippet + COLORS.reset);
    }
  }

  console.log(`${COLORS.dim}Automated testing covers a subset of WCAG. Criteria needing human review are not included in this score.${COLORS.reset}`);
  await closeBrowser();
  process.exitCode = result.totals.definite > 0 ? 1 : 0;
  }
} catch (err) {
  console.error(`\n${COLORS.critical}Scan failed:${COLORS.reset} ${err.message}\n`);
  await closeBrowser();
  process.exitCode = 2;
}
