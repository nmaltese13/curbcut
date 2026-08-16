import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzePage, scoreFrom, signatureFor } from '../src/scan/engine.js';
import { parseColor, contrastRatio, requiredRatio, suggestAccessibleColor } from '../src/lib/color.js';
import { parseStylesheet, matches, computeTextStyle } from '../src/lib/css.js';
import { parseDocument, accessibleName, cssPath } from '../src/lib/html.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8');

const broken = analyzePage(fixture('broken.html'), { url: 'https://example.com/store' });
const clean = analyzePage(fixture('clean.html'), { url: 'https://example.com/' });
const shell = analyzePage(fixture('spa-shell.html'), { url: 'https://example.com/app' });

const ruleIds = (result) => new Set(result.findings.map((f) => f.ruleId));
const findingsFor = (result, id) => result.findings.filter((f) => f.ruleId === id);

describe('color utilities', () => {
  test('parses hex, rgb, hsl and named colors', () => {
    assert.deepEqual(parseColor('#fff'), [255, 255, 255, 1]);
    assert.deepEqual(parseColor('#000000'), [0, 0, 0, 1]);
    assert.deepEqual(parseColor('rgb(255, 0, 0)'), [255, 0, 0, 1]);
    assert.deepEqual(parseColor('rgba(0, 0, 0, 0.5)'), [0, 0, 0, 0.5]);
    assert.deepEqual(parseColor('white'), [255, 255, 255, 1]);
    const hsl = parseColor('hsl(0, 100%, 50%)');
    assert.deepEqual(hsl.slice(0, 3), [255, 0, 0]);
  });

  test('returns null for values it cannot evaluate', () => {
    // Critical for honesty: unresolvable colors must not silently become black.
    assert.equal(parseColor('var(--brand)'), null);
    assert.equal(parseColor('linear-gradient(red, blue)'), null);
    assert.equal(parseColor('currentColor'), null);
    assert.equal(parseColor(''), null);
  });

  test('computes WCAG contrast ratios correctly', () => {
    // Black on white is the canonical 21:1.
    assert.equal(Math.round(contrastRatio([0, 0, 0], [255, 255, 255])), 21);
    assert.equal(Math.round(contrastRatio([255, 255, 255], [255, 255, 255])), 1);
    // #767676 on white is the well-known 4.54:1 boundary case.
    const ratio = contrastRatio([118, 118, 118], [255, 255, 255]);
    assert.ok(ratio >= 4.5 && ratio < 4.6, `expected ~4.54, got ${ratio}`);
  });

  test('applies large-text thresholds', () => {
    assert.equal(requiredRatio({ fontSizePx: 16 }), 4.5);
    assert.equal(requiredRatio({ fontSizePx: 24 }), 3);
    assert.equal(requiredRatio({ fontSizePx: 19, bold: true }), 3);
    assert.equal(requiredRatio({ fontSizePx: 16, level: 'AAA' }), 7);
  });

  test('suggested colors actually meet the target ratio', () => {
    const suggestion = suggestAccessibleColor([170, 170, 170], [255, 255, 255], 4.5);
    assert.ok(suggestion, 'expected a suggestion');
    assert.ok(contrastRatio(suggestion, [255, 255, 255]) >= 4.5);
  });
});

describe('css engine', () => {
  test('matches simple, class, id and descendant selectors', () => {
    const doc = parseDocument('<html><body><div class="a"><p id="p1">hi</p></div></body></html>');
    const p = doc.byId.get('p1');
    assert.ok(matches(p, 'p'));
    assert.ok(matches(p, '#p1'));
    assert.ok(matches(p, '.a p'));
    assert.ok(matches(p, 'div > p'));
    assert.ok(!matches(p, 'span'));
    assert.ok(!matches(p, '.b p'));
  });

  test('respects specificity and inline style precedence', () => {
    const css = 'p { color: #111111; } .hi { color: #222222; } #p1 { color: #333333; }';
    const sheet = parseStylesheet(css);
    const doc = parseDocument('<html><body style="background-color:#ffffff"><p id="p1" class="hi">text</p></body></html>');
    const style = computeTextStyle(doc.byId.get('p1'), sheet);
    assert.equal(style.foreground.slice(0, 3).join(','), '51,51,51');
  });

  test('reports unresolved styles instead of guessing', () => {
    const sheet = parseStylesheet('p { color: var(--brand); }');
    const doc = parseDocument('<html><body><p>text</p></body></html>');
    const style = computeTextStyle(doc.byTag.get('p')[0], sheet);
    assert.equal(style.resolved, false);
    assert.ok(style.reason);
  });

  test('counts color rules it cannot model', () => {
    const sheet = parseStylesheet('a:hover { color: red; } [data-x] { background-color: blue; }');
    assert.ok(sheet.unsupported >= 2);
  });

  test('ignores print-only media blocks', () => {
    const sheet = parseStylesheet('@media print { p { color: #000; } }');
    assert.equal(sheet.rules.length, 0);
  });
});

