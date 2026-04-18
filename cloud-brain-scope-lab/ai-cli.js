#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseDotEnv(content) {
  const env = {};
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ .env file not found. Create one with: OPENROUTER_API_KEY=your_key');
    process.exit(1);
  }

  const envContent = fs.readFileSync(envPath, 'utf-8');
  const env = parseDotEnv(envContent);
  const apiKey = env.OPENROUTER_API_KEY;

  if (!apiKey) {
    console.error('❌ OPENROUTER_API_KEY not found in .env');
    process.exit(1);
  }

  return apiKey;
}

const models = {
  qwen3: {
    id: 'qwen/qwen3-coder:free',
    name: 'Qwen3 Coder 480B',
    cost: 'FREE (best coding)',
    context: '262K',
  },
  'gemma4-31': {
    id: 'google/gemma-4-31b-it',
    name: 'Gemma 4 31B',
    cost: 'FREE',
    context: '256K',
  },
  'gemma4-26': {
    id: 'google/gemma-4-26b-a4b-it',
    name: 'Gemma 4 26B MoE',
    cost: 'FREE (fastest)',
    context: '256K',
  },
  'deepseek-r1': {
    id: 'deepseek/deepseek-r1:free',
    name: 'DeepSeek R1',
    cost: 'FREE (reasoning)',
    context: '64K',
  },
  kimi: {
    id: 'moonshotai/kimi-k2.5',
    name: 'Kimi K2.5',
    cost: '$0.38/$1.72 per M tokens',
    context: '256K',
  },
};

function printUsageAndExit() {
  console.log('Usage: ai [--model MODEL] [--no-stream] "your message"');
  console.log('\nAvailable models:');
  Object.entries(models).forEach(([key, cfg]) => {
    console.log(`  --model ${key.padEnd(12)} ${cfg.name.padEnd(20)} ${cfg.cost}`);
  });
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let model = 'qwen3';
  let message = '';
  let streaming = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' || args[i] === '-m') {
      model = args[i + 1];
      i++;
    } else if (args[i] === '--no-stream') {
      streaming = false;
    } else if (args[i] === '--help' || args[i] === '-h') {
      printUsageAndExit();
    } else {
      message += (message ? ' ' : '') + args[i];
    }
  }

  if (!message) {
    printUsageAndExit();
  }

  return { model, message, streaming };
}

async function callOpenRouter(apiKey, modelConfig, message, streaming = true) {
  const url = 'https://openrouter.ai/api/v1/chat/completions';

  const body = {
    model: modelConfig.id,
    messages: [{ role: 'user', content: message }],
    stream: streaming,
    max_tokens: 1024,
    temperature: 0.7,
    top_p: 0.9,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://localhost',
        'X-Title': 'AI CLI',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ API Error: ${response.status}`);
      console.error(error);
      process.exit(1);
    }

    if (streaming) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      console.log('');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content;
            if (content) process.stdout.write(content);
          } catch (_err) {
            // Ignore occasional partial/invalid chunks.
          }
        }
      }

      console.log('\n');
      return;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '(No response content)';
    console.log('\n' + content + '\n');
  } catch (error) {
    console.error('❌ Request failed:', error.message);
    process.exit(1);
  }
}

async function main() {
  if (typeof fetch !== 'function') {
    console.error(
      '❌ This script requires Node.js 18+ (global fetch is missing). Please upgrade Node.'
    );
    process.exit(1);
  }

  const apiKey = loadEnv();
  const { model, message, streaming } = parseArgs();

  const modelConfig = models[model];
  if (!modelConfig) {
    console.error(`❌ Unknown model: ${model}`);
    console.error(`Available: ${Object.keys(models).join(', ')}`);
    process.exit(1);
  }

  console.log(`🚀 Using ${modelConfig.name} (${modelConfig.cost})`);
  console.log(`📝 Question: ${message.slice(0, 100)}${message.length > 100 ? '...' : ''}`);

  await callOpenRouter(apiKey, modelConfig, message, streaming);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
