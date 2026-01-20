(() => {
  "use strict";
  const APP_VERSION = "v1.0.7";
  const BASE_URL = ""; // 例: "https://your-server.example.com"
  const API_PREFIX = "/api/diary";

  const LS = { userId:"tkn_user_id_v1", liked:"tkn_liked_v1", adminSession:"tkn_admin_session_v1" };

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

  function uid(){
    const a = crypto.getRandomValues(new Uint8Array(10));
    return Array.from(a).map(x=>x.toString(16).padStart(2,"0")).join("");
  }
  function loadJSON(key, fallback){
    try{ const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }catch{ return fallback; }
  }
  function saveJSON(key, value){ localStorage.setItem(key, JSON.stringify(value)); }

  function logLine(_msg){}

  function getUserId(){
    let id = localStorage.getItem(LS.userId);
    if(!id){ id = "U"+uid(); localStorage.setItem(LS.userId, id); }
    return id;
  }
  function likedSet(){ const s = loadJSON(LS.liked, {}); return (s && typeof s === "object") ? s : {}; }
  function setLiked(threadId){ const s = likedSet(); s[threadId]=1; saveJSON(LS.liked, s); }
  function isLiked(threadId){ const s = likedSet(); return !!s[threadId]; }

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

  function showModal({title, body, actions}){
    const back = $("#modalBack");
    if(back) back.style.display = "flex";
    $("#modalTitle").textContent = title || "";
    const mb = $("#modalBody");
    mb.innerHTML = "";
    if(typeof body === "string"){
      mb.appendChild(el("pre", { style:"margin:0; white-space:pre-wrap; font-family:inherit; font-weight:900;" }, body));
    }else if(body){
      mb.appendChild(body);
    }
    const ma = $("#modalActions");
    ma.innerHTML = "";
    for(const a of (actions||[])) ma.appendChild(a);
    $("#modalBack").classList.add("show");
  }
  function closeModal(){ const back = $("#modalBack"); if(back){ back.classList.remove("show"); back.style.display = "none"; } }
  $("#modalBack")?.addEventListener("click", (e)=>{ if(e.target === $("#modalBack")) closeModal(); });

  const GUARD = {
    post: "個人情報/誹謗中傷/無断転載 禁止\n投稿=同意",
    media: "個人情報/第三者の無断撮影 禁止\n申請=同意",
    verify: "本人確認画像 送信\n送信=同意",
  };

  function confirmGuard(text, onOk){
    logLine("GUARD");
    showModal({
      title: "確認",
      body: text,
      actions: [
        el("button", { class:"btn gray", onclick: closeModal }, "戻る"),
        el("button", { class:"btn", onclick: ()=>{ closeModal(); try{ onOk && onOk(); }catch{} } }, "了承"),
      ]
    });
  }

  function apiUrl(path){ return (BASE_URL || "") + API_PREFIX + path; }
  async function apiFetch(path, {method="GET", body=null, headers={}}={}){
    const res = await fetch(apiUrl(path), {
      method,
      headers: { "Content-Type":"application/json", ...headers },
      body: body ? JSON.stringify(body) : null,
      credentials: "omit",
    });
    const text = await res.text();
    let json=null;
    try{ json = text ? JSON.parse(text) : null; }catch{ json = { raw:text }; }
    if(!res.ok){
      const msg = json?.error || json?.message || res.statusText || "error";
      throw new Error(msg);
    }
    return json;
  }

  async function listThreads(sort){
    const s = String(sort||"new");
    const r = await apiFetch(`/threads?sort=${encodeURIComponent(s)}`);
    return r?.threads || [];
  }
  async function createThread({title, body, tags, authorId}){
    const r = await apiFetch("/threads", { method:"POST", body: { title, body, tags, authorId } });
    return r?.thread;
  }
  async function openThread(threadId, viewerId){
    const r = await apiFetch(`/threads/${encodeURIComponent(threadId)}?viewerId=${encodeURIComponent(viewerId||"")}`);
    return r?.thread;
  }
  async function addPost(threadId, body, authorId){
    const r = await apiFetch(`/threads/${encodeURIComponent(threadId)}/posts`, { method:"POST", body: { body, authorId } });
    return r?.post;
  }
  async function updateTags(threadId, tags){
    const r = await apiFetch(`/threads/${encodeURIComponent(threadId)}/tags`, { method:"PATCH", body: { tags } });
    return r?.thread;
  }
  async function likeThread(threadId, userId){
    const r = await apiFetch(`/threads/${encodeURIComponent(threadId)}/like`, { method:"POST", body: { userId } });
    return r;
  }
  async function verifyStatus(userId){
    const r = await apiFetch(`/users/${encodeURIComponent(userId)}/verify`);
    return !!r?.verified;
  }
  async function requestVerify({userId, file}){
    const r = await apiFetch(`/verify/request`, { method:"POST", body: { userId, file } });
    return r;
  }
  async function requestAttachment({threadId, postId, requesterId, file}){
    const r = await apiFetch("/attachments/request", { method:"POST", body: { threadId, postId, requesterId, file } });
    return r;
  }

  function adminHeaders(token){ return token ? { "X-Admin-Token": token } : {}; }
  async function adminLogin(password){
    const r = await apiFetch("/admin/login", { method:"POST", body: { password } });
    return r;
  }
  async function adminListVerify(status, token){
    const r = await apiFetch(`/admin/verify?status=${encodeURIComponent(status)}`, { headers: adminHeaders(token) });
    return r?.requests || [];
  }
  async function adminReviewVerify({requestId, action, note}, token){
    const r = await apiFetch(`/admin/verify/review`, { method:"POST", headers: adminHeaders(token), body: { requestId, action, note } });
    return r;
  }
  async function adminListAttachments(status, token){
    const r = await apiFetch(`/admin/attachments?status=${encodeURIComponent(status)}`, { headers: adminHeaders(token) });
    return r?.attachments || [];
  }
  async function adminReviewAttachment({attachmentId, action, note}, token){
    const r = await apiFetch(`/admin/attachments/review`, { method:"POST", headers: adminHeaders(token), body: { attachmentId, action, note } });
    return r;
  }
  async function adminListThreads(token){
    const r = await apiFetch(`/admin/threads`, { headers: adminHeaders(token) });
    return r?.threads || [];
  }
  async function adminHideThread({threadId, hide}, token){
    const r = await apiFetch(`/admin/thread/hide`, { method:"POST", headers: adminHeaders(token), body: { threadId, hide } });
    return r;
  }
  async function adminDeleteThread({threadId}, token){
    const r = await apiFetch(`/admin/thread/delete`, { method:"POST", headers: adminHeaders(token), body: { threadId } });
    return r;
  }
  async function adminDeletePost({threadId, postId}, token){
    const r = await apiFetch(`/admin/post/delete`, { method:"POST", headers: adminHeaders(token), body: { threadId, postId } });
    return r;
  }

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
    let node=null;
    if(file.type?.startsWith("image/")){
      node = el("img", { src:file.dataUrl, style:"width:100%; border:1px solid rgba(255,255,255,.18); border-radius:12px;" });
    }else if(file.type?.startsWith("video/")){
      node = el("video", { src:file.dataUrl, controls:"controls", style:"width:100%; border:1px solid rgba(255,255,255,.18); border-radius:12px; background:#000;" });
    }else{
      node = el("div", {}, "");
    }
    showModal({ title:"確認", body: node, actions: [ el("button", { class:"btn gray", onclick: closeModal }, "閉じる") ] });
  }
  function fileRow(file){
    return el("div", { class:"fileRow" },
      el("div", {},
        el("div", { class:"name" }, file.name || "(file)"),
        el("div", { class:"info" }, `${Math.round((file.size||0)/1024)} KB / ${file.type||""}`)
      ),
      el("div", { class:"row right", style:"margin:0;" },
        el("button", { class:"btn small gray", onclick: ()=>viewMedia(file) }, "確認"),
        el("button", { class:"btn small", onclick: ()=>downloadDataUrl(file.dataUrl, file.name||"download") }, "DL")
      )
    );
  }
  function mountHeader(){
    const logo = $("#logo");
    const nav = $("#nav");
    if(logo) logo.textContent = "たのしいこと日記";
    if(!nav) return;
    nav.innerHTML = "";
    const mk = (label, href)=> el("a", { href, class:"btn gray small" }, label);
    nav.appendChild(mk("ロビー","index.html"));
  }


  function sortButtons(state, refresh){
    const mk = (label, value)=> el("button", {
      class:"btn tab small" + (state.sort===value ? " on":""),
      onclick: async ()=>{ state.sort=value; await refresh(); },
      disabled: state.busy
    }, label);
    return el("div", { class:"row" }, mk("新着","new"), mk("いいね(日)","like_day"), mk("いいね(週)","like_week"), mk("いいね(月)","like_month"));
  }

  function threadRowItem(t, idx, sort, mode){
    const lk = sort==="like_day" ? (t.likeDay||0) : sort==="like_week" ? (t.likeWeek||0) : sort==="like_month" ? (t.likeMonth||0) : (t.likeMonth||0);
    const titleBtn = el("div", { class:"tTitle" }, t.title || "(無題)");
    titleBtn.addEventListener("click", ()=>{ location.href = `thread.html?id=${encodeURIComponent(t.id)}&mode=${encodeURIComponent(mode)}`; });

    const tags = el("div", { class:"tags" });
    for(const tg of (t.tags||[])) tags.appendChild(el("button", { class:"tag" }, tg));

    const meta = el("div", { class:"tMeta" },
      el("span", {}, fmt(t.updatedAt||t.createdAt)),
      el("span", {}, `レス ${(t.postCount ?? 0)}`),
      el("span", {}, `いいね ${lk}`)
    );

    return el("div", { class:"threadRow" },
      el("div", { class:"tNo" }, String(idx+1)),
      el("div", { class:"tMain" }, titleBtn, meta, tags)
    );
  }

  async function pageLobby(){
    mountHeader();
    const root = $("#root");
    root.innerHTML = "";
    root.appendChild(el("div", { class:"home" },
      el("h1", {}, "たのしいこと日記"),
      el("div", { class:"ctaRow" },
        el("a", { class:"btn", href:"write.html" }, "自分の日記を書く"),
        el("a", { class:"btn", href:"read.html" }, "みんなの日記を読む")
      )
    ));
  }

  async function pageWrite(){
    mountHeader();
    const root = $("#root"); root.innerHTML = "";

    const state = { busy:false, sort:"new", threads:[], userId:getUserId() };

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
    const addTag = el("button", { class:"btn small" }, "新しいタグを追加");
    addTag.addEventListener("click", ()=>{
      const v = String(tagInput.value||"").trim();
      if(!v) return;
      if(tags.includes(v)) { tagInput.value=""; return; }
      tags.push(v);
      tagInput.value="";
      renderTags();
    });

    const submit = el("button", { class:"btn" }, "立てる");
    const refreshBtn = el("button", { class:"btn gray" }, "更新");
    const searchInput = el("input", { type:"text", placeholder:"検索", maxlength:"40" });
    searchInput.addEventListener("input", ()=>{ state.query = String(searchInput.value||""); renderList(); });
    state.query = "";


    async function refresh(){
      state.busy = true;
      submit.disabled = true; refreshBtn.disabled = true;
      try{ state.threads = await listThreads(state.sort); }
      catch(e){ showModal({ title:"確認", body:"ERROR", actions:[ el("button", { class:"btn gray", onclick: closeModal }, "閉じる") ] }); state.threads=[]; }
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
        state.threads.forEach((t, idx)=> list.appendChild(threadRowItem(t, idx, state.sort, "write")));
      }
      right.appendChild(el("div", { class:"sep" }));
      right.appendChild(list);
    }

    submit.addEventListener("click", ()=>{
      confirmGuard(GUARD.post, async ()=>{
              state.busy = true; submit.disabled = true; refreshBtn.disabled = true;
              try{
                const th = await createThread({ title: title.value, body: body.value, tags, authorId: state.userId });
                location.href = `thread.html?id=${encodeURIComponent(th.id)}&mode=write`;
                return;
              }catch(e){
                showModal({ title:"確認", body:"ERROR", actions:[ el("button", { class:"btn gray", onclick: closeModal }, "閉じる") ] });
              }
              state.busy = false; submit.disabled = false; refreshBtn.disabled = false;
      });
    });

    refreshBtn.addEventListener("click", refresh);

    left.appendChild(el("label", { text:"タイトル" })); left.appendChild(title);
    left.appendChild(el("label", { text:"本文" })); left.appendChild(body);
    left.appendChild(el("label", { text:"タグ" })); left.appendChild(el("div", { class:"row" }, tagInput, addTag));
    left.appendChild(tagWrap);
    left.appendChild(el("div", { class:"row" }, submit, refreshBtn));

    root.appendChild(el("div", { class:"grid" }, left, right));
    await refresh();
  }

  async function pageRead(){
    mountHeader();
    const root = $("#root"); root.innerHTML = "";
    const state = { busy:false, sort:"new", threads:[] };
    const box = el("div", { class:"card" }, el("div", { class:"title" }, "スレ一覧"));
    const refreshBtn = el("button", { class:"btn gray" }, "更新");

    async function refresh(){
      state.busy = true; refreshBtn.disabled = true;
      try{ state.threads = await listThreads(state.sort); }
      catch(e){ showModal({ title:"確認", body:"ERROR", actions:[ el("button", { class:"btn gray", onclick: closeModal }, "閉じる") ] }); state.threads=[]; }
      renderList();
      state.busy = false; refreshBtn.disabled = false;
    }

    function renderList(){
      box.innerHTML = "";
      box.appendChild(el("div", { class:"title" }, "スレ一覧"));
      box.appendChild(sortButtons(state, refresh));
      box.appendChild(el("div", { class:"row" }, searchInput));
      box.appendChild(el("div", { class:"row" }, refreshBtn));

      const list = el("div", { class:"threadList" });
      if(!state.threads.length){
        list.appendChild(el("div", { style:"padding:12px; color: rgba(255,255,255,.70); font-weight:900;" }, "なし"));
      }else{
        const q = String(state.query||"").trim().toLowerCase();
        const filtered = q ? state.threads.filter(t=>{
          const title = String(t.title||"").toLowerCase();
          const body = String(t.body||"").toLowerCase();
          const tags = Array.isArray(t.tags) ? t.tags.map(x=>String(x||"").toLowerCase()) : [];
          return title.includes(q) || body.includes(q) || tags.some(x=>x.includes(q));
        }) : state.threads;
        filtered.forEach((t, idx)=> list.appendChild(threadRowItem(t, idx, state.sort, "read")));
      }
      box.appendChild(el("div", { class:"sep" }));
      box.appendChild(list);
    }

    refreshBtn.addEventListener("click", refresh);
    root.appendChild(box);
    await refresh();
  }

  function postView(p){
    const head = el("div", { class:"pHead" },
      el("div", { class:"pNo" }, `${p.no || ""}`),
      el("div", { style:"color: rgba(255,255,255,.70); font-weight:900; font-size:12px;" }, fmt(p.createdAt))
    );
    const meta = el("div", { class:"pMeta" },
      el("span", {}, `ID ${(p.authorId||"").slice(-6)}`),
      p.pendingMineCount ? el("span", {}, `申請 ${p.pendingMineCount}`) : null
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
    mountHeader();
    const url = new URL(location.href);
    const threadId = url.searchParams.get("id") || "";
    const mode = (url.searchParams.get("mode") || "read") === "write" ? "write" : "read";
    if(!threadId){ location.href="index.html"; return; }

    const state = { busy:false, userId:getUserId(), thread:null, verified:false };
    const root = $("#root"); root.innerHTML = "";

    const top = el("div", { class:"card" });
    const postsBox = el("div", { class:"card" });
    const form = el("div", { class:"card" });

    async function refreshThread(){
      state.busy = true;
      try{ state.verified = await verifyStatus(state.userId); }catch{ state.verified=false; }
      try{ state.thread = await openThread(threadId, state.userId); }catch{ state.thread=null; }
      renderThread();
      state.busy = false;
    }

    function renderThread(){
      root.innerHTML = "";
      const t = state.thread;
      if(!t){
        root.appendChild(el("div", { class:"card" }, el("div", { class:"title" }, "not found"), el("a", { href:"index.html", class:"btn gray" }, "ロビー")));
        return;
      }

      top.innerHTML = "";
      top.appendChild(el("div", { class:"title" }, t.title || "(無題)"));

      const tagLine = el("div", { class:"row" });
      const tagWrap = el("div", { class:"tags" });
      (t.tags||[]).forEach(x=>tagWrap.appendChild(el("button", { class:"tag" }, x)));
      const input = el("input", { type:"text", placeholder:"タグ", maxlength:"24", style:"max-width: 220px;" });
      const add = el("button", { class:"btn small" }, "追加");
      add.addEventListener("click", async ()=>{
        const v = String(input.value||"").trim();
        if(!v) return;
        state.busy = true;
        try{ await updateTags(t.id, [v]); }catch{}
        state.busy = false;
        await refreshThread();
      });
      tagLine.appendChild(tagWrap);
      tagLine.appendChild(el("div", { style:"flex:1" }));
      tagLine.appendChild(input);
      tagLine.appendChild(add);
      top.appendChild(tagLine);

      const likeRow = el("div", { class:"row" });
      const backHref = mode === "write" ? "write.html" : "read.html";
      likeRow.appendChild(el("a", { class:"btn gray", href: backHref }, "戻る"));

      if(mode === "read"){
        const likeBtn = el("button", { class:"btn", disabled: state.busy || isLiked(t.id) }, isLiked(t.id) ? "いいね済" : "いいね");
        likeBtn.addEventListener("click", async ()=>{
          if(isLiked(t.id)) return;
          state.busy = true; likeBtn.disabled = true;
          try{ await likeThread(t.id, state.userId); setLiked(t.id); }catch(e){}
          state.busy = false;
          await refreshThread();
        });
        likeRow.appendChild(likeBtn);
        likeRow.appendChild(el("div", { style:"color: rgba(255,255,255,.70); font-weight:900; font-size:14px;" },
          `日 ${t.likeDay||0} / 週 ${t.likeWeek||0} / 月 ${t.likeMonth||0}`
        ));
      }
      top.appendChild(likeRow);

      postsBox.innerHTML = "";
      postsBox.appendChild(el("div", { class:"title" }, "レス"));
      const posts = el("div", { class:"posts" });
      (t.posts||[]).forEach((p, i)=> posts.appendChild(postView({ ...p, no: p.no || (i+1) })));
      postsBox.appendChild(posts);

      form.innerHTML = "";
      form.appendChild(el("div", { class:"title" }, "返信"));
      const body = el("textarea", { placeholder:"本文" });

      const verifyInput = el("input", { type:"file", accept:"image/*", style:"display:none" });
      verifyInput.addEventListener("change", async ()=>{
        const f = (verifyInput.files||[])[0];
        if(!f) return;
        try{
          const dataUrl = await readAsDataURL(f);
          await requestVerify({ userId: state.userId, file: { name:f.name, type:f.type, size:f.size, dataUrl } });
        }catch(e){}
        await refreshThread();
      });
      const verifyBtn = el("button", { class:"btn small gray" }, state.verified ? "本人確認済" : "本人確認");
      verifyBtn.addEventListener("click", ()=>{
        confirmGuard(GUARD.verify, ()=>{ verifyInput.value=""; verifyInput.click(); });
      });
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

      const attachBtn = el("button", { class:"btn small gray" }, "画像/動画");
      attachBtn.addEventListener("click", ()=>{
        if(!state.verified){
          showModal({ title:"確認", body:"", actions:[
            el("button", { class:"btn gray", onclick: closeModal }, "閉じる"),
            el("button", { class:"btn", onclick: ()=>{ closeModal(); confirmGuard(GUARD.verify, ()=>{ verifyInput.value=""; verifyInput.click(); }); } }, "本人確認")
          ] });
          return;
        }
        confirmGuard(GUARD.media, ()=>{ fileInput.value=""; fileInput.click(); });
      });

      const sendBtn = el("button", { class:"btn" }, "送信");
      sendBtn.addEventListener("click", ()=>{
        confirmGuard(GUARD.post, async ()=>{
                  state.busy = true; sendBtn.disabled = true;
                  try{
                    const post = await addPost(t.id, body.value, state.userId);
                    if(state.verified){
                      for(const f of picked){
                        try{ await requestAttachment({ threadId: t.id, postId: post.id, requesterId: state.userId, file: f }); }catch(e){}
                      }
                    }
                    body.value = ""; picked.length=0; pickedList.innerHTML="";
                  }catch(e){
                    showModal({ title:"確認", body:"ERROR", actions:[ el("button", { class:"btn gray", onclick: closeModal }, "閉じる") ] });
                  }
                  state.busy = false; sendBtn.disabled = false;
                  await refreshThread();
        });
      });

      form.appendChild(el("div", { class:"row" }, verifyBtn, attachBtn));
      form.appendChild(verifyInput);
      form.appendChild(fileInput);
      form.appendChild(body);
      form.appendChild(pickedList);
      form.appendChild(el("div", { class:"row" }, sendBtn));

      root.appendChild(el("div", { class:"grid" }, top, postsBox, form));
    }

    await refreshThread();
  }

  async function pageAdmin(){
    mountHeader();
    const root = $("#root"); root.innerHTML = "";

    const state = {
      busy:false,
      admin: loadJSON(LS.adminSession, { authed:false, token:"", name:"" }),
      tab: "verify",
      verify: [],
      attachments: [],
      threads: [],
      attStatus: "pending",
    };

    const box = el("div", { class:"card" });
    box.appendChild(el("div", { class:"title" }, "管理"));

    function renderLogin(){
      box.innerHTML = "";
      box.appendChild(el("div", { class:"title" }, "管理"));
      const pw = el("input", { type:"password", placeholder:"password" });
      const login = el("button", { class:"btn", disabled: state.busy }, "ログイン");
      login.addEventListener("click", async ()=>{
        state.busy = true; renderLogin();
        try{
          const r = await adminLogin(pw.value);
          state.admin = { authed:true, token:r?.token||"", name:r?.name||"ADMIN" };
          saveJSON(LS.adminSession, state.admin);
          state.busy = false;
          await refreshAll();
          renderAdmin();
        }catch(e){
          state.busy = false;
          showModal({ title:"確認", body:"ERROR", actions:[ el("button", { class:"btn gray", onclick: closeModal }, "閉じる") ] });
          renderLogin();
        }
      });
      box.appendChild(el("div", { class:"row" }, pw, login));
      root.appendChild(box);
    }

    async function refreshAll(){
      state.busy = true;
      try{
        if(state.tab === "verify"){
          state.verify = await adminListVerify("pending", state.admin.token);
        }else if(state.tab === "attach"){
          state.attachments = await adminListAttachments(state.attStatus, state.admin.token);
        }else{
          state.threads = await adminListThreads(state.admin.token);
        }
      }catch(e){}
      state.busy = false;
    }

    function tabs(){
      const mk = (label, value)=> el("button", {
        class:"btn tab small" + (state.tab===value ? " on":""),
        disabled: state.busy,
        onclick: async ()=>{ state.tab=value; await refreshAll(); renderAdmin(); }
      }, label);

      return el("div", { class:"row" }, mk("本人確認","verify"), mk("添付","attach"), mk("投稿","posts"));
    }

    function renderAdmin(){
      box.innerHTML = "";
      box.appendChild(el("div", { class:"title" }, "管理"));
      box.appendChild(el("div", { class:"row" },
        el("a", { class:"btn gray", href:"index.html" }, "ロビー"),
        el("button", { class:"btn gray", disabled: state.busy, onclick: async ()=>{ await refreshAll(); renderAdmin(); } }, "更新"),
        el("button", { class:"btn gray", disabled: state.busy, onclick: ()=>{
          state.admin = { authed:false, token:"", name:"" };
          saveJSON(LS.adminSession, state.admin);
          renderLogin();
        } }, "ログアウト"),
      ));
      box.appendChild(tabs());

      const list = el("div", { class:"posts" });

      if(state.tab === "verify"){
        for(const r of (state.verify||[])){
          const f = r.file || {};
          const img = f.dataUrl ? el("img", { src:f.dataUrl, style:"width:100%; max-height:320px; object-fit:contain; border:1px solid rgba(255,255,255,.18); border-radius:12px; background:#000; margin-top:10px;" }) : null;
          const note = el("textarea", { placeholder:"note" });
          note.value = r.note || "";
          const actions = el("div", { class:"row" },
            el("button", { class:"btn small", onclick: async ()=>{
              state.busy = true; renderAdmin();
              try{ await adminReviewVerify({ requestId:r.id, action:"reject", note: note.value }, state.admin.token); }catch(e){}
              await refreshAll(); renderAdmin();
            } }, "却下"),
            el("button", { class:"btn small", onclick: async ()=>{
              state.busy = true; renderAdmin();
              try{ await adminReviewVerify({ requestId:r.id, action:"approve", note: note.value }, state.admin.token); }catch(e){}
              await refreshAll(); renderAdmin();
            } }, "承認"),
            f.dataUrl ? el("button", { class:"btn small gray", onclick: ()=>downloadDataUrl(f.dataUrl, f.name||"verify") }, "DL") : null
          );
          list.appendChild(el("div", { class:"post" },
            el("div", { class:"pHead" },
              el("div", { class:"pNo" }, `U ${r.userId}`),
              el("div", { style:"color: rgba(255,255,255,.70); font-weight:900; font-size:12px;" }, fmt(r.createdAt))
            ),
            img,
            el("label", { text:"note" }),
            note,
            actions
          ));
        }
      } else if(state.tab === "attach"){
        box.appendChild(el("div", { class:"row" },
          el("button", { class:"btn tab small" + (state.attStatus==="pending"?" on":""), onclick: async ()=>{ state.attStatus="pending"; await refreshAll(); renderAdmin(); } }, "未処理"),
          el("button", { class:"btn tab small" + (state.attStatus==="approved"?" on":""), onclick: async ()=>{ state.attStatus="approved"; await refreshAll(); renderAdmin(); } }, "承認"),
          el("button", { class:"btn tab small" + (state.attStatus==="rejected"?" on":""), onclick: async ()=>{ state.attStatus="rejected"; await refreshAll(); renderAdmin(); } }, "却下"),
        ));

        for(const a of (state.attachments||[])){
          const f = a.file || {};
          const media = f.dataUrl && (f.type||"").startsWith("image/")
            ? el("img", { src:f.dataUrl, style:"width:100%; max-height:320px; object-fit:contain; border:1px solid rgba(255,255,255,.18); border-radius:12px; background:#000; margin-top:10px;" })
            : f.dataUrl && (f.type||"").startsWith("video/")
            ? el("video", { src:f.dataUrl, controls:"controls", style:"width:100%; max-height:320px; border:1px solid rgba(255,255,255,.18); border-radius:12px; background:#000; margin-top:10px;" })
            : null;

          const note = el("textarea", { placeholder:"note" });
          note.value = a.note || "";

          const actions = el("div", { class:"row" },
            f.dataUrl ? el("button", { class:"btn small gray", onclick: ()=>downloadDataUrl(f.dataUrl, f.name||"file") }, "DL") : null
          );

          if(a.status === "pending"){
            actions.appendChild(el("button", { class:"btn small", onclick: async ()=>{
              state.busy = true; renderAdmin();
              try{ await adminReviewAttachment({ attachmentId:a.id, action:"reject", note: note.value }, state.admin.token); }catch(e){}
              await refreshAll(); renderAdmin();
            } }, "却下"));
            actions.appendChild(el("button", { class:"btn small", onclick: async ()=>{
              state.busy = true; renderAdmin();
              try{ await adminReviewAttachment({ attachmentId:a.id, action:"approve", note: note.value }, state.admin.token); }catch(e){}
              await refreshAll(); renderAdmin();
            } }, "承認"));
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
            media,
            el("label", { text:"note" }),
            note,
            actions
          ));
        }
      } else {
        for(const t of (state.threads||[])){
          const thHead = el("div", { class:"pHead" },
            el("div", { class:"pNo" }, t.title || "(無題)"),
            el("div", { style:"color: rgba(255,255,255,.70); font-weight:900; font-size:12px;" }, fmt(t.updatedAt||t.createdAt))
          );
          const meta = el("div", { class:"pMeta" },
            el("span", {}, `T ${t.id}`),
            el("span", {}, `U ${t.creatorId||"-"}`),
            el("span", {}, `レス ${(t.posts||[]).length}`),
            el("span", {}, `hide ${t.hidden?1:0}`)
          );
          const actions = el("div", { class:"row" },
            el("button", { class:"btn small gray", onclick: async ()=>{
              state.busy = true; renderAdmin();
              try{ await adminHideThread({ threadId:t.id, hide: !t.hidden }, state.admin.token); }catch(e){}
              await refreshAll(); renderAdmin();
            } }, t.hidden ? "表示" : "非表示"),
            el("button", { class:"btn small", onclick: async ()=>{
              state.busy = true; renderAdmin();
              try{ await adminDeleteThread({ threadId:t.id }, state.admin.token); }catch(e){}
              await refreshAll(); renderAdmin();
            } }, "削除")
          );

          const postList = el("div", { class:"posts" });
          (t.posts||[]).forEach((p, i)=>{
            postList.appendChild(el("div", { class:"post" },
              el("div", { class:"pHead" },
                el("div", { class:"pNo" }, `${i+1}`),
                el("div", { style:"color: rgba(255,255,255,.70); font-weight:900; font-size:12px;" }, fmt(p.createdAt))
              ),
              el("div", { class:"pMeta" }, el("span", {}, `P ${p.id}`), el("span", {}, `U ${p.authorId||"-"}`)),
              el("div", { class:"pBody" }, p.body || ""),
              el("div", { class:"row right" },
                el("button", { class:"btn small", onclick: async ()=>{
                  state.busy = true; renderAdmin();
                  try{ await adminDeletePost({ threadId:t.id, postId:p.id }, state.admin.token); }catch(e){}
                  await refreshAll(); renderAdmin();
                } }, "削除")
              )
            ));
          });

          list.appendChild(el("div", { class:"post" }, thHead, meta, actions, postList));
        }
      }

      box.appendChild(list);
      root.appendChild(box);
    }

    root.appendChild(box);

    if(!state.admin.authed){ renderLogin(); return; }
    await refreshAll();
    renderAdmin();
  }

  function init(){
    const page = document.documentElement.dataset.page || "";
    if(page === "lobby") return pageLobby();
    if(page === "write") return pageWrite();
    if(page === "read") return pageRead();
    if(page === "thread") return pageThread();
    if(page === "admin") return pageAdmin();
  }
  window.addEventListener("DOMContentLoaded", init);
})();