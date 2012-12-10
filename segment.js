var fs = require('fs');

var SEGMENT_THRESHOLD = 3*60*1000;

var j = fs.readFileSync('binds.json');

var segments = {};

String(j).replace(/^\s+|\s+$/g, '').split(/\n+/g).map(function (l) {
  var json = JSON.parse(l);
  if (!segments[json.ant]) {
    segments[json.ant] = [{first: null, last: null, ant: json.ant, colony: json.colony}];
  }
  var seg = segments[json.ant][segments[json.ant].length - 1];
  if (seg.last && json.time - seg.last > SEGMENT_THRESHOLD) {
    segments[json.ant].push({first: null, last: null, ant: json.ant, colony: json.colony});
  }
  if (!seg.first) {
    seg.first = json.time;
    seg.start = String(new Date(seg.first));
  }
  seg.last = json.time;
  seg.end = String(new Date(seg.last));
  seg.duration_millis = (seg.last - seg.first);
  seg.duration_seconds = seg.duration_millis/1000;
  seg.duration_minutes = seg.duration_seconds/60;
  seg.duration_hours = seg.duration_minutes/60;
});

console.log(segments);