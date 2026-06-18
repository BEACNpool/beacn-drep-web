#!/usr/bin/env python3
"""Generate an X-ready summary share card (PNG) for a BEACN DRep governance vote.

The card is a self-contained social image (portrait 1080x1350) that tells a
delegator, at a glance:
  - what the proposal was,
  - which direction BEACN voted, and
  - why.

It renders a small HTML template with headless Chromium and screenshots it.
Per-link X *unfurls* are not possible for a hash-router SPA (crawlers never see
the #/action/<id> fragment), so these images are meant to be attached directly
to a post.

Usage:
  scripts/build_share_card.py                # latest open action
  scripts/build_share_card.py --id <gov_action...>
  scripts/build_share_card.py --all          # every action with a detail file
  scripts/build_share_card.py --latest --desktop   # also copy to ~/Desktop

Output: data/output/public/share/<action_id>.png
"""
import argparse
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / "data" / "output" / "public"
SHARE_DIR = PUB / "share"
SITE_URL = "beacnpool.github.io/beacn-drep-web"
X_HANDLE = "@BEACNpool"

CARDANO_START = datetime(2017, 9, 23, 21, 44, 51, tzinfo=timezone.utc)
EPOCH_SECONDS = 5 * 24 * 60 * 60

VERDICTS = {
    "YES": ("Voted YES", "#34d399", "rgba(52,211,153,.14)"),
    "NO": ("Voted NO", "#fb7185", "rgba(251,113,133,.14)"),
    "ABSTAIN": ("Abstained", "#a8b2c1", "rgba(168,178,193,.14)"),
    "NEEDS_MORE_INFO": ("Needs more info", "#fbbf24", "rgba(251,191,36,.14)"),
    "PENDING": ("Pending", "#a8b2c1", "rgba(168,178,193,.14)"),
}

TYPE_LABELS = {
    "TreasuryWithdrawals": "Treasury withdrawal",
    "ParameterChange": "Protocol parameter change",
    "HardForkInitiation": "Hard fork",
    "NewConstitution": "Constitutional amendment",
    "UpdateCommittee": "Constitutional committee",
    "NoConfidence": "No confidence",
    "InfoAction": "Info action",
}


def verdict_key(value):
    v = re.sub(r"\s+", "_", str(value or "").upper())
    if "NEEDS" in v or "MORE_INFO" in v:
        return "NEEDS_MORE_INFO"
    if "ABSTAIN" in v:
        return "ABSTAIN"
    if "YES" in v:
        return "YES"
    if v == "NO" or v.startswith("NO_") or "VOTE_NO" in v:
        return "NO"
    return v if v in VERDICTS else "PENDING"


def current_epoch():
    elapsed = (datetime.now(timezone.utc) - CARDANO_START).total_seconds()
    return int(elapsed // EPOCH_SECONDS)


def clean_md(text, limit=320):
    """Flatten markdown/anchor prose into a single readable sentence run."""
    t = str(text or "")
    t = re.sub(r"```.*?```", " ", t, flags=re.S)         # code fences
    t = re.sub(r"^\s{0,3}#{1,6}\s+.*$", " ", t, flags=re.M)  # drop ATX header lines
    t = re.sub(r"^\s*\|.*$", " ", t, flags=re.M)          # table rows
    t = re.sub(r"^\s*[-:|]+\s*$", " ", t, flags=re.M)     # table rules
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", t)           # images
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)        # links -> text
    t = re.sub(r"[#>*_`~]", " ", t)                        # md punctuation
    t = re.sub(r"https?://\S+", " ", t)                   # bare urls
    t = re.sub(r"\s+", " ", t).strip()
    if len(t) <= limit:
        return t
    cut = t[:limit]
    dot = cut.rfind(". ")
    if dot > limit * 0.5:
        return cut[: dot + 1]
    sp = cut.rfind(" ")
    return (cut[:sp] if sp > 0 else cut).rstrip(" ,;:") + "…"


def load_json(path):
    try:
        return json.loads(Path(path).read_text())
    except Exception:
        return None


def pick_latest(status):
    actions = [a for a in (status or {}).get("actions", []) if a.get("cip129_action_id")]
    if not actions:
        return None
    opens = [a for a in actions if str(a.get("status", "")).lower() == "open"]
    pool = opens or actions
    pool.sort(
        key=lambda a: (a.get("proposed_in_epoch") or 0,
                       a.get("detected_at") or a.get("submitted_at") or ""),
        reverse=True,
    )
    return pool[0]["cip129_action_id"]


