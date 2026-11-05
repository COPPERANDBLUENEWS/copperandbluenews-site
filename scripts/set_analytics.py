#!/usr/bin/env python3
"""Add (or update) the Cloudflare Web Analytics beacon on every HTML page, and the matching
paragraph on privacy.html.

  python3 scripts/set_analytics.py <site_token>     # add/update the beacon
  python3 scripts/set_analytics.py --remove         # take it out again

The site token is public (it's in every page's source) and safe to commit. Cloudflare Web Analytics
is cookieless and only reports aggregated counts (pages, referrers, countries, browsers).
"""
import glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG_RE = re.compile(r'<!-- Cloudflare Web Analytics -->.*?<!-- End Cloudflare Web Analytics -->\n', re.S)
PRIV_RE = re.compile(r'\n?<h2 class="sub" id="analytics">.*?<!-- /analytics -->', re.S)
PRIVACY = '''
<h2 class="sub" id="analytics">Site analytics</h2>
<p>We count visits with <b>Cloudflare Web Analytics</b>. It's cookieless: it doesn't set cookies, use local storage or
fingerprint your device, and it doesn't follow you to other sites. We only see aggregated totals, such as page views,
which pages are popular, the site that linked you here and your country. We can't tell who you are from it.
<a href="https://www.cloudflare.com/web-analytics/" target="_blank" rel="noopener">About Cloudflare Web Analytics</a>.</p><!-- /analytics -->'''


def main():
    remove = "--remove" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not remove and (not args or not re.fullmatch(r"[0-9a-f]{32}", args[0])):
        sys.exit("usage: set_analytics.py <32-hex site token> | --remove")
    tag = "" if remove else ('<!-- Cloudflare Web Analytics --><script defer src="https://static.cloudflareinsights.com/beacon.min.js" '
                             "data-cf-beacon='" + json.dumps({"token": args[0]}, separators=(",", ":")) + "'></script><!-- End Cloudflare Web Analytics -->")
    changed = 0
    for path in sorted(glob.glob(os.path.join(ROOT, "*.html"))):
        s = open(path, encoding="utf-8").read()
        new = TAG_RE.sub("", s)
        if tag:
            new = new.replace("</body>", tag + "\n</body>", 1) if "</body>" in new else new
        if os.path.basename(path) == "privacy.html":
            new = PRIV_RE.sub("", new)
            if tag:
                new = new.replace('\n<h2 class="sub">Unsubscribe or delete</h2>', PRIVACY + '\n<h2 class="sub">Unsubscribe or delete</h2>', 1)
                new = new.replace("and we don't use ad trackers.", "and we don't use ad trackers or cookies.")
            else:
                new = new.replace("and we don't use ad trackers or cookies.", "and we don't use ad trackers.")
        if new != s:
            open(path, "w", encoding="utf-8").write(new)
            changed += 1
    print(f"{'removed from' if remove else 'set on'} {changed} page(s)")


if __name__ == "__main__":
    main()
