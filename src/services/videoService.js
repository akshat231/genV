const OpenAI = require("openai");
const { createReadStream } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util")
const logger = require('../utilities/logger')
const { getModel } = require('../utilities/model')
const schemas = require('../utilities/schemas')
const prompts = require('../prompts')

require('dotenv').config();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


const generateScript = async (title, angle, hook) => {
    try {

        logger.info(`Topic of video is: ${title}\n with angle: ${angle}\n and hook: ${hook}`);
        const scriptMessages = [
            {
                role: 'system',
                content: `${prompts.scriptPrompt}`,
            },
            {
                role: 'user',
                content: `Here is title: ${title} and angle is: ${angle} and hook for the video is ${hook}`,
            },
        ];

        const scriptModel = await getModel(process.env.SCRIPT_MODEL);

        if (!scriptModel) {
            throw new Error('Failed to initialize Ideas model');
        }
        const structuredScriptModel = scriptModel.withStructuredOutput(schemas.scriptSchema);

        const result = await structuredScriptModel.invoke(scriptMessages);
        return { message: "Script is generated", data: result };
    } catch (error) {
        throw error;
    }
}

const getVideoIdeas = async () => {
    try {
        logger.info('Generating Video Idea for a short');
        const ideaModel = await getModel(process.env.IDEA_MODEL);

        if (!ideaModel) {
            throw new Error('Failed to initialize Ideas model');
        }
        const structuredIdeaModel = ideaModel.withStructuredOutput(schemas.ideaSchema)

        const result = await structuredIdeaModel.invoke(prompts.philosophyIdeaPrompt);

        return { messages: "Ideas Generated", data: result };
    } catch (error) {
        throw error;
    }
}

const slugify = (title) => {
    const slug = title
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60)
        .replace(/-+$/g, "");

    return slug || "video-" + crypto.createHash("sha1").update(title).digest("hex").slice(0, 8);
};

const getVoiceover = async (script, title) => {
    try {
        const parentDir = process.env.VOICEOVER_PARENT_DIRECTORY;
        const model = process.env.VOICEOVER_MODEL;
        const voice = process.env.VOICE_TEXTURE;
        const openai = new OpenAI({
            apiKey: process.env.CHAT_API_KEY
        });

        if (!parentDir || !model || !voice) {
            throw new Error("Set VOICEOVER_PARENT_DIRECTORY, VOICEOVER_MODEL and VOICE_TEXTURE");
        }

        const paragraphs = script.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
        if (paragraphs.length === 0) throw new Error("Script is empty");

        const run = promisify(execFile);
        const outDir = path.resolve(parentDir, slugify(title));
        await fs.mkdir(outDir, { recursive: true });

        logger.info(`Generating voiceover for "${title}" (${paragraphs.length} paragraphs, model: ${model}, voice: ${voice})`);
        logger.info(`Output directory: ${outDir}`);

        const hash = crypto
            .createHash("sha1")
            .update(JSON.stringify({ script, voice, model, instructions: prompts.voiceoverPrompt }))
            .digest("hex");
        const hashFile = path.join(outDir, "settings.hash");
        const oldHash = await fs.readFile(hashFile, "utf8").catch(() => null);

        if (oldHash && oldHash !== hash) {
            logger.info("Script or voice settings changed, clearing old audio parts");
            const existing = await fs.readdir(outDir);
            await Promise.all(
                existing
                    .filter((f) => /^part-\d+\.mp3$/.test(f))
                    .map((f) => fs.rm(path.join(outDir, f)))
            );
        }
        await fs.writeFile(hashFile, hash);

        const files = [];
        for (const [i, text] of paragraphs.entries()) {
            const file = path.join(outDir, `part-${String(i).padStart(2, "0")}.mp3`);

            try {
                await fs.access(file);
                logger.info(`Part ${i + 1}/${paragraphs.length} already exists, skipping`);
            } catch {
                logger.info(`Generating part ${i + 1}/${paragraphs.length} (${text.length} chars)`);
                const res = await openai.audio.speech.create({
                    model,
                    voice,
                    input: text,
                    instructions: prompts.voiceoverPrompt,
                    response_format: "mp3",
                });
                const tmp = `${file}.tmp`;
                await fs.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
                await fs.rename(tmp, file);
            }
            files.push(file);
        }

        const listFile = path.join(outDir, "list.txt");
        await fs.writeFile(
            listFile,
            files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n")
        );

        logger.info("Joining audio parts with ffmpeg");
        const out = path.join(outDir, "voiceover.mp3");
        await run("ffmpeg", [
            "-y", "-f", "concat", "-safe", "0", "-i", listFile,
            "-c:a", "libmp3lame", "-q:a", "2", out,
        ]);

        const { stdout } = await run("ffprobe", [
            "-v", "error", "-show_entries", "format=duration",
            "-of", "csv=p=0", out,
        ]);
        const durationSec = parseFloat(stdout);

        logger.info(`Voiceover ready: ${out} (${durationSec.toFixed(1)}s)`);

        return {
            message: "Voiceover generated",
            data: { file: out, durationSec },
        };
    } catch (error) {
        logger.error(`Voiceover failed for "${title}": ${error.message}`);
        throw error;
    }
};

