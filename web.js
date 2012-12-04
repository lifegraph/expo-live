var fs = require('fs');
var path = require('path');

var express = require('express');
var mongo = require('mongodb'), ObjectID = mongo.ObjectID;

/**
 * Config
 */

var MONGO_URI = process.env.MONGOLAB_URI || "mongodb://localhost/olinexpoapi";
var port = process.env.PORT || 5000;


/**
 * App
 */

var app = express();
app.use(express.logger());
app.use(express.bodyParser());
app.use(express.static(__dirname + '/public'));

app.post('/hardware', function (req, res) {
  if (!req.body.ant || !req.body.queen) {
    return res.json({message: 'Need ant and queen parameter.'}, 500);
  }

  cols.binds.insert({
    ant: req.body.ant,
    queen: req.body.queen
  }, function (err, docs) {
    res.json({message: 'Succeeded in adding bind.'});
  });
});

// Binds.
app.get('/binds', function (req, res) {
  cols.binds.find().toArray(function (err, results) {
    res.json(results);
  });
});

app.get('/binds/:id', function (req, res) {
  cols.binds.findOne({
    _id: new ObjectID(req.params.id)
  }, function (err, results) {
    res.json(results);
  });
});

// Users.
app.get('/users', function (req, res) {
  cols.users.find().toArray(function (err, results) {
    res.json(results);
  });
});

app.get('/users/:id', function (req, res) {
  cols.users.findOne({
    _id: new ObjectID(req.params.id)
  }, function (err, results) {
    res.json(results);
  });
});

// Locations.
app.get('/locations', function (req, res) {
  cols.locations.find().toArray(function (err, results) {
    res.json(results);
  });
});

app.get('/locations/:id', function (req, res) {
  cols.locations.findOne({
    _id: new ObjectID(req.params.id)
  }, function (err, results) {
    res.json(results);
  });
});


/**
 * Initialize
 */

var db, cols = {};
mongo.connect(MONGO_URI, {}, function (error, _db) {
  db = _db;
  console.log("Connected to Mongo:", MONGO_URI);

  db.on("error", function (error) {
    console.log("Error connecting to MongoLab");
  });

  db.collection('locations', function (err, locations) {
    cols.locations = locations;
    db.collection('users', function (err, users) {
      cols.users = users;
      db.collection('binds', function (err, binds) {
        cols.binds = binds;

        // Launch server.
        app.listen(port, function() {
          console.log("Listening on http://localhost:" + port);
        });
      });
    });
  })
});