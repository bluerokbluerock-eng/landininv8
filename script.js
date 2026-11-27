(() => {
  'use strict';

  const page = document.getElementById('landing-page');
  const success = document.getElementById('success-page');
  const form = document.getElementById('lead-form');
  const { fullName, phone, dialCode, country, incidentMonths, birthDate, consent } = form.elements;
  const lossBand = document.getElementById('lossBand');
  const lossOptions = document.getElementById('loss-band-options');
  const lossStatus = document.getElementById('loss-band-status');
  const summary = document.getElementById('form-error-summary');
  const submitError = document.getElementById('submit-error');
  const button = form.querySelector('button[type="submit"]');
  const buttonLabel = button.querySelector('span');
  const buttonIcon = button.querySelector('svg');
  const readyLabel = buttonLabel.textContent;
  const today = new Date().toISOString().slice(0, 10);
  const adultCutoff = `${Number(today.slice(0, 4)) - 18}${today.slice(4)}`;
  const countries = {
    MX: { name: 'México', dialCode: '+52|MX', currency: 'MXN' },
    AR: { name: 'Argentina', dialCode: '+54|AR', currency: 'ARS' },
    PY: { name: 'Paraguay', dialCode: '+595|PY', currency: 'PYG' },
  };
  const usdThresholds = [13000, 28000, 50000];
  const localFormats = {
    MXN: new Intl.NumberFormat('es-MX'),
    ARS: new Intl.NumberFormat('es-AR'),
    PYG: new Intl.NumberFormat('es-PY'),
  };
  const exchangeRates = {};
  const loadingRates = new Set();
  let countryEdited = false;
  let dialCodeEdited = false;
  let detectedCountry;
  let lossCurrency;
  birthDate.max = today;
  document.getElementById('footer-year').textContent = today.slice(0, 4);

  function setError(field, message = '') {
    const error = document.getElementById(`${field.id}-error`);
    error.textContent = message;
    error.hidden = !message;
    if (message) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
    if (field === phone) field.closest('.phone-input').classList.toggle('input-error', Boolean(message));
  }

  function selectedCountry() {
    const value = country.value.trim();
    return Object.values(countries).find(({ name }) =>
      name.localeCompare(value, 'es', { sensitivity: 'base' }) === 0
    );
  }

  function thresholdsForCurrency(currency) {
    if (currency === 'MXN') return [250000, 550000, 950000];
    if (exchangeRates[currency]) return usdThresholds.map(value => Math.ceil(value * exchangeRates[currency]));
  }

  function formatLocalAmount(value, currency) {
    const symbol = currency === 'PYG' ? '₲' : '$';
    return `${symbol}${localFormats[currency].format(value)}`;
  }

  function minimumLossMessage() {
    const [minimum] = thresholdsForCurrency(lossCurrency);
    return `Evaluamos casos desde ${formatLocalAmount(minimum, lossCurrency)} ${lossCurrency}.`;
  }

  function renderLossBands() {
    const currency = lossCurrency;
    const thresholds = thresholdsForCurrency(currency);
    lossOptions.replaceChildren();
    lossOptions.hidden = !thresholds;
    lossStatus.hidden = Boolean(thresholds);
    if (!thresholds) {
      if (!currency) lossStatus.textContent = 'Selecciona tu país de residencia.';
      else if (loadingRates.has(currency)) lossStatus.textContent = `Cargando montos en ${currency}…`;
      else lossStatus.textContent = `Montos en ${currency} no disponibles.`;
      return;
    }

    const [low, middle, high] = thresholds.map(value => formatLocalAmount(value, currency));
    const bands = [
      ['under-13k', `Menos de ${low}`, '(< ~$13k USD)'],
      ['13k-28k', `${low}\u00a0– ${middle}`, '(~$13k – $28k USD)'],
      ['28k-50k', `${middle}\u00a0– ${high}`, '(~$28k – $50k USD)'],
      ['over-50k', `Más de ${high}`, '(> ~$50k USD)'],
    ];
    for (const [value, amount, reference] of bands) {
      const label = document.createElement('label');
      label.className = 'loss-band-option';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'lossBand';
      radio.value = value;
      radio.required = true;
      const local = document.createElement('span');
      local.className = 'loss-band-amount';
      local.textContent = `${amount}\u00a0${currency}`;
      const usd = document.createElement('span');
      usd.className = 'loss-band-reference';
      usd.textContent = reference.replace(' USD', '\u00a0USD');
      label.append(radio, local, usd);
      lossOptions.append(label);
    }
  }

  async function loadExchangeRate(currency) {
    if (loadingRates.has(currency) || location.protocol === 'file:') return;
    loadingRates.add(currency);
    renderLossBands();
    try {
      const response = await fetch(`/api/loss-rate/${currency}`, { signal: AbortSignal.timeout(4500) });
      if (!response.ok) return;
      const { rate } = await response.json();
      if (Number.isFinite(rate) && rate > 0) exchangeRates[currency] = rate;
    } catch {
      // A temporary outage leaves this currency's amounts unavailable.
    } finally {
      loadingRates.delete(currency);
      if (lossCurrency === currency) {
        renderLossBands();
        if (exchangeRates[currency]) {
          setError(lossBand);
          summary.hidden = !form.querySelector('[aria-invalid="true"]');
        }
      }
    }
  }

  function updateCountry() {
    const selection = selectedCountry();
    if (selection && !dialCodeEdited) dialCode.value = selection.dialCode;
    if (lossCurrency === selection?.currency) return;
    lossCurrency = selection?.currency;
    setError(lossBand);
    renderLossBands();
    if (lossCurrency && !thresholdsForCurrency(lossCurrency)) void loadExchangeRate(lossCurrency);
  }

  async function fetchDetectedCountry(url, countryField) {
    try {
      const response = await fetch(url, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) return;
      const data = await response.json();
      const code = data?.[countryField];
      if (Object.hasOwn(countries, code)) return countries[code];
    } catch {
      // The visitor can still select their country and dial code.
    }
  }

  async function detectCountry() {
    if (location.protocol !== 'file:') {
      detectedCountry = await fetchDetectedCountry('/api/form-context', 'countryCode');
    }
    detectedCountry ??= await fetchDetectedCountry('https://api.country.is/', 'country');
    if (!detectedCountry || countryEdited) return;
    country.value = detectedCountry.name;
    setError(country);
    updateCountry();
    summary.hidden = !form.querySelector('[aria-invalid="true"]');
  }

  form.addEventListener('input', ({ target }) => {
    if (target.hasAttribute('aria-describedby')) setError(target);
    if (target === country) {
      countryEdited = true;
      updateCountry();
    }
    if (target === dialCode) dialCodeEdited = true;
    if (target.name === 'lossBand') setError(lossBand, target.value === 'under-13k' ? minimumLossMessage() : '');
    submitError.hidden = true;
    if (!summary.hidden) summary.hidden = !form.querySelector('[aria-invalid="true"]');
  });
  updateCountry();
  void detectCountry();

  function validate() {
    setError(fullName, fullName.value.trim().length < 3 ? 'Introduce tu nombre completo.' : '');
    const number = phone.value.trim();
    const validPhone = /^[\d ()-]{7,18}$/.test(number) && number.replace(/\D/g, '').length >= 7;
    setError(phone, validPhone ? '' : 'Introduce un número de teléfono válido.');
    const selection = selectedCountry();
    setError(country, selection ? '' : 'Selecciona un país de la lista.');
    if (selection) country.value = selection.name;
    updateCountry();

    const selectedBand = lossOptions.querySelector('input:checked');
    let lossError = '';
    if (selectedBand?.value === 'under-13k') lossError = minimumLossMessage();
    else if (lossCurrency && !thresholdsForCurrency(lossCurrency)) {
      lossError = loadingRates.has(lossCurrency)
        ? `Espera a que carguen los montos en ${lossCurrency}.`
        : `Vuelve a intentar cargar los montos en ${lossCurrency}.`;
      void loadExchangeRate(lossCurrency);
    } else if (!selectedBand && selection) lossError = 'Selecciona el rango del monto perdido.';
    setError(lossBand, lossError);
    setError(incidentMonths, incidentMonths.value ? '' : 'Indica hace cuánto ocurrió.');

    let dateError = '';
    if (birthDate.validity.badInput || birthDate.validity.rangeUnderflow || birthDate.validity.rangeOverflow) {
      dateError = 'Introduce una fecha de nacimiento válida.';
    } else if (birthDate.value && birthDate.value > adultCutoff) {
      dateError = 'Debes ser mayor de edad para continuar.';
    }
    setError(birthDate, dateError);
    setError(consent, consent.checked ? '' : 'Debes autorizar el tratamiento de tus datos.');
    summary.hidden = !form.querySelector('[aria-invalid="true"]');
    if (!summary.hidden) summary.focus();
    return summary.hidden;
  }

  function goToTop(target) {
    target.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  for (const cta of document.querySelectorAll('a.primary-button[href="#evaluacion"]')) {
    cta.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      document.getElementById('evaluacion').scrollIntoView({ block: 'start' });
      fullName.focus({ preventScroll: true });
    });
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    submitError.hidden = true;
    if (!validate()) return;
    if (location.protocol === 'file:') {
      submitError.textContent = 'Abre la página desde el servidor para enviar la solicitud.';
      submitError.hidden = false;
      return;
    }

    button.disabled = true;
    buttonLabel.textContent = 'ENVIANDO SOLICITUD…';
    buttonIcon.style.display = 'none';
    form.setAttribute('aria-busy', 'true');
    try {
      const { trackRegistration } = await window.LandingLeads.submit(form, '/api/leads');
      form.reset();
      countryEdited = false;
      dialCodeEdited = false;
      country.value = detectedCountry?.name ?? '';
      updateCountry();
      page.hidden = true;
      success.hidden = false;
      goToTop(document.getElementById('success-title'));
      try {
        if (trackRegistration) {
          window.fbq?.('trackSingle', '1101059396141011', 'CompleteRegistration', {});
        }
      } catch {
        // A tracking error cannot change the outcome of a saved submission.
      }
    } catch (error) {
      submitError.textContent = error instanceof TypeError || error.name === 'TimeoutError'
        ? 'No fue posible enviar la solicitud. Revisa tu conexión o inténtalo de nuevo más tarde.'
        : error.message;
      submitError.hidden = false;
    } finally {
      button.disabled = false;
      buttonLabel.textContent = readyLabel;
      buttonIcon.style.display = '';
      form.removeAttribute('aria-busy');
    }
  });

  document.getElementById('return-home').addEventListener('click', () => {
    success.hidden = true;
    page.hidden = false;
    goToTop(page.querySelector('.site-header a'));
  });
})();