def build_model(action_id, status, statements):
    detail = load_json(PUB / "actions" / f"{action_id}.json")
    if not detail:
        raise FileNotFoundError(f"No detail record for {action_id}")
    proposal = load_json(PUB / "proposals" / f"{action_id}.json") or {}
    body = proposal.get("body", {}) if isinstance(proposal, dict) else {}

    rationale = detail.get("rationale", {})
    decision = detail.get("decision", {})
    proof = detail.get("proof_of_vote", {})
    live = next((a for a in (status or {}).get("actions", [])
                 if a.get("cip129_action_id") == action_id), {})

    vkey = verdict_key(decision.get("vote") or proof.get("vote")
                       or live.get("recommendation") or live.get("our_vote"))
    vlabel, vcolor, vbg = VERDICTS[vkey]

    # What it is: prefer the anchor abstract, then motivation, then statement.
    what = clean_md(body.get("abstract") or body.get("motivation"), 300)
    if not what:
        st = statements.get(action_id, {})
        what = clean_md(st.get("statement") or rationale.get("summary"), 300)

    # Why: a headline reason plus up to three concrete points.
    headline = clean_md(rationale.get("summary_raw"), 180)
    if vkey in ("ABSTAIN", "NEEDS_MORE_INFO"):
        raw_points = rationale.get("top_fixes") or rationale.get("missing_evidence") or []
        points = [re.sub(r"^(Provide|Missing dossier section):\s*", "", clean_md(p, 150))
                  for p in raw_points]
        if not headline:
            headline = "A directional vote can't be justified from the admitted evidence yet."
        why_label = "Why — what would change the vote"
    else:
        summary = rationale.get("summary", "")
        tail = re.split(r"\bWhy:\s*", summary, maxsplit=1)
        body_txt = tail[1] if len(tail) > 1 else summary
        points = [clean_md(s, 150) for s in re.split(r"(?<=[.!?])\s+", body_txt) if len(s) > 12]
        if not headline:
            headline = clean_md(summary, 180)
        why_label = "Why BEACN voted this way"
    points = [p for p in points if p][:3]

    epoch = live.get("proposed_in_epoch") or current_epoch()
    short_id = action_id if len(action_id) <= 26 else f"{action_id[:14]}…{action_id[-6:]}"
    type_label = TYPE_LABELS.get(detail.get("type"), detail.get("type") or "Governance action")

    return {
        "title": detail.get("title") or "Governance action",
        "type_label": type_label,
        "epoch": epoch,
        "status": (detail.get("status") or live.get("status") or "recorded").upper(),
        "vlabel": vlabel, "vcolor": vcolor, "vbg": vbg,
        "what": what or "Proposal source admitted and analyzed; see the verified record.",
        "headline": headline,
        "points": points,
        "why_label": why_label,
        "short_id": short_id,
    }


