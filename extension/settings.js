export const LINE_HEIGHTS = Object.freeze(["default", 1.5, 2, 2.5, 3]);
export const OPTION_DEFAULTS = Object.freeze({ precondition: true, steps: true, bugSteps: true, copyCase: true, lineHeight: 2 });
export const BOOLEAN_OPTION_KEYS = Object.freeze(Object.keys(OPTION_DEFAULTS).filter(key => typeof OPTION_DEFAULTS[key] === "boolean"));

export function validOptions(value) {
  return Boolean(value && BOOLEAN_OPTION_KEYS.every(key => typeof value[key] === "boolean") && LINE_HEIGHTS.includes(value.lineHeight));
}

export function webOrigin(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.origin : null;
  } catch { return null; }
}

export function hostPattern(origin) {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

export function normalizeSettings(value) {
  // Preserve the fields storage key and map the former spacing checkbox on read.
  const fields = value?.fields;
  const oldLineHeight = fields?.doubleSpacing === false ? "default" : OPTION_DEFAULTS.lineHeight;
  return {
    enabledOrigins: [...new Set((Array.isArray(value?.enabledOrigins) ? value.enabledOrigins : [])
      .map(webOrigin).filter(Boolean))],
    fields: {
      ...Object.fromEntries(BOOLEAN_OPTION_KEYS.map(key => [key, typeof fields?.[key] === "boolean" ? fields[key] : OPTION_DEFAULTS[key]])),
      lineHeight: LINE_HEIGHTS.includes(fields?.lineHeight) ? fields.lineHeight : oldLineHeight
    }
  };
}
