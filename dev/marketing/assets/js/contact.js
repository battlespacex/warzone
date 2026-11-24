/* StratOps public contact form. Messages require an actual server-signed challenge.
   An unconfigured localhost preview can render a sample question, but cannot submit. */
(() => {
  'use strict';
  const form = document.getElementById('stratops-contact-form');
  if (!form) return;
  const base = String(STRATOPS_CONTACT_API_BASE || '').trim().replace(/\/+$/, '');
  // Optional sales/demo routes keep the exact server-approved topic values.
  const intent = new URLSearchParams(window.location.search).get('intent');
  const intentChoices = {
    demo: ['General enquiry', 'Product demonstration: tell us about your team and use case.'],
    commercial: ['General enquiry', 'Commercial evaluation, enterprise licensing or investment: describe your organization and goals.'],
    data: ['Data partnership', 'Data or technology partnership: share the integration or licensing opportunity.'],
    media: ['Media request', 'Press or research request: share your publication, project or intended use.']
  };
  if (intent && Object.prototype.hasOwnProperty.call(intentChoices, intent)) {
    const [topic, hint] = intentChoices[intent];
    const select = form.elements.namedItem('topic');
    if (select) select.value = topic;
    const message = document.getElementById('contact-intent-message');
    if (message) { message.hidden = false; message.textContent = hint; }
  }
  const statusEl = document.getElementById('contact-status');
  const question = document.getElementById('contact-captcha-question');
  const answer = document.getElementById('contact-captcha-answer');
  const helper = document.getElementById('contact-captcha-help');
  const localPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const submit = document.getElementById('contact-submit');
  const refresh = document.getElementById('contact-reload');
  let token = '';
  let busy = false;

  function say(message, type = '') {
    statusEl.textContent = message;
    statusEl.dataset.state = type;
  }
  function fieldError(id, message = '') {
    const field = form.elements.namedItem(id);
    const error = document.getElementById('error-' + id);
    if (error) error.textContent = message;
    if (field && typeof field.setAttribute === 'function') field.setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  function check() {
    let good = true;
    const value = (key) => String(form.elements.namedItem(key)?.value || '').trim();
    const checks = {
      name: value('name').length >= 2 && value('name').length <= 100 ? '' : 'Please enter your name (2–100 characters).',
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value('email')) && value('email').length <= 254 ? '' : 'Enter a valid email address.',
      organization: value('organization').length <= 120 ? '' : 'Organization is too long.',
      topic: ['General enquiry','Research collaboration','Data partnership','Technical issue','Media request'].includes(value('topic')) ? '' : 'Please select an enquiry type.',
      message: value('message').length >= 15 && value('message').length <= 5000 ? '' : 'Please enter a message of 15–5000 characters.'
    };
    for (const [key, message] of Object.entries(checks)) {
      fieldError(key, message);
      if (message) good = false;
    }
    const cap = answer.value.trim();
    const capProblem = /^\d{1,3}$/.test(cap) ? '' : 'Enter the numeric answer.';
    fieldError('captcha', capProblem);
    answer.setAttribute('aria-invalid', capProblem ? 'true' : 'false');
    if (capProblem) good = false;
    return good;
  }
  async function requestJson(path, options = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(base + path, { ...options, signal: controller.signal, cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.ok !== true) {
        const error = new Error(data?.message || (response.status === 429 ? 'Too many requests. Please try again later.' : 'The contact service is unavailable.'));
        error.status = response.status;
        throw error;
      }
      return data;
    } finally { window.clearTimeout(timeout); }
  }
  async function newChallenge(showStatus = true) {
    if (!base) {
      // An illustrative question for local layout testing, not a security token.
      // The submit button must remain disabled until the real AWS API is connected.
      token = '';
      submit.disabled = true;
      answer.value = '';
      fieldError('captcha');
      if (localPreview) {
        const a = 2 + Math.floor(Math.random() * 14);
        const b = 2 + Math.floor(Math.random() * 14);
        question.textContent = `${a} + ${b} = ?`;
        helper.textContent = 'Local preview only. Connect the AWS contact API to enable sending.';
      } else {
        question.textContent = 'Temporarily unavailable';
        helper.textContent = 'Secure message delivery is currently unavailable.';
      }
      say('');
      return;
    }
    token = '';
    submit.disabled = true;
    question.textContent = 'Loading…';
    helper.textContent = 'Enter the sum to confirm the form.';
    answer.value = '';
    fieldError('captcha');
    if (showStatus) say('Checking the security question…');
    try {
      const data = await requestJson('/challenge');
      if (typeof data.question !== 'string' || typeof data.token !== 'string') throw new Error('Invalid challenge response.');
      token = data.token;
      question.textContent = data.question;
      submit.disabled = false;
      if (showStatus) say('');
    } catch (error) {
      question.textContent = 'Question unavailable';
      helper.textContent = 'Try New question to reconnect.';
      if (showStatus) say('Could not load the security question. Please try again.', 'error');
    }
  }
  for (const id of ['name','email','organization','topic','message']) {
    const input = form.elements.namedItem(id);
    input?.addEventListener('input', () => fieldError(id));
  }
  answer.addEventListener('input', () => fieldError('captcha'));
  refresh.addEventListener('click', () => { if (!busy) newChallenge(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!check()) { say('Please correct the highlighted fields.', 'error'); return; }
    if (!token) { say('The security question needs to reload. Click New question.', 'error'); return; }
    busy = true;
    submit.disabled = true;
    refresh.disabled = true;
    say('Sending your message…');
    const fields = Object.fromEntries(new FormData(form).entries());
    const payload = {
      name: String(fields.name || '').trim(), email: String(fields.email || '').trim(),
      organization: String(fields.organization || '').trim(), topic: String(fields.topic || '').trim(),
      message: String(fields.message || '').trim(), website: String(fields.website || ''),
      answer: answer.value.trim(), token
    };
    try {
      await requestJson('/contact', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      form.reset();
      token = '';
      question.textContent = 'New question required';
      say('Your message was sent successfully. Thank you for contacting BattlespaceX.', 'success');
      // Keep the success notice visible even if the next challenge cannot load.
      await newChallenge(false);
    } catch (error) {
      if (error.name === 'AbortError') say('The request timed out. Your message was not confirmed. Please try again.', 'error');
      else if (error.status === 429) say('Too many requests. Please wait and try again.', 'error');
      else if (error.status === 400 || error.status === 409) say(error.message || 'The security answer or form details were rejected. Please try again.', 'error');
      else say('We could not confirm delivery. Please try again later.', 'error');
      await newChallenge(false); // A token may have been consumed; always request another.
    } finally {
      busy = false;
      refresh.disabled = false;
      submit.disabled = !token;
    }
  });
  newChallenge();
})();