def render_html(m, logo="logo.png"):
    e = html.escape
    points = "".join(f"<li>{e(p)}</li>" for p in m["points"]) or "<li>See the published record for the full reasoning.</li>"
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
*{{margin:0;padding:0;box-sizing:border-box}}
:root{{--cyan:#22d3ee;--muted:#94a3b8;--line:#1c2b42}}
html,body{{width:1080px;height:1350px;overflow:hidden}}
body{{font-family:'Inter','Segoe UI',system-ui,-apple-system,Helvetica,Arial,sans-serif;
  color:#f1f5f9;background:radial-gradient(120% 90% at 0% 0%,#0b1830 0%,#020617 60%);
  padding:64px 64px 56px;display:flex;flex-direction:column}}
.head{{display:flex;align-items:center;gap:18px;margin-bottom:40px}}
.head img{{width:62px;height:62px;border-radius:15px}}
.brand b{{display:block;font-size:30px;font-weight:800;letter-spacing:.2px}}
.brand span{{display:block;color:var(--cyan);font-size:18px;font-weight:600;letter-spacing:.14em;text-transform:uppercase}}
.tags{{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:24px}}
.tag{{padding:9px 16px;border:1px solid var(--line);border-radius:999px;background:rgba(2,6,23,.5);
  color:#cbd5e1;font-size:21px;font-weight:600}}
.tag.epoch{{color:var(--cyan);border-color:rgba(34,211,238,.4)}}
h1{{font-size:60px;line-height:1.08;font-weight:800;letter-spacing:-.5px;margin-bottom:30px;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}}
.verdict{{display:inline-flex;align-items:center;gap:16px;align-self:flex-start;
  padding:18px 30px;border-radius:18px;background:{m['vbg']};border:1.5px solid {m['vcolor']};margin-bottom:34px}}
.verdict i{{width:20px;height:20px;border-radius:50%;background:{m['vcolor']}}}
.verdict b{{font-size:34px;font-weight:800;color:{m['vcolor']}}}
.block{{margin-bottom:30px}}
.label{{font-size:20px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);margin-bottom:12px}}
.what{{font-size:29px;line-height:1.5;color:#dbe4f0;
  display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}}
.headline{{font-size:29px;line-height:1.45;color:#f1f5f9;font-weight:600;margin-bottom:16px}}
ul{{list-style:none;display:flex;flex-direction:column;gap:13px}}
li{{position:relative;padding-left:34px;font-size:26px;line-height:1.4;color:#cbd5e1;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}}
li::before{{content:"";position:absolute;left:6px;top:14px;width:11px;height:11px;border-radius:3px;background:{m['vcolor']}}}
.spacer{{flex:1}}
.foot{{border-top:1px solid var(--line);padding-top:26px;display:flex;justify-content:space-between;align-items:flex-end;gap:24px}}
.foot .l{{font-size:23px;color:var(--muted);line-height:1.5}}
.foot .l b{{color:#f1f5f9}}
.foot .r{{text-align:right;font-size:22px;color:var(--muted)}}
.foot .r b{{display:block;color:var(--cyan);font-size:24px;font-weight:800}}
.id{{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:19px;color:#64748b;margin-top:8px}}
</style></head><body>
  <div class="head"><img src="{logo}" alt=""><div class="brand"><b>BEACN DRep</b><span>Verifiable Cardano Governance</span></div></div>
  <div class="tags"><span class="tag epoch">Epoch {e(str(m['epoch']))}</span><span class="tag">{e(m['type_label'])}</span><span class="tag">{e(m['status'])}</span></div>
  <h1>{e(m['title'])}</h1>
  <div class="verdict"><i></i><b>{e(m['vlabel'])}</b></div>
  <div class="block"><div class="label">What it is</div><div class="what">{e(m['what'])}</div></div>
  <div class="block"><div class="label">{e(m['why_label'])}</div>
    {f'<div class="headline">{e(m["headline"])}</div>' if m['headline'] else ''}
    <ul>{points}</ul></div>
  <div class="spacer"></div>
  <div class="foot">
    <div class="l">Your ADA never leaves your wallet.<br><b>Redelegate any time.</b><div class="id">{e(m['short_id'])}</div></div>
    <div class="r"><b>{e(X_HANDLE)}</b>{e(SITE_URL)}<br>Open rules · on-chain proof</div>
  </div>
</body></html>"""


def find_chromium():
    for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        path = shutil.which(name)
        if path:
            return path
    raise RuntimeError("No chromium/chrome binary found on PATH")


def render_png(model, out_path):
    """Render via a localhost http server in a non-hidden temp dir.

    Snap-confined Chromium cannot read or write inside dot-directories such as
    ~/.openclaw, so we stage the HTML + logo in a visible temp dir under $HOME,
    serve it over loopback, screenshot to that same dir, then move the PNG into
    the (possibly hidden) repo output path with Python.
    """
    import http.server
    import socket
    import socketserver
    import threading

    chromium = find_chromium()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="beacn_share_", dir=str(Path.home())))
    shot = work / "card.png"
    try:
        (work / "index.html").write_text(render_html(model))
        logo_src = ROOT / "assets" / "logo.png"
        if logo_src.exists():
            shutil.copy2(logo_src, work / "logo.png")

        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]

        handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=str(work), **k)
        httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            subprocess.run(
                [chromium, "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                 "--force-device-scale-factor=2", "--window-size=1080,1350",
                 "--virtual-time-budget=4000", f"--screenshot={shot}",
                 f"http://127.0.0.1:{port}/index.html"],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        finally:
            httpd.shutdown()
            httpd.server_close()
        if not shot.exists():
            raise RuntimeError("Chromium did not produce a screenshot")
        shutil.move(str(shot), str(out_path))
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return out_path


def main():
    ap = argparse.ArgumentParser(description="Build X share cards for BEACN DRep votes.")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--id", help="cip129 action id")
    g.add_argument("--latest", action="store_true", help="latest open action (default)")
    g.add_argument("--all", action="store_true", help="every action with a detail file")
    ap.add_argument("--desktop", action="store_true", help="also copy output(s) to ~/Desktop")
    ap.add_argument("--out", default=str(SHARE_DIR), help="output directory")
    args = ap.parse_args()

    status = load_json(ROOT / "status.json") or {}
    statements = load_json(PUB / "statements.json") or {}
    out_dir = Path(args.out)

    if args.all:
        ids = sorted(p.stem for p in (PUB / "actions").glob("*.json"))
    elif args.id:
        ids = [args.id]
    else:
        latest = pick_latest(status)
        if not latest:
            print("No actions found in status.json", file=sys.stderr)
            return 1
        ids = [latest]

    made = []
    for action_id in ids:
        try:
            model = build_model(action_id, status, statements)
            out = render_png(model, out_dir / f"{action_id}.png")
            made.append((action_id, model, out))
            print(f"✓ {model['vlabel']:<16} {out}")
        except Exception as exc:
            print(f"✗ {action_id}: {exc}", file=sys.stderr)

    if args.desktop and made:
        desktop = Path.home() / "Desktop"
        desktop.mkdir(exist_ok=True)
        for action_id, model, out in made:
            stamp = datetime.now().strftime("%Y-%m-%d")
            dest = desktop / f"beacn-vote-{stamp}-{action_id[:18]}.png"
            shutil.copy2(out, dest)
            print(f"  → {dest}")

    if made:
        ex = made[0]
        print(f"\nLive page: https://{SITE_URL}/#/action/{ex[0]}")
    return 0 if made else 1


if __name__ == "__main__":
    raise SystemExit(main())
