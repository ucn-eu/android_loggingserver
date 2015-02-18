var debug = require('debug')('uploader')
var _ = require('underscore');
var argv = require('minimist')(process.argv.slice(2));
var express = require('express');
var multiparty = require('multiparty');
var bodyParser = require('body-parser')
var redis = require("redis");
var moment = require("moment");
var DbHandler = require("./db").DbHandler;

debug(JSON.stringify(argv));
if (argv.h || argv._.length !== 1) {
  console.log("Usage: " + process.argv[0] + 
	" " + process.argv[1] + 
	" [-p <port>] [-s server] [-q server_port] db");
  process.exit(0);
}

// redis cli for runtime stats
var client = redis.createClient();
client.select(2, function(res) {
    debug("Redis select " + res);
});
client.on("error", function(err) {
    debug("Redis error " + err);
});

// app listening port
var port = argv.p || 3001;

// storage backend
var server = argv.s || 'localhost';
var serverport = argv.q || 27017;
var dbname = argv._[0];
var db = new DbHandler(server, serverport, dbname);

// reset stats
var rstats = 'ucnupload';
client.hmset(rstats, {
    start : new Date(),
    uploadcnt : 0,
    lastupload : 0,
    errorcnt : 0,
    lasterror : 0 });

// main app
var app = express();

// we'll be behind a proxy
app.enable('trust proxy');

// middleware

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({limit: '100mb', extended: false }))

// parse application/json
app.use(bodyParser.json({limit: '100mb'}))

app.use(function(err, req, res, next){
    debug(err);
    debug(err.stack);

    try {
	if (client) {
	    client.hmset(rstats, { lasterror : new Date() });
	    client.hincrby(rstats, "errorcnt", 1);
	}
    } catch(e) {
    }

    res.type('application/json');
    res.status(500).send({ error: "internal server error",
			   details: err});
});

// GET returns some basic stats about the server
app.get('/*', function(req, res){
    client.hgetall(rstats, function(err, obj) {
	res.type('text/plain');
	obj.uptime = "Started " + moment(new Date(obj.start).getTime()).fromNow();
	res.status(200).send(JSON.stringify(obj,null,4));
    });
});

