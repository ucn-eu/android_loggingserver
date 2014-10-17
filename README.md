Data Uploader
=============

Node app to receive multipart from POST uploads of json objects to be 
stored to the backend mongodb.

Stores received objects to a configurable database (see processes.json) in 
a collection <obj.collection> or 'default' if the keyword is missing.

INSTALL
-------

```
$ npm install -g pm2
$ npm install
```

Create processes.json (see the provided examples).

RUNNING
-------

```
$ npm start
$ npm stop
```

STATUS
------

```
$ pm2 list
$ pm2 logs upload-ucn
$ pm2 desc upload-ucn
$ pm2 monit
```
