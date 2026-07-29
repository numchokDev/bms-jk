const Datastore = require('@seald-io/nedb');
const path = require('path');

const db = new Datastore({
  filename: path.join(__dirname, '..', 'data', 'bms_log.db'),
  autoload: true
});

db.find({ timestamp: { $gte: '2026-07-22T17:00:00.000Z' } }).sort({ timestamp: 1 }).exec((err, docs) => {
  if (err) console.error(err);
  console.log(`Total docs today Thailand Local Time: ${docs.length}`);
  let posA = 0, negA = 0, zeroA = 0;
  let posW = 0, negW = 0, zeroW = 0;
  docs.forEach(d => {
    if (d.packA > 0.01) posA++;
    else if (d.packA < -0.01) negA++;
    else zeroA++;

    if (d.packW > 0.1) posW++;
    else if (d.packW < -0.1) negW++;
    else zeroW++;
  });
  console.log(`packA > 0.01: ${posA}, packA < -0.01: ${negA}, packA ~ 0: ${zeroA}`);
  console.log(`packW > 0.1: ${posW}, packW < -0.1: ${negW}, packW ~ 0: ${zeroW}`);

  if (docs.length > 0) {
    console.log("Sample positive packA/packW:", docs.filter(d => d.packA > 0.01 || d.packW > 0.1).slice(0, 5));
    console.log("Sample negative packA/packW:", docs.filter(d => d.packA < -0.01 || d.packW < -0.1).slice(0, 5));
  }
});
