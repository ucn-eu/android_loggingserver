var debug = require('debug')('uploader:db')
var _ = require('underscore');
var Db = require('mongodb').Db;
var Server = require('mongodb').Server;

// MongoDB code

/* Constructor */
var DbHandler = exports.DbHandler = function(server, serverport, dbname) {
    this.dburl = 'mongodb://'+server+':'+serverport+'/'+dbname;
    debug("mongodb: " + this.dburl);

    // connect to the db
    this.db = new Db(dbname, 
		     new Server(server, serverport, {auto_reconnect: true}), 
		     {safe: true});

    this.db.open(function(err, db) {
	if (err) {
	    console.error(err);
	    process.exit(-1);
	}
    });
}

/** Insert list of values to the collection 'key'. */
DbHandler.prototype.insertTo = function(cb, key, items) {
    var collection = this.db.collection(key);
    // FIXME: do once upon start, not on every insert ...
    collection.ensureIndex(
	{uid:1, ts:1}, {unique: true}, function(err, result) {
	    if (err) {
		cb(err, undefined);
	    } else {
		collection.insert(items, function(err, result) {
		    debug(JSON.stringify(err));
		    debug(typeof err);
		    // FIXME: how to get the msg / type from the err object? 
		    if (("" + err).indexOf('duplicate key error')>=0) {
			// ignore: something was uploaded twice
			cb(undefined, result);
		    } else {
			cb(err, result);
		    }
		});
	    }
	}
    );
};

DbHandler.prototype.findDevice = function(cb, vpnip) {
    var collection = this.db.collection('devices');
    collection.findOne(
	{ $or : [ {vpn_tcp_ip:vpnip}, 
		  {vpn_udp_ip:vpnip} ]}, 
	function(err, match) {
	    if (!err && match) {	
		cb(match);
	    } else if (err) {
		debug("findDevice error: " + err);
		cb(undefied);
	    } else {
		cb(undefied);
	    }
	}
    );
};

/** Update device to activity logger mapping and stats. */
DbHandler.prototype.logApp = function(login, uid) {
    var collection = this.db.collection('devices');
    collection.update(
	{ login : login },
	{ $set : { loggerapp_uuid : uid,
		   loggerapp_lastseen : new Date() },
	  $inc : { loggerapp_uploads : 1 }},
	function(err, result) {
	    if (err)
		debug("logApp error: " + err);
	});  
};
