// Site configuration for the app (PWA) and Game alerts. Public values only: never put secrets here.
// WORKER_URL: the Cloudflare Worker that stores alert sign-ups and sends web push (see /worker/README.md),
//   e.g. "https://cbn-alerts.<your-subdomain>.workers.dev" (no trailing slash). While it is empty the
//   bell shows "Alerts coming soon" and nothing is sent anywhere.
// VAPID_PUBLIC_KEY: the public half of the VAPID keypair (the private half lives only in the Worker's secrets).
window.CBN_CONFIG = {
  WORKER_URL: "",
  VAPID_PUBLIC_KEY: "BKZoaKWaPmx65jY1P9Jpm5O5CbBnsMq4l1DPUob_pHIxkaJGqBP3uywE0H-RUvl3yWqoSt_F5PNYkyJ7g9OMFmY"
};