describe('accessible name computation', () => {
  test('resolves label, aria-label and aria-labelledby', () => {
    const doc = parseDocument(`<html><body>
      <label for="a">Email</label><input id="a">
      <input id="b" aria-label="Search">
      <span id="lbl">Phone</span><input id="c" aria-labelledby="lbl">
      <button>Save</button>
    </body></html>`);
    assert.equal(accessibleName(doc.byId.get('a'), doc).name, 'Email');
    assert.equal(accessibleName(doc.byId.get('b'), doc).name, 'Search');
    assert.equal(accessibleName(doc.byId.get('c'), doc).name, 'Phone');
    assert.equal(accessibleName(doc.byTag.get('button')[0], doc).name, 'Save');
  });

  test('derives a link name from a nested image alt', () => {
    const doc = parseDocument('<html><body><a href="/x"><img src="i.png" alt="Home page"></a></body></html>');
    assert.equal(accessibleName(doc.byTag.get('a')[0], doc).name, 'Home page');
  });

  test('derives a name from a descendant aria-label', () => {
    // Regression: an icon button labelled via a nested <svg aria-label> was
    // wrongly reported as unnamed. Found by scanning w3.org/WAI.
    const doc = parseDocument(
      '<html><body><button class="icon"><span><svg focusable="false" aria-label="Submit search"><use href="#i"></use></svg></span></button></body></html>'
    );
    assert.equal(accessibleName(doc.byTag.get('button')[0], doc).name, 'Submit search');
  });

  test('derives a name from a nested svg title', () => {
    const doc = parseDocument('<html><body><button><svg><title>Close</title></svg></button></body></html>');
    assert.equal(accessibleName(doc.byTag.get('button')[0], doc).name, 'Close');
  });

  test('still reports genuinely unnamed icon controls', () => {
    const doc = parseDocument('<html><body><button class="icon"><span><svg><use href="#i"></use></svg></span></button></body></html>');
    assert.equal(accessibleName(doc.byTag.get('button')[0], doc).name, '');
  });
});

describe('scanning a page with known violations', () => {
  test('detects the critical naming failures', () => {
    const ids = ruleIds(broken);
    for (const expected of ['img-alt', 'button-name', 'link-name', 'input-label', 'frame-title']) {
      assert.ok(ids.has(expected), `expected rule ${expected} to fire`);
    }
  });

  test('detects structural and ARIA failures', () => {
    const ids = ruleIds(broken);
    for (const expected of [
      'html-has-lang', 'document-title', 'heading-order', 'empty-heading', 'duplicate-id',
      'list-structure', 'tabindex-positive', 'aria-valid-role', 'aria-valid-attr',
      'aria-required-attr', 'aria-hidden-focusable', 'meta-viewport-zoom', 'autoplay-media',
      'video-captions', 'landmark-main', 'landmark-unique', 'link-generic-text',
      'img-alt-placeholder', 'table-headers',
    ]) {
      assert.ok(ids.has(expected), `expected rule ${expected} to fire`);
    }
  });

  test('detects low contrast and suggests a passing replacement', () => {
    const contrast = findingsFor(broken, 'color-contrast');
    assert.ok(contrast.length >= 1, 'expected contrast findings');
    const withSuggestion = contrast.find((f) => f.data && f.data.suggestion);
    assert.ok(withSuggestion, 'expected at least one actionable contrast fix');
    assert.ok(withSuggestion.data.ratio < withSuggestion.data.required);
  });

  test('flags a removed focus outline', () => {
    assert.ok(ruleIds(broken).has('focus-not-obscured'));
  });

  test('records source line numbers for findings', () => {
    const imgAlt = findingsFor(broken, 'img-alt')[0];
    assert.ok(imgAlt.line > 0, 'findings must carry a source line for patching');
    assert.ok(imgAlt.snippet.includes('<img'));
    assert.ok(imgAlt.selector.length > 0);
  });

  test('produces a low score for a badly broken page', () => {
    assert.ok(broken.score < 40, `expected a low score, got ${broken.score}`);
  });
});

