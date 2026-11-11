(() => {
  'use strict';

  const page = document.getElementById('landing-page');
  const success = document.getElementById('success-page');
  const form = document.getElementById('lead-form');
  const { fullName, email, phone, country, birthDate, consent } = form.elements;
  const summary = document.getElementById('form-error-summary');
  const submitError = document.getElementById('submit-error');
  const button = form.querySelector('button[type="submit"]');
  const buttonLabel = button.querySelector('span');
  const buttonIcon = button.querySelector('svg');
  const readyLabel = buttonLabel.textContent;
  const today = new Date().toISOString().slice(0, 10);
  const adultCutoff = `${Number(today.slice(0, 4)) - 18}${today.slice(4)}`;
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

  form.addEventListener('input', ({ target }) => {
    if (target.hasAttribute('aria-describedby')) setError(target);
    submitError.hidden = true;
    summary.hidden = !form.querySelector('[aria-invalid="true"]');
  });

  function validate() {
    setError(fullName, fullName.value.trim().length < 3 ? 'Introduce tu nombre completo.' : '');
    setError(email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) ? '' : 'Introduce un correo electrónico válido.');
    const number = phone.value.trim();
    const validPhone = /^[\d ()-]{7,18}$/.test(number) && number.replace(/\D/g, '').length >= 7;
    setError(phone, validPhone ? '' : 'Introduce un número de teléfono válido.');
    const countryLabel = [...country.list.options].find(option =>
      option.value.localeCompare(country.value.trim(), 'es', { sensitivity: 'base' }) === 0
    );
    setError(country, countryLabel ? '' : 'Selecciona un país de la lista.');
    if (countryLabel) country.value = countryLabel.value;

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
      await window.LandingLeads.submit(form, '/api/leads');
      form.reset();
      page.hidden = true;
      success.hidden = false;
      goToTop(document.getElementById('success-title'));
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
