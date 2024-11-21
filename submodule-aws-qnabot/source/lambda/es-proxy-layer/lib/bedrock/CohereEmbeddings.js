/*********************************************************************************************************************
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.                                                *
 *                                                                                                                    *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance    *
 *  with the License. A copy of the License is located at                                                             *
 *                                                                                                                    *
 *      http://www.apache.org/licenses/                                                                               *
 *                                                                                                                    *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES *
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions    *
 *  and limitations under the License.                                                                                *
 *********************************************************************************************************************/

const { BedrockModelProviderPrototype } = require('./BedrockModelProviderPrototype');

class CohereEmbeddings extends BedrockModelProviderPrototype {
    constructor() {
        super();
        this.body = {
            texts: [],
            input_type: 'search_document',
        };
    }

    setPrompt(prompt) {
        this.body.texts.push(prompt);
    }

    getResponseBody(response) {
        return this.parseResponseBody(response).embeddings[0];
    }
}
exports.CohereEmbeddings = CohereEmbeddings;
