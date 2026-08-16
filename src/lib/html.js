import { parse } from 'parse5';

// Elements that never render content and should be skipped by most rules.
const NON_RENDERED = new Set(['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title', 'base']);

const FOCUSABLE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'audio', 'video', 'details', 'iframe']);

export function tagName(node) {
  return node.tagName ? node.tagName.toLowerCase() : null;
}

export function isElement(node) {
  return Boolean(node.tagName);
}

export function isText(node) {
  return node.nodeName === '#text';
}

export function attr(node, name) {
  if (!node.attrs) return null;
  const found = node.attrs.find((a) => a.name.toLowerCase() === name.toLowerCase());
  return found ? found.value : null;
}

export function hasAttr(node, name) {
  if (!node.attrs) return false;
  return node.attrs.some((a) => a.name.toLowerCase() === name.toLowerCase());
}

export function attrMap(node) {
  const out = {};
  for (const a of node.attrs || []) out[a.name.toLowerCase()] = a.value;
  return out;
}

export function children(node) {
  return node.childNodes || [];
}

/** Depth-first walk over every node. Return false from fn to skip a subtree. */
export function walk(node, fn) {
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (fn(current) === false) continue;
    const kids = current.childNodes;
    if (!kids) continue;
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }
}

/** Visible text content of a subtree, with whitespace collapsed. */
export function textContent(node, { includeHidden = false } = {}) {
  let out = '';
  walk(node, (n) => {
    if (isElement(n)) {
      const t = tagName(n);
      // The skip rules apply to descendants only. Asking for the text of a
      // <title> or a hidden element directly must still return its content.
      if (n !== node) {
        if (NON_RENDERED.has(t)) return false;
        if (!includeHidden && isHidden(n)) return false;
      }
      // Replaced content contributes its alternative text.
      if (t === 'img') {
        const alt = attr(n, 'alt');
        if (alt) out += ` ${alt} `;
        return false;
      }
    } else if (isText(n)) {
      out += n.value;
    }
    return true;
  });
  return out.replace(/\s+/g, ' ').trim();
}

/** True when the element is hidden from all users or from assistive technology. */
export function isHidden(node) {
  if (!isElement(node)) return false;
  if (hasAttr(node, 'hidden')) return true;
  if (attr(node, 'aria-hidden') === 'true') return true;
  if (tagName(node) === 'input' && (attr(node, 'type') || '').toLowerCase() === 'hidden') return true;
  const style = (attr(node, 'style') || '').toLowerCase().replace(/\s+/g, '');
  if (style.includes('display:none') || style.includes('visibility:hidden')) return true;
  return false;
}

/** Hidden either directly or via any ancestor. */
export function isHiddenDeep(node) {
  let current = node;
  while (current) {
    if (isElement(current) && isHidden(current)) return true;
    current = current.parentNode;
  }
  return false;
}

export function isFocusable(node) {
  if (!isElement(node)) return false;
  const t = tagName(node);
  const tabindex = attr(node, 'tabindex');
  if (tabindex !== null && tabindex !== '-1') return true;
  if (tabindex === '-1') return false;
  if (t === 'a' || t === 'area') return hasAttr(node, 'href');
  if (t === 'input') return (attr(node, 'type') || '').toLowerCase() !== 'hidden' && !hasAttr(node, 'disabled');
  if (FOCUSABLE_TAGS.has(t)) return !hasAttr(node, 'disabled');
  if (hasAttr(node, 'contenteditable') && attr(node, 'contenteditable') !== 'false') return true;
  return false;
}

/** Source position of an element's start tag, for patch generation and reporting. */
export function location(node) {
  const loc = node.sourceCodeLocation;
  if (!loc) return null;
  const start = loc.startTag || loc;
  return {
    line: start.startLine,
    col: start.startCol,
    startOffset: start.startOffset,
    endOffset: start.endOffset,
    elementEndOffset: loc.endOffset,
  };
}

/** Exact source text of the element's opening tag. */
export function openingTagSource(node, html) {
  const loc = node.sourceCodeLocation;
  if (!loc) return null;
  const start = loc.startTag || loc;
  return html.slice(start.startOffset, start.endOffset);
}

