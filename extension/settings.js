export const OPTION_DEFAULTS = Object.freeze({ precondition: true, steps: true, bugSteps: true, copyCase: true, doubleSpacing: true });

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
  // Keep the stored fields key so existing selections need no migration.
  return {
    enabledOrigins: [...new Set((Array.isArray(value?.enabledOrigins) ? value.enabledOrigins : [])
      .map(webOrigin).filter(Boolean))],
    fields: Object.fromEntries(Object.entries(OPTION_DEFAULTS).map(([key, fallback]) =>
      [key, typeof value?.fields?.[key] === "boolean" ? value.fields[key] : fallback]))
  };
}
