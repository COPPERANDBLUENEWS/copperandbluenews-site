#!/usr/bin/env python3
"""Push alerts for new Pre-Raw and Post-Raw interviews. Standard library only.

Reads data/interviews.json (written by scripts/update_interviews.py, called from
scripts/update_news.py) and POSTs the full list to the alerts Worker:

  POST $WORKER_URL/interviews
  Authorization: Bearer $NOTIFY_SECRET
  {"videos": [...], "notify": ["<youtube id>", ...]}

notify is only ids that were not already reported. The copy committed at HEAD
is the baseline: the interviews already in the repo (the existing library) are
stored by the Worker and never sent. A video added in this run is sent if it
was published in the last 72 hours.

Ids the Worker has accepted are kept in ~/.cbn-alerts/interviews.json (same
directory as the game-alert sent list, carried between Actions runs by
actions/cache). If a POST fails, those new ids stay unacked so the next run
tries again even after git commit. A repeat POST of ids the Worker already
stored sends nothing.

No-op (exit 0, nothing sent) if WORKER_URL or NOTIFY_SECRET is missing, or if
data/interviews.json is not there yet. Always exits 0 so the news job continues.
Prints changed=1|0 to $GITHUB_OUTPUT (1 = the acked-id file changed).
"""
import json, os, pathlib, re, subprocess, sys, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "interviews.json"
STATE = pathlib.Path(os.environ.get("ALERTS_STATE") or pathlib.Path.home() / ".cbn-alerts" / "sent.json").parent / "interviews.json"
YT = re.compile(r"^[A-Za-z0-9_-]{11}$")
MAX_AGE = timedelta(hours=72)


def is_recent(video, now):
    raw = video.get("published") or ""
    try:
        t = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return False
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return timedelta(minutes=-5) <= (now - t) <= MAX_AGE


def choose_notify(videos, previous_ids, acked_ids, now):
    """previous_ids is None when HEAD has no interviews file (the whole file is history).
    acked_ids is None until this pipeline has successfully told the Worker about a list.
    """
    if previous_ids is None:
        candidates = []
    elif acked_ids is None:
        candidates = [v["id"] for v in videos if v["id"] not in previous_ids]
    else:
        candidates = [v["id"] for v in videos if v["id"] not in acked_ids]
    by = {v["id"]: v for v in videos}
    return [i for i in candidates if is_recent(by[i], now)]


def load_current():
    if not OUT.exists():
        return None
    data = json.loads(OUT.read_text())
    videos = []
    for v in data.get("videos") or []:
        if not isinstance(v, dict) or v.get("type") not in ("Pre-Raw", "Post-Raw"):
            continue
        vid = v.get("id") if isinstance(v.get("id"), str) else ""
        if not YT.match(vid):
            continue
        videos.append({
            "id": vid,
            "type": v["type"],
            "title": str(v.get("title") or "")[:180],
            "published": str(v.get("published") or "")[:40],
            "url": f"https://www.youtube.com/watch?v={vid}",
        })
    return videos


def head_ids():
    try:
        out = subprocess.check_output(["git", "show", "HEAD:data/interviews.json"], stderr=subprocess.DEVNULL, cwd=ROOT)
    except Exception:
        return None
    try:
        data = json.loads(out)
    except Exception:
        return None
    ids = set()
    for v in (data.get("videos") or []) if isinstance(data, dict) else []:
        if isinstance(v, dict) and isinstance(v.get("id"), str):
            ids.add(v["id"])
    return ids


def load_acked():
    try:
        data = json.loads(STATE.read_text())
    except Exception:
        return None
    ids = data.get("ids") if isinstance(data, dict) else None
    if not isinstance(ids, list):
        return None
    return set(i for i in ids if isinstance(i, str))


def save_acked(ids):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps({"ids": list(ids)}, separators=(",", ":")))


def set_output(changed):
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"changed={'1' if changed else '0'}\n")


def post(worker, secret, videos, notify_ids):
    body = json.dumps({"videos": videos, "notify": notify_ids}).encode()
    req = urllib.request.Request(worker.rstrip("/") + "/interviews", data=body, method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {secret}",
                                          "User-Agent": "copperandbluenews-alerts"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            res = json.loads(r.read() or b"{}")
            print(f"interview alerts: new={res.get('new')} bootstrapped={res.get('bootstrapped')} suppressed={res.get('suppressed')} seen={res.get('seen')}")
            return True
    except urllib.error.HTTPError as e:
        print(f"interview alerts failed: HTTP {e.code}", file=sys.stderr)
        return e.code in (400, 422)
    except Exception as e:
        print(f"interview alerts failed: {e}", file=sys.stderr)
        return False


def main():
    changed = False
    try:
        worker, secret = os.environ.get("WORKER_URL", "").strip(), os.environ.get("NOTIFY_SECRET", "").strip()
        dry = "--dry-run" in sys.argv
        if (not worker or not secret) and not dry:
            print("interview alerts: WORKER_URL or NOTIFY_SECRET missing, skipped")
            return
        videos = load_current()
        if videos is None:
            print("interview alerts: no data/interviews.json, skipped")
            return
        now = datetime.now(timezone.utc)
        previous, acked = head_ids(), load_acked()
        notify_ids = choose_notify(videos, previous, acked, now)
        print(f"interview alerts: {len(videos)} on disk, notifying {len(notify_ids)}")
        if dry:
            print(json.dumps({"notify": notify_ids, "videos": len(videos)}))
            return
        ok = post(worker, secret, videos, notify_ids)
        if ok or previous is None:
            nxt = sorted(v["id"] for v in videos)
        elif acked is None:
            nxt = sorted(previous)
        else:
            nxt = sorted(acked)
        prev_list = None if acked is None else sorted(acked)
        if prev_list != nxt:
            save_acked(nxt)
            changed = True
    except Exception as e:
        print("interview alerts failed:", e, file=sys.stderr)
    finally:
        set_output(changed)


if __name__ == "__main__":
    main()
