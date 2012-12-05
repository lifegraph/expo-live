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
// and colonys <=> locations exist server-side and augmented to
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
    io.sockets.emit('bind:create', bind);
  });
});

/**
 * Mongo API (binds, ants, colonys)
 */

// Binds

function bindJSON (bind, next) {
  bind.id = bind._id;
  delete bind._id;
  cols.ants.findOne({
    ant: bind.ant
  }, function (err, ant) {
    ant && (bind.user = ant.user);
    cols.colonys.findOne({
      colony: bind.colony
    }, function (err, colony) {
      colony && (bind.location = colony.location);
      next(err, bind);
    });
  });
}

app.get('/binds', function (req, res) {
  cols.binds.find().toArray(function (err, results) {
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
    ant: ant.ant,
    user: ant.user
  });
}

// [private]
app.get('/ants', function (req, res) {
  cols.ants.find().toArray(function (err, results) {
    async.map(results, antJSON, function (err, json) {
      res.json(json);
    });
  });
});

app.get('/ants/:id', function (req, res) {
  cols.ants.findOne({
    ant: req.params.id
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
    ant: req.params.id,
    user: parseInt(req.body.user)
  };
  cols.ants.insert(ant, function (err, docs) {
    res.json({message: 'Succeeded in adding ant.'});

    // Notify streaming clients.
    io.sockets.emit('ant:update', ant);
  });
});

/**
 * Postgres API (users, presentations, locations.)
 */

// Users.

function userJSON (user, next) {
  // TODO strip fields
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
    cols.colonys = new mongo.Collection(dbmongo, 'colonys');

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