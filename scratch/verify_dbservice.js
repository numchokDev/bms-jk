const dbService = require('../src/services/dbService');

async function testSummary() {
  const summary = await dbService.getDailySummary('all');
  console.log("Summary from dbService.getDailySummary('all'):");
  summary.forEach(row => {
    console.log(`Date: ${row.date} | Records: ${row.recordCount} | Charge: ${row.chargeKWh.toFixed(3)} kWh | Discharge: ${row.dischargeKWh.toFixed(3)} kWh | SOC: ${row.minSOC}% - ${row.maxSOC}% (avg ${row.avgSOC}%)`);
  });
}

testSummary().catch(console.error);
