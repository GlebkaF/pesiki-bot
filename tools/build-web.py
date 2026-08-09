#!/usr/bin/env python3
"""Собирает статическую витрину матчей стака из данных парсера и результатов eval."""
import json, os, html, datetime, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "web", "index.html")

feed = json.load(open(os.path.join(ROOT, "data/stack_feed.json")))
deep_files = {}
for p in glob.glob(os.path.join(ROOT, "data/replays/*.json")):
    d = json.load(open(p))
    deep_files[int(d["match_id"])] = d

evals = {}
for p in glob.glob(os.path.join(ROOT, "data/eval/*.v*.txt")):
    base = os.path.basename(p)
    mid, ver, _ = base.split(".")
    evals.setdefault(int(mid), {})[ver] = open(p).read().strip()

e = html.escape


def dur(sec):
    return f"{sec // 60}:{sec % 60:02d}"


def spark(series, w=150, h=34, color="var(--accent)"):
    """Спарклайн кривой; нулевая линия — если ряд знакопеременный."""
    if not series:
        return ""
    lo, hi = min(series), max(series)
    rng = (hi - lo) or 1
    step = w / max(1, len(series) - 1)
    pts = [(i * step, h - (v - lo) / rng * h) for i, v in enumerate(series)]
    d = " ".join(f"{'M' if i == 0 else 'L'}{x:.1f},{y:.1f}" for i, (x, y) in enumerate(pts))
    zero = ""
    if lo < 0 < hi:
        zy = h - (0 - lo) / rng * h
        zero = f'<line x1="0" y1="{zy:.1f}" x2="{w}" y2="{zy:.1f}" class="spark-zero"/>'
    area = f"{d} L{w},{h} L0,{h} Z"
    return (
        f'<svg class="spark" viewBox="0 0 {w} {h}" width="{w}" height="{h}" aria-hidden="true">'
        f'<path d="{area}" fill="{color}" opacity=".12"/>{zero}'
        f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.6"/>'
        f'<circle cx="{pts[-1][0]:.1f}" cy="{pts[-1][1]:.1f}" r="2.4" fill="{color}"/></svg>'
    )


# ---------- сводка ----------
total = len(feed)
wins = sum(1 for m in feed if m["win"])
with_replay = len(deep_files)  # все матчи, которые разобрал наш парсер, не только из ленты
hours = sum(m["duration"] for m in feed) / 3600

rows = []
for m in sorted(feed, key=lambda x: -x["start"]):
    deep = deep_files.get(m["match_id"])
    ours = "".join(
        f'<span class="p"><b>{e(o["name"])}</b> <span class="hero">{e(o["hero"])}</span> '
        f'<span class="kda">{o["k"]}/{o["d"]}/{o["a"]}</span></span>'
        for o in m["ours"]
    )
    badge = '<span class="chip chip-deep">реплей разобран</span>' if deep else ""
    rows.append(f"""
    <article class="row {'win' if m['win'] else 'loss'}">
      <div class="res"><span class="res-mark">{'W' if m['win'] else 'L'}</span></div>
      <div class="meta">
        <div class="when">{e(m['date'])}</div>
        <div class="sub"><span class="mono">{dur(m['duration'])}</span> · id {m['match_id']}</div>
      </div>
      <div class="players">{ours}</div>
      <div class="tail">{badge}</div>
    </article>""")

