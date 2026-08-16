import {
  attr, hasAttr, tagName, isElement, isText, walk, textContent, children,
  isHiddenDeep, isFocusable, accessibleName, elementsByTag, ancestor, closestRole, implicitRole,
  cssPath as cssPathOf,
} from '../lib/html.js';

/**
 * Second-tier rules: deeper coverage of keyboard operability, ARIA reference
 * integrity, form semantics and structural correctness.
 *
 * A third confidence tier appears here. `advisory` findings are real, actionable
 * quality problems that are not themselves WCAG failures. They never affect the
 * score and never enter a conformance document — they exist so a team gets a
 * useful list even when the page has no outright failures. That is the honest
 * way to be thorough: surface more real issues, never invent one.
 */

const DEFINITE = 'definite';
const REVIEW = 'review';
const ADVISORY = 'advisory';

function visible(doc, ...tags) {
  return elementsByTag(doc, ...tags).filter((el) => !isHiddenDeep(el));
}

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'option', 'switch', 'tab', 'textbox', 'combobox', 'slider', 'spinbutton', 'searchbox', 'treeitem',
]);

const NATIVE_INTERACTIVE = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'details', 'label', 'option']);

const BOOLEAN_ARIA = ['aria-expanded', 'aria-pressed', 'aria-checked', 'aria-selected', 'aria-hidden', 'aria-disabled', 'aria-required', 'aria-readonly', 'aria-multiline', 'aria-atomic', 'aria-busy', 'aria-modal'];

// Fields that collect information about the user, per WCAG 1.3.5.
const PERSONAL_FIELD = /^(name|fname|lname|firstname|lastname|full[-_]?name|email|e[-_]?mail|tel|phone|mobile|address|street|city|state|zip|postal|country|cc|card|credit|username|organization|company|bday|birthday)/i;

const VALID_AUTOCOMPLETE = new Set([
  'on', 'off', 'name', 'honorific-prefix', 'given-name', 'additional-name', 'family-name',
  'honorific-suffix', 'nickname', 'username', 'new-password', 'current-password', 'one-time-code',
  'organization-title', 'organization', 'street-address', 'address-line1', 'address-line2',
  'address-line3', 'address-level4', 'address-level3', 'address-level2', 'address-level1',
  'country', 'country-name', 'postal-code', 'cc-name', 'cc-given-name', 'cc-additional-name',
  'cc-family-name', 'cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc', 'cc-type',
  'transaction-currency', 'transaction-amount', 'language', 'bday', 'bday-day', 'bday-month',
  'bday-year', 'sex', 'url', 'photo', 'tel', 'tel-country-code', 'tel-national', 'tel-area-code',
  'tel-local', 'tel-extension', 'email', 'impp',
]);

