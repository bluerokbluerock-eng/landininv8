(() => {
  'use strict';
  const pending = new WeakMap();
  const storageKey = 'landingv8:last-submission';
  const retryWindow = 30 * 60 * 1000;
  const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  async function fingerprint(signature) {
    try {
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature));
      return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    } catch {
      return null;
    }
  }

  function restore(key, now) {
    if (!key) return;
    try {
      const entry = JSON.parse(sessionStorage.getItem(storageKey));
      if (entry?.key === key && entry.expiresAt > now && requestIdPattern.test(entry.requestId)) {
        return { requestId: entry.requestId, expiresAt: entry.expiresAt, confirmed: entry.confirmed === true };
      }
    } catch {}
  }

  function remember({ key, requestId, expiresAt, confirmed }) {
    if (!key) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ key, requestId, expiresAt, confirmed }));
    } catch {}
  }

  window.LandingLeads = Object.freeze({
    async submit(form, endpoint) {
      const fields = Object.fromEntries(new FormData(form));
      const [prefix, phoneCountry] = fields.dialCode.split('|');
      delete fields.dialCode;
      fields.phone = `${prefix} ${fields.phone.trim()}`;
      fields.phoneCountry = phoneCountry;
      fields.consent = fields.consent === 'on';
      const signature = JSON.stringify(fields);
      const key = await fingerprint(signature);
      const now = Date.now();
      let entry = pending.get(form);
      if (entry?.signature !== signature || entry.expiresAt <= now) {
        const retry = restore(key, now);
        entry = {
          signature,
          key,
          requestId: retry?.requestId ?? crypto.randomUUID(),
          expiresAt: retry?.expiresAt ?? now + retryWindow,
          confirmed: retry?.confirmed ?? false,
        };
        pending.set(form, entry);
      }
      remember(entry);
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, requestId: entry.requestId }),
        signal: AbortSignal.timeout(30000),
      });
      const result = await response.json();
      if (!response.ok || result?.ok !== true || result.id !== entry.requestId) {
        throw new Error(result?.error || 'No se pudo confirmar el registro. Inténtalo de nuevo.');
      }
      const trackRegistration = !entry.confirmed;
      entry.confirmed = true;
      remember(entry);
      return { id: result.id, trackRegistration };
    },
  });
})();
