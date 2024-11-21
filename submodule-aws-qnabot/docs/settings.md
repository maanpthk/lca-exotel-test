# QnABot Settings

| Setting | Valid values | Description |
|---------|--------------|--------------|
| ENABLE_DEBUG_RESPONSES | true or false | Determines whether to log original English responses and translated responses for debugging
| ES_USE_KEYWORD_FILTERS | true or false | Determines whether to detect keywords from Comprehend when searching for answers
| ES_EXPAND_CONTRACTIONS | JSON format   | Expand contractions to resolve problems with keyword filters.
| ES_KEYWORD_SYNTAX_TYPES | comma separate list <br/> See [Analyze Syntax](https://docs.aws.amazon.com/comprehend/latest/dg/how-syntax.html) | A list of tokens representing parts of speech identified by Amazon Comprehend for matching questions
| ES_SYNTAX_CONFIDENCE_LIMIT | decimal between 0 and 0.99 | Amazon Comprehend makes a best effort to determine the parts of speech  in a sentence. The keywords will only be used if the confidence limit is greater than this amount
| ES_MINIMUM_SHOULD_MATCH |"2<75%" <br/> See [query-dsl-minimum-should-match](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-minimum-should-match.html) for syntax |  Determines how close a question should match to return a hit
| ES_NO_HITS_QUESTION | text | The question QnABot should use when it cannot find an answer
| ES_USE_FUZZY_MATCH  | true or false | Determines whether QnABot should return answers similar to the question asked. See [Fuzzy Query](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-fuzzy-query.html) for more information
| ES_PHRASE_BOOST | integer | If the user's question is a phrase match to a question in the knowledge then boost the score by this factor.
| ES_SCORE_ANSWER_FIELD | true or false | Include the content of the answer field (not just the question fields) when determining the score for a match
| ENABLE_SENTIMENT_SUPPORT | true or false | Enables [Amazon Comprehend](https://docs.aws.amazon.com/comprehend/latest/dg/how-sentiment.html) be used for sentiment analysis
| ENABLE_MULTI_LANGUAGE_SUPPORT | true or false | Enable or Disable Amazon Translate support. See list of [Supported Languages](multilanguage_support.md#supported-languages)
| ENABLE_CUSTOM_TERMINOLOGY| true or false |  Enable support for installed [Custom Terminology](https://aws.amazon.com/blogs/machine-learning/introducing-amazon-translate-custom-terminology/) files when using Amazon Translate
| MINIMUM_CONFIDENCE_SCORE | decimal between 0.0 and 0,99 | The minimum confidence before Amazon Comprehend will determine the user's language
| ALT_SEARCH_KENDRA_INDEXES | An Array of comma separated Ids |  A list of one or more [Amazon Kendra](https://aws.amazon.com/kendra/) indexes used for Kendra fallback
| ALT_SEARCH_KENDRA_FALLBACK_CONFIDENCE_SCORE | VERY_HIGH \| HIGH \| MEDIUM \| LOW |  Answers will only be returned that or at or above the specified [confidence level](https://aws.amazon.com/about-aws/whats-new/2020/09/amazon-kendra-launches-confidence-scores/) when using Kendra Fallback
| ALT_SEARCH_KENDRA_FAQ_CONFIDENCE_SCORE: | VERY_HIGH \| HIGH \| MEDIUM \| LOW |  Minimum Kendra [confidence level](https://aws.amazon.com/about-aws/whats-new/2020/09/amazon-kendra-launches-confidence-scores/) threshold for Kendra FAQ
| ALT_SEARCH_KENDRA_S3_SIGNED_URLS | true or false | Enables [signed S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html) Urls for Amazon Kendra results.  If enabled, allows support for Kendra documents which are not publicly accessible.
| ALT_SEARCH_KENDRA_S3_SIGNED_URL_EXPIRE_SECS | integer | Determines length of time in seconds for the validity of signed S3 Urls in Kendra fallback.
| ALT_SEARCH_KENDRA_MAX_DOCUMENT_COUNT | integer | Number of documents returned by Amazon Kendra fallback
| ALT_SEARCH_KENDRA_FAQ_MESSAGE | string | Heading when a [Frequently Asked Question](https://docs.aws.amazon.com/kendra/latest/dg/response-types.html) is found by Amazon Kendra.
| ALT_SEARCH_KENDRA_TOP_ANSWER_MESSAGE | string | Heading when the [top answer](https://docs.aws.amazon.com/kendra/latest/dg/response-types.html) is found by Amazon Kendra
| ALT_SEARCH_KENDRA_ANSWER_MESSAGE | string | Heading when a [Document](https://docs.aws.amazon.com/kendra/latest/dg/response-types.html) is returned by Amazon Kendra
| ALT_SEARCH_KENDRA_RESPONSE_TYPES | Comma separated list. One or more valid [Amazon Kendra response type](https://docs.aws.amazon.com/kendra/latest/dg/response-types.html) | Kendra fallback will only return responses of the listed types
| ALT_SEARCH_KENDRA_ABBREVIATE_MESSAGE_FOR_SSML | boolean | If a set to "true", an abbreviate Amazon Kendra response will be sent via voice.  If set to "false", the full text of the Kendra fallback response will be sent when using voice.
| KENDRA_FAQ_INDEX | Kendra Index Id | Amazon Kendra Index to use sync Elastic Search questions and answers
| KENDRA_FAQ_CONFIG_MAX_RETRIES | integer | Number of times to retry syncing FAQ's when a throttling error occurs
| KENDRA_FAQ_CONFIG_RETRY_DELAY | integer | Amount of time to wait in seconds between attempts to retry syncing
| KENDRA_FAQ_ES_FALLBACK | true or false | When Kendra FAQ is enabled, but does not return an answer then query ElasticSearch
| ENABLE_KENDRA_WEB_INDEXER | true or false | Enables the web indexer
| KENDRA_INDEXER_URLS | comma separated list | List of web addresses QnABot should crawl and [index with Kendra](./kendra_crawler_guide/README.md)
| KENDRA_INDEXER_SCHEDULE | [CloudWatch Rate Syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/events/ScheduledEvents.html) | Interval Indexer should crawl
| KENDRA_INDEXER_CRAWL_DEPTH | number | Sets the depth to the number of levels in a website from the seed level that you want to crawl
| KENDRA_INDEXER_CRAWL_MODE | HOST_ONLY \| SUBDOMAINS \| EVERYTHING | Determines which addresses should be crawled
| KENDRA_WEB_PAGE_INDEX | Kendra Index Id | The index to use for the web crawler, a [custom data source](https://docs.aws.amazon.com/kendra/latest/dg/data-source-custom.html) will automatically be added to the specified index.  
| KENDRA_INDEXED_DOCUMENTS_LANGUAGES | comma separate list | Should be one of supported Kendra languages mentioned in [documentation](https://docs.aws.amazon.com/kendra/latest/dg/in-adding-languages.html)
| ERRORMESSAGE | text | Response to the user when a processing error occurs
| EMPTYMESSAGE | text | Response to the user when an answer could not be found
| DEFAULT_ALEXA_LAUNCH_MESSAGE | text | Initial greeting when using Alexa
| DEFAULT_ALEXA_REPROMPT | text | Default text used for Alexa reprompt capability
| DEFAULT_ALEXA_STOP_MESSAGE | text |  User response to end session with Alexa
| SMS_HINT_REMINDER_ENABLE | true or false | Enables SMS_HINT_REMINDER
| SMS_HINT_REMINDER |  text | Reminds user how to use the bot on first use after SMS_HINT_REMINDER_INTERVAL_HRS
| SMS_HINT_REMINDER_INTERVAL_HRS | integer | The amount of time in hours when to send SMS_HINT_REMINDER
| IDENTITY_PROVIDER_JWKS_URLS | array of urls |  User can override this empty list to add trusted IdPs (eg from Lex-Web-UI CognitoUserPoolPubKey)
| ENFORCE_VERIFIED_IDENTITY | true or false |  Set to true to make QnABot require verified identity from client
| NO_VERIFIED_IDENTITY_QUESTION | text | If user identity cannot be verified, replace question string with this.
| ELICIT_RESPONSE_MAX_RETRIES | integer | Number of times an elicitResponse LexBot can be called before giving up when the Bot returns Failed
| ELICIT_RESPONSE_RETRY_MESSAGE | text |  Default retry message when working with LexBot
| ELICIT_RESPONSE_BOT_FAILURE_MESSAGE | text |  Message used when maximum number of retries is exceeded
| ELICIT_RESPONSE_DEFAULT_MSG| text |
| CONNECT_IGNORE_WORDS | comma separated list | Throw error if connect client sends individual characters not processable by elastic search
| CONNECT_ENABLE_VOICE_RESPONSE_INTERRUPT | true or false | Return bot response in session attribute to enable contact flow to use response as an interruptible prompt.
| CONNECT_NEXT_PROMPT_VARNAME | text | Name of session var to use for next prompt
| ENABLE_REDACTING | true or false | Enable the system to redact log output
| ENABLE_REDACTING_WITH_COMPREHEND | true or false | Enables [Amazon Comprehend based PII Redacting](https://aws.amazon.com/blogs/machine-learning/detecting-and-redacting-pii-using-amazon-comprehend/)
| COMPREHEND_REDACTING_ENTITY_TYPES | comma separated list | A list of [PII Entity Types](https://aws.amazon.com/blogs/machine-learning/detecting-and-redacting-pii-using-amazon-comprehend/)
| COMPREHEND_REDACTING_CONFIDENCE_SCORE | number (0 to .99) | Only redact PII where Amazon Comprehend's confidence score is greater than this number
| REDACTING_REGEX | regex expression | Redacts expressions matching regex from logs
| PII_REJECTION_ENABLED | true or false | Enables PII Rejection
| PII_REJECTION_QUESTION | text  | If PII is found, the user's request (question) will change to this phrase
| PII_REJECTION_REGEX | regex expression | Used to find PII based on a regex
| PII_REJECTION_ENTITY_TYPES | comma separated list of [PII Entity Categories](https://aws.amazon.com/blogs/machine-learning/detecting-and-redacting-pii-using-amazon-comprehend/) | Only recognize PII entity types in the list
| PII_REJECTION_CONFIDENCE_SCORE | number (0 to 0.99) | Only reject PII where Amazon Comprehend's confidence score is greater than this number
| DISABLE_CLOUDWATCH_LOGGING | true or false | Disable all logging in fulfillment es query handler lambda. does not disable logging from Lambda Hooks or Conditional Chaining Lambda functions
| MINIMAL_ES_LOGGING | true or false | do not log utterances or session attributes to ElasticSearch for Kibana logging
| S3_PUT_REQUEST_ENCRYPTION | text | enable header x-amz-server-side-encryption header and set with this value
| BOT_ROUTER_WELCOME_BACK_MSG | text | The text used by QnABot when ending communication from a specialty bot
| BOT_ROUTER_EXIT_MSGS | comma separated list | The exit phrases in comma separated list available for the a user to end communication with a specialty bot
| RUN_LAMBDAHOOK_FROM_QUERY_STEP | true or false | Controls timing of execution for Lambda hooks
| LAMBDA_PREPROCESS_HOOK | string | name of AWS Lambda to run before each question is processed. The name of the Lambda must start with "qna-" or "QNA-" to comply with the permissions of the role attached to the Fulfillment Lambda .
| LAMBDA_POSTPROCESS_HOOK | string | name of AWS Lambda to run after the question is processed. But before user profile information is saved. The name of the Lambda must start with "qna-" or "QNA-" to comply with the permissions of the role attached to the Fulfillment Lambda .
| SEARCH_REPLACE_QUESTION_SUBSTRINGS | string | replace words or phrases in user questions by defining search/replace pairs in a JSON object like: {"searchString":"replaceString"}. Add additional pairs separated by commas, like: {"searchString":"replaceString", "searchString2":"replaceString2"}.
