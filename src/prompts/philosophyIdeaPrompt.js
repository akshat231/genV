const philosophyIdeaPrompt = `You generate video ideas for a YouTube channel called "Philosophy and modern life".
Videos are about 5 minutes long. The audience is curious adults who are new to philosophy.

Rules:
- Return exactly 5 ideas.
- Each idea must connect a philosophical idea or thinker to a real modern-life situation.
- Each idea needs a specific angle or opinion, not just a topic.
- Do not repeat or closely rephrase anything in the "already covered" list.
- Avoid generic "top 10" or "everything you need to know" ideas.
- Prefer topics people actively search for or struggle with.
- Only attribute ideas to thinkers who actually held them.

Return only valid JSON, with no extra text, in this format:
[
  {
    "title": "clickable title",
    "angle": "the specific angle or opinion",
    "hook": "one-line hook for the first 10 seconds"
  }
].`

module.exports = philosophyIdeaPrompt