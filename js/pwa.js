// App (PWA) + Game alerts: service worker registration, "Install the app" banner,
// and the bell / Game alerts panel (web push). Config: js/config.js. Privacy: privacy.html.
(() => {
  const cfg = window.CBN_CONFIG || {};
  const WORKER = (cfg.WORKER_URL || "").replace(/\/+$/, "");
  const ls = {
    get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del: k => { try { localStorage.removeItem(k); } catch {} }
  };
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|Line\/|TikTok|Snapchat/i.test(ua);
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const el = (tag, attrs = {}, html = "") => { const e = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); e.innerHTML = html; return e; };

  // ---------- service worker ----------
  let swReg = null;
  if ("serviceWorker" in navigator) {
    addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").then(r => { swReg = r; }).catch(e => console.warn("SW registration failed", e));
    });
  }

  // ---------- install banner ----------
  const DISMISS = "cbn-install-dismissed";
  let deferred = null, banner = null;
  function showBanner(kind) {
    if (banner || standalone() || ls.get(DISMISS)) return;
    const how = ` <a href="/install.html">See the steps</a>`;
    const text = kind === "prompt"
      ? `<b>Install the app</b><span>Live tracker, scores and game alerts, one tap from your home screen.${how}</span>`
      : kind === "inapp"
        ? `<b>Get the app</b><span>Open this page in Safari (tap ••• then Open in browser), then tap Share then Add to Home Screen.${how}</span>`
        : `<b>Get the app</b><span>Tap Share <svg class="share-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 12v8h14v-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> then Add to Home Screen.${how}</span>`;
    banner = el("div", {class: "cbn-install", role: "region", "aria-label": "Install the app"},
      `<img src="/icons/icon-192.png" alt="" width="40" height="40"><div class="ci-text">${text}</div>
       ${kind === "prompt" ? `<button type="button" class="ci-go">Install</button>` : ""}
       <button type="button" class="ci-x" aria-label="Dismiss">&times;</button>`);
    banner.querySelector(".ci-x").onclick = () => { ls.set(DISMISS, Date.now()); hideBanner(); };
    const go = banner.querySelector(".ci-go");
    if (go) go.onclick = async () => {
      if (!deferred) return hideBanner();
      deferred.prompt();
      try { const c = await deferred.userChoice; if (c.outcome === "dismissed") ls.set(DISMISS, Date.now()); } catch {}
      deferred = null; hideBanner();
    };
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add("show"));
  }
  function hideBanner() { if (banner) { banner.remove(); banner = null; } }
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; showBanner("prompt"); syncInstallBtn(); });
  addEventListener("appinstalled", () => { ls.set(DISMISS, Date.now()); deferred = null; hideBanner(); syncInstallBtn(); });
  if (isIOS && !standalone()) setTimeout(() => showBanner(inApp ? "inapp" : "ios"), 1500);

  // ---------- game alerts ----------
  // [key, label, default]. Betting odds are opt-in (off by default).
  const PREFS = [["gameday", "Game day morning (9 AM PT)", true], ["lineup", "Lineup &amp; starting goalie", true], ["puck_drop", "Puck drop", true],
    ["goal", "Goals (both teams)", true], ["period_end", "Period ends", true], ["final", "Final score", true],
    ["odds", "Betting odds <small>(pre-game, 19+ · Play responsibly)</small>", false]];
  const STORE = "cbn-alerts";
  const saved = () => ls.get(STORE) || {};
  let panel = null;

  function b64ToBytes(s) {
    const pad = "=".repeat((4 - s.length % 4) % 4), raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }
  async function currentSub() {
    if (!pushSupported()) return null;
    const reg = await navigator.serviceWorker.getRegistration("/");
    return reg ? reg.pushManager.getSubscription() : null;
  }
  async function post(path, body) {
    const r = await fetch(WORKER + path, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
    if (!r.ok) throw new Error(`Server said ${r.status}`);
    return r.json().catch(() => ({}));
  }

  function buildPanel() {
    const s = saved(), prefs = {...Object.fromEntries(PREFS.map(([k, , d]) => [k, d])), ...(s.prefs || {})};
    const iosBlocked = isIOS && !standalone();
    panel = el("div", {class: "cbn-sheet", id: "alerts-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "alerts-title", hidden: ""},
      `<div class="cbn-sheet-box">
        <button type="button" class="cs-x" aria-label="Close">&times;</button>
        <h2 id="alerts-title"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${BELL}"/></svg> Game alerts</h2>
        ${!WORKER ? `<p class="cs-soon"><b>Alerts coming soon.</b> Sign-up isn't open yet. Check back here shortly.</p>` : ""}
        ${isIOS ? `<p class="cs-ios${iosBlocked ? " warn" : ""}">On iPhone and iPad, alerts only work after you add this site to your Home Screen (iOS 16.4 or newer). <a href="/install.html">See step-by-step pictures</a>, then open the app from your Home Screen and turn alerts on here.</p>` : ""}
        <fieldset><legend>Alert me for</legend>
          ${PREFS.map(([k, label]) => `<label class="cs-chk"><input type="checkbox" name="${k}" ${prefs[k] ? "checked" : ""}> <span>${label}</span></label>`).join("")}
        </fieldset>
        <label class="cs-email">Name or email <small>(optional)</small>
          <input type="text" name="email" maxlength="120" autocomplete="email" placeholder="e.g. Connor or you@example.com" value="${(s.email || "").replace(/"/g, "&quot;")}"></label>
        <p class="cs-consent">You'll get Oilers game alerts from The Copper &amp; Blue News. Turn off anytime. <a href="/privacy.html">Privacy</a></p>
        <div class="cs-actions">
          <button type="button" class="btn cs-on">Turn on alerts</button>
          <button type="button" class="cs-off" hidden>Unsubscribe</button>
        </div>
        <p class="cs-status" role="status" aria-live="polite"></p>
        <button type="button" class="cs-install" hidden>Install the app</button>
        <p class="cs-how"><a href="/install.html">How to add this as an app</a></p>
      </div>`);
    document.body.appendChild(panel);
    const $p = q => panel.querySelector(q);
    $p(".cs-x").onclick = closePanel;
    panel.addEventListener("click", e => { if (e.target === panel) closePanel(); });
    panel.addEventListener("keydown", e => { if (e.key === "Escape") closePanel(); });
    $p(".cs-on").onclick = subscribe;
    $p(".cs-off").onclick = unsubscribe;
    $p(".cs-install").onclick = () => { if (deferred) { deferred.prompt(); deferred = null; syncInstallBtn(); } };
    syncInstallBtn();
  }
  function syncInstallBtn() { const b = panel?.querySelector(".cs-install"); if (b) b.hidden = !deferred || standalone(); }
  const status = (msg, bad) => { const p = panel.querySelector(".cs-status"); p.textContent = msg; p.classList.toggle("bad", !!bad); };

  async function refreshPanel() {
    const on = panel.querySelector(".cs-on"), off = panel.querySelector(".cs-off");
    const sub = await currentSub().catch(() => null), subscribed = !!(sub && saved().on);
    off.hidden = !subscribed && !saved().on;
    if (!WORKER) { on.disabled = true; on.textContent = "Alerts coming soon"; return; }
    if (isIOS && !standalone()) { on.disabled = true; on.textContent = "Add to Home Screen first"; return; }
    if (!pushSupported()) { on.disabled = true; on.textContent = "Not supported in this browser"; return; }
    if (Notification.permission === "denied") { status("Notifications are blocked for this site. Allow them in your browser settings, then try again.", true); }
    on.disabled = false; on.textContent = subscribed ? "Save preferences" : "Turn on alerts";
  }
  function openPanel() {
    if (!panel) buildPanel();
    panel.hidden = false; document.documentElement.classList.add("cbn-lock");
    refreshPanel(); panel.querySelector(".cs-x").focus();
  }
  function closePanel() { panel.hidden = true; document.documentElement.classList.remove("cbn-lock"); document.getElementById("cbn-bell")?.focus(); }

  const readForm = () => ({
    prefs: Object.fromEntries(PREFS.map(([k]) => [k, panel.querySelector(`input[name=${k}]`).checked])),
    email: panel.querySelector("input[name=email]").value.trim().slice(0, 120)
  });

  async function subscribe() {
    if (!WORKER || !pushSupported()) return;
    const {prefs, email} = readForm();
    if (!Object.values(prefs).some(Boolean)) return status("Pick at least one alert, or use Unsubscribe.", true);
    const btn = panel.querySelector(".cs-on"); btn.disabled = true; status("Turning on alerts…");
    try {
      if (await Notification.requestPermission() !== "granted") throw new Error("Notifications were not allowed. You can allow them in your browser settings.");
      const reg = swReg || await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const key = b64ToBytes(cfg.VAPID_PUBLIC_KEY);
      let sub = await reg.pushManager.getSubscription();
      if (sub && sub.options?.applicationServerKey) {
        const old = new Uint8Array(sub.options.applicationServerKey);
        if (old.length !== key.length || old.some((b, i) => b !== key[i])) { await sub.unsubscribe(); sub = null; }
      }
      if (!sub) sub = await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: key});
      const body = {subscription: sub.toJSON(), prefs};
      if (email) body.email = email;
      await post("/subscribe", body);
      ls.set(STORE, {on: true, prefs, email});
      status("You're in. Alerts are on for this device.");
      syncBell();
    } catch (e) { status(e.message || "Couldn't turn on alerts. Try again.", true); }
    refreshPanel();
  }
  async function unsubscribe() {
    status("Turning off alerts…");
    try {
      const sub = await currentSub();
      if (sub) {
        if (WORKER) await post("/unsubscribe", {endpoint: sub.endpoint}).catch(() => {});
        await sub.unsubscribe();
      }
      ls.del(STORE);
      status("Alerts are off and your sign-up was deleted.");
    } catch (e) { status("Couldn't unsubscribe: " + (e.message || e), true); }
    syncBell(); refreshPanel();
  }

  // ---------- bell ----------
  const BELL = "M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z";
  function syncBell() {
    const b = document.getElementById("cbn-bell"); if (!b) return;
    const on = !!saved().on;
    b.classList.toggle("on", on);
    b.title = !WORKER ? "Alerts coming soon" : on ? "Game alerts: on" : "Game alerts";
    b.setAttribute("aria-label", b.title);
    const t = b.querySelector(".bell-t"); if (t) t.textContent = !WORKER ? "Alerts soon" : on ? "Alerts on" : "Alerts";
  }
  function initBell() {
    let b = document.getElementById("cbn-bell");
    if (!b) { // pages without the static button get one injected
      const brand = document.querySelector(".nav .brand"); if (!brand) return;
      b = el("button", {type: "button", class: "bell", id: "cbn-bell"}, `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${BELL}"/></svg><span class="bell-t">Alerts</span>`);
      brand.after(b);
    }
    b.addEventListener("click", openPanel);
    document.querySelectorAll("[data-alerts]").forEach(x => x.addEventListener("click", e => { e.preventDefault(); openPanel(); }));
    syncBell();
    if (location.hash === "#alerts") openPanel();
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", initBell) : initBell();
  window.CBN_PWA = {openPanel, showBanner};
})();