describe('avoiding false positives on an accessible page', () => {
  test('reports no definite failures', () => {
    const definite = clean.findings.filter((f) => f.confidence === 'definite');
    const detail = definite.map((f) => `${f.ruleId}: ${f.message}`).join('\n');
    assert.equal(definite.length, 0, `expected no definite findings, got:\n${detail}`);
  });

  test('scores highly', () => {
    assert.ok(clean.score >= 90, `expected a high score, got ${clean.score}`);
  });

  test('does not flag correctly labelled controls', () => {
    const ids = ruleIds(clean);
    for (const notExpected of ['img-alt', 'button-name', 'link-name', 'input-label', 'frame-title', 'html-has-lang', 'duplicate-id', 'meta-viewport-zoom']) {
      assert.ok(!ids.has(notExpected), `rule ${notExpected} should not fire on a clean page`);
    }
  });

  test('accepts an empty alt on a decorative image', () => {
    assert.equal(findingsFor(clean, 'img-alt').length, 0);
    assert.equal(findingsFor(clean, 'img-alt-placeholder').length, 0);
  });
});

describe('coverage honesty', () => {
  test('flags client-rendered pages instead of claiming a clean result', () => {
    assert.equal(shell.coverage.complete, false);
    assert.equal(shell.coverage.mode, 'client-rendered');
    assert.match(shell.coverage.note, /JavaScript/i);
  });

  test('treats a fully server-rendered page as complete', () => {
    assert.equal(clean.coverage.complete, true);
  });

  test('surfaces CSS it could not evaluate', () => {
    assert.ok(broken.cssCoverage.unsupportedColorRules >= 0);
  });
});

describe('scoring and signatures', () => {
  test('an empty finding list scores 100', () => {
    assert.equal(scoreFrom([]), 100);
  });

  test('review findings weigh less than definite ones', () => {
    const definite = scoreFrom([{ impact: 'critical', confidence: 'definite' }]);
    const review = scoreFrom([{ impact: 'critical', confidence: 'review' }]);
    assert.ok(review > definite);
  });

  test('advisory findings never move the score', () => {
    // Advisories are best-practice recommendations, not conformance failures.
    // If they ever affected the score, a clean site could be marked down for
    // stylistic preferences.
    const many = Array.from({ length: 50 }, () => ({ impact: 'critical', confidence: 'advisory' }));
    assert.equal(scoreFrom(many), 100);
  });

  test('an unknown confidence tier is scored conservatively, not ignored', () => {
    assert.ok(scoreFrom([{ impact: 'critical', confidence: 'nonsense' }]) < 100);
  });

  test('signatures are stable across content changes but unique per element', () => {
    const a = signatureFor({ ruleId: 'img-alt', url: 'https://x.com/a?q=1', selector: 'main > img' });
    const b = signatureFor({ ruleId: 'img-alt', url: 'https://x.com/a?q=2', selector: 'main > img' });
    const c = signatureFor({ ruleId: 'img-alt', url: 'https://x.com/a', selector: 'main > img:nth-of-type(2)' });
    assert.equal(a, b, 'query strings must not change identity');
    assert.notEqual(a, c, 'different elements must have different identities');
  });
});

describe('resilience', () => {
  test('handles malformed and empty HTML without throwing', () => {
    for (const html of ['', '<p>unclosed', '<div><span></div></span>', '<!DOCTYPE html><html>', '<table><tr><td>x']) {
      const result = analyzePage(html, { url: 'https://example.com/' });
      assert.ok(Array.isArray(result.findings));
    }
  });

  test('every finding carries the fields the UI and patcher depend on', () => {
    for (const finding of broken.findings) {
      assert.ok(finding.ruleId && finding.message && finding.signature, 'core fields present');
      assert.ok(['critical', 'serious', 'moderate', 'minor'].includes(finding.impact));
      assert.ok(['definite', 'review', 'advisory'].includes(finding.confidence));
      assert.ok(Array.isArray(finding.wcag) && finding.wcag.length > 0, `${finding.ruleId} must map to a WCAG criterion`);
    }
  });
});
