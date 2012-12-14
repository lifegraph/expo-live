var fs = require('fs');
var path = require('path');
var http = require('http');

var read = require('read');
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


var dbpg = new pg.Client(POSTGRES_URI);
dbpg.connect();
dbpg.on('error', function (err) {
  console.log('ERROR:', err);
}).on('end', function () {
  console.log('client ended connection');
});

dbpg.query('SELECT * FROM projects ORDER BY room DESC', [], function (err, result) {
  async.forEachSeries(result.rows, function (pres, next) {
    console.log(pres.presentation_title, ' $$ ', pres.contact_name, ' $$ ', pres.room, '=> time:', pres.start_hour, pres.start_minute);
    read({prompt: 'Room: '}, function (err, text) {
      if (!err && text && !text.match(/^\s*$/)) {
        if (text.match(/^\d+/)) {
          var desk = Number(text);
          text = (desk < 21 ? 'AC1D' : 'AC3D') + desk;
        }
        read({prompt: 'Start time (HH:MM) : '}, function (err, start) {
          if (!err) {
            var time = start.split(':').map(Number);
            dbpg.query("UPDATE projects SET room = $1, start_hour = $2, start_minute = $3 WHERE id = $4", [text, time[0] || 0, time[1] || 0, pres.id]);
            next();
          } else next();
        })
      } else next();
    })
  }, function () {
    console.log('done');
  });
});