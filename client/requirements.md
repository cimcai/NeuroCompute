## Packages
@mlc-ai/web-llm | required for local LLM inference
framer-motion | required for smooth stat counter animations and UI transitions
lucide-react | required for icons (should be installed but adding to be safe)
clsx | required for className merging (should be installed)
tailwind-merge | required for className merging (should be installed)

## Notes
- Needs WebGL/WebGPU support in the browser for WebLLM to run efficiently.
- WebSocket connects to the current host's `/ws` endpoint.
- WebLLM downloads model weights on first run; this is expected and can take a few minutes depending on the connection. The UI handles the progress callback.
