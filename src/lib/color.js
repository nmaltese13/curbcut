// Color parsing and WCAG contrast math (WCAG 2.x relative luminance definition).

const NAMED = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1], white: [255, 255, 255, 1], red: [255, 0, 0, 1],
  green: [0, 128, 0, 1], blue: [0, 0, 255, 1], yellow: [255, 255, 0, 1],
  orange: [255, 165, 0, 1], purple: [128, 0, 128, 1], gray: [128, 128, 128, 1],
  grey: [128, 128, 128, 1], silver: [192, 192, 192, 1], maroon: [128, 0, 0, 1],
  olive: [128, 128, 0, 1], lime: [0, 255, 0, 1], aqua: [0, 255, 255, 1],
  cyan: [0, 255, 255, 1], teal: [0, 128, 128, 1], navy: [0, 0, 128, 1],
  fuchsia: [255, 0, 255, 1], magenta: [255, 0, 255, 1], pink: [255, 192, 203, 1],
  brown: [165, 42, 42, 1], gold: [255, 215, 0, 1], indigo: [75, 0, 130, 1],
  violet: [238, 130, 238, 1], beige: [245, 245, 220, 1], ivory: [255, 255, 240, 1],
  khaki: [240, 230, 140, 1], salmon: [250, 128, 114, 1], tan: [210, 180, 140, 1],
  crimson: [220, 20, 60, 1], coral: [255, 127, 80, 1], turquoise: [64, 224, 208, 1],
  lavender: [230, 230, 250, 1], plum: [221, 160, 221, 1], orchid: [218, 112, 214, 1],
  whitesmoke: [245, 245, 245, 1], lightgray: [211, 211, 211, 1], lightgrey: [211, 211, 211, 1],
  darkgray: [169, 169, 169, 1], darkgrey: [169, 169, 169, 1], dimgray: [105, 105, 105, 1],
  slategray: [112, 128, 144, 1], slategrey: [112, 128, 144, 1],
  lightblue: [173, 216, 230, 1], darkblue: [0, 0, 139, 1], skyblue: [135, 206, 235, 1],
  steelblue: [70, 130, 180, 1], royalblue: [65, 105, 225, 1], dodgerblue: [30, 144, 255, 1],
  darkgreen: [0, 100, 0, 1], lightgreen: [144, 238, 144, 1], forestgreen: [34, 139, 34, 1],
  seagreen: [46, 139, 87, 1], darkred: [139, 0, 0, 1], firebrick: [178, 34, 34, 1],
  tomato: [255, 99, 71, 1], goldenrod: [218, 165, 32, 1], chocolate: [210, 105, 30, 1],
  linen: [250, 240, 230, 1], snow: [255, 250, 250, 1], azure: [240, 255, 255, 1],
  ghostwhite: [248, 248, 255, 1], aliceblue: [240, 248, 255, 1], honeydew: [240, 255, 240, 1],
  mintcream: [245, 255, 250, 1], seashell: [255, 245, 238, 1], oldlace: [253, 245, 230, 1],
  gainsboro: [220, 220, 220, 1], lightsteelblue: [176, 196, 222, 1],
  midnightblue: [25, 25, 112, 1], darkslategray: [47, 79, 79, 1],
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hueToRgb(p, q, t) {
  let temp = t;
  if (temp < 0) temp += 1;
  if (temp > 1) temp -= 1;
  if (temp < 1 / 6) return p + (q - p) * 6 * temp;
  if (temp < 1 / 2) return q;
  if (temp < 2 / 3) return p + (q - p) * (2 / 3 - temp) * 6;
  return p;
}

/**
 * Parse a CSS color string into [r, g, b, a], or null when the value is not a
 * literal color we can evaluate (var(), gradients, currentColor, system colors).
 * Returning null is important: it lets rules downgrade to "needs review" instead
 * of reporting a contrast number that was never actually computed.
 */
