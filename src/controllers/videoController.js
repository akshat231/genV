const logger = require("../utilities/logger");
const { videoService } = require("../services");

const generateScript = async (body) => {
  try {
    const title = body.title;
    const angle = body.angle;
    const hook = body.hook;
    const result = await videoService.generateScript(title, angle, hook);
    return result;
  } catch (error) {
    throw error;
  }
};

const getVideoIdeas = async () => {
  try {
    const ideas = await videoService.getVideoIdeas();
    return ideas;
  } catch (error) {
    throw error;
  }
}

const getVoiceover = async (body) => {
  try {
    const script = body.script;
    const title = body.title;
    if (!script || script.trim() === '' || !title || title.trim() === '') {
      return { message: 'No Script/Title was provided', data: {} };
    }
    const file = await videoService.getVoiceover(script, title);
    return file;
  } catch (error) {
    throw error;
  }
}

const getTimestamps = async (body) => {
  try {
    const script = body.script;
    const title = body.title;
    if (!script || script.trim() === '' || !title || title.trim() === '') {
      return { message: 'No Script/Title was provided', data: {} };
    }
    const timestamps = await videoService.getTimestamps(script, title);
    return timestamps;
  } catch (error) {
    throw error;
  }
}

const getScenes = async (body) => {
  try {
    const title = body.title;
    if (!title || title.trim() === '') {
      return { message: 'No Title was provided', data: {} };
    }
    const scenes = await videoService.getScenes(title);
    return scenes;
  } catch (error) {
    throw error;
  }
}

const getImages = async (body) => {
  try {
    const title = body.title;
    const ids = Array.isArray(body.ids) ? body.ids : [];

    if (typeof title !== "string" || title.trim() === "") {
      return { message: "No Title was provided", data: {} };
    }
    const images = await videoService.getImages(title.trim(), { onlyIds: ids });
    return images;
  } catch (error) {
    throw error;
  }
}

const getVideo = async (body) => {
  try {
    const title = body.title;

    if (typeof title !== "string" || title.trim() === "") {
      return { message: "No Title was provided", data: {} };
    }
    const video = await videoService.getVideo(title.trim());
    return video;
  } catch (error) {
    throw error;
  }
}

module.exports = {
  generateScript,
  getVideoIdeas,
  getVoiceover,
  getTimestamps,
  getScenes,
  getImages,
  getVideo
}