const normalize = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const splitSentences = (script) => {
    const flat = script.replace(/\s+/g, " ").trim();
    const matches = flat.match(/[^.!?]+[.!?]+["'”’)]*|[^.!?]+$/g) || [];
    return matches.map((s) => s.trim()).filter(Boolean);
};

// Matches each script sentence to a run of transcribed words.
// Word counts can differ slightly, so the last word of each sentence
// is used to correct any drift.
const alignSentences = (sentences, words) => {
    const out = [];
    let cursor = 0;

    sentences.forEach((text, i) => {
        const tokens = text.split(/\s+/).map(normalize).filter(Boolean);
        if (!tokens.length || cursor >= words.length) return;

        const isLast = i === sentences.length - 1;
        let end = isLast
            ? words.length - 1
            : Math.min(cursor + tokens.length - 1, words.length - 1);

        if (!isLast) {
            const lastToken = tokens[tokens.length - 1];
            let best = end;
            let bestDist = Infinity;
            const from = Math.max(cursor, end - 4);
            const to = Math.min(words.length - 1, end + 4);
            for (let j = from; j <= to; j++) {
                const dist = Math.abs(j - end);
                if (words[j].norm === lastToken && dist < bestDist) {
                    best = j;
                    bestDist = dist;
                }
            }
            end = best;
        }

        out.push({
            index: out.length,
            text,
            start: words[cursor].start,
            end: words[end].end,
        });
        cursor = end + 1;
    });

    return out;
};

const getTimestamps = async (script, title) => {
    try {
        const parentDir = process.env.VOICEOVER_PARENT_DIRECTORY;
        const model = process.env.TRANSCRIPTION_MODEL;
        const openai = new OpenAI({
            apiKey: process.env.CHAT_API_KEY
        });
        if (!parentDir) throw new Error("Set VOICEOVER_PARENT_DIRECTORY");

        const dir = path.resolve(parentDir, slugify(title));
        const audioFile = path.join(dir, "voiceover.mp3");
        const rawFile = path.join(dir, "transcription.json");
        const outFile = path.join(dir, "timestamps.json");

        await fs.access(audioFile).catch(() => {
            throw new Error(`voiceover.mp3 not found in ${dir}. Generate the voiceover first.`);
        });

        // reuse the raw transcription unless the audio is newer
        let transcription = null;
        const [audioStat, rawStat] = await Promise.all([
            fs.stat(audioFile),
            fs.stat(rawFile).catch(() => null),
        ]);
        if (rawStat && rawStat.mtimeMs > audioStat.mtimeMs) {
            logger.info("Reusing saved transcription");
            transcription = JSON.parse(await fs.readFile(rawFile, "utf8"));
        } else {
            logger.info(`Transcribing voiceover with ${model}`);
            transcription = await openai.audio.transcriptions.create({
                file: createReadStream(audioFile),
                model,
                response_format: "verbose_json",
                timestamp_granularities: ["word"],
                language: "en",
            });
            await fs.writeFile(rawFile, JSON.stringify(transcription, null, 2));
        }

        if (!Array.isArray(transcription.words) || transcription.words.length === 0) {
            throw new Error("Transcription returned no word timestamps");
        }

        const words = transcription.words
            .map((w) => ({ word: w.word.trim(), start: w.start, end: w.end, norm: normalize(w.word) }))
            .filter((w) => w.norm);

        const sentences = splitSentences(script);
        const scriptWordCount = sentences.join(" ").split(/\s+/).map(normalize).filter(Boolean).length;
        const diff = Math.abs(scriptWordCount - words.length) / scriptWordCount;
        if (diff > 0.05) {
            logger.info(`Warning: script has ${scriptWordCount} words but transcript has ${words.length}; check timing`);
        }

        const aligned = alignSentences(sentences, words);
        if (aligned.length === 0) throw new Error("Could not align script to audio");

        // no gaps at the start or end of the video
        const durationSec = transcription.duration;
        aligned[0].start = 0;
        aligned[aligned.length - 1].end = durationSec;

        const result = {
            durationSec,
            sentences: aligned,
            words: words.map(({ word, start, end }) => ({ word, start, end })),
        };
        await fs.writeFile(outFile, JSON.stringify(result, null, 2));

        logger.info(`Timestamps ready: ${aligned.length} sentences, ${durationSec.toFixed(1)}s (${outFile})`);

        return { message: "Timestamps generated", data: { file: outFile, ...result } };
    } catch (error) {
        logger.error(`Timestamps failed for "${title}": ${error.message}`);
        throw error;
    }
};

// Merges consecutive sentences into scenes of roughly min..max seconds.
const groupIntoScenes = (sentences, { min = 4, target = 6, max = 8 } = {}) => {
    const groups = [];
    let cur = [];
    const span = (g) => g[g.length - 1].end - g[0].start;

    for (const s of sentences) {
        if (cur.length) {
            const closeNow =
                span(cur) >= min && (s.end - cur[0].start > max || span(cur) >= target);
            if (closeNow) {
                groups.push(cur);
                cur = [];
            }
        }
        cur.push(s);
    }
    if (cur.length) groups.push(cur);

    // fold a very short last scene into the previous one
    if (groups.length > 1 && span(groups[groups.length - 1]) < min * 0.6) {
        groups[groups.length - 2].push(...groups.pop());
    }
    return groups;
};


const getScenes = async (title) => {
    try {
        const parentDir = process.env.VOICEOVER_PARENT_DIRECTORY;
        if (!parentDir) throw new Error("Set VOICEOVER_PARENT_DIRECTORY");

        const dir = path.resolve(parentDir, slugify(title));
        const tsFile = path.join(dir, "timestamps.json");
        const outFile = path.join(dir, "scenes.json");

        const tsStat = await fs.stat(tsFile).catch(() => {
            throw new Error(`timestamps.json not found in ${dir}. Run the timestamps step first.`);
        });

        // reuse the saved plan unless the timestamps are newer
        const outStat = await fs.stat(outFile).catch(() => null);
        if (outStat && outStat.mtimeMs > tsStat.mtimeMs) {
            logger.info("Reusing saved scene plan");
            const saved = JSON.parse(await fs.readFile(outFile, "utf8"));
            return { message: "Scene plan loaded", data: { file: outFile, ...saved } };
        }

        const { durationSec, sentences } = JSON.parse(await fs.readFile(tsFile, "utf8"));

        const groups = groupIntoScenes(sentences);
        const scenes = groups.map((g, i) => {
            const start = g[0].start;
            const end = i < groups.length - 1 ? groups[i + 1][0].start : durationSec;
            return {
                id: i + 1,
                start,
                end,
                durationSec: Number((end - start).toFixed(2)),
                narration: g.map((s) => s.text).join(" "),
            };
        });

        const durations = scenes.map((s) => s.durationSec);
        logger.info(
            `Grouped ${sentences.length} sentences into ${scenes.length} scenes ` +
            `(${Math.min(...durations).toFixed(1)}s to ${Math.max(...durations).toFixed(1)}s)`
        );

        const sceneModel = await getModel(process.env.SCENE_MODEL);
        const structuredSceneModel = sceneModel.withStructuredOutput(schemas.sceneSchema);

        const sceneMessages = [
            {
                role: "system",
                content: prompts.scenePrompt
            },
            {
                role: "user",
                content: `Video title: ${title}\n
                Scenes: ${scenes
                        .map((s) =>
                            `[${s.id}] (${s.durationSec.toFixed(1)}s) ${s.narration}`)
                        .join("\n")}`
            }
        ]

        let plan = null;
        for (let attempt = 1; attempt <= 3 && !plan; attempt++) {
            logger.info(`Generating image prompts (attempt ${attempt})`);
            const result = await structuredSceneModel.invoke(sceneMessages);

            const valid =
                result.scenes.length === scenes.length &&
                scenes.every(
                    (s, i) =>
                        result.scenes[i].id === s.id &&
                        result.scenes[i].imagePrompt.trim().length > 10
                );

            if (valid) plan = result.scenes;
            else logger.info("Scene plan did not match the scenes, retrying");
        }
        if (!plan) throw new Error("Model did not return a valid scene plan after 3 attempts");

        const finalScenes = scenes.map((s, i) => ({
            ...s,
            imagePrompt: plan[i].imagePrompt.trim(),
        }));

        const output = { durationSec, scenes: finalScenes };
        await fs.writeFile(outFile, JSON.stringify(output, null, 2));
        logger.info(`Scene plan ready: ${finalScenes.length} scenes (${outFile})`);

        return { message: "Scene plan generated", data: { file: outFile, ...output } };
    } catch (error) {
        logger.error(`Scene plan failed for "${title}": ${error.message}`);
        throw error;
    }
}


// runs worker(item) over all items, with at most `limit` running at once
const runPool = async (items, limit, worker) => {
    let next = 0;
    const runners = Array.from(
        { length: Math.min(limit, items.length) },
        async () => {
            while (next < items.length) {
                const item = items[next++];
                await worker(item);
            }
        }
    );
    await Promise.all(runners);
};

const generateImage = async (prompt, { model, size, quality, format }) => {
    const maxAttempts = 3;
    const openai = new OpenAI({
        apiKey: process.env.CHAT_API_KEY
    });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const res = await openai.images.generate({
                model,
                prompt,
                size,
                quality,
                n: 1,
                output_format: format,
            });
            const b64 = res.data?.[0]?.b64_json;
            if (!b64) throw new Error("No image data returned");
            return Buffer.from(b64, "base64");
        } catch (error) {
            // 4xx errors (other than 429) mean the request itself is bad or blocked, so retrying won't help
            const retryable = !error.status || error.status === 429 || error.status >= 500;
            if (!retryable || attempt === maxAttempts) throw error;
            const wait = 2000 * 2 ** (attempt - 1) + Math.random() * 500;
            logger.info(
                `Image request failed (${error.status || error.message}), retrying in ${Math.round(wait / 1000)}s`
            );
            await sleep(wait);
        }
    }
};


