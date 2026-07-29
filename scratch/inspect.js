const Datastore = require('@seald-io/nedb');
const path = require('path');

const db = new Datastore({
  filename: path.join(__dirname, '..', 'data', 'bms_log.db'),
  autoload: true
});

db.find({}).sort({ timestamp: -1 }).limit(10).exec((err, docs) => {
  if (err) console.error(err);
  else console.log("Recent 10 docs:", JSON.stringify(docs, null, 2));
});

db.find({ packSOC: { $gte: 95 } }).sort({ timestamp: -1 }).limit(5).exec((err, docs) => {
  if (err) console.error(err);
  else console.log("SOC >= 95 docs:", JSON.stringify(docs, null, 2));
});
