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

var SEGMENT_THRESHOLD = 1*60*1000;


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

app.post('/hardware', postBind); // deprecated
app.post('/binds', postBind);

function postBind (req, res) {
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

      // Extend most recent time segment, or create new one.
      // TODO! user, location instead?
      cols.segments.find({
        ant: bind.ant,
        colony: bind.colony
      }).sort({end: -1}).limit(1).nextObject(function (err, lastsegment) {
        if (lastsegment && ((bind.time - lastsegment.end) < SEGMENT_THRESHOLD)) {
          lastsegment.end = lastsegment.last.time = bind.time;
          cols.segments.update({
            _id: lastsegment._id
          }, lastsegment, insertBind)
        } else {
          // create new segment
          cols.segments.insert({
            ant: bind.ant,
            colony: bind.colony,
            start: bind.time,
            end: bind.time,
            first: bind,
            last: bind
          }, updateAnt);
        }

        function updateAnt (err, segment) {
          cols.ants.update({
            _id: bind.ant
          }, {
            $set: {'currentSegment': segment}
          }, insertBind);
        }

        function insertBind () {
          // Insert bind.
          cols.binds.insert(bind, function (err) {
            res.json({message: 'Succeeded in adding bind.'});
            io.sockets.emit('bind:create', bindJSON(bind));
          });
        }
      });
    });
  });
}

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

// GET /segments

app.get('/segments', function (req, res) {
  if ('latest' in req.query) {
    cols.segments.distinct('ant', 'end', function (id, antids) {
      res.json(arguments);
    })
  } else {
    var crit = {}, sort = 'start';
    if (req.query.ant) {
      crit.ant = req.query.ant;
    }
    if (req.query.colony) {
      crit.colony = req.query.colony;
    }
    if (req.query.sort == 'latest') {
      sort = 'end';
    }
    cols.segments.find(crit).sort(sort).toArray(function (err, json) {
      var segments = {};
      json.forEach(function (segment) {
        (segments[segment.ant] || (segments[segment.ant] = [])).push(segment);
      })
      res.json(segments);
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

/*
 * Ants
 */

function antJSON (ant, next) {
  return {
    ant: ant._id,
    user: ant.user,
    currentSegment: ant.currentSegment
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

    // Notify streaming clients.
    io.sockets.emit('ant:update', antJSON(ant));
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

    // Notify streaming clients.
    io.sockets.emit('colony:update', colonyJSON(colony));
  });
});

// Reset api

app.get('/destroyallbinddataiamserious', function (req, res) {
  cols.colonies.remove();
  cols.ants.remove();
  cols.binds.remove();
  cols.segments.remove();
  res.json('You did it. Murderer.');
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