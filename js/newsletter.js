// Separate, affirmative newsletter consent; never reuses optional email from the push-alert form.
(function () {
  'use strict';
  var cfg = window.CBN_CONFIG || {}, box = document.querySelector('[data-newsletter]');
  if (!box || !cfg.WORKER_URL) return;
  box.innerHTML = '<h2>Get the Oilers game day email</h2>' +
    '<p class="nl-p">A little more Oilers in your inbox. Free to join.</p>' +
    '<form class="nl-form" novalidate>' +
    '<label class="nl-label" for="nl-email">Email address</label>' +
    '<div class="nl-input-row"><input id="nl-email" type="email" name="email" placeholder="you@example.com" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" required maxlength="254">' +
    '<button type="submit" class="btn">Sign me up</button></div>' +
    '<label class="nl-hp" aria-hidden="true">Leave this blank<input type="text" name="website" tabindex="-1" autocomplete="off"></label>' +
    '<label class="nl-consent"><input type="checkbox" name="consent" required> <span>Game day previews and Oilers news from The Copper &amp; Blue News. Unsubscribe anytime.</span></label>' +
    '<p class="nl-privacy">Your email is only for the newsletter. <a href="privacy.html#newsletter">Privacy &amp; contact</a></p></form>' +
    '<p class="nl-msg" role="status" aria-live="polite" aria-atomic="true"></p>';
  var form = box.querySelector('form'), msg = box.querySelector('.nl-msg'), btn = form.querySelector('button'), busy = false;
  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    if (busy) return;
    var email = form.elements.email, consent = form.elements.consent;
    email.value = email.value.trim();
    if (!email.checkValidity()) {msg.textContent = 'Please enter a valid email address.'; msg.className = 'nl-msg err'; email.focus(); return;}
    if (!consent.checked) {msg.textContent = 'Please tick the consent box to join the newsletter.'; msg.className = 'nl-msg err'; consent.focus(); return;}
    busy = true; btn.disabled = true; form.setAttribute('aria-busy', 'true'); msg.textContent = 'Signing you up…'; msg.className = 'nl-msg';
    var controller = new AbortController(), timeout = setTimeout(function () {controller.abort();}, 12000);
    try {
      var r = await fetch(cfg.WORKER_URL.replace(/\/$/, '') + '/newsletter', {method:'POST', credentials:'omit', cache:'no-store', signal:controller.signal,
        headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:email.value, consent:consent.checked, consentVersion:'2026-11-06-v1', source:box.dataset.newsletter, website:form.elements.website.value})});
      var data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || 'Sign-up is temporarily unavailable. Please try again.');
      email.value = ''; form.hidden = true;
      msg.textContent = "You're on the list! Our game day email is coming soon. 🏒"; msg.className = 'nl-msg ok';
    } catch (err) {
      msg.textContent = err.name === 'AbortError' ? 'The connection timed out. Please try again.' : err.message === 'Failed to fetch' ? "Couldn't connect. Please check your connection and try again." : err.message;
      msg.className = 'nl-msg err';
    } finally {clearTimeout(timeout); busy = false; btn.disabled = false; form.removeAttribute('aria-busy');}
  });
})();
