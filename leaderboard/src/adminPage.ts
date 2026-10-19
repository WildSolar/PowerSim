/**
 * The admin page (GET /admin): feedback from the game, newest first — each with its details, its
 * attached save to download (and load from the game's start screen), and buttons to mark it done or
 * delete it. The page holds no secret: it asks for the admin token, keeps it for the browser tab
 * only (sessionStorage), and sends it with each request to /admin/feedback… . Everything players
 * wrote is put on the page as text (textContent), never as HTML; a strict content security policy
 * with a per-request nonce allows only this page's own script and style.
 */

export function adminPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Commune Zéro — feedback</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; --ink: #1d1d1b; --ink2: #5b5a55; --line: #ddd9cf; --bg: #f4f2ec; --card: #fff; --accent: #d52b1e; --good: #2e7d4f; }
  @media (prefers-color-scheme: dark) { :root { --ink: #ecebe6; --ink2: #a9a7a0; --line: #3a3935; --bg: #1b1b19; --card: #252523; } }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.45 system-ui, sans-serif; color: var(--ink); background: var(--bg); }
  header { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid var(--line); background: var(--card); }
  h1 { margin: 0; font-size: 17px; }
  main { max-width: 960px; margin: 0 auto; padding: 16px; }
  button, input, select { font: inherit; }
  button { padding: 5px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: var(--ink); cursor: pointer; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .login { display: flex; gap: 8px; max-width: 520px; margin: 40px auto; }
  .login input { flex: 1; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: var(--ink); }
  .item { margin: 0 0 12px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); }
  .item.done { opacity: 0.6; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--ink2); }
  .kind { font-weight: 600; color: var(--ink); }
  .crash { color: var(--accent); font-weight: 600; }
  .message { margin: 8px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  details pre { margin: 6px 0 0; padding: 8px; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg); border-radius: 6px; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .note { color: var(--ink2); }
  .filters { display: flex; gap: 12px; align-items: center; }
</style>
</head>
<body>
<header>
  <h1>Commune Zéro — feedback</h1>
  <div class="filters">
    <label><input type="checkbox" id="show-done"> Show done</label>
    <button id="refresh">Refresh</button>
    <button id="logout">Forget the token</button>
  </div>
</header>
<main id="main"></main>
<script nonce="${nonce}">
(() => {
  const main = document.getElementById("main");
  const KEY = "cz-admin-token";
  const token = () => sessionStorage.getItem(KEY) || "";

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of children) if (c !== null && c !== undefined) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return e;
  }

  async function api(path, init) {
    const response = await fetch(path, { ...init, headers: { Authorization: "Bearer " + token(), ...((init && init.headers) || {}) } });
    if (response.status === 403) {
      sessionStorage.removeItem(KEY);
      login("That token didn't work.");
      throw new Error("forbidden");
    }
    if (!response.ok) throw new Error("The server said " + response.status);
    return response;
  }

  function login(message) {
    const input = el("input", { type: "password", placeholder: "Admin token", autocomplete: "off" });
    const go = () => { sessionStorage.setItem(KEY, input.value.trim()); load(); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    main.replaceChildren(el("div", { class: "login" }, input, el("button", { class: "primary", onclick: go }, "Open")), message ? el("p", { class: "note" }, message) : null);
    input.focus();
  }

  async function download(item) {
    const text = await (await api("/admin/feedback/" + item.id + "/save")).text();
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = el("a", { href: url, download: "commune-zero-feedback-" + item.id + ".txt" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function render(items) {
    const showDone = document.getElementById("show-done").checked;
    const shown = items.filter((i) => showDone || i.status !== "done");
    if (shown.length === 0) {
      main.replaceChildren(el("p", { class: "note" }, items.length === 0 ? "No feedback yet." : "Nothing new. (Tick ‘Show done’ for the rest.)"));
      return;
    }
    main.replaceChildren(
      ...shown.map((i) =>
        el(
          "article",
          { class: "item" + (i.status === "done" ? " done" : "") },
          el("div", { class: "meta" },
            el("span", { class: "kind" }, "#" + i.id + " · " + i.kind),
            i.crash ? el("span", { class: "crash" }, "crash") : null,
            el("span", {}, new Date(i.createdAt).toLocaleString("de-CH")),
            el("span", {}, "v" + i.version + " · " + i.build),
            i.hasSave ? el("span", {}, "game attached") : null,
          ),
          el("div", { class: "message" }, i.message || "(no message)"),
          el("details", {}, el("summary", {}, "Details"), el("pre", {}, i.details)),
          el("div", { class: "actions" },
            i.hasSave ? el("button", { onclick: () => download(i).catch(alert) }, "Download the game") : null,
            el("button", { onclick: () => api("/admin/feedback/" + i.id + "/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: i.status === "done" ? "new" : "done" }) }).then(load) }, i.status === "done" ? "Mark as new" : "Mark as done"),
            el("button", { onclick: () => { if (confirm("Delete #" + i.id + " and its game for good?")) api("/admin/feedback/" + i.id, { method: "DELETE" }).then(load); } }, "Delete"),
          ),
        ),
      ),
    );
  }

  let last = [];
  async function load() {
    if (!token()) return login();
    main.replaceChildren(el("p", { class: "note" }, "Loading…"));
    try {
      last = (await (await api("/admin/feedback?limit=200")).json()).items;
      render(last);
    } catch (e) {
      if (e.message !== "forbidden") main.replaceChildren(el("p", { class: "note" }, String(e.message || e)));
    }
  }

  document.getElementById("refresh").addEventListener("click", load);
  document.getElementById("show-done").addEventListener("change", () => render(last));
  document.getElementById("logout").addEventListener("click", () => { sessionStorage.removeItem(KEY); login(); });
  load();
})();
</script>
</body>
</html>`;
}