/** A short, readable snippet for display in the report UI. */
export function snippet(node, html, maxLength = 160) {
  const source = openingTagSource(node, html);
  if (!source) return `<${tagName(node)}>`;
  const collapsed = source.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 1)}…` : collapsed;
}

/**
 * A CSS selector that locates the element for a human. Prefers an id, then falls
 * back to a structural path with nth-of-type disambiguation.
 */
export function cssPath(node) {
  const parts = [];
  let current = node;
  while (current && isElement(current)) {
    const t = tagName(current);
    if (t === 'html') break;
    const id = attr(current, 'id');
    if (id && /^[A-Za-z][\w-]*$/.test(id)) {
      parts.unshift(`#${id}`);
      break;
    }
    const parent = current.parentNode;
    let part = t;
    if (parent && parent.childNodes) {
      const sameTag = parent.childNodes.filter((c) => isElement(c) && tagName(c) === t);
      if (sameTag.length > 1) {
        part += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
      }
    }
    parts.unshift(part);
    current = parent;
  }
  return parts.join(' > ') || tagName(node) || 'html';
}

/**
 * Simplified accessible-name computation covering the cases automated tooling can
 * decide. Returns { name, source }. `source` lets rules explain their reasoning
 * and lets the fixer know which mechanism to write to.
 */
export function accessibleName(node, doc) {
  const labelledby = attr(node, 'aria-labelledby');
  if (labelledby) {
    const names = labelledby
      .split(/\s+/)
      .map((id) => doc.byId.get(id))
      .filter(Boolean)
      .map((el) => textContent(el, { includeHidden: true }))
      .filter(Boolean);
    if (names.length) return { name: names.join(' '), source: 'aria-labelledby' };
  }

  const ariaLabel = attr(node, 'aria-label');
  if (ariaLabel && ariaLabel.trim()) return { name: ariaLabel.trim(), source: 'aria-label' };

  const t = tagName(node);

  if (t === 'img' || t === 'area') {
    const alt = attr(node, 'alt');
    if (alt !== null) return { name: alt.trim(), source: 'alt' };
  }

  if (t === 'input') {
    const type = (attr(node, 'type') || 'text').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'reset') {
      const value = attr(node, 'value');
      if (value && value.trim()) return { name: value.trim(), source: 'value' };
      // Submit and reset inputs have implicit default names.
      if (type === 'submit') return { name: 'Submit', source: 'implicit' };
      if (type === 'reset') return { name: 'Reset', source: 'implicit' };
    }
    if (type === 'image') {
      const alt = attr(node, 'alt');
      if (alt && alt.trim()) return { name: alt.trim(), source: 'alt' };
    }
  }

  if (t === 'input' || t === 'select' || t === 'textarea') {
    const id = attr(node, 'id');
    if (id) {
      const label = doc.labelsFor.get(id);
      if (label) {
        const text = textContent(label, { includeHidden: true });
        if (text) return { name: text, source: 'label-for' };
      }
    }
    const wrapping = ancestor(node, (a) => tagName(a) === 'label');
    if (wrapping) {
      const text = textContent(wrapping, { includeHidden: true });
      if (text) return { name: text, source: 'label-wrap' };
    }
  }

  if (t === 'svg') {
    const titleEl = children(node).find((c) => isElement(c) && tagName(c) === 'title');
    if (titleEl) {
      const text = textContent(titleEl, { includeHidden: true });
      if (text) return { name: text, source: 'svg-title' };
    }
  }

  if (t === 'fieldset') {
    const legend = children(node).find((c) => isElement(c) && tagName(c) === 'legend');
    if (legend) return { name: textContent(legend), source: 'legend' };
  }

  if (t === 'table') {
    const caption = children(node).find((c) => isElement(c) && tagName(c) === 'caption');
    if (caption) return { name: textContent(caption), source: 'caption' };
  }

  // Elements whose name comes from their contents.
  if (['button', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'summary', 'td', 'th', 'legend', 'caption', 'option'].includes(t)) {
    const text = nameFromContent(node, doc);
    if (text) return { name: text, source: 'contents' };
  }

  const title = attr(node, 'title');
  if (title && title.trim()) return { name: title.trim(), source: 'title' };

  return { name: '', source: null };
}

/**
 * Name-from-content traversal.
 *
 * Descendants contribute their own accessible name, not just their text, so an
 * icon-only button whose label lives on a nested `<svg aria-label>` or an
 * `<img alt>` is correctly named. Skipping this is a common source of false
 * "control has no accessible name" reports.
 */
