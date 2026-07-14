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
  let prevTimestamp = null;
  
  docs.forEach(doc => {
    // Convert to Thailand Local Date (UTC+7)
    const dateObj = new Date(doc.timestamp);
    const localTime = new Date(dateObj.getTime() + (7 * 60 * 60 * 1000));
    const day = localTime.toISOString().substring(0, 10);
    
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
    
    // Calculate actual elapsed seconds
    let elapsedSeconds = 2;
    if (prevTimestamp) {
      const diffMs = new Date(doc.timestamp) - new Date(prevTimestamp);
      if (diffMs > 0 && diffMs < 60000) {
        elapsedSeconds = diffMs / 1000.0;
      }
    }
    prevTimestamp = doc.timestamp;
    
    const packA = doc.packA || 0;
    const packW = Math.abs(doc.packW || 0);
    const calculatedDeltaWh = (packW * elapsedSeconds) / 3600.0;
    
    if (packA > 0.01) {
      d.chargeWh += calculatedDeltaWh;
    } else if (packA < -0.01) {
      d.dischargeWh += calculatedDeltaWh;
    }
  });
  
  console.log("Daily summary from dynamic integration (UTC+7):");
  Object.values(dayMap).forEach(d => {
    const avgSOC = Math.round(d.sumSOC / d.records);
    console.log(`Date: ${d.date} | Records: ${d.records} | Charge: ${(d.chargeWh / 1000).toFixed(4)} kWh | Discharge: ${(d.dischargeWh / 1000).toFixed(4)} kWh | SOC: ${d.minSOC}% - ${d.maxSOC}% (avg ${avgSOC}%)`);
  });
});
