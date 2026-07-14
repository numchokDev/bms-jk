const Datastore = require('@seald-io/nedb');
const path = require('path');

const db = new Datastore({
  filename: path.join(__dirname, '..', 'data', 'bms_log.db'),
  autoload: true
});

db.find({ packSOC: { $gt: 100 } }).limit(5).exec((err, docs) => {
  if (err) console.error(err);
  else console.log(docs);
});
