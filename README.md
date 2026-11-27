# genV

genV is an Express API that turns a video idea into a finished short video. It exposes **seven APIs**, and each one produces a single piece of the pipeline: ideas, script, voiceover, timestamps, scenes, images, and finally the rendered video.

The endpoints are intentionally composable. You can run the whole pipeline in order, or call individual steps to inspect and regenerate only the part you need. Every step saves its output to disk and reuses existing artifacts, so re-running a step skips work that is already done.

## Pipeline

```
GET  /api/video/ideas       -> 5 video ideas
POST /api/video/script      -> narration script + claims to verify
POST /api/video/voiceover   -> voiceover.mp3
POST /api/video/timestamps  -> word/sentence timings
POST /api/video/scenes      -> timed scenes + image prompts
POST /api/video/images      -> one image per scene
POST /api/video/video       -> final.mp4 with voiceover and captions
```

Each step after `ideas` reads the artifacts written by the previous steps. All steps are keyed by the video `title`, which is slugified into a workspace directory.

## Requirements

- Node.js >= 18
- An OpenAI API key with access to chat, TTS, transcription, and image models
- `ffmpeg` and `ffprobe` available on `PATH`
- A writable directory for generated assets

The video step uses `libx264`, `aac`, and the `subtitles` filter, so use an ffmpeg build with those enabled.

## Setup

```bash
npm install
cp .env.example .env
# edit .env with your API key and paths
npm start
```

The server listens on port `5000` by default. Note that the port and host come from `config/default.json` (`server.port`, `server.host`), not from `.env`. The `PORT` variable is only used by `docker-compose.yml` for host port mapping.

## Configuration

### Server

| Variable | Description |
| --- | --- |
| `config/default.json` -> `server.port` | HTTP port (default `5000`) |
| `config/default.json` -> `server.host` | HTTP host (default `localhost`) |
| `config/default.json` -> `server.corsWhiteList` | Allowed CORS origins; empty array allows all |

### LLM and audio

| Variable | Description |
| --- | --- |
| `CHAT_API_KEY` | OpenAI API key used by every step |
| `CHAT_MODEL_PROVIDER` | LangChain model provider (default `openai`) |
| `IDEA_MODEL` | Model used to generate video ideas |
| `SCRIPT_MODEL` | Model used to write the script |
| `SCENE_MODEL` | Model used to write image prompts for scenes |
| `VOICEOVER_MODEL` | Text-to-speech model |
| `VOICE_TEXTURE` | TTS voice, for example `coral` |
| `TRANSCRIPTION_MODEL` | Speech-to-text model used for word timings |
| `IMAGE_MODEL` | Image generation model |

> `getModel` caches the first chat model it initializes, so the model used for all LLM steps is the first one requested (the idea model). Set `IDEA_MODEL` to the model you want for the whole pipeline.

### Output and voiceover

| Variable | Description |
| --- | --- |
| `VOICEOVER_PARENT_DIRECTORY` | Root directory where each video's workspace is created (required) |

### Images

| Variable | Default | Description |
| --- | --- | --- |
| `IMAGE_SIZE` | `1536x1024` | Generated image size |
| `IMAGE_QUALITY` | `medium` | Image quality |
| `IMAGE_FORMAT` | `jpeg` | Output format |
| `IMAGE_CONCURRENCY` | `4` | Number of images generated in parallel |

### Video

| Variable | Default | Description |
| --- | --- | --- |
| `VIDEO_WIDTH` | `1920` | Output width |
| `VIDEO_HEIGHT` | `1080` | Output height |
| `VIDEO_FPS` | `30` | Output frame rate |
| `VIDEO_FADE_SEC` | `0.5` | Crossfade duration between scenes; `0` disables crossfades |
| `VIDEO_CAPTION_STYLE` | see `.env.example` | ffmpeg `force_style` string for burned-in captions |
| `CLIP_CONCURRENCY` | `3` | Number of scene clips rendered in parallel |

## Estimated cost for a 5-minute video

