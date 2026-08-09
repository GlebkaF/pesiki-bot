#!/usr/bin/env python3
"""Собирает HTML-отчёт по результатам мульти-агентного прогона."""
import json, html, os, datetime

r = json.load(open("/tmp/wfr.json"))
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "web", "report.html")
e = html.escape

syn = r.get("synthesis") or {}
proto = r.get("prototype") or {}
inv = r.get("inventory") or {}
ca = r.get("copyAudit") or {}
lex = r.get("lexicon") or {}
rr = r.get("replayResearch") or {}
confirmed = r.get("confirmed") or []
verified = r.get("verified") or []

VERDICT_LABEL = {"делать": "Делать", "делать-иначе": "Делать, но иначе", "не-делать": "Не делать"}


def card(title, body, sub=""):
    return f'<section class="card"><h2>{e(title)}</h2>{f"<p class=dim>{e(sub)}</p>" if sub else ""}{body}</section>'


# --- находки ред-тима ---
sev_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
findings_html = ""
for f in sorted(confirmed, key=lambda x: sev_rank.get(x.get("severity"), 9)):
    v = f.get("verdict") or {}
    findings_html += f"""
    <article class="finding sev-{e(f.get('severity','medium'))}">
      <div class="fhead"><span class="sev">{e(f.get('severity',''))}</span><h3>{e(f.get('title',''))}</h3></div>
      <p>{e(f.get('argument',''))}</p>
      <p class="ev"><span class="label">масштаб после проверки</span><br>{e((v.get('realScale') or '')[:700])}</p>
      <p class="fix"><span class="label">что делать</span><br>{e(f.get('mitigation',''))}</p>
    </article>"""

rejected = [f for f in verified if not (f.get("verdict") or {}).get("confirmed")]
rejected_html = "".join(f"<li>{e(f.get('title',''))}</li>" for f in rejected)

# --- копирайт ---
copy_rows = ""
for i in (ca.get("issues") or [])[:22]:
    copy_rows += f"""<tr>
      <td><span class="tag">{e(i.get('category',''))}</span></td>
      <td class="bad-txt">{e(i.get('quote','')[:150])}</td>
      <td class="good-txt">{e(i.get('better','')[:150])}</td></tr>"""

absent = (lex.get("absentInChat") or [])[:24]
absent_html = "".join(f'<span class="chip chip-bad">{e(w.split("(")[0].strip())}</span>' for w in absent)

slang_rows = ""
for s in (lex.get("slang") or [])[:14]:
    slang_rows += f"""<tr><td class="mono">{e(s.get('word',''))}</td><td>{e(s.get('meaning','')[:160])}</td>
      <td class="quote">{e(s.get('example','')[:150])}</td></tr>"""

quotes_html = "".join(f"<li>{e(q[:180])}</li>" for q in (lex.get("quotes") or [])[:10])

# --- парсер ---
empty_html = ""
for x in (inv.get("alwaysEmpty") or []):
    name = x.split("—")[0].strip()
    why = x.split("—", 1)[1].strip() if "—" in x else ""
    empty_html += f'<li><b class="mono">{e(name[:110])}</b><br><span class="dim">{e(why[:420])}</span></li>'

unused_html = "".join(f'<li class="mono">{e(x[:130])}</li>' for x in (inv.get("collectedButUnused") or [])[:10])

plan_rows = ""
for p in syn.get("parserPlan", []):
    plan_rows += f"""<tr class="pri-{e(p.get('priority',''))}">
      <td><span class="pri">{e(p.get('priority',''))}</span></td>
      <td>{e(p.get('what','')[:260])}</td>
      <td class="dim">{e(p.get('why','')[:160])}</td>
      <td class="mono">{e(p.get('effort','')[:40])}</td></tr>"""

# --- карта ---
metrics_by_player = {}
for m in (proto.get("metrics") or []):
    metrics_by_player.setdefault(m["player"], {})[m["metric"]] = m["value"]

map_rows = ""
for player, ms in list(metrics_by_player.items())[:10]:
    map_rows += f"""<tr><td>{e(player)}</td>
      <td class="mono">{e(ms.get('own_half_pct','—'))}</td>
      <td class="mono">{e(ms.get('forest_pct','—'))}</td>
      <td class="mono">{e(ms.get('avg_ally_dist','—'))}</td></tr>"""

map_ideas = ""
for m in (rr.get("mapMetrics") or []):
    map_ideas += f'<li><span class="diff diff-{e(m.get("difficulty",""))}">{e(m.get("difficulty",""))}</span> <b>{e(m.get("metric",""))}</b> — <span class="dim">{e(m.get("why","")[:170])}</span></li>'

copy_plan = "".join(f"<li>{e(x[:400])}</li>" for x in syn.get("copyPlan", []))
risks = "".join(f"<li>{e(x[:400])}</li>" for x in syn.get("topRisks", [])[:6])

