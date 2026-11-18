# FormSense

A voice copilot in your browser that explains any form field, out loud, with official sources. Click a field, ask "what is this asking for?", and FormSense tells you.

**Status:** work in progress.

- Done: a Chrome side panel you can talk to, and a one-click launcher (`start-web.bat`).
- Done: the copilot reads the form you're on and explains the field you clicked. It works on a local practice form at `localhost:3000/practice`. See [extension/README.md](extension/README.md).
- Next: official sources for answers, and highlighting fields on the page.

Built on the [AssemblyAI + Parallel voice starter](https://github.com/hsingh-aai/assemblyai-parallel-voice-agent). The starter's original README follows.

---

# AssemblyAI + Parallel voice starter

Talk to a voice agent in your terminal. AssemblyAI handles speech and replies. Parallel’s hosted MCP server gives the agent three tools: Search finds evidence, Fetch reads a particular public page, and Decisions estimates a probability or chooses among supplied options. The first conversation only needs an AssemblyAI key. [Parallel MCP](https://docs.parallel.ai/integrations/mcp/quickstart)

## Run it

Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then open a terminal:

```sh
git clone https://github.com/hsingh-aai/assemblyai-parallel-voice-agent.git
cd assemblyai-parallel-voice-agent
uv sync --frozen
```

Copy `.env.example` to `.env.local`. Set `ASSEMBLYAI_API_KEY` with your [AssemblyAI key](https://www.assemblyai.com/dashboard). Leave `PARALLEL_API_KEY` empty for free, rate-limited MCP access.

```sh
uv run python src/agent.py console --log-level info
```

Allow microphone access and wait for the greeting. To type instead, add `--text` to the command. Press Ctrl+C to quit.

### Hit the free-tier rate limit?

1. Press Ctrl+C to stop the agent. Get a key from the [Parallel dashboard](https://platform.parallel.ai).
2. Open the existing `.env.local` in the repo folder. Find `PARALLEL_API_KEY=`, paste your key after the equals sign, and save the file.
3. Run the same console command again and repeat your question. On startup, the agent picks up your key and uses your Parallel account for Search, Fetch, and Decisions. No code changes are needed.

## Try the three tools

1. **Search:** “What changed in the latest stable Python release?” The agent can answer directly from search excerpts.
2. **Fetch:** “Read the release notes you just cited. What do they say about upgrading?” The follow-up identifies a specific page. You can also paste a public URL in text mode.
3. **Decisions:** “How likely is it that Python 3.13 offers a free-threaded build? Give me a probability.” Decisions gathers its own evidence and estimates how likely the claim is to be true.

Watch the tool names in the terminal. The agent chooses when to call each one. Fetch is for a specific page or a missing detail, so a search that already answers the question needs only one call.

## Make it yours

Both Search and Decisions are already connected. Start with a pair of questions about the same subject. “Does Python 3.13 support free threading?” is a factual lookup. “Classify that support as stable, experimental, or explicitly unsupported” asks for a decision against supplied options. [See the prompt and tool input for this example](docs/decision-prompts.md).

Try a library compatibility assistant. Set `AGENT_GREETING="Which library are you working with?"` in `.env.local`. Add “Prefer official release notes and package metadata” to `INSTRUCTIONS` in [src/agent.py](src/agent.py). Restart and try similar questions about a library you use.

**Standalone API example.** To call Parallel directly from your own app, set `PARALLEL_API_KEY` with a [Parallel key](https://platform.parallel.ai). [parallel_api.py](src/parallel_api.py) has the two API calls and only needs `parallel-web`. [try_parallel.py](scripts/try_parallel.py) shows how to use them.

[Setup help](docs/advanced.md#troubleshooting) · [Browser and deployment options](docs/advanced.md#browser-or-room)