const getImages = async (title, { onlyIds } = {}) => {
    try {
        const parentDir = process.env.VOICEOVER_PARENT_DIRECTORY;
        const model = process.env.IMAGE_MODEL;
        if (!parentDir || !model) throw new Error("Set VOICEOVER_PARENT_DIRECTORY and IMAGE_MODEL");

        const size = process.env.IMAGE_SIZE || "1536x1024";
        const quality = process.env.IMAGE_QUALITY || "medium";
        const format = process.env.IMAGE_FORMAT || "jpeg";
        const concurrency = Number(process.env.IMAGE_CONCURRENCY) || 4;

        const dir = path.resolve(parentDir, slugify(title));
        const scenesFile = path.join(dir, "scenes.json");
        const imagesDir = path.join(dir, "images");
        const manifestFile = path.join(imagesDir, "manifest.json");

        const raw = await fs.readFile(scenesFile, "utf8").catch(() => {
            throw new Error(`scenes.json not found in ${dir}. Run the scene plan step first.`);
        });
        const { scenes } = JSON.parse(raw);

        await fs.mkdir(imagesDir, { recursive: true });
        const manifest = JSON.parse(
            await fs.readFile(manifestFile, "utf8").catch(() => "{}")
        );

        const fileFor = (scene) =>
            path.join(imagesDir, `scene-${String(scene.id).padStart(3, "0")}.${format === "jpeg" ? "jpg" : format}`);

        const hashFor = (scene) =>
            crypto
                .createHash("sha1")
                .update(JSON.stringify({ prompt: scene.imagePrompt, style: prompts.imagePrompt, model, size, quality, format }))
                .digest("hex");

        const ids = (onlyIds || []).map(Number);
        const selected = ids.length ? scenes.filter((s) => ids.includes(s.id)) : scenes;

        // only generate scenes whose image is missing or whose prompt/style/settings changed
        const todo = [];
        for (const scene of selected) {
            const exists = await fs.access(fileFor(scene)).then(() => true).catch(() => false);
            if (exists && manifest[scene.id] === hashFor(scene)) continue;
            todo.push(scene);
        }

        logger.info(
            `Images for "${title}": ${todo.length} to generate, ${selected.length - todo.length} already done ` +
            `(model: ${model}, size: ${size}, quality: ${quality}, concurrency: ${concurrency})`
        );

        const failures = [];
        let done = 0;

        try {
            await runPool(todo, concurrency, async (scene) => {
                try {
                    const imageMessage = `${scene.imagePrompt}\n\n STYLE: ${prompts.imagePrompt}`;
                    const buffer = await generateImage(imageMessage, { model, size, quality, format });

                    const file = fileFor(scene);
                    await fs.writeFile(`${file}.tmp`, buffer);
                    await fs.rename(`${file}.tmp`, file);

                    manifest[scene.id] = hashFor(scene);
                    done++;
                    logger.info(`Image ${done}/${todo.length} done (scene ${scene.id})`);
                } catch (error) {
                    logger.error(`Scene ${scene.id} failed: ${error.message}`);
                    failures.push(scene.id);
                }
            });
        } finally {
            // keep progress even if something failed
            await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2));
        }

        if (failures.length) {
            throw new Error(
                `${failures.length} image(s) failed (scenes ${failures.sort((a, b) => a - b).join(", ")}). Run again to retry only those.`
            );
        }

        const images = scenes.map((s) => ({
            id: s.id,
            start: s.start,
            end: s.end,
            durationSec: s.durationSec,
            file: fileFor(s),
        }));

        logger.info(`Images ready in ${imagesDir}`);
        return {
            message: "Images generated",
            data: { dir: imagesDir, generated: todo.length, images },
        };
    } catch (error) {
        logger.error(`Image generation failed for "${title}": ${error.message}`);
        throw error;
    }
};


