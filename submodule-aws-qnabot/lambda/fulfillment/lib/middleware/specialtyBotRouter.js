/**
 *
 * Specialty Bot Router. Interacts with either another Lex Bot to route messages or calls a Lambda function that
 * provides routing service to another non Lex Bot. Handles response from either Lex or Lambda function, encapsulates
 * session attributes, and returns results to QnABot fulfillment handler.
 */
const _=require('lodash');
const AWS = require('aws-sdk');
const translate = require('./multilanguage.js');
const qnabot = require("qnabot/logging")


/**
 * Identifies the user to pass on for requests to Lex or other bots
 * @param req
 * @returns {string}
 */
function getBotUserId(req) {
    let tempBotUserID = _.get(req, "_userInfo.UserId", "nouser");
    tempBotUserID = tempBotUserID.substring(0, 100); // Lex has max userId length of 100
    return tempBotUserID;
}

/**
 * Determines if provided val is a String
 * @param val
 * @returns {boolean}
 */
function isString(val) {
    return ( (typeof val === 'string' || val instanceof String) ? true : false);
}

async function translate_res(req, res){
    const locale = _.get(req, 'session.userLocale');
    if (_.get(req._settings, 'ENABLE_MULTI_LANGUAGE_SUPPORT')){
        if (_.get(res,"message")) {
            res.message = await translate.get_translation(res.message,'en',locale,req);
        }
        if (_.get(res,"plainMessage")) {
            res.plainMessage = await translate.get_translation(res.plainMessage,'en',locale,req);
        }
        if (_.get(res,"card")) {
            res.card.title = await translate.get_translation(res.card.title,'en',locale,req);
        }
        if (_.get(res,"card.buttons")) {
            res.card.buttons.forEach(async function (button) {
                button.text = await translate.get_translation(button.text,'en',locale,req);
                //TODO Address multilanguage issues with translating button values for use in confirmation prompts
                //Disable translate of button value
                //button.value = await translate.translateText(button.value,'en',locale);
            });
            res.plainMessage = await translate.get_translation(res.plainMessage,'en',locale,req);
        }
    }
    return res;
}

/**
 * Make requests to a Lambda function acting as a Bot Router. The Lambda is called with the following json payload
 * req {
 *     request: "message" // String. Type of request. Placeholder for future request types
 *     inputText: "" // String. Message target should process
 *     sessionAttributes: {} // Object. Session attributes as provided by target on previous call.
 *     userId: "" // String. Identifies the user from QnABot user.
 * }
 *
 * The response json payload should conform to the following
 *
 * {	response: "message", "othersTBD"
 *	    status: "success", "failed"
 *	    message: <String>,
 *      messageFormat:  "PlainText", "CustomPayload", "SSML", "Composite"
 *	    sessionAttributes: Object,
 *	    sessionAttributes.appContext.altMessages.ssml: <String>,
 *      sessionAttributes.appContext.altMessages.markdown: <String>
 * }
 *
 * @param name
 * @param req
 * @returns Payload object returned by Bot Router
 */
async function lambdaClientRequester(name, req) {
    const lambda = new AWS.Lambda();
    const payload = {
        req: {
            request: "message",
            inputText: _.get(req, "question"),
            sessionAttributes: _.get(req, "session.qnabotcontext.specialtySessionAttributes", {}),
            userId: getBotUserId(req)
        }
    }
    const result = await lambda.invoke({
        FunctionName: name,
        InvocationType: "RequestResponse",
        Payload: JSON.stringify(payload)
    }).promise();
    let obj = JSON.parse(result.Payload);
    qnabot.log("lambda payload obj is : " + JSON.stringify(obj,null,2));
    return obj;
}

function lexV1ClientRequester(params) {
    const lexV1Client = new AWS.LexRuntime({apiVersion: '2016-11-28'});
    return new Promise(function(resolve, reject) {
        lexV1Client.postText(params, function(err, data) {
            if (err) {
                qnabot.log(err, err.stack);
                reject('Lex client request error:' + err);
            }
            else {
                qnabot.log("Lex client response:" + JSON.stringify(data, null, 2));
                resolve(data);
            }
        });
    });
}

function lexV2ClientRequester(params) {
    qnabot.log(`aws sdk version is ${AWS.VERSION}`);
    const lexV2Client = new AWS.LexRuntimeV2();
    return new Promise(function(resolve, reject) {
        qnabot.log(`V2 params are ${JSON.stringify(params,null,2)}`);
        lexV2Client.recognizeText(params, function(err, data) {
            if (err) {
                qnabot.log(err, err.stack);
                reject('Lex V2 client request error:' + err);
            }
            else {
                qnabot.log("Lex V2 client response:" + JSON.stringify(data, null, 2));
                resolve(data);
            }
        });
    });
}

