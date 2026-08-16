/**
 * WCAG 2.1 Level A and AA success criteria.
 *
 * `automatable` records how much of a criterion a machine can actually decide.
 * This is the honest core of our reporting: roughly a third of WCAG can be
 * tested automatically, and any vendor claiming otherwise is overstating what
 * software can do. Criteria we cannot test are reported as "Not Evaluated"
 * rather than quietly passed.
 */

export const CRITERIA = [
  // Perceivable
  { id: '1.1.1', level: 'A', name: 'Non-text Content', automatable: 'partial', rules: ['img-alt', 'img-alt-placeholder', 'svg-name', 'object-no-fallback', 'duplicate-alt-adjacent'] },
  { id: '1.2.1', level: 'A', name: 'Audio-only and Video-only (Prerecorded)', automatable: 'partial', rules: ['audio-no-transcript'] },
  { id: '1.2.2', level: 'A', name: 'Captions (Prerecorded)', automatable: 'partial', rules: ['video-captions'] },
  { id: '1.2.3', level: 'A', name: 'Audio Description or Media Alternative', automatable: 'none', rules: [] },
  { id: '1.2.4', level: 'AA', name: 'Captions (Live)', automatable: 'none', rules: [] },
  { id: '1.2.5', level: 'AA', name: 'Audio Description (Prerecorded)', automatable: 'partial', rules: ['video-no-audio-description'] },
  { id: '1.3.1', level: 'A', name: 'Info and Relationships', automatable: 'partial', rules: ['input-label', 'heading-order', 'empty-heading', 'list-structure', 'table-headers', 'landmark-main', 'landmark-unique', 'label-orphan', 'page-has-h1', 'aria-hidden-focusable', 'fieldset-legend-missing', 'label-empty', 'main-multiple', 'landmark-nesting', 'h1-multiple', 'definition-list-structure', 'th-scope-missing', 'aria-describedby-orphan'] },
  { id: '1.3.2', level: 'A', name: 'Meaningful Sequence', automatable: 'none', rules: [] },
  { id: '1.3.3', level: 'A', name: 'Sensory Characteristics', automatable: 'none', rules: [] },
  { id: '1.3.4', level: 'AA', name: 'Orientation', automatable: 'none', rules: [] },
  { id: '1.3.5', level: 'AA', name: 'Identify Input Purpose', automatable: 'partial', rules: ['autocomplete-missing', 'autocomplete-invalid'] },
  { id: '1.4.1', level: 'A', name: 'Use of Color', automatable: 'none', rules: [] },
  { id: '1.4.2', level: 'A', name: 'Audio Control', automatable: 'partial', rules: ['autoplay-media'] },
  { id: '1.4.3', level: 'AA', name: 'Contrast (Minimum)', automatable: 'partial', rules: ['color-contrast'] },
  { id: '1.4.4', level: 'AA', name: 'Resize Text', automatable: 'partial', rules: ['meta-viewport-zoom'] },
  { id: '1.4.5', level: 'AA', name: 'Images of Text', automatable: 'none', rules: [] },
  { id: '1.4.10', level: 'AA', name: 'Reflow', automatable: 'partial', rules: ['viewport-missing', 'horizontal-scroll'] },
  { id: '1.4.11', level: 'AA', name: 'Non-text Contrast', automatable: 'none', rules: [] },
  { id: '1.4.12', level: 'AA', name: 'Text Spacing', automatable: 'none', rules: [] },
  { id: '1.4.13', level: 'AA', name: 'Content on Hover or Focus', automatable: 'none', rules: [] },

  // Operable
  { id: '2.1.1', level: 'A', name: 'Keyboard', automatable: 'partial', rules: ['aria-hidden-focusable', 'nested-interactive', 'click-handler-no-keyboard', 'interactive-role-not-focusable', 'accesskey-duplicate', 'link-empty-href', 'iframe-negative-tabindex'] },
  { id: '2.1.2', level: 'A', name: 'No Keyboard Trap', automatable: 'none', rules: [] },
  { id: '2.1.4', level: 'A', name: 'Character Key Shortcuts', automatable: 'none', rules: [] },
  { id: '2.2.1', level: 'A', name: 'Timing Adjustable', automatable: 'partial', rules: ['meta-refresh'] },
  { id: '2.2.2', level: 'A', name: 'Pause, Stop, Hide', automatable: 'partial', rules: ['blink-marquee'] },
  { id: '2.3.1', level: 'A', name: 'Three Flashes or Below Threshold', automatable: 'none', rules: [] },
  { id: '2.4.1', level: 'A', name: 'Bypass Blocks', automatable: 'partial', rules: ['skip-link', 'landmark-main', 'skip-link-target-missing'] },
  { id: '2.4.2', level: 'A', name: 'Page Titled', automatable: 'full', rules: ['document-title'] },
  { id: '2.4.3', level: 'A', name: 'Focus Order', automatable: 'partial', rules: ['tabindex-positive'] },
  { id: '2.4.4', level: 'A', name: 'Link Purpose (In Context)', automatable: 'partial', rules: ['link-name', 'link-generic-text', 'link-same-name-different-target', 'link-url-as-text'] },
  { id: '2.4.5', level: 'AA', name: 'Multiple Ways', automatable: 'none', rules: [] },
  { id: '2.4.6', level: 'AA', name: 'Headings and Labels', automatable: 'partial', rules: ['page-has-h1', 'empty-heading'] },
  { id: '2.4.7', level: 'AA', name: 'Focus Visible', automatable: 'partial', rules: ['focus-not-obscured'] },
  { id: '2.5.1', level: 'A', name: 'Pointer Gestures', automatable: 'none', rules: [] },
  { id: '2.5.2', level: 'A', name: 'Pointer Cancellation', automatable: 'none', rules: [] },
  { id: '2.5.3', level: 'A', name: 'Label in Name', automatable: 'partial', rules: [] },
  { id: '2.5.4', level: 'A', name: 'Motion Actuation', automatable: 'none', rules: [] },

  // Understandable
  { id: '3.1.1', level: 'A', name: 'Language of Page', automatable: 'full', rules: ['html-has-lang', 'html-lang-valid'] },
  { id: '3.1.2', level: 'AA', name: 'Language of Parts', automatable: 'partial', rules: [] },
  { id: '3.2.1', level: 'A', name: 'On Focus', automatable: 'none', rules: [] },
  { id: '3.2.2', level: 'A', name: 'On Input', automatable: 'partial', rules: ['button-type-missing', 'new-window-no-warning'] },
  { id: '3.2.3', level: 'AA', name: 'Consistent Navigation', automatable: 'none', rules: [] },
  { id: '3.2.4', level: 'AA', name: 'Consistent Identification', automatable: 'none', rules: [] },
  { id: '3.3.1', level: 'A', name: 'Error Identification', automatable: 'none', rules: [] },
  { id: '3.3.2', level: 'A', name: 'Labels or Instructions', automatable: 'partial', rules: ['input-label', 'fieldset-legend-missing', 'label-empty'] },
  { id: '3.3.3', level: 'AA', name: 'Error Suggestion', automatable: 'none', rules: [] },
  { id: '3.3.4', level: 'AA', name: 'Error Prevention (Legal, Financial, Data)', automatable: 'none', rules: [] },

  // Robust
  { id: '4.1.1', level: 'A', name: 'Parsing (obsolete in WCAG 2.2)', automatable: 'partial', rules: ['duplicate-id', 'id-invalid'] },
  { id: '4.1.2', level: 'A', name: 'Name, Role, Value', automatable: 'partial', rules: ['button-name', 'link-name', 'input-label', 'frame-title', 'aria-valid-role', 'aria-valid-attr', 'aria-required-attr', 'nested-interactive', 'aria-hidden-focusable', 'aria-boolean-invalid', 'aria-presentation-on-interactive', 'aria-redundant-role', 'title-attribute-as-label', 'interactive-role-not-focusable', 'aria-describedby-orphan'] },
  { id: '4.1.3', level: 'AA', name: 'Status Messages', automatable: 'partial', rules: ['aria-live-invalid'] },
];

