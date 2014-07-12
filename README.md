Data Uploader
=============

Node app to receive multipart from POST uploads of json objects to be stored to a mongodb.

http(s)://<server>/upload/<database>

Puts objects to <database> to collection <obj.collection> or 'default'
if the keyword is missing.

RUNNING
-------

Install pm2:

$ npm install -g pm2

$ NODE_ENV=production npm start
$ NODE_ENV=production npm stop

STATUS
------

$ pm2 list
$ pm2 logs uploader
$ pm2 desc uploader


