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

var nearby = {
  "01": ["02"],
  "02": ["01", "03"],
  "03": ["02", "06"],
  "06": ["03", "07"],
  "06": ["06"]
};
var farby = {
  "01": ["03"],
  "02": ["06"],
  "03": ["01", "07"],
  "06": ["02"],
  "07": ["03"]
};

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

// Variables.
var GUESS_INTERVAL = process.env.GUESS_INTERVAL || 10*1000;
var GUESS_THRESHOLD = process.env.GUESS_THRESHOLD || 3*60*1000;
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

  // Log some sod.
  console.log('\nGuessing location based on binds from', querytime, 'to', currenttime);
  console.log('Incorrectest ants:', JSON.stringify(INCORRECT_ANTS));
  console.log('Incorrectest colonies:', JSON.stringify(INCORRECT_COLS));
  console.log(new Date(querytime));
  console.log('-----------------');

  cols.binds.find({
    time: {
      $gt: querytime
     // $lt: currenttime
    }   
  }).sort({time: 1}).each(function (err, bind) {
    if (bind == null) {
      // Fetched all binds. Process guess.
      consumeBinds();

      // Consume next binds.
      //setTimeout(calculateGuesses.bind(null, currenttime + GUESS_INTERVAL), 0);
      setTimeout(sampler.bind(this, cols, callback), GUESS_INTERVAL);
    } else {
      //if (bind.ant in CORRECT && COLONIES.indexOf(bind.colony) >= 0) {
        consumeGuess(guesses, bind, querytime, currenttime);
        (adequateness[bind.ant] || (adequateness[bind.ant] = 0));
        adequateness[bind.ant]++;
      //}
    }
  });

  function consumeBinds () {
    // For each ant's bundle of binds, perform our algorithm.
    if (Object.keys(guesses).map(function (antid) {
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
        });
      })

      return true;
    }).indexOf(true) < 0) {
      console.log('Start:', new Date(querytime))
      console.log('End:', new Date(currenttime))
      /*
      ANTS.forEach(function (antid) {
        console.log(antid, '(' + CORRECT[antid] + ')', '=>', ANT_GUESSES[antid])
      });
      console.log('Success rate:', CONFIDENCE_SUCCESSFUL, '/', CONFIDENCE_TOTAL, '(accepting ' + (CONFIDENCE_TOTAL/(CONFIDENCE_TOTAL+CONFIDENCE_DROPPED)) + '%) => ', (CONFIDENCE_SUCCESSFUL/CONFIDENCE_TOTAL) + '%')
      process.exit(1);
      */
    }
  }

  function consumeGuess (guesses, bind, start, end) {
    // Group binds by ant ID.
    var bindFreshness = (1 - FRESHNESS_WEIGHT) + (bind.time - start)/(end - start) * FRESHNESS_WEIGHT;
    var binds = (guesses[bind.ant] || (guesses[bind.ant] = {}));
    (binds[bind.colony] || (binds[bind.colony] = 0));
    binds[bind.colony] += 1.0 * bindFreshness;
    (nearby[bind.colony] || []).forEach(function (near) {
      (binds[near] || (binds[near] = 0));
      binds[near] += NEARBY_BONUS * bindFreshness;
    });
    (farby[bind.colony] || []).forEach(function (near) {
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

module.exports = sampler;