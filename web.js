var fs = require('fs');
var path = require('path');
var http = require('http');

var async = require('async');
var express = require('express');
var mongo = require('mongodb'), ObjectID = mongo.ObjectID;
var socketio = require('socket.io');
var OpenGraph = require('facebook-open-graph');

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
app.set('views', __dirname + '/views');
app.use(express.static(__dirname + '/public'));

app.all('*', function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'HEAD, GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, Origin, Accept');
    res.header('Access-Control-Allow-Credentials', 'true');

    if( req.method.toLowerCase() === "options" ) {
        res.send(200);
    }
    else {
        next();
    }
});

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
    location: bind.location,
    queen: bind.queen,
    ping: bind.ping
  };
}

/*
 * Open Graph
 */

// Opengraph APIs.
var openGraph = new OpenGraph('olinexpo');

// makes an open graph request for when the user visits the presentation
function makeVisitedOpenGraphRequest(userId, presentationId ) {
  console.log("Open Graph Request for prezo:", presentationId );
  var presentationUrl = 'http://api.olinexpo.com/presentation/' + presentationId;
  var access_token = getAccessTokenFromUserId(userId, function (access_token) {
    console.log("HEY", access_token);
    console.log(presentationUrl);
    openGraph.publish('me', access_token, 'visit', 'presentation', presentationUrl, {'access_token': access_token}, function(err,response){
      console.log(response, err);
    });
  });
}

// Returns the access token if there is one for the given user id.
// hides errors and uses null if error or no result
// calls next(access_token)
function getAccessTokenFromUserId(userId, next) {
  dbpg.query('SELECT * FROM authentications WHERE user_id = $1 LIMIT 1', 
    [userId], function (err, result) {
    if (err) {
      console.error(err);
      next(null);
    } else {
      if (result.rows.length) {
        next(result.rows[0].token);
      } else {
        next(null);
      }
    }
  });
}

// GET /binds

/*
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
*/

// POST /hardware? ant=<ant id> && colony=<colony id>
// This creates a new bind. Associations between ants <=> users
// and colonies <=> locations exist server-side and augmented to
// this information.