export const ADVANCED_RULES = [
  /* ========= Rules that require real browser measurement ========= */
  {
    id: 'target-size-minimum',
    wcag: ['2.5.8'], level: 'AA',
    impact: 'moderate',
    title: 'Touch targets must be large enough',
    why: 'Controls smaller than 24 by 24 CSS pixels are hard to hit accurately for people with tremors, limited dexterity, or anyone using a phone one-handed. WCAG 2.2 sets 24px as the floor.',
    run(doc, ctx) {
      // Only meaningful with real geometry; inferring size from CSS is guesswork.
      if (!ctx.computed) return [];
      const out = [];
      const seen = new Set();

      for (const el of doc.elements) {
        if (isHiddenDeep(el)) continue;
        const entry = ctx.computed[cssPathOf(el)];
        if (!entry || !entry.interactive || !entry.visible) continue;

        const { width, height } = entry;
        if (width >= 24 && height >= 24) continue;
        // Inline links inside a paragraph are explicitly exempt.
        if (tagName(el) === 'a' && entry.display === 'inline') continue;

        const key = `${Math.round(width)}x${Math.round(height)}|${tagName(el)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        out.push({
          node: el,
          confidence: DEFINITE,
          message: `Control measures ${width}×${height}px, below the 24×24px minimum.`,
          data: { width, height },
          fix: {
            strategy: 'manual',
            confidence: REVIEW,
            guidance: 'Increase the control to at least 24×24px, or add padding. Spacing between adjacent targets can also satisfy this criterion.',
          },
        });
      }
      return out;
    },
  },

  {
    id: 'horizontal-scroll',
    wcag: ['1.4.10'], level: 'AA',
    impact: 'serious',
    title: 'Content must not scroll horizontally',
    why: 'Horizontal scrolling at normal widths signals a fixed-width layout that will not reflow. At 320px, which Level AA requires, the page becomes unusable for low-vision users who zoom.',
    run(doc, ctx) {
      if (!ctx.layout) return [];
      const { scrollWidth, clientWidth } = ctx.layout;
      // A small overshoot is usually a scrollbar rounding artifact.
      if (!scrollWidth || !clientWidth || scrollWidth <= clientWidth + 4) return [];
      const body = doc.byTag.get('body')?.[0];
      if (!body) return [];
      return [{
        node: body,
        confidence: DEFINITE,
        message: `Page content is ${scrollWidth}px wide in a ${clientWidth}px viewport, forcing horizontal scrolling.`,
        fix: {
          strategy: 'manual',
          confidence: REVIEW,
          guidance: 'Find the element wider than the viewport — often a fixed-width table, image or pre block — and allow it to shrink or scroll within its own container.',
        },
      }];
    },
  },

  /* ================= Keyboard operability (WCAG 2.1.1) ================= */
  {
    id: 'click-handler-no-keyboard',
    wcag: ['2.1.1'], level: 'A', section508: ['502.3.1'],
    impact: 'critical',
    title: 'Clickable elements must work with a keyboard',
    why: 'A div or span with a click handler cannot be reached by Tab and cannot be activated by Enter or Space. Keyboard and screen reader users simply cannot use it. This is one of the most common ways a modern JavaScript interface locks people out.',
    run(doc) {
      const out = [];
      for (const el of doc.elements) {
        if (isHiddenDeep(el)) continue;
        if (!hasAttr(el, 'onclick')) continue;
        const tag = tagName(el);
        if (NATIVE_INTERACTIVE.has(tag)) continue;
        if (isFocusable(el)) continue;
        const role = (attr(el, 'role') || '').toLowerCase();
        if (INTERACTIVE_ROLES.has(role) && hasAttr(el, 'tabindex')) continue;
        out.push({
          node: el,
          confidence: DEFINITE,
          message: `<${tag}> has a click handler but cannot receive keyboard focus.`,
          fix: {
            strategy: 'manual',
            confidence: REVIEW,
            guidance: 'Use a <button> element. If that is not possible, add role="button", tabindex="0", and a keydown handler for Enter and Space.',
          },
        });
      }
      return out;
    },
  },

  {
    id: 'interactive-role-not-focusable',
    wcag: ['2.1.1', '4.1.2'], level: 'A',
    impact: 'critical',
    title: 'Elements with interactive roles must be focusable',
    why: 'Declaring role="button" tells a screen reader the element is a button, but without tabindex a keyboard user can never reach it. The promise the role makes is not kept.',
    run(doc) {
      const out = [];
      for (const el of doc.elements) {
        if (isHiddenDeep(el)) continue;
        const role = (attr(el, 'role') || '').toLowerCase();
        if (!INTERACTIVE_ROLES.has(role)) continue;
        if (NATIVE_INTERACTIVE.has(tagName(el))) continue;
        if (isFocusable(el)) continue;
        if (hasAttr(el, 'aria-disabled') && attr(el, 'aria-disabled') === 'true') continue;
        out.push({
          node: el,
          confidence: DEFINITE,
          message: `role="${role}" is set but the element cannot receive keyboard focus.`,
          fix: {
            strategy: 'set-attribute', attribute: 'tabindex', value: '0',
            confidence: REVIEW,
            guidance: 'Add tabindex="0" so keyboard users can reach it, and make sure Enter and Space activate it.',
          },
        });
      }
      return out;
    },
  },

  {
    id: 'skip-link-target-missing',
    wcag: ['2.4.1'], level: 'A',
    impact: 'serious',
    title: 'Skip link must point at a real target',
    why: 'A skip link whose target does not exist silently does nothing. Keyboard users press it, focus stays put, and they still have to tab through the whole navigation.',
    run(doc) {
      const out = [];
      for (const link of visible(doc, 'a')) {
        const href = attr(link, 'href') || '';
        if (!href.startsWith('#') || href === '#') continue;
        const text = textContent(link).toLowerCase();
        if (!/skip|jump/.test(text)) continue;
        const targetId = href.slice(1);
        if (doc.byId.has(targetId)) continue;
        if (doc.elements.some((el) => attr(el, 'name') === targetId)) continue;
        out.push({
          node: link,
          confidence: DEFINITE,
          message: `Skip link points to "#${targetId}", which does not exist on this page.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: `Add id="${targetId}" to the main content container, or correct the link.` },
        });
      }
      return out;
    },
  },

  {
    id: 'accesskey-duplicate',
    wcag: ['2.1.1'], level: 'A',
    impact: 'minor',
    title: 'Access keys must be unique',
    why: 'Duplicate access keys make the shortcut ambiguous, so it works unpredictably or not at all.',
    run(doc) {
      const out = [];
      const seen = new Map();
      for (const el of doc.elements) {
        const key = attr(el, 'accesskey');
        if (!key) continue;
        const normalized = key.trim().toLowerCase();
        if (seen.has(normalized)) {
          out.push({
            node: el,
            confidence: DEFINITE,
            key: normalized,
            message: `Access key "${normalized}" is used more than once on this page.`,
            fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Give each access key a unique value, or remove them.' },
          });
        } else {
          seen.set(normalized, el);
        }
      }
      return out;
    },
  },

  /* ================= ARIA reference integrity ================= */
  {
    id: 'aria-describedby-orphan',
    wcag: ['1.3.1', '4.1.2'], level: 'A',
    impact: 'serious',
    title: 'aria-describedby must reference an existing element',
    why: 'A dangling reference means the description is never announced. The author believes the field has help text; the screen reader user hears nothing.',
    run(doc) {
      const out = [];
      for (const el of doc.elements) {
        for (const attribute of ['aria-describedby', 'aria-labelledby', 'aria-controls', 'aria-owns', 'aria-errormessage', 'aria-details']) {
          const value = attr(el, attribute);
          if (!value || !value.trim()) continue;
          const missing = value.trim().split(/\s+/).filter((id) => !doc.byId.has(id));
          if (!missing.length) continue;
          out.push({
            node: el,
            confidence: DEFINITE,
            key: attribute,
            message: `${attribute} references ${missing.length === 1 ? 'an id that does not exist' : 'ids that do not exist'}: ${missing.join(', ')}.`,
            fix: { strategy: 'manual', confidence: REVIEW, guidance: `Point ${attribute} at an element that exists, or remove the attribute.` },
          });
        }
      }
      return out;
    },
  },

  {
    id: 'aria-boolean-invalid',
    wcag: ['4.1.2'], level: 'A',
    impact: 'serious',
    title: 'ARIA state attributes must use valid values',
    why: 'An invalid value is ignored, so the control reports the wrong state or no state at all. A collapsed menu can be announced as expanded.',
    run(doc) {
      const out = [];
      const allowed = {
        'aria-checked': ['true', 'false', 'mixed', 'undefined'],
        'aria-pressed': ['true', 'false', 'mixed', 'undefined'],
      };
      for (const el of doc.elements) {
        for (const name of BOOLEAN_ARIA) {
          const value = attr(el, name);
          if (value === null) continue;
          const permitted = allowed[name] || ['true', 'false'];
          if (permitted.includes(value.trim().toLowerCase())) continue;
          out.push({
            node: el,
            confidence: DEFINITE,
            key: name,
            message: `${name}="${value.slice(0, 30)}" is not valid. Expected ${permitted.join(' or ')}.`,
            fix: { strategy: 'manual', confidence: REVIEW, guidance: `Set ${name} to one of: ${permitted.join(', ')}.` },
          });
        }
      }
      return out;
    },
  },

  {
    id: 'aria-live-invalid',
    wcag: ['4.1.3'], level: 'AA',
    impact: 'moderate',
    title: 'aria-live must use a valid politeness value',
    why: 'An invalid value disables the live region entirely, so status updates are never announced.',
    run(doc) {
      const out = [];
      for (const el of doc.elements) {
        const value = attr(el, 'aria-live');
        if (value === null) continue;
        if (['off', 'polite', 'assertive'].includes(value.trim().toLowerCase())) continue;
        out.push({
          node: el,
          confidence: DEFINITE,
          message: `aria-live="${value.slice(0, 30)}" is not valid. Expected off, polite, or assertive.`,
          fix: { strategy: 'set-attribute', attribute: 'aria-live', value: 'polite', confidence: REVIEW, guidance: 'Use "polite" for most status updates; "assertive" interrupts the user and should be rare.' },
        });
      }
      return out;
    },
  },

  {
    id: 'aria-presentation-on-interactive',
    wcag: ['4.1.2'], level: 'A',
    impact: 'serious',
    title: 'Interactive elements must not be given a presentation role',
    why: 'role="presentation" strips the semantics from a control that a keyboard user can still focus. They land on something the screen reader refuses to describe.',
    run(doc) {
      const out = [];
      for (const el of doc.elements) {
        const role = (attr(el, 'role') || '').toLowerCase();
        if (role !== 'presentation' && role !== 'none') continue;
        if (!isFocusable(el)) continue;
        out.push({
          node: el,
          confidence: DEFINITE,
          message: `role="${role}" is applied to a focusable <${tagName(el)}>.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Remove the presentation role, or make the element unfocusable if it is genuinely decorative.' },
        });
      }
      return out;
    },
  },

  {
    id: 'aria-redundant-role',
    wcag: ['4.1.2'], level: 'A',
    impact: 'minor',
    title: 'Redundant ARIA roles can be removed',
    why: 'Setting role="button" on a <button> adds nothing and is a common sign that ARIA is being applied without a clear reason. Native semantics are more reliable than ARIA.',
    run(doc) {
      const out = [];
      for (const el of doc.elements) {
        const explicit = (attr(el, 'role') || '').trim().toLowerCase();
        if (!explicit) continue;
        const implicit = implicitRole(el);
        if (!implicit || implicit !== explicit) continue;
        out.push({
          node: el,
          confidence: ADVISORY,
          message: `role="${explicit}" duplicates the native semantics of <${tagName(el)}>.`,
          fix: { strategy: 'remove-attribute', attribute: 'role', confidence: REVIEW, guidance: 'The native element already exposes this role. Removing the attribute is safe.' },
        });
      }
      return out;
    },
  },

  /* ================= Forms ================= */
  {
    id: 'autocomplete-missing',
    wcag: ['1.3.5'], level: 'AA',
    impact: 'moderate',
    title: 'Identify the purpose of personal-data inputs',
    why: 'WCAG 2.1 requires fields collecting the user\'s own information to declare their purpose, so browsers and assistive technology can autofill them. This matters most for people with motor or cognitive disabilities, for whom typing an address is genuinely costly.',
    run(doc) {
      const out = [];
      for (const field of visible(doc, 'input')) {
        const type = (attr(field, 'type') || 'text').toLowerCase();
        if (['hidden', 'submit', 'button', 'reset', 'image', 'checkbox', 'radio', 'file', 'range', 'search'].includes(type)) continue;
        if (hasAttr(field, 'autocomplete')) continue;
        const identifier = `${attr(field, 'name') || ''} ${attr(field, 'id') || ''}`;
        const looksPersonal = type === 'email' || type === 'tel' || PERSONAL_FIELD.test(identifier.trim());
        if (!looksPersonal) continue;
        out.push({
          node: field,
          // Advisory: only fields collecting the *user's own* data are in scope,
          // and that requires knowing the form's intent.
          confidence: ADVISORY,
          message: `Field "${(attr(field, 'name') || attr(field, 'id') || type).slice(0, 40)}" may collect personal data but has no autocomplete attribute.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'If this field collects information about the user, add the matching autocomplete token (for example autocomplete="email" or "given-name").' },
        });
      }
      return out;
    },
  },

  {
    id: 'autocomplete-invalid',
    wcag: ['1.3.5'], level: 'AA',
    impact: 'moderate',
    title: 'Autocomplete values must be valid tokens',
    why: 'An unrecognised token is ignored by browsers, so autofill silently stops working.',
    run(doc) {
      const out = [];
      for (const field of visible(doc, 'input', 'select', 'textarea')) {
        const value = attr(field, 'autocomplete');
        if (!value || !value.trim()) continue;
        const tokens = value.trim().toLowerCase().split(/\s+/);
        const meaningful = tokens.filter((t) => !t.startsWith('section-') && !['shipping', 'billing', 'home', 'work', 'mobile', 'fax', 'pager'].includes(t));
        const invalid = meaningful.filter((t) => !VALID_AUTOCOMPLETE.has(t));
        if (!invalid.length) continue;
        out.push({
          node: field,
          confidence: DEFINITE,
          message: `Invalid autocomplete token: "${invalid.join(', ').slice(0, 40)}".`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Use a token from the HTML autofill specification, such as "email", "tel" or "street-address".' },
        });
      }
      return out;
    },
  },

  {
    id: 'fieldset-legend-missing',
    wcag: ['1.3.1', '3.3.2'], level: 'A',
    impact: 'serious',
    title: 'Radio and checkbox groups need a group label',
    why: 'Each radio button has its own label, but nothing tells a screen reader user what the group as a whole is asking. They hear "Yes" and "No" with no question.',
    run(doc) {
      const out = [];
      const groups = new Map();
      for (const input of visible(doc, 'input')) {
        const type = (attr(input, 'type') || '').toLowerCase();
        if (type !== 'radio' && type !== 'checkbox') continue;
        const name = attr(input, 'name');
        if (!name) continue;
        const groupKey = `${type}:${name}`;
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(input);
      }
      for (const [groupKey, inputs] of groups) {
        if (inputs.length < 2) continue;
        const first = inputs[0];
        const fieldset = ancestor(first, (a) => tagName(a) === 'fieldset');
        if (fieldset) {
          const legend = children(fieldset).find((c) => isElement(c) && tagName(c) === 'legend');
          if (legend && textContent(legend)) continue;
        }
        const group = ancestor(first, (a) => ['group', 'radiogroup'].includes((attr(a, 'role') || '').toLowerCase()));
        if (group && accessibleName(group, doc).name) continue;
        out.push({
          node: fieldset || first,
          confidence: REVIEW,
          key: groupKey,
          message: `The "${groupKey.split(':')[1]}" group of ${inputs.length} ${groupKey.split(':')[0]}s has no group label.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Wrap the group in a <fieldset> with a <legend>, or use role="group" with an aria-label.' },
        });
      }
      return out;
    },
  },

  {
    id: 'label-empty',
    wcag: ['1.3.1', '3.3.2'], level: 'A',
    impact: 'serious',
    title: 'Labels must contain text',
    why: 'An empty label element satisfies a naive checker while telling the user nothing.',
    run(doc) {
      const out = [];
      for (const label of visible(doc, 'label')) {
        if (textContent(label, { includeHidden: true })) continue;
        if (attr(label, 'aria-label')) continue;
        out.push({
          node: label,
          confidence: DEFINITE,
          message: 'Label element contains no text.',
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Add descriptive text, or remove the empty label.' },
        });
      }
      return out;
    },
  },

  {
    id: 'button-type-missing',
    wcag: ['3.2.2'], level: 'A',
    impact: 'minor',
    title: 'Buttons inside forms should declare a type',
    why: 'A button with no type defaults to submit. A button meant to do something else will submit the form instead, which is a real and confusing failure for anyone operating the page by keyboard.',
    run(doc) {
      const out = [];
      for (const button of visible(doc, 'button')) {
        if (hasAttr(button, 'type')) continue;
        if (!ancestor(button, (a) => tagName(a) === 'form')) continue;
        out.push({
          node: button,
          confidence: ADVISORY,
          message: 'Button inside a form has no type attribute and will default to submit.',
          fix: {
            strategy: 'set-attribute', attribute: 'type', value: 'button',
            confidence: REVIEW,
            guidance: 'Set type="submit" if this button submits the form, or type="button" if it does not.',
          },
        });
      }
      return out;
    },
  },

  /* ================= Links ================= */
  {
    id: 'link-same-name-different-target',
    wcag: ['2.4.4'], level: 'A',
    impact: 'moderate',
    title: 'Links with the same text should go to the same place',
    why: 'Screen reader users often browse a list of links out of context. Three links all called "Learn more" that go to different pages are indistinguishable in that list.',
    run(doc) {
      const out = [];
      const byName = new Map();
      for (const link of visible(doc, 'a')) {
        if (!hasAttr(link, 'href')) continue;
        const { name } = accessibleName(link, doc);
        const normalized = name.trim().toLowerCase();
        if (!normalized || normalized.length < 3) continue;
        const href = (attr(link, 'href') || '').split('#')[0];
        if (!byName.has(normalized)) byName.set(normalized, new Map());
        if (!byName.get(normalized).has(href)) byName.get(normalized).set(href, link);
      }
      for (const [name, targets] of byName) {
        if (targets.size < 2) continue;
        const [, firstLink] = [...targets][0];
        out.push({
          node: firstLink,
          confidence: REVIEW,
          key: name,
          message: `${targets.size} links share the text "${name.slice(0, 40)}" but point to different destinations.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Make the link text distinct, or add an aria-label that names each destination.' },
        });
      }
      return out;
    },
  },

  {
    id: 'link-empty-href',
    wcag: ['2.1.1', '4.1.2'], level: 'A',
    impact: 'moderate',
    title: 'Placeholder links should be buttons',
    why: 'An anchor with href="#" or javascript:void(0) is announced as a link but behaves as a control. Screen reader users are told it navigates somewhere when it does not.',
    run(doc) {
      const out = [];
      for (const link of visible(doc, 'a')) {
        const href = (attr(link, 'href') || '').trim().toLowerCase();
        if (href !== '#' && !href.startsWith('javascript:')) continue;
        out.push({
          node: link,
          confidence: ADVISORY,
          message: `Link has href="${href.slice(0, 30)}", which does not navigate anywhere.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'If this triggers an action, use a <button>. If it navigates, give it a real href.' },
        });
      }
      return out;
    },
  },

  {
    id: 'link-url-as-text',
    wcag: ['2.4.4'], level: 'A',
    impact: 'minor',
    title: 'Raw URLs make poor link text',
    why: 'A screen reader reads a long URL character by character. "https colon slash slash..." tells the user far less than a few descriptive words.',
    run(doc) {
      const out = [];
      for (const link of visible(doc, 'a')) {
        if (!hasAttr(link, 'href')) continue;
        const text = textContent(link).trim();
        if (text.length < 20) continue;
        if (!/^https?:\/\/\S+$/i.test(text)) continue;
        out.push({
          node: link,
          confidence: ADVISORY,
          message: 'Link text is a raw URL.',
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Replace the URL with a short description of the destination.' },
        });
      }
      return out;
    },
  },

  {
    id: 'new-window-no-warning',
    wcag: ['3.2.2'], level: 'A',
    impact: 'minor',
    title: 'Warn when a link opens a new window',
    why: 'An unexpected new tab disorients screen reader users and breaks the browser Back button, which is often how people recover from a mistake.',
    run(doc) {
      const out = [];
      for (const link of visible(doc, 'a')) {
        if ((attr(link, 'target') || '').toLowerCase() !== '_blank') continue;
        const { name } = accessibleName(link, doc);
        if (/new (window|tab)|opens in/i.test(name)) continue;
        if (/new (window|tab)/i.test(attr(link, 'title') || '')) continue;
        out.push({
          node: link,
          confidence: ADVISORY,
          message: `Link "${name.slice(0, 40) || '(unnamed)'}" opens a new window without warning.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Add visually hidden text or an aria-label noting that the link opens in a new window.' },
        });
      }
      return out;
    },
  },

  /* ================= Structure ================= */
  {
    id: 'main-multiple',
    wcag: ['1.3.1'], level: 'A',
    impact: 'moderate',
    title: 'A page should have exactly one main landmark',
    why: 'Two main landmarks make "skip to main content" ambiguous and break the mental model screen reader users rely on to orient themselves.',
    run(doc) {
      const mains = doc.elements.filter(
        (el) => !isHiddenDeep(el) && (tagName(el) === 'main' || (attr(el, 'role') || '').toLowerCase() === 'main')
      );
      if (mains.length < 2) return [];
      return mains.slice(1).map((el) => ({
        node: el,
        confidence: DEFINITE,
        message: `This page has ${mains.length} main landmarks.`,
        fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Keep one <main> per page and convert the others to <section> or <div>.' },
      }));
    },
  },

  {
    id: 'landmark-nesting',
    wcag: ['1.3.1'], level: 'A',
    impact: 'minor',
    title: 'Banner and contentinfo landmarks must be top level',
    why: 'A header or footer nested inside main is no longer exposed as a page-level landmark, so it disappears from the landmark list users navigate by.',
    run(doc) {
      const out = [];
      for (const el of doc.elements) {
        if (isHiddenDeep(el)) continue;
        const tag = tagName(el);
        if (tag !== 'header' && tag !== 'footer') continue;
        const container = ancestor(el, (a) => ['main', 'article', 'section', 'aside', 'nav'].includes(tagName(a)));
        if (!container) continue;
        out.push({
          node: el,
          confidence: ADVISORY,
          message: `<${tag}> is nested inside <${tagName(container)}>, so it is not exposed as a page landmark.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: `Move the <${tag}> to the top level of the document if it represents the page ${tag === 'header' ? 'banner' : 'footer'}.` },
        });
      }
      return out;
    },
  },

  {
    id: 'h1-multiple',
    wcag: ['1.3.1'], level: 'A',
    impact: 'minor',
    title: 'Prefer a single top-level heading',
    why: 'Multiple h1 elements blur the document outline that screen reader users navigate by.',
    run(doc) {
      const h1s = visible(doc, 'h1');
      if (h1s.length < 2) return [];
      return h1s.slice(1).map((el) => ({
        node: el,
        confidence: ADVISORY,
        message: `This page has ${h1s.length} h1 headings.`,
        fix: { strategy: 'rename-tag', from: 'h1', to: 'h2', confidence: REVIEW, guidance: 'Keep one h1 describing the page, and demote the rest to h2.' },
      }));
    },
  },

  {
    id: 'definition-list-structure',
    wcag: ['1.3.1'], level: 'A',
    impact: 'minor',
    title: 'Definition lists must be structured correctly',
    why: 'A dl containing anything other than dt/dd pairs loses its list semantics, and the term-to-definition relationship is not announced.',
    run(doc) {
      const out = [];
      for (const list of visible(doc, 'dl')) {
        const bad = children(list).filter((child) => {
          if (isText(child)) return child.value.trim().length > 0;
          if (!isElement(child)) return false;
          return !['dt', 'dd', 'div', 'script', 'template'].includes(tagName(child));
        });
        if (!bad.length) continue;
        out.push({
          node: list,
          confidence: DEFINITE,
          message: `<dl> contains ${bad.length} child element(s) that are not <dt> or <dd>.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'A <dl> may only contain <dt>, <dd>, and optionally <div> wrappers around them.' },
        });
      }
      return out;
    },
  },

  {
    id: 'th-scope-missing',
    wcag: ['1.3.1'], level: 'A',
    impact: 'moderate',
    title: 'Header cells in complex tables need a scope',
    why: 'Without scope, a screen reader has to guess whether a header applies to its row or its column. In a table with both, it usually guesses wrong.',
    run(doc) {
      const out = [];
      for (const table of visible(doc, 'table')) {
        const rows = [];
        walk(table, (n) => { if (isElement(n) && tagName(n) === 'tr') rows.push(n); });
        if (rows.length < 2) continue;

        const headerCells = [];
        walk(table, (n) => { if (isElement(n) && tagName(n) === 'th') headerCells.push(n); });
        if (!headerCells.length) continue;

        // Only complex tables need explicit scope: headers in both dimensions.
        const firstRowHeaders = children(rows[0]).filter((c) => isElement(c) && tagName(c) === 'th').length;
        const rowHeaders = rows.slice(1).filter((row) => children(row).some((c) => isElement(c) && tagName(c) === 'th')).length;
        if (!(firstRowHeaders > 0 && rowHeaders > 0)) continue;

        const missing = headerCells.filter((th) => !hasAttr(th, 'scope') && !hasAttr(th, 'headers'));
        if (!missing.length) continue;
        out.push({
          node: missing[0],
          confidence: REVIEW,
          message: `Table has headers in both rows and columns, but ${missing.length} <th> cell(s) have no scope attribute.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Add scope="col" to column headers and scope="row" to row headers.' },
        });
      }
      return out;
    },
  },

  {
    id: 'id-invalid',
    wcag: ['4.1.1'], level: 'A',
    impact: 'minor',
    title: 'IDs must be valid for use in selectors and references',
    why: 'An id containing spaces cannot be referenced by label[for] or aria-labelledby, so any association that depends on it silently fails.',
    run(doc) {
      const out = [];
      for (const el of doc.elements) {
        const id = attr(el, 'id');
        if (!id) continue;
        if (!/\s/.test(id) && id.trim() !== '') continue;
        out.push({
          node: el,
          confidence: DEFINITE,
          message: id.trim() === '' ? 'Element has an empty id attribute.' : `id "${id.slice(0, 40)}" contains whitespace.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Use an id with no spaces, for example separated by hyphens.' },
        });
      }
      return out;
    },
  },

  /* ================= Media ================= */
  {
    id: 'audio-no-transcript',
    wcag: ['1.2.1'], level: 'A',
    impact: 'serious',
    title: 'Audio content needs a transcript',
    why: 'Deaf and hard-of-hearing users get nothing at all from audio-only content without a text alternative.',
    run(doc) {
      const out = [];
      for (const audio of visible(doc, 'audio')) {
        const nearbyText = audio.parentNode ? textContent(audio.parentNode) : '';
        if (/transcript/i.test(nearbyText)) continue;
        out.push({
          node: audio,
          confidence: REVIEW,
          message: 'Audio element found with no obvious transcript nearby.',
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Provide a full text transcript adjacent to the player, or a clearly labelled link to one.' },
        });
      }
      return out;
    },
  },

  {
    id: 'video-no-audio-description',
    wcag: ['1.2.5'], level: 'AA',
    impact: 'moderate',
    title: 'Video may need an audio description',
    why: 'Blind users miss information shown only on screen. Where visuals carry meaning the audio does not, an audio description track is required at Level AA.',
    run(doc) {
      const out = [];
      for (const video of visible(doc, 'video')) {
        const tracks = children(video).filter((c) => isElement(c) && tagName(c) === 'track');
        if (tracks.some((t) => (attr(t, 'kind') || '').toLowerCase() === 'descriptions')) continue;
        out.push({
          node: video,
          confidence: REVIEW,
          message: 'Video has no descriptions track.',
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'If the video conveys information visually that is not in the audio, add an audio description track or a described version.' },
        });
      }
      return out;
    },
  },

  {
    id: 'object-no-fallback',
    wcag: ['1.1.1'], level: 'A',
    impact: 'moderate',
    title: 'Embedded objects need a text alternative',
    why: 'If the plugin or format is unsupported, or the user is on a screen reader, the fallback content is all they get.',
    run(doc) {
      const out = [];
      for (const el of visible(doc, 'object', 'embed')) {
        if (accessibleName(el, doc).name) continue;
        if (tagName(el) === 'object' && textContent(el)) continue;
        out.push({
          node: el,
          confidence: REVIEW,
          message: `<${tagName(el)}> has no accessible name or fallback content.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Add a title attribute, or provide fallback content inside the <object> element.' },
        });
      }
      return out;
    },
  },

  /* ================= Visual and text ================= */
  {
    id: 'viewport-missing',
    wcag: ['1.4.10'], level: 'AA',
    impact: 'moderate',
    title: 'Pages need a viewport meta tag',
    why: 'Without it, mobile browsers render a desktop-width page scaled down. Text becomes unreadable and content does not reflow at 320px, which Level AA requires.',
    run(doc) {
      const hasViewport = elementsByTag(doc, 'meta').some(
        (meta) => (attr(meta, 'name') || '').toLowerCase() === 'viewport'
      );
      if (hasViewport) return [];
      const head = doc.byTag.get('head')?.[0];
      if (!head) return [];
      return [{
        node: head,
        confidence: REVIEW,
        message: 'No viewport meta tag was found.',
        fix: {
          strategy: 'insert-first-child',
          html: '<meta name="viewport" content="width=device-width, initial-scale=1">',
          confidence: REVIEW,
          guidance: 'Add the standard responsive viewport tag so content reflows on small screens.',
        },
      }];
    },
  },

  {
    id: 'text-justified',
    wcag: ['1.4.8'], level: 'AAA',
    impact: 'minor',
    title: 'Avoid fully justified text',
    why: 'Justified text creates uneven "rivers" of white space that are difficult to track for people with dyslexia and other reading disabilities.',
    run(doc, ctx) {
      if (!ctx.rawCss) return [];
      if (!/text-align\s*:\s*justify/i.test(ctx.rawCss)) return [];
      const body = doc.byTag.get('body')?.[0];
      if (!body) return [];
      return [{
        node: body,
        confidence: ADVISORY,
        message: 'A CSS rule sets text-align: justify.',
        fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Use text-align: left (or start) for body copy.' },
      }];
    },
  },

  {
    id: 'title-attribute-as-label',
    wcag: ['4.1.2'], level: 'A',
    impact: 'minor',
    title: 'The title attribute is a weak label',
    why: 'Title text is invisible to touch users, unreliable on mobile screen readers, and only appears on hover, so it cannot be the only label for a control.',
    run(doc) {
      const out = [];
      for (const el of visible(doc, 'input', 'select', 'textarea', 'button', 'a')) {
        const { name, source } = accessibleName(el, doc);
        if (!name || source !== 'title') continue;
        out.push({
          node: el,
          confidence: ADVISORY,
          message: `<${tagName(el)}> is named only by its title attribute.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Add a visible <label>, or an aria-label, in addition to the title.' },
        });
      }
      return out;
    },
  },

  {
    id: 'iframe-negative-tabindex',
    wcag: ['2.1.1'], level: 'A',
    impact: 'moderate',
    title: 'Interactive frames must stay reachable',
    why: 'tabindex="-1" on a frame containing a form or player makes its contents unreachable by keyboard.',
    run(doc) {
      const out = [];
      for (const frame of visible(doc, 'iframe')) {
        if (attr(frame, 'tabindex') !== '-1') continue;
        out.push({
          node: frame,
          confidence: ADVISORY,
          message: 'Frame has tabindex="-1", which removes its contents from the tab order.',
          fix: { strategy: 'remove-attribute', attribute: 'tabindex', confidence: REVIEW, guidance: 'Remove the negative tabindex unless the frame content is genuinely decorative.' },
        });
      }
      return out;
    },
  },

  {
    id: 'noscript-missing',
    wcag: ['4.1.2'], level: 'A',
    impact: 'minor',
    title: 'Consider a no-JavaScript fallback',
    why: 'A page whose entire content depends on JavaScript excludes users on restricted networks, older assistive technology, and anyone hitting a script error.',
    run(doc, ctx) {
      if (!ctx.coverageHint || ctx.coverageHint.complete !== false) return [];
      if (elementsByTag(doc, 'noscript').length) return [];
      const body = doc.byTag.get('body')?.[0];
      if (!body) return [];
      return [{
        node: body,
        confidence: ADVISORY,
        message: 'Page content appears to require JavaScript and provides no <noscript> fallback.',
        fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Server-render the primary content where possible, or provide a meaningful <noscript> message.' },
      }];
    },
  },

  {
    id: 'duplicate-alt-adjacent',
    wcag: ['1.1.1'], level: 'A',
    impact: 'minor',
    title: 'Avoid repeating link text in image alt',
    why: 'When a link contains both an image and text saying the same thing, a screen reader announces it twice.',
    run(doc) {
      const out = [];
      for (const link of visible(doc, 'a')) {
        const images = [];
        walk(link, (n) => { if (isElement(n) && tagName(n) === 'img') images.push(n); });
        if (!images.length) continue;
        const linkText = (link.childNodes || [])
          .filter(isText).map((t) => t.value).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!linkText) continue;
        for (const img of images) {
          const alt = (attr(img, 'alt') || '').trim().toLowerCase();
          if (!alt || alt !== linkText) continue;
          out.push({
            node: img,
            confidence: ADVISORY,
            message: `Image alt text duplicates the link text "${linkText.slice(0, 40)}".`,
            fix: {
              strategy: 'set-attribute', attribute: 'alt', value: '',
              confidence: REVIEW,
              guidance: 'When adjacent text already names the link, the image is decorative: alt="" avoids the duplicate announcement.',
            },
          });
        }
      }
      return out;
    },
  },
];

export default ADVANCED_RULES;
