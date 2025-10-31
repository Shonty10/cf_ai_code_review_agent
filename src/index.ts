// src/index.ts

export interface Env {
  AI: Ai; // native Workers AI binding
  CODE_REVIEW_AGENT: DurableObjectNamespace;
}

// ----- Durable Object (stateful memory + SQL) -----
export class CodeReviewAgent {
  constructor(private state: DurableObjectState, private env: Env) {
    // Ensure schema is ready before serving traffic
    this.state.blockConcurrencyWhile(async () => {
      await this.state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS reviews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT,
          language TEXT,
          feedback TEXT,
          ts INTEGER
        );
      `);
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // POST /review -> run LLM and store feedback
    if (url.pathname === "/review" && req.method === "POST") {
      const { code, language, context } = await req.json<any>();

      const prompt = `You are an expert code reviewer. Analyze this ${language} code and provide:
1) potential bugs, 2) performance improvements, 3) best-practice violations, 4) security concerns.
${context ? `Context:\n${context}\n` : ""}Code:\n\`\`\`${language}\n${code}\n\`\`\``;

      // Native binding: env.AI.run(model, payload)
      const result: any = await this.env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        { messages: [{ role: "user", content: prompt }] }
      );

      // Some SDKs return {response: "..."}; normalize to string
      const feedback =
        typeof result === "string"
          ? result
          : result?.response ?? JSON.stringify(result);

      // INSERT (unchanged, but add logging)
      await this.state.storage.sql.exec(
        `INSERT INTO reviews (code, language, feedback, ts) VALUES (?, ?, ?, ?)`,
        code,
        language,
        feedback,
        Date.now()
      );
      console.log("Inserted review for", language);

      return Response.json({ feedback });
    }

    // GET /history -> recent reviews (no code payloads)
    if (url.pathname === "/history") {
      // HISTORY (make the column name consistent + robust row extraction)
      const res = await this.state.storage.sql.exec(
        `SELECT id, language, ts AS timestamp FROM reviews
         ORDER BY ts DESC LIMIT 10`
      );
      const rows = (res as any).results ?? (res as any).rows ?? [];
      return Response.json({ history: rows });
    }

    // POST /suggestions -> synthesize patterns from past feedback
    if (url.pathname === "/suggestions" && req.method === "POST") {
      const { pattern } = await req.json<any>();

      const q = await this.state.storage.sql.exec(
        `SELECT feedback FROM reviews WHERE code LIKE ? LIMIT 5`,
        `%${pattern}%`
      );
      const rows = (q as any).rows ?? (q as any).results ?? [];
      if (!rows.length) return Response.json({ suggestions: null });

      const corpus = rows.map((r: any) => r.feedback).join("\n\n");
      const synth: any = await this.env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        {
          messages: [
            {
              role: "user",
              content:
                "From these past code reviews, list 3–5 recurring anti-patterns and the concrete fixes:\n" +
                corpus,
            },
          ],
        }
      );

      return Response.json({
        suggestions:
          typeof synth === "string" ? synth : synth?.response ?? synth,
      });
    }

    return new Response("Not found", { status: 404 });
  }
}

