import {
  attr, hasAttr, tagName, isElement, isText, walk, textContent, children,
  isHidden, isHiddenDeep, isFocusable, accessibleName, elementsByTag, ancestor, closestRole,
} from '../lib/html.js';
import { cssPath } from '../lib/html.js';
import { computeTextStyle } from '../lib/css.js';
import { contrastRatio, requiredRatio, formatRatio, toHex, suggestAccessibleColor, parseColor, flatten } from '../lib/color.js';
import { ADVANCED_RULES } from './rules-advanced.js';

// Confidence tiers are a product decision as much as a technical one. `definite`
// findings are machine-verifiable failures. `review` findings are strong signals
// that still require a human judgment call. We never present `review` items as
// confirmed failures, and we never claim a page is "compliant".
const DEFINITE = 'definite';
const REVIEW = 'review';

const VALID_ROLES = new Set([
  'alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote', 'button', 'caption',
  'cell', 'checkbox', 'code', 'columnheader', 'combobox', 'command', 'complementary', 'composite',
  'contentinfo', 'definition', 'deletion', 'dialog', 'directory', 'document', 'emphasis', 'feed',
  'figure', 'form', 'generic', 'grid', 'gridcell', 'group', 'heading', 'img', 'input', 'insertion',
  'landmark', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'marquee', 'math', 'menu',
  'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'meter', 'navigation', 'none', 'note',
  'option', 'paragraph', 'presentation', 'progressbar', 'radio', 'radiogroup', 'range', 'region',
  'roletype', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox', 'section',
  'sectionhead', 'select', 'separator', 'slider', 'spinbutton', 'status', 'strong', 'structure',
  'subscript', 'superscript', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox',
  'time', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem', 'widget', 'window',
]);

const VALID_ARIA_ATTRS = new Set([
  'aria-activedescendant', 'aria-atomic', 'aria-autocomplete', 'aria-braillelabel',
  'aria-brailleroledescription', 'aria-busy', 'aria-checked', 'aria-colcount', 'aria-colindex',
  'aria-colindextext', 'aria-colspan', 'aria-controls', 'aria-current', 'aria-describedby',
  'aria-description', 'aria-details', 'aria-disabled', 'aria-dropeffect', 'aria-errormessage',
  'aria-expanded', 'aria-flowto', 'aria-grabbed', 'aria-haspopup', 'aria-hidden', 'aria-invalid',
  'aria-keyshortcuts', 'aria-label', 'aria-labelledby', 'aria-level', 'aria-live', 'aria-modal',
  'aria-multiline', 'aria-multiselectable', 'aria-orientation', 'aria-owns', 'aria-placeholder',
  'aria-posinset', 'aria-pressed', 'aria-readonly', 'aria-relevant', 'aria-required',
  'aria-roledescription', 'aria-rowcount', 'aria-rowindex', 'aria-rowindextext', 'aria-rowspan',
  'aria-selected', 'aria-setsize', 'aria-sort', 'aria-valuemax', 'aria-valuemin', 'aria-valuenow',
  'aria-valuetext',
]);

const REQUIRED_ARIA_BY_ROLE = {
  checkbox: ['aria-checked'],
  radio: ['aria-checked'],
  switch: ['aria-checked'],
  combobox: ['aria-expanded'],
  slider: ['aria-valuenow'],
  scrollbar: ['aria-valuenow'],
  heading: ['aria-level'],
  option: ['aria-selected'],
};

const GENERIC_LINK_TEXT = new Set([
  'click here', 'here', 'read more', 'more', 'learn more', 'link', 'this', 'this page',
  'continue', 'details', 'view', 'go', 'download', 'see more', 'more info', 'info',
]);

const PLACEHOLDER_ALT = /^(image|img|photo|picture|graphic|icon|logo|spacer|banner|untitled|dsc[_-]?\d+|img[_-]?\d+|screenshot)([\s._-]*\d+)?$/i;

function visibleElements(doc, ...tags) {
  return elementsByTag(doc, ...tags).filter((el) => !isHiddenDeep(el));
}

function isDecorativeContext(node) {
  const role = (attr(node, 'role') || '').toLowerCase();
  return role === 'presentation' || role === 'none';
}

/* ------------------------------------------------------------------ *
 * Rule definitions
 * ------------------------------------------------------------------ */

