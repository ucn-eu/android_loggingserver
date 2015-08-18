/*
   UCN Study Upload Server

   Copyright (C) 2015 Inria Paris-Roquencourt 

   The MIT License (MIT)

   Permission is hereby granted, free of charge, to any person obtaining a copy
   of this software and associated documentation files (the "Software"), to deal
   in the Software without restriction, including without limitation the rights
   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   copies of the Software, and to permit persons to whom the Software is
   furnished to do so, subject to the following conditions:
   
   The above copyright notice and this permission notice shall be included in 
   all copies or substantial portions of the Software.
   
   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   SOFTWARE.
*/
var debug = require('debug')('ucnupload.db')
var _ = require('underscore');
var Db = require('mongodb').Db;
var Server = require('mongodb').Server;

// MongoDB code

/* Constructor */
var DbHandler = exports.DbHandler = function(server, serverport, dbname) {
    this.dburl = 'mongodb://'+server+':'+serverport+'/'+dbname;
    debug("mongodb: " + this.dburl);

    this.db = new Db(
    	dbname, 
		new Server(server, serverport, { auto_reconnect : true }), 
		{ safe : true });

    this.db.open(function(err, db) {
		if (err) {
		    console.error(err);
		    process.exit(-1);
		}
    });
}

/* Insert list of values to the collection 'key'. */
DbHandler.prototype.insertTo = function(cb, key, items) {
    var collection = this.db.collection(key);

	collection.insert(items, function(err, result) {
		if (err) {
		    debug(JSON.stringify(err));
		    debug(typeof err);
		}

	    // FIXME: how to get the msg / type from the err object? 
	    if (err && ("" + err).indexOf('duplicate key error')>=0) {
			// ignore: something was uploaded twice
			cb(undefined, result);
	    } else {
			cb(err, result);
		}
	});
};

/* Find registered device based on the VPN IP. */
DbHandler.prototype.findDevice = function(cb, vpnip) {
    var collection = this.db.collection('devices');

    collection.findOne(
		{ $or : [ {vpn_tcp_ip:vpnip}, 
			      {vpn_udp_ip:vpnip}, 
			      {vpn_ipsec_ip:vpnip} ]}, 
		function(err, match) {
		    if (!err && match) {	
				cb(match);
		    } else if (err) {
				debug("findDevice error: " + err);
				cb(undefined);
		    } else {
				debug("findDevice not found: " + vpnip);
				cb(undefined);
		    }
		}
    );
};

/** Android logger app upload stats for device. */
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

/** Browser addon upload stats for device. */
DbHandler.prototype.logAddon = function(login, uid) {
    var collection = this.db.collection('devices');

    collection.update(
		{ login : login },
		{ $set : { browseraddon_uuid : uid,
			   	   browseraddon_lastseen : new Date() },
		  $inc : { browseraddon_uploads : 1 }},
		function(err, result) {
		    if (err)
				debug("logAddon error: " + err);
	});  
};