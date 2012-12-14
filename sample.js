var fs = require('fs');
var path = require('path');
var http = require('http');

var async = require('async');
var express = require('express');
var mongo = require('mongodb'), ObjectID = mongo.ObjectID;
var socketio = require('socket.io');
require('colors');

var pg = require('pg').native;


/**
 * Config
 */

var POSTGRES_URI = "postgres://dfgpdzocobqufp:aHD8_vXdE75M9mthWts2rVXSIf@ec2-54-243-248-219.compute-1.amazonaws.com:5432/dc6a8a3cvpj07g";
var MONGO_URI = process.env.MONGOLAB_URI || "mongodb://localhost/olinexpoapi";
var port = process.env.PORT || 5000;


/**
 * App
 */

var app = express();
app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
app.use(express.logger());
app.use(express.bodyParser());
app.use(express.static(__dirname + '/public'));

var server = http.createServer(app);


/**
 * Mongo API (binds, ants, colonies)
 */

// Binds

function bindJSON (bind) {
  return {
    id: bind.id,
    ant: bind.ant,
    colony: bind.colony,
    time: bind.time,
    user: bind.user,
    location: bind.location
  };
}

// GET /binds

app.get('/binds', function (req, res) {
  var first = null;
  res.write('[');
  cols.binds.find().sort('time').each(function (err, bind) {
    if (!bind) {
      return res.end(']');
    }
    if (first) {
      res.write(',');
    }
    first = bind;
    res.write(JSON.stringify(bind));
  });
});

// POST /hardware? ant=<ant id> && colony=<colony id>
// This creates a new bind. Associations between ants <=> users
// and colonies <=> locations exist server-side and augmented to
// this information.

app.post('/binds', function (req, res) {
  if (!req.body.ant || !req.body.colony) {
    return res.json({message: 'Need ant and colony parameter.'}, 500);
  }

  var bind = {
    ant: req.body.ant,
    colony: req.body.colony,
    time: Date.now()
  };

  // Find corresponding user and location.
  cols.ants.findOne({
    _id: bind.ant
  }, function (err, ant) {
    ant && (bind.user = ant.user);
    cols.colonies.findOne({
      _id: bind.colony
    }, function (err, colony) {
      colony && (bind.location = colony.location);

      // Insert bind.
      cols.binds.insert(bind, function (err) {
        io.sockets.emit('bind', bind);
        res.json({message: 'Succeeded in adding bind.'});
      });
    });
  });
});

// GET /binds/<bind id>

app.get('/binds/:id', function (req, res) {
  cols.binds.findOne({
    _id: new ObjectID(req.params.id)
  }, function (err, bind) {
    if (bind) {
      res.json(bindJSON(bind));
    } else {
      res.json({message: 'No such bind.'}, 404);
    }
  });
});

/**
 * Guesses.
 */

function guessJSON (guess) {
  return {
    id: guess._id,
    ant: guess.ant,
    colony: guess.colony,
    time: guess.time,
    user: guess.user,
    location: guess.location
  };
}


// DELETE /guesses/? ant=<ant id> || colony=<colony id>

app.del('/guesses', function (req, res) {
  var ant = req.query.ant, colony = req.query.colony;
  if (!ant && !colony && !req.query.force) {
    res.json({'message': 'Pleace specify force=1 to delete all guesses.'}, 400);
    return;
  }
  var crit = {};
  if (ant) {
    crit.ant = ant;
  }
  if (colony) {
    crit.colony = colony;
  }
  cols.guesses.remove(crit, function (err) {
    console.log(arguments);
    res.json({message: 'Successfully removed guesses.'});
  })
});

// GET /guesses

