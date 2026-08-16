/**
 * Auto-escaping HTML templating.
 *
 * Every interpolated value is escaped unless it is explicitly wrapped in raw().
 * Making the safe path the default is the only reliable way to avoid XSS in a
 * server-rendered app that displays user-supplied URLs and page snippets.
 */

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

const RAW = Symbol('raw-html');

export function raw(value) {
  return { [RAW]: String(value ?? '') };
}

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (typeof value === 'object' && RAW in value) return value[RAW];
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += render(values[i]) + strings[i + 1];
  }
  return raw(out);
}

/** Render a template result (or plain string) to a final string. */
export function toString(value) {
  return render(value);
}

/** Build a class attribute from conditional parts. */
export function classes(...parts) {
  return parts
    .flatMap((part) => {
      if (!part) return [];
      if (typeof part === 'string') return [part];
      return Object.entries(part).filter(([, on]) => on).map(([name]) => name);
    })
    .join(' ');
}