function generateMergedAttributes(req) {
    const mergedSessionAttributes = _.get(req, "session.qnabotcontext.specialtySessionAttributes", {});
    const attributesToMerge = _.get(req, 'session.qnabotcontext.specialtyBotMergeAttributes', "").split(",");
    attributesToMerge.map(attribute=>{
        const value =_.get(req, `session.${attribute.trim()}`, "");
        if (value.length > 0) {
            mergedSessionAttributes[attribute.trim()] = value;
        }
    });
    return mergedSessionAttributes;
}

/**
 * Setup call to Lex or Lambda Bot Router including user ID, input text, botName, botAlis. It is an async function and
 * will return the response from either Lex or Lambda based Bot Router.
 * @param req
 * @param res
 * @param botName
 * @param botAlias
 * @returns {Promise<*>}
 */
async function handleRequest(req, res, botName, botAlias) {
    if (botName.toLowerCase().startsWith("lambda::")) {
        // target bot is a Lambda Function
        const lambdaName = botName.split("::")[1];
        qnabot.log("Calling Lambda:", lambdaName);
        let response = await lambdaClientRequester(lambdaName, req);
        qnabot.log("lambda response: " + JSON.stringify(response,null,2));
        return response;
    } else {
        function mapFromSimpleName(botName) {
            const bName = process.env[botName];
            return bName ? bName : botName;
        }

        // Resolve bot details from environment, if using simple name for built-in bots
        const botIdentity = mapFromSimpleName(botName);

        let tempBotUserID = _.get(req, "_userInfo.UserId", "nouser");
        tempBotUserID = tempBotUserID.substring(0, 100); // Lex has max userId length of 100

        // Determine if we using LexV1 or LexV2.. LexV2 bot is identified by "lexv2::BotId/BotAliasId/LocaleId"
        if (botIdentity.toLowerCase().startsWith("lexv2::")) {
            let res = {};
            const ids = botIdentity.split("::")[1];
            let [botId,botAliasId,localeId]=ids.split("/")
            localeId = localeId || "en_US";
            const params = {
                botId: botId,
                botAliasId: botAliasId,
                localeId: localeId,
                sessionId: tempBotUserID,
                sessionState: {
                    sessionAttributes: generateMergedAttributes(req),
                },
                text: _.get(req, "question")
            };
            const lexv2response = await lexV2ClientRequester(params);

            res.intentName = lexv2response.sessionState.intent.name;
            res.sessionAttributes = lexv2response.sessionState.sessionAttributes;
            res.dialogState = lexv2response.sessionState.intent.state;
            res.slotToElicit = lexv2response.sessionState.dialogAction.slotToElicit;
            let finalMessage = "";
            if (lexv2response.messages && lexv2response.messages.length > 0) {
                lexv2response.messages.forEach((mes) => {
                    if (mes.contentType === 'ImageResponseCard') {
                        res.responseCard = {};
                        res.responseCard.version = '1';
                        res.responseCard.contentType = 'application/vnd.amazonaws.card.generic';
                        res.responseCard.genericAttachments = [];
                        res.responseCard.genericAttachments.push(mes.imageResponseCard);
                    } else {
                        finalMessage += mes.content + " ";
                    }
                });
            }
            res.message = finalMessage.trim();

            // lex v2 FallbackIntent match means it failed to fill desired slot(s).
            if (lexv2response.sessionState.intent.name === "FallbackIntent" ||
                lexv2response.sessionState.intent.state === "Failed") {
                res.dialogState = "Failed";
            } else {
                res.dialogState = lexv2response.sessionState.dialogAction.type;
            }
            let slots = _.get(lexv2response,"sessionState.intent.slots");
            if (slots) {
                res.slots = _.mapValues(slots, x => { return _.get(x,"value.interpretedValue") } );
            }
            return res;
        } else {
            const params = {
                botAlias: botAlias,
                botName: botIdentity,
                inputText: _.get(req, "question"),
                sessionAttributes: generateMergedAttributes(req),
                userId: getBotUserId(req),
            };
            const response = await lexV1ClientRequester(params);
            return response;
        }
    }
};

/**
 * Function that adjusts state to terminate use of a specialty bot
 * @param req
 * @param res
 * @param welcomeBackMessage
 * @returns {{}}
 */
function endUseOfSpecialtyBot(req, res, welcomeBackMessage) {
    delete res.session.qnabotcontext.specialtyBot;
    delete res.session.qnabotcontext.specialtyBotName;
    delete res.session.qnabotcontext.specialtyBotAlias;
    delete res.session.qnabotcontext.specialtySessionAttributes;

    if (welcomeBackMessage) {
        let plaintextResp = welcomeBackMessage;
        let htmlResp = `<i> ${welcomeBackMessage} </i>`;
        _.set(res, "message", plaintextResp);
        let altMessages = {
            'html': htmlResp
        };
        _.set(res.session, "appContext.altMessages", altMessages);
    }

    const resp = {};
    resp.req = req;
    resp.res = res;
    return resp;
}

