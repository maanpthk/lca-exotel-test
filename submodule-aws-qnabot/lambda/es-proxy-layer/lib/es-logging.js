//start connection
var Promise=require('bluebird')
var bodybuilder = require('bodybuilder')
var aws=require('aws-sdk')
var url=require('url')
var _=require('lodash')
var myCredentials = new aws.EnvironmentCredentials('AWS'); 
var request=require('./request')
const qnabot = require("qnabot/logging")
const qna_settings = require("qnabot/settings")


function processKeysForRegEx(obj, re) {
    Object.keys(obj).forEach(function(key,index) {
        let val = obj[key];
        if (_.isPlainObject(val)) {
            processKeysForRegEx(val, re);
        } else if ( key === "slot") {
            obj[key] = qnabot.redact_text(val);
        } else if ( key === "recentIntentSummaryView") {
            if (val) {
                processKeysForRegEx(val, re);
            }
        } else {
            if (typeof val === 'string') {
                obj[key] = qnabot.redact_text(val);
            }
        }
    });
}

function stringifySessionAttribues(res) {
    var sessionAttrs = _.get(res,"session",{}) ;
    for (var key of Object.keys(sessionAttrs)) {
        if (typeof sessionAttrs[key] != 'string') {
            sessionAttrs[key]=JSON.stringify(sessionAttrs[key]);
        }
    }
}

module.exports=function(event, context, callback){
    //data to send to general metrics logging
    var date = new Date()
    var now = date.toISOString()
    // need to unwrap the request and response objects we actually want from the req object
    var req =event.req
    var res =event.res
    var sessionAttributes = _.cloneDeep(_.get(res,"session",{}));
    
    // response session attributes are logged as JSON string values to avoid 
    // ES mapping errors after upgrading from previous releases.
    stringifySessionAttribues(res);

    let redactEnabled = _.get(req, '_settings.ENABLE_REDACTING');
    let redactRegex = _.get(req, '_settings.REDACTING_REGEX', "\\b\\d{4}\\b(?![-])|\\b\\d{9}\\b|\\b\\d{3}-\\d{2}-\\d{4}\\b");
    let cloudwatchLoggingDisabled = _.get(req, '_settings.DISABLE_CLOUDWATCH_LOGGING');

    qna_settings.set_environment_variables(req._settings)
    qnabot.setPIIRedactionEnvironmentVars(req._event.inputTranscript,
        _.get(req, "_settings.ENABLE_REDACTING_WITH_COMPREHEND",false),
        _.get(req, "_settings.REDACTING_REGEX",""),
        _.get(req, "_settings.COMPREHEND_REDACTING_ENTITY_TYPES",""),
        _.get(req, "_settings.COMPREHEND_REDACTING_CONFIDENCE_SCORE",.99)
        ).then(() =>{

    if (cloudwatchLoggingDisabled) {
        qnabot.log("RESULT", "cloudwatch logging disabled");
    } else {
        if (redactEnabled) {
            qnabot.log("redact enabled");
            let re = new RegExp(redactRegex, "g");
            processKeysForRegEx(req, re);
            processKeysForRegEx(res, re);
            processKeysForRegEx(sessionAttributes, re);
            qnabot.log("RESULT", event);
        } else {
            qnabot.log("RESULT", event);
        }
    }

    // constructing the object to be logged in OpenSearch (to visualize in Kibana)
    let jsonData = {
        entireRequest: req,
        entireResponse: res,
        qid: _.get(res.result, "qid"),
        utterance: String(req.question).toLowerCase().replace(/[\u2000-\u206F\u2E00-\u2E7F\\'!"#$%&()*+,\-.\/:;<=>?@\[\]^_`{|}~]/g, ""),
        answer: _.get(res, "message"),
        topic: _.get(res.result, "t", ""),
        session: sessionAttributes,
        clientType: req._clientType,
        tags: _.get(res, "tags", ""),
        datetime: now
    };

    if (cloudwatchLoggingDisabled) {
        jsonData.entireRequest = undefined;
        jsonData.utterance = undefined;
        jsonData.session = undefined;
    }
    // encode to base64 string to put into firehose and
    // append new line for proper downstream kinesis processing in kibana and/or athena queries over s3
    var objJsonStr = JSON.stringify(jsonData) + '\n';
    var firehose = new aws.Firehose();
    
    var params = {
          DeliveryStreamName: process.env.FIREHOSE_NAME, /* required */
          Record: { /* required */
            Data: Buffer.from(objJsonStr) /* Strings will be Base-64 encoded on your behalf */ /* required */
        }
    };
    
    firehose.putRecord(params, function(err, data) {
      if (err) qnabot.log(err, err.stack) // an error occurred
      else     qnabot.log(data)          // successful response
    })})
   
}
