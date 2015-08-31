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
var debug = require('debug')('ucnupload')
var _ = require('underscore');
var express = require('express');
var multiparty = require('multiparty');
var bodyParser = require('body-parser')
var redis = require("redis");
var moment = require("moment");

var DbHandler = require("./db").DbHandler;

// configs
var redisdb = parseInt(process.env.REDISDB) || 2;

var dbserver = process.env.MONGOHOST || 'localhost';
var dbserverport = parseInt(process.env.MONGOPORT) || 27017;
var dbname = process.env.MONGODB || 'ucntest';

var port = parseInt(process.env.PORT) || 3000;

// redis cli for runtime stats
var client = redis.createClient();
client.select(redisdb, function() {});
client.on("error", function(err) {
    debug("Redis connect error: " + err);
    process.exit(1);
});

// reset stats
var rstats = 'ucnupload';
client.hmset(rstats, {
    start : new Date(),
    uploadcnt : 0,
    lastupload : 0,
    errorcnt : 0,
    lasterror : 0 
});

// storage handler
var db = new DbHandler(dbserver, dbserverport, dbname);

// main app
var app = express();

// we'll be behind a proxy
app.enable('trust proxy');

// middleware

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({limit: '100mb', extended: false }))

// parse application/json
app.use(bodyParser.json({limit: '100mb'}))

// error handler
app.use(function(err, req, res, next) {
    debug(err);
    debug(err.stack);

    try {
        client.hmset(rstats, { lasterror : new Date() });
        client.hincrby(rstats, "errorcnt", 1);
    } catch(e) {
    }

    res.type('application/json');
    res.status(500).send({ 
        error: "internal server error",
        details: err
    });
});

app.use(function(req, res, next) {
    var ip = (req.headers['x-forwarded-for'] ||
              req.connection.remoteAddress ||
              req.socket.remoteAddress ||
              req.connection.socket.remoteAddress ||
              req.ip);
    ip = ip.replace('::ffff:','').trim();
    req.clientip = ip
    debug("connection from " + ip);
    next();
});

// GET returns some basic stats about the server
app.get('/*', function(req, res){
    client.hgetall(rstats, function(err, obj) {
        res.type('text/plain');
        obj.uptime = "Started " + moment(new Date(obj.start).getTime()).fromNow();
        res.status(200).send(JSON.stringify(obj,null,4));
    });
});

// POST to receive data
app.post('/*', function(req,res) {
    // uploaded docs
    var c = 0;

    // collection -> doc
    var docs = {};

    // match IPv4 address
    var regex = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/;

    // the uploader device uid (android app or browser generated)
    var uid = undefined;

    // the VPN IP of the uploader (to match the uid to the registered user)
    var vpnip = undefined;

    // uploading from browser or from the Android app
    var frombrowser = false;

    var sendreply = function(err) {
        if (err) {
            // uploader stats
            client.hmset(rstats, { lasterror : new Date() });
            client.hincrby(rstats, "errorcnt", 1);
            res.type('application/json');
            res.status(500).send(err);
        } else {
            // uploader stats
            client.hmset(rstats, { lastupload : new Date() });
            client.hincrby(rstats, "uploadcnt", c);
            res.status(200).send();
        }   
    };

    var adddoc = function(obj) {
        // required fields
        if (!obj.collection || !obj.uid || !obj.ts) {
            debug("invalid object: " + JSON.stringify(obj));  
            return;
        }

        if (!uid) {
            uid = obj.uid; // device unique identifier
            frombrowser = (obj.browser !== undefined);
        }

        // convert few known date fields to native mongo format
        if (obj['ts'])
            obj['ts'] = new Date(obj['ts']);
        if (obj['ts_event'])
            obj['ts_event'] = new Date(obj['ts_event']);

        // add some more metadata to the object
        obj.upload = { 
            server_ts : new Date(),
            req_ip : req.clientip 
        };

        // HACK: fix for the 4MB object size limit that the network_state
        // objects hit, put the socket list to a separate collection
        // as this is the largest individual item inside the object.
        // New version of the android collector does this automatically
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

        // Try to figure out the vpnip from the Android logger data
        if (obj.collection == 'network_state' && !vpnip) {
            if (obj['data']['ip_addr_show']) {
                _.each(obj['data']['ip_addr_show'], function(iface) {
                    if ((iface.name.indexOf('tun')>=0 || iface.name.indexOf('ppp')>=0) && iface.ipv4 && !vpnip) {
                        vpnip = iface.ipv4.ip;
                    }
                });
            } else if (obj['data']['ifconfig']) {
                _.each(obj['data']['ifconfig'], function(iface) {
                    if ((iface.name.indexOf('tun')>=0 || iface.name.indexOf('ppp')>=0) && !vpnip) {
                        vpnip = _.find(iface.addresses, function(ad) {
                            return regex.test(ad);
                        });
                    }
                });
            }
        }

        if (!docs[obj.collection]) {
            docs[obj.collection] = [];
        }
        docs[obj.collection].push(obj);
        c += 1;
    };

    var savedocs = function() {
        debug("saving " + c + " items");  
        if (c === 0) {
            client.hmset(rstats, { lasterror : new Date() });
            client.hincrby(rstats, "errorcnt", 1);

            res.type('application/json');
            res.status(500).send({error: "got zero objects"});
            return;
        }

        // loop over all collections
        var error = undefined;
        _.each(docs, function(items, key) {
            if (error) return false; // stop, some error happened before

            // insert batch to the collection
            debug("save " + items.length + " items to " + key);
            db.insertTo(function(err, result) {
                if (err) error = err;
            }, key, items);
        }); // each
        
        if (error) {
            sendreply({
                error: "internal server error",
                details: error
            });
        } else {
            sendreply();

            // log device stats (try to match the uploader to a registered device)
            client.get("device:"+uid, function(err, obj) {
                var devicename = undefined;

                if (!err && obj) {
                    devicename = obj;
                    debug("match " + devicename + "/" + uid);

                    if (frombrowser)
                        db.logAddon(devicename, uid); 
                    else
                        db.logApp(devicename, uid); 

                } else {
                    // new device, identify based on the VPN IP
                    if (!vpnip)
                        vpnip = req.clientip; // may not be true but try anyways                    
                    debug("find match " + vpnip + "/" + uid);

                    db.findDevice(function(dev) {
                        if (dev) {              
                            devicename = dev.login;
                            // store mapping in redis for next time
                            client.set("device:"+uid, devicename);
                            debug("matched " + vpnip + "->" + devicename)

                            if (frombrowser)
                                db.logAddon(devicename, uid); 
                            else
                                db.logApp(devicename, uid); 
                        } else {
                            debug("no match for " + vpnip);
                        }
                    }, vpnip);
                }
            }); // client.get
        }
    }; //savedocs
    
    debug("upload from " + req.clientip + " as " + req.get('Content-Type') + 
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

            sendreply({ 
                error: "internal server error",
                details: err
            });
        });
        
        form.on('close', function(err) {
            savedocs();
        });

        // start parsing the stream
        form.parse(req);

    } else if (req.get('Content-Type').indexOf('application/x-www-form-urlencoded')>=0 || req.get('Content-Type').indexOf('json')>=0) {
        // body is valid JSON
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
            sendreply({error: "invalid data"});
        }
    } else {
        debug("invalid Content-Type: " + req.get('Content-Type'));
        sendreply({error: "unhandled content type: "+req.get('Content-Type')});
    }
});

// start!
var server = app.listen(port, function() {
    debug("listening on %s:%d", server.address().address, server.address().port);
});
