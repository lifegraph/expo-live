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
    var socket = io.connect('http://' + window.location.host);
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
        if ((bind.time - seg.last.time) > 30*1000) {
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
    $.getJSON('/users/', function (users) {
      $.getJSON('/locations/', function (locations) {
        $.getJSON('/segments/?drop=30', function (segments) {
          $.getJSON('/presentations/', function (presentations) {
            $.getJSON('/ants/', function (ants) {
              $.getJSON('/colonies/', function (colonies) {
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

  return olinexpo;
})();