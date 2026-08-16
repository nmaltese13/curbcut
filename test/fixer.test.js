import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzePage } from '../src/scan/engine.js';
import { setAttribute, removeAttribute, applyFixes, unifiedDiff, buildRemediationPlan, isMechanical } from '../src/scan/fixer.js';
import { parseRobots, extractLinks, extractStylesheetUrls, assertPublicUrl, isPrivateHost } from '../src/scan/crawler.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8');

describe('attribute editing', () => {
  test('adds an attribute to a plain tag', () => {
    assert.equal(setAttribute('<img src="a.png">', 'alt', 'A cat'), '<img src="a.png" alt="A cat">');
  });

  test('preserves self-closing syntax', () => {
    assert.equal(setAttribute('<img src="a.png" />', 'alt', ''), '<img src="a.png" alt="" />');
  });

  test('replaces an existing attribute value', () => {
    assert.equal(setAttribute('<img alt="old" src="a.png">', 'alt', 'new'), '<img alt="new" src="a.png">');
  });

  test('handles single quotes and unquoted values', () => {
    assert.equal(setAttribute("<div class='x' tabindex=5>", 'tabindex', '0'), "<div class='x' tabindex=\"0\">");
  });

  test('escapes values to prevent attribute injection', () => {
    const result = setAttribute('<img src="a.png">', 'alt', 'He said "hi" & <b>left</b>');
    assert.ok(!result.includes('<b>'), 'raw markup must not survive into an attribute');
    assert.ok(result.includes('&quot;') && result.includes('&amp;') && result.includes('&lt;'));
  });

  test('removes an attribute', () => {
    assert.equal(removeAttribute('<meta name="viewport" content="x">', 'content'), '<meta name="viewport">');
  });
});

describe('diffing', () => {
  test('produces a unified diff with correct markers', () => {
    const diff = unifiedDiff('a\nb\nc', 'a\nB\nc', { filename: 'x.html' });
    assert.ok(diff.includes('--- a/x.html'));
    assert.ok(diff.includes('+++ b/x.html'));
    assert.ok(diff.includes('-b'));
    assert.ok(diff.includes('+B'));
  });

  test('returns empty output for identical input', () => {
    assert.equal(unifiedDiff('same\ntext', 'same\ntext'), '');
  });
});