const motionFilter = (id, frames) => {
    const N = frames;
    const cx = "iw/2-(iw/zoom/2)";
    const cy = "ih/2-(ih/zoom/2)";
    const motions = [
        { z: `1+0.12*on/${N}`, x: cx, y: cy },
        { z: `1.12-0.12*on/${N}`, x: cx, y: cy },
        { z: "1.12", x: `(iw-iw/zoom)*on/${N}`, y: cy },
        { z: "1.12", x: `(iw-iw/zoom)*(1-on/${N})`, y: cy },
    ];
    const m = motions[id % motions.length];
    return `zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${N}:s=${process.env.VIDEO_WIDTH}x${process.env.VIDEO_HEIGHT}:fps=${process.env.VIDEO_FPS}`;
};

const renderClip = async (run, { image, out, frames, id }) => {
    const vf = [
        `crop=iw:trunc(iw*${process.env.VIDEO_HEIGHT}/${process.env.VIDEO_WIDTH}/2)*2`, // centre-crop to 16:9
        `scale=${process.env.VIDEO_WIDTH * 2}:${process.env.VIDEO_HEIGHT * 2}:flags=lanczos`, // upscale first so the zoom stays smooth
        motionFilter(id, frames),
        "setsar=1",
        "format=yuv420p",
    ].join(",");

    const tmp = `${out}.tmp.mp4`;
    await run("ffmpeg", [
        "-y", "-loglevel", "error",
        "-i", image,
        "-vf", vf,
        "-frames:v", String(frames),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-r", String(process.env.VIDEO_FPS), "-pix_fmt", "yuv420p",
        tmp,
    ]);
    await fs.rename(tmp, out);
};

