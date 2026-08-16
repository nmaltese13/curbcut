import { attr, tagName, isElement } from './html.js';
import { parseColor, flatten } from './color.js';

// A deliberately small CSS engine. It resolves the subset of the cascade needed
// for text contrast: literal colors set by simple selectors and inline styles.
// Anything outside that subset is reported as unresolved rather than guessed,
// because a fabricated contrast number is worse than an honest "needs review".

const UNSUPPORTED_SELECTOR = /[[\]:]|::|\bnot\(|\+|~/;

function parseDeclarations(text) {
  const decls = {};
  for (const chunk of text.split(';')) {
    const colon = chunk.indexOf(':');
    if (colon === -1) continue;
    const prop = chunk.slice(0, colon).trim().toLowerCase();
    let value = chunk.slice(colon + 1).trim();
    if (!prop || !value) continue;
    const important = /!important$/i.test(value);
    if (important) value = value.replace(/!important$/i, '').trim();
    decls[prop] = { value, important };
  }
  return decls;
}

function specificity(selector) {
  const ids = (selector.match(/#[\w-]+/g) || []).length;
  const classes = (selector.match(/\.[\w-]+/g) || []).length;
  const types = (selector.replace(/[#.][\w-]+/g, '').match(/\b[a-z][\w-]*/gi) || []).length;
  return [ids, classes, types];
}

function compareSpecificity(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a.spec[i] !== b.spec[i]) return a.spec[i] - b.spec[i];
  }
  return a.order - b.order;
}

/**
 * Parse a stylesheet into flat rules. Returns { rules, unsupported } where
 * `unsupported` counts color-affecting rules we could not model.
 */
export function parseStylesheet(cssText) {
  const rules = [];
  let unsupported = 0;
  if (!cssText) return { rules, unsupported };

  // Strip comments, then walk blocks. At-rules that contain nested rulesets are
  // unwrapped; media queries that clearly do not apply to screens are dropped.
  const text = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  let order = 0;

  const walkBlocks = (source, inAtRule = false) => {
    let i = 0;
    while (i < source.length) {
      const braceStart = source.indexOf('{', i);
      if (braceStart === -1) break;
      const prelude = source.slice(i, braceStart).trim();

      // Find the matching close brace, accounting for nesting.
      let depth = 1;
      let j = braceStart + 1;
      while (j < source.length && depth > 0) {
        if (source[j] === '{') depth += 1;
        else if (source[j] === '}') depth -= 1;
        j += 1;
      }
      const body = source.slice(braceStart + 1, j - 1);
      i = j;

      if (prelude.startsWith('@')) {
        const atName = prelude.slice(1).split(/[\s(]/)[0].toLowerCase();
        if (atName === 'media') {
          if (/\bprint\b/.test(prelude) && !/\bscreen\b/.test(prelude)) continue;
          walkBlocks(body, true);
        } else if (atName === 'supports' || atName === 'layer' || atName === 'scope') {
          walkBlocks(body, true);
        }
        // keyframes, font-face, import and friends never affect element color.
        continue;
      }

      const decls = parseDeclarations(body);
      const touchesColor = 'color' in decls || 'background-color' in decls || 'background' in decls;

      for (const rawSelector of prelude.split(',')) {
        const selector = rawSelector.trim();
        if (!selector) continue;
        if (UNSUPPORTED_SELECTOR.test(selector)) {
          if (touchesColor) unsupported += 1;
          continue;
        }
        order += 1;
        rules.push({ selector, decls, spec: specificity(selector), order, inAtRule });
      }
    }
  };

  walkBlocks(text);
  return { rules, unsupported };
}

function matchesCompound(element, compound) {
  if (!isElement(element)) return false;
  const parts = compound.match(/^[a-z][\w-]*|[#.][\w-]+|\*/gi) || [];
  if (!parts.length) return false;
  const classList = (attr(element, 'class') || '').split(/\s+/).filter(Boolean);
  for (const part of parts) {
    if (part === '*') continue;
    if (part.startsWith('#')) {
      if (attr(element, 'id') !== part.slice(1)) return false;
    } else if (part.startsWith('.')) {
      if (!classList.includes(part.slice(1))) return false;
    } else if (tagName(element) !== part.toLowerCase()) {
      return false;
    }
  }
  return true;
}

/** Match a complex selector right-to-left against an element. */
export function matches(element, selector) {
  const tokens = selector.trim().split(/\s*(>)\s*|\s+/).filter(Boolean);
  let current = element;
  let i = tokens.length - 1;

  if (!matchesCompound(current, tokens[i])) return false;
  i -= 1;

  while (i >= 0) {
    const token = tokens[i];
    if (token === '>') {
      const compound = tokens[i - 1];
      const parent = current.parentNode;
      if (!parent || !matchesCompound(parent, compound)) return false;
      current = parent;
      i -= 2;
    } else {
      // Descendant combinator: walk up until a match is found.
      let found = null;
      let node = current.parentNode;
      while (node) {
        if (matchesCompound(node, token)) { found = node; break; }
        node = node.parentNode;
      }
      if (!found) return false;
      current = found;
      i -= 1;
    }
  }
  return true;
}

/** Resolve declared (non-inherited) property values for one element. */
export function declaredStyle(element, sheet) {
  const winners = {};
  const candidates = [];

  for (const rule of sheet.rules) {
    if (!matches(element, rule.selector)) continue;
    candidates.push(rule);
  }
  candidates.sort(compareSpecificity);

  for (const rule of candidates) {
    for (const [prop, entry] of Object.entries(rule.decls)) {
      const existing = winners[prop];
      if (!existing || !existing.important || entry.important) {
        winners[prop] = entry;
      }
    }
  }

  const inline = attr(element, 'style');
  if (inline) {
    for (const [prop, entry] of Object.entries(parseDeclarations(inline))) {
      const existing = winners[prop];
      if (!existing || !existing.important || entry.important) winners[prop] = entry;
    }
  }

  const out = {};
  for (const [prop, entry] of Object.entries(winners)) out[prop] = entry.value;
  return out;
}

function backgroundColorFrom(style) {
  if (style['background-color']) return style['background-color'];
  if (style.background) {
    // Only trust a shorthand that is a bare color; images and gradients are not
    // something we can evaluate.
    const value = style.background.trim();
    if (/url\(|gradient/i.test(value)) return null;
    const firstColor = value.split(/\s+/).find((token) => parseColor(token));
    return firstColor || null;
  }
  return null;
}

function parseFontSize(value, inherited) {
  if (!value) return inherited;
  const raw = value.trim().toLowerCase();
  const keywords = {
    'xx-small': 9, 'x-small': 10, small: 13, medium: 16,
    large: 18, 'x-large': 24, 'xx-large': 32,
  };
  if (keywords[raw]) return keywords[raw];
  const num = parseFloat(raw);
  if (Number.isNaN(num)) return inherited;
  if (raw.endsWith('px')) return num;
  if (raw.endsWith('pt')) return num * (96 / 72);
  if (raw.endsWith('rem')) return num * 16;
  if (raw.endsWith('em')) return num * inherited;
  if (raw.endsWith('%')) return (num / 100) * inherited;
  return num;
}

function isBold(weight) {
  if (!weight) return false;
  const raw = String(weight).trim().toLowerCase();
  if (raw === 'bold' || raw === 'bolder') return true;
  const num = parseInt(raw, 10);
  return !Number.isNaN(num) && num >= 700;
}

/**
 * Compute the effective text color, backdrop, font size and weight for an
 * element by walking the ancestor chain. Returns `resolved: false` when the
 * backdrop or foreground could not be determined from the CSS we can see.
 */
export function computeTextStyle(element, sheet) {
  const chain = [];
  let node = element;
  while (node && isElement(node)) {
    chain.unshift(node);
    node = node.parentNode;
  }

  let color = null;
  let fontSizePx = 16;
  let bold = false;
  const backdrops = [];

  for (const el of chain) {
    const style = declaredStyle(el, sheet);
    const tag = tagName(el);

    if (style.color) {
      const parsed = parseColor(style.color);
      if (parsed) color = parsed;
      else if (!/inherit|currentcolor/i.test(style.color)) color = null;
    }

    fontSizePx = parseFontSize(style['font-size'], fontSizePx);
    if (tag && /^h[1-6]$/.test(tag) && !style['font-size']) {
      fontSizePx = { h1: 32, h2: 24, h3: 18.72, h4: 16, h5: 13.28, h6: 10.72 }[tag];
    }

    if (style['font-weight']) bold = isBold(style['font-weight']);
    if (tag && (/^h[1-6]$/.test(tag) || tag === 'strong' || tag === 'b') && !style['font-weight']) bold = true;

    const bg = backgroundColorFrom(style);
    if (bg) {
      const parsed = parseColor(bg);
      if (parsed && parsed[3] > 0) backdrops.push(parsed);
      else if (!parsed) backdrops.push(null); // Unresolvable backdrop.
    }
  }

  // Default page background is white unless something opaque was declared.
  let background = [255, 255, 255, 1];
  let backgroundResolved = true;
  for (const layer of backdrops) {
    if (layer === null) { backgroundResolved = false; continue; }
    background = flatten(layer, background);
  }

  const resolved = Boolean(color) && backgroundResolved;
  const foreground = color ? flatten(color, background) : null;

  return {
    foreground,
    background,
    fontSizePx,
    bold,
    resolved,
    reason: !color ? 'text color not declared in available CSS' : (!backgroundResolved ? 'background could not be resolved' : null),
  };
}
