#!/usr/bin/env node

// server.js
//------------------------------
//
// 2013-08-18, Jonas Colmsjö
//
// Copyright Gizur AB 2013
//
// Simple DNS server based on dnsd developed by iriscouch
//
// Using Google JavaScript Style Guide - http://google-styleguide.googlecode.com/svn/trunk/javascriptguide.xml
//
//------------------------------

var dnsd       = require('dnsd'),
    nconf      = require('nconf');


  nconf.use('file', { file: __dirname + '/redis-dns-config.json' });
  nconf.load();

  this.dnsInterface = nconf.get('dns_interface');
  this.dnsPort      = nconf.get('dns_port');
  this.dnsZone      = nconf.get('dns_zone');
  this.redisHost    = nconf.get('redis_host');
  this.redisPort    = nconf.get('redis_port');

  // set logging level
/*  switch(nconf.get('logging')) {

    case 'debug':
      helpers.logging_threshold  = helpers.logging.debug;
      break;

    case 'warning':
      helpers.logging_threshold  = helpers.logging.warning;
      break;

    default:
      console.log('error: incorrect logging level in config.json - should be warning or debug!');
  }
*/


function handler(req, res) {

  var question     = res.question[0], 
      hostname     = question.name, 
      length       = hostname.length, 
      ttl          = Math.floor(Math.random() * 3600),
      redis        = require("redis"),
      redis_client = redis.createClient(this.redisHost, this.redisPort);


  var answer = {};

  if(question.type === 'A') {

    // connect to redis
    redis_client.on("connect", function () {

      // first set the IP for the domain in redis
      redis_client.get("redis-dns:"+hostname, function(redis_err, redis_res) {
        if(redis_err) {
          console.log('Redis error:'+redis_err);
        } else {
          if(redis_res !== null && redis_res.length > 0) {
            answer = {
              name:hostname, 
              type:'A', 
              data:redis_res, 
              'ttl':ttl};

            res.answer.push(answer);

            redis_client.quit();
            console.log('%s:%s/%s question:%j answer:%j', req.connection.remoteAddress, req.connection.remotePort, req.connection.type, question, answer);
            res.end();

          } else {

            /* No match in Redis, try to lookup using the google server */

            var dns  = require('native-dns'),
                util = require('util');

            var nativeQuestion = dns.Question({
              name: question.name,
              type: 'A'
            });

            var start = Date.now();

            var nativeReq = dns.Request({
              question: nativeQuestion,
              server: { address: '8.8.8.8', port: 53, type: 'udp' },
              timeout: 1000
            });

            nativeReq.on('timeout', function () {
              console.log('native-dns: Timeout in making request');
            });

            nativeReq.on('message', function (err, answer) {
              answer.answer.forEach(function (a) {

                answer = {
                  name:hostname,
                  type:'A',
                  data:a.address,
                  'ttl':ttl};

                res.answer.push(answer);
              });
            });

            nativeReq.on('end', function () {
              var delta = (Date.now()) - start;
              console.log('Finished processing request: ' + delta.toString() + 'ms');

              redis_client.quit();
              console.log('%s:%s/%s question:%j answer:%j', req.connection.remoteAddress, req.connection.remotePort, req.connection.type, question, res.answer);
              res.end();

            });

            nativeReq.send();

          }
        }
      }.bind(this));
    }.bind(this));

    // redis error management
    redis_client.on("error", function (err) {
      console.log("Redis error: " + err);
    });

  } else {
    res.end();
  }

}

var server = dnsd.createServer(handler);
console.log('Server running at'+this.dnsInterface+':'+this.dnsPort);
server.zone(this.dnsZone, 'ns1.'+this.dnsZone, 'us@'+this.dnsZone, 'now', '2h', '30m', '2w', '10m')
      .listen(this.dnsPort, this.dnsInterface);
