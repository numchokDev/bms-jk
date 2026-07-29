const Datastore = require('@seald-io/nedb');
const path = require('path');

const db = new Datastore({
  filename: path.join(__dirname, '..', 'data', 'bms_log.db'),
  autoload: true
});

db.find({}).exec((err, docs) => {
  let g100 = 0, l100 = 0;
  let sampleG100 = [];
  let sampleL100 = [];
  docs.forEach(d => {
    if (d.packSOC > 100) {
      g100++;
      if (sampleG100.length < 10) sampleG100.push({ soc: d.packSOC, v: d.packV, a: d.packA, ts: d.timestamp });
    } else {
      l100++;
      if (sampleL100.length < 10) sampleL100.push({ soc: d.packSOC, v: d.packV, a: d.packA, ts: d.timestamp });
    }
  });
  console.log(`Total: ${docs.length}, >100: ${g100}, <=100: ${l100}`);
  console.log("Sample >100:", sampleG100);
  console.log("Sample <=100:", sampleL100);
});
