// Google Ads Script — schreibt taeglich Kampagnen-Kennzahlen in die Tabelle "Meier Ads Daten".
// Laeuft auf Googles Servern (Zeitplan taeglich), unabhaengig vom PC. Nur Lesen aus Ads + Schreiben in DIESE eine Tabelle.
function main() {
  var SHEET_ID = '1H9QwjIKgG89hQIoS05RTU70v-tFHoJ2sV1lUaaBdxiU';
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheets()[0];
  var tz = AdsApp.currentAccount().getTimeZone();

  function d(n){ var x=new Date(); x.setDate(x.getDate()-n); return Utilities.formatDate(x, tz, 'yyyy-MM-dd'); }
  function round2(n){ return Math.round(n*100)/100; }

  var a28 = fetchRange(d(28), d(1));
  var a7  = fetchRange(d(7),  d(1));

  sheet.clear();
  sheet.getRange('A1').setValue('Stand');
  sheet.getRange('B1').setValue(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'));
  var header = ['Kampagne','Klicks_28','Impr_28','Kosten_28','Conv_28','Klicks_7','Kosten_7','Conv_7'];
  sheet.getRange(3, 1, 1, 8).setValues([header]);

  var names = {};
  for (var k in a28) names[k] = 1;
  for (var k2 in a7) names[k2] = 1;

  var rows = [];
  for (var name in names) {
    var x = a28[name] || {clicks:0, impr:0, cost:0, conv:0};
    var y = a7[name]  || {clicks:0, impr:0, cost:0, conv:0};
    rows.push([name, x.clicks, x.impr, round2(x.cost), x.conv, y.clicks, round2(y.cost), y.conv]);
  }
  if (rows.length) sheet.getRange(4, 1, rows.length, 8).setValues(rows);
  Logger.log('Fertig: ' + rows.length + ' Kampagnen geschrieben.');
}

function fetchRange(from, to) {
  var out = {};
  // Nur AKTIVE Kampagnen (pausierte/alte werden ausgeblendet).
  var q = "SELECT campaign.name, metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions " +
          "FROM campaign WHERE segments.date BETWEEN '" + from + "' AND '" + to + "' AND campaign.status = 'ENABLED'";
  var it = AdsApp.report(q).rows();
  while (it.hasNext()) {
    var r = it.next();
    var name = r['campaign.name'];
    if (!out[name]) out[name] = {clicks:0, impr:0, cost:0, conv:0};
    out[name].clicks += parseInt(r['metrics.clicks'], 10) || 0;
    out[name].impr   += parseInt(r['metrics.impressions'], 10) || 0;
    out[name].cost   += (parseInt(r['metrics.cost_micros'], 10) || 0) / 1000000;
    out[name].conv   += parseFloat(r['metrics.conversions']) || 0;
  }
  return out;
}
