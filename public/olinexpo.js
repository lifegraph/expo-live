// Get script host.
var olinexpoHost = (function () {
  var scripts = document.getElementsByTagName('script');
  var path = scripts[scripts.length-1].src;
  var a = document.createElement('a');
  a.href = path;
  return a.host;
})();

// Include Socket.io
(function () {
  var s = document.createElement('script');
  s.src = 'http://' + olinexpoHost + '/socket.io/socket.io.js';
  document.getElementsByTagName('head')[0].appendChild(s);
})();

// Create constructor.
var olinexpo = (function () {
  var noop = function () { };

  function olinexpo (controller) {
    return new API(controller);
  }

  function API (controller) {
    this.state = {};
    this.loaded = false;
    this.controller = controller;
    this.loadResources(function () {
      this.controller.onload.call(this);
      this.connectSocket(function () {
        this.controller.onconnect.call(this);
        this.loaded = true;
      }.bind(this));
    }.bind(this))
  }

  API.prototype.connectSocket = function (next) {
    var socket = io.connect('http://' + olinexpoHost);
    socket.on('connect', next);
    socket.on('bind:create', function (bind) {
      (this.controller.onbindcreate || noop).call(this, bind);

      // Find last segment and update.
      if (!this.state.segments[bind.ant]) {
        this.state.segments[bind.ant] = [{first: null, last: null}];
      }
      var seg = this.state.segments[bind.ant][this.state.segments[bind.ant].length - 1];
      // Split segments.
      if (seg.last) {
        if ((bind.time - seg.last.time) > 180*1000) {
          this.state.segments[bind.ant].push(seg = {first: null, last: null});
        }
      }
      if (!seg.first) {
        seg.first = bind;
      }
      seg.last = bind;
      (this.controller.onsegmentupdate || noop).call(this, seg);
    }.bind(this));
    socket.on('ant:update', function (ant) {
      (this.state.ants = this.state.ants.filter(function (ant2) {
        return ant2.ant != ant.ant;
      })).push(ant);
      (this.controller.onantupdate || noop).call(this, ant);
    }.bind(this));
    socket.on('colony:update', function (colony) {
      (this.state.colonies = this.state.colonies.filter(function (colony2) {
        console.log(colony, colony2);
        return colony2.colony != colony.colony;
      })).push(colony);
      (this.controller.oncolonyupdate || noop).call(this, colony);
    }.bind(this));
  }

  API.prototype.loadResources = function (next) {
    var api = this;
    $.getJSON('http://' + olinexpoHost + '/users/', function (users) {
      $.getJSON('http://' + olinexpoHost + '/locations/', function (locations) {
        $.getJSON('http://' + olinexpoHost + '/segments/?drop=180', function (segments) {
          $.getJSON('http://' + olinexpoHost + '/presentations/', function (presentations) {
            $.getJSON('http://' + olinexpoHost + '/ants/', function (ants) {
              $.getJSON('http://' + olinexpoHost + '/colonies/', function (colonies) {
                api.state.users = users;
                api.state.locations = locations;
                api.state.presentations = presentations;
                api.state.segments = segments;
                api.state.ants = ants;
                api.state.colonies = colonies;

                // Push segments, ants, colonies.
                Object.keys(segments).forEach(function (key) {
                  segments[key].forEach((api.controller.onsegmentupdate || noop).bind(api));
                });
                ants.forEach((api.controller.onantupdate || noop).bind(api));
                colonies.forEach((api.controller.oncolonyupdate || noop).bind(api));

                // Next function.
                next();
              });
            });
          });
        });
      });
    });
  }

  API.prototype.getUserById = function (id) {
    return this.state.users.filter(function (item) {
      return item.id == id;
    })[0];
  }

  API.prototype.getLocationById = function (id) {
    return this.state.locations.filter(function (item) {
      return item.id == id;
    })[0];
  }

  API.prototype.watchPresentation = function (id, callback) {
    //this.on
  };

  return olinexpo;
})();