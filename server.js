var argv = require('minimist')(process.argv.slice(2));
var express = require('express');

if (argv.h || argv._.length!=1) {
  console.log("Usage: " + process.argv[0] + 
	" " + process.argv[1] + 
	" [-p <port>] [-s server:port] db");
  process.exit(0);
}

var port = argv.p || 8080;
var server = argv.s || 'localhost:27017';
var db = argv._[0];
var dburl = 'mongodb://'+server+'/'+db;

console.log("mongodb: " + dburl);

// main app
var app = express();

// we'll be behind a proxy
app.enable('trust proxy');

app.use(express.json());
app.use(express.urlencoded());

app.get('/*', function(req, res){
  var body = 'MongoDB data uploader uptime: ' + process.uptime() + "s\n" +
	"Database: " + dburl + "\n" +
	"Contact: Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr>";
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
});

app.post('/*',function(req,res) {
    var path = req.path.split('/');
    var collection = path[path.length-1];

    var form = new multiparty.Form();

    form.on('part', function(part) {
	var json = '';
	part.on('data', function(chunk) {
	    json += chunk;
	});
	part.on('end', function() {
	    console.log(json);
	});
    });

    form.parse(req);
    form.parse(req);

    res.send(200);
});

// generic error handler
app.use(function(err, req, res, next){
  console.error(err.stack);
  res.status(500);
  res.render('error', { error: err });
});

console.log("Listening on *:"+port);
app.listen(port);
