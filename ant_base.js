var fs = require('fs');

function ant_base(cols) {
  // open up ant_ids.txt
  var ant_ids = fs.readFileSync('datasets/ant/ant_ids.txt', 'utf-8').split('\n');

  ant_ids.forEach( function (ant_id) {
    console.log(cols);
    // console.log(ant_id)
    cols.ants.insert({
      _id: String(ant_id)
    }, function (err, docs) {
      if (err) {
        console.error(err);
      } else if (!err && docs[0]) {
        // ant_id created
        console.log("inserted ", docs[0]);
      }  
    });
  });
}

module.exports = ant_base;