app.get('/guesses', function (req, res) {
  var crit = {}, sort = 'start';

  // Query from ants, which have a .currentGuess ID.
  if ('latest' in req.query) {
    if (req.query.ant) {
      crit.ant = req.query.ant;
    }
    cols.ants.find(crit).toArray(function (id, ants) {
      async.map(ants, function (ant, next) {
        if (!ant.currentGuess) {
          next(null, null);
        } else {
          cols.guesses.findOne({
            _id: ant.currentGuess
          }, next);
        }
      }, function (err, guesses) {
        guesses = guesses.filter(function (seg) {
          return seg;
        });
        res.json(guesses.map(guessJSON));
      });
    })

  // Query from guesses collection.
  } else {
    if (req.query.ant) {
      crit.ant = req.query.ant;
    }
    if (req.query.colony) {
      crit.colony = req.query.colony;
    }
    if (req.query.user) {
      crit.user = req.query.user;
    }
    if (req.query.location) {
      crit.location = req.query.location;
    }
    if (req.query.presentation) {
      crit.presentation = req.query.presentation;
    }
    if (req.query.sort == 'latest') {
      sort = 'end';
    }
    cols.guesses.find(crit).sort(sort).toArray(function (err, guesses) {
      res.json(guesses.map(guessJSON));
    });
  }
});

app.get('/guesses/:id', function (req, res) {
  cols.guesses.findOne({
    _id: req.params.id
  }, function (err, json) {
    res.json(json, json ? 200 : 404);
  });
});

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

var INCORRECT_ANTS = {}, INCORRECT_COLS = {}, ANT_GUESSES = {};
var CONFIDENCE_SUCCESSFUL = 0, CONFIDENCE_TOTAL = 0, CONFIDENCE_DROPPED = 0;

// Variables.
var GUESS_INTERVAL = process.env.GUESS_INTERVAL || 10*1000;
var GUESS_THRESHOLD = process.env.GUESS_THRESHOLD || .5*60*1000;
var CONFIDENCE_CUTOFF = 0.65;
var ADEQUATE_THRESHOLD = 8; // Threshold for confidence by # of binds available.
var ADEQUATE_THRESHOLD_LIMIT = 0; // Threshold for limit of # of binds.
var NEARBY_BONUS = 0.9; // Bonus for 1 away
var FARBY_BONUS = 0.5; // Bonus for 2 away
var FRESHNESS_WEIGHT = 0; // How fresh the bind is
var BEST_WEIGHT = 0.5; // How certain the colony is