const srtTime = (sec) => {
    const ms = Math.max(0, Math.round(sec * 1000));
    const pad = (n, w = 2) => String(n).padStart(w, "0");
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(
        Math.floor(ms / 1000) % 60
    )},${pad(ms % 1000, 3)}`;
};

// splits each sentence into short caption chunks and shares the sentence's time between them
const buildSrt = (sentences, maxWords = 7) => {
    const cues = [];
    for (const s of sentences) {
        const words = s.text.split(/\s+/).filter(Boolean);
        if (!words.length) continue;

        const chunkCount = Math.ceil(words.length / maxWords);
        const size = Math.ceil(words.length / chunkCount);
        const chunks = [];
        for (let i = 0; i < words.length; i += size) {
            chunks.push(words.slice(i, i + size).join(" "));
        }

        const totalChars = chunks.reduce((a, c) => a + c.length, 0);
        let t = s.start;
        for (const c of chunks) {
            const d = ((s.end - s.start) * c.length) / totalChars;
            cues.push({ start: t, end: t + d, text: c });
            t += d;
        }
    }
    return cues
        .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
        .join("\n");
};


const getVideo = async (title, { captions = true } = {}) => {
    try {
        const parentDir = process.env.VOICEOVER_PARENT_DIRECTORY;
        if (!parentDir) throw new Error("Set VOICEOVER_PARENT_DIRECTORY");

        const run = promisify(execFile);
        const dir = path.resolve(parentDir, slugify(title));
        const scenesFile = path.join(dir, "scenes.json");
        const tsFile = path.join(dir, "timestamps.json");
        const audioFile = path.join(dir, "voiceover.mp3");
        const imagesDir = path.join(dir, "images");
        const clipsDir = path.join(dir, "clips");

        for (const f of [scenesFile, tsFile, audioFile]) {
            await fs.access(f).catch(() => {
                throw new Error(`${path.basename(f)} not found in ${dir}. Run the earlier steps first.`);
            });
        }

        const { durationSec, scenes } = JSON.parse(await fs.readFile(scenesFile, "utf8"));
        const { sentences } = JSON.parse(await fs.readFile(tsFile, "utf8"));

        // find each scene's image by its id, whatever the file extension is
        const imageFiles = new Map();
        for (const f of await fs.readdir(imagesDir).catch(() => [])) {
            const m = f.match(/^scene-(\d+)\.(jpg|jpeg|png|webp)$/);
            if (m) imageFiles.set(Number(m[1]), path.join(imagesDir, f));
        }
        const missing = scenes.filter((s) => !imageFiles.has(s.id)).map((s) => s.id);
        if (missing.length) {
            throw new Error(`Missing images for scenes: ${missing.join(", ")}. Run the image step first.`);
        }

        // work in whole frames so the clips and fades line up exactly
        const n = scenes.length;
        const F = process.env.VIDEO_FADE_SEC > 0 && n > 1 ? 2 * Math.round((process.env.VIDEO_FADE_SEC * process.env.VIDEO_FPS) / 2) : 0;
        const h = F / 2;
        const totalFrames = Math.round(durationSec * process.env.VIDEO_FPS);
        const b = scenes.map((s, i) => (i === 0 ? 0 : Math.round(s.start * process.env.VIDEO_FPS)));
        b.push(totalFrames);

        const plan = scenes.map((scene, i) => {
            const startF = b[i] - (i > 0 ? h : 0);
            const endF = b[i + 1] + (i < n - 1 ? h : 0);
            return { scene, frames: endF - startF };
        });
        if (plan.some((p) => p.frames <= F)) {
            throw new Error("A scene is shorter than the crossfade. Lower VIDEO_FADE_SEC or merge scenes.");
        }

        // 1. render one clip per scene (skips clips that are already up to date)
        await fs.mkdir(clipsDir, { recursive: true });
        const manifestFile = path.join(clipsDir, "manifest.json");
        const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8").catch(() => "{}"));

        const todo = [];
        for (const p of plan) {
            p.image = imageFiles.get(p.scene.id);
            p.file = path.join(clipsDir, `scene-${String(p.scene.id).padStart(3, "0")}.mp4`);
            const st = await fs.stat(p.image);
            const videoWidth = process.env.VIDEO_WIDTH;
            const videoHeight = process.env.VIDEO_HEIGHT;
            const videoFPS = process.env.VIDEO_FPS
            p.hash = crypto
                .createHash("sha1")
                .update(JSON.stringify({ size: st.size, mtime: st.mtimeMs, frames: p.frames, id: p.scene.id, videoWidth, videoHeight, videoFPS }))
                .digest("hex");
            const exists = await fs.access(p.file).then(() => true).catch(() => false);
            if (!(exists && manifest[p.scene.id] === p.hash)) todo.push(p);
        }

        logger.info(`Video for "${title}": rendering ${todo.length} clips, ${n - todo.length} already done`);

        const failures = [];
        let done = 0;
        try {
            await runPool(todo, Number(process.env.CLIP_CONCURRENCY) || 3, async (p) => {
                try {
                    await renderClip(run, { image: p.image, out: p.file, frames: p.frames, id: p.scene.id });
                    manifest[p.scene.id] = p.hash;
                    done++;
                    logger.info(`Clip ${done}/${todo.length} done (scene ${p.scene.id})`);
                } catch (error) {
                    logger.error(`Clip for scene ${p.scene.id} failed: ${error.stderr || error.message}`);
                    failures.push(p.scene.id);
                }
            });
        } finally {
            await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2));
        }
        if (failures.length) {
            throw new Error(`Clips failed for scenes ${failures.sort((a, c) => a - c).join(", ")}. Run again to retry only those.`);
        }

        // 2. captions
        if (captions) {
            await fs.writeFile(path.join(dir, "captions.srt"), buildSrt(sentences));
        }

        // 3. join clips with crossfades, add audio and captions
        const inputs = plan.flatMap((p) => ["-i", p.file]);
        const parts = [];
        let last;

        if (F > 0) {
            let prev = "[0:v]";
            for (let j = 1; j < n; j++) {
                const out = `[x${j}]`;
                const offset = ((b[j] - h) / process.env.VIDEO_FPS - 0.001).toFixed(3);
                parts.push(`${prev}[${j}:v]xfade=transition=fade:duration=${(F / process.env.VIDEO_FPS).toFixed(3)}:offset=${offset}${out}`);
                prev = out;
            }
            last = prev;
        } else {
            parts.push(`${plan.map((_, i) => `[${i}:v]`).join("")}concat=n=${n}:v=1:a=0[xall]`);
            last = "[xall]";
        }

        parts.push(
            captions
                ? `${last}subtitles=captions.srt:force_style='${process.env.VIDEO_CAPTION_STYLE}'[vout]`
                : `${last}null[vout]`
        );

        const finalFile = path.join(dir, "final.mp4");
        const tmpFile = path.join(dir, "final.tmp.mp4");

        logger.info("Joining clips with audio (this takes a few minutes)");
        const started = Date.now();
        await run(
            "ffmpeg",
            [
                "-y", "-loglevel", "error",
                ...inputs,
                "-i", audioFile,
                "-filter_complex", parts.join(";"),
                "-map", "[vout]", "-map", `${n}:a`,
                "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                "-pix_fmt", "yuv420p", "-r", String(process.env.VIDEO_FPS),
                "-c:a", "aac", "-b:a", "192k",
                "-movflags", "+faststart",
                tmpFile,
            ],
            { cwd: dir, maxBuffer: 20 * 1024 * 1024 } // cwd lets the subtitles filter use a plain relative path
        );
        await fs.rename(tmpFile, finalFile);

        const { stdout } = await run("ffprobe", [
            "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", finalFile,
        ]);
        const finalDuration = parseFloat(stdout);

        logger.info(
            `Video ready: ${finalFile} (${finalDuration.toFixed(1)}s, audio ${durationSec.toFixed(1)}s, ` +
            `${Math.round((Date.now() - started) / 1000)}s to join)`
        );

        return {
            message: "Video generated",
            data: { file: finalFile, durationSec: finalDuration, clips: n },
        };
    } catch (error) {
        logger.error(`Video failed for "${title}": ${error.stderr || error.message}`);
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