app.post('/binds', function (req, res) {
  var timeChunk = Math.floor(Date.now() / (25 * 1000)); // grab the 5-minute chunk of time since the ping_id's will reset eventually
  if (!req.body.ant || !req.body.colony) {
    return res.json({message: 'Need ant and colony parameter.'}, 500);
  }

  var pingstr = 'ping:' + String(req.body.ping) + '-time:' + String(timeChunk) + '-ant:' + req.body.ant + '-colony:' + req.body.colony;

  var bind = {
    ant: req.body.ant,
    colony: req.body.colony,
    ping: pingstr,
    queen: req.body.queen,
    time: Date.now()
  };

  colony.log(pingstr);

  cols.binds.findOne({
    ping: bind.ping
  }, function(err, repeatBind) {
    if (repeatBind) { // if it is double posted data (2+ queens reporting)
      console.log("Got a repeat bind", bind.ping);
      return res.json({message: 'Repeat Bind. Already accounted for.', ping: bind.ping }, 409);
    } else { // haven't seen this bind before.
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
            // console.log('New bind:', bind);
            res.json({message: 'Succeeded in adding bind.'});
          });
        });
      });
    }
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
    confident: guess.confident,
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
  var filterCriteria = {}, sort = 'start';

  // Query from ants, which have a .guess ID.
  if ('latest' in req.query) {
    if (req.query.ant) {
      filterCriteria.ant = req.query.ant;
    }
    cols.ants.find(filterCriteria).toArray(function (id, ants) {
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
      filterCriteria.ant = req.query.ant;
    }
    if (req.query.colony) {
      filterCriteria.colony = req.query.colony;
    }
    if (req.query.user) {
      filterCriteria.user = req.query.user;
    }
    if (req.query.location) {
      filterCriteria.location = req.query.location;
    }
    if (req.query.presentation) {
      filterCriteria.presentation = req.query.presentation;
    }
    if (req.query.sort == 'latest') {
      sort = 'end';
    }
    cols.guesses.find(filterCriteria).sort(sort).toArray(function (err, guesses) {
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
 * New History
 */

app.get('/newhistory', function (req, res) {
  var filterCriteria = {}, sort = 'start';

  if (req.query.ant) {
    filterCriteria.ant = req.query.ant;
  }
  if (req.query.colony) {
    filterCriteria.colony = req.query.colony;
  }
  if (req.query.user) {
    filterCriteria.user = req.query.user;
  }
  if (req.query.location) {
    filterCriteria.location = req.query.location;
  }
  if (req.query.sort == 'latest') {
    sort = 'end';
  }
  cols.history.find(filterCriteria).sort(sort).toArray(function (err, guesses) {
    res.json(guesses.map(guessJSON));
  });
});

/** 
 * Create guesses
 */

var sampler = require('./sampler');

/**
 * History endpoint
 */

// minimum amount of time to be considered at a location
var MIN_MS_GUESS = 20*(1000);

// app.get('/test', function(req, res) {
//   console.log("asdfsdf");
// });

app.get('/history/:uid', function (req, res) {
  console.log("history/uid");

  var uid = req.params.uid;
  var history = [];
  var last_guess;
  var oldest_same_location_guess;

  cols.guesses.find({
    user: uid
  }).sort({time: 1}).each(function (err, guess) {
    
    console.log(guess);
    if (!guess) {
      return res.json(history);
    }

    var elapsed_time = 0;
    if (last_guess) {
      // Get the elapsed time between the two guesses.
      var elapsed_time = last_guess.time - oldest_same_location_guess.time;

      // new history call when locations have changed
      // be at location for at least MIN_MS_GUESS amount of time
      if (last_guess.location != guess.location &&
        elapsed_time > MIN_MS_GUESS ) {

        var starting_time = oldest_same_location_guess.time;
        var new_history_point = {
          started: starting_time, length: elapsed_time, 
          location: last_guess.location, ant: last_guess.ant, user: last_guess.user,
          colony: last_guess.colony
        };
        var latest_history = history.pop();
        if (latest_history) {
          if (latest_history.location == new_history_point.location 
              && latest_history.ant == new_history_point.ant 
              && latest_history.user == new_history_point.user) {
            new_history_point.length = new_history_point.started + new_history_point.length - latest_history.started;
            new_history_point.started = latest_history.started;
          } else {
            history.push(latest_history);
          }
        }
        history.push(new_history_point);
      }

      // if the location stayed the same, don't update the oldest
      if (oldest_same_location_guess.location != guess.location) {
        oldest_same_location_guess = guess;
      }

    } else {
      oldest_same_location_guess = guess;
    }
    // keep track of the last guess
    last_guess =  guess;
  });
});

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
    $set: {}
  };
  if ('user' in req.body) {
    ant.$set.user = req.body.user || null;
  }
  cols.ants.update({
    _id: String(req.params.id)
  }, ant, {
    upsert: true
  }, function (err, docs) {
    res.json({message: 'Succeeded in assigning ant.', ant: ant});
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
    $set: {}
  };
  if ('location' in req.body) {
    colony.$set.location = String(req.body.location);
  };
  cols.colonies.update({
    _id: String(req.params.id)
  }, colony, {
    upsert: true
  }, function (err, docs) {
    res.json({message: 'Succeeded in assigning colony.', colony: colony});
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
    created_at: user.created_at,
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
    "id": loc.room
  };
}

app.get('/locations', function (req, res) {
  dbpg.query('SELECT DISTINCT room FROM projects', [], function (err, result) {
    if (err) {
      console.error(err);
      res.json({message: err}, 500);
    } else {
      console.log(result);
      res.json(result.rows.map(locationJSON).filter(function (loc) {
        return loc.id;
      }));
    }
  });
});

/*
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
*/

/*
 * Presentations
 */

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

// This looks very similar to /presentations/:id but it is NOT the same
// this is the open graph endpoint for facebook integration
app.get('/presentation/:id', function(req, res) {
  dbpg.query('SELECT * FROM projects WHERE id = $1 LIMIT 1', [
    req.params.id
  ], function (err, presentations) {
    if (err) {
      console.error(err);
      res.json({message: err}, 500);
    } else if (presentations.rows.length) {
      // res.json(presentationJSON(presentations.rows[0]));
      var presentation = presentationJSON(presentations.rows[0]);
      var presentation_image = presentation.image;
      if (presentation_image) {
        presentation_image = 'https://s3.amazonaws.com/OlinExpo/uploads/project/image/' + presentation.id + '/' + presentation.image;
      } else {
        presentation_image = presentation.image1;
        if (presentation_image) {
          presentation_image = 'https://s3.amazonaws.com/OlinExpo/uploads/project/image1/' + presentation.id + '/' + presentation.image1;
        } else {
          presentation_image = 'http://olinexpo.com/assets/expolive-logo.png';
        }
      }
      res.render('presentation.jade', {presentation_name: presentation.presentation_title, 
                                        presentation_image: presentation_image,
                                        presentation_description: presentation.project_description,
                                        presentation_id: req.params.id});
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
    cols.history = new mongo.Collection(dbmongo, 'history');

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
            $set: {
              guess: guess._id
            }
          }, {
            upsert: true
          }, function (err, docs) {
            console.log('Updated ant with current guess.');
          });
        }
      });
    }, function (userid, locid) {
      console.log('Making open graph posting...');
      var pres = getPresentationByLocation(new Date(), locid);
      if (pres) {
        console.log('OPENGRAPH: OPEN GRAPH POST FOR', userid, 'at', locid, 'pres', pres.id);
        try {
          makeVisitedOpenGraphRequest(userid, presid);
        } catch (e) {
          console.error('OPENGRAPH:', e);
        }
      }
    });

    next();
  });
}

var PRESCACHE = [];

function getPresentationByLocation (date, locid) {
  var hours = date.getHours() - 5;
  console.log('LOOKING FOR PRESENTATION', 'hour', hours, 'room', locid);
  return PRESCACHE.filter(function (row) {
    return row.start_hour == hours && row.room == locid;
  })[0];
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

  dbpg.query('SELECT * FROM projects', [], function (err, result) {
    if (err) {
      console.error(err);
    } else {
      PRESCACHE = result.rows;
    }
  });

  next();
}

function setupServer (next) {
  server.listen(port, next);
}

// Launch.
setupMongo(function () {
  /**
  * Insert the ants
  */
  var ant_base = require('./ant_base');
  ant_base(cols);

  setupPostgres(function () {
    setupServer(function() {
      console.log("Listening on http://localhost:" + port);
    })
  })
});