export const CRITERIA_BY_ID = new Map(CRITERIA.map((c) => [c.id, c]));

export function coverageStats() {
  const total = CRITERIA.length;
  const full = CRITERIA.filter((c) => c.automatable === 'full').length;
  const partial = CRITERIA.filter((c) => c.automatable === 'partial').length;
  const none = CRITERIA.filter((c) => c.automatable === 'none').length;
  return {
    total, full, partial, none,
    testedCount: full + partial,
    testedPercent: Math.round(((full + partial) / total) * 100),
  };
}

/**
 * Derive a VPAT conformance level for each criterion from scan results.
 *
 * "Supports" is only ever claimed for criteria we can fully automate. Anything
 * partially automatable with no findings becomes "Needs manual review", which is
 * the truthful answer and the reason a human-verified tier exists.
 */
export function evaluateCriteria(findings) {
  const byRule = new Map();
  for (const finding of findings) {
    if (!byRule.has(finding.rule_id)) byRule.set(finding.rule_id, []);
    byRule.get(finding.rule_id).push(finding);
  }

  return CRITERIA.map((criterion) => {
    const hits = criterion.rules.flatMap((ruleId) => byRule.get(ruleId) || []);
    const definite = hits.filter((h) => h.confidence === 'definite');
    // Advisory findings are best-practice recommendations, not conformance
    // failures. They are deliberately excluded from both buckets so they can
    // never downgrade a criterion in a report a customer sends to a buyer.
    const review = hits.filter((h) => h.confidence === 'review');

    let conformance;
    let remarks;

    if (criterion.automatable === 'none') {
      conformance = 'Not Evaluated';
      remarks = 'This criterion cannot be evaluated by automated testing. A manual review is required.';
    } else if (definite.length > 0) {
      conformance = 'Does Not Support';
      remarks = `${definite.length} confirmed failure${definite.length === 1 ? '' : 's'} detected by automated testing.`;
    } else if (review.length > 0) {
      conformance = 'Partially Supports';
      remarks = `${review.length} potential issue${review.length === 1 ? '' : 's'} require manual confirmation.`;
    } else if (criterion.automatable === 'full') {
      conformance = 'Supports';
      remarks = 'No failures detected. This criterion is fully testable by automation.';
    } else {
      conformance = 'Needs Manual Review';
      remarks = 'No automated failures detected, but this criterion is only partially testable by automation.';
    }

    return { ...criterion, conformance, remarks, failureCount: definite.length, reviewCount: review.length };
  });
}

export default CRITERIA;