export function parseColor(input) {
  if (!input) return null;
  const value = String(input).trim().toLowerCase();
  if (!value) return null;

  if (Object.hasOwn(NAMED, value)) return [...NAMED[value]];

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4) {
      const parts = hex.split('').map((c) => parseInt(c + c, 16));
      return [parts[0], parts[1], parts[2], hex.length === 4 ? parts[3] / 255 : 1];
    }
    if (hex.length === 6 || hex.length === 8) {
      const parts = [];
      for (let i = 0; i < hex.length; i += 2) parts.push(parseInt(hex.slice(i, i + 2), 16));
      return [parts[0], parts[1], parts[2], hex.length === 8 ? parts[3] / 255 : 1];
    }
    return null;
  }

  const fn = value.match(/^(rgba?|hsla?)\(([^)]+)\)$/);
  if (!fn) return null;
  const name = fn[1];
  // Accept both legacy comma syntax and modern space syntax.
  const parts = fn[2].split(/[,/]|\s+/).filter((p) => p !== '');
  if (parts.length < 3) return null;

  const alpha = parts.length >= 4 ? parseAlpha(parts[3]) : 1;
  if (alpha === null) return null;

  if (name === 'rgb' || name === 'rgba') {
    const channels = parts.slice(0, 3).map((p) =>
      p.endsWith('%') ? Math.round((parseFloat(p) / 100) * 255) : parseFloat(p)
    );
    if (channels.some((c) => Number.isNaN(c))) return null;
    return [clamp(channels[0], 0, 255), clamp(channels[1], 0, 255), clamp(channels[2], 0, 255), alpha];
  }

  const h = ((parseFloat(parts[0]) % 360) + 360) % 360 / 360;
  const s = clamp(parseFloat(parts[1]) / 100, 0, 1);
  const l = clamp(parseFloat(parts[2]) / 100, 0, 1);
  if ([h, s, l].some((n) => Number.isNaN(n))) return null;
  if (s === 0) {
    const gray = Math.round(l * 255);
    return [gray, gray, gray, alpha];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    Math.round(hueToRgb(p, q, h) * 255),
    Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
    alpha,
  ];
}

function parseAlpha(raw) {
  if (raw === undefined) return 1;
  const v = raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw);
  return Number.isNaN(v) ? null : clamp(v, 0, 1);
}

/** Composite a possibly translucent foreground over an opaque backdrop. */
export function flatten(color, backdrop) {
  const [r, g, b, a] = color;
  if (a >= 1) return [r, g, b, 1];
  const [br, bg, bb] = backdrop;
  return [
    Math.round(r * a + br * (1 - a)),
    Math.round(g * a + bg * (1 - a)),
    Math.round(b * a + bb * (1 - a)),
    1,
  ];
}

export function relativeLuminance([r, g, b]) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground, background) {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * WCAG 1.4.3 / 1.4.6 thresholds. Large text is >=18pt (24px) or >=14pt (18.66px)
 * bold.
 */
export function requiredRatio({ fontSizePx = 16, bold = false, level = 'AA' } = {}) {
  const isLarge = fontSizePx >= 24 || (bold && fontSizePx >= 18.66);
  if (level === 'AAA') return isLarge ? 4.5 : 7;
  return isLarge ? 3 : 4.5;
}

export function formatRatio(ratio) {
  return `${Math.round(ratio * 100) / 100}:1`;
}

export function toHex([r, g, b]) {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Darken or lighten a foreground color until it meets the target ratio against a
 * fixed background. Used to propose a concrete replacement color in fixes.
 */
export function suggestAccessibleColor(foreground, background, target) {
  const bgLum = relativeLuminance(background);
  // Move away from the background: darken on light backgrounds, lighten on dark.
  const goDarker = bgLum > 0.5;
  let best = null;
  for (let step = 1; step <= 100; step += 1) {
    const factor = step / 100;
    const candidate = foreground.slice(0, 3).map((c) =>
      goDarker ? Math.round(c * (1 - factor)) : Math.round(c + (255 - c) * factor)
    );
    if (contrastRatio(candidate, background) >= target) {
      best = candidate;
      break;
    }
  }
  return best;
}