export const RULES = [
  /* ---------- Text alternatives (WCAG 1.1) ---------- */
  {
    id: 'img-alt',
    wcag: ['1.1.1'], level: 'A', section508: ['502.3.1'],
    impact: 'critical',
    title: 'Images must have alternative text',
    why: 'Screen reader users hear nothing where this image is, so any information it carries is lost. This is the single most common failure in web accessibility litigation.',
    run(doc) {
      const out = [];
      for (const img of visibleElements(doc, 'img')) {
        if (isDecorativeContext(img)) continue;
        if (hasAttr(img, 'alt')) continue;
        if (attr(img, 'aria-label') || attr(img, 'aria-labelledby')) continue;
        const src = attr(img, 'src') || '';
        out.push({
          node: img,
          confidence: DEFINITE,
          message: `Image has no alt attribute${src ? ` (src="${src.slice(0, 80)}")` : ''}.`,
          // We can add the attribute mechanically, but only a human or a vision
          // model knows the correct text, so the value is left for review.
          fix: {
            strategy: 'set-attribute',
            attribute: 'alt',
            value: '',
            confidence: REVIEW,
            guidance: 'If the image conveys meaning, describe it. If it is purely decorative, an empty alt="" is correct and hides it from screen readers.',
            aiPrompt: 'describe-image',
          },
        });
      }
      return out;
    },
  },

  {
    id: 'img-alt-placeholder',
    wcag: ['1.1.1'], level: 'A',
    impact: 'serious',
    title: 'Alternative text must be meaningful',
    why: 'Alt text like "image" or "DSC_0043" tells a screen reader user nothing. It technically passes automated checks but fails real users and manual audits.',
    run(doc) {
      const out = [];
      for (const img of visibleElements(doc, 'img')) {
        const alt = attr(img, 'alt');
        if (!alt || !alt.trim()) continue;
        const value = alt.trim();
        const filenameLike = /\.(jpe?g|png|gif|svg|webp|avif)$/i.test(value);
        if (PLACEHOLDER_ALT.test(value) || filenameLike || /^(image|picture|photo|graphic) of /i.test(value)) {
          out.push({
            node: img,
            confidence: filenameLike || PLACEHOLDER_ALT.test(value) ? DEFINITE : REVIEW,
            message: `Alt text "${value.slice(0, 60)}" does not describe the image.`,
            fix: {
              strategy: 'set-attribute', attribute: 'alt', value: '',
              confidence: REVIEW,
              guidance: 'Replace with a description of what the image conveys in context.',
              aiPrompt: 'describe-image',
            },
          });
        }
      }
      return out;
    },
  },

  {
    id: 'svg-name',
    wcag: ['1.1.1'], level: 'A',
    impact: 'serious',
    title: 'Meaningful SVG graphics need an accessible name',
    why: 'An SVG exposed as an image with no name is announced as "graphic" with no further information.',
    run(doc) {
      const out = [];
      for (const svg of visibleElements(doc, 'svg')) {
        const role = (attr(svg, 'role') || '').toLowerCase();
        if (role === 'presentation' || role === 'none' || attr(svg, 'aria-hidden') === 'true') continue;
        // Only flag SVGs that are exposed as images or are interactive.
        const interactive = isFocusable(svg) || ancestor(svg, (a) => ['a', 'button'].includes(tagName(a)));
        if (role !== 'img' && !interactive) continue;
        const { name } = accessibleName(svg, doc);
        if (name) continue;
        // A parent link or button may carry the name instead.
        if (interactive) {
          const host = ancestor(svg, (a) => ['a', 'button'].includes(tagName(a)));
          if (host && accessibleName(host, doc).name) continue;
        }
        out.push({
          node: svg,
          confidence: REVIEW,
          message: 'SVG is exposed to assistive technology but has no accessible name.',
          fix: {
            strategy: 'set-attribute', attribute: 'aria-label', value: '',
            confidence: REVIEW,
            guidance: 'Add aria-label describing the graphic, or add role="presentation" plus aria-hidden="true" if it is decorative.',
          },
        });
      }
      return out;
    },
  },

  /* ---------- Names, roles, values (WCAG 4.1.2) ---------- */
  {
    id: 'button-name',
    wcag: ['4.1.2'], level: 'A', section508: ['502.3.1'],
    impact: 'critical',
    title: 'Buttons must have an accessible name',
    why: 'A screen reader announces this control as just "button". The user cannot know what it does without activating it.',
    run(doc) {
      const out = [];
      const candidates = visibleElements(doc, 'button').concat(
        visibleElements(doc, 'input').filter((el) => ['button', 'submit', 'reset', 'image'].includes((attr(el, 'type') || '').toLowerCase())),
        doc.elements.filter((el) => (attr(el, 'role') || '').toLowerCase() === 'button' && !isHiddenDeep(el) && tagName(el) !== 'button')
      );
      for (const el of candidates) {
        const { name } = accessibleName(el, doc);
        if (name) continue;
        const iconHint = detectIconHint(el);
        out.push({
          node: el,
          confidence: DEFINITE,
          message: 'Button has no accessible name (no text content, aria-label, or title).',
          fix: {
            strategy: 'set-attribute',
            attribute: 'aria-label',
            value: iconHint || '',
            confidence: iconHint ? REVIEW : REVIEW,
            guidance: iconHint
              ? `An icon class suggests this may be a "${iconHint}" button. Confirm before applying.`
              : 'Add aria-label describing the action this button performs, e.g. "Close dialog".',
            aiPrompt: 'name-control',
          },
        });
      }
      return out;
    },
  },

  {
    id: 'link-name',
    wcag: ['2.4.4', '4.1.2'], level: 'A', section508: ['502.3.1'],
    impact: 'critical',
    title: 'Links must have discernible text',
    why: 'An unnamed link is announced as "link" with no destination. Icon-only and image-only links are the usual cause.',
    run(doc) {
      const out = [];
      for (const link of visibleElements(doc, 'a')) {
        if (!hasAttr(link, 'href')) continue;
        const { name } = accessibleName(link, doc);
        if (name) continue;
        out.push({
          node: link,
          confidence: DEFINITE,
          message: 'Link has no discernible text.',
          fix: {
            strategy: 'set-attribute', attribute: 'aria-label', value: '',
            confidence: REVIEW,
            guidance: 'Add aria-label describing the link destination, or give the nested image meaningful alt text.',
            aiPrompt: 'name-control',
          },
        });
      }
      return out;
    },
  },

  {
    id: 'link-generic-text',
    wcag: ['2.4.4'], level: 'A',
    impact: 'moderate',
    title: 'Link text should describe its destination',
    why: 'Screen reader users often navigate by pulling up a list of links. A page full of "click here" is unusable in that mode.',
    run(doc) {
      const out = [];
      for (const link of visibleElements(doc, 'a')) {
        if (!hasAttr(link, 'href')) continue;
        const { name } = accessibleName(link, doc);
        const normalized = name.toLowerCase().replace(/[^a-z\s]/g, '').trim();
        if (!normalized || !GENERIC_LINK_TEXT.has(normalized)) continue;
        if (attr(link, 'aria-label') || attr(link, 'aria-labelledby')) continue;
        out.push({
          node: link,
          confidence: REVIEW,
          message: `Link text "${name}" does not describe where the link goes.`,
          fix: {
            strategy: 'set-attribute', attribute: 'aria-label', value: '',
            confidence: REVIEW,
            guidance: 'Rewrite the visible text to name the destination, or add an aria-label that does.',
          },
        });
      }
      return out;
    },
  },

  {
    id: 'input-label',
    wcag: ['1.3.1', '3.3.2', '4.1.2'], level: 'A', section508: ['502.3.1'],
    impact: 'critical',
    title: 'Form inputs must have labels',
    why: 'Without a programmatic label, a screen reader user hears only the field type. Unlabeled checkout and contact forms are a leading cause of ADA demand letters.',
    run(doc) {
      const out = [];
      const fields = visibleElements(doc, 'input', 'select', 'textarea').filter((el) => {
        const type = (attr(el, 'type') || '').toLowerCase();
        return !['hidden', 'submit', 'button', 'reset', 'image'].includes(type);
      });
      for (const field of fields) {
        const { name } = accessibleName(field, doc);
        if (name) continue;
        const placeholder = attr(field, 'placeholder');
        const id = attr(field, 'id');
        out.push({
          node: field,
          confidence: DEFINITE,
          message: placeholder
            ? `Form field has only a placeholder ("${placeholder.slice(0, 40)}"), which is not a label.`
            : 'Form field has no associated label.',
          fix: placeholder && id
            ? {
                strategy: 'set-attribute', attribute: 'aria-label', value: placeholder,
                confidence: DEFINITE,
                guidance: `A visible <label for="${id}"> is preferred. Using the existing placeholder text as an aria-label is a safe, behavior-preserving improvement.`,
              }
            : {
                strategy: 'set-attribute', attribute: 'aria-label', value: placeholder || '',
                confidence: placeholder ? DEFINITE : REVIEW,
                guidance: 'Associate a visible <label> element with this field using for/id, or add an aria-label.',
                aiPrompt: 'name-control',
              },
        });
      }
      return out;
    },
  },

  {
    id: 'label-orphan',
    wcag: ['1.3.1'], level: 'A',
    impact: 'serious',
    title: 'Label references must point at a real field',
    why: 'A label whose "for" attribute points at a missing id labels nothing. Clicking it does not focus the field and screen readers do not announce it.',
    run(doc) {
      const out = [];
      for (const label of visibleElements(doc, 'label')) {
        const forId = attr(label, 'for');
        if (!forId) continue;
        if (doc.byId.has(forId)) continue;
        out.push({
          node: label,
          confidence: DEFINITE,
          message: `Label references id "${forId}", which does not exist on this page.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: `Correct the for attribute to match the field's id, or add id="${forId}" to the intended field.` },
        });
      }
      return out;
    },
  },

  {
    id: 'frame-title',
    wcag: ['4.1.2'], level: 'A',
    impact: 'serious',
    title: 'Frames must have an accessible name',
    why: 'Screen reader users navigating by frame hear only "frame" and cannot tell what each one contains.',
    run(doc) {
      const out = [];
      for (const frame of visibleElements(doc, 'iframe', 'frame')) {
        const title = attr(frame, 'title');
        if (title && title.trim()) continue;
        if (attr(frame, 'aria-label') || attr(frame, 'aria-labelledby')) continue;
        const src = attr(frame, 'src') || '';
        const guessed = guessFrameTitle(src);
        out.push({
          node: frame,
          confidence: DEFINITE,
          message: `Frame has no title attribute${src ? ` (src="${src.slice(0, 60)}")` : ''}.`,
          fix: {
            strategy: 'set-attribute', attribute: 'title', value: guessed || '',
            confidence: guessed ? DEFINITE : REVIEW,
            guidance: guessed
              ? `The frame source suggests the title "${guessed}". Adding a title is purely additive and cannot break rendering.`
              : 'Add a title attribute describing the frame content, e.g. "Checkout payment form".',
          },
        });
      }
      return out;
    },
  },

  {
    id: 'nested-interactive',
    wcag: ['4.1.2'], level: 'A',
    impact: 'serious',
    title: 'Interactive controls must not be nested',
    why: 'A button inside a link (or similar) produces an ambiguous accessibility tree; screen readers and keyboards behave unpredictably.',
    run(doc) {
      const out = [];
      const interactiveTags = ['a', 'button', 'select', 'textarea', 'input'];
      for (const el of visibleElements(doc, ...interactiveTags)) {
        if (tagName(el) === 'a' && !hasAttr(el, 'href')) continue;
        const host = ancestor(el, (a) => {
          const t = tagName(a);
          if (t === 'a') return hasAttr(a, 'href');
          return ['button', 'select', 'textarea'].includes(t);
        });
        if (!host) continue;
        out.push({
          node: el,
          confidence: DEFINITE,
          message: `A <${tagName(el)}> is nested inside an interactive <${tagName(host)}>.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Restructure so the controls are siblings rather than nested.' },
        });
      }
      return out;
    },
  },

  /* ---------- Document structure (WCAG 1.3, 2.4) ---------- */
  {
    id: 'html-has-lang',
    wcag: ['3.1.1'], level: 'A', section508: ['501'],
    impact: 'serious',
    title: 'Page must declare a language',
    why: 'Screen readers pick pronunciation rules from the page language. Without it, English content may be read with a French or German voice, rendering it incomprehensible.',
    run(doc) {
      const html = doc.byTag.get('html')?.[0];
      if (!html) return [];
      const lang = attr(html, 'lang');
      if (lang && lang.trim()) return [];
      return [{
        node: html,
        confidence: DEFINITE,
        message: 'The <html> element has no lang attribute.',
        fix: {
          strategy: 'set-attribute', attribute: 'lang', value: 'en',
          confidence: DEFINITE,
          guidance: 'Set the primary language of the page. Change "en" if the content is not English.',
        },
      }];
    },
  },

  {
    id: 'html-lang-valid',
    wcag: ['3.1.1'], level: 'A',
    impact: 'moderate',
    title: 'Language code must be valid',
    why: 'An invalid BCP 47 tag is ignored, leaving the screen reader on its default voice.',
    run(doc) {
      const html = doc.byTag.get('html')?.[0];
      if (!html) return [];
      const lang = attr(html, 'lang');
      if (!lang || !lang.trim()) return [];
      if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(lang.trim())) return [];
      return [{
        node: html,
        confidence: DEFINITE,
        message: `"${lang}" is not a valid language tag.`,
        fix: { strategy: 'set-attribute', attribute: 'lang', value: 'en', confidence: REVIEW, guidance: 'Use a valid BCP 47 tag such as "en", "en-GB", or "es".' },
      }];
    },
  },

  {
    id: 'document-title',
    wcag: ['2.4.2'], level: 'A',
    impact: 'serious',
    title: 'Page must have a title',
    why: 'The title is the first thing announced on page load and is how users distinguish tabs and browser history entries.',
    run(doc) {
      const title = doc.byTag.get('title')?.[0];
      const text = title ? textContent(title, { includeHidden: true }) : '';
      if (text) return [];
      const head = doc.byTag.get('head')?.[0];
      const target = title || head;
      if (!target) return [];
      return [{
        node: target,
        confidence: DEFINITE,
        message: title ? 'The <title> element is empty.' : 'The page has no <title> element.',
        fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Add a unique, descriptive <title> that identifies this page and the site.' },
      }];
    },
  },

  {
    id: 'page-has-h1',
    wcag: ['1.3.1', '2.4.6'], level: 'A',
    impact: 'moderate',
    title: 'Page should have a top-level heading',
    why: 'Screen reader users jump to the h1 to orient themselves. Without one, they must read from the top of the DOM every time.',
    run(doc) {
      const headings = visibleElements(doc, 'h1');
      const ariaH1 = doc.elements.some((el) => (attr(el, 'role') || '') === 'heading' && attr(el, 'aria-level') === '1');
      if (headings.length || ariaH1) return [];
      const body = doc.byTag.get('body')?.[0];
      if (!body) return [];
      return [{
        node: body,
        confidence: REVIEW,
        message: 'Page has no <h1> heading.',
        fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Add a single <h1> describing the main content of this page.' },
      }];
    },
  },

  {
    id: 'heading-order',
    wcag: ['1.3.1'], level: 'A',
    impact: 'moderate',
    title: 'Heading levels must not skip',
    why: 'Heading level is the document outline for screen reader users. Skipping from h2 to h4 implies a missing section and breaks navigation.',
    run(doc) {
      const out = [];
      const headings = doc.elements.filter((el) => /^h[1-6]$/.test(tagName(el) || '') && !isHiddenDeep(el));
      let previous = 0;
      for (const heading of headings) {
        const level = Number(tagName(heading).slice(1));
        if (previous && level > previous + 1) {
          out.push({
            node: heading,
            confidence: REVIEW,
            message: `Heading level jumps from h${previous} to h${level}.`,
            fix: {
              strategy: 'rename-tag', from: tagName(heading), to: `h${previous + 1}`,
              confidence: REVIEW,
              guidance: `Change to h${previous + 1} if this is a subsection of the preceding h${previous}. Verify the visual design still reads correctly.`,
            },
          });
        }
        previous = level;
      }
      return out;
    },
  },

  {
    id: 'empty-heading',
    wcag: ['1.3.1'], level: 'A',
    impact: 'moderate',
    title: 'Headings must not be empty',
    why: 'An empty heading appears in the screen reader outline as a blank entry, which is confusing to navigate past.',
    run(doc) {
      const out = [];
      const headings = doc.elements.filter((el) => /^h[1-6]$/.test(tagName(el) || '') && !isHiddenDeep(el));
      for (const heading of headings) {
        const { name } = accessibleName(heading, doc);
        if (name) continue;
        out.push({
          node: heading,
          confidence: DEFINITE,
          message: `<${tagName(heading)}> is empty.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Add heading text, or remove the element if it exists only for spacing.' },
        });
      }
      return out;
    },
  },

  {
    id: 'duplicate-id',
    wcag: ['4.1.1'], level: 'A',
    impact: 'moderate',
    title: 'IDs must be unique',
    why: 'Label associations and aria-labelledby references resolve to the first match only, so duplicate ids silently break naming.',
    run(doc) {
      const out = [];
      for (const [id, nodes] of doc.duplicateIds) {
        // Only the duplicates after the first are the problem.
        for (const node of nodes.slice(1)) {
          out.push({
            node,
            confidence: DEFINITE,
            message: `Duplicate id "${id}" appears ${nodes.length} times on this page.`,
            fix: { strategy: 'manual', confidence: REVIEW, guidance: `Rename this id so it is unique. Update any label[for] or aria-labelledby that referenced it.` },
          });
        }
      }
      return out;
    },
  },

  {
    id: 'list-structure',
    wcag: ['1.3.1'], level: 'A',
    impact: 'minor',
    title: 'Lists must contain only list items',
    why: 'Screen readers announce "list of N items". Stray children corrupt that count and the list semantics.',
    run(doc) {
      const out = [];
      for (const list of visibleElements(doc, 'ul', 'ol')) {
        const bad = children(list).filter((child) => {
          if (!isElement(child)) return isText(child) && child.value.trim().length > 0;
          return !['li', 'script', 'template'].includes(tagName(child));
        });
        if (!bad.length) continue;
        out.push({
          node: list,
          confidence: DEFINITE,
          message: `<${tagName(list)}> contains ${bad.length} child element(s) that are not <li>.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Wrap the stray content in <li> elements, or use a different container.' },
        });
      }
      return out;
    },
  },

  {
    id: 'table-headers',
    wcag: ['1.3.1'], level: 'A',
    impact: 'serious',
    title: 'Data tables must have header cells',
    why: 'Without <th>, screen readers cannot announce which column or row a cell belongs to, so the data becomes a meaningless stream of values.',
    run(doc) {
      const out = [];
      for (const table of visibleElements(doc, 'table')) {
        const role = (attr(table, 'role') || '').toLowerCase();
        if (role === 'presentation' || role === 'none') continue;
        const rows = [];
        walk(table, (n) => { if (isElement(n) && tagName(n) === 'tr') rows.push(n); });
        if (rows.length < 2) continue; // Single-row tables are usually layout.
        const hasHeader = table.childNodes && rows.some((row) => children(row).some((c) => isElement(c) && tagName(c) === 'th'));
        if (hasHeader) continue;
        out.push({
          node: table,
          confidence: REVIEW,
          message: `Table with ${rows.length} rows has no <th> header cells.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Convert the header row cells from <td> to <th> and add scope="col". If this table is used only for layout, add role="presentation".' },
        });
      }
      return out;
    },
  },

  /* ---------- Navigation and landmarks ---------- */
  {
    id: 'landmark-main',
    wcag: ['1.3.1', '2.4.1'], level: 'A',
    impact: 'moderate',
    title: 'Page should have a main landmark',
    why: 'The main landmark is how screen reader users skip the header and navigation to reach content. Its absence forces them to tab through every menu item on every page.',
    run(doc) {
      const mains = doc.elements.filter((el) => tagName(el) === 'main' || (attr(el, 'role') || '').toLowerCase() === 'main');
      if (mains.length) return [];
      const body = doc.byTag.get('body')?.[0];
      if (!body) return [];
      return [{
        node: body,
        confidence: REVIEW,
        message: 'Page has no <main> landmark.',
        fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Wrap the primary content in a <main> element. There should be exactly one per page.' },
      }];
    },
  },

  {
    id: 'landmark-unique',
    wcag: ['1.3.1'], level: 'A',
    impact: 'minor',
    title: 'Repeated landmarks must be distinguishable',
    why: 'Two unlabeled navigation landmarks are both announced as "navigation", so users cannot tell primary from footer navigation.',
    run(doc) {
      const out = [];
      const groups = new Map();
      for (const el of doc.elements) {
        if (isHiddenDeep(el)) continue;
        const role = closestRole(el);
        if (!['navigation', 'region', 'complementary'].includes(role)) continue;
        if (role === 'region' && !attr(el, 'aria-label') && !attr(el, 'aria-labelledby')) continue;
        if (!groups.has(role)) groups.set(role, []);
        groups.get(role).push(el);
      }
      for (const [role, nodes] of groups) {
        if (nodes.length < 2) continue;
        const unlabeled = nodes.filter((n) => !attr(n, 'aria-label') && !attr(n, 'aria-labelledby'));
        if (unlabeled.length < 2) continue;
        for (const node of unlabeled) {
          out.push({
            node,
            confidence: REVIEW,
            message: `Multiple "${role}" landmarks on the page are unlabeled.`,
            fix: {
              strategy: 'set-attribute', attribute: 'aria-label', value: '',
              confidence: REVIEW,
              guidance: `Give each ${role} landmark a distinct aria-label, e.g. "Primary" and "Footer".`,
            },
          });
        }
      }
      return out;
    },
  },

  {
    id: 'skip-link',
    wcag: ['2.4.1'], level: 'A',
    impact: 'serious',
    title: 'Provide a skip-to-content link',
    why: 'Keyboard-only users must otherwise tab through the entire navigation on every single page load. This is one of the most-cited issues in demand letters.',
    run(doc) {
      const body = doc.byTag.get('body')?.[0];
      if (!body) return [];
      const links = elementsByTag(doc, 'a').filter((a) => hasAttr(a, 'href'));
      const hasSkip = links.slice(0, 5).some((a) => {
        const href = attr(a, 'href') || '';
        const text = textContent(a, { includeHidden: true }).toLowerCase();
        return href.startsWith('#') && /skip|jump/.test(text);
      });
      if (hasSkip) return [];
      // Only meaningful when there is navigation to skip past.
      const navCount = doc.elements.filter((el) => closestRole(el) === 'navigation').length;
      if (!navCount && links.length < 10) return [];
      const mainEl = doc.elements.find((el) => tagName(el) === 'main' || (attr(el, 'role') || '') === 'main');
      const targetId = mainEl ? (attr(mainEl, 'id') || 'main-content') : 'main-content';
      return [{
        node: body,
        confidence: REVIEW,
        message: 'No "skip to content" link was found at the start of the page.',
        fix: {
          strategy: 'insert-first-child',
          html: `<a class="skip-link" href="#${targetId}">Skip to main content</a>`,
          confidence: REVIEW,
          guidance: `Insert a skip link as the first focusable element. Ensure the target element has id="${targetId}" and that the link is visible on focus.`,
        },
      }];
    },
  },

  {
    id: 'tabindex-positive',
    wcag: ['2.4.3'], level: 'A',
    impact: 'serious',
    title: 'Avoid positive tabindex values',
    why: 'A positive tabindex pulls the element out of document order and ahead of everything else, scrambling keyboard navigation across the whole page.',
    run(doc) {
      const out = [];
      for (const el of doc.elements) {
        const value = attr(el, 'tabindex');
        if (value === null) continue;
        const num = parseInt(value, 10);
        if (Number.isNaN(num) || num <= 0) continue;
        out.push({
          node: el,
          confidence: DEFINITE,
          message: `tabindex="${value}" forces this element out of natural tab order.`,
          fix: {
            strategy: 'set-attribute', attribute: 'tabindex', value: '0',
            confidence: DEFINITE,
            guidance: 'Use tabindex="0" and rely on DOM order for sequencing.',
          },
        });
      }
      return out;
    },
  },

  {
    id: 'aria-hidden-focusable',
    wcag: ['1.3.1', '4.1.2'], level: 'A',
    impact: 'serious',
    title: 'Focusable elements must not be aria-hidden',
    why: 'This creates a "ghost" stop: keyboard users land on a control that screen readers refuse to announce, leaving them stuck with no context.',
    run(doc) {
      const out = [];
      for (const el of doc.elements) {
        if (attr(el, 'aria-hidden') !== 'true') continue;
        const focusableInside = [];
        walk(el, (n) => { if (isElement(n) && isFocusable(n)) focusableInside.push(n); });
        if (!focusableInside.length) continue;
        out.push({
          node: el,
          confidence: DEFINITE,
          message: `aria-hidden="true" hides ${focusableInside.length} focusable element(s) from assistive technology.`,
          fix: {
            strategy: 'manual', confidence: REVIEW,
            guidance: 'Either remove aria-hidden, or make the contained controls unfocusable (tabindex="-1" or the disabled attribute).',
          },
        });
      }
      return out;
    },
  },

  /* ---------- ARIA validity ---------- */
  {
    id: 'aria-valid-role',
    wcag: ['4.1.2'], level: 'A',
    impact: 'serious',
    title: 'ARIA roles must be valid',
    why: 'An unrecognized role is ignored entirely, so the element falls back to its native semantics — usually a meaningless generic div.',
    run(doc) {
      const out = [];
      for (const el of doc.elements) {
        const role = attr(el, 'role');
        if (!role || !role.trim()) continue;
        const invalid = role.trim().split(/\s+/).filter((r) => !VALID_ROLES.has(r.toLowerCase()));
        if (!invalid.length) continue;
        out.push({
          node: el,
          confidence: DEFINITE,
          message: `Invalid ARIA role: "${invalid.join(', ')}".`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Use a valid ARIA role, or remove the attribute and use the matching native HTML element.' },
        });
      }
      return out;
    },
  },

  {
    id: 'aria-valid-attr',
    wcag: ['4.1.2'], level: 'A',
    impact: 'moderate',
    title: 'ARIA attributes must be valid',
    why: 'Misspelled ARIA attributes are silently dropped, so the author believes the element is described when it is not.',
    run(doc) {
      const out = [];
      for (const el of doc.elements) {
        const bad = (el.attrs || [])
          .map((a) => a.name.toLowerCase())
          .filter((name) => name.startsWith('aria-') && !VALID_ARIA_ATTRS.has(name));
        if (!bad.length) continue;
        out.push({
          node: el,
          confidence: DEFINITE,
          message: `Unrecognized ARIA attribute(s): ${bad.join(', ')}.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Correct the spelling or remove the attribute.' },
        });
      }
      return out;
    },
  },

  {
    id: 'aria-required-attr',
    wcag: ['4.1.2'], level: 'A',
    impact: 'serious',
    title: 'ARIA roles must include their required attributes',
    why: 'A role="checkbox" with no aria-checked is announced without its state, so the user cannot tell whether it is ticked.',
    run(doc) {
      const out = [];
      for (const el of doc.elements) {
        const role = (attr(el, 'role') || '').trim().toLowerCase();
        const required = REQUIRED_ARIA_BY_ROLE[role];
        if (!required) continue;
        const missing = required.filter((name) => !hasAttr(el, name));
        if (!missing.length) continue;
        out.push({
          node: el,
          confidence: DEFINITE,
          message: `role="${role}" is missing required attribute(s): ${missing.join(', ')}.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: `Add ${missing.join(' and ')}, and keep the value in sync with the control's state in JavaScript.` },
        });
      }
      return out;
    },
  },

  /* ---------- Sensory and timing ---------- */
  {
    id: 'meta-viewport-zoom',
    wcag: ['1.4.4'], level: 'AA',
    impact: 'serious',
    title: 'Users must be able to zoom',
    why: 'Blocking zoom makes the site unusable for people with low vision on mobile, which is where most traffic now is.',
    run(doc) {
      const out = [];
      for (const meta of elementsByTag(doc, 'meta')) {
        if ((attr(meta, 'name') || '').toLowerCase() !== 'viewport') continue;
        const content = attr(meta, 'content') || '';
        const blocksScaling = /user-scalable\s*=\s*(no|0)/i.test(content);
        const maxScale = content.match(/maximum-scale\s*=\s*([\d.]+)/i);
        const capped = maxScale && parseFloat(maxScale[1]) < 2;
        if (!blocksScaling && !capped) continue;
        const cleaned = content
          .split(',')
          .map((p) => p.trim())
          .filter((p) => !/^user-scalable/i.test(p) && !/^maximum-scale/i.test(p))
          .join(', ');
        out.push({
          node: meta,
          confidence: DEFINITE,
          message: `Viewport meta tag prevents zooming (${blocksScaling ? 'user-scalable=no' : `maximum-scale=${maxScale[1]}`}).`,
          fix: {
            strategy: 'set-attribute', attribute: 'content', value: cleaned || 'width=device-width, initial-scale=1',
            confidence: DEFINITE,
            guidance: 'Removing the zoom restriction has no effect on layout and immediately fixes this failure.',
          },
        });
      }
      return out;
    },
  },

  {
    id: 'meta-refresh',
    wcag: ['2.2.1', '2.2.4'], level: 'A',
    impact: 'serious',
    title: 'Pages must not auto-refresh or redirect on a timer',
    why: 'A timed refresh can interrupt a screen reader mid-sentence or move a user away before they finish reading or filling in a form.',
    run(doc) {
      const out = [];
      for (const meta of elementsByTag(doc, 'meta')) {
        if ((attr(meta, 'http-equiv') || '').toLowerCase() !== 'refresh') continue;
        const content = attr(meta, 'content') || '';
        const seconds = parseFloat(content);
        if (Number.isNaN(seconds) || seconds > 72000) continue;
        out.push({
          node: meta,
          confidence: DEFINITE,
          message: `Page auto-refreshes after ${seconds} seconds.`,
          fix: { strategy: 'remove-element', confidence: REVIEW, guidance: 'Remove the timed refresh, or give the user a control to extend or disable it.' },
        });
      }
      return out;
    },
  },

  {
    id: 'autoplay-media',
    wcag: ['1.4.2'], level: 'A',
    impact: 'serious',
    title: 'Media must not autoplay with sound',
    why: 'Autoplaying audio competes with screen reader speech, making the page impossible to use until the user finds the stop control.',
    run(doc) {
      const out = [];
      for (const media of elementsByTag(doc, 'audio', 'video')) {
        if (!hasAttr(media, 'autoplay')) continue;
        if (hasAttr(media, 'muted')) continue;
        out.push({
          node: media,
          confidence: DEFINITE,
          message: `<${tagName(media)}> autoplays without being muted.`,
          fix: {
            strategy: 'set-attribute', attribute: 'muted', value: '',
            confidence: REVIEW,
            guidance: 'Mute by default, or remove autoplay and let the user start playback.',
          },
        });
      }
      return out;
    },
  },

  {
    id: 'video-captions',
    wcag: ['1.2.2'], level: 'A',
    impact: 'serious',
    title: 'Video needs captions',
    why: 'Deaf and hard-of-hearing users get nothing from uncaptioned video. Captions are also the most frequently requested item in public-sector procurement.',
    run(doc) {
      const out = [];
      for (const video of visibleElements(doc, 'video')) {
        const tracks = children(video).filter((c) => isElement(c) && tagName(c) === 'track');
        const hasCaptions = tracks.some((t) => ['captions', 'subtitles'].includes((attr(t, 'kind') || '').toLowerCase()));
        if (hasCaptions) continue;
        out.push({
          node: video,
          confidence: REVIEW,
          message: 'Video has no <track kind="captions">.',
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Add a caption track. Auto-generated captions must be reviewed for accuracy before they count as conforming.' },
        });
      }
      return out;
    },
  },

  {
    id: 'blink-marquee',
    wcag: ['2.2.2'], level: 'A',
    impact: 'serious',
    title: 'No blinking or scrolling content',
    why: 'Content that moves or blinks without a pause control is a barrier for people with attention and vestibular disorders, and can trigger seizures.',
    run(doc) {
      const out = [];
      for (const el of elementsByTag(doc, 'blink', 'marquee')) {
        out.push({
          node: el,
          confidence: DEFINITE,
          message: `<${tagName(el)}> creates uncontrollable moving content.`,
          fix: { strategy: 'manual', confidence: REVIEW, guidance: 'Replace with static content, or provide a mechanism to pause and stop the motion.' },
        });
      }
      return out;
    },
  },

  /* ---------- Contrast (WCAG 1.4.3) ---------- */
  {
    id: 'color-contrast',
    wcag: ['1.4.3'], level: 'AA', section508: ['502.3'],
    impact: 'serious',
    title: 'Text must have sufficient contrast',
    why: 'Low-contrast text is the most common accessibility failure on the web and directly affects the large population with low vision or age-related sight loss.',
    run(doc, ctx) {
      const out = [];
      if (!ctx.sheet && !ctx.computed) return out;
      const seen = new Set();

      for (const el of doc.elements) {
        if (isHiddenDeep(el)) continue;
        const tag = tagName(el);
        if (['script', 'style', 'head', 'title', 'meta', 'link', 'noscript', 'template', 'br', 'html', 'body'].includes(tag)) continue;

        // Only evaluate elements that directly own visible text.
        const ownText = (el.childNodes || [])
          .filter(isText)
          .map((t) => t.value)
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        if (ownText.length < 2) continue;

        // Prefer what the browser actually painted. Measured values resolve CSS
        // variables, inherited colors and cascade order exactly, so there is
        // nothing left to infer.
        const style = measuredTextStyle(el, ctx) || computeTextStyle(el, ctx.sheet);
        if (!style.resolved || !style.foreground) {
          // Honest degradation: we know there is text but not what it looks like.
          continue;
        }

        const ratio = contrastRatio(style.foreground, style.background);
        const required = requiredRatio({ fontSizePx: style.fontSizePx, bold: style.bold, level: 'AA' });
        if (ratio >= required) continue;

        const key = `${toHex(style.foreground)}|${toHex(style.background)}|${Math.round(style.fontSizePx)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const suggestion = suggestAccessibleColor(style.foreground, style.background, required);
        out.push({
          node: el,
          confidence: DEFINITE,
          message: `Contrast ${formatRatio(ratio)} is below the required ${required}:1 for ${Math.round(style.fontSizePx)}px${style.bold ? ' bold' : ''} text (${toHex(style.foreground)} on ${toHex(style.background)})${style.measured ? ', measured in a real browser' : ''}.`,
          data: {
            foreground: toHex(style.foreground),
            background: toHex(style.background),
            ratio: Math.round(ratio * 100) / 100,
            required,
            suggestion: suggestion ? toHex(suggestion) : null,
          },
          fix: suggestion
            ? {
                strategy: 'css-color',
                property: 'color',
                from: toHex(style.foreground),
                value: toHex(suggestion),
                confidence: REVIEW,
                guidance: `${toHex(suggestion)} on ${toHex(style.background)} reaches ${formatRatio(contrastRatio(suggestion, style.background))}. Confirm it matches your brand palette before applying.`,
              }
            : { strategy: 'manual', confidence: REVIEW, guidance: 'Increase the contrast between text and background.' },
        });
      }
      return out;
    },
  },

  {
    id: 'focus-not-obscured',
    wcag: ['2.4.7'], level: 'AA',
    impact: 'serious',
    title: 'Focus indicator must remain visible',
    why: 'Removing the focus outline leaves keyboard users with no idea where they are on the page. It is a one-line CSS change that breaks the entire site for them.',
    run(doc, ctx) {
      const out = [];
      if (!ctx.rawCss) return out;
      // Detect the classic `:focus { outline: none }` with no replacement style.
      const focusRules = ctx.rawCss.match(/[^{}]*:focus(?:-visible)?[^{}]*\{[^}]*\}/gi) || [];
      const bodyEl = doc.byTag.get('body')?.[0];
      if (!bodyEl) return out;

      const seen = new Set();
      for (const rule of focusRules) {
        const declarations = rule.slice(rule.indexOf('{') + 1, -1);
        const killsOutline = /outline\s*:\s*(none|0(px)?)\s*(!important)?\s*;?/i.test(declarations);
        if (!killsOutline) continue;
        const providesAlternative = /(box-shadow|border|background|outline-offset|text-decoration)\s*:/i.test(
          declarations.replace(/outline\s*:[^;]*;?/gi, '')
        );
        if (providesAlternative) continue;

        // Several stylesheets often carry the same reset; report each selector once.
        const selector = rule.split('{')[0].trim().replace(/\s+/g, ' ').slice(0, 120);
        if (seen.has(selector)) continue;
        seen.add(selector);

        out.push({
          node: bodyEl,
          confidence: REVIEW,
          // The selector is what makes these findings distinct from one another.
          key: selector,
          message: `A CSS rule removes the focus outline without providing a replacement: "${selector.slice(0, 80)}".`,
          fix: {
            strategy: 'manual',
            confidence: REVIEW,
            guidance: 'Replace `outline: none` with a visible custom indicator, e.g. `outline: 2px solid currentColor; outline-offset: 2px`.',
          },
        });
      }
      return out.slice(0, 3);
    },
  },
];

/* ------------------------------------------------------------------ *
 * Helpers used by rules
 * ------------------------------------------------------------------ */

/**
 * Read a browser-measured style for one element, in the shape computeTextStyle
 * returns so the contrast rule can use either source interchangeably.
 * Returns null when the page was not rendered in a browser.
 */
export function measuredTextStyle(element, ctx) {
  if (!ctx.computed) return null;
  const entry = ctx.computed[cssPath(element)];
  if (!entry || !entry.color) return null;

  const foreground = parseColor(entry.color);
  const background = parseColor(entry.background);
  if (!foreground || !background) return null;

  // A translucent element paints its text over the backdrop behind it.
  const opacity = typeof entry.opacity === 'number' && entry.opacity < 1 ? entry.opacity : 1;
  const effective = opacity < 1
    ? flatten([foreground[0], foreground[1], foreground[2], foreground[3] * opacity], background)
    : flatten(foreground, background);

  return {
    foreground: effective,
    background: flatten(background, [255, 255, 255, 1]),
    fontSizePx: entry.fontSize || 16,
    bold: Number(entry.fontWeight) >= 700 || entry.fontWeight === 'bold',
    resolved: true,
    measured: true,
    reason: null,
  };
}

const ICON_HINTS = [
  [/\b(close|dismiss|times|xmark|cross)\b/i, 'Close'],
  [/\b(menu|hamburger|bars)\b/i, 'Open menu'],
  [/\b(search|magnif)\b/i, 'Search'],
  [/\b(cart|basket|bag)\b/i, 'Shopping cart'],
  [/\b(user|account|profile|person)\b/i, 'Account'],
  [/\b(prev|previous|left|back|chevron-left|arrow-left)\b/i, 'Previous'],
  [/\b(next|right|forward|chevron-right|arrow-right)\b/i, 'Next'],
  [/\b(play)\b/i, 'Play'],
  [/\b(pause)\b/i, 'Pause'],
  [/\b(trash|delete|bin|remove)\b/i, 'Delete'],
  [/\b(edit|pencil)\b/i, 'Edit'],
  [/\b(settings|gear|cog)\b/i, 'Settings'],
  [/\b(share)\b/i, 'Share'],
  [/\b(download)\b/i, 'Download'],
  [/\b(print)\b/i, 'Print'],
];

/** Infer a likely control name from icon class names, e.g. `icon-close`. */
export function detectIconHint(element) {
  const haystack = [
    attr(element, 'class') || '',
    attr(element, 'id') || '',
    attr(element, 'data-icon') || '',
  ].join(' ');
  let inner = '';
  walk(element, (n) => {
    if (isElement(n)) inner += ` ${attr(n, 'class') || ''} ${attr(n, 'data-icon') || ''}`;
  });
  const subject = `${haystack} ${inner}`;
  for (const [pattern, label] of ICON_HINTS) {
    if (pattern.test(subject)) return label;
  }
  return null;
}

/** Infer a frame title from well-known embed hosts. */
export function guessFrameTitle(src) {
  if (!src) return null;
  const map = [
    [/youtube|youtu\.be/i, 'YouTube video player'],
    [/vimeo/i, 'Vimeo video player'],
    [/google\.com\/maps|maps\.google/i, 'Google Maps'],
    [/recaptcha/i, 'reCAPTCHA verification'],
    [/stripe/i, 'Stripe payment form'],
    [/paypal/i, 'PayPal payment form'],
    [/spotify/i, 'Spotify player'],
    [/soundcloud/i, 'SoundCloud player'],
    [/typeform|jotform|wufoo/i, 'Embedded form'],
    [/calendly/i, 'Calendly scheduling'],
    [/hubspot/i, 'HubSpot form'],
  ];
  for (const [pattern, title] of map) {
    if (pattern.test(src)) return title;
  }
  return null;
}

// Deeper coverage lives in a second module to keep each file readable. It
// imports only from lib/, so there is no cycle back through this file.
RULES.push(...ADVANCED_RULES);

export const RULES_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));

export default RULES;
