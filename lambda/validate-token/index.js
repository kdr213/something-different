'use strict';
var crypto = require('crypto');
var waterfall = require('async-waterfall');
var AWS = require('aws-sdk');
AWS.config.update({region: 'us-west-2'});

const doc = require('dynamodb-doc');

const dynamo = new doc.DynamoDB();


/**
 * Validates authentication token from client.
 */
exports.handler = (event, context, callback) => {

    const parsedBody = JSON.parse(event.body);
    const done = (err, res) => callback(null, {
        statusCode: err ? (err.code ? err.code : '400') : '200',
        body: err ? err.message : JSON.stringify(res),
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
    });

    //Load beta or prod config
    var configuration = {};
    waterfall([function() {
        configuration = getConfiguration(event);
    },
    function() {

        console.log(JSON.stringify(configuration));
        switch (event.httpMethod) {
            case 'POST':
                const token = JSON.parse(event.body).token;
                console.log("Token: " + token);
                var decipheredToken = "";
                var username = "";
                try { 
                    console.log(configuration['key']);
                    const decipher = crypto.createDecipher('aes192',configuration['key']);
                    decipheredToken = decipher.update(token, 'hex', 'utf8');
                    decipheredToken += decipher.final('utf8');
                    username = JSON.parse(decipheredToken).username; // Check for valid JSON
                } catch(err) {
                    done({code: '403', message: "Could not decipher token"});
                }
                console.log('DECIPHERED TOKEN:' + decipheredToken);

                var queryParams = {
                    TableName : configuration['user-table'],
                    KeyConditionExpression: "#username = :user",
                    ExpressionAttributeNames:{
                        "#username": "username"
                    },
                    ExpressionAttributeValues: {
                        ":user":username
                    }
                };

                dynamo.query(queryParams, function(err,data) {
                    if(err) {
                        console.log(err);
                        done(err,data);
                    }

                    else {
                        console.log("QUERY RESULT:" + JSON.stringify(data.Items));
                        if(data.Items.length === 0) {
                            callback(null, {statusCode: '403', body: "Incorrect username", headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'}});
                
                        }
                        else {
                            done(null,{username:data.Items[0].username,email:data.Items[0].email,firstname:data.Items[0].firstname,lastname:data.Items[0].lastname,verified:data.Items[0].verified});
                        }
                    }
                });

                break;
            default:
                done(new Error(`Unsupported method "${event.httpMethod}"`));
            }
    }]);
    
}
    

    //Sets configuration based on dev stage
    function getConfiguration(event) {

        var configuration = {};
        
        if(event.resource.substring(1,5) == 'beta') {
            configuration['stage'] = 'beta';
            configuration['user-table'] = 'SD-user-beta';
            configuration['reply-table'] = 'SD-reply-beta';
            configuration['thread-table'] = 'SD-thread-beta';


            var keyQueryParams = {
                    TableName : 'SD-beta-key'
            };
            dynamo.scan(keyQueryParams, function(err,data) {
                    if(err || data.Items.length === 0) {
                        console.log(err);
                        done({message:'Internal server error', code:'500'},data);
                    }
                    else {
                        configuration['key'] = data.Items[0].Key;
                        var emailQueryParams = {
                            TableName : 'SD-beta-sender-email',
                        };

                        dynamo.scan(emailQueryParams, function(err,data) {
                                if(err || data.Items.length === 0) {
                                    console.log(err);
                                    done({message:'Internal server error', code:'403'},data);
                                }
                                else {
                                    configuration['sender-email'] = data.Items[0].email;
                                }
                        });
                    }
            });

            
        } else if(event.resource.substring(1,5) == 'prod') {
            configuration['stage'] = 'prod';
            configuration['user-table'] = 'SD-user';

            var keyQueryParams = {
                    TableName : 'SD-beta-key',
            };
            dynamo.scan(keyQueryParams, function(err,data) {
                    if(err || data.Items.length === 0) {
                        console.log(err);
                        done({message:'Internal server error', code:'403'},data);
                    }
                    else {
                        configuration['key'] = data.Items[0].Key;
                        var emailQueryParams = {
                            TableName : 'SD-sender-email',
                        };

                        dynamo.scan(emailQueryParams, function(err,data) {
                                if(err || data.Items.length === 0) {
                                    console.log(err);
                                    done({message:'Internal server error', code:'403'},data);
                                }
                                else {
                                    configuration['sender-email'] = data.Items[0].email;
                                    return configuration;
                                }
                        });
                    }
            });

        } else done({message:"Invalid resource path", code:'403'});

    }

