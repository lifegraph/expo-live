var fs = require('fs');
var path = require('path');
var http = require('http');

var async = require('async');
var express = require('express');
var mongo = require('mongodb'), ObjectID = mongo.ObjectID;
var socketio = require('socket.io');
require('colors');


/**
 * Config
 */

/*
var MONGO_URI = process.env.MONGOLAB_URI || "mongodb://localhost/olinexpoapi";
*/

var AC3 = ['0028', '0027', '0026', '0025', '0024', '0023', '0022', '0021', '0020', '001F', '001E', '001D', '001C', '001B', '001A', '0019', '0018', '0017', '0016', '0015']
var AC1 = ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '000A', '000B', '000C', '000D', '000E', '000F', '0010', '0011', '0012', '0013', '0014'];

function getNearby (colony, howfar) {
  var near = [], i;
  howfar = howfar || 1;
  if ((i = AC3.indexOf(colony)) >= -1) {
    near = [AC3[i-howfar], AC3[i+howfar]]
  } else if ((i = AC1.indexOf(colony)) >= -1) {
    near = [AC1[i-howfar], AC1[i+howfar]];
  }
  return near.filter(function (a) {
    return a != null;
  });
}

/*
function getNearby (loc) {
  loc = String(loc);
  if (!loc.match(/^AC[13]D/)) {
    return [];
  }
  var desk = loc.replace(/^AC[13]D/, '');
  if (desk >= 21) {

  } else {
    if (desk == 1) return ['AC1'];
  }
}
*/

/*
var CORRECT = {
  "1900": "01",
  "08FF": "01",
  "3500": "02",
  "2C00": "02",
  "3A00": "03",
  "063D": "03",
  "3400": "06",
  "3500": "06",
  "05FF": "07",
  "3200": "07"
}

var ANTS = ['1900', '08FF', '3500', '2C00', '3A00', '063D', '3400', '3500', '05FF', '3200'];

var COLONIES = ['01', '02', '03', '06', '07'];
var COLONIES_SET = (function () {
  var set = {};
  COLONIES.forEach(function (k) {
    set[k] = 0;
  });
  return set;
})();
*/

var INCORRECT_ANTS = {}, INCORRECT_COLS = {}, ANT_GUESSES = {};
var CONFIDENCE_SUCCESSFUL = 0, CONFIDENCE_TOTAL = 0, CONFIDENCE_DROPPED = 0;

var historyCache = {};

// Variables.
var GUESS_INTERVAL = process.env.GUESS_INTERVAL || 10*1000;
var GUESS_THRESHOLD = process.env.GUESS_THRESHOLD || (1/6)*60*1000;
var CONFIDENCE_CUTOFF = 0.70;
var ADEQUATE_THRESHOLD = 8; // Threshold for confidence by # of binds available.
var ADEQUATE_THRESHOLD_LIMIT = 0; // Threshold for limit of # of binds.
var NEARBY_BONUS = 0.9; // Bonus for 1 away
var FARBY_BONUS = 0.5; // Bonus for 2 away
var FRESHNESS_WEIGHT = 0; // How fresh the bind is
var BEST_WEIGHT = 0.5; // How certain the colony is

