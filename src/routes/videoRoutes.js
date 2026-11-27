const router = require('express').Router();
const logger = require('../utilities/logger')
const ApiResponse = require('../utilities/apiResponse')
const { videoValidator } = require('../validators')
const { videoController } = require('../controllers')

router.get('/ideas', async (req, res, next) => {
    try {
        const ideas = await videoController.getVideoIdeas();
        return ApiResponse.success(ideas).send(res);
    } catch (error) {
        logger.error('Error in Video Route: ', error);
        next(error);
    }
});

router.post('/script', videoValidator.generateScriptValidator, async (req, res, next) => {
    try {
        const script = await videoController.generateScript(req.body);
        return ApiResponse.success(script).send(res)
    } catch (error) {
        logger.error('Error in Video Route: ', error);
        next(error);
    }
});

router.post('/voiceover', videoValidator.voiceoverValidator, async (req, res, next) => {
    try {
        const file = await videoController.getVoiceover(req.body);
        return ApiResponse.success(file).send(res);
    } catch (error) {
        logger.error('Error in Video Route: ', error);
        next(error);
    }
});

router.post('/timestamps', videoValidator.voiceoverValidator, async (req, res, next) => {
    try {
        const timestamps = await videoController.getTimestamps(req.body);
        return ApiResponse.success(timestamps).send(res);
    } catch (error) {
        logger.error('Error in Video Route: ', error);
        next(error);
    }
})

router.post('/scenes', videoValidator.getScenesValidator, async (req, res, next) => {
    try {
        const scenes = await videoController.getScenes(req.body);
        return ApiResponse.success(scenes).send(res);
    } catch (error) {
        logger.error('Error in Video Route: ', error);
        next(error);
    }
})

router.post('/images', videoValidator.getImageValidator, async (req, res, next) => {
    try {
        const images = await videoController.getImages(req.body);
        return ApiResponse.success(images).send(res);
    } catch (error) {
        logger.error('Error in Video Route: ', error);
        next(error);
    }
})

router.post('/video', videoValidator.getScenesValidator, async (req, res, next) => {
    try {
        const video = await videoController.getVideo(req.body);
        return ApiResponse.success(video).send(res);
    } catch (error) {
        logger.error('Error in Video Route: ', error);
        next(error);
    }
})

module.exports = router;