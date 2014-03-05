var _ = require('underscore');
var argv = require('minimist')(process.argv.slice(2));
var express = require('express');
var multiparty = require('multiparty');
// mongo stuff
var Db = require('mongodb').Db;
var Server = require('mongodb').Server;


if (argv.h || argv._.length!=1) {
  console.log("Usage: " + process.argv[0] + 
	" " + process.argv[1] + 
	" [-p <port>] [-s server] [-q server_port] db");
  process.exit(0);
}

var port = argv.p || 8080;
var server = argv.s || 'localhost';
var serverport = argv.q || 27017;
var dbname = argv._[0];
var dburl = 'mongodb://'+server+':'+serverport+'/'+dbname;

// connect to the db
console.log("mongodb: " + dburl);
var db = new Db(dbname, 
		new Server(server, serverport, {auto_reconnect: true}), 
		{safe: true});

db.open(function(err, db) {
    if (err) {
	console.error(err);
	process.exit(-1);
    }
});

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
    console.log("upload from " + req.ip);
    var c = 0;
    var docs = {};
    var form = new multiparty.Form(maxFields=10000);
    form.on('part', function(part) {
	// handle new part (json object)
	var json = '';
	part.on('data', function(chunk) {
	    json += chunk;
	});
	part.on('end', function() {
	    var obj = JSON.parse(json);
	    if (obj && obj.collection) {
		// add some more metadata to the object
		obj.upload = { server_ts : Date.now(),
			       req_ip : req.ip,
			       req_path : req.path };
		// init data cache
		if (!docs[obj.collection]) {
		    docs[obj.collection] = [];
		}
		docs[obj.collection].push(obj);
		c += 1;
	    } else {
		console.log("invalid data: " + json);
	    }
	});
    });

    form.on('error', function(err) {
	console.error(err);
	console.error(err.stack);
	res.status(500);
	res.render('error', { error: err });
    });

    form.on('close', function(err) {
	console.log("received " + c + " items");

	var error = undefined;
	_.each(docs, function(value, key) {
	    if (error) return;	
	    // insert batch to the collection
	    console.log("upload " + value.length + " items to " + key);
	    var collection = db.collection(key);
	    collection.insert(value, {w:1}, function(err, result) {
		if (err)  error = err;
	    });
	}); // each

	if (error) {
	    res.status(500);
	    res.render('error', { error: err });
	} else {
	    res.send(200);
	}
    });

    // start parsing the stream
    form.parse(req);
});

// generic error handler
app.use(function(err, req, res, next){
    console.error(err);
    console.error(err.stack);
    res.status(500);
    res.render('error', { error: err });
});

console.log("Listening on *:"+port);
app.listen(port);
