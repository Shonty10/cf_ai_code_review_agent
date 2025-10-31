🤖 AI Code Review Assistant

An AI-powered code review agent running entirely on Cloudflare’s global edge network.
Paste code → Get structured review → Automatically stored in history → Retrieve insights later.

🚀 Live Demo

https://code-review-agent.shaunaksaxena.workers.dev/

✨ Features

Real-time reviews using Workers AI (Llama 3.3 70B FP8 Fast)

Detects:

❗ Potential bugs

⚡ Performance issues

📦 Best-practice violations

🔐 Security concerns

Persistent review history using Durable Objects + SQLite

Works globally at the edge, no servers to manage

Supports multiple programming languages

🏗 Architecture Overview

Browser UI
│
│ POST /api/review
▼
Cloudflare Worker (router)
│
│ forwards request
▼
Durable Object (stateful agent)
│
├─ Calls Workers AI (LLM inference)
├─ Stores review history in SQLite
└─ Returns structured feedback

Key Components
Component	Technology
Compute	Cloudflare Workers (TypeScript)
AI Model	@cf/meta/llama-3.3-70b-instruct-fp8-fast
State & Memory	Durable Object + Built-in SQLite
Frontend	HTML / CSS / JavaScript (served by the Worker)
🧠 API Endpoints
1) Run a Code Review

curl -X POST https://code-review-agent.shaunaksaxena.workers.dev/api/review

-H "content-type: application/json"
-d '{"language":"Python","code":"def f(x): return x==x"}'

2) Get Review History

curl https://code-review-agent.shaunaksaxena.workers.dev/api/history

🛠 Local Development

npm install
npx wrangler dev

Then open:
http://localhost:8787

🚀 Deployment

npx wrangler deploy

📚 What I Learned

How to build stateful AI agents on Cloudflare using Durable Objects

Performing LLM inference at the edge with Workers AI

Managing persistent memory using SQLite-backed DOs

Deploying globally distributed, low-latency applications without servers
