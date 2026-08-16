// Generates dashboard.html (standalone, theme-aware) from data.json.
const fs = require('fs');
const path = require('path');
const d = require('./data.json');

const nf = (n) => new Intl.NumberFormat('de-DE').format(Math.round(n || 0));
const pf1 = (n) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n || 0);
const dt = (isoStr) => new Date(isoStr).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dateOnly = (s) => new Date(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

// trend vs previous; higherIsBetter=false for e.g. search position
function trendBadge(cur, prev, higherIsBetter = true) {
  if (prev == null || prev === 0) return '<span class="tr tr-flat">neu</span>';
  const pct = (cur - prev) / prev;
  const up = pct > 0.02, down = pct < -0.02;
  const good = higherIsBetter ? up : down;
  const bad = higherIsBetter ? down : up;
  const cls = good ? 'tr-up' : bad ? 'tr-down' : 'tr-flat';
  const arrow = up ? '▲' : down ? '▼' : '▬';
  const val = (pct > 0 ? '+' : '') + pf1(pct * 100) + ' %';
  return `<span class="tr ${cls}">${arrow} ${val}</span>`;
}

function light(state) { return `<span class="dot dot-${state}" aria-hidden="true"></span>`; }

const ga = d.ga4, sc = d.searchConsole;

// ---- KPI values ----
const visYest = ga.yesterday.totalUsers;
const vis7 = ga.week.current.totalUsers, vis7p = ga.week.previous.totalUsers;
const leads28 = ga.leads28.total;
const scClicks = sc.last28.clicks, scClicksP = sc.prev28.clicks;

// traffic lights (simple, honest heuristics)
const kpiLightVisitors = vis7 >= vis7p ? 'green' : (vis7 >= vis7p * 0.8 ? 'amber' : 'red');
const kpiLightLeads = leads28 >= 5 ? 'green' : (leads28 >= 1 ? 'amber' : 'red');
const kpiLightClicks = scClicks >= scClicksP ? 'green' : (scClicks >= scClicksP * 0.8 ? 'amber' : 'red');

const channelsTotal = ga.channels.reduce((s, c) => s + c.value, 0) || 1;
const channelLabel = {
  'Direct': 'Direkt (Name/Lesezeichen)',
  'Organic Search': 'Google-Suche (unbezahlt)',
  'Paid Search': 'Google Ads (bezahlt)',
  'Referral': 'Verweise von anderen Seiten',
  'Organic Social': 'Social Media (unbezahlt)',
  'Paid Social': 'Social Media (bezahlt)',
  'Email': 'Newsletter/E-Mail',
  'Unassigned': 'Nicht zugeordnet',
};

const leadLabel = {
  'bad_angebot_absenden': 'Bad-Angebot abgeschickt',
  'termin_bad_ausstellung': 'Termin Bad-Ausstellung gebucht',
  'termin_heizung_infoabend': 'Termin Heizung/Infoabend gebucht',
  'telefon_click': 'Auf Telefonnummer geklickt',
  'mail_click': 'Auf E-Mail-Adresse geklickt',
};
const leadOrder = ['bad_angebot_absenden', 'termin_bad_ausstellung', 'termin_heizung_infoabend', 'telefon_click', 'mail_click'];

function channelRows() {
  return ga.channels.map((c) => {
    const w = Math.round((c.value / channelsTotal) * 100);
    return `<tr><td>${channelLabel[c.key] || c.key}</td>
      <td class="num">${nf(c.value)}</td>
      <td class="barcell"><span class="bar" style="width:${w}%"></span><span class="barpct">${w} %</span></td></tr>`;
  }).join('');
}

function leadRows() {
  return leadOrder.map((ev) => {
    const c = (ga.leads28.byEvent[ev] || 0);
    const c7 = (ga.leads7.byEvent[ev] || 0);
    const zeroNote = (c === 0 && (ev === 'telefon_click' || ev === 'mail_click'))
      ? ' <span class="hint">— zählt erst nach Cookie-Zustimmung</span>' : '';
    return `<tr><td>${leadLabel[ev] || ev}${zeroNote}</td><td class="num">${nf(c7)}</td><td class="num">${nf(c)}</td></tr>`;
  }).join('');
}

function queryRows() {
  return sc.topQueries.slice(0, 8).map((q) =>
    `<tr><td>${q.query}</td><td class="num">${nf(q.clicks)}</td><td class="num">${nf(q.impressions)}</td><td class="num">${pf1(q.position)}</td></tr>`
  ).join('');
}

function topPageRows() {
  return ga.topPages.slice(0, 6).map((p) =>
    `<tr><td>${p.key}</td><td class="num">${nf(p.value)}</td></tr>`
  ).join('');
}

const html = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meier Marketing-Cockpit</title>
<style>
  :root{
    --bg:#eef2f5; --card:#ffffff; --ink:#152230; --muted:#5b6b7a; --line:#dce4ea;
    --primary:#0e7490; --primary-soft:#e0f2f7; --heat:#ea580c;
    --green:#15803d; --amber:#b45309; --red:#b91c1c;
    --green-bg:#dcfce7; --amber-bg:#fef3c7; --red-bg:#fee2e2;
    --shadow:0 1px 2px rgba(16,32,48,.06),0 4px 16px rgba(16,32,48,.05);
  }
  @media (prefers-color-scheme:dark){:root:not([data-theme=light]){
    --bg:#0e1620; --card:#182430; --ink:#e6edf3; --muted:#93a4b3; --line:#2a3a49;
    --primary:#38bdf8; --primary-soft:#0c2733; --heat:#fb923c;
    --green:#4ade80; --amber:#fbbf24; --red:#f87171;
    --green-bg:#0f2e1c; --amber-bg:#332410; --red-bg:#361618;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 6px 20px rgba(0,0,0,.35);
  }}
  :root[data-theme=dark]{
    --bg:#0e1620; --card:#182430; --ink:#e6edf3; --muted:#93a4b3; --line:#2a3a49;
    --primary:#38bdf8; --primary-soft:#0c2733; --heat:#fb923c;
    --green:#4ade80; --amber:#fbbf24; --red:#f87171;
    --green-bg:#0f2e1c; --amber-bg:#332410; --red-bg:#361618;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 6px 20px rgba(0,0,0,.35);
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.5;
    font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1000px;margin:0 auto;padding:28px 20px 64px}
  header.top{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px}
  h1{font-size:1.6rem;margin:0;letter-spacing:-.02em}
  .sub{color:var(--muted);font-size:.9rem;margin:0 0 24px}
  .sub b{color:var(--ink)}
  h2{font-size:1.06rem;margin:34px 0 12px;display:flex;align-items:center;gap:9px}
  h2 .em{width:5px;height:20px;border-radius:3px;background:var(--primary);display:inline-block}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 17px;box-shadow:var(--shadow);overflow-x:auto}
  .kpi .label{font-size:.82rem;color:var(--muted);display:flex;align-items:center;gap:7px;margin-bottom:4px}
  .kpi .big{font-size:2rem;font-weight:700;letter-spacing:-.02em;line-height:1.1}
  .kpi .row2{display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap}
  .kpi .expl{font-size:.8rem;color:var(--muted);margin-top:9px}
  .dot{width:11px;height:11px;border-radius:50%;display:inline-block;flex:none}
  .dot-green{background:var(--green)} .dot-amber{background:var(--amber)} .dot-red{background:var(--red)}
  .tr{font-size:.78rem;font-weight:600;padding:2px 7px;border-radius:20px;white-space:nowrap}
  .tr-up{color:var(--green);background:var(--green-bg)}
  .tr-down{color:var(--red);background:var(--red-bg)}
  .tr-flat{color:var(--muted);background:var(--line)}
  .muted{color:var(--muted)}
  table{width:100%;border-collapse:collapse;font-size:.9rem;min-width:420px}
  th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
  th{font-size:.74rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  tr:last-child td{border-bottom:none}
  .barcell{width:34%}
  .bar{display:inline-block;height:9px;border-radius:5px;background:var(--primary);vertical-align:middle;min-width:2px}
  .barpct{font-size:.78rem;color:var(--muted);margin-left:8px}
  .hint{font-size:.8rem;color:var(--amber)}
  .note{background:var(--primary-soft);border:1px solid var(--line);border-radius:12px;padding:13px 15px;font-size:.88rem;margin-top:14px}
  .note b{color:var(--primary)}
  .periods{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
  .per{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:13px 15px;box-shadow:var(--shadow)}
  .per .t{font-size:.8rem;color:var(--muted)} .per .v{font-size:1.5rem;font-weight:700} .per .row2{margin-top:5px}
  .pending{opacity:.75;font-style:italic}
  .gloss dt{font-weight:600;margin-top:10px} .gloss dd{margin:2px 0 0;color:var(--muted);font-size:.9rem}
  footer{margin-top:40px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:.82rem}
  .legend{display:flex;gap:16px;flex-wrap:wrap;font-size:.8rem;color:var(--muted);margin-top:8px}
  .legend span{display:flex;align-items:center;gap:6px}
  @media (max-width:600px){
    .wrap{padding:18px 13px 48px}
    h1{font-size:1.32rem}
    .sub{font-size:.84rem}
    h2{font-size:1rem;margin:28px 0 10px}
    .kpi .big{font-size:1.75rem}
    .per .v{font-size:1.35rem}
    .card{padding:14px 14px;border-radius:12px}
    th,td{padding:8px 8px}
    .barcell{width:26%}
    .legend{gap:10px 14px}
  }
</style>

<div class="wrap">
  <header class="top">
    <h1>Marketing-Überblick — Meier Sanitär</h1>
  </header>
  <p class="sub">Automatisch aktualisiert · Stand: <b>${dt(d.generatedAt)}</b> Uhr &nbsp;·&nbsp; Quellen: Google Analytics + Google Search Console</p>

  <div class="legend">
    <span>${light('green')} gut / im Plus</span>
    <span>${light('amber')} beobachten</span>
    <span>${light('red')} rückläufig</span>
    <span>▲ mehr als Vorperiode &nbsp; ▼ weniger</span>
  </div>

  <h2><span class="em"></span>Auf einen Blick</h2>
  <div class="grid">
    <div class="card kpi">
      <div class="label">${light(kpiLightVisitors)} Besucher · letzte 7 Tage</div>
      <div class="big">${nf(vis7)}</div>
      <div class="row2">${trendBadge(vis7, vis7p)} <span class="muted" style="font-size:.8rem">ggü. Vorwoche (${nf(vis7p)})</span></div>
      <div class="expl">Verschiedene Menschen, die deine Website besucht haben.</div>
    </div>
    <div class="card kpi">
      <div class="label">${light('green')} Besucher · gestern</div>
      <div class="big">${nf(visYest)}</div>
      <div class="row2">${trendBadge(visYest, ga.dayBefore.totalUsers)} <span class="muted" style="font-size:.8rem">ggü. Vortag (${nf(ga.dayBefore.totalUsers)})</span></div>
      <div class="expl">Tagesaktuelle Besucherzahl von gestern.</div>
    </div>
    <div class="card kpi">
      <div class="label">${light(kpiLightLeads)} Anfragen · letzte 28 Tage</div>
      <div class="big">${nf(leads28)}</div>
      <div class="row2"><span class="muted" style="font-size:.8rem">${nf(ga.leads7.total)} in den letzten 7 Tagen</span></div>
      <div class="expl">Angebote, Terminbuchungen & Kontakt-Klicks zusammen.</div>
    </div>
    <div class="card kpi">
      <div class="label">${light(kpiLightClicks)} Google-Suche · Klicks (28 T.)</div>
      <div class="big">${nf(scClicks)}</div>
      <div class="row2">${trendBadge(scClicks, scClicksP)} <span class="muted" style="font-size:.8rem">ggü. Vorperiode (${nf(scClicksP)})</span></div>
      <div class="expl">Klicks aus der unbezahlten Google-Suche auf deine Seite.</div>
    </div>
  </div>

  <h2><span class="em"></span>Website-Besucher</h2>
  <div class="periods">
    <div class="per"><div class="t">Gestern</div><div class="v">${nf(visYest)}</div><div class="row2">${trendBadge(visYest, ga.dayBefore.totalUsers)}</div></div>
    <div class="per"><div class="t">Letzte 7 Tage</div><div class="v">${nf(vis7)}</div><div class="row2">${trendBadge(vis7, vis7p)}</div></div>
    <div class="per"><div class="t">Letzte 28 Tage</div><div class="v">${nf(ga.month.current.totalUsers)}</div><div class="row2">${trendBadge(ga.month.current.totalUsers, ga.month.previous.totalUsers)}</div></div>
  </div>
  <p class="sub" style="margin-top:10px">Der Pfeil vergleicht immer mit dem gleich langen Zeitraum davor. Ein Minus im Sommer ist oft saisonal (Urlaubszeit).</p>

  <h2><span class="em"></span>Woher kommen die Besucher? <span class="muted" style="font-weight:400;font-size:.85rem">(letzte 28 Tage, nach Sitzungen)</span></h2>
  <div class="card">
    <table><thead><tr><th>Kanal</th><th class="num">Sitzungen</th><th>Anteil</th></tr></thead>
    <tbody>${channelRows()}</tbody></table>
  </div>
  <div class="note"><b>Kurz erklärt:</b> „Direkt" = Leute, die deinen Namen kennen (Stammkunden, Lesezeichen). „Google-Suche (unbezahlt)" = kostenlose Treffer. „Google Ads (bezahlt)" = deine Anzeigen. Ein gesunder Mix aus allen dreien ist das Ziel.</div>

  <h2><span class="em"></span>Anfragen &amp; Kontakt-Aktionen <span class="muted" style="font-weight:400;font-size:.85rem">(7 / 28 Tage)</span></h2>
  <div class="card">
    <table><thead><tr><th>Aktion</th><th class="num">7 Tage</th><th class="num">28 Tage</th></tr></thead>
    <tbody>${leadRows()}</tbody></table>
  </div>
  <div class="note">Das sind die messbaren „Türklinken-Bewegungen" auf der Website. <b>Hinweis:</b> Klicks auf Telefon/E-Mail werden erst gezählt, wenn Besucher dem Cookie-Banner zustimmen — deshalb stehen sie evtl. noch auf 0. Das behalten wir im Auge.</div>

  <h2><span class="em"></span>Google-Suche (Sichtbarkeit) <span class="muted" style="font-weight:400;font-size:.85rem">(${dateOnly(d.dateInfo.scRange28[0])}–${dateOnly(d.dateInfo.scRange28[1])})</span></h2>
  <div class="grid">
    <div class="card kpi"><div class="label">Impressionen</div><div class="big">${nf(sc.last28.impressions)}</div><div class="row2">${trendBadge(sc.last28.impressions, sc.prev28.impressions)}</div><div class="expl">So oft wurdest du in Google angezeigt.</div></div>
    <div class="card kpi"><div class="label">Klicks</div><div class="big">${nf(sc.last28.clicks)}</div><div class="row2">${trendBadge(sc.last28.clicks, sc.prev28.clicks)}</div><div class="expl">So oft wurde auf dich geklickt.</div></div>
    <div class="card kpi"><div class="label">Klickrate (CTR)</div><div class="big">${pf1(sc.last28.ctr * 100)} %</div><div class="row2">${trendBadge(sc.last28.ctr, sc.prev28.ctr)}</div><div class="expl">Von 100 Anzeigen bei Google, wie viele klicken.</div></div>
    <div class="card kpi"><div class="label">Ø Position</div><div class="big">${pf1(sc.last28.position)}</div><div class="row2">${trendBadge(sc.last28.position, sc.prev28.position, false)}</div><div class="expl">Deine Platzierung (1 = ganz oben). Kleiner ist besser.</div></div>
  </div>

  <h2 style="margin-top:22px"><span class="em"></span>Top-Suchbegriffe</h2>
  <div class="card">
    <table><thead><tr><th>Suchbegriff bei Google</th><th class="num">Klicks</th><th class="num">Anzeigen</th><th class="num">Ø Pos.</th></tr></thead>
    <tbody>${queryRows()}</tbody></table>
  </div>
  <div class="note"><b>Wichtig zu verstehen:</b> Die meisten Klicks kommen über deinen <b>Namen</b> („Stefan Meier", „Meier Eichstetten"). Das ist top für Bekanntheit, heißt aber: Bei allgemeinen Suchen wie „Bad sanieren" oder „Wärmepumpe" wirst du noch selten gefunden. Genau da setzen die neuen Google-Ads-Kampagnen an — und langfristig die Suchmaschinen-Optimierung.</div>

  <h2><span class="em"></span>Google Ads (Anzeigen)</h2>
  <div class="card pending">
    <p style="margin:0">⏳ <b>In Vorbereitung (Stufe 2).</b> ${d.ads.note} Sobald Google den Zugang freischaltet, erscheinen hier automatisch Klicks, Kosten und Kosten pro Anfrage deiner Kampagnen (Wärmepumpe &amp; Bad).</p>
  </div>

  <h2><span class="em"></span>Kleines Wörterbuch</h2>
  <div class="card gloss">
    <dl>
      <dt>Besucher (Nutzer)</dt><dd>Verschiedene Menschen. Eine Person zählt pro Zeitraum nur einmal, egal wie oft sie kommt.</dd>
      <dt>Sitzung</dt><dd>Ein einzelner Besuch. Eine Person kann mehrere Sitzungen haben.</dd>
      <dt>Impression</dt><dd>Einmal in der Google-Suche angezeigt werden — noch ohne Klick.</dd>
      <dt>Klickrate (CTR)</dt><dd>Klicks geteilt durch Impressionen. Zeigt, wie attraktiv dein Suchtreffer ist.</dd>
      <dt>Ø Position</dt><dd>Durchschnittlicher Rang in den Google-Ergebnissen. 1 = ganz oben. Kleiner = besser.</dd>
    </dl>
  </div>

  <footer>
    <p>Diese Seite wird einmal täglich automatisch mit frischen Zahlen neu erstellt. Analytics-Daten bis gestern, Google-Suche-Daten mit ~3 Tagen Verzögerung (so liefert Google sie). Nur-Lese-Zugriff über ein separates Dienstkonto — es werden keine Einstellungen verändert.</p>
    <p>Erstellt: ${dt(d.generatedAt)} Uhr.</p>
  </footer>
</div>
`;

fs.writeFileSync(path.join(__dirname, 'dashboard.html'), html);
console.log('dashboard.html geschrieben (' + html.length + ' Zeichen).');
