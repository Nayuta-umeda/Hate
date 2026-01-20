(() => {
  "use strict";

  // UIにサーバ名は出さない（コード内のみ）
  const BASE_URL = "https://anim5s-server.onrender.com";
  const API_PREFIX = "/api/ijime";

  const LS = {
    userId: "ijime_user_id_v1",
    accept: "ijime_accept_v1",
    adminSession: "ijime_admin_session_v1",
    localDB: "ijime_local_db_v1",
    adminTab: "ijime_admin_tab_v1",
  };

  const NOTICE_TEXT = [
    "ここは、いじめの被害を「記録・共有」するための場です。",
    "特定の個人を晒す／貶める目的で使わないでください。",
    "実名・学校名・住所・連絡先・顔が分かる情報は書かないでください。",
    "画像/動画は「申請」→ 管理者確認後に反映されます。",
    "断定や私刑につながる表現は避けてください。"
  ].join("\n");

  const $ = (s)=>document.querySelector(s);
  const el = (tag, attrs={}, ...children) => {
    const n = document.createElement(tag);
    for(const [k,v] of Object.entries(attrs)){
      if(k === "class") n.className = v;
      else if(k === "text") n.textContent = v;
      else if(k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if(v !== null && v !== undefined) n.setAttribute(k, String(v));
    }
    for(const c of children){
      if(c === null || c === undefined) continue;
      if(typeof c === "string") n.appendChild(document.createTextNode(c));
      else n.appendChild(c);
    }
    return n;
  };

  const nowISO = () => new Date().toISOString();
  const fmt = (iso)=>{
    try{
      const d = new Date(iso);
      const y=d.getFullYear();
      const m=String(d.getMonth()+1).padStart(2,"0");
      const dd=String(d.getDate()).padStart(2,"0");
      const hh=String(d.getHours()).padStart(2,"0");
      const mm=String(d.getMinutes()).padStart(2,"0");
      return `${y}/${m}/${dd} ${hh}:${mm}`;
    }catch{ return String(iso||""); }
  };

  function uid(){
    const a = crypto.getRandomValues(new Uint8Array(10));
    return Array.from(a).map(x=>x.toString(16).padStart(2,"0")).join("");
  }

  function loadJSON(key, fallback){
    try{ const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch{ return fallback; }
  }
  function saveJSON(key, value){ localStorage.setItem(key, JSON.stringify(value)); }

  function getUserId(){
    let id = localStorage.getItem(LS.userId);
    if(!id){ id = "U"+uid(); localStorage.setItem(LS.userId, id); }
    return id;
  }

  function loadAccepted(){ return localStorage.getItem(LS.accept) === "1"; }
  function setAccepted(){ localStorage.setItem(LS.accept, "1"); }

  // modal shared
  function showModal({title, body, actions}){
    $("#modalTitle").textContent = title || "確認";
    const mb = $("#modalBody");
    mb.innerHTML = "";
    if(typeof body === "string"){
      mb.appendChild(el("pre", { style:"margin:0; white-space:pre-wrap; font-family:inherit; font-weight:900;" }, body));
    }else{
      mb.appendChild(body);
    }
    const ma = $("#modalActions");
    ma.innerHTML = "";
    for(const a of (actions||[])) ma.appendChild(a);
    $("#modalBack").classList.add("show");
  }
  function closeModal(){ $("#modalBack").classList.remove("show"); }
  window.__NOCT_MODAL__ = { showModal, closeModal, NOTICE_TEXT };

  $("#modalBack")?.addEventListener("click", (e)=>{ if(e.target === $("#modalBack")) closeModal(); });

  // PII check (light)
  function hasUrl(t){ const s=String(t||"").toLowerCase(); return s.includes("http://") || s.includes("https://"); }
  function hasEmail(t){
    const s=String(t||"");
    const at=s.indexOf("@");
    if(at<=0) return false;
    const dot=s.indexOf(".", at+2);
    return dot>at+1;
  }
  function hasPhone(t){
    const s=String(t||"");
    let run="";
    for(const ch of s){
      if(ch>="0" && ch<="9"){
        run += ch;
        if(run.length>12) run = run.slice(run.length-12);
        if(run.length>=10 && run[0]==="0") return true;
      }else{
        if(ch!=="-" && ch!==" " && ch!=="(" && ch!==")") run="";
      }
    }
    return false;
  }
  function detectPII(text){
    const hits=[];
    if(hasEmail(text)) hits.push("mail");
    if(hasPhone(text)) hits.push("phone");
    if(hasUrl(text)) hits.push("url");
    return hits;
  }

  // local fallback DB
  function localDB(){ return loadJSON(LS.localDB, { threads:[], attachments:[] }); }
  function saveLocalDB(db){ saveJSON(LS.localDB, db); }

  // api
  function withTimeout(promise, ms=9000){
    const c = new AbortController();
    const t = setTimeout(()=>c.abort("timeout"), ms);
    return Promise.race([ promise(c.signal).finally(()=>clearTimeout(t)) ]);
  }
  async function apiFetch(path, {method="GET", body=null, headers={}}={}){
    const url = BASE_URL + API_PREFIX + path;
    const res = await withTimeout((signal)=>fetch(url, {
      method,
      headers: { "Content-Type":"application/json", ...headers },
      body: body ? JSON.stringify(body) : null,
      signal,
      credentials: "omit",
    }));
    const text = await res.text();
    let json=null;
    try{ json = text ? JSON.parse(text) : null; }catch{ json = { raw:text }; }
    if(!res.ok){
      const msg = json?.error || json?.message || res.statusText || "request failed";
      throw new Error(msg);
    }
    return json;
  }
  async function ping(){
    try{ await apiFetch("/ping"); return true; }catch{ return false; }
  }

  function pvCount(events, ms){
    const now = Date.now();
    let c=0;
    for(const iso of events||[]){
      const t = Date.parse(iso);
      if(!Number.isFinite(t)) continue;
      if(now - t <= ms) c++;
    }
    return c;
  }

  // API wrappers
  async function listThreads(sort){
    const s = String(sort||"new");
    if(await ping()){
      const r = await apiFetch(`/threads?sort=${encodeURIComponent(s)}`);
      return r?.threads || [];
    }
    const db = localDB();
    const threads = db.threads.map(t=>{
      const pvDay = pvCount(t.viewEvents, 24*60*60*1000);
      const pvWeek = pvCount(t.viewEvents, 7*24*60*60*1000);
      const pvMonth = pvCount(t.viewEvents, 30*24*60*60*1000);
      return { ...t, pvDay, pvWeek, pvMonth, postCount: (t.posts||[]).length };
    });
    const key = s === "pv_day" ? "pvDay" : s === "pv_week" ? "pvWeek" : s === "pv_month" ? "pvMonth" : "updatedAt";
    threads.sort((a,b)=>{
      if(key === "updatedAt") return String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt));
      return (b[key]||0) - (a[key]||0) || String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt));
    });
    return threads;
  }

  async function createThread({title, body, tags, authorId}){
    if(await ping()){
      const r = await apiFetch("/threads", { method:"POST", body: { title, body, tags, authorId } });
      return r?.thread;
    }
    const db = localDB();
    const threadId = "T"+uid();
    const postId = "P"+uid();
    const ts = nowISO();
    const thread = {
      id: threadId,
      title: String(title||"").slice(0,80) || "(無題)",
      tags: (tags||[]).slice(0,12),
      creatorId: authorId,
      createdAt: ts,
      updatedAt: ts,
      viewEvents: [],
      posts: [{ id: postId, authorId, createdAt: ts, updatedAt: ts, body: String(body||""), attachments: [] }],
    };
    db.threads.push(thread);
    saveLocalDB(db);
    return { id: threadId, title: thread.title, tags: thread.tags, createdAt: ts, updatedAt: ts, postCount: 1, pvDay:0, pvWeek:0, pvMonth:0 };
  }

  async function openThread(threadId, viewerId){
    if(await ping()){
      const r = await apiFetch(`/threads/${encodeURIComponent(threadId)}?viewerId=${encodeURIComponent(viewerId||"")}`);
      return r?.thread;
    }
    const db = localDB();
    const t = db.threads.find(x=>x.id===threadId);
    if(!t) throw new Error("not found");
    return {
      id: t.id,
      title: t.title,
      tags: t.tags,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      posts: (t.posts||[]).map((p, idx)=>({
        id: p.id,
        no: idx+1,
        authorId: p.authorId,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        body: p.body,
        approvedAttachments: (p.attachments||[]).filter(a=>a.status==="approved").map(a=>({ id:a.id, file:a.file || a })),
        pendingMineCount: (p.attachments||[]).filter(a=>a.status==="pending" && a.requesterId===viewerId).length,
      })),
      pvDay: pvCount(t.viewEvents, 24*60*60*1000),
      pvWeek: pvCount(t.viewEvents, 7*24*60*60*1000),
      pvMonth: pvCount(t.viewEvents, 30*24*60*60*1000),
    };
  }

  async function recordView(threadId){
    if(await ping()){
      try{ await apiFetch(`/threads/${encodeURIComponent(threadId)}/view`, { method:"POST", body: {} }); }catch{}
      return;
    }
    const db = localDB();
    const t = db.threads.find(x=>x.id===threadId);
    if(t){
      t.viewEvents = t.viewEvents || [];
      t.viewEvents.push(nowISO());
      const cutoff = Date.now() - 31*24*60*60*1000;
      t.viewEvents = t.viewEvents.filter(iso=>{
        const tt = Date.parse(iso);
        return Number.isFinite(tt) && tt >= cutoff;
      });
      saveLocalDB(db);
    }
  }

  async function addPost(threadId, body, authorId){
    if(await ping()){
      const r = await apiFetch(`/threads/${encodeURIComponent(threadId)}/posts`, { method:"POST", body: { body, authorId } });
      return r?.post;
    }
    const db = localDB();
    const t = db.threads.find(x=>x.id===threadId);
    if(!t) throw new Error("not found");
    const ts = nowISO();
    const post = { id:"P"+uid(), authorId, createdAt: ts, updatedAt: ts, body: String(body||""), attachments: [] };
    t.posts = t.posts || [];
    t.posts.push(post);
    t.updatedAt = ts;
    saveLocalDB(db);
    return { id: post.id };
  }

  async function updateTags(threadId, tags){
    if(await ping()){
      const r = await apiFetch(`/threads/${encodeURIComponent(threadId)}/tags`, { method:"PATCH", body: { tags } });
      return r?.thread;
    }
    const db = localDB();
    const t = db.threads.find(x=>x.id===threadId);
    if(!t) throw new Error("not found");
    const set = new Set([...(t.tags||[]), ...(tags||[])]);
    t.tags = Array.from(set).slice(0,12);
    t.updatedAt = nowISO();
    saveLocalDB(db);
    return { id: t.id, tags: t.tags, updatedAt: t.updatedAt };
  }

  async function requestAttachment({threadId, postId, requesterId, file}){
    if(await ping()){
      const r = await apiFetch("/attachments/request", { method:"POST", body: { threadId, postId, requesterId, file } });
      return r?.attachment;
    }
    const db = localDB();
    const t = db.threads.find(x=>x.id===threadId);
    if(!t) throw new Error("not found");
    const p = (t.posts||[]).find(x=>x.id===postId);
    if(!p) throw new Error("not found");
    p.attachments = p.attachments || [];
    p.attachments.push({ id:"A"+uid(), requesterId, status:"pending", createdAt: nowISO(), file });
    saveLocalDB(db);
    return { id: p.attachments[p.attachments.length-1].id, status:"pending", createdAt: nowISO() };
  }

  // Admin wrappers
  function adminHeaders(token){ return token ? { "X-Admin-Token": token } : {}; }

  async function adminLogin(password){
    if(await ping()){
      const r = await apiFetch("/admin/login", { method:"POST", body: { password } });
      return r;
    }
    if(password === "admin") return { ok:true, name:"LOCAL_ADMIN", token:"local" };
    throw new Error("invalid");
  }

  async function adminListAttachments(status, token){
    if(await ping()){
      const r = await apiFetch(`/admin/attachments?status=${encodeURIComponent(status)}`, { headers: adminHeaders(token) });
      return r?.attachments || [];
    }
    const db = localDB();
    const out = [];
    for(const t of db.threads){
      for(const p of (t.posts||[])){
        for(const a of (p.attachments||[])){
          if(a.status === status){
            out.push({
              id: a.id,
              threadId: t.id,
              threadTitle: t.title,
              postId: p.id,
              requesterId: a.requesterId,
              status: a.status,
              createdAt: a.createdAt,
              file: a.file,
              note: a.note || "",
            });
          }
        }
      }
    }
    out.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
    return out;
  }

  async function adminReviewAttachment({attachmentId, action, note}, token){
    if(await ping()){
      const r = await apiFetch("/admin/attachments/review", { method:"POST", headers: adminHeaders(token), body: { attachmentId, action, note } });
      return r?.attachment;
    }
    const db = localDB();
    for(const t of db.threads){
      for(const p of (t.posts||[])){
        for(const a of (p.attachments||[])){
          if(a.id === attachmentId){
            a.status = (action === "approve") ? "approved" : "rejected";
            a.note = String(note||"").slice(0,800);
            a.reviewedAt = nowISO();
            saveLocalDB(db);
            return a;
          }
        }
      }
    }
    throw new Error("not found");
  }

  async function adminListThreads(token){
    if(await ping()){
      const r = await apiFetch("/admin/threads", { headers: adminHeaders(token) });
      return r?.threads || [];
    }
    const db = localDB();
    return db.threads.slice().sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));
  }

  // File helpers
  function readAsDataURL(file){
    return new Promise((resolve, reject)=>{
      const fr = new FileReader();
      fr.onload = ()=>resolve(String(fr.result||""));
      fr.onerror = ()=>reject(fr.error || new Error("read failed"));
      fr.readAsDataURL(file);
    });
  }
  function downloadDataUrl(dataUrl, filename){
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function viewMedia(file){
    const { showModal, closeModal } = window.__NOCT_MODAL__;
    let node=null;
    if(file.type?.startsWith("image/")){
      node = el("img", { src:file.dataUrl, style:"width:100%; border:1px solid rgba(255,255,255,.18); border-radius:12px;" });
    }else if(file.type?.startsWith("video/")){
      node = el("video", { src:file.dataUrl, controls:"controls", style:"width:100%; border:1px solid rgba(255,255,255,.18); border-radius:12px; background:#000;" });
    }else{
      node = el("div", { class:"notice" }, "");
    }
    showModal({ title: "PREVIEW", body: node, actions: [ el("button", { class:"btn gray", onclick: closeModal }, "閉じる") ] });
  }
  function fileRow(file){
    return el("div", { class:"fileRow" },
      el("div", {},
        el("div", { class:"name" }, file.name || "(file)"),
        el("div", { class:"info" }, `${Math.round((file.size||0)/1024)} KB / ${file.type||""}`)
      ),
      el("div", { class:"row right", style:"margin:0;" },
        el("button", { class:"btn small gray", onclick: ()=>viewMedia(file) }, "見る"),
        el("button", { class:"btn small", onclick: ()=>downloadDataUrl(file.dataUrl, file.name||"download") }, "DL")
      )
    );
  }

  // Shared header
  function mountHeader(active){
    const logo = $("#logo");
    const nav = $("#nav");
    if(logo) logo.textContent = "いじめ密告所";
    if(!nav) return;

    nav.innerHTML = "";
    const mk = (label, href)=> el("a", { href, class:"btn gray small", style:"text-decoration:none; display:inline-flex; align-items:center; justify-content:center;" }, label);

    if(active !== "index") nav.appendChild(mk("ロビー", "board.html"));
    nav.appendChild(mk("管理", "admin.html"));
  }

  // Pages
  async function pageIndex(){
    mountHeader("index");
    const root = $("#root");
    const cta = el("button", { class:"btn cta" }, "密告する");
    cta.addEventListener("click", ()=>{
      const { showModal, closeModal } = window.__NOCT_MODAL__;
      showModal({
        title: "注意",
        body: NOTICE_TEXT,
        actions: [
          el("button", { class:"btn gray", onclick: closeModal }, "戻る"),
          el("button", { class:"btn", onclick: ()=>{ closeModal(); setAccepted(); location.href = "board.html"; } }, "了承しました"),
        ]
      });
    });
    root.appendChild(el("div", { class:"home" }, el("h1", {}, "いじめ密告所"), cta));
  }

  function sortButtons(state, refresh){
    const mk = (label, value)=> el("button", {
      class: "btn tab small" + (state.sort === value ? " on" : ""),
      onclick: async ()=>{ state.sort=value; await refresh(); },
      disabled: state.busy
    }, label);
    return el("div", { class:"row" }, mk("新着","new"), mk("PV(日)","pv_day"), mk("PV(週)","pv_week"), mk("PV(月)","pv_month"));
  }

  function threadRowItem(t, idx, sort){
    const pv = sort === "pv_day" ? (t.pvDay||0) : sort === "pv_week" ? (t.pvWeek||0) : sort === "pv_month" ? (t.pvMonth||0) : null;
    const titleBtn = el("div", { class:"tTitle" }, t.title || "(無題)");
    titleBtn.addEventListener("click", async ()=>{
      await recordView(t.id);
      location.href = `thread.html?id=${encodeURIComponent(t.id)}`;
    });

    const tags = el("div", { class:"tags" });
    for(const tg of (t.tags||[])) tags.appendChild(el("button", { class:"tag" }, tg));

    const meta = el("div", { class:"tMeta" },
      el("span", {}, fmt(t.updatedAt||t.createdAt)),
      el("span", {}, `レス ${(t.postCount ?? (t.posts?.length||0))}`),
      pv !== null ? el("span", {}, `PV ${pv}`) : el("span", {}, `PV(月) ${(t.pvMonth||0)}`)
    );

    return el("div", { class:"threadRow" },
      el("div", { class:"tNo" }, String(idx+1)),
      el("div", { class:"tMain" }, titleBtn, meta, tags)
    );
  }

  async function pageBoard(){
    mountHeader("board");
    const accepted = loadAccepted();
    if(!accepted){
      location.href = "index.html";
      return;
    }

    const state = { busy:false, sort:"new", threads:[], userId:getUserId() };
    const root = $("#root");
    root.innerHTML = "";

    const left = el("div", { class:"card" }, el("div", { class:"title" }, "新スレ"));
    const right = el("div", { class:"card" }, el("div", { class:"title" }, "スレ一覧"));

    const title = el("input", { type:"text", placeholder:"タイトル", maxlength:"80" });
    const body  = el("textarea", { placeholder:"本文" });

    const tagInput = el("input", { type:"text", placeholder:"タグ", maxlength:"24" });
    const tagWrap = el("div", { class:"tags" });
    const tags = [];
    const renderTags = ()=>{
      tagWrap.innerHTML = "";
      for(const tg of tags){
        const b = el("button", { class:"tag rm" }, tg);
        b.addEventListener("click", ()=>{
          const i = tags.indexOf(tg);
          if(i>=0) tags.splice(i,1);
          renderTags();
        });
        tagWrap.appendChild(b);
      }
    };
    const addTag = el("button", { class:"btn small" }, "追加");
    addTag.addEventListener("click", ()=>{
      const v = String(tagInput.value||"").trim();
      if(!v) return;
      if(tags.includes(v)) { tagInput.value=""; return; }
      tags.push(v);
      tagInput.value="";
      renderTags();
    });

    const agree = el("input", { type:"checkbox", id:"agree_board" });
    const agreeRow = el("label", { for:"agree_board", style:"display:flex; gap:10px; align-items:center; margin-top:10px;" },
      agree, el("span", { style:"font-weight:900;" }, "個人情報なし")
    );

    const submit = el("button", { class:"btn" }, "立てる");
    const refreshBtn = el("button", { class:"btn gray" }, "更新");

    async function refresh(){
      state.busy = true;
      submit.disabled = true; refreshBtn.disabled = true;
      try{
        state.threads = await listThreads(state.sort);
      }catch{ state.threads = []; }
      renderList();
      state.busy = false;
      submit.disabled = false; refreshBtn.disabled = false;
    }

    function renderList(){
      right.innerHTML = "";
      right.appendChild(el("div", { class:"title" }, "スレ一覧"));
      right.appendChild(sortButtons(state, refresh));
      const list = el("div", { class:"threadList" });
      if(!state.threads.length){
        list.appendChild(el("div", { style:"padding:12px; color: rgba(255,255,255,.70); font-weight:900;" }, "なし"));
      }else{
        state.threads.forEach((t, idx)=> list.appendChild(threadRowItem(t, idx, state.sort)));
      }
      right.appendChild(el("div", { class:"sep" }));
      right.appendChild(list);
    }

    submit.addEventListener("click", async ()=>{
      const all = `${title.value}\n${body.value}`;
      const hits = detectPII(all);
      if(hits.length){
        const { showModal, closeModal } = window.__NOCT_MODAL__;
        showModal({ title:"NG", body:"個人情報の可能性", actions:[ el("button", { class:"btn gray", onclick: closeModal }, "戻る") ] });
        return;
      }
      if(!agree.checked){
        const { showModal, closeModal } = window.__NOCT_MODAL__;
        showModal({ title:"NG", body:"チェック必要", actions:[ el("button", { class:"btn gray", onclick: closeModal }, "OK") ] });
        return;
      }
      state.busy = true;
      submit.disabled = true; refreshBtn.disabled = true;
      try{
        const th = await createThread({ title: title.value, body: body.value, tags, authorId: state.userId });
        location.href = `thread.html?id=${encodeURIComponent(th.id)}`;
        return;
      }catch{}
      state.busy = false;
      submit.disabled = false; refreshBtn.disabled = false;
    });

    refreshBtn.addEventListener("click", refresh);

    left.appendChild(el("div", { class:"notice" }, "個人情報禁止 / 添付は申請"));
    left.appendChild(el("label", { text:"タイトル" }));
    left.appendChild(title);
    left.appendChild(el("label", { text:"本文" }));
    left.appendChild(body);
    left.appendChild(el("label", { text:"タグ" }));
    left.appendChild(el("div", { class:"row" }, tagInput, addTag));
    left.appendChild(tagWrap);
    left.appendChild(agreeRow);
    left.appendChild(el("div", { class:"row" }, submit, refreshBtn));

    root.appendChild(el("div", { class:"grid" }, left, right));
    await refresh();
  }

  function postView(p){
    const head = el("div", { class:"pHead" },
      el("div", { class:"pNo" }, `${p.no || ""}`),
      el("div", { style:"color: rgba(255,255,255,.70); font-weight:900; font-size:12px;" }, fmt(p.createdAt))
    );

    const meta = el("div", { class:"pMeta" },
      el("span", {}, `ID ${(p.authorId||"").slice(-6)}`),
      p.pendingMineCount ? el("span", {}, `添付申請 ${p.pendingMineCount}`) : el("span", {}, "")
    );

    const body = el("div", { class:"pBody" }, p.body || "");

    const files = el("div", { class:"fileList" });
    for(const a of (p.approvedAttachments||[])){
      const f = a.file || a;
      files.appendChild(fileRow({ name:f.name, type:f.type, size:f.size, dataUrl:f.dataUrl }));
    }

    return el("div", { class:"post" }, head, meta, body, (p.approvedAttachments?.length ? files : null));
  }

  async function pageThread(){
    mountHeader("thread");
    const accepted = loadAccepted();
    if(!accepted){
      location.href = "index.html";
      return;
    }
    const url = new URL(location.href);
    const threadId = url.searchParams.get("id") || "";
    if(!threadId){
      location.href = "board.html";
      return;
    }

    const state = { busy:false, userId:getUserId(), thread:null };
    const root = $("#root");
    root.innerHTML = "";

    const top = el("div", { class:"card" });
    const postsBox = el("div", { class:"card" });
    const form = el("div", { class:"card" });

    async function refreshThread(){
      state.busy = true;
      try{
        const t = await openThread(threadId, state.userId);
        state.thread = t;
      }catch{ state.thread = null; }
      renderThread();
      state.busy = false;
    }

    function renderThread(){
      root.innerHTML = "";
      const t = state.thread;
      if(!t){
        root.appendChild(el("div", { class:"card" }, el("div", { class:"title" }, "not found"), el("a", { href:"board.html", class:"btn gray small", style:"text-decoration:none;" }, "ロビー")));
        return;
      }

      top.innerHTML = "";
      top.appendChild(el("div", { class:"title" }, t.title || "(無題)"));

      // tag editor
      const tagLine = el("div", { class:"row" });
      const tagWrap = el("div", { class:"tags" });
      (t.tags||[]).forEach(x=>tagWrap.appendChild(el("button", { class:"tag" }, x)));
      const input = el("input", { type:"text", placeholder:"タグ", maxlength:"24", style:"max-width: 220px;" });
      const add = el("button", { class:"btn small" }, "追加");
      add.addEventListener("click", async ()=>{
        const v = String(input.value||"").trim();
        if(!v) return;
        state.busy = true;
        try{
          await updateTags(t.id, [v]);
        }catch{}
        state.busy = false;
        await refreshThread();
      });
      tagLine.appendChild(tagWrap);
      tagLine.appendChild(el("div", { style:"flex:1" }));
      tagLine.appendChild(input);
      tagLine.appendChild(add);
      top.appendChild(tagLine);

      postsBox.innerHTML = "";
      postsBox.appendChild(el("div", { class:"title" }, "レス"));
      const posts = el("div", { class:"posts" });
      (t.posts||[]).forEach((p, i)=> posts.appendChild(postView({ ...p, no: p.no || (i+1) })));
      postsBox.appendChild(posts);

      form.innerHTML = "";
      form.appendChild(el("div", { class:"title" }, "書き込み"));
      const body = el("textarea", { placeholder:"本文" });

      const fileInput = el("input", { type:"file", multiple:"multiple", accept:"image/*,video/*", style:"display:none" });
      const pickedList = el("div", { class:"fileList" });
      const picked = [];

      fileInput.addEventListener("change", async ()=>{
        pickedList.innerHTML = "";
        picked.length = 0;
        const arrF = Array.from(fileInput.files||[]);
        const maxFiles = 3;
        const maxMB = 18;
        for(const f of arrF.slice(0, maxFiles)){
          if(f.size > maxMB*1024*1024) continue;
          const dataUrl = await readAsDataURL(f);
          picked.push({ name:f.name, type:f.type, size:f.size, dataUrl });
        }
        for(const f of picked){
          pickedList.appendChild(el("div", { class:"fileRow" },
            el("div", {},
              el("div", { class:"name" }, f.name),
              el("div", { class:"info" }, `${Math.round(f.size/1024)} KB / ${f.type}`)
            )
          ));
        }
      });

      const attachBtn = el("button", { class:"btn small gray", onclick: ()=>{ fileInput.value=""; fileInput.click(); }, disabled: state.busy }, "画像/動画申請");

      const agree = el("input", { type:"checkbox", id:"agree_thread" });
      const agreeRow = el("label", { for:"agree_thread", style:"display:flex; gap:10px; align-items:center; margin-top:10px;" },
        agree,
        el("span", { style:"font-weight:900;" }, "個人情報なし")
      );

      const sendBtn = el("button", { class:"btn" }, "書き込む");
      sendBtn.addEventListener("click", async ()=>{
        const hits = detectPII(body.value);
        if(hits.length){
          const { showModal, closeModal } = window.__NOCT_MODAL__;
          showModal({ title:"NG", body:"個人情報の可能性", actions:[ el("button", { class:"btn gray", onclick: closeModal }, "戻る") ] });
          return;
        }
        if(!agree.checked){
          const { showModal, closeModal } = window.__NOCT_MODAL__;
          showModal({ title:"NG", body:"チェック必要", actions:[ el("button", { class:"btn gray", onclick: closeModal }, "OK") ] });
          return;
        }

        state.busy = true;
        sendBtn.disabled = true;
        try{
          const post = await addPost(t.id, body.value, state.userId);
          for(const f of picked){
            await requestAttachment({ threadId: t.id, postId: post.id, requesterId: state.userId, file: f });
          }
          body.value = "";
        }catch{}
        state.busy = false;
        sendBtn.disabled = false;
        await refreshThread();
      });

      form.appendChild(el("div", { class:"notice" }, "添付は申請 → 管理者確認"));
      form.appendChild(el("label", { text:"本文" }));
      form.appendChild(body);
      form.appendChild(fileInput);
      form.appendChild(el("div", { class:"row" }, attachBtn));
      form.appendChild(pickedList);
      form.appendChild(agreeRow);
      form.appendChild(el("div", { class:"row" },
        el("a", { href:"board.html", class:"btn gray", style:"text-decoration:none; display:inline-flex; align-items:center; justify-content:center;" }, "戻る"),
        sendBtn
      ));

      root.appendChild(el("div", { class:"grid" }, top, postsBox, form));
    }

    await refreshThread();
  }

  async function pageAdmin(){
    mountHeader("admin");
    const root = $("#root");
    root.innerHTML = "";

    const state = {
      busy:false,
      admin: loadJSON(LS.adminSession, { authed:false, token:"", name:"" }),
      attachments: [],
      threads: [],
      tab: loadJSON(LS.adminTab, { v:"pending" }).v || "pending",
    };

    const box = el("div", { class:"card" });
    box.appendChild(el("div", { class:"title" }, "管理"));

    async function refreshAdmin(){
      state.busy = true;
      try{
        if(state.tab === "threads"){
          state.threads = await adminListThreads(state.admin.token);
          state.attachments = [];
        }else{
          state.attachments = await adminListAttachments(state.tab, state.admin.token);
          state.threads = [];
        }
      }catch{
        state.attachments = [];
        state.threads = [];
      }
      state.busy = false;
      renderAdmin();
    }

    async function review(attachmentId, action, noteText){
      state.busy = true;
      renderAdmin();
      try{
        await adminReviewAttachment({ attachmentId, action, note: noteText }, state.admin.token);
      }catch{}
      state.busy = false;
      await refreshAdmin();
    }

    function tabs(){
      const mk = (label, value)=> el("button", {
        class:"btn tab small" + (state.tab===value ? " on":""),
        disabled: state.busy,
        onclick: async ()=>{
          state.tab = value;
          saveJSON(LS.adminTab, { v:value });
          await refreshAdmin();
        }
      }, label);

      return el("div", { class:"row" },
        mk("添付 未処理","pending"),
        mk("添付 承認","approved"),
        mk("添付 却下","rejected"),
        mk("スレ","threads"),
      );
    }

    function renderAdmin(){
      root.innerHTML = "";
      box.innerHTML = "";
      box.appendChild(el("div", { class:"title" }, "管理"));

      if(!state.admin.authed){
        const pw = el("input", { type:"password", placeholder:"password" });
        const login = el("button", { class:"btn", disabled: state.busy }, "ログイン");
        login.addEventListener("click", async ()=>{
          state.busy = true;
          renderAdmin();
          try{
            const r = await adminLogin(pw.value);
            state.admin = { authed:true, token:r?.token||"", name:r?.name||"ADMIN" };
            saveJSON(LS.adminSession, state.admin);
            await refreshAdmin();
            return;
          }catch{}
          state.busy = false;
          renderAdmin();
        });
        box.appendChild(pw);
        box.appendChild(el("div", { class:"row" },
          login,
          el("a", { href:"board.html", class:"btn gray", style:"text-decoration:none; display:inline-flex; align-items:center; justify-content:center;" }, "ロビー")
        ));
        root.appendChild(box);
        return;
      }

      const headRow = el("div", { class:"row" },
        el("a", { href:"board.html", class:"btn gray", style:"text-decoration:none; display:inline-flex; align-items:center; justify-content:center;" }, "ロビー"),
        el("button", { class:"btn gray", disabled: state.busy, onclick: refreshAdmin }, state.busy ? "..." : "更新"),
        el("button", { class:"btn gray", disabled: state.busy, onclick: ()=>{
          state.admin = { authed:false, token:"", name:"" };
          saveJSON(LS.adminSession, state.admin);
          renderAdmin();
        } }, "ログアウト"),
      );

      box.appendChild(headRow);
      box.appendChild(tabs());

      const list = el("div", { class:"posts" });

      if(state.tab === "threads"){
        for(const t of (state.threads||[])){
          list.appendChild(el("div", { class:"post" },
            el("div", { class:"pHead" },
              el("div", { class:"pNo" }, t.title || "(無題)"),
              el("div", { style:"color: rgba(255,255,255,.70); font-weight:900; font-size:12px;" }, fmt(t.updatedAt||t.createdAt))
            ),
            el("div", { class:"pMeta" },
              el("span", {}, `id ${t.id}`),
              el("span", {}, `creator ${t.creatorId||"-"}`),
              el("span", {}, `レス ${(t.posts?.length||0)}`)
            ),
            el("div", { class:"tags" }, ...(t.tags||[]).map(x=>el("button", { class:"tag" }, x)))
          ));
        }
      }else{
        for(const a of (state.attachments||[])){
          const f = a.file || {};
          const fileNode = (f.dataUrl && (f.type||"").startsWith("image/"))
            ? el("img", { src:f.dataUrl, style:"width:100%; max-height:320px; object-fit:contain; border:1px solid rgba(255,255,255,.18); border-radius:12px; background:#000; margin-top:10px;" })
            : (f.dataUrl && (f.type||"").startsWith("video/"))
            ? el("video", { src:f.dataUrl, controls:"controls", style:"width:100%; max-height:320px; border:1px solid rgba(255,255,255,.18); border-radius:12px; background:#000; margin-top:10px;" })
            : null;

          const note = el("textarea", { placeholder:"note" });
          note.value = a.note || "";

          const actions = el("div", { class:"row" });
          actions.appendChild(el("button", { class:"btn small gray", onclick: ()=>downloadDataUrl(f.dataUrl||"", f.name||"file") }, "DL"));

          if(a.status === "pending"){
            actions.appendChild(el("button", { class:"btn small", onclick: async ()=>{ await review(a.id, "reject", note.value); } }, "却下"));
            actions.appendChild(el("button", { class:"btn small", onclick: async ()=>{ await review(a.id, "approve", note.value); } }, "承認"));
          }

          list.appendChild(el("div", { class:"post" },
            el("div", { class:"pHead" },
              el("div", { class:"pNo" }, a.threadTitle || a.threadId || "(thread)"),
              el("div", { style:"color: rgba(255,255,255,.70); font-weight:900; font-size:12px;" }, fmt(a.createdAt))
            ),
            el("div", { class:"pMeta" },
              el("span", {}, `A ${a.id}`),
              el("span", {}, `T ${a.threadId}`),
              el("span", {}, `P ${a.postId}`),
              el("span", {}, `U ${a.requesterId}`),
              el("span", {}, `status ${a.status}`)
            ),
            el("div", { class:"pMeta" }, `${f.name||""}  ${Math.round((f.size||0)/1024)}KB  ${f.type||""}`),
            fileNode,
            el("label", { text:"note" }),
            note,
            actions
          ));
        }
      }

      box.appendChild(list);
      root.appendChild(box);
    }

    renderAdmin();
    await refreshAdmin();
  }

  function init(){
    const page = document.documentElement.dataset.page || "";
    if(page === "index") return pageIndex();
    if(page === "board") return pageBoard();
    if(page === "thread") return pageThread();
    if(page === "admin") return pageAdmin();
  }

  window.addEventListener("DOMContentLoaded", init);
})();
