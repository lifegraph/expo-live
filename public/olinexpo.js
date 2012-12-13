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

  function olinexpo (onload) {
    var api = new API();
    if (onload) {
      api.on('load', onload);
    }
    return api;
  }

  function API () {
    this.socket = io.connect('http://' + olinexpoHost).on('connect', this.emit.bind(this, 'connect'));
    this.loaded = false;
    this.loadResources(function () {
      this.emit('load');
      this.loaded = true;
    }.bind(this))
  }

  API.prototype.loadResources = function (next) {
    var api = this;
    $.getJSON('http://' + olinexpoHost + '/users/', function (users) {
      $.getJSON('http://' + olinexpoHost + '/locations/', function (locations) {
        $.getJSON('http://' + olinexpoHost + '/presentations/', function (presentations) {
          api.users = users;
          api.locations = locations;
          api.presentations = presentations;
          api.segments = segments;

          // Next function.
          next();
        });
      });
    });
  }

  API.prototype.getUserById = function (id) {
    return this.users.filter(function (item) {
      return item.id == id;
    })[0];
  }

  API.prototype.getLocationById = function (id) {
    return this.locations.filter(function (item) {
      return item.id == id;
    })[0];
  }

  API.prototype.getPresentationById = function (id) {
    return this.presentations.filter(function (item) {
      return item.id == id;
    })[0];
  }

  API.prototype._listen = function (history, query, callback) {
    var cache = [];
    $.getJSON('http://' + olinexpoHost + '/segments/?' + (history ? '' : 'latest&'), function (segments) {
      segments.forEach(function (seg) {
        cache.push(seg);
        callback.call(this, seg, cache, false);
      }.bind(this));
      this.socket.on('segment:update', function (seg) {
        var isUpdate = false;
        if (!history) {
          cache = cache.map(function (item) {
            isUpdate = isUpdate || item.ant == seg.ant;
            return item.ant == seg.ant ? seg : item;
          })
        }
        callback.call(this, seg, cache, isUpdate);
      });
    }.bind(this));
    return this;
  };

  API.prototype._listenBinds = function (callback) {
    this.socket = io.connect('http://' + olinexpoHost + '/binds');
    this.socket.on('bind', callback);
    return this;
  };

  API.prototype.listenAll = function (history, callback) {
    return this._listen(history, '', callback);
  };

  API.prototype.listenPresentation = function (history, id, callback) {
    return this._listen(history, 'presentation=' + id, callback);
  };

  API.prototype.listenUser = function (history, id, callback) {
    return this._listen(history, 'user=' + id, callback);
  };

  API.prototype._assignAnt = function (ant, user, next) {
    $.ajax({
      type: 'put',
      url: 'http://' + olinexpoHost + '/ants/' + ant,
      data: {
        user: user
      },
      success: function (data) {
        next && next();
      }
    });
  }

  return olinexpo;
})();