# ---------- глубокая карточка ----------
DEEP_ID = 8895443601
deep = deep_files.get(DEEP_ID)
deep_html = ""
if deep:
    ours_team = None
    OUR_IDS = {93921511, 167818283, 94014640, 1869377945, 126449680, 92126977, 40087920,
               178693086, 97643532, 83930539, 76017871, 93253585, 62405887, 91407576}
    for p in deep["players"]:
        if int(p["steam_id"]) - 76561197960265728 in OUR_IDS:
            ours_team = p["team"]
    minutes = min(len(p["networth_by_minute"]) for p in deep["players"])
    adv = []
    for i in range(minutes):
        a = sum(p["networth_by_minute"][i] for p in deep["players"] if p["team"] == ours_team)
        b = sum(p["networth_by_minute"][i] for p in deep["players"] if p["team"] != ours_team)
        adv.append(a - b)

    prows = []
    for p in sorted(deep["players"], key=lambda x: (x["team"] != ours_team, -x["networth_final"])):
        is_our = int(p["steam_id"]) - 76561197960265728 in OUR_IDS
        prows.append(f"""
        <tr class="{'ours' if is_our else ''}">
          <td class="pl"><span class="dot {p['team']}"></span>{e(p['hero'])}
            <span class="pname">{e(p['name'])}</span>{' <span class="chip chip-our">наш</span>' if is_our else ''}</td>
          <td class="mono">{p['lane']}/{p['lane_role'][:4]}</td>
          <td class="mono">{p['kills']}/{p['deaths']}/{p['assists']}</td>
          <td class="mono">{p['last_hits']}<span class="dim">+{p['denies']}</span></td>
          <td class="mono">{p['cs_at_10']}</td>
          <td class="mono">{p['networth_final']:,}</td>
          <td class="mono">{p['hero_damage']:,}</td>
          <td class="spk">{spark(p['networth_by_minute'], 110, 24)}</td>
        </tr>""".replace(",", " "))

    fights = "".join(
        f'<li><span class="mono t">{int(t["start_min"])}:{int((t["start_min"]%1)*60):02d}</span>'
        f'<span class="fbar"><i style="width:{min(100, t["deaths"]*14)}%"></i></span>'
        f'<span class="fres {"good" if (t["radiant_died"] if ours_team=="dire" else t["dire_died"]) > (t["dire_died"] if ours_team=="dire" else t["radiant_died"]) else "bad"}">'
        f'{t["deaths"]} смертей</span>'
        f'<span class="dim">{e(", ".join(t["heroes_died"][:5]))}</span></li>'
        for t in deep["teamfights"][:10])

    deep_html = f"""
    <section class="card">
      <div class="card-head">
        <div>
          <h2>Матч {DEEP_ID}</h2>
          <p class="dim">{deep['duration_min']} мин · играли за {ours_team} · разобран собственным парсером за 3 секунды</p>
        </div>
        <div class="advbox">
          <span class="label">преимущество по золоту</span>
          {spark(adv, 220, 46)}
          <span class="mono advnum">{'+' if adv[-1] > 0 else ''}{adv[-1]:,}</span>
        </div>
      </div>
      <div class="tablewrap">
      <table>
        <thead><tr><th>игрок</th><th>линия</th><th>K/D/A</th><th>CS</th><th>CS@10</th><th>нетворс</th><th>урон</th><th>экономика</th></tr></thead>
        <tbody>{''.join(prows)}</tbody>
      </table>
      </div>
      <h3>Тимфайты</h3>
      <ul class="fights">{fights}</ul>
    </section>""".replace(",", " ")

# ---------- сравнение разборов ----------
cmp_html = ""
ev = evals.get(DEEP_ID, {})
if ev.get("v1") and ev.get("v2"):
    def clean(t):
        return e(t).replace("\n\n", "</p><p>").replace("\n", "<br>")
    cmp_html = f"""
    <section class="card">
      <h2>Разбор матча: было и стало</h2>
      <p class="dim">Один и тот же матч. Слева — текущая версия на данных API, справа — новая на данных реплея.</p>
      <div class="cmp">
        <div class="cmp-col old">
          <div class="cmp-head"><span class="chip">сейчас в боте</span></div>
          <div class="txt"><p>{clean(ev['v1'])}</p></div>
        </div>
        <div class="cmp-col new">
          <div class="cmp-head"><span class="chip chip-deep">v2, по реплею</span></div>
          <div class="txt"><p>{clean(ev['v2'])}</p></div>
        </div>
      </div>
    </section>"""

page = f"""<title>Песики · матчи стака</title>
<style>
:root {{
  --ground:#EDEFF2; --surface:#FFFFFF; --surface-2:#F6F7F9; --ink:#12161B; --muted:#68727F;
  --line:#DCE0E6; --accent:#9A6B14; --accent-soft:#C8922A;
  --radiant:#3F6B2A; --dire:#A6403A; --good:#2E7D4F; --bad:#A6403A;
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    --ground:#0D1014; --surface:#161A20; --surface-2:#1C222A; --ink:#E6E9EE; --muted:#8A94A2;
    --line:#252B34; --accent:#E0A93F; --accent-soft:#C8922A;
    --radiant:#6FA348; --dire:#CC5A50; --good:#5CB183; --bad:#CC5A50;
  }}
}}
:root[data-theme="dark"] {{
  --ground:#0D1014; --surface:#161A20; --surface-2:#1C222A; --ink:#E6E9EE; --muted:#8A94A2;
  --line:#252B34; --accent:#E0A93F; --accent-soft:#C8922A;
  --radiant:#6FA348; --dire:#CC5A50; --good:#5CB183; --bad:#CC5A50;
}}
* {{ box-sizing:border-box; }}
body {{
  margin:0; background:var(--ground); color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  font-size:15px; line-height:1.5;
}}
.mono {{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-variant-numeric:tabular-nums; }}
.wrap {{ max-width:1100px; margin:0 auto; padding:40px 20px 80px; display:flex; flex-direction:column; gap:26px; }}
header h1 {{ font-size:30px; letter-spacing:-.02em; margin:0 0 4px; }}
header p {{ margin:0; color:var(--muted); }}
.label {{ text-transform:uppercase; font-size:10.5px; letter-spacing:.09em; color:var(--muted); }}
.stats {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:1px;
  background:var(--line); border:1px solid var(--line); border-radius:10px; overflow:hidden; }}
.stat {{ background:var(--surface); padding:14px 16px; display:flex; flex-direction:column; gap:3px; }}
.stat .v {{ font-size:24px; font-weight:650; letter-spacing:-.02em;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-variant-numeric:tabular-nums; }}
.card {{ background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:20px; }}
.card h2 {{ margin:0 0 4px; font-size:19px; letter-spacing:-.01em; }}
.card h3 {{ margin:22px 0 10px; font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }}
.dim {{ color:var(--muted); font-size:13px; margin:0; }}
.feed {{ display:flex; flex-direction:column; gap:1px; background:var(--line);
  border:1px solid var(--line); border-radius:12px; overflow:hidden; }}
.row {{ background:var(--surface); display:grid; grid-template-columns:44px 150px 1fr auto;
  gap:14px; align-items:center; padding:11px 16px; }}
.row:hover {{ background:var(--surface-2); }}
.res-mark {{ display:grid; place-items:center; width:26px; height:26px; border-radius:6px;
  font-weight:700; font-size:12px; color:#fff; }}
.row.win .res-mark {{ background:var(--good); }}
.row.loss .res-mark {{ background:var(--bad); }}
.when {{ font-size:13px; font-weight:550; }}
.sub {{ font-size:11.5px; color:var(--muted); }}
.players {{ display:flex; flex-wrap:wrap; gap:6px 14px; font-size:12.5px; }}
.p b {{ font-weight:600; }}
.hero {{ color:var(--muted); }}
.kda {{ font-family:ui-monospace,monospace; font-variant-numeric:tabular-nums; color:var(--accent); }}
.chip {{ display:inline-block; font-size:10.5px; padding:2px 7px; border-radius:999px;
  border:1px solid var(--line); color:var(--muted); background:var(--surface-2); white-space:nowrap; }}
.chip-deep {{ border-color:var(--accent-soft); color:var(--accent); }}
.chip-our {{ border-color:var(--accent-soft); color:var(--accent); }}
.card-head {{ display:flex; justify-content:space-between; align-items:flex-start; gap:20px; flex-wrap:wrap; }}
.advbox {{ display:flex; flex-direction:column; gap:2px; align-items:flex-end; }}
.advnum {{ font-size:14px; color:var(--accent); font-weight:600; }}
.spark-zero {{ stroke:var(--line); stroke-width:1; stroke-dasharray:2 3; }}
.tablewrap {{ overflow-x:auto; margin-top:16px; }}
table {{ width:100%; border-collapse:collapse; font-size:13px; }}
th {{ text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.07em;
  color:var(--muted); font-weight:600; padding:0 10px 8px 0; border-bottom:1px solid var(--line); }}
td {{ padding:7px 10px 7px 0; border-bottom:1px solid var(--line); white-space:nowrap; }}
td.mono {{ font-family:ui-monospace,monospace; font-variant-numeric:tabular-nums; }}
tr.ours td {{ background:color-mix(in srgb, var(--accent) 7%, transparent); }}
.dot {{ display:inline-block; width:7px; height:7px; border-radius:2px; margin-right:7px; }}
.dot.radiant {{ background:var(--radiant); }}
.dot.dire {{ background:var(--dire); }}
.pname {{ color:var(--muted); font-size:12px; margin-left:6px; }}
.dim, .dim td {{ color:var(--muted); }}
td .dim {{ color:var(--muted); font-size:11px; }}
.fights {{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:5px; }}
.fights li {{ display:grid; grid-template-columns:48px 90px 92px 1fr; gap:12px; align-items:center;
  font-size:12.5px; padding:4px 0; border-bottom:1px solid var(--line); }}
.fights .t {{ color:var(--muted); }}
.fbar {{ height:5px; background:var(--surface-2); border-radius:3px; overflow:hidden; }}
.fbar i {{ display:block; height:100%; background:var(--accent-soft); }}
.fres.good {{ color:var(--good); }}
.fres.bad {{ color:var(--bad); }}
.cmp {{ display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px; }}
@media (max-width:820px) {{
  .cmp {{ grid-template-columns:1fr; }}
  .row {{ grid-template-columns:34px 1fr; row-gap:8px; }}
  .row .players {{ grid-column:1/-1; }}
}}
.cmp-col {{ border:1px solid var(--line); border-radius:10px; padding:14px; background:var(--surface-2); }}
.cmp-col.new {{ border-color:var(--accent-soft); }}
.cmp-head {{ margin-bottom:10px; }}
.txt {{ font-size:13px; line-height:1.55; }}
.txt p {{ margin:0 0 10px; }}
footer {{ color:var(--muted); font-size:12px; text-align:center; padding-top:10px; }}
</style>

<div class="wrap">
  <header>
    <h1>Песики</h1>
    <p>Матчи стака, разобранные собственным парсером реплеев</p>
  </header>

  <div class="stats">
    <div class="stat"><span class="label">матчей в ленте</span><span class="v">{total}</span></div>
    <div class="stat"><span class="label">побед</span><span class="v">{wins}/{total}</span></div>
    <div class="stat"><span class="label">винрейт</span><span class="v">{round(wins / total * 100)}%</span></div>
    <div class="stat"><span class="label">часов в игре</span><span class="v">{hours:.0f}</span></div>
    <div class="stat"><span class="label">реплеев разобрано</span><span class="v">{with_replay}</span></div>
  </div>

  {deep_html}
  {cmp_html}

  <section>
    <h2 style="font-size:19px;margin:0 0 12px;">Лента матчей</h2>
    <div class="feed">{''.join(rows)}</div>
  </section>

  <footer>Данные: реплеи Valve + OpenDota · собрано {datetime.datetime.now().strftime('%d.%m.%Y')}</footer>
</div>
"""

os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w").write(page)
print("готово:", OUT, f"({len(page) // 1024} КБ)")