function calculateGuesses (currenttime) {
  // Query for the last GUESS_THRESHOLD of binds. 
  var guesses = {};
  var adequateness = {};
  var querytime = currenttime - GUESS_THRESHOLD;

  // Log some sod.
  console.log('\nGuessing location based on binds from', querytime, 'to', currenttime);
  console.log('Incorrectest ants:', JSON.stringify(INCORRECT_ANTS));
  console.log('Incorrectest colonies:', JSON.stringify(INCORRECT_COLS));
  console.log(new Date(querytime));
  console.log('-----------------');

  cols.binds.find({
    time: {
      $gt: querytime,
      $lt: currenttime
    }   
  }).sort({time: 1}).each(function (err, bind) {
    if (bind == null) {
      // Fetched all binds. Process guess.
      consumeBinds();

      // Consume next binds.
      setTimeout(calculateGuesses.bind(null, currenttime + GUESS_INTERVAL), 0);
    } else {
      if (bind.ant in CORRECT && COLONIES.indexOf(bind.colony) >= 0) {
        consumeGuess(guesses, bind, querytime, currenttime);
        (adequateness[bind.ant] || (adequateness[bind.ant] = 0));
        adequateness[bind.ant]++;
      }
    }
  });

  function consumeBinds () {
    // For each ant's bundle of binds, perform our algorithm.
    if (Object.keys(guesses).map(function (antid) {
      var guess = makeGuess(guesses[antid]);
      if (!guess) {
        return;
      }
      // Adjust confidence by sample size
      guess.confidence *= ADEQUATE_THRESHOLD_LIMIT + ((Math.min(ADEQUATE_THRESHOLD, adequateness[antid])/ADEQUATE_THRESHOLD) * (1 - ADEQUATE_THRESHOLD_LIMIT));

      var log = (antid + ' => ' + guess.location + ' (confidence ' + guess.confidence + ')');
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

      // Populate the guess with a user/location.
      cols.colonies.findOne({
        _id: guess.location
      }, function (err, colony) {
        cols.colonies.findOne({
          _id: antid
        }, function (err, ant) {

          // Either ant or colony may be null, don't rely on them existing.
          /*
          cols.guesses.insert({
            colony: guess.location,
            confidence: guess.confidence,
            location: colony && colony.location,
            time: currenttime,
            ant: antid,
            user: ant && ant.user,
          }, function (err, docs) {
            if (err) {
              console.error(err);
            } else if (!err && docs[0]) {

              // Guess created.
              var guess = docs[0];
              console.log('Added guess', guess);
              io.sockets.emit('guess:create', guess);

              // Update ants with current guess.
              cols.ants.update({
                _id: antid
              }, {
                _id: antid,
                guess: guess._id,
                user: ant && ant.user
              }, {
                upsert: true
              }, function (err, docs) {
                console.log('Updated ant.');
              });
            }
          });
          */
        });
      })

      return true;
    }).indexOf(true) < 0) {
      console.log('Start:', new Date(querytime))
      console.log('End:', new Date(currenttime))
      ANTS.forEach(function (antid) {
        console.log(antid, '(' + CORRECT[antid] + ')', '=>', ANT_GUESSES[antid])
      });
      console.log('Success rate:', CONFIDENCE_SUCCESSFUL, '/', CONFIDENCE_TOTAL, '(accepting ' + (CONFIDENCE_TOTAL/(CONFIDENCE_TOTAL+CONFIDENCE_DROPPED)) + '%) => ', (CONFIDENCE_SUCCESSFUL/CONFIDENCE_TOTAL) + '%')
      process.exit(1);
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

  function makeGuess (binds) {
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

/*
 * Ants
 */

function antJSON (ant, next) {
  return {
    id: ant._id,
    user: ant.user
  };
}

app.get('/ants', function (req, res) {
  cols.ants.find().toArray(function (err, results) {
    res.json(results.map(antJSON));
  });
});

app.get('/ants/:id', function (req, res) {
  cols.ants.findOne({
    _id: String(req.params.id)
  }, function (err, ant) {
    if (ant) {
      res.json(antJSON(ant));
    } else {
      res.json({message: 'No such ant.'}, 404);
    }
  });
});

app.put('/ants/:id', function (req, res) {
  if (!req.body.user) {
    return res.json({message: 'Need user parameter.'}, 500);
  }

  var ant = {
    _id: String(req.params.id),
    user: parseInt(req.body.user)
  };
  cols.ants.update({
    _id: String(req.params.id)
  }, ant, {
    upsert: true
  }, function (err, docs) {
    res.json({message: 'Succeeded in assigning ant.'});
  });
});

/*
 * Colonies
 */

function colonyJSON (colony) {
  return {
    colony: colony._id,
    location: colony.location
  };
}

app.get('/colonies', function (req, res) {
  cols.colonies.find().toArray(function (err, results) {
    res.json(results.map(colonyJSON));
  });
});

app.get('/colonies/:id', function (req, res) {
  cols.colonies.findOne({
    _id: String(req.params.id)
  }, function (err, colony) {
    if (ant) {
      res.json(colonyJSON(colony));
    } else {
      res.json({message: 'No such colony.'}, 404);
    }
  });
});

app.put('/colonies/:id', function (req, res) {
  if (!req.body.location) {
    return res.json({message: 'Need location parameter.'}, 500);
  }

  var colony = {
    _id: String(req.params.id),
    location: parseInt(req.body.location)
  };
  cols.colonies.update({
    _id: String(req.params.id)
  }, colony, {
    upsert: true
  }, function (err, docs) {
    res.json({message: 'Succeeded in assigning colony.'});
  });
});

/**
 * Postgres API (users, presentations, locations.)
 */

// Users.

function userJSON (user) {
  return {
    id: user.id,
    name: user.name,
    facebookid: user.facebookid,
    email: user.email
  };
}

app.get('/users', function (req, res) {
  dbpg.query('SELECT * FROM users', [], function (err, result) {
    if (err) {
      console.error(err);
      res.json({message: err}, 500);
    } else {
      res.json(result.rows.map(userJSON));
    }
  });
});

app.get('/users/:id', function (req, res) {
  dbpg.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [
    req.params.id
  ], function (err, users) {
    if (err) {
      console.error(err);
      res.json({message: err}, 500);
    } else if (users.rows.length) {
      res.json(userJSON(users.rows[0]));
    } else {
      res.json({message: 'No such user.'}, 404);
    }
  });
});

// Location.

function locationJSON (loc, next) {
  return {
    "id": loc.id,
    "floor": loc.floor,
    "type": loc.type,
    "index": loc.index
  };
}

app.get('/locations', function (req, res) {
  dbpg.query('SELECT * FROM locations', [], function (err, result) {
    if (err) {
      console.error(err);
      res.json({message: err}, 500);
    } else {
      res.json(result.rows.map(locationJSON));
    }
  });
});

app.get('/locations/:id', function (req, res) {
  dbpg.query('SELECT * FROM locations WHERE id = $1 LIMIT 1', [
    req.params.id
  ], function (err, locations) {
    if (err) {
      console.error(err);
      res.json({message: err}, 500);
    } else if (locations.rows.length) {
      res.json(locationJSON(locations.rows[0]));
    } else {
      res.json({message: 'No such location.'}, 404);
    }
  });
});

// Presentations.

function presentationJSON (presentation) {
  // TODO strip fields
  return presentation;
}

app.get('/presentations', function (req, res) {
  dbpg.query('SELECT * FROM projects', [], function (err, result) {
    if (err) {
      console.error(err);
      res.json({message: err}, 500);
    } else {
      res.json(presentationJSON(result.rows));
    }
  });
});

app.get('/presentations/:id', function (req, res) {
  dbpg.query('SELECT * FROM projects WHERE id = $1 LIMIT 1', [
    req.params.id
  ], function (err, presentations) {
    if (err) {
      console.error(err);
      res.json({message: err}, 500);
    } else if (presentations.rows.length) {
      res.json(presentationJSON(presentations.rows[0]));
    } else {
      res.json({message: 'No such user.'}, 404);
    }
  });
});


/**
 * Sockets
 */

var io = socketio.listen(server);

io.sockets.on('connection', function (socket) {
  console.log('New connection:', socket.id);
});

io.configure(function () { 
  io.set("transports", ["xhr-polling"]); 
  io.set("polling duration", 10); 
});

io.set('log level', 1);


/**
 * Initialize
 */

var dbmongo, cols = {};

function setupMongo (next) {
  mongo.connect(MONGO_URI, {}, function (error, _dbmongo) {
    dbmongo = _dbmongo;
    if (error) {
      console.error('Error connecting to mongo:', error);
      process.exit(1);
    }
    console.log("Connected to Mongo:", MONGO_URI);

    dbmongo.on("error", function (error) {
      console.log("Error connecting to MongoLab");
    });

    cols.binds = new mongo.Collection(dbmongo, 'binds');
    cols.ants = new mongo.Collection(dbmongo, 'ants');
    cols.colonies = new mongo.Collection(dbmongo, 'colonies');
    cols.guesses = new mongo.Collection(dbmongo, 'guesses');

    calculateGuesses(1355517708698);

    next();
  });
}

var dbpg;
function setupPostgres (next) {
  dbpg = new pg.Client(POSTGRES_URI);
  dbpg.connect();
  dbpg.on('error', function (err) {
    console.log('ERROR:', err);
  }).on('end', function () {
    console.log('client ended connection');
  });
  next();
}

function setupServer (next) {
  //server.listen(port, next);
}



// Launch.
setupMongo(function () {
  setupPostgres(function () {
    setupServer(function() {
      console.log("Listening on http://localhost:" + port);
    })
  })
});