var fs = require('fs');

var ANT_COUNT = 78;
var COLONY_COUNT = 45;

function generateIds (count) {
  return Array(count).join(' ').split('').map(function (_, i) { return ('0000' + i.toString(16)).substr(-4); });
}

function ant_base(cols) {
  // Add ants.
  generateIds(ANT_COUNT).forEach( function (ant_id) {
    // console.log(ant_id)
    cols.ants.insert({
      _id: String(ant_id)
    }, function (err, docs) {
      if (err) {
        console.error(err);
      } else {
        // ant_id created
        console.log("inserted initial ant ", ant_id);
      }  
    });
  });

  // Add colonies.
  generateIds(COLONY_COUNT).forEach( function (colony_id) {
    // console.log(ant_id)
    cols.colonies.update({
      _id: String(colony_id)
    }, {
      _id: String(colony_id),
      $set: {}
    }, {
      upsert: true
    }, function (err, docs) {
      if (err) {
        console.error(err);
      } else {
        // ant_id created
        console.log("inserted initial colony ", colony_id);
      }  
    });
  });
}

module.exports = ant_base;