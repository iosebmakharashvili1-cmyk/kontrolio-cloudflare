const fs = require('fs');
const code = fs.readFileSync('/mnt/user-data/outputs/kontrolio/rustavi-stops.js', 'utf8') + '\nmodule.exports = STOPS;';
fs.writeFileSync('/tmp/rustavi_stops_test.js', code);
const STOPS = require('/tmp/rustavi_stops_test.js');
console.log('total rustavi stops:', STOPS.length);

const names = {};
STOPS.forEach(s => { names[s.id] = s.name; });

fs.writeFileSync(
  '/mnt/user-data/outputs/kontrolio/functions/api/_rustaviStopNames.js',
  '/* ავტომატურად გენერირებული rustavi-stops.js-დან */\nexport const STOP_NAMES = ' + JSON.stringify(names) + ';\n'
);
console.log('written, count:', Object.keys(names).length);
