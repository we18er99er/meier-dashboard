// Full data fetch for the Meier marketing dashboard.
// Writes data.json with all metrics used by the dashboard.
const fs = require('fs');
const path = require('path');
const { getAccessToken, ga4RunReport, scQuery, iso, daysAgo } = require('./lib');

const LEAD_EVENTS = [
  'telefon_click', 'mail_click', 'termin_bad_ausstellung',
  'termin_heizung_infoabend', 'bad_angebot_absenden',
  'thementag_anmeldung',
];
// Bewusst NICHT in LEAD_EVENTS: 'thementag_vortrag'. Das ist nur die Wahl des Vortrags
// innerhalb einer bereits gezaehlten Anmeldung - es mitzuzaehlen wuerde doppelt zaehlen.

function num(v) { return v == null ? 0 : Number(v); }

// GA4 report with two date ranges -> returns totals for [current, previous]
async function ga4Totals(token, metrics, curFrom, curTo, prevFrom, prevTo) {
  const r = await ga4RunReport(token, {
    dateRanges: [
      { startDate: iso(curFrom), endDate: iso(curTo) },
      { startDate: iso(prevFrom), endDate: iso(prevTo) },
    ],
    metrics: metrics.map((name) => ({ name })),
  });
  const out = { current: {}, previous: {} };
  // rows carry a dateRange dimension implicitly via metricValues per range? No:
  // with multiple dateRanges and no dimensions, GA4 returns one row per range.
  (r.rows || []).forEach((row) => {
    const rangeName = row.dimensionValues ? row.dimensionValues[0].value : null;
    const bucket = rangeName === 'date_range_1' ? out.previous : out.current;
    metrics.forEach((m, i) => { bucket[m] = num(row.metricValues[i].value); });
  });
  // Fallback: if only one row returned
  if (Object.keys(out.current).length === 0 && r.rows && r.rows[0]) {
    metrics.forEach((m, i) => { out.current[m] = num(r.rows[0].metricValues[i].value); });
  }
  return out;
}

async function ga4Single(token, metrics, from, to) {
  const r = await ga4RunReport(token, {
    dateRanges: [{ startDate: iso(from), endDate: iso(to) }],
    metrics: metrics.map((name) => ({ name })),
  });
  const out = {};
  if (r.rows && r.rows[0]) metrics.forEach((m, i) => { out[m] = num(r.rows[0].metricValues[i].value); });
  else metrics.forEach((m) => { out[m] = 0; });
  return out;
}

async function ga4Breakdown(token, dimension, metric, from, to, limit) {
  const r = await ga4RunReport(token, {
    dateRanges: [{ startDate: iso(from), endDate: iso(to) }],
    dimensions: [{ name: dimension }],
    metrics: [{ name: metric }],
    orderBys: [{ metric: { metricName: metric }, desc: true }],
    limit: limit || 10,
  });
  return (r.rows || []).map((row) => ({
    key: row.dimensionValues[0].value,
    value: num(row.metricValues[0].value),
  }));
}

async function ga4Leads(token, from, to) {
  const r = await ga4RunReport(token, {
    dateRanges: [{ startDate: iso(from), endDate: iso(to) }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: { fieldName: 'eventName', inListFilter: { values: LEAD_EVENTS } },
    },
  });
  const map = {};
  let total = 0;
  (r.rows || []).forEach((row) => {
    const name = row.dimensionValues[0].value;
    const c = num(row.metricValues[0].value);
    map[name] = c; total += c;
  });
  return { total, byEvent: map };
}