The following estimate assumes a 5-minute video with a ~700-word script, about 50 scenes (roughly 6 seconds each), one successful generation per step, and the default image settings (`1536x1024`, `medium`, `jpeg`). Prices are OpenAI list prices as of November 2026 and will change; check the [pricing page](https://developers.openai.com/api/docs/pricing) before budgeting.

| Step | Usage | Unit price | Estimated cost |
| --- | --- | --- | --- |
| Ideas | 5 ideas, ~0.5K output tokens | `gpt-6-luna`: $0.10 / $0.50 per 1M input/output tokens | < $0.01 |
| Script | ~1.2K output tokens | `gpt-6.1-sol`: $2 / $10 per 1M input/output tokens | ~$0.01 |
| Scenes | ~2.5K output tokens | `gpt-6.1-sol`: $2 / $10 per 1M input/output tokens | ~$0.03 |
| Voiceover | ~5 minutes of audio | `gpt-4o-mini-tts`: ~$0.015 / minute | ~$0.08 |
| Timestamps | ~5 minutes of audio | `whisper-1`: $0.006 / minute | ~$0.03 |
| Images | 50 images at `1536x1024`, `medium` | `gpt-image-2`: $0.041 / image | ~$2.05 |
| Video | Local ffmpeg render | No API charge | $0.00 |
| **Total** | | | **~$2.20** |

Image generation dominates the cost. Changing `IMAGE_QUALITY` changes the total significantly:

| `IMAGE_QUALITY` | Cost per image | 50 images | Estimated total |
| --- | --- | --- | --- |
| `low` | $0.005 | $0.25 | ~$0.40 |
| `medium` | $0.041 | $2.05 | ~$2.20 |
| `high` | $0.165 | $8.25 | ~$8.40 |

The "estimated total" includes roughly $0.15 for the text, voiceover, and transcription steps. Add 10-20% for retries or regenerated images. Local ffmpeg render time and electricity are not included. Because LLM steps reuse cached models and artifacts, re-running a step does not necessarily repeat its full cost.

## API

All routes are under `/api`. Responses use a common envelope:

```json
{
  "success": true,
  "message": "...",
  "data": {}
}
```

Validation failures return HTTP `422` with `success: false`.

### 1. Get video ideas

```http
GET /api/video/ideas
```

Generates five philosophy-and-modern-life video ideas.

**Response data**

```json
{
  "ideas": [
    {
      "title": "Clickable video title",
      "angle": "The specific angle or opinion",
      "hook": "One-line hook for the first 10 seconds"
    }
  ]
}
```

### 2. Generate a script

```http
POST /api/video/script
Content-Type: application/json

{
  "title": "Why you keep wanting more",
  "angle": "Desire expands to fill whatever you give it",
  "hook": "The thing you want next will not be the last thing you want."
}
```

Writes a 650-750 word narration script for text-to-speech.

**Response data**

```json
{
  "script": "Plain spoken prose with paragraphs separated by blank lines...",
  "claimsToVerify": ["Any quote, date, attribution, or factual claim to verify"]
}
```

### 3. Generate the voiceover

```http
POST /api/video/voiceover
Content-Type: application/json

{
  "title": "Why you keep wanting more",
  "script": "Full narration script..."
}
```

Splits the script into paragraphs, generates audio for each one, and joins them into `voiceover.mp3` with ffmpeg.

**Response data**

```json
{
  "file": "/path/to/workspace/why-you-keep-wanting-more/voiceover.mp3",
  "durationSec": 312.4
}
```

### 4. Generate timestamps

```http
POST /api/video/timestamps
Content-Type: application/json

{
  "title": "Why you keep wanting more",
  "script": "Full narration script..."
}
```

Transcribes `voiceover.mp3` and aligns the script sentences to word-level timings.

**Response data**

```json
{
  "file": "/path/to/workspace/why-you-keep-wanting-more/timestamps.json",
  "durationSec": 312.4,
  "sentences": [
    { "index": 0, "text": "First sentence.", "start": 0, "end": 3.2 }
  ],
  "words": [
    { "word": "First", "start": 0, "end": 0.4 }
  ]
}
```

### 5. Generate scenes

```http
POST /api/video/scenes
Content-Type: application/json

{
  "title": "Why you keep wanting more"
}
```

Groups sentences into scenes of roughly 4-8 seconds and asks the LLM for one image prompt per scene.

**Response data**

```json
{
  "file": "/path/to/workspace/why-you-keep-wanting-more/scenes.json",
  "durationSec": 312.4,
  "scenes": [
    {
      "id": 1,
      "start": 0,
      "end": 6.1,
      "durationSec": 6.1,
      "narration": "Narration for this scene.",
      "imagePrompt": "Visual description of the still image."
    }
  ]
}
```

### 6. Generate images

```http
POST /api/video/images
Content-Type: application/json

{
  "title": "Why you keep wanting more",
  "ids": []
}
```

Generates one image per scene. Pass `"ids": []` to generate every scene, or a list such as `[2, 5]` to regenerate only those scenes. Images that already exist with the same prompt and settings are skipped.

**Response data**

```json
{
  "dir": "/path/to/workspace/why-you-keep-wanting-more/images",
  "generated": 3,
  "images": [
    {
      "id": 1,
      "start": 0,
      "end": 6.1,
      "durationSec": 6.1,
      "file": "/path/to/workspace/why-you-keep-wanting-more/images/scene-001.jpg"
    }
  ]
}
```

### 7. Generate the video

```http
POST /api/video/video
Content-Type: application/json

{
  "title": "Why you keep wanting more"
}
```

Renders a short motion clip for each image, crossfades the clips, adds the voiceover, and burns in captions. Captions are enabled by default.

**Response data**

```json
{
  "file": "/path/to/workspace/why-you-keep-wanting-more/final.mp4",
  "durationSec": 312.6,
  "clips": 52
}
```

## Typical flow

```bash
BASE=http://localhost:5000/api
TITLE="Why you keep wanting more"

# 1. Pick an idea
curl "$BASE/video/ideas"

# 2. Write the script for the chosen title, angle, and hook
curl -X POST "$BASE/video/script" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Why you keep wanting more","angle":"...","hook":"..."}'

# 3. Generate audio from the returned script
curl -X POST "$BASE/video/voiceover" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Why you keep wanting more","script":"..."}'

# 4. Align the script to the audio
curl -X POST "$BASE/video/timestamps" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Why you keep wanting more","script":"..."}'

# 5. Build scenes and image prompts
curl -X POST "$BASE/video/scenes" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Why you keep wanting more"}'

# 6. Generate the images
curl -X POST "$BASE/video/images" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Why you keep wanting more","ids":[]}'

# 7. Render the final video
curl -X POST "$BASE/video/video" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Why you keep wanting more"}'
```

## Generated files

Everything for a video lives in `VOICEOVER_PARENT_DIRECTORY/<slug>/`, where the slug is derived from the title.

```
<slug>/
  part-00.mp3            paragraph audio chunks
  list.txt               ffmpeg concat list for the chunks
  settings.hash          hash of script/voice settings
  voiceover.mp3          joined narration
  transcription.json     raw transcription with word timings
  timestamps.json        aligned sentence and word timings
  scenes.json            timed scenes with image prompts
  images/
    manifest.json        prompt/settings hashes for cache invalidation
    scene-001.jpg
  clips/
    manifest.json        render hashes for cache invalidation
    scene-001.mp4
  captions.srt           generated subtitles
  final.mp4              final rendered video
```

Steps are resumable. Changing the script or voice settings invalidates the voiceover chunks; changing an image prompt invalidates that scene's image and clip; changing video settings invalidates the rendered clips.

## Health check

```http
GET /api/health?port=5000&host=localhost
```

Returns a basic health response.

## Docker

```bash
docker compose up --build
```

The app is exposed on `${PORT:-5000}` and listens on container port `5000`. Database and Kafka services are not started by the compose file and are disabled in the app.

The provided `Dockerfile` does not install ffmpeg. Add it to the image if you intend to run the voiceover or video steps inside the container.

## Project structure

```
src/
  index.js                 app entry point
  routes/                  route definitions
  controllers/             request/response handling
  services/                pipeline implementation
  validators/              Joi request validation
  prompts/                 LLM and TTS instructions
  utilities/               models, schemas, response helpers, logger
  middlewares/             Express middleware
config/default.json        server and service configuration
```

## Notes

- The pipeline is synchronous: long steps such as voiceover, images, and video rendering keep the HTTP request open until they finish.
- Each video is identified by its title, so two different videos with the same title share a workspace.
