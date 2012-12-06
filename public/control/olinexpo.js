function olinexpo (controller) {
  return new API(controller);
}

function API (controller) {
  this.state = {};
  this.controller = controller;
  this.connectSocket(function () {
    this.controller.onconnect.call(this);
    this.loadResources(this.controller.onload.bind(this));
  }.bind(this))
}

API.prototype.connectSocket = function (next) {
  var socket = io.connect('http://' + window.location.host);
  var noop = function () { };
  socket.on('connect', next);
  socket.on('bind:create', function (bind) {
    this.state.binds.push(bind);
    (this.controller.onbindcreate || noop).call(this);
  }.bind(this));
  socket.on('ant:update', (this.controller.onantupdate || noop).bind(this));
  socket.on('colony:update', (this.controller.oncolonyupdate || noop).bind(this));
}

API.prototype.loadResources = function (next) {
  var api = this;
  $.getJSON('/users/', function (users) {
    $.getJSON('/locations/', function (locations) {
      $.getJSON('/binds/', function (binds) {
        $.getJSON('/presentations/', function (presentations) {
          api.state.users = users;
          api.state.locations = locations;
          api.state.binds = binds;
          api.state.presentations = presentations;
          next();
        });
      });
    });
  });
}

API.prototype.getUserById = function (id) {
  return this.state.users.filter(function (user) {
    return user.id == id;
  })[0];
}