function sampler (cols, callback) {
  // Query for the last GUESS_THRESHOLD of binds. 
  var guesses = {};
  var adequateness = {};
  var currenttime = Date.now();
  var querytime = currenttime - GUESS_THRESHOLD;

  historySampler(cols);

  // Log some sod.
  console.log('\nGuessing location based on binds from', querytime, 'to', currenttime);
  //console.log('Incorrectest ants:', JSON.stringify(INCORRECT_ANTS));
  //console.log('Incorrectest colonies:', JSON.stringify(INCORRECT_COLS));
  //console.log(new Date(querytime));
  //console.log('-----------------');

  cols.binds.find({
    time: {
      $gt: querytime
     // $lt: currenttime
    }   
  }).sort({time: 1}).each(function (err, bind) {
    if (bind == null) {
      // Fetched all binds. Process guesses.
      setTimeout(consumeBinds, 200);

      // Consume next binds.
      setTimeout(sampler.bind(this, cols, callback), GUESS_INTERVAL);
    } else {
      try {
        consumeGuess(guesses, bind, querytime, currenttime);
        (adequateness[bind.ant] || (adequateness[bind.ant] = 0));
        adequateness[bind.ant]++;
      } catch (e) {}
    }
  });

  function consumeBinds () {
    // For each ant's bundle of binds, perform our algorithm.
    Object.keys(guesses).forEach(function (antid) {
      var guess = makeGuess(guesses[antid], antid);
      console.log(guess);
      if (!guess) {
        return;
      }
      // Adjust confidence by sample size
      guess.confidence *= ADEQUATE_THRESHOLD_LIMIT + ((Math.min(ADEQUATE_THRESHOLD, adequateness[antid])/ADEQUATE_THRESHOLD) * (1 - ADEQUATE_THRESHOLD_LIMIT));
      
      var log = (antid + ' => ' + guess.location + ' (confidence ' + guess.confidence + ')');
      /*
      console.log(guess.confidence < CONFIDENCE_CUTOFF ? log.yellow : CORRECT[antid] == guess.location ? log.green : log.red);
      if (guess.confidence >= CONFIDENCE_CUTOFF) {
        CONFIDENCE_TOTAL++;
        if (CORRECT[antid] == guess.location) {
          CONFIDENCE_SUCCESSFUL++;
        }
      } else {
        CONFIDENCE_DROPPED++;
      }

      // Stats for "wrongest" colonies.
      if (CORRECT[antid] != guess.location) {
        (INCORRECT_ANTS[antid] || (INCORRECT_ANTS[antid] = 0));
        INCORRECT_ANTS[antid]++;
        (INCORRECT_COLS[guess.location] || (INCORRECT_COLS[guess.location] = 0));
        INCORRECT_COLS[guess.location]++;
      }

      // Set what the likelyhood of the ant guess is overall for this location.
      ANT_GUESSES[antid] || (ANT_GUESSES[antid] = JSON.parse(JSON.stringify(COLONIES_SET)));
      ANT_GUESSES[antid][guess.location]++;
      */

      // Populate the guess with a user/location.
      cols.colonies.findOne({
        _id: guess.location
      }, function (err, colony) {
        cols.ants.findOne({
          _id: antid
        }, function (err, ant) {

          // Either ant or location may be null, don't rely on their existing
          callback({
            colony: guess.location,
            confidence: guess.confidence,
            confident: guess.confidence >= CONFIDENCE_CUTOFF,
            location: colony && colony.location,
            time: currenttime,
            ant: antid,
            user: ant && ant.user,
          });

          // Add guess to history cache.
          if (colony && colony.location && ant && ant.user) {
            (historyCache[antid] || (historyCache[antid] = {}));
            historyCache[antid][colony.location] || (historyCache[antid][colony.location] = 0);
            historyCache[antid][colony.location]++;
          }
        });
      })

      return true;
    });
  }

  function consumeGuess (guesses, bind, start, end) {
    // Group binds by ant ID.
    var bindFreshness = (1 - FRESHNESS_WEIGHT) + (bind.time - start)/(end - start) * FRESHNESS_WEIGHT;
    var binds = (guesses[bind.ant] || (guesses[bind.ant] = {}));
    (binds[bind.colony] || (binds[bind.colony] = 0));
    binds[bind.colony] += 1.0 * bindFreshness;
    var nearby = getNearby(bind.colony, 1);
    (nearby || []).forEach(function (near) {
      (binds[near] || (binds[near] = 0));
      binds[near] += NEARBY_BONUS * bindFreshness;
    });
    var farby = getNearby(bind.colony, 2);
    (farby || []).forEach(function (near) {
      (binds[near] || (binds[near] = 0));
      binds[near] += FARBY_BONUS * bindFreshness;
    });
  }

  function makeGuess (binds, antid) {
    // Check maximum location.
    var bestlocid, bestloc = -1, total = 0;
    Object.keys(binds).forEach(function (locid) {
      if (bestloc < binds[locid]) {
        bestlocid = locid;
        bestloc = binds[locid];
      }
      total += bestloc;
    })

    // If there is no location with binds, return null.
    console.log('Guess data:', JSON.stringify(binds));
    return !(bestloc > 0) ? null : {
      location: bestlocid,
      confidence: (1 - BEST_WEIGHT) + ((bestloc / total) * BEST_WEIGHT)
    };
  }
}

function historySampler (cols) {
  var hist = historyCache;
  historyCache = {};

  try {
    Object.keys(hist).forEach(function (antid) {
      var maxid, max = 0;
      Object.keys(hist[antid]).forEach(function (colid) {
        if (hist[antid][colid] > max) {
          max = hist[antid][colid];
          maxid = colid;
        }
      });

      // Make new history bind.
      cols.colonies.findOne({
        _id: colid
      }, function (err, colony) {
        cols.ants.findOne({
          _id: antid
        }, function (err, ant) {
          if (ant && ant.user && colony && colony.location) {

            // Create history element
            console.log('History ==> User', ant.user, 'was at', colony.location, 'for a minute');
            cols.history.insert({
              time: Date.now(),
              ant: antid,
              colony: colid,
              user: ant && ant.user,
              location: colony && colony.location
            }, function (err, docs) {
              // inserted history element
            });
          }
        });
      });
    });
  } catch (e) { }

  setTimeout(historySampler, 1000);
}

module.exports = sampler;