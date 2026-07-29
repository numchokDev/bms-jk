const Datastore = require('@seald-io/nedb');
const path = require('path');

const db = new Datastore({
  filename: path.join(__dirname, '..', 'data', 'bms_log.db'),
  autoload: true
});

db.find({ packSOC: 612 }).limit(5).exec((err, docs) => {
  console.log("Docs with SOC=612:", docs);
});

db.find({ packSOC: { $gt: 100 } }).limit(10).exec((err, docs) => {
  console.log("Docs with SOC > 100 count/samples:", docs.length, docs.slice(0, 3));
});

db.find({ packSOC: { $lte: 100 } }).sort({ timestamp: -1 }).limit(5).exec((err, docs) => {
  console.log("Docs with SOC <= 100:", docs);
});
