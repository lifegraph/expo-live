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

// EventEmitter

function EventEmitter () { }

EventEmitter.prototype.listeners = function (type) {
  return this.hasOwnProperty.call(this._events || (this._events = {}), type) ? this._events[type] : this._events[type] = [];
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener = function (type, f) {
  if (this._maxListeners !== 0 && this.listeners(type).push(f) > (this._maxListeners || 10)) {
    console && console.warn('Possible EventEmitter memory leak detected. ' + this._events[type].length + ' listeners added. Use emitter.setMaxListeners() to increase limit.');
  }
  this.emit("newListener", type, f);
  return this;
};

EventEmitter.prototype.removeListener = function (type, f) {
  var i;
  (i = this.listeners(type).indexOf(f)) != -1 && this.listeners(type).splice(i, 1);
  return this;
};

EventEmitter.prototype.removeAllListeners = function (type) {
  for (var k in this._events) {
    (!type || type == k) && this._events[k].splice(0, this._events[k].length);
  }
  return this;
};

EventEmitter.prototype.emit = function (type) {
  var args = Array.prototype.slice.call(arguments, 1);
  for (var i = 0, fns = this.listeners(type).slice(); i < fns.length; i++) {
    fns[i].apply(this, args);
  }
  return fns.length;
};

EventEmitter.prototype.setMaxListeners = function (maxListeners) {
  this._maxListeners = maxListeners;
};

// Inherits

function inherits (ctor, superCtor) {
  ctor.super_ = superCtor;
  ctor.prototype = Object.create(superCtor.prototype, {
    constructor: {
      value: ctor,
      enumerable: false
    }
  });
};

// Olin Expo

var olinexpo = (function () {

  inherits(API, EventEmitter);

  function olinexpo () {
    return new API();
  }

  function API () {
    this.state = {};
    this.loaded = false;
    this.loadResources(function () {
      this.emit('load');
      this.connectSocket(function () {
        this.emit('connect');
        this.loaded = true;
      }.bind(this));
    }.bind(this))
  }

  API.prototype.connectSocket = function (next) {
    var socket = io.connect('http://' + olinexpoHost);
    socket.on('connect', next);
    socket.on('bind:create', function (bind) {
      this.emit('bind:create', bind);

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
      this.emit('segment:update', seg);
    }.bind(this));
    socket.on('ant:update', function (ant) {
      (this.state.ants = this.state.ants.filter(function (ant2) {
        return ant2.ant != ant.ant;
      })).push(ant);
      this.emit('ant:update', ant);
    }.bind(this));
    socket.on('colony:update', function (colony) {
      (this.state.colonies = this.state.colonies.filter(function (colony2) {
        console.log(colony, colony2);
        return colony2.colony != colony.colony;
      })).push(colony);
      this.emit('colony:update', colony);
    }.bind(this));
  }

  API.prototype.loadResources = function (next) {
    var api = this;
    $.getJSON('http://' + olinexpoHost + '/users/', function (users) {
      $.getJSON('http://' + olinexpoHost + '/locations/', function (locations) {
        $.getJSON('http://' + olinexpoHost + '/presentations/', function (presentations) {
          $.getJSON('http://' + olinexpoHost + '/segments/?latest', function (segments) {
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
                  segments[key].forEach(api.emit.bind(api, 'segment:create'));
                });
                ants.forEach(api.emit.bind(api, 'ant:update'));
                colonies.forEach(api.emit.bind(api, 'colony:update'));

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