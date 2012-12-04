var fs = require('fs');
var path = require('path');
var http = require('http');

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

app.post('/hardware', function (req, res) {
  if (!req.body.ant || !req.body.queen) {
    return res.json({message: 'Need ant and queen parameter.'}, 500);
  }

  var bind = {
    ant: req.body.ant,
    queen: req.body.queen,
    time: Date.now()
  };
  cols.binds.insert(bind, function (err, docs) {
    res.json({message: 'Succeeded in adding bind.'});
    io.sockets.emit('bind:create', bind);
  });
});

/**
 * Mongo API (binds, ants, queens)
 */

app.get('/binds', function (req, res) {
  cols.binds.find().toArray(function (err, results) {
    res.json(results);
  });
});

app.get('/binds/:id', function (req, res) {
  cols.binds.findOne({
    _id: new ObjectID(req.params.id)
  }, function (err, bind) {
    cols.ants.findOne({
      ant: bind.ant
    }, function (err, ant) {
      ant && (bind.user = ant.user);
      cols.queens.findOne({
        queen: bind.queen
      }, function (err, queen) {
        queen && (bind.location = queen.location);
        res.json(bind);
      });
    });
  });
});

// Ants

app.get('/ants', function (req, res) {
  cols.ants.find().toArray(function (err, results) {
    res.json(results);
  });
});

app.get('/ants/:id', function (req, res) {
  cols.ants.findOne({
    ant: req.params.id
  }, function (err, results) {
    res.json(results);
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
    io.sockets.emit('ant:update', ant);
  });
});

/**
 * Postgres API (users, locations)
 */

app.get('/users', function (req, res) {
  dbpg.query('SELECT * FROM users', [], function (err, result) {
    if (err) {
      console.error(err);
    } else {
      res.json(result.rows.map(function (row) {
        return row;
        // TODO!
        return {
          id: row.id,
          name: row.name
        }
      }));
    }
  });
});

app.get('/users/:id', function (req, res) {
  dbpg.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [
    req.params.id
  ], function (err, users) {
    if (err) {
      console.error(users);
    } else {
      res.json(users.rows[0]);
    }
  });
});


app.get('/presentations', function (req, res) {
  dbpg.query('SELECT * FROM projects', [], function (err, result) {
    if (err) {
      console.error(err);
    } else {
      res.json(result.rows.map(function (row) {
        return row;
        // TODO!
        return {
          id: row.id,
          name: row.name
        }
      }));
    }
  });
});

app.get('/presentations/:id', function (req, res) {
  dbpg.query('SELECT * FROM projects WHERE id = $1 LIMIT 1', [
    req.params.id
  ], function (err, presentations) {
    if (err) {
      console.error(err, presentations);
    } else {
      res.json(presentations.rows[0]);
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
    console.log("Connected to Mongo:", MONGO_URI);

    dbmongo.on("error", function (error) {
      console.log("Error connecting to MongoLab");
    });

    cols.binds = new mongo.Collection(dbmongo, 'binds');
    cols.ants = new mongo.Collection(dbmongo, 'ants');
    cols.queens = new mongo.Collection(dbmongo, 'queens');

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