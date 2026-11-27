const { initChatModel } = require('langchain');

require('dotenv').config();

let model;

const getModel = async (modelName) => {
    try {
        if (!model) {
            model = await initChatModel(modelName, {
                modelProvider: process.env.CHAT_MODEL_PROVIDER,
                apiKey: process.env.CHAT_API_KEY
            });
        }
        return model;
    } catch (error) {
        throw error;
    }
}

module.exports = {
    getModel
}