app.post('/*', function(req,res) {
    var c = 0;
    var docs = {};
    var adddoc = function(obj) {
	// required fields
	if (!obj.collection || !obj.uid || !obj.ts) {
	    debug("invalid object: " + JSON.stringify(obj));  
	    return;
	}

	// convert few known date fields to native mongo format
	if (obj['ts'])
	    obj['ts'] = new Date(obj['ts']);
	if (obj['ts_event'])
	    obj['ts_event'] = new Date(obj['ts_event']);

	// add some more metadata to the object
	obj.upload = { 
	    server_ts : new Date(),
	    req_ip : req.ip 
	};

	// HACK: fix for the 4MB object size limit that the network_state
	// objects hit, put the socket list to a separate collection
	// as this is the largest individual item inside the object.
	// New version of the android collector do this automatically
	if (obj.collection === 'network_state' && 'sockets' in obj.data) {
	    obj2 = _.clone(obj);
	    obj2.collection = 'sockets';
	    obj2.data = obj.data.sockets;
	    debug("extract "  + obj2.length + " sockets from network_state");
	    if (!docs[obj2.collection]) {
		docs[obj2.collection] = [];
	    }
	    docs[obj2.collection].push(obj2);
	    c += 1;

	    delete obj.data.sockets;
	}

	if (!docs[obj.collection]) {
	    docs[obj.collection] = [];
	}
	docs[obj.collection].push(obj);
	c += 1;
    };

    var savedocs = function() {
	if (c === 0) {
	    client.hmset(rstats, { lasterror : new Date() });
	    client.hincrby(rstats, "errorcnt", 1);

	    res.type('application/json');
	    res.status(500).send({error: "got zero objects"});
	    return;
	}

	debug("saving " + c + " items");  

	// match IPv4 address
	var regex = new RegEx('\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}');
	var uid = undefined;   // the device uuid
	var vpnip = undefined; // vpn interface IP
	var error = undefined;

	_.each(docs, function(items, key) {
	    if (error) return false; // stop, some error happened before

	    // insert batch to the collection
	    debug("save " + items.length + " items to " + key);

	    if (!uid) {
		uid = items[0].uid; // device unique identifier
	    }

	    if (key == 'network_stats' && !vpnip) {
		// see if the device reports a VPN tunnel interface + IP
		_.each(items, function(o) {
		    if (vpnip) return; // found!

		    if (o['data']['ip_addr_show']) {
			_.each(o['data']['ip_addr_show'], function(iface) {
			    if (iface.name.indexOf('tun')>=0 && 
				iface.ipv4 && !vpnip) 
			    {
				vpnip = iface.ipv4;
			    }
			});
		    } else if (o['data']['ifconfig']) {
			_.each(o['data']['ifconfig'], function(iface) {
			    if (iface.name.indexOf('tun')>=0 && !vpnip) {
				vpnip = _.find(iface.addresses, function(ad) {
				    return regex.test(ad);
				});
			    }
			});
		    }
		});
	    }

	    db.insertTo(function(err, result) {
		if (err) error = err;
	    }, key, items);
	}); // each docs
	
	if (error) {
	    client.hmset(rstats, { lasterror : new Date() });
	    client.hincrby(rstats, "errorcnt", 1);

	    res.type('application/json');
	    res.status(500).send({error: "internal server error",
				  details: error});
	} else {
	    client.hmset(rstats, { lastupload : new Date() });
	    client.hincrby(rstats, "uploadcnt", c);
	    res.sendStatus(200);

	    client.get("android:"+uid, function(err, obj) {
		var devicename = undefined;
		if (!err && obj) 
		    devicename = obj;
		
		if (devicename) {
		    // already seen this device, just update logs
		    db.logApp(devicename, uid);
		    
		} else if (!devicename && vpnip) {
		    // new device, identify based on the VPN IP
		    debug("find match " + vpnip + "/" + uid);
		    db.findDevice(function(dev) {
			if (dev) {				
			    devicename = dev.login;
			    // store mapping in redis for next time
			    client.set("android:"+uid, devicename);
			    debug("matched " + vpnip + "->" + devicename)
			    db.logApp(devicename, uid);
			} else {
			    debug("no match for " + vpnip);
			}
		    }, vpnip);
		} else {
		    debug("no VPN IP found for " + uid);
		}
	    }); // client.get
	}
    }; //savedocs
    
    debug("upload from " + req.ip + " as " + req.get('Content-Type') + 
	 " size " + req.get('Content-Length'));

    if (req.get('Content-Type').indexOf('multipart/form-data')>=0) {
	var form = new multiparty.Form({maxFields : 10000});

	form.on('part', function(part) {
	    // handle new part (json object)
	    var json = '';
	    part.on('data', function(chunk) {
		json += chunk;
	    });
	    part.on('end', function() {
		var obj = JSON.parse(json);
		if (obj && obj.collection) {
		    adddoc(obj);
		} else {
		    debug("invalid data: " + json);
		}
	    });
	});	

	form.on('error', function(err) {
	    debug(err);
	    debug(err.stack);

	    client.hmset(rstats, { lasterror : new Date() });
	    client.hincrby(rstats, "errorcnt", 1);

	    res.type('application/json');	    
	    res.status(500).send({ error: "internal server error",
				   details: err});
	});
	
	form.on('close', function(err) {
	    savedocs();
	});

	// start parsing the stream
	form.parse(req);

    } else if (req.get('Content-Type').indexOf('application/x-www-form-urlencoded')>=0 || req.get('Content-Type').indexOf('json')>=0) 
    {
	var objs = req.body;
	if (objs && _.isArray(objs)) {
	    _.each(objs, function(obj) {
		adddoc(obj);
	    });
	    savedocs();
	} else if (objs && _.isObject(objs) && objs.collection) {
	    adddoc(objs);
	    savedocs();
	} else {
	    debug("invalid req.body: " + JSON.stringify(req.body));

	    client.hmset(rstats, { lasterror : new Date() });
	    client.hincrby(rstats, "errorcnt", 1);

	    res.type('application/json'); 
	    res.status(500).send({error: "invalid data"});
	}
    } else {
	client.hmset(rstats, { lasterror : new Date() });
	client.hincrby(rstats, "errorcnt", 1);

	res.type('application/json');
	res.status(500).send({error: "unhandled content type: "+req.get('Content-Type')});
    }
});

// start!
var server = app.listen(port, function() {
    debug("listening on %s:%d",
	  server.address().address, server.address().port);
});
