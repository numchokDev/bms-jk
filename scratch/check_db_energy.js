const Datastore = require('@seald-io/nedb');
const path = require('path');

const db = new Datastore({
  filename: path.join(__dirname, '..', 'data', 'bms_log.db'),
  autoload: true
});

db.find({}).sort({ timestamp: 1 }).exec((err, docs) => {
  if (err) {
    console.error(err);
    return;
  }
  
  console.log(`Total records: ${docs.length}`);
  
  const dayMap = {};
  docs.forEach(doc => {
    // Group by local day or UTC day
    const day = doc.timestamp.substring(0, 10);
    if (!dayMap[day]) {
      dayMap[day] = {
        date: day,
        records: 0,
        chargeWh: 0,
        dischargeWh: 0,
        minSOC: doc.packSOC,
        maxSOC: doc.packSOC,
        sumSOC: 0
      };
    }
    const d = dayMap[day];
    d.records++;
    d.sumSOC += doc.packSOC;
    d.minSOC = Math.min(d.minSOC, doc.packSOC);
    d.maxSOC = Math.max(d.maxSOC, doc.packSOC);
    
    const packA = doc.packA || 0;
    const deltaWh = doc.energyDeltaWh || 0;
    
    if (packA > 0.01) {
      d.chargeWh += deltaWh;
    } else if (packA < -0.01) {
      d.dischargeWh += deltaWh;
    }
  });
  
  console.log("Daily summary from raw logs grouping:");
  Object.values(dayMap).forEach(d => {
    const avgSOC = Math.round(d.sumSOC / d.records);
    console.log(`Date: ${d.date} | Records: ${d.records} | Charge: ${(d.chargeWh / 1000).toFixed(4)} kWh | Discharge: ${(d.dischargeWh / 1000).toFixed(4)} kWh | SOC: ${d.minSOC}% - ${d.maxSOC}% (avg ${avgSOC}%)`);
  });
});
