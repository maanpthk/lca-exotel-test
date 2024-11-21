const _=require('lodash');
const translate = require('./multilanguage.js');
const qnabot = require("qnabot/logging")


async function get_welcome_message(req, locale){
    const welcome_message = _.get(req,'_settings.DEFAULT_ALEXA_LAUNCH_MESSAGE', 'Hello, Please ask a question');
    if (_.get(req._settings, 'ENABLE_MULTI_LANGUAGE_SUPPORT')){
        return await translate.get_translation(welcome_message,'en',locale,req)
    } else {
        return welcome_message;
    }
}
async function get_stop_message(req, locale){
    const stop_message = _.get(req,'_settings.DEFAULT_ALEXA_STOP_MESSAGE', 'Goodbye');
    if (_.get(req._settings, 'ENABLE_MULTI_LANGUAGE_SUPPORT')){
        return await translate.get_translation(stop_message,'en',locale,req)
    } else {
        return stop_message;
    }
}

exports.parse=async function(req){
    var event = req._event;
    var out={
        _type:"ALEXA",
        _userId:_.get(event,"session.user.userId","Unknown Alexa User"),
        original:event,
        session:_.mapValues(
            _.get(event,'session.attributes',{}),
            x=>{
                try {
                    return JSON.parse(x);
                } catch(e){
                    return x;
                }
            }
        ),
        channel:null,
    };
    // set userPreferredLocale from Alexa request
    const alexa_locale = _.get(event,'request.locale').split("-")[0];
    _.set(out, 'session.qnabotcontext.userPreferredLocale', alexa_locale);
    qnabot.log("Set userPreferredLocale:", out.session.qnabotcontext.userPreferredLocale);
    var welcome_message;
    var stop_message;
    var err_message;
    
    switch(_.get(event,"request.type")){
        case "LaunchRequest":
            qnabot.log("INFO: LaunchRequest.");
            welcome_message = await get_welcome_message(req,alexa_locale);
            throw new AlexaMessage(welcome_message, false) ;
        case "SessionEndedRequest":
            qnabot.log("INFO: SessionEndedRequest.");
            throw new End() ;
        case "IntentRequest":
            qnabot.log("INFO: IntentRequest.");
            switch(_.get(event,"request.intent.name")){
                case "AMAZON.CancelIntent":
                    qnabot.log("INFO: CancelIntent.");
                    stop_message = await get_stop_message(req,alexa_locale);
                    throw new AlexaMessage(stop_message, true) ;
                case "AMAZON.StopIntent":
                    qnabot.log("INFO: StopIntent.");
                    stop_message = await get_stop_message(req,alexa_locale);
                    throw new AlexaMessage(stop_message, true) ;
                case "AMAZON.FallbackIntent":
                    qnabot.log("ERROR: FallbackIntent. This shouldn't happen - we can't get the utterance. Ask user to try again.");
                    err_message = await translate.translateText("Sorry, I do not understand. Please try again.",'en',alexa_locale); 
                    throw new AlexaMessage(err_message, false) ;  
                case "AMAZON.RepeatIntent":
                    welcome_message = await get_welcome_message(req,alexa_locale);
                    qnabot.log("At Repeat Intent") ;
                    qnabot.log(JSON.stringify(out)) ;
                    throw new Respond({
                        version:'1.0',
                        response: _.get(out,"session.cachedOutput",{outputSpeech:{type:"PlainText",text:welcome_message},shouldEndSession:false})
                    }) ;
                case "Qna_intent":
                    qnabot.log("INFO: Qna_intent.");
                    out.question=_.get(event,'request.intent.slots.QnA_slot.value',"");
                    break ;
                default:
                    qnabot.log("ERROR: Unhandled Intent - ", _.get(event,"request.intent.name"));
                    err_message = await translate.translateText("The skill is unable to process the request.",'en',alexa_locale); 
                    throw new AlexaMessage(err_message, true) ;                    
            }
    }
    if (out.question === "") {
        qnabot.log("ERROR: No value found for QnA_slot") ;
        err_message = await translate.translateText("The skill is unable to process the request.",'en',alexa_locale); 
        throw new AlexaMessage(err_message, true) ;
    }
    return out ;
} ;

/**
 * @see https://developer.amazon.com/en-US/docs/alexa/custom-skills/request-and-response-json-reference.html#response-format
 * 
 */
exports.assemble=function(request,response){
    let plainMessage = response.plainMessage;
    if (plainMessage && plainMessage.includes("<speak>")) {
        plainMessage = plainMessage.replace(/<\/?[^>]+(>|$)/g, "");
    }
    if (plainMessage.toLowerCase().startsWith("ok. ")) {
        plainMessage = plainMessage.replace(/[Oo][Kk]. /g, "");
    }
    let subTitle = response.card && response.card.subTitle ? response.card.subTitle : undefined;
    let res = {
        version:'1.0',
        response:{
            outputSpeech:_.pickBy({
                type:response.type,
                text:response.type==='PlainText' ? response.message : null,
                ssml:response.type==='SSML' ? response.message : null,
            }),
            card:_.get(response,"card.imageUrl") ? {
                type:"Standard",
                title:response.card.title || request.question,
                text:subTitle !== undefined ? subTitle +"\n\n" + plainMessage : plainMessage,
                image:{
                    smallImageUrl:response.card.imageUrl,
                    largeImageUrl:response.card.imageUrl
                }
            } : {
                type:"Simple",
                title: _.get(response,"card.title") || request.question || "Image",
                content: subTitle !== undefined ? subTitle +"\n\n" + plainMessage : plainMessage
            },
            shouldEndSession:false
        },
        sessionAttributes:_.get(response,'session',{})
    };
    
    let repromptText = _.get(response, "reprompt.text", undefined);
    
    if(repromptText) {
        _.set(res, "reprompt", {
            outputSpeech: _.pickBy({
                    type:_.get(response, "reprompt.type", null),
                    text:_.get(response, "reprompt.type", null)==='PlainText' ? _.get(response, "reprompt.text", null) : null,
                    ssml:_.get(response, "reprompt.type", null)==='SSML' ? _.get(response, "reprompt.text", null) : null,
                    playBehavior: 'REPLACE_ENQUEUED',
                })
        });
    }

    return res;
} ;

function End(){
    this.action="END" ;
}


function AlexaMessage(message,endSession){
    this.action="RESPOND" ;
    this.message={
        version:'1.0',
        response:{
            outputSpeech:{
                type:"PlainText",
                text:message
            },
            card: {
              type: "Simple",
              title: "Message",
              content: message
            },
            shouldEndSession:endSession
        }
    } ;
} 

function Respond(message){
    this.action="RESPOND" ;
    this.message=message ;
}