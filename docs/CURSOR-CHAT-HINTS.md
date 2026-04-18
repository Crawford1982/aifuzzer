# Using Cursor chat next to this tool

You do **not** need a separate “chat engine” app for day-to-day use:

1. Open this folder in Cursor.
2. In chat, paste **what your program allows** (from HackerOne policy) and ask: “Given this scope, what **exact https URL** should I paste into Mythos?”
3. Copy the URL into `npm start` → Target prompt, or pass `--target`.

The fuzzer only understands **real URLs** (or the built-in `sprint2:` / `sprint3:` shortcuts). Wildcards like `*.sprint…` name a policy scope, not a host to connect to.