// ----- Worker: proxies to the Durable Object -----
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const id = env.CODE_REVIEW_AGENT.idFromName("default");
    const stub = env.CODE_REVIEW_AGENT.get(id);

    if (url.pathname === "/api/review" && request.method === "POST") {
      return stub.fetch(new Request(new URL("/review", "https://do/"), request));
    }
    if (url.pathname === "/api/history") {
      return stub.fetch(new Request(new URL("/history", "https://do/"), request));
    }
    if (url.pathname === "/api/suggestions" && request.method === "POST") {
      return stub.fetch(
        new Request(new URL("/suggestions", "https://do/"), request)
      );
    }

    // Minimal UI so you can test quickly (beautified version)
    return new Response(
`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>AI Code Review Assistant</title>
<style>
  :root{
    --bg:#0b0f14;
    --panel:#0f1621cc;
    --panel-strong:#121b28;
    --text:#e7eef7;
    --muted:#a3b1c6;
    --brand:#f38020;
    --brand-2:#ffb16f;
    --ok:#2ecc71;
    --warn:#f39c12;
    --err:#e74c3c;
    --border: #223145;
    --shadow: 0 10px 30px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.03);
    --radius: 14px;
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{
    margin:0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
    color:var(--text);
    background:
      radial-gradient(1200px 600px at 10% -10%, #1a2332 0%, rgba(26,35,50,0) 60%),
      radial-gradient(1000px 600px at 90% 10%, #1a2a40 0%, rgba(22,30,44,0) 60%),
      linear-gradient(180deg, #0a0e13, #0b0f14);
    min-height:100%;
  }
  .wrap{max-width:1100px;margin:40px auto;padding:24px}
  header{
    display:flex;align-items:center;gap:16px;margin-bottom:18px
  }
  .logo{
    width:42px;height:42px;display:grid;place-items:center;border-radius:12px;
    background: linear-gradient(135deg, var(--brand), var(--brand-2));
    box-shadow: var(--shadow);
    font-weight:800;color:#101010
  }
  h1{font-size:28px;margin:0}
  .sub{color:var(--muted);margin-top:4px}
  .grid{display:grid;gap:16px;grid-template-columns:1.25fr .75fr}
  @media (max-width: 980px){ .grid{grid-template-columns:1fr} }

  .card{
    background:var(--panel);
    border:1px solid var(--border);
    border-radius:var(--radius);
    box-shadow: var(--shadow);
  }
  .card .hd{
    padding:14px 16px;border-bottom:1px solid var(--border);
    display:flex;align-items:center;justify-content:space-between;gap:10px
  }
  .hd .title{font-weight:600}
  .card .bd{padding:16px}
  .controls{display:flex;flex-wrap:wrap;gap:10px}
  select, input[type="text"]{
    background:var(--panel-strong);color:var(--text);
    border:1px solid var(--border);border-radius:10px;padding:10px 12px;outline:none
  }
  .pill{display:flex;gap:10px;align-items:center}
  .pill label{color:var(--muted);font-size:13px}
  textarea{
    width:100%;min-height:260px;background:#0c121b;color:#eaf0f9;
    border:1px solid var(--border);border-radius:12px;padding:14px 14px 14px 16px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    line-height:1.5; resize:vertical
  }
  .ctx{min-height:90px}
  .btn{
    background: linear-gradient(135deg, var(--brand), var(--brand-2));
    color:#111; font-weight:700; border:0; border-radius:12px; padding:12px 16px;
    cursor:pointer; transition:transform .06s ease, box-shadow .2s ease;
    box-shadow: 0 6px 18px rgba(243,128,32,.25);
  }
  .btn:active{ transform: translateY(1px); }
  .btn.secondary{
    background:#162131;color:var(--text);border:1px solid var(--border);
    box-shadow:none;font-weight:600
  }
  .btn.ghost{background:transparent;border:1px solid var(--border);color:var(--muted)}
  .btn-row{display:flex;gap:10px;flex-wrap:wrap}
  .muted{color:var(--muted)}
  .feedback{
    background:#0c121b;border:1px solid var(--border);border-radius:12px;padding:14px;
    white-space:pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .two-col{display:grid;gap:12px;grid-template-columns:1fr 1fr}
  @media (max-width: 680px){ .two-col{grid-template-columns:1fr} }

  .history-item{
    padding:12px;border:1px solid var(--border);border-radius:10px;
    display:flex;justify-content:space-between;gap:8px;background:#0c121b;
  }
  .kbd{
    border:1px solid #2a3a50;border-bottom-width:3px;border-radius:8px;padding:2px 6px;
    background:#0c121b;color:#cfe2ff;font-family:ui-monospace,monospace;font-size:12px
  }
  .spinner{
    width:18px;height:18px;border:2px solid #3b4d66;border-top-color:#e6eefb;border-radius:50%;
    animation:spin 1s linear infinite
  }
  @keyframes spin{to{transform:rotate(360deg)}}
  .fade-in{animation:fade .2s ease-out}
  @keyframes fade{from{opacity:.3;transform:translateY(2px)} to{opacity:1;transform:none}}
  .right{display:flex;gap:8px;align-items:center}
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="logo">AI</div>
      <div>
        <h1>AI Code Review Assistant</h1>
        <div class="sub">Paste code → Get actionable review. <span class="muted">Tip: Press <span class="kbd">⌘/Ctrl + Enter</span> to Review.</span></div>
      </div>
    </header>

    <div class="grid">
      <!-- Left: Editor & Output -->
      <section class="card fade-in">
        <div class="hd">
          <div class="title">Editor</div>
          <div class="controls">
            <div class="pill">
              <label for="lang">Language</label>
              <select id="lang">
                <option>TypeScript</option><option>JavaScript</option><option>Python</option>
                <option>Go</option><option>Rust</option><option>Java</option><option>C++</option>
              </select>
            </div>
            <div class="pill">
              <label for="model">Model</label>
              <select id="model">
                <option value="@cf/meta/llama-3.3-70b-instruct-fp8-fast">Llama 3.3 70B (fast)</option>
              </select>
            </div>
          </div>
        </div>
        <div class="bd">
          <textarea id="code" spellcheck="false" placeholder="// Paste your code here..."></textarea>
          <div style="height:10px"></div>
          <div class="two-col">
            <textarea id="ctx" class="ctx" spellcheck="false" placeholder="(Optional) Context: project/module intent, expected behavior, constraints..."></textarea>
            <div class="btn-row" style="align-items:flex-start;justify-content:flex-start">
              <button class="btn" id="btnReview">Review Code</button>
              <button class="btn secondary" id="btnSuggest">Suggestions</button>
              <button class="btn ghost" id="btnCopy">Copy</button>
              <button class="btn ghost" id="btnDownload">Download</button>
            </div>
          </div>

          <div style="height:16px"></div>
          <div id="out" class="feedback" style="display:none"></div>
          <div id="loading" style="display:none;gap:10px;align-items:center" class="right">
            <div class="spinner"></div><span class="muted">Analyzing code...</span>
          </div>
        </div>
      </section>

      <!-- Right: History -->
      <aside class="card fade-in">
        <div class="hd">
          <div class="title">History</div>
          <div class="right">
            <button class="btn secondary" id="btnHistory">Refresh</button>
          </div>
        </div>
        <div class="bd" id="history">
          <div class="muted">No history yet. Run a review to see past items here.</div>
        </div>
      </aside>
    </div>
  </div>

<script>
const $ = (s)=>document.querySelector(s);
const host = location.origin;

function setLoading(v){
  $("#loading").style.display = v ? "flex" : "none";
  $("#out").style.display = v ? "none" : ($("#out").textContent ? "block" : "none");
}
function showOut(text){
  const out = $("#out");
  out.style.display = "block";
  out.textContent = text;
}

async function review(){
  const code = $("#code").value.trim();
  const language = $("#lang").value;
  const context = $("#ctx").value.trim();
  if(!code){ showOut("Please paste some code first."); return; }
  setLoading(true);
  try{
    const res = await fetch(host + "/api/review", {
      method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({ code, language, context })
    });
    const data = await res.json();
    showOut(data.feedback || JSON.stringify(data,null,2));
    await history(); // refresh panel
  }catch(e){
    showOut("Error: " + (e?.message || e));
  }finally{ setLoading(false); }
}

async function history(){
  const panel = $("#history");
  panel.innerHTML = '<div class="muted">Loading…</div>';
  try{
    const res = await fetch(host + "/api/history");
    const data = await res.json();
    const items = (data.history||[]);
    if(!items.length){ panel.innerHTML = '<div class="muted">No history yet.</div>'; return; }
    panel.innerHTML = items.map(r => {
      const when = new Date((r.timestamp ?? r.ts ?? r.time) || Date.now()).toLocaleString();
      const lang = r.language || "Unknown";
      return \`<div class="history-item">
        <div><strong>\${lang}</strong><div class="muted" style="font-size:12px">\${when}</div></div>
        <div></div>
      </div>\`;
    }).join("");
  }catch(e){
    panel.innerHTML = '<div class="muted">Failed to load history.</div>';
  }
}

async function suggestions(){
  const code = $("#code").value.trim();
  const out = $("#out");
  if(!code){ showOut("Run a review first or paste code to analyze patterns."); return; }
  setLoading(true);
  try{
    // simple heuristic: look for a function name/pattern to query against
    const match = code.match(/function\\s+([a-zA-Z0-9_]+)/) || code.match(/def\\s+([a-zA-Z0-9_]+)/);
    const pattern = match ? match[1] : code.slice(0,32);
    const res = await fetch(host + "/api/suggestions", {
      method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({ pattern })
    });
    const data = await res.json();
    const text = data.suggestions || "No suggestions found from history yet.";
    showOut(String(text));
  }catch(e){
    showOut("Error: " + (e?.message || e));
  }finally{ setLoading(false); }
}

async function copyOut(){
  const t = $("#out").textContent || "";
  if(!t){ return; }
  try{ await navigator.clipboard.writeText(t); flash("Copied to clipboard."); }
  catch{ flash("Copy failed."); }
}
function downloadOut(){
  const t = $("#out").textContent || "";
  if(!t){ return; }
  const blob = new Blob([t], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "code-review.md";
  document.body.appendChild(a); a.click(); a.remove();
}
function flash(msg){
  const n = document.createElement("div");
  n.textContent = msg;
  n.style.position="fixed"; n.style.right="16px"; n.style.bottom="16px";
  n.style.background="#162131"; n.style.border="1px solid #223145";
  n.style.padding="10px 12px"; n.style.borderRadius="10px"; n.style.color="#cfe2ff";
  n.style.boxShadow="var(--shadow)"; n.style.zIndex="9999";
  document.body.appendChild(n); setTimeout(()=>n.remove(), 1800);
}

// Events
$("#btnReview").addEventListener("click", review);
$("#btnHistory").addEventListener("click", history);
$("#btnSuggest").addEventListener("click", suggestions);
$("#btnCopy").addEventListener("click", copyOut);
$("#btnDownload").addEventListener("click", downloadOut);
document.addEventListener("keydown", (e)=>{
  if((e.metaKey || e.ctrlKey) && e.key === "Enter"){ review(); }
});

// Initial load
history();
</script>
</body>
</html>`,
      { headers: { "content-type": "text/html;charset=utf-8" } }
    );
  },
};
