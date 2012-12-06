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
app.use(express.logger());
app.use(express.bodyParser());
app.use(express.static(__dirname + '/public'));

var server = http.createServer(app);


/**
 * Hardware API
 */

// body: ant=<ant id>&colony=<colony id>
// This creates a new bind. Associations between ants <=> users
// and colonies <=> locations exist server-side and augmented to
// this information.

app.post('/hardware', function (req, res) {
  if (!req.body.ant || !req.body.colony) {
    return res.json({message: 'Need ant and colony parameter.'}, 500);
  }

  var bind = {
    ant: req.body.ant,
    colony: req.body.colony,
    time: Date.now()
  };
  cols.binds.insert(bind, function (err, docs) {
    res.json({message: 'Succeeded in adding bind.'});
    bindJSON(bind, function (err, json) {
      io.sockets.emit('bind:create', json);
    });
  });
});

/**
 * Mongo API (binds, ants, colonies)
 */

// Binds

function bindJSON (bind, next) {
  bind.id = bind._id;
  delete bind._id;
  cols.ants.findOne({
    _id: bind.ant
  }, function (err, ant) {
    ant && (bind.user = ant.user);
    cols.colonies.findOne({
      _id: bind.colony
    }, function (err, colony) {
      colony && (bind.location = colony.location);
      next(err, bind);
    });
  });
}

app.get('/binds', function (req, res) {
  cols.binds.find()toArray(function (err, results) {
    results = results.sort(function (a, b) {
      return a.time < b.time ? 1 : -1; 
    });
    async.map(results, bindJSON, function (err, json) {
      res.json(json);
    });
  });
});

app.get('/binds/:id', function (req, res) {
  cols.binds.findOne({
    _id: new ObjectID(req.params.id)
  }, function (err, bind) {
    if (bind) {
      bindJSON(bind, function (err, json) {
        res.json(json);
      });
    } else {
      res.json({message: 'No such bind.'}, 404);
    }
  });
});

// Ants

function antJSON (ant, next) {
  next(null, {
    ant: ant._id,
    user: ant.user
  });
}

app.get('/ants', function (req, res) {
  cols.ants.find().toArray(function (err, results) {
    async.map(results, antJSON, function (err, json) {
      res.json(json);
    });
  });
});

app.get('/ants/:id', function (req, res) {
  cols.ants.findOne({
    _id: String(req.params.id)
  }, function (err, ant) {
    if (ant) {
      antJSON(ant, function (err, json) {
        res.json(json);
      });
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
    antJSON(ant, function (err, json) {
      io.sockets.emit('ant:update', json);
    });
  });
});

// Colonies

function colonyJSON (colony, next) {
  next(null, {
    colony: colony._id,
    location: colony.location
  });
}

app.get('/colonies', function (req, res) {
  cols.colonies.find().toArray(function (err, results) {
    async.map(results, colonyJSON, function (err, json) {
      res.json(json);
    });
  });
});

app.get('/colonies/:id', function (req, res) {
  cols.colonies.findOne({
    _id: String(req.params.id)
  }, function (err, colony) {
    if (ant) {
      colonyJSON(colony, function (err, json) {
        res.json(json);
      });
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
    colonyJSON(colony, function (err, json) {
      io.sockets.emit('colony:update', json);
    })
  });
});

/**
 * Postgres API (users, presentations, locations.)
 */

// Users.

function userJSON (user, next) {
  next(null, {
    id: user.id,
    name: user.name,
    facebookid: user.facebookid,
    email: user.email
  });
}

app.get('/users', function (req, res) {
  dbpg.query('SELECT * FROM users', [], function (err, result) {
    if (err) {
      console.error(err);
      res.json({message: err}, 500);
    } else {
      async.map(result.rows, userJSON, function (err, json) {
        res.json(json);
      });
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
      userJSON(users.rows[0], function (err, json) {
        res.json(json);
      })
    } else {
      res.json({message: 'No such user.'}, 404);
    }
  });
});

// Location.

function locationJSON (loc, next) {
  next(null, {
    "id": loc.id,
    "floor": loc.floor,
    "type": loc.type,
    "index": loc.index
  });
}

app.get('/locations', function (req, res) {
  dbpg.query('SELECT * FROM locations', [], function (err, result) {
    if (err) {
      console.error(err);
      res.json({message: err}, 500);
    } else {
      async.map(result.rows, locationJSON, function (err, json) {
        res.json(json);
      });
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
      locationJSON(locations.rows[0], function (err, json) {
        res.json(json);
      })
    } else {
      res.json({message: 'No such location.'}, 404);
    }
  });
});

// Presentations.

function presentationJSON (presentation, next) {
  // TODO strip fields
  next(null, presentation);
}

app.get('/presentations', function (req, res) {
  dbpg.query('SELECT * FROM projects', [], function (err, result) {
    if (err) {
      console.error(err);
      res.json({message: err}, 500);
    } else {
      async.map(result.rows, presentationJSON, function (err, json) {
        res.json(json);
      });
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
      presentationJSON(presentations.rows[0], function (err, json) {
        res.json(json);
      })
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