var debug = require('debug')('uploader')
var _ = require('underscore');
var argv = require('minimist')(process.argv.slice(2));
var express = require('express');
var multiparty = require('multiparty');

// mongo stuff
var Db = require('mongodb').Db;
var Server = require('mongodb').Server;

if (argv.h || !argv.d) {
  console.log("Usage: " + process.argv[0] + 
	" " + process.argv[1] + 
	" [-p <port>] [-s server] [-q server_port] -d db");
  process.exit(0);
}

var port = argv.p || 3001;
var server = argv.s || 'localhost';
var serverport = argv.q || 27017;
var dbname = argv.d;
if (!dbname) {
    console.error("missing -d <mongodb name>");
    process.exit(-1);
}

var dburl = 'mongodb://'+server+':'+serverport+'/'+dbname;
debug("mongodb: " + dburl);

// connect to the db
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

// middleware
app.use(express.json());
app.use(express.urlencoded());
app.use(function(err, req, res, next){
    debug(err);
    debug(err.stack);
    res.type('application/json');
    res.send(500, { error: "internal server error",
		    details: err});
});

// routes
app.get('/*', function(req, res){
    res.type('application/json');
    res.send(500, { error: "invalid request",
		    url : req.originalUrl});
});
app.post('/*',function(req,res) {
    var c = 0;
    var docs = {};
    var form = new multiparty.Form({maxFields : 10000});

    debug("upload from " + req.ip);

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
		debug("invalid data: " + json);
	    }
	});
    });

    form.on('error', function(err) {
	debug(err);
	debug(err.stack);
	res.type('application/json');	    
	res.send(500, { error: "internal server error",
			details: err});
    });

    form.on('close', function(err) {
	debug("received " + c + " items");

	var error = undefined;
	_.each(docs, function(value, key) {
	    if (error) return;	
	    // insert batch to the collection
	    debug("upload " + value.length + " items to " + key);
	    var collection = db.collection(key);
	    collection.insert(value, {w:1}, function(err, result) {
		if (err)  error = err;
	    });
	}); // each

	if (error) {
	    debug("failed to add data to mongodb: " + error);
	    res.type('application/json');	    
	    res.send(500, { error: "internal server error",
			    details: error});
	} else {
	    res.send(200);
	}
    });

    // start parsing the stream
    form.parse(req);
});

// start!
var server = app.listen(port, function() {
    debug("listening on %s:%d",
	  server.address().address, server.address().port);
});
