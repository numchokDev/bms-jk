const Datastore = require('@seald-io/nedb');
const path = require('path');

const db = new Datastore({
  filename: path.join(__dirname, '..', 'data', 'bms_log.db'),
  autoload: true
});

db.find({ timestamp: { $regex: /2026-07-12T09:3[89]:/ } }).sort({ timestamp: 1 }).exec((err, docs) => {
  if (err) console.error(err);
  else console.log(docs);
});
