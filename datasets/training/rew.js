var fs = require('fs');
var carrier = require('carrier');

var write = fs.createWriteStream('fixed-binds.json');
carrier.carry(fs.createReadStream('binds.json'), function (line) {
  var bind = JSON.parse(String(line).replace(/^\s+|\s+$/, ''));
  bind.ant = bind.colony.substr(2, 2) + bind.colony.substr(0, 2);
  bind.colony = bind.colony.substr(-2);
  write.write(JSON.stringify(bind) + '\n');
});