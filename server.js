var argv = require('minimist')(process.argv.slice(2));
var express = require('express');
var app = express();

if (argv.h) {
  console.log("Usage: " + process.argv[0] + 
	" " + process.argv[1] + 
	" [-p <port>] [database_url]");
  process.exit(0);
}

var port = argv.p || 8080;
var dburl = argv._[0] || 'mongodb://localhost:27017/ucntest';
console.log("mongodb: " + dburl);

// we'll be behind a proxy
app.enable('trust proxy');

app.get('/*', function(req, res){
  var body = 'MongoDB data uploader uptime: ' + process.uptime() + "s\n" +
	"Database: " + dburl + "\n" +
	"Contact: Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr>";
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
});

// generic error handler
app.use(function(err, req, res, next){
  console.error(err.stack);
  res.status(500);
  res.render('error', { error: err });
});

console.log("Listening on *:"+port);
app.listen(port);