/**
 * Main processing logic to handle request from 3_query.js and process response from Lex. Handles
 * dialogState response from Lex. Identifies if the user has issued an exit request.
 * @param req
 * @param res
 * @param hook
 * @returns {Promise<{}>}
 */
async function processResponse(req, res, hook, alias) {
    qnabot.log('specialtyBotRouter request: ' + JSON.stringify(req, null, 2));
    qnabot.log('specialtyBotRouter response: ' + JSON.stringify(res, null, 2));
    const welcomeBackMessage = _.get(req._settings, 'BOT_ROUTER_WELCOME_BACK_MSG', 'Welcome back to QnABot.');
    const exitResponseDefault = _.get(req._settings, 'BOT_ROUTER_EXIT_MSGS', 'exit,quit,goodbye,leave');
    let exitResponses = exitResponseDefault.split(',');
    exitResponses.map(entry => entry.trim());
    let currentUtterance = req.question.toLowerCase();
    qnabot.log(`current utterance: ${currentUtterance}`);
    qnabot.log('exit responses are: ' + JSON.stringify(exitResponses,null,2));
    if (_.indexOf(exitResponses, currentUtterance)>=0) {
        qnabot.log('user provided exit response given');
        let resp = endUseOfSpecialtyBot(req, res, welcomeBackMessage);
        resp.res = await translate_res(resp.req, resp.res);
        qnabot.log("returning resp for user requested exit: " + JSON.stringify(resp,null,2));
        return resp;
    } else {
        let botResp = await handleRequest(req, res, hook, alias);
        qnabot.log("specialty botResp: " + JSON.stringify(botResp, null, 2));
        let lexBotIsFulfilled = false;
        if (botResp.message || _.get(botResp,'dialogState', "") === 'ReadyForFulfillment') {
            if (_.get(botResp,'dialogState', "") === 'ReadyForFulfillment') {
                botResp.message = JSON.stringify(botResp.slots,null,2);
                lexBotIsFulfilled = true;
            }
            let ssmlMessage = undefined;
            if (botResp.sessionAttributes && botResp.sessionAttributes.appContext) {
                const appContext = ( isString(botResp.sessionAttributes.appContext) ? JSON.parse(botResp.sessionAttributes.appContext) : botResp.sessionAttributes.appContext);
                // if alt.messsages contains SSML tags setup to return ssmlMessage
                if (appContext && _.has(appContext,'altMessages.ssml') && appContext.altMessages.ssml.includes("<speak>")) {
                    ssmlMessage = appContext.altMessages.ssml;
                }
                _.set(res.session, "appContext.altMessages", appContext.altMessages);
            }
            _.set(res, "session.qnabotcontext.specialtySessionAttributes", botResp.sessionAttributes);
            _.set(res, "message", botResp.message);
            _.set(res, "plainMessage", botResp.message);
            _.set(res, "messageFormat", botResp.messageFormat);
            if (_.get(botResp,'responseCard'))  {
                qnabot.log("found a response card. attached to res. only one / first response card will be used");
                if (botResp.responseCard.genericAttachments[0].subTitle === null) botResp.responseCard.genericAttachments[0].subTitle = '';
                if (botResp.responseCard.genericAttachments[0].attachmentLinkUrl === null) botResp.responseCard.genericAttachments[0].attachmentLinkUrl = '';
                if (botResp.responseCard.genericAttachments[0].imageUrl === null) botResp.responseCard.genericAttachments[0].imageUrl = '';
                _.set(res, "result.r", botResp.responseCard.genericAttachments[0]);
                _.set(res, "card", botResp.responseCard.genericAttachments[0]);
                _.set(res, "card.send", true);
                qnabot.log(`res is ${JSON.stringify(res,null,2)}`);
            }

            if (ssmlMessage && req._preferredResponseType === "SSML") {
                res.type = "SSML";
                res.message = ssmlMessage;
            }
            const isFromQnABot = _.has(botResp, 'sessionAttributes.qnabot_gotanswer');
            if (_.get(botResp,'dialogState', "") === 'Fulfilled' && !isFromQnABot) {
                lexBotIsFulfilled = true;
            }
            if (botResp.sessionAttributes.QNABOT_END_ROUTING || lexBotIsFulfilled) {
                qnabot.log("specialtyBot requested exit");
                let resp = endUseOfSpecialtyBot(req, res, undefined);
                resp.res = await translate_res(resp.req, resp.res);
                return resp;
            }
        }

        // autotranslate res fields
        res = await translate_res(req, res);

        const resp = {};
        resp.req = req;
        resp.res = res;
        return resp;
    }
}

exports.routeRequest=processResponse;
