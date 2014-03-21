Data Uploader
=============

Simple node.js based server to receive multipart from POST uploads 
of json objects to be stored to a mongodb.

http(s)://<server>/upload/<database>

Puts objects to <database> to collection <obj.collection> or 'default'
if the keyword is missing.

RUNNING
-------

npm install -g forever

forever start -o /var/log/uploader.log server.js
