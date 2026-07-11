/* =========================================================
   LEDGER STUDIO — Supabase configuration & lightweight client
   Replace the two values below with your own project's
   URL and anon/publishable key (Project Settings → API in
   Supabase). See SUPABASE_SETUP.md for the full setup guide.

   Why this file doesn't load the official @supabase/supabase-js
   library from a CDN: some browsers (Edge's "Tracking
   Prevention", strict ad-blockers, some corporate networks)
   silently block requests to third-party CDN domains. If that
   script never loads, window.supabase is never created and every
   sign-in/sign-up attempt fails silently. To avoid that entire
   class of failure, this file talks to your Supabase project
   directly with plain fetch() calls — the exact same HTTP API
   the official library uses underneath — and exposes the same
   supabaseClient.auth / supabaseClient.from(...) shape that
   main.js expects, so nothing else in the app needed to change.
========================================================= */

const SUPABASE_URL = "https://bxegrdarypalmcpoftxf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Nzxw-dAc_S9otrNboi2_7A_7vgPs3Wm";

(function(){
  "use strict";

  const AUTH_URL = SUPABASE_URL.replace(/\/$/, "") + "/auth/v1";
  const REST_URL = SUPABASE_URL.replace(/\/$/, "") + "/rest/v1";
  const SESSION_KEY = "ls_supabase_session";

  /* ---------------- Local session storage ---------------- */
  function getStoredSession(){
    try{ const raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; }
    catch(e){ return null; }
  }
  function storeSession(session){
    if(session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }
  function computeExpiresAt(json){
    if(json.expires_at) return json.expires_at;
    if(json.expires_in) return Math.floor(Date.now()/1000) + Number(json.expires_in);
    return Math.floor(Date.now()/1000) + 3600;
  }
  function normalizeSession(json){
    if(!json || !json.access_token) return null;
    return {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: computeExpiresAt(json),
      user: json.user || null
    };
  }
  async function parseResponse(res){
    const text = await res.text();
    if(!text) return null;
    try{ return JSON.parse(text); }catch(e){ return null; }
  }
  function toError(json, res){
    const message = (json && (json.error_description || json.msg || json.message || json.error))
      || (res && res.statusText) || "Request failed";
    return { message };
  }
  function toNetworkError(e){
    return { message: "Couldn't reach Supabase — check your internet connection and that SUPABASE_URL is correct. (" + (e.message || e) + ")" };
  }

  function currentRedirectUrl(){
    return window.location.origin + window.location.pathname;
  }

  /* ---------------- Password recovery link detection ----------------
     When someone clicks a "reset password" email link, Supabase sends
     them back here with #access_token=...&type=recovery in the URL.
     We catch that on load, stash the session, and strip it from the
     visible URL so a refresh doesn't resubmit sensitive tokens. ---- */
  let pendingRecovery = false;
  (function handleRecoveryRedirect(){
    const hash = window.location.hash;
    if(!hash || hash.length < 2) return;
    const params = new URLSearchParams(hash.slice(1));
    const accessToken = params.get("access_token");
    const type = params.get("type");
    if(accessToken && type === "recovery"){
      storeSession({
        access_token: accessToken,
        refresh_token: params.get("refresh_token"),
        expires_at: Math.floor(Date.now()/1000) + Number(params.get("expires_in") || 3600),
        user: null
      });
      pendingRecovery = true;
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  })();

  async function fetchUser(accessToken){
    try{
      const res = await fetch(AUTH_URL + "/user", {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + accessToken }
      });
      const json = await parseResponse(res);
      return res.ok ? json : null;
    }catch(e){ return null; }
  }

  async function refreshSession(refreshToken){
    if(!refreshToken) return null;
    try{
      const res = await fetch(AUTH_URL + "/token?grant_type=refresh_token", {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      const json = await parseResponse(res);
      if(!res.ok || !json) { storeSession(null); return null; }
      const session = normalizeSession(json);
      if(session && !session.user) session.user = await fetchUser(session.access_token);
      storeSession(session);
      return session;
    }catch(e){ return null; }
  }

  async function ensureFreshSession(){
    let session = getStoredSession();
    if(!session) return null;
    const soon = Math.floor(Date.now()/1000) + 30;
    if(session.expires_at && session.expires_at < soon){
      session = await refreshSession(session.refresh_token);
    }
    return session;
  }

  async function getBearerToken(){
    const session = await ensureFreshSession();
    return session ? session.access_token : SUPABASE_ANON_KEY;
  }

  /* ---------------- Auth ---------------- */
  const auth = {
    async signUp({ email, password, options }){
      try{
        const res = await fetch(AUTH_URL + "/signup?redirect_to=" + encodeURIComponent(currentRedirectUrl()), {
          method: "POST",
          headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, data: (options && options.data) || {} })
        });
        const json = await parseResponse(res);
        if(!res.ok) return { data: null, error: toError(json, res) };
        const session = normalizeSession(json);
        if(session) storeSession(session);
        return { data: { user: (session && session.user) || (json && json.user) || json, session }, error: null };
      }catch(e){ return { data: null, error: toNetworkError(e) }; }
    },

    async signInWithPassword({ email, password }){
      try{
        const res = await fetch(AUTH_URL + "/token?grant_type=password", {
          method: "POST",
          headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        });
        const json = await parseResponse(res);
        if(!res.ok) return { data: null, error: toError(json, res) };
        const session = normalizeSession(json);
        storeSession(session);
        return { data: { user: session.user, session }, error: null };
      }catch(e){ return { data: null, error: toNetworkError(e) }; }
    },

    async signOut(){
      const session = getStoredSession();
      storeSession(null);
      if(session && session.access_token){
        try{
          await fetch(AUTH_URL + "/logout", {
            method: "POST",
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + session.access_token }
          });
        }catch(e){ /* best effort — local session is already cleared */ }
      }
      return { error: null };
    },

    async getSession(){
      const session = await ensureFreshSession();
      return { data: { session } };
    },

    async updateUser(updates){
      try{
        const session = await ensureFreshSession();
        if(!session) return { data: null, error: { message: "Not signed in" } };
        const res = await fetch(AUTH_URL + "/user", {
          method: "PUT",
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" },
          body: JSON.stringify(updates)
        });
        const json = await parseResponse(res);
        if(!res.ok) return { data: null, error: toError(json, res) };
        session.user = json;
        storeSession(session);
        return { data: { user: json }, error: null };
      }catch(e){ return { data: null, error: toNetworkError(e) }; }
    },

    // Minimal stub: this app drives sign-in/sign-out transitions explicitly
    // rather than relying on cross-tab auth events, so no real event bus is needed.
    onAuthStateChange(){
      return { data: { subscription: { unsubscribe(){} } } };
    },

    async resetPasswordForEmail(email){
      try{
        const res = await fetch(AUTH_URL + "/recover?redirect_to=" + encodeURIComponent(currentRedirectUrl()), {
          method: "POST",
          headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ email })
        });
        const json = await parseResponse(res);
        if(!res.ok) return { error: toError(json, res) };
        return { error: null };
      }catch(e){ return { error: toNetworkError(e) }; }
    },

    async resendConfirmation(email){
      try{
        const res = await fetch(AUTH_URL + "/resend?redirect_to=" + encodeURIComponent(currentRedirectUrl()), {
          method: "POST",
          headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ type: "signup", email })
        });
        const json = await parseResponse(res);
        if(!res.ok) return { error: toError(json, res) };
        return { error: null };
      }catch(e){ return { error: toNetworkError(e) }; }
    },

    isPasswordRecovery(){ return pendingRecovery; },
    clearPasswordRecovery(){ pendingRecovery = false; }
  };

  /* ---------------- Database (PostgREST) query builder ---------------- */
  class QueryBuilder{
    constructor(table){
      this.table = table;
      this.method = "GET";
      this.filters = [];
      this.selectCols = "*";
      this.orderClause = "";
      this.body = null;
      this.wantSingle = false;
      this.wantMaybeSingle = false;
      this.preferParts = [];
      this.onConflictCol = null;
    }
    select(cols){ this.selectCols = cols || "*"; return this; }
    eq(col, val){ this.filters.push(col + "=eq." + encodeURIComponent(val)); return this; }
    order(col, opts){
      const ascending = !opts || opts.ascending !== false;
      this.orderClause = col + "." + (ascending ? "asc" : "desc");
      return this;
    }
    single(){ this.wantSingle = true; this._addPrefer("return=representation"); return this; }
    maybeSingle(){ this.wantMaybeSingle = true; return this; }
    insert(obj){ this.method = "POST"; this.body = obj; this._addPrefer("return=representation"); return this; }
    update(obj){ this.method = "PATCH"; this.body = obj; this._addPrefer("return=representation"); return this; }
    upsert(obj, opts){
      this.method = "POST";
      this.body = obj;
      this.onConflictCol = opts && opts.onConflict;
      this._addPrefer("resolution=merge-duplicates");
      this._addPrefer("return=representation");
      return this;
    }
    delete(){ this.method = "DELETE"; return this; }
    _addPrefer(part){ if(!this.preferParts.includes(part)) this.preferParts.push(part); }

    async _execute(){
      const params = [];
      if(this.method === "GET" && this.selectCols) params.push("select=" + encodeURIComponent(this.selectCols));
      this.filters.forEach(f => params.push(f));
      if(this.orderClause) params.push("order=" + this.orderClause);
      if(this.onConflictCol) params.push("on_conflict=" + this.onConflictCol);

      let url = REST_URL + "/" + this.table;
      if(params.length) url += "?" + params.join("&");

      try{
        const token = await getBearerToken();
        const headers = {
          apikey: SUPABASE_ANON_KEY,
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          Accept: "application/json"
        };
        if(this.preferParts.length) headers["Prefer"] = this.preferParts.join(",");

        const res = await fetch(url, {
          method: this.method,
          headers,
          body: this.body != null ? JSON.stringify(this.body) : undefined
        });
        const text = await res.text();
        let json = null;
        try{ json = text ? JSON.parse(text) : null; }catch(e){ json = null; }

        if(!res.ok){
          const message = (json && (json.message || json.hint || json.details)) || res.statusText || ("Request failed (" + res.status + ")");
          return { data: null, error: { message } };
        }

        let data = json;
        if(this.wantSingle){
          data = Array.isArray(json) ? (json[0] || null) : json;
          if(!data) return { data: null, error: { message: "No matching row found" } };
        } else if(this.wantMaybeSingle){
          data = Array.isArray(json) ? (json[0] || null) : json;
        }
        return { data, error: null };
      }catch(e){
        return { data: null, error: toNetworkError(e) };
      }
    }
    then(resolve, reject){ this._execute().then(resolve, reject); }
    catch(reject){ return this._execute().catch(reject); }
  }

  function from(table){ return new QueryBuilder(table); }

  window.supabaseClient = { auth, from };
})();