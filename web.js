var fs = require('fs');
var path = require('path');
var http = require('http');

var async = require('async');
var express = require('express');
var mongo = require('mongodb'), ObjectID = mongo.ObjectID;
var socketio = require('socket.io');

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
 * Guesses
 */

function guessJSON (guess) {
  return {
    id: guess._id,
    confidence: guess.confidence,
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

  // Query from ants, which have a .guess ID.
  if ('latest' in req.query) {
    if (req.query.ant) {
      crit.ant = req.query.ant;
    }
    cols.ants.find(crit).toArray(function (id, ants) {
      async.map(ants, function (ant, next) {
        if (!ant.guess) {
          next(null, null);
        } else {
          cols.guesses.findOne({
            _id: ant.guess
          }, next);
        }
      }, function (err, guesses) {
        guesses = guesses.filter(function (guess) {
          return guess;
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

/** 
 * Create guesses
 */

var sampler = require('./sampler');

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
  var ant = {
    _id: String(req.params.id)
  };
  if (req.body.user) {
    ant.user = parseInt(req.body.user)
  }
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
    id: colony._id,
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
  var colony = {
    _id: String(req.params.id)
  };
  if (req.body.location) {
    colony.location = String(req.body.location);
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

    sampler(cols, function (json) {
      cols.guesses.insert(json, function (err, docs) {
        if (err) {
          console.error(err);
        } else if (!err && docs[0]) {

          // Guess created.
          var guess = docs[0];
          console.log('Added guess', guess);
          io.sockets.emit('guess:create', guess);

          // Update ants with current guess.
          cols.ants.update({
            _id: guess.ant
          }, {
            _id: guess.ant,
            guess: guess._id,
            user: guess.user
          }, {
            upsert: true
          }, function (err, docs) {
            console.log('Updated ant with current guess.');
          });
        }
      });
    });

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
  server.listen(port, next);
}

// Launch.
setupMongo(function () {
  setupPostgres(function () {
    setupServer(function() {
      console.log("Listening on http://localhost:" + port);
    })
  })
});