describe('remediation of a real page', () => {
  const html = fixture('broken.html');
  const before = analyzePage(html, { url: 'https://example.com/store' });
  const plan = buildRemediationPlan(html, before.findings, { filename: 'store.html' });
  const after = analyzePage(plan.patched, { url: 'https://example.com/store' });

  test('applies at least one automatic fix', () => {
    assert.ok(plan.counts.automatic > 0, 'expected mechanical fixes to be applied');
    assert.ok(plan.diff.length > 0, 'expected a reviewable diff');
  });

  test('rescanning the patched source shows fewer violations', () => {
    const definiteBefore = before.findings.filter((f) => f.confidence === 'definite').length;
    const definiteAfter = after.findings.filter((f) => f.confidence === 'definite').length;
    assert.ok(
      definiteAfter < definiteBefore,
      `expected fewer definite findings after patching (before=${definiteBefore}, after=${definiteAfter})`
    );
  });

  test('the score improves', () => {
    assert.ok(after.score > before.score, `expected score to rise (before=${before.score}, after=${after.score})`);
  });

  test('fixes do not introduce new rule violations', () => {
    const beforeIds = new Set(before.findings.map((f) => f.ruleId));
    const introduced = [...new Set(after.findings.map((f) => f.ruleId))].filter((id) => !beforeIds.has(id));
    assert.deepEqual(introduced, [], `patching must not create new problems, found: ${introduced.join(', ')}`);
  });

  test('specific known-safe fixes are actually applied', () => {
    // These three are purely additive or restrictive and must always be automated.
    assert.ok(/<html lang="en">/.test(plan.patched), 'lang should be added');
    assert.ok(!/user-scalable\s*=\s*no/.test(plan.patched), 'zoom restriction should be removed');
    assert.ok(/tabindex="0"/.test(plan.patched), 'positive tabindex should be normalised');
    assert.ok(/title="YouTube video player"/.test(plan.patched), 'frame title should be inferred');
  });

  test('never invents alt text', () => {
    // Writing a guessed description would be exactly the overclaiming the FTC
    // penalised. Missing alt must always be routed to a human.
    const altFindings = before.findings.filter((f) => f.ruleId === 'img-alt');
    assert.ok(altFindings.length > 0);
    for (const finding of altFindings) {
      assert.ok(!isMechanical(finding), 'alt text must not be auto-applied');
    }
    // The image that had no alt must be left exactly as it was found.
    assert.ok(plan.patched.includes('<img src="/hero.jpg">'), 'hero image must be untouched by the patcher');
  });

  test('routes judgement calls to a human with guidance', () => {
    assert.ok(plan.manual.length > 0);
    for (const item of plan.manual) {
      assert.ok(item.guidance && item.guidance.length > 10, `${item.finding.ruleId} needs actionable guidance`);
    }
  });

  test('emits a CSS snippet for contrast repairs', () => {
    assert.ok(plan.cssSnippet, 'expected a contrast remediation snippet');
    assert.match(plan.cssSnippet, /color:\s*#[0-9a-f]{6}/i);
  });

  test('the patched document is still parseable and structurally intact', () => {
    assert.ok(plan.patched.includes('</html>'));
    assert.ok(plan.patched.includes('<h1>Our Store</h1>'), 'unrelated content must be untouched');
    assert.equal(after.findings.some((f) => f.ruleId === 'aria-valid-role' && f.message.includes('nonsense')), true);
  });
});

describe('overlap safety', () => {
  test('refuses to apply two edits to the same region', () => {
    const html = '<img src="a.png">';
    const findings = [
      { offsets: { start: 0, end: 17 }, fix: { strategy: 'set-attribute', attribute: 'alt', value: 'x', confidence: 'definite' }, ruleId: 'r1' },
      { offsets: { start: 0, end: 17 }, fix: { strategy: 'set-attribute', attribute: 'title', value: 'y', confidence: 'definite' }, ruleId: 'r2' },
    ];
    const result = applyFixes(html, findings);
    assert.equal(result.applied.length, 1);
    assert.equal(result.skipped.length, 1);
  });
});

describe('crawler safety', () => {
  test('classifies every non-routable host as private', () => {
    // Environment-independent. In production assertPublicUrl rejects all of these;
    // outside production only loopback is exempted so the app can scan itself.
    for (const host of [
      '169.254.169.254',  // cloud metadata endpoint
      '10.0.0.5', '192.168.1.1', '172.16.4.4', '127.0.0.1', '0.0.0.0',
      '100.64.0.1',       // carrier-grade NAT
      '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1',
      'localhost', 'db.internal', 'printer.local',
    ]) {
      assert.equal(isPrivateHost(host), true, `${host} must be treated as private`);
    }
  });

  test('treats public hosts as routable', () => {
    for (const host of ['example.com', '8.8.8.8', '1.1.1.1', 'sub.domain.co.uk']) {
      assert.equal(isPrivateHost(host), false, `${host} should be allowed`);
    }
  });

  test('rejects private ranges and metadata endpoints in every environment', async () => {
    // Loopback is deliberately excluded here: it is the one dev-only exemption.
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/',
      'http://192.168.1.1/admin',
      'http://172.20.0.1/',
      'http://metadata.internal/',
    ]) {
      await assert.rejects(() => assertPublicUrl(url), /not publicly reachable|private/i, `should reject ${url}`);
    }
  });

  test('rejects non-http schemes', async () => {
    await assert.rejects(() => assertPublicUrl('file:///etc/passwd'), /http/i);
    await assert.rejects(() => assertPublicUrl('gopher://x/'), /http/i);
  });

  test('parses robots.txt directives', () => {
    const robots = parseRobots('User-agent: *\nDisallow: /admin\nDisallow: /cart\nAllow: /cart/public\n');
    assert.equal(robots.allowed('/'), true);
    assert.equal(robots.allowed('/admin/users'), false);
    assert.equal(robots.allowed('/cart'), false);
    assert.equal(robots.allowed('/cart/public'), true);
  });

  test('extracts only same-origin page links', () => {
    const html = `
      <a href="/about">About</a>
      <a href="https://other.com/x">External</a>
      <a href="/logo.png">Image</a>
      <a href="mailto:a@b.com">Mail</a>
      <a href="#top">Anchor</a>
      <a href='/contact'>Contact</a>`;
    const links = extractLinks(html, 'https://example.com/');
    assert.deepEqual(links.sort(), ['https://example.com/about', 'https://example.com/contact']);
  });

  test('extracts same-origin stylesheet links', () => {
    const html = `<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="https://cdn.com/b.css"><link rel="icon" href="/f.ico">`;
    assert.deepEqual(extractStylesheetUrls(html, 'https://example.com/'), ['https://example.com/a.css']);
  });
});
