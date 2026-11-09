web: node ./build/server/index.js
postdeploy: node twt/s3-cors.js && yarn db:migrate
