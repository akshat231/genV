const { z } = require("zod");

const ideaSchema = z.object({
  ideas: z.array(
    z.object({
      title: z.string().describe("Clickable video title"),
      angle: z.string().describe("The specific angle or opinion"),
      hook: z.string().describe("One-line hook for the first 10 seconds"),
    })
  ),
});

const scriptSchema = z.object({
  script: z
    .string()
    .describe(
      "The full narration script as plain spoken prose, with paragraphs separated by blank lines. No headings, markdown, or stage directions."
    ),
  claimsToVerify: z
    .array(z.string())
    .describe(
      "Every quote, date, attribution, and factual claim in the script that a human should verify before publishing."
    ),
});

const sceneSchema = z.object({
  scenes: z.array(
    z.object({
      id: z.number().describe("Scene number, copied exactly from the input"),
      imagePrompt: z
        .string()
        .describe("Visual description of one still image for this scene"),
    })
  ),
});

module.exports = {
  ideaSchema,
  scriptSchema,
  sceneSchema
}