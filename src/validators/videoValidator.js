const joi = require('joi');
const logger = require('../utilities/logger');
const ApiResponse = require('../utilities/apiResponse');

const generateScriptBody = joi.object({
    title: joi.string().required(),
    angle: joi.string().required(),
    hook: joi.string().required()
})

const voiceoverBody = joi.object({
    script: joi.string().required(),
    title: joi.string().required()
})

const sceneBody = joi.object({
    title: joi.string().required()
})

const imageBody = joi.object({
    title: joi.string().required(),
    ids: joi.array().required()
})

const videoBody = joi.object({
    title: joi.string().required(),
    captions: joi.bool().required()
})

const generateScriptValidator = (req, res, next) => {
    try {
        const { error } = generateScriptBody.validate(req.body);
        if (error) {
            logger.error(`Validation error: ${error.message}`);
            return ApiResponse.error('Validation error', 422, error.message).send(res);
        }
        next();
    } catch (error) {
        logger.error('Error in Video Validator: ', error);
        next(error);
    }
};

const voiceoverValidator = (req, res, next) => {
    try {
        const { error } = voiceoverBody.validate(req.body);
        if (error) {
            logger.error(`Validation error: ${error.message}`);
            return ApiResponse.error('Validation error', 422, error.message).send(res);
        }
        next();
    } catch (error) {
        logger.error('Error in Video Validator: ', error);
        next(error);
    }
}

const getScenesValidator = (req, res, next) => {
    try {
        const { error } = sceneBody.validate(req.body);
        if (error) {
            logger.error(`Validation error: ${error.message}`);
            return ApiResponse.error('Validation error', 422, error.message).send(res);
        }
        next();
    } catch (error) {
        logger.error('Error in Video Validator: ', error);
        next(error);
    }
}

const getImageValidator = (req, res, next) => {
    try {
        const { error } = imageBody.validate(req.body);
        if (error) {
            logger.error(`Validation error: ${error.message}`);
            return ApiResponse.error('Validation error', 422, error.message).send(res);
        }
        next();
    } catch (error) {
        logger.error('Error in Video Validator: ', error);
        next(error);
    }
}
const getVideoValidator = (req, res, next) => {
    try {
        const { error } = videoBody.validate(req.body);
        if (error) {
            logger.error(`Validation error: ${error.message}`);
            return ApiResponse.error('Validation error', 422, error.message).send(res);
        }
        next();
    } catch (error) {
        logger.error('Error in Video Validator: ', error);
        next(error);
    }
}

module.exports = {
    generateScriptValidator,
    voiceoverValidator,
    getScenesValidator,
    getImageValidator,
    getVideoValidator
}
