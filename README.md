Data Uploader
=============

Node app to receive multipart from POST uploads of json objects to be 
stored to the backend MongoDB.

Stores received objects to a configurable database (see processes.json) in 
a collection <obj.collection> or 'default' if the keyword is missing.

INSTALL
-------

```
$ npm install -g pm2
$ npm install
```

Create processes.json (see the example).

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
$ pm2 logs datauploadserver
$ pm2 desc datauploadserver
$ pm2 monit
```
