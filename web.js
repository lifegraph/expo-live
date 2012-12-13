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

var SEGMENT_THRESHOLD = process.env.SEGMENT_THRESHOLD || 12*1000;


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

// DELETE /binds/? ant=<ant id> || colony=<colony id>

app.del('/binds', function (req, res) {
  var ant = req.query.ant, colony = req.query.colony;
  if (!ant && !colony && !req.query.force) {
    res.json({'message': 'Pleace specify force=1 to delete all binds.'}, 400);
    return;
  }
  var crit = {};
  if (ant) {
    crit.ant = ant;
  }
  if (colony) {
    crit.colony = colony;
  }
  cols.binds.remove(crit, function (err) {
    console.log(arguments);
    res.json({message: 'Successfully removed binds.'});
  })
});

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
 * Segments
 */

function segmentJSON (seg) {
  return {
    id: seg._id,
    ant: seg.ant,
    colony: seg.colony,
    time: seg.time,
    user: seg.user,
    location: seg.location
  };
}

// GET /segments

app.get('/segments', function (req, res) {
  var crit = {}, sort = 'start';

  // Query from ants, which have a .currentSegment DBRef.
  if ('latest' in req.query) {
    if (req.query.ant) {
      crit.ant = req.query.ant;
    }
    cols.ants.find(crit).toArray(function (id, ants) {
      async.map(ants, function (ant, next) {
        if (!ant.currentSegment) {
          next(null, null);
        } else {
          cols.segments.findOne({
            _id: ant.currentSegment
          }, next);
        }
      }, function (err, segments) {
        segments = segments.filter(function (seg) {
          return seg;
        });
        res.json(segments.map(segmentJSON));
      });
    })

  // Query from segments collection.
  } else {
    if (req.query.ant) {
      crit.ant = req.query.ant;
    }
    if (req.query.colony) {
      crit.colony = req.query.colony;
    }
    if (req.query.sort == 'latest') {
      sort = 'end';
    }
    cols.segments.find(crit).sort(sort).toArray(function (err, segments) {
      res.json(segments.map(segmentJSON));
    });
  }
});

app.get('/segments/:id', function (req, res) {
  cols.segments.findOne({
    _id: req.params.id
  }, function (err, json) {
    res.json(json, json ? 200 : 404);
  });
});

var lastPollTime = null;

function pollSegments () {
  if (lastPollTime === null) {
    lastPollTime = Date.now();
  }

  var segments = {};

  console.log('Consuming binds from', lastPollTime, 'to', Date.now());

  var curPollTime = Date.now();
  cols.binds.find({
    time: {$gt: lastPollTime}
  }).sort({time: 1}).each(function (err, bind) {
    if (bind == null) {
      console.log('Fetched binds.');
      lastPollTime = curPollTime;
      setTimeout(pollSegments, SEGMENT_THRESHOLD);

      Object.keys(segments).forEach(function (antid) {
        var bestlocid, bestloc = -1;
        Object.keys(segments[antid]).forEach(function (locid) {
          if (bestloc < segments[antid][locid]) {
            bestlocid = locid;
            bestloc = segments[antid][locid];
          }
        })
        console.log(segments[antid]);
        if (bestloc > 0) {
          cols.colonies.findOne({
            _id: bestlocid
          }, function (err, colony) {
            cols.colonies.findOne({
              _id: antid
            }, function (err, ant) {
              // Note, ant or colony may be false by now
              cols.segments.insert({
                time: curPollTime,
                ant: antid,
                user: ant && ant.user,
                colony: bestlocid,
                location: colony && colony.location
              }, function (err, docs) {
                if (err) {
                  console.error(err);
                }
                if (!err && docs[0]) {
                  console.log('Added segment', docs[0]);
                  io.sockets.emit('segment:update', docs[0]);

                  cols.ants.update({
                    _id: antid
                  }, {
                    _id: antid,
                    currentSegment: docs[0]._id
                  }, {
                    upsert: true
                  }, function (err, docs) {
                    console.log('Updated', docs);
                  });
                }
              });
            });
          });
        }
      });
    } else {
      var bundle = (segments[bind.ant] || (segments[bind.ant] = {}));
      (bundle[bind.colony] || (bundle[bind.colony] = 0));
      bundle[bind.colony]++;
    }
  });
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
    cols.segments = new mongo.Collection(dbmongo, 'segments');

    pollSegments();

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