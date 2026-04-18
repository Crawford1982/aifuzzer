# AI CLI Setup (OpenRouter)

## 1) Requirements

- Node.js 18 or newer (`node -v`)
- A `.env` file in this project root containing:

```env
OPENROUTER_API_KEY=sk-or-v1-your-key
```

## 2) Test directly

Run from this folder:

```powershell
node .\ai-cli.js --no-stream "what is stoicism"
```

If that works, streaming mode also works:

```powershell
node .\ai-cli.js "explain closures in javascript"
```

## 3) Optional PowerShell shortcut (`ai`)

Add this function to your PowerShell profile:

```powershell
function ai { node "C:\Users\Admin\Desktop\cloud brain\ai-cli.js" @args }
```

Then reload profile:

```powershell
. $PROFILE
```

Now you can run:

```powershell
ai --model qwen3 "refactor this function"
```

## Models

- `qwen3` - Qwen3 Coder 480B (free, coding)
- `gemma4-31` - Gemma 4 31B (free)
- `gemma4-26` - Gemma 4 26B MoE (free, faster)
- `deepseek-r1` - DeepSeek R1 (free reasoning)
- `kimi` - Kimi K2.5 (paid)

## Troubleshooting

- `.env file not found`: run the command in this folder.
- `OPENROUTER_API_KEY not found`: verify exact key name in `.env`.
- `API Error: 401`: key is invalid or revoked.
- `requires Node.js 18+`: upgrade Node.