export function nameFromContent(node, doc, depth = 0) {
  if (depth > 5) return '';
  const parts = [];

  for (const child of children(node)) {
    if (isText(child)) {
      parts.push(child.value);
      continue;
    }
    if (!isElement(child)) continue;

    const t = tagName(child);
    if (NON_RENDERED.has(t)) continue;
    if (isHidden(child)) continue;

    // An explicit label on a descendant wins over its own contents.
    const labelledby = attr(child, 'aria-labelledby');
    if (labelledby && doc) {
      const referenced = labelledby
        .split(/\s+/)
        .map((id) => doc.byId.get(id))
        .filter(Boolean)
        .map((el) => textContent(el, { includeHidden: true }));
      if (referenced.length) {
        parts.push(referenced.join(' '));
        continue;
      }
    }

    const ariaLabel = attr(child, 'aria-label');
    if (ariaLabel && ariaLabel.trim()) {
      parts.push(ariaLabel.trim());
      continue;
    }

    if (t === 'img' || t === 'area') {
      const alt = attr(child, 'alt');
      if (alt) parts.push(alt);
      continue;
    }

    if (t === 'svg') {
      const titleEl = children(child).find((c) => isElement(c) && tagName(c) === 'title');
      if (titleEl) parts.push(textContent(titleEl, { includeHidden: true }));
      continue;
    }

    if (t === 'input') {
      const type = (attr(child, 'type') || 'text').toLowerCase();
      if (['submit', 'button', 'reset'].includes(type)) {
        parts.push(attr(child, 'value') || '');
      }
      continue;
    }

    parts.push(nameFromContent(child, doc, depth + 1));
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function ancestor(node, predicate) {
  let current = node.parentNode;
  while (current) {
    if (isElement(current) && predicate(current)) return current;
    current = current.parentNode;
  }
  return null;
}

export function closestRole(node) {
  const explicit = attr(node, 'role');
  if (explicit) return explicit.trim().split(/\s+/)[0].toLowerCase();
  return implicitRole(node);
}

const IMPLICIT_ROLES = {
  a: 'link',
  article: 'article',
  aside: 'complementary',
  button: 'button',
  footer: 'contentinfo',
  form: 'form',
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
  header: 'banner',
  img: 'img',
  main: 'main',
  nav: 'navigation',
  ol: 'list',
  section: 'region',
  select: 'combobox',
  table: 'table',
  textarea: 'textbox',
  ul: 'list',
  li: 'listitem',
  dialog: 'dialog',
  output: 'status',
  progress: 'progressbar',
  summary: 'button',
};

export function implicitRole(node) {
  const t = tagName(node);
  if (t === 'a' || t === 'area') return hasAttr(node, 'href') ? 'link' : null;
  if (t === 'input') {
    const type = (attr(node, 'type') || 'text').toLowerCase();
    const map = {
      button: 'button', submit: 'button', reset: 'button', image: 'button',
      checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton',
      email: 'textbox', tel: 'textbox', text: 'textbox', url: 'textbox', search: 'searchbox',
    };
    return map[type] || null;
  }
  return IMPLICIT_ROLES[t] || null;
}

/**
 * Parse HTML into an indexed document. Indexing once up front keeps the rules
 * simple and keeps a full scan linear in document size.
 */
export function parseDocument(html, { url = null } = {}) {
  const root = parse(html, { sourceCodeLocationInfo: true });

  const doc = {
    root,
    html,
    url,
    elements: [],
    byId: new Map(),
    byTag: new Map(),
    labelsFor: new Map(),
    duplicateIds: new Map(),
  };

  walk(root, (node) => {
    if (!isElement(node)) return;
    doc.elements.push(node);

    const t = tagName(node);
    if (!doc.byTag.has(t)) doc.byTag.set(t, []);
    doc.byTag.get(t).push(node);

    const id = attr(node, 'id');
    if (id) {
      if (doc.byId.has(id)) {
        if (!doc.duplicateIds.has(id)) doc.duplicateIds.set(id, [doc.byId.get(id)]);
        doc.duplicateIds.get(id).push(node);
      } else {
        doc.byId.set(id, node);
      }
    }

    if (t === 'label') {
      const forId = attr(node, 'for');
      if (forId && !doc.labelsFor.has(forId)) doc.labelsFor.set(forId, node);
    }
  });

  return doc;
}

export function elementsByTag(doc, ...tags) {
  const out = [];
  for (const t of tags) {
    const list = doc.byTag.get(t);
    if (list) out.push(...list);
  }
  return out;
}

export { NON_RENDERED };
