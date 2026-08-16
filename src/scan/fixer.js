import { RULES_BY_ID } from './rules.js';

/**
 * Turns findings into concrete source edits.
 *
 * Every patch is derived from exact byte offsets recorded during parsing, so an
 * edit either applies cleanly to the source we analyzed or is refused. We never
 * regenerate markup from the parse tree, because round-tripping a parser over
 * someone's template would reformat code they did not ask us to touch.
 */

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeAttr = (value) => String(value).replace(/[&<>"]/g, (c) => ESCAPE[c]);

function attributePattern(name) {
  // Matches ` name="value"`, ` name='value'`, ` name=value` and bare ` name`.
  return new RegExp(`\\s${name}(\\s*=\\s*("[^"]*"|'[^']*'|[^\\s"'>\`]+))?`, 'i');
}

function splitTag(tagSource) {
  const selfClosing = /\/>$/.test(tagSource);
  const end = selfClosing ? -2 : -1;
  return { head: tagSource.slice(0, end), tail: selfClosing ? ' />' : '>', selfClosing };
}

/** Insert or replace an attribute inside a raw opening-tag string. */
export function setAttribute(tagSource, name, value) {
  const pattern = attributePattern(name);
  const rendered = value === '' ? `${name}=""` : `${name}="${escapeAttr(value)}"`;

  if (pattern.test(tagSource)) {
    return tagSource.replace(pattern, ` ${rendered}`);
  }
  const { head, tail } = splitTag(tagSource);
  return `${head.replace(/\s+$/, '')} ${rendered}${tail}`;
}

export function removeAttribute(tagSource, name) {
  return tagSource.replace(attributePattern(name), '');
}

/**
 * Build the replacement text for a single finding.
 * Returns null when the strategy does not produce a source edit.
 */
export function buildEdit(html, finding) {
  const fix = finding.fix;
  if (!fix || !finding.offsets) return null;
  const { start, end, elementEnd } = finding.offsets;
  if (start == null || end == null) return null;

  const tagSource = html.slice(start, end);

  switch (fix.strategy) {
    case 'set-attribute': {
      // An empty value that needs human wording is not a mechanical fix.
      if (fix.value === '' && fix.confidence !== 'definite') return null;
      return { start, end, replacement: setAttribute(tagSource, fix.attribute, fix.value) };
    }

    case 'remove-attribute':
      return { start, end, replacement: removeAttribute(tagSource, fix.attribute) };

    case 'remove-element': {
      if (elementEnd == null) return null;
      return { start, end: elementEnd, replacement: '' };
    }

    case 'rename-tag': {
      if (elementEnd == null) return null;
      const whole = html.slice(start, elementEnd);
      const renamed = whole
        .replace(new RegExp(`^<${fix.from}\\b`, 'i'), `<${fix.to}`)
        .replace(new RegExp(`</${fix.from}\\s*>$`, 'i'), `</${fix.to}>`);
      return { start, end: elementEnd, replacement: renamed };
    }

    case 'insert-first-child': {
      // Insert immediately after the opening tag, preserving indentation.
      const following = html.slice(end, end + 200);
      const indentMatch = following.match(/^\n(\s*)/);
      const indent = indentMatch ? indentMatch[1] : '  ';
      return { start: end, end, replacement: `\n${indent}${fix.html}` };
    }

    // Contrast is fixed in a stylesheet, not in the element's markup.
    case 'css-color':
    case 'manual':
    default:
      return null;
  }
}

/** True when a finding can be repaired without a human writing any content. */
export function isMechanical(finding) {
  const fix = finding.fix;
  if (!fix) return false;
  if (fix.confidence !== 'definite') return false;
  return ['set-attribute', 'remove-attribute', 'remove-element'].includes(fix.strategy);
}

/**
 * Apply many fixes to one document. Edits are applied from the end of the file
 * backwards so that earlier offsets remain valid.
 */
export function applyFixes(html, findings) {
  const edits = [];
  const applied = [];
  const skipped = [];

  for (const finding of findings) {
    const edit = buildEdit(html, finding);
    if (!edit) {
      skipped.push({ finding, reason: finding.fix ? 'Requires human judgment' : 'No automatic fix available' });
      continue;
    }
    edits.push({ ...edit, finding });
  }

  // Drop overlapping edits rather than corrupting the document.
  edits.sort((a, b) => b.start - a.start);
  let lastStart = Infinity;
  let output = html;

  for (const edit of edits) {
    if (edit.end > lastStart) {
      skipped.push({ finding: edit.finding, reason: 'Overlaps another fix; will be resolved on the next scan' });
      continue;
    }
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
    lastStart = edit.start;
    applied.push(edit.finding);
  }

  return { html: output, applied, skipped };
}

/* ------------------------------------------------------------------ *
 * Diff rendering
 * ------------------------------------------------------------------ */

/** Minimal line-based unified diff, sufficient for reviewing small edits. */
export function unifiedDiff(before, after, { filename = 'page.html', context = 3 } = {}) {
  const a = before.split('\n');
  const b = after.split('\n');

  // Longest common subsequence over lines, with a guard for large inputs.
  const max = 4000;
  if (a.length > max || b.length > max) {
    return `--- a/${filename}\n+++ b/${filename}\n@@ file too large to diff inline @@`;
  }

  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { ops.push({ type: ' ', line: a[i] }); i += 1; j += 1; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { ops.push({ type: '-', line: a[i] }); i += 1; }
    else { ops.push({ type: '+', line: b[j] }); j += 1; }
  }
  while (i < a.length) { ops.push({ type: '-', line: a[i] }); i += 1; }
  while (j < b.length) { ops.push({ type: '+', line: b[j] }); j += 1; }

  // Emit only hunks around changes.
  const changed = ops.map((op, index) => (op.type === ' ' ? -1 : index)).filter((index) => index >= 0);
  if (!changed.length) return '';

  const hunks = [];
  let currentHunk = null;
  for (const index of changed) {
    const from = Math.max(0, index - context);
    const to = Math.min(ops.length - 1, index + context);
    if (currentHunk && from <= currentHunk.to + 1) {
      currentHunk.to = Math.max(currentHunk.to, to);
    } else {
      currentHunk = { from, to };
      hunks.push(currentHunk);
    }
  }

  let out = `--- a/${filename}\n+++ b/${filename}\n`;
  for (const hunk of hunks) {
    let aStart = 1;
    let bStart = 1;
    for (let k = 0; k < hunk.from; k += 1) {
      if (ops[k].type !== '+') aStart += 1;
      if (ops[k].type !== '-') bStart += 1;
    }
    const aCount = ops.slice(hunk.from, hunk.to + 1).filter((o) => o.type !== '+').length;
    const bCount = ops.slice(hunk.from, hunk.to + 1).filter((o) => o.type !== '-').length;
    out += `@@ -${aStart},${aCount} +${bStart},${bCount} @@\n`;
    for (let k = hunk.from; k <= hunk.to; k += 1) {
      out += `${ops[k].type}${ops[k].line}\n`;
    }
  }
  return out;
}

/**
 * Produce a reviewable remediation plan for one page: the patched source, a
 * unified diff, and an explicit list of what still needs a person.
 */
export function buildRemediationPlan(html, findings, { filename = 'page.html' } = {}) {
  const mechanical = findings.filter(isMechanical);
  const { html: patched, applied, skipped } = applyFixes(html, mechanical);

  const manual = findings
    .filter((f) => !applied.includes(f))
    .map((finding) => ({
      finding,
      guidance: finding.fix?.guidance || RULES_BY_ID.get(finding.ruleId)?.why || 'Requires manual review.',
      strategy: finding.fix?.strategy || 'manual',
    }));

  // Contrast fixes ship as a stylesheet snippet rather than markup edits.
  const cssFixes = findings
    .filter((f) => f.fix?.strategy === 'css-color' && f.data?.suggestion)
    .map((f) => ({
      selector: f.selector,
      from: f.data.foreground,
      to: f.data.suggestion,
      background: f.data.background,
      ratio: f.data.ratio,
      required: f.data.required,
    }));

  const cssSnippet = cssFixes.length
    ? [
        '/* Curbcut contrast remediation.',
        '   Review against your brand palette before shipping. */',
        ...dedupeCss(cssFixes).map(
          ({ selector, to, from, background }) =>
            `${selector} {\n  color: ${to}; /* was ${from} on ${background} */\n}`
        ),
      ].join('\n')
    : null;

  return {
    filename,
    original: html,
    patched,
    diff: applied.length ? unifiedDiff(html, patched, { filename }) : '',
    applied,
    skipped,
    manual,
    cssSnippet,
    counts: {
      total: findings.length,
      automatic: applied.length,
      manual: manual.length,
    },
  };
}

function dedupeCss(fixes) {
  const seen = new Set();
  const out = [];
  for (const fix of fixes) {
    const key = `${fix.selector}|${fix.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fix);
  }
  return out;
}

export default buildRemediationPlan;
