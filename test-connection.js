// Connection test: authenticate and pull one sample report from GA4 + Search Console.
const { getAccessToken, ga4RunReport, scQuery, iso, daysAgo } = require('./lib');

(async () => {
  console.log('== 1) Anmeldung (Service-Account) ==');
  const token = await getAccessToken([
    'https://www.googleapis.com/auth/analytics.readonly',
    'https://www.googleapis.com/auth/webmasters.readonly',
  ]);
  console.log('OK: Access-Token erhalten (Länge ' + token.length + ')\n');

  console.log('== 2) GA4: letzte 7 Tage ==');
  const ga = await ga4RunReport(token, {
    dateRanges: [{ startDate: iso(daysAgo(7)), endDate: iso(daysAgo(1)) }],
    metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' }],
  });
  const row = ga.rows && ga.rows[0];
  if (row) {
    console.log('Sitzungen:', row.metricValues[0].value);
    console.log('Nutzer:   ', row.metricValues[1].value);
    console.log('Seitenaufrufe:', row.metricValues[2].value);
  } else {
    console.log('GA4 antwortete, aber ohne Zeilen (evtl. 0 Daten):', JSON.stringify(ga).slice(0, 200));
  }
  console.log('');

  console.log('== 3) Search Console: letzte 28 Tage (Summe) ==');
  const sc = await scQuery(token, {
    startDate: iso(daysAgo(30)),
    endDate: iso(daysAgo(3)),
    dimensions: [],
    rowLimit: 1,
  });
  const s = sc.rows && sc.rows[0];
  if (s) {
    console.log('Klicks:      ', s.clicks);
    console.log('Impressionen:', s.impressions);
    console.log('CTR:         ', (s.ctr * 100).toFixed(2) + '%');
    console.log('Ø Position:  ', s.position.toFixed(1));
  } else {
    console.log('SC antwortete, aber ohne Zeilen:', JSON.stringify(sc).slice(0, 200));
  }
  console.log('\n== ALLES OK ==');
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
