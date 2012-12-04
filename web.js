var fs = require('fs');
var path = require('path');

var express = require('express');

var app = express();
app.use(express.logger());
app.use(express.static(__dirname + '/public'));

app.get('/', function (req, res) {
  res.send('Hello World!');
});

app.get('/hardware', function (req, res) {
  res.send(JSON.stringify(req.params));
});

var port = process.env.PORT || 5000;
app.listen(port, function() {
  console.log("Listening on " + port);
});
