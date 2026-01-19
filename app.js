(() => {
  "use strict";

  const $ = (q) => document.querySelector(q);

  const el = {
    status: $("#status"),
    posts: $("#posts"),
    mikokuBtn: $("#mikokuBtn"),
    refreshBtn: $("#refreshBtn"),
    compose: $("#compose"),
    closeComposeBtn: $("#closeComposeBtn"),
    name: $("#name"),
    mail: $("#mail"),
    body: $("#body"),
    sendBtn: $("#sendBtn"),
    cancelBtn: $("#cancelBtn"),
  };

  const state = {
    lastServerTime: 0,
    lastFetchAt: 0,
    pollMs: 2500,
    busy: false,
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    return (
      d.getFullYear() +
      "/" +
      pad2(d.getMonth() + 1) +
      "/" +
      pad2(d.getDate()) +
      " " +
      pad2(d.getHours()) +
      ":" +
      pad2(d.getMinutes()) +
      ":" +
      pad2(d.getSeconds())
    );
  }

  function setStatus(text) {
    el.status.textContent = text;
  }

  function openCompose() {
    el.compose.classList.add("show");
    el.closeComposeBtn.style.display = "inline-block";
    // focus body for quick writing
    setTimeout(() => el.body.focus(), 0);
  }

  function closeCompose() {
    el.compose.classList.remove("show");
    el.closeComposeBtn.style.display = "none";
  }

  function isComposeOpen() {
    return el.compose.classList.contains("show");
  }

  function renderPosts(posts) {
    // Replace entire list (simple, stable)
    const frag = document.createDocumentFragment();

    for (const p of posts) {
      const wrap = document.createElement("div");
      wrap.className = "post";

      const meta = document.createElement("div");
      meta.className = "meta";

      const name = p.name ? escapeHtml(p.name) : "名無しさん";
      const mail = p.mail ? escapeHtml(p.mail) : "";
      const time = fmtTime(p.ts);

      meta.innerHTML = `<b>${p.id}</b> ：${name}${mail ? " (" + mail + ")" : ""} ：${time}`;

      const body = document.createElement("div");
      body.className = "body";
      body.innerHTML = escapeHtml(p.body);

      wrap.appendChild(meta);
      wrap.appendChild(body);
      frag.appendChild(wrap);
    }

    el.posts.innerHTML = "";
    el.posts.appendChild(frag);
  }

  async function fetchPosts({ incremental } = { incremental: true }) {
    if (state.busy) return;
    state.busy = true;

    try {
      const since = incremental && state.lastServerTime ? `?since=${encodeURIComponent(state.lastServerTime)}` : "";
      const res = await fetch(`/api/posts${since}`, { cache: "no-store" });
      if (!res.ok) throw new Error("fetch_failed");
      const data = await res.json();
      if (!data.ok) throw new Error("bad_response");

      state.lastServerTime = data.serverTime || Date.now();
      state.lastFetchAt = Date.now();

      // If incremental, merge by re-fetching full only when needed.
      // Keep it simple: when incremental returns some posts, append; else keep.
      if (incremental && Array.isArray(data.posts) && data.posts.length) {
        // Append mode: create minimal append without re-rendering everything
        const prevCount = el.posts.querySelectorAll(".post").length;
        // If empty or mismatch, do full reload to keep consistent
        if (prevCount === 0) {
          await fetchPosts({ incremental: false });
        } else {
          appendPosts(data.posts);
        }
      } else if (!incremental) {
        renderPosts(Array.isArray(data.posts) ? data.posts : []);
      }

      setStatus(`最新取得：${fmtTime(state.lastFetchAt)}　/　投稿数：${el.posts.querySelectorAll(".post").length}`);
    } catch {
      setStatus("通信エラー。更新を押してね。");
    } finally {
      state.busy = false;
    }
  }

  function appendPosts(newPosts) {
    const frag = document.createDocumentFragment();
    for (const p of newPosts) {
      const wrap = document.createElement("div");
      wrap.className = "post";

      const meta = document.createElement("div");
      meta.className = "meta";

      const name = p.name ? escapeHtml(p.name) : "名無しさん";
      const mail = p.mail ? escapeHtml(p.mail) : "";
      const time = fmtTime(p.ts);

      meta.innerHTML = `<b>${p.id}</b> ：${name}${mail ? " (" + mail + ")" : ""} ：${time}`;

      const body = document.createElement("div");
      body.className = "body";
      body.innerHTML = escapeHtml(p.body);

      wrap.appendChild(meta);
      wrap.appendChild(body);
      frag.appendChild(wrap);
    }

    const wasAtBottom = el.posts.scrollTop + el.posts.clientHeight >= el.posts.scrollHeight - 24;
    el.posts.appendChild(frag);
    if (wasAtBottom) el.posts.scrollTop = el.posts.scrollHeight;
  }

  async function sendPost() {
    const name = (el.name.value || "").trim();
    const mail = (el.mail.value || "").trim();
    const body = (el.body.value || "").replace(/\r\n?/g, "\n").trim();

    if (!body) {
      setStatus("本文が空です。");
      el.body.focus();
      return;
    }

    if (state.busy) return;
    state.busy = true;

    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mail, body }),
      });

      if (res.status === 429) {
        setStatus("連投が速すぎます。少し待ってください。");
        return;
      }

      if (!res.ok) {
        setStatus("投稿できませんでした。");
        return;
      }

      const data = await res.json();
      if (!data.ok) {
        setStatus("投稿できませんでした。");
        return;
      }

      // Clear only body (2ch-like)
      el.body.value = "";
      closeCompose();
      setStatus("書き込み完了。更新します…");

      // Full reload to ensure ordering
      await fetchPosts({ incremental: false });
      // Scroll to bottom after posting
      el.posts.scrollTop = el.posts.scrollHeight;
    } catch {
      setStatus("通信エラー。もう一度。");
    } finally {
      state.busy = false;
    }
  }

  // ---- Events ----
  el.mikokuBtn.addEventListener("click", () => {
    if (isComposeOpen()) {
      closeCompose();
    } else {
      openCompose();
    }
  });

  el.closeComposeBtn.addEventListener("click", closeCompose);
  el.cancelBtn.addEventListener("click", closeCompose);

  el.refreshBtn.addEventListener("click", () => fetchPosts({ incremental: false }));
  el.sendBtn.addEventListener("click", sendPost);

  // Initial load + polling
  fetchPosts({ incremental: false });
  setInterval(() => {
    // Do not interrupt while composing; still poll in background
    fetchPosts({ incremental: true });
  }, state.pollMs);
})();
