(() => {
  'use strict';
  const pending = new WeakMap();
  window.LandingLeads = Object.freeze({
    async submit(form, endpoint) {
      const fields = Object.fromEntries(new FormData(form));
      const [prefix, phoneCountry] = fields.dialCode.split('|');
      delete fields.dialCode;
      fields.phone = `${prefix} ${fields.phone.trim()}`;
      fields.phoneCountry = phoneCountry;
      fields.consent = fields.consent === 'on';
      const signature = JSON.stringify(fields);
      let entry = pending.get(form);
      if (!entry || entry.signature !== signature) {
        entry = { signature, requestId: crypto.randomUUID() };
        pending.set(form, entry);
      }
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, requestId: entry.requestId }),
        signal: AbortSignal.timeout(30000),
      });
      const result = await response.json();
      if (!response.ok || result?.ok !== true || result.id !== entry.requestId) {
        throw new Error(result?.error || 'No se pudo confirmar el registro. Inténtalo de nuevo.');
      }
      pending.delete(form);
      return response;
    },
  });
})();