page = f"""<title>Ред-тим: тренеры, копирайт, парсер</title>
<style>
:root {{
  --ground:#EDEFF2; --surface:#FFFFFF; --surface-2:#F6F7F9; --ink:#12161B; --muted:#66707D;
  --line:#DBDFE5; --accent:#9A6B14; --accent-soft:#C8922A;
  --crit:#A6403A; --high:#B5762A; --ok:#2E7D4F;
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    --ground:#0D1014; --surface:#161A20; --surface-2:#1C222A; --ink:#E6E9EE; --muted:#8A94A2;
    --line:#252B34; --accent:#E0A93F; --accent-soft:#C8922A;
    --crit:#CC5A50; --high:#D9A44A; --ok:#5CB183;
  }}
}}
:root[data-theme="dark"] {{
  --ground:#0D1014; --surface:#161A20; --surface-2:#1C222A; --ink:#E6E9EE; --muted:#8A94A2;
  --line:#252B34; --accent:#E0A93F; --accent-soft:#C8922A;
  --crit:#CC5A50; --high:#D9A44A; --ok:#5CB183;
}}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--ground); color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; font-size:15px; line-height:1.55; }}
.mono {{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-variant-numeric:tabular-nums; font-size:.92em; }}
.wrap {{ max-width:980px; margin:0 auto; padding:38px 20px 90px; display:flex; flex-direction:column; gap:22px; }}
h1 {{ font-size:29px; letter-spacing:-.02em; margin:0 0 6px; text-wrap:balance; }}
h2 {{ font-size:19px; letter-spacing:-.01em; margin:0 0 10px; }}
h3 {{ font-size:15px; margin:0; }}
.dim, .sub {{ color:var(--muted); font-size:13px; }}
p {{ margin:0 0 10px; }}
.label {{ text-transform:uppercase; font-size:10px; letter-spacing:.09em; color:var(--muted); }}
.card {{ background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:20px 22px; }}
.stats {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:1px;
  background:var(--line); border:1px solid var(--line); border-radius:10px; overflow:hidden; }}
.stat {{ background:var(--surface); padding:13px 15px; }}
.stat .v {{ font-size:22px; font-weight:650; font-family:ui-monospace,monospace; display:block; }}
.verdict {{ border-left:4px solid var(--accent-soft); background:var(--surface-2); padding:18px 20px;
  border-radius:0 10px 10px 0; }}
.verdict .badge {{ display:inline-block; background:var(--accent-soft); color:#fff; font-weight:650;
  padding:3px 12px; border-radius:999px; font-size:13px; margin-bottom:10px; }}
.finding {{ border:1px solid var(--line); border-radius:10px; padding:15px 17px; margin-bottom:12px;
  background:var(--surface-2); }}
.fhead {{ display:flex; align-items:center; gap:10px; margin-bottom:8px; }}
.sev {{ font-size:10px; text-transform:uppercase; letter-spacing:.08em; padding:3px 8px; border-radius:999px;
  color:#fff; background:var(--high); }}
.sev-critical .sev {{ background:var(--crit); }}
.ev, .fix {{ font-size:13px; background:var(--surface); border-radius:8px; padding:9px 12px; margin:8px 0 0; }}
table {{ width:100%; border-collapse:collapse; font-size:13.5px; }}
th {{ text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.07em; color:var(--muted);
  font-weight:600; padding:0 10px 8px 0; border-bottom:1px solid var(--line); }}
td {{ padding:8px 10px 8px 0; border-bottom:1px solid var(--line); vertical-align:top; }}
.tablewrap {{ overflow-x:auto; }}
.bad-txt {{ color:var(--crit); }}
.good-txt {{ color:var(--ok); }}
.quote {{ color:var(--muted); font-style:italic; }}
.tag {{ font-size:10px; padding:2px 7px; border-radius:999px; border:1px solid var(--line);
  color:var(--muted); white-space:nowrap; }}
.chip {{ display:inline-block; font-size:12px; padding:3px 9px; border-radius:999px; margin:0 5px 6px 0;
  border:1px solid var(--line); background:var(--surface-2); }}
.chip-bad {{ color:var(--crit); border-color:color-mix(in srgb, var(--crit) 40%, transparent); }}
ul {{ margin:0; padding-left:20px; }}
li {{ margin-bottom:7px; }}
ul.plain {{ list-style:none; padding:0; }}
.pri {{ font-size:10px; text-transform:uppercase; letter-spacing:.07em; padding:2px 8px; border-radius:999px;
  border:1px solid var(--line); white-space:nowrap; }}
.pri-высокий .pri {{ background:var(--crit); color:#fff; border-color:transparent; }}
.pri-средний .pri {{ background:var(--high); color:#fff; border-color:transparent; }}
.diff {{ font-size:10px; padding:2px 7px; border-radius:999px; border:1px solid var(--line); color:var(--muted); }}
.diff-лёгкая {{ color:var(--ok); border-color:color-mix(in srgb, var(--ok) 40%, transparent); }}
.ok-box {{ background:color-mix(in srgb, var(--ok) 10%, transparent);
  border:1px solid color-mix(in srgb, var(--ok) 35%, transparent); border-radius:10px; padding:14px 16px; }}
footer {{ color:var(--muted); font-size:12px; text-align:center; }}
</style>

<div class="wrap">
  <header>
    <h1>Ред-тим: персональные тренеры, копирайт и апгрейд парсера</h1>
    <p class="sub">Мульти-агентный прогон по трём вопросам. Находки проверялись скептиками — то, что не подтвердилось, из отчёта убрано.</p>
  </header>

  <div class="stats">
    <div class="stat"><span class="label">агентов</span><span class="v">16</span></div>
    <div class="stat"><span class="label">время</span><span class="v">46м</span></div>
    <div class="stat"><span class="label">токенов</span><span class="v">1.0M</span></div>
    <div class="stat"><span class="label">находок</span><span class="v">{len(verified)}</span></div>
    <div class="stat"><span class="label">подтвердилось</span><span class="v">{len(confirmed)}</span></div>
    <div class="stat"><span class="label">копирайт</span><span class="v">{len(ca.get('issues') or [])}</span></div>
  </div>

  {card("Вопрос 1: тренер на каждого игрока", f'''
    <div class="verdict">
      <span class="badge">{e(VERDICT_LABEL.get(syn.get("coachVerdict",""), syn.get("coachVerdict","")))}</span>
      <p>{e(syn.get("coachReasoning","")[:1400])}</p>
    </div>
    <h3 style="margin:18px 0 8px">Что предлагается вместо</h3>
    <p>{e(syn.get("coachAlternative","")[:1500])}</p>''')}

  {card("Подтверждённые находки", findings_html + (f'<p class="dim" style="margin-top:14px">Не подтвердилось при проверке и в отчёт не вошло:</p><ul class="dim">{rejected_html}</ul>' if rejected_html else ""),
        f"{len(confirmed)} из {len(verified)} прошли адверсариальную проверку")}

  {card("Вопрос 2: копирайт", f'''
    <p class="dim">Слова и обороты, которых в вашем чате нет ни разу за 8775 сообщений, но которые бот употребляет:</p>
    <div style="margin:12px 0 18px">{absent_html}</div>
    <div class="tablewrap"><table>
      <thead><tr><th>тип</th><th>как пишет бот</th><th>как говорят в чате</th></tr></thead>
      <tbody>{copy_rows}</tbody></table></div>
    <h3 style="margin:22px 0 10px">План правок</h3>
    <ul>{copy_plan}</ul>''')}

  {card("Словарь вашего чата", f'''
    <p class="dim">Извлечён из экспорта переписки. Это то, чем надо кормить промпт вместо общих слов.</p>
    <div class="tablewrap"><table>
      <thead><tr><th>слово</th><th>значение</th><th>как употребляют</th></tr></thead>
      <tbody>{slang_rows}</tbody></table></div>
    <h3 style="margin:22px 0 10px">Цитаты, задающие тон</h3>
    <ul>{quotes_html}</ul>''')}

  {card("Вопрос 3: карта — прототип работает", f'''
    <div class="ok-box">
      <b>Позиции героев извлекаются.</b> Формула выведена и сверена с ground truth из combat log:
      <span class="mono">worldX = cellX*128 + vecX − 16384</span>. Парсинг: <b>{e(str(proto.get("parseSeconds",""))[:60])}</b>.
      Проверено на двух независимых реплеях, цифры осмысленные.
    </div>
    <h3 style="margin:20px 0 10px">Живые цифры с вашего матча</h3>
    <div class="tablewrap"><table>
      <thead><tr><th>герой</th><th>своя половина</th><th>в лесу</th><th>дистанция до союзника</th></tr></thead>
      <tbody>{map_rows}</tbody></table></div>
    <h3 style="margin:22px 0 10px">Что можно считать дальше</h3>
    <ul class="plain">{map_ideas}</ul>''')}

  {card("Дыры в данных", f'''
    <p class="dim">Поля, которые парсер объявляет, но которые всегда пустые — проверено на 60 игроках из 6 матчей.</p>
    <ul class="plain">{empty_html}</ul>
    <h3 style="margin:20px 0 10px">Собираем, но не доносим до модели</h3>
    <ul class="plain">{unused_html}</ul>''')}

  {card("План работ", f'''<div class="tablewrap"><table>
      <thead><tr><th>приоритет</th><th>что сделать</th><th>зачем</th><th>трудоёмкость</th></tr></thead>
      <tbody>{plan_rows}</tbody></table></div>''')}

  {card("Главные риски", f"<ul>{risks}</ul>")}

  <footer>Собрано {datetime.datetime.now().strftime('%d.%m.%Y')} · 16 агентов · находки прошли проверку на опровержение</footer>
</div>
"""

os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w").write(page)
print("готово:", OUT, f"({len(page)//1024} КБ)")
