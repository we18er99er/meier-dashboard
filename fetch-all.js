// Full data fetch for the Meier marketing dashboard.
// Writes data.json with all metrics used by the dashboard.
const fs = require('fs');
const path = require('path');
const { getAccessToken, ga4RunReport, scQuery, iso, daysAgo } = require('./lib');

const LEAD_EVENTS = [
  'telefon_click', 'mail_click', 'termin_bad_ausstellung',
  'termin_heizung_infoabend', 'bad_angebot_absenden',
];

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

(async () => {
  const token = await getAccessToken([
    'https://www.googleapis.com/auth/analytics.readonly',
    'https://www.googleapis.com/auth/webmasters.readonly',
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
    ads: { status: 'pending', note: 'Wartet auf Entwickler-Token-Freischaltung (Stufe 2).' },
  };

  fs.writeFileSync(path.join(__dirname, 'data.json'), JSON.stringify(data, null, 2));
  console.log('data.json geschrieben.');
  console.log('Besucher gestern:', yesterday.totalUsers, '| 7T:', w.current.totalUsers, '| 28T:', m.current.totalUsers);
  console.log('Anfragen 28T:', leads28.total, JSON.stringify(leads28.byEvent));
  console.log('SC Klicks 28T:', sc28.clicks, '| Impressionen:', sc28.impressions);
  console.log('Kanäle:', channels.map((c) => c.key + '=' + c.value).join(', '));
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
