Data Uploader
=============

Node app to receive multipart from POST uploads of json objects which will 
be stored to the backend mongodb.

Puts objects to <database> to collection <obj.collection> or 'default'
if the keyword is missing.

RUNNING
-------

$ npm install -g pm2
$ npm start
$ npm stop

STATUS
------

$ pm2 list
$ pm2 logs uploader
$ pm2 desc uploader
$ pm2 monit