// Liest die Google-Tabelle "Meier Ads Daten", die das Google-Ads-Skript taeglich befuellt.
const ADS_SHEET_ID = '1H9QwjIKgG89hQIoS05RTU70v-tFHoJ2sV1lUaaBdxiU';
async function fetchAds(token) {
  try {
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${ADS_SHEET_ID}/values/A1:H60?valueRenderOption=UNFORMATTED_VALUE`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const j = await res.json();
    if (j.error || !j.values) return { status: 'pending', note: 'Ads-Daten noch nicht verfügbar (Tabelle leer).' };
    const vals = j.values;
    const rawStand = vals[0] && vals[0][1];
    // Google Sheets liefert Datum/Zeit als Serien-Zahl (Tage seit 1899-12-30) -> in lesbares Datum wandeln.
    let stand = '';
    if (typeof rawStand === 'number') {
      const ms = Math.round((rawStand - 25569) * 86400000);
      const dd = new Date(ms), p = (n) => String(n).padStart(2, '0');
      stand = `${dd.getUTCFullYear()}-${p(dd.getUTCMonth() + 1)}-${p(dd.getUTCDate())} ${p(dd.getUTCHours())}:${p(dd.getUTCMinutes())}`;
    } else if (rawStand) {
      stand = String(rawStand);
    }
    const camps = [];
    for (let i = 3; i < vals.length; i++) {
      const r = vals[i];
      if (!r || !r[0]) continue;
      camps.push({
        name: String(r[0]),
        clicks28: num(r[1]), impr28: num(r[2]), cost28: num(r[3]), conv28: num(r[4]),
        clicks7: num(r[5]), cost7: num(r[6]), conv7: num(r[7]),
      });
    }
    const sum = (k) => camps.reduce((s, c) => s + (c[k] || 0), 0);
    return {
      status: 'live',
      stand,
      campaigns: camps,
      total28: { clicks: sum('clicks28'), impr: sum('impr28'), cost: sum('cost28'), conv: sum('conv28') },
      total7: { clicks: sum('clicks7'), cost: sum('cost7'), conv: sum('conv7') },
    };
  } catch (e) {
    return { status: 'pending', note: 'Ads-Daten konnten nicht gelesen werden: ' + e.message };
  }
}


// --- Meta (Facebook/Instagram) Werbeanzeigen ---------------------------------
// Liest die Kennzahlen ueber die Meta Marketing API. Das Zugriffstoken kommt
// AUSSCHLIESSLICH aus der Umgebung (GitHub-Secret META_TOKEN) und steht nirgends
// im Repository - das Repo ist oeffentlich.
// Ohne Token liefert die Funktion sauber einen "pending"-Zustand, das Dashboard
// baut dann ganz normal weiter und zeigt den Abschnitt als "wird ergaenzt".
const META_ACT = 'act_713236902548592';
const META_VER = 'v26.0';

function metaAction(actions, type) {
  if (!Array.isArray(actions)) return 0;
  const hit = actions.find((a) => a.action_type === type);
  return hit ? num(hit.value) : 0;
}

async function metaGet(edge, params, token) {
  const qs = new URLSearchParams(Object.assign({ access_token: token }, params));
  const res = await fetch(`https://graph.facebook.com/${META_VER}/${edge}?${qs}`);
  const j = await res.json();
  // Fehlermeldungen von Meta koennen das Token spiegeln - nur die Message durchreichen.
  if (j.error) throw new Error(String(j.error.message || j.error.type || 'unbekannter Fehler'));
  return j;
}

async function metaInsights(token, preset) {
  const j = await metaGet(`${META_ACT}/insights`, {
    level: 'adset',
    fields: 'campaign_name,adset_name,impressions,reach,frequency,spend,clicks,actions',
    date_preset: preset,
    limit: '100',
  }, token);
  return (j.data || []).map((r) => ({
    campaign: r.campaign_name || '',
    adset: r.adset_name || '',
    impressions: num(r.impressions),
    reach: num(r.reach),
    frequency: num(r.frequency),
    spend: num(r.spend),
    clicks: num(r.clicks),
    linkClicks: metaAction(r.actions, 'link_click'),
    pageViews: metaAction(r.actions, 'landing_page_view'),
  }));
}

async function fetchMeta() {
  const token = process.env.META_TOKEN;
  if (!token) {
    // Klartext fuer die oeffentliche Seite; der technische Hinweis bleibt im Build-Log.
    console.log('Hinweis: META_TOKEN nicht gesetzt - Meta-Abschnitt bleibt im Wartezustand.');
    return { status: 'pending', note: 'Der Zugang zu Meta wird gerade eingerichtet. Sobald er steht, erscheinen die Zahlen hier automatisch.' };
  }
  try {
    const [rows30, rows7] = await Promise.all([
      metaInsights(token, 'last_30d'),
      metaInsights(token, 'last_7d'),
    ]);
    let campaigns = [];
    try {
      const c = await metaGet(`${META_ACT}/campaigns`, {
        fields: 'name,effective_status,start_time,stop_time',
        limit: '50',
      }, token);
      campaigns = (c.data || []).map((x) => ({
        name: x.name, status: x.effective_status || '',
        start: x.start_time || '', stop: x.stop_time || '',
      }));
    } catch (e) { /* Status ist nice-to-have, Zahlen zaehlen */ }

    const by7 = {};
    rows7.forEach((r) => { by7[r.campaign + '||' + r.adset] = r; });
    const adsets = rows30.map((r) => {
      const s = by7[r.campaign + '||' + r.adset] || {};
      return Object.assign({}, r, {
        spend7: s.spend || 0, impressions7: s.impressions || 0, pageViews7: s.pageViews || 0,
      });
    }).sort((a, b) => b.spend - a.spend);

    const sum = (arr, k) => arr.reduce((s, x) => s + (x[k] || 0), 0);
    const active = campaigns.filter((c) => c.status === 'ACTIVE' || c.status === 'IN_PROCESS');

    return {
      status: 'live',
      adsets,
      campaigns,
      activeCount: active.length,
      total30: {
        impressions: sum(rows30, 'impressions'), reach: sum(rows30, 'reach'),
        spend: sum(rows30, 'spend'), clicks: sum(rows30, 'clicks'),
        linkClicks: sum(rows30, 'linkClicks'), pageViews: sum(rows30, 'pageViews'),
      },
      total7: {
        impressions: sum(rows7, 'impressions'), reach: sum(rows7, 'reach'),
        spend: sum(rows7, 'spend'), clicks: sum(rows7, 'clicks'),
        linkClicks: sum(rows7, 'linkClicks'), pageViews: sum(rows7, 'pageViews'),
      },
    };
  } catch (e) {
    console.log('Meta-Abruf fehlgeschlagen:', e.message);
    return { status: 'pending', note: 'Die Meta-Zahlen konnten gerade nicht abgerufen werden. Beim naechsten Lauf wird es erneut versucht.' };
  }
}

(async () => {
  const token = await getAccessToken([
    'https://www.googleapis.com/auth/analytics.readonly',
    'https://www.googleapis.com/auth/webmasters.readonly',
    'https://www.googleapis.com/auth/spreadsheets.readonly',
  ]);

  const gaMetrics = ['totalUsers', 'sessions', 'screenPageViews'];

  const [yesterday, dayBefore, w, m] = await Promise.all([
    ga4Single(token, gaMetrics, daysAgo(1), daysAgo(1)),
    ga4Single(token, gaMetrics, daysAgo(2), daysAgo(2)),
    ga4Totals(token, gaMetrics, daysAgo(7), daysAgo(1), daysAgo(14), daysAgo(8)),
    ga4Totals(token, gaMetrics, daysAgo(28), daysAgo(1), daysAgo(56), daysAgo(29)),
  ]);

  const [channels, topPages, leads7, leads28] = await Promise.all([
    ga4Breakdown(token, 'sessionDefaultChannelGroup', 'sessions', daysAgo(28), daysAgo(1), 8),
    ga4Breakdown(token, 'pagePath', 'screenPageViews', daysAgo(28), daysAgo(1), 6),
    ga4Leads(token, daysAgo(7), daysAgo(1)),
    ga4Leads(token, daysAgo(28), daysAgo(1)),
  ]);

  // Search Console
  const scTotals = async (from, to) => {
    const r = await scQuery(token, { startDate: iso(from), endDate: iso(to), dimensions: [], rowLimit: 1 });
    const s = (r.rows && r.rows[0]) || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    return { clicks: s.clicks, impressions: s.impressions, ctr: s.ctr, position: s.position };
  };
  const [sc28, scPrev28, scQueries, scPages] = await Promise.all([
    scTotals(daysAgo(30), daysAgo(3)),
    scTotals(daysAgo(58), daysAgo(31)),
    scQuery(token, { startDate: iso(daysAgo(30)), endDate: iso(daysAgo(3)), dimensions: ['query'], rowLimit: 10 }),
    scQuery(token, { startDate: iso(daysAgo(30)), endDate: iso(daysAgo(3)), dimensions: ['page'], rowLimit: 6 }),
  ]);

  const ads = await fetchAds(token);
  const meta = await fetchMeta();

  const data = {
    generatedAt: new Date().toISOString(),
    dateInfo: {
      ga4Range28: [iso(daysAgo(28)), iso(daysAgo(1))],
      scRange28: [iso(daysAgo(30)), iso(daysAgo(3))],
    },
    ga4: {
      yesterday, dayBefore,
      week: w, month: m,
      channels, topPages,
      leads7, leads28,
    },
    searchConsole: {
      last28: sc28, prev28: scPrev28,
      topQueries: (scQueries.rows || []).map((r) => ({
        query: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position,
      })),
      topPages: (scPages.rows || []).map((r) => ({
        page: r.keys[0], clicks: r.clicks, impressions: r.impressions,
      })),
    },
    ads,
    meta,
  };

  fs.writeFileSync(path.join(__dirname, 'data.json'), JSON.stringify(data, null, 2));
  console.log('data.json geschrieben.');
  console.log('Besucher gestern:', yesterday.totalUsers, '| 7T:', w.current.totalUsers, '| 28T:', m.current.totalUsers);
  console.log('Anfragen 28T:', leads28.total, JSON.stringify(leads28.byEvent));
  console.log('SC Klicks 28T:', sc28.clicks, '| Impressionen:', sc28.impressions);
  console.log('Kanäle:', channels.map((c) => c.key + '=' + c.value).join(', '));
  console.log('Meta:', meta.status, meta.status === 'live'
    ? ('Anzeigengruppen=' + meta.adsets.length + ' Ausgaben30=' + meta.total30.spend.toFixed(2) + ' Seitenaufrufe30=' + meta.total30.pageViews)
    : (meta.note || ''));
  console.log('Ads:', ads.status, ads.status === 'live' ? ('Kampagnen=' + ads.campaigns.length + ' Klicks28=' + ads.total28.clicks + ' Kosten28=' + ads.total28.cost.toFixed(2)) : (ads.note || ''));
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
