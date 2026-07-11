/* =========================================================
   LEDGER STUDIO — App logic (app.html only)
   Backed by Supabase: real authentication (hashed passwords,
   sessions handled by Supabase Auth) and per-user data stored
   in Postgres, protected by Row Level Security. See
   SUPABASE_SETUP.md for the one-time setup this depends on.
========================================================= */

(function(){
  "use strict";

  const supa = window.supabaseClient;

  if(!supa){
    // The Supabase SDK or supabase-config.js failed to load — every request would
    // hang silently without this check. Tell the person plainly instead.
    const err = document.getElementById("authError");
    if(err){
      err.textContent = "Ledger Studio couldn't connect to Supabase. Check that supabase-config.js has your real Project URL and anon key, and that script tags in app.html are loading (open the browser console for details).";
      err.classList.add("show");
    }
    document.querySelectorAll("#signinSubmitBtn, #signupSubmitBtn").forEach(b=>{ b.disabled = true; });
    console.error("Ledger Studio: window.supabaseClient is undefined. Check supabase-config.js and that the Supabase CDN script loaded (view Network tab for a failed request).");
    return;
  }

  const uid = (p)=> (p||"id_") + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  const fmtMoney = (num, symbol)=> (symbol||"₦") + Number(num||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtDate = (d)=>{
    if(!d) return "—";
    const dt = new Date(d + "T00:00:00");
    if(isNaN(dt)) return d;
    return dt.toLocaleDateString(undefined,{month:"short", day:"numeric", year:"numeric"});
  };
  function escapeHtml(str){
    return String(str||"").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }
  function b64EncodeUnicode(str){
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (m,p1)=>String.fromCharCode("0x"+p1)));
  }
  function setBusy(btn, busyText){
    if(!btn) return ()=>{};
    const original = btn.textContent;
    btn.textContent = busyText;
    btn.disabled = true;
    return ()=>{ btn.textContent = original; btn.disabled = false; };
  }
  function friendlyError(error){
    if(!error) return "Something went wrong. Please try again.";
    const msg = error.message || String(error);
    if(/failed to fetch|networkerror|load failed/i.test(msg)){
      return "Couldn't reach Supabase. Check your internet connection, and that SUPABASE_URL in supabase-config.js is correct.";
    }
    if(/already registered/i.test(msg)) return "An account with that email already exists — try signing in.";
    if(/invalid login credentials/i.test(msg)) return "That email and password don't match our records.";
    if(/email not confirmed/i.test(msg)) return "Please confirm your email before signing in — check your inbox.";
    if(/invalid api key/i.test(msg)) return "Supabase rejected the API key. Double-check SUPABASE_ANON_KEY in supabase-config.js.";
    return msg || "Something went wrong. Please try again.";
  }

  /* ---------------- Field mapping: DB (snake_case) <-> App (camelCase) ---------------- */
  function fromDbInvoice(row){
    return {
      id: row.id, number: row.number, clientName: row.client_name, clientEmail: row.client_email,
      clientAddress: row.client_address, status: row.status, issueDate: row.issue_date, dueDate: row.due_date,
      currency: row.currency, taxPercent: row.tax_percent, discountPercent: row.discount_percent, notes: row.notes,
      items: row.items || [], subtotal: row.subtotal, discountAmt: row.discount_amt, taxAmt: row.tax_amt,
      total: row.total, createdAt: row.created_at, updatedAt: row.updated_at
    };
  }
  function toDbInvoice(obj, userId){
    return {
      user_id: userId, number: obj.number, client_name: obj.clientName, client_email: obj.clientEmail,
      client_address: obj.clientAddress, status: obj.status, issue_date: obj.issueDate || null, due_date: obj.dueDate || null,
      currency: obj.currency, tax_percent: obj.taxPercent, discount_percent: obj.discountPercent, notes: obj.notes,
      items: obj.items, subtotal: obj.subtotal, discount_amt: obj.discountAmt, tax_amt: obj.taxAmt, total: obj.total,
      updated_at: new Date().toISOString()
    };
  }
  function fromDbCompany(row){
    return row ? {name:row.name||"", email:row.email||"", phone:row.phone||"", address:row.address||"", logo:row.logo||""}
                : {name:"", email:"", phone:"", address:"", logo:""};
  }
  function fromDbBank(row){
    return row ? {bankName:row.bank_name||"", accountName:row.account_name||"", accountNumber:row.account_number||"", iban:row.iban||"", swift:row.swift||""}
                : {bankName:"", accountName:"", accountNumber:"", iban:"", swift:""};
  }

  /* ---------------- Session-scoped state ---------------- */
  let currentUser  = null; // { id, email, name, avatar }
  let company  = {name:"", email:"", phone:"", address:"", logo:""};
  let bank     = {bankName:"", accountName:"", accountNumber:"", iban:"", swift:""};
  let invoices = [];

  let currentDurationRange = "all";
  let currentStatusFilter  = "all";
  let currentSearch        = "";
  let editingInvoiceId     = null;
  let pendingDeleteId      = null;

  /* =========================================================
     TOAST
  ========================================================= */
  function toast(msg, type){
    const wrap = document.getElementById("toastWrap");
    if(!wrap) return;
    const el = document.createElement("div");
    el.className = "toast " + (type || "success");
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(()=>{ el.style.opacity="0"; el.style.transform="translateY(10px)"; setTimeout(()=>el.remove(), 300); }, 3200);
  }

  /* =========================================================
     AUTH
  ========================================================= */
  const authScreen = document.getElementById("authScreen");
  const appLoader  = document.getElementById("appLoader");

  function showAuthError(msg){
    const el = document.getElementById("authError");
    el.textContent = msg;
    el.classList.add("show");
  }
  function clearAuthError(){
    document.getElementById("authError").classList.remove("show");
    const resendBox = document.getElementById("resendBox");
    if(resendBox) resendBox.style.display = "none";
  }

  document.querySelectorAll(".auth-tab").forEach(tab=>{
    tab.addEventListener("click", ()=>{
      document.querySelectorAll(".auth-tab").forEach(t=>t.classList.remove("active"));
      tab.classList.add("active");
      const which = tab.getAttribute("data-tab");
      document.getElementById("signinForm").classList.toggle("active", which==="signin");
      document.getElementById("signupForm").classList.toggle("active", which==="signup");
      document.getElementById("authFootText").innerHTML = which==="signin"
        ? 'New here? <button id="authFootBtn">Create an account</button>'
        : 'Already have an account? <button id="authFootBtn">Sign in</button>';
      bindAuthFootBtn(which);
      clearAuthError();
    });
  });
  function bindAuthFootBtn(currentTab){
    const btn = document.getElementById("authFootBtn");
    if(!btn) return;
    btn.addEventListener("click", ()=>{
      const target = currentTab === "signin" ? "signup" : "signin";
      document.querySelector('.auth-tab[data-tab="'+target+'"]').click();
    });
  }
  bindAuthFootBtn("signin");

  document.getElementById("signinForm").addEventListener("submit", async (e)=>{
    e.preventDefault();
    clearAuthError();
    const email = document.getElementById("signinEmail").value.trim();
    const password = document.getElementById("signinPassword").value;
    const done = setBusy(document.getElementById("signinSubmitBtn"), "Signing in…");
    try{
      const { data, error } = await supa.auth.signInWithPassword({ email, password });
      if(error){
        showAuthError(friendlyError(error));
        if(/confirm/i.test(error.message || "")) document.getElementById("resendBox").style.display = "block";
        return;
      }
      await handleSignedIn(data.user);
    }catch(err){
      console.error(err);
      showAuthError(friendlyError(err));
    }finally{
      done();
    }
  });

  document.getElementById("resendConfirmationBtn").addEventListener("click", async ()=>{
    const email = document.getElementById("signinEmail").value.trim();
    if(!email){ toast("Enter your email above first", "error"); return; }
    const btn = document.getElementById("resendConfirmationBtn");
    const done = setBusy(btn, "Sending…");
    try{
      const { error } = await supa.auth.resendConfirmation(email);
      if(error){ toast(friendlyError(error), "error"); return; }
      toast("Confirmation email sent again — check your inbox");
    }catch(err){
      toast(friendlyError(err), "error");
    }finally{
      done();
    }
  });

  document.getElementById("forgotPasswordBtn").addEventListener("click", async ()=>{
    const email = document.getElementById("signinEmail").value.trim();
    if(!email){
      showAuthError("Enter your email above first, then click Forgot password.");
      document.getElementById("signinEmail").focus();
      return;
    }
    clearAuthError();
    const btn = document.getElementById("forgotPasswordBtn");
    const done = setBusy(btn, "Sending…");
    try{
      const { error } = await supa.auth.resetPasswordForEmail(email);
      if(error){ showAuthError(friendlyError(error)); return; }
      toast("Password reset link sent — check your email");
    }catch(err){
      showAuthError(friendlyError(err));
    }finally{
      done();
    }
  });

  document.getElementById("recoveryForm").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const recoveryErrorEl = document.getElementById("recoveryError");
    recoveryErrorEl.classList.remove("show");
    const pw = document.getElementById("recoveryPassword").value;
    if(pw.length < 6){
      recoveryErrorEl.textContent = "Password should be at least 6 characters.";
      recoveryErrorEl.classList.add("show");
      return;
    }
    const done = setBusy(document.getElementById("recoverySubmitBtn"), "Saving…");
    try{
      const { data, error } = await supa.auth.updateUser({ password: pw });
      if(error){
        recoveryErrorEl.textContent = friendlyError(error);
        recoveryErrorEl.classList.add("show");
        return;
      }
      supa.auth.clearPasswordRecovery();
      document.getElementById("recoveryScreen").style.display = "none";
      toast("Password updated — welcome back!");
      await handleSignedIn(data.user);
    }catch(err){
      recoveryErrorEl.textContent = friendlyError(err);
      recoveryErrorEl.classList.add("show");
    }finally{
      done();
    }
  });

  document.getElementById("signupForm").addEventListener("submit", async (e)=>{
    e.preventDefault();
    clearAuthError();
    const name = document.getElementById("signupName").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    if(password.length < 6){ showAuthError("Password should be at least 6 characters."); return; }

    const done = setBusy(document.getElementById("signupSubmitBtn"), "Creating account…");
    try{
      const { data, error } = await supa.auth.signUp({ email, password, options:{ data:{ name } } });
      if(error){ showAuthError(friendlyError(error)); return; }

      if(!data.session){
        toast("Account created — check your email to confirm, then sign in.");
        document.querySelector('.auth-tab[data-tab="signin"]').click();
        return;
      }
      toast("Account created — welcome!");
      await handleSignedIn(data.user);
    }catch(err){
      console.error(err);
      showAuthError(friendlyError(err));
    }finally{
      done();
    }
  });

  async function handleSignedIn(user){
    currentUser = { id: user.id, email: user.email, name: "", avatar: "" };
    authScreen.style.display = "none";
    appLoader.style.display = "flex";
    try{
      await Promise.all([loadProfile(), loadCompany(), loadBank(), loadInvoices()]);
      updateSidebarUser();
      resetEditor();
      renderDashboard();
    }catch(err){
      toast("Couldn't load your data — check your connection and refresh.", "error");
    }
    appLoader.style.display = "none";
  }

  async function logOut(){
    try{ await supa.auth.signOut(); }catch(err){ console.error(err); }
    currentUser = null;
    company = {name:"", email:"", phone:"", address:"", logo:""};
    bank = {bankName:"", accountName:"", accountNumber:"", iban:"", swift:""};
    invoices = [];
    authScreen.style.display = "flex";
    document.getElementById("signinForm").reset();
    document.getElementById("signupForm").reset();
    clearAuthError();
  }
  document.getElementById("logoutBtn").addEventListener("click", logOut);
  document.getElementById("profileLogoutBtn").addEventListener("click", logOut);

  supa.auth.onAuthStateChange((event)=>{
    if(event === "SIGNED_OUT" && currentUser){ logOut(); }
  });

  async function tryResumeSession(){
    try{
      const { data:{ session } } = await supa.auth.getSession();
      if(!session) return false;
      await handleSignedIn(session.user);
      return true;
    }catch(err){
      console.error(err);
      return false;
    }
  }

  /* =========================================================
     DATA LOADING (Supabase)
  ========================================================= */
  async function loadProfile(){
    const { data, error } = await supa.from("profiles").select("*").eq("id", currentUser.id).maybeSingle();
    if(error) throw error;
    currentUser.name = (data && data.name) || "";
    currentUser.avatar = (data && data.avatar_url) || "";
  }
  async function loadCompany(){
    const { data, error } = await supa.from("companies").select("*").eq("user_id", currentUser.id).maybeSingle();
    if(error) throw error;
    company = fromDbCompany(data);
  }
  async function loadBank(){
    const { data, error } = await supa.from("bank_details").select("*").eq("user_id", currentUser.id).maybeSingle();
    if(error) throw error;
    bank = fromDbBank(data);
  }
  async function loadInvoices(){
    const { data, error } = await supa.from("invoices").select("*").eq("user_id", currentUser.id).order("created_at", { ascending:false });
    if(error) throw error;
    invoices = (data || []).map(fromDbInvoice);
  }

  /* =========================================================
     VIEW SWITCHING
  ========================================================= */
  function showView(name){
    document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
    const target = document.getElementById("view-" + name);
    if(target) target.classList.add("active");

    document.querySelectorAll(".side-link").forEach(l=>l.classList.remove("active"));
    document.querySelectorAll('.side-link[data-view="'+name+'"]').forEach(l=>l.classList.add("active"));

    if(name === "dashboard") renderDashboard();
    if(name === "invoices") renderInvoiceTable();
    if(name === "company") loadCompanyForm();
    if(name === "bank") loadBankForm();
    if(name === "profile") loadProfileForm();
    window.scrollTo({top:0, behavior:"smooth"});

    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebarOverlay");
    if(sidebar){ sidebar.classList.remove("open"); overlay && overlay.classList.remove("open"); }
  }

  document.querySelectorAll("[data-view]").forEach(el=>{
    el.addEventListener("click", (e)=>{
      e.preventDefault();
      const view = el.getAttribute("data-view");
      if(view === "editor" && (el.id === "newInvoiceLink" || el.textContent.includes("New"))){
        resetEditor();
      }
      showView(view);
    });
  });

  /* =========================================================
     DASHBOARD
  ========================================================= */
  function withinRange(dateStr, days){
    if(days === "all") return true;
    const d = new Date(dateStr + "T00:00:00");
    const now = new Date();
    const past = new Date();
    past.setDate(now.getDate() - Number(days));
    return d >= past && d <= now;
  }

  function renderDashboard(){
    const filtered = invoices.filter(inv => withinRange(inv.issueDate, currentDurationRange));
    const paid = filtered.filter(i=>i.status === "paid");
    const unpaid = filtered.filter(i=>i.status === "unpaid");

    const revenue = paid.reduce((s,i)=>s + i.total, 0);
    const outstanding = unpaid.reduce((s,i)=>s + i.total, 0);
    const avg = filtered.length ? (filtered.reduce((s,i)=>s+i.total,0) / filtered.length) : 0;

    document.getElementById("statRevenue").textContent = fmtMoney(revenue);
    document.getElementById("statOutstanding").textContent = fmtMoney(outstanding);
    document.getElementById("statCount").textContent = filtered.length;
    document.getElementById("statAvg").textContent = fmtMoney(avg);
    document.getElementById("statRevenueDelta").textContent = paid.length + " paid invoice" + (paid.length===1?"":"s");
    document.getElementById("statOutstandingDelta").textContent = unpaid.length + " awaiting payment";
    document.getElementById("statCountDelta").textContent = "in selected range";

    renderBarChart();
    renderRecentInvoices();
  }

  function renderBarChart(){
    const container = document.getElementById("barChart");
    container.innerHTML = "";
    const months = [];
    const now = new Date();
    for(let i=5;i>=0;i--){
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({label:d.toLocaleDateString(undefined,{month:"short"}), year:d.getFullYear(), month:d.getMonth()});
    }
    const totals = months.map(m=>{
      return invoices.filter(inv=>{
        if(inv.status !== "paid") return false;
        const d = new Date(inv.issueDate + "T00:00:00");
        return d.getFullYear() === m.year && d.getMonth() === m.month;
      }).reduce((s,i)=>s+i.total,0);
    });
    const max = Math.max(...totals, 1);

    months.forEach((m, idx)=>{
      const col = document.createElement("div");
      col.className = "bar-col";
      const bar = document.createElement("div");
      bar.className = "bar";
      col.innerHTML = `<b>${fmtMoney(totals[idx]).replace(".00","")}</b>`;
      col.appendChild(bar);
      const label = document.createElement("span");
      label.textContent = m.label;
      col.appendChild(label);
      container.appendChild(col);
      requestAnimationFrame(()=>{
        setTimeout(()=>{ bar.style.transform = "scaleY(" + (totals[idx]/max || 0.02) + ")"; }, 60);
      });
    });
  }

  function renderRecentInvoices(){
    const body = document.getElementById("recentInvoicesBody");
    const empty = document.getElementById("dashEmptyState");
    const recent = [...invoices].sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt)).slice(0,5);
    body.innerHTML = "";
    if(!recent.length){ empty.style.display = "block"; return; }
    empty.style.display = "none";
    recent.forEach(inv=>{
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="mono">${inv.number}</td>
        <td>${escapeHtml(inv.clientName || "—")}</td>
        <td>${fmtDate(inv.issueDate)}</td>
        <td><span class="badge ${inv.status}">${inv.status}</span></td>
        <td class="mono">${fmtMoney(inv.total, inv.currency)}</td>`;
      body.appendChild(tr);
    });
  }

  document.querySelectorAll("#durationFilters .chip").forEach(chip=>{
    chip.addEventListener("click", ()=>{
      document.querySelectorAll("#durationFilters .chip").forEach(c=>c.classList.remove("active"));
      chip.classList.add("active");
      currentDurationRange = chip.getAttribute("data-range");
      renderDashboard();
    });
  });

  /* =========================================================
     INVOICES LIST
  ========================================================= */
  function renderInvoiceTable(){
    const body = document.getElementById("allInvoicesBody");
    const empty = document.getElementById("invoicesEmptyState");
    let list = [...invoices].sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));

    if(currentStatusFilter !== "all") list = list.filter(i=>i.status === currentStatusFilter);
    if(currentSearch){
      const q = currentSearch.toLowerCase();
      list = list.filter(i => (i.clientName||"").toLowerCase().includes(q) || (i.number||"").toLowerCase().includes(q));
    }

    body.innerHTML = "";
    if(!list.length){ empty.style.display = "block"; return; }
    empty.style.display = "none";

    list.forEach(inv=>{
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="mono">${inv.number}</td>
        <td>${escapeHtml(inv.clientName || "—")}</td>
        <td>${fmtDate(inv.issueDate)}</td>
        <td>${fmtDate(inv.dueDate)}</td>
        <td><span class="badge ${inv.status}">${inv.status}</span></td>
        <td class="mono">${fmtMoney(inv.total, inv.currency)}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" title="Edit" data-edit="${inv.id}"><svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
            <button class="icon-btn del" title="Delete" data-del="${inv.id}"><svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>
          </div>
        </td>`;
      body.appendChild(tr);
    });

    body.querySelectorAll("[data-edit]").forEach(btn=>{
      btn.addEventListener("click", ()=> loadInvoiceIntoEditor(btn.getAttribute("data-edit")));
    });
    body.querySelectorAll("[data-del]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        pendingDeleteId = btn.getAttribute("data-del");
        document.getElementById("deleteModal").classList.add("open");
      });
    });
  }

  document.querySelectorAll('[data-status]').forEach(chip=>{
    chip.addEventListener("click", ()=>{
      document.querySelectorAll('[data-status]').forEach(c=>c.classList.remove("active"));
      chip.classList.add("active");
      currentStatusFilter = chip.getAttribute("data-status");
      renderInvoiceTable();
    });
  });
  document.getElementById("invoiceSearch").addEventListener("input", (e)=>{
    currentSearch = e.target.value;
    renderInvoiceTable();
  });

  document.getElementById("cancelDeleteBtn").addEventListener("click", ()=>{
    pendingDeleteId = null;
    document.getElementById("deleteModal").classList.remove("open");
  });
  document.getElementById("confirmDeleteBtn").addEventListener("click", async ()=>{
    if(pendingDeleteId){
      const id = pendingDeleteId;
      try{
        const { error } = await supa.from("invoices").delete().eq("id", id).eq("user_id", currentUser.id);
        if(error){ toast(friendlyError(error), "error"); }
        else{
          invoices = invoices.filter(i=>i.id !== id);
          toast("Invoice deleted");
        }
      }catch(err){
        console.error(err);
        toast(friendlyError(err), "error");
      }
    }
    pendingDeleteId = null;
    document.getElementById("deleteModal").classList.remove("open");
    renderInvoiceTable();
    renderDashboard();
  });

  /* =========================================================
     EDITOR — line items, calculations, preview
  ========================================================= */
  function newLineItemRow(item){
    const row = document.createElement("div");
    row.className = "line-item";
    row.innerHTML = `
      <input type="text" class="li-desc" placeholder="Description of work" value="${escapeHtml(item?.desc || "")}">
      <input type="number" class="li-qty" placeholder="Qty" min="0" value="${item?.qty ?? 1}">
      <input type="number" class="li-rate" placeholder="Rate" min="0" value="${item?.rate ?? 0}">
      <div class="amt">₦0.00</div>
      <button class="icon-btn del li-remove" title="Remove"><svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>`;
    row.querySelectorAll("input").forEach(inp=> inp.addEventListener("input", recalc));
    row.querySelector(".li-remove").addEventListener("click", ()=>{ row.remove(); recalc(); });
    return row;
  }

  document.getElementById("addLineBtn").addEventListener("click", ()=>{
    document.getElementById("lineItems").appendChild(newLineItemRow());
    recalc();
  });

  function getLineItems(){
    return [...document.querySelectorAll("#lineItems .line-item")].map(row=>{
      const desc = row.querySelector(".li-desc").value;
      const qty = Math.max(0, Number(row.querySelector(".li-qty").value) || 0);
      const rate = Math.max(0, Number(row.querySelector(".li-rate").value) || 0);
      return {desc, qty, rate};
    });
  }

  function recalc(){
    const items = getLineItems();
    const symbol = document.getElementById("currency").value;
    let subtotal = 0;

    document.querySelectorAll("#lineItems .line-item").forEach((row, idx)=>{
      const amt = items[idx].qty * items[idx].rate;
      row.querySelector(".amt").textContent = fmtMoney(amt, symbol);
      subtotal += amt;
    });

    const discountPct = Math.max(0, Number(document.getElementById("discountPercent").value) || 0);
    const taxPct = Math.max(0, Number(document.getElementById("taxPercent").value) || 0);
    const discountAmt = subtotal * (discountPct/100);
    const taxAmt = (subtotal - discountAmt) * (taxPct/100);
    const total = subtotal - discountAmt + taxAmt;

    document.getElementById("calcSubtotal").textContent = fmtMoney(subtotal, symbol);
    document.getElementById("calcDiscount").textContent = "-" + fmtMoney(discountAmt, symbol);
    document.getElementById("calcTax").textContent = "+" + fmtMoney(taxAmt, symbol);
    document.getElementById("calcTotal").textContent = fmtMoney(total, symbol);

    updatePreview({subtotal, discountAmt, taxAmt, total, items, symbol});
    return {subtotal, discountAmt, taxAmt, total, items, symbol};
  }

  function updatePreview(calc){
    const symbol = calc.symbol;
    document.getElementById("prevCompanyName").textContent = company.name || "Your Company";
    document.getElementById("prevCompanyMeta").textContent = [company.email, company.phone].filter(Boolean).join(" · ") || "company@email.com";
    document.getElementById("prevFromAddress").textContent = company.address || "Your company address";

    const logoImg = document.getElementById("prevLogo");
    if(company.logo){ logoImg.src = company.logo; logoImg.style.display = "block"; }
    else { logoImg.style.display = "none"; }

    document.getElementById("prevInvoiceNumber").textContent = document.getElementById("invoiceNumber").value || "LS-0001";
    document.getElementById("prevIssueDate").textContent = fmtDate(document.getElementById("issueDate").value);
    document.getElementById("prevDueDate").textContent = fmtDate(document.getElementById("dueDate").value);

    const status = document.getElementById("invoiceStatus").value;
    const badge = document.getElementById("prevStatusBadge");
    badge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    const colors = {paid:["#e6f4e6","#046C04"], unpaid:["#fdf3d9","#9a6b00"], draft:["#eee","#777"]};
    badge.style.background = colors[status][0];
    badge.style.color = colors[status][1];

    const clientName = document.getElementById("clientName").value || "Client name";
    const clientAddress = document.getElementById("clientAddress").value || "";
    document.getElementById("prevClientBlock").innerHTML = escapeHtml(clientName) + (clientAddress ? "<br>" + escapeHtml(clientAddress).replace(/\n/g,"<br>") : "");

    const tbody = document.getElementById("prevLineItems");
    tbody.innerHTML = "";
    calc.items.forEach(item=>{
      if(!item.desc && !item.qty && !item.rate) return;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(item.desc || "Untitled item")}</td><td>${item.qty}</td><td>${fmtMoney(item.rate, symbol)}</td><td style="text-align:right;">${fmtMoney(item.qty*item.rate, symbol)}</td>`;
      tbody.appendChild(tr);
    });

    document.getElementById("prevSubtotal").textContent = fmtMoney(calc.subtotal, symbol);
    document.getElementById("prevDiscount").textContent = "-" + fmtMoney(calc.discountAmt, symbol);
    document.getElementById("prevTax").textContent = "+" + fmtMoney(calc.taxAmt, symbol);
    document.getElementById("prevTotal").textContent = fmtMoney(calc.total, symbol);

    const bankBlock = document.getElementById("prevBankDetails");
    if(bank.accountNumber || bank.bankName){
      bankBlock.innerHTML = `
        ${bank.bankName ? "Bank: " + escapeHtml(bank.bankName) + "<br>" : ""}
        ${bank.accountName ? "Account name: " + escapeHtml(bank.accountName) + "<br>" : ""}
        ${bank.accountNumber ? "Account number: " + escapeHtml(bank.accountNumber) + "<br>" : ""}
        ${bank.iban ? "IBAN: " + escapeHtml(bank.iban) + "<br>" : ""}
        ${bank.swift ? "SWIFT/BIC: " + escapeHtml(bank.swift) : ""}`;
    } else {
      bankBlock.textContent = "No bank details saved yet — add them in Bank Details.";
    }

    document.getElementById("prevNotes").textContent = document.getElementById("invoiceNotes").value || "";
  }

  ["clientName","clientEmail","clientAddress","invoiceNumber","invoiceStatus","issueDate","dueDate","currency","taxPercent","discountPercent","invoiceNotes"]
    .forEach(id => document.getElementById(id).addEventListener("input", recalc));
  document.getElementById("invoiceStatus").addEventListener("change", recalc);
  document.getElementById("currency").addEventListener("change", recalc);

  function nextInvoiceNumber(){
    // Based on the highest existing "LS-####" suffix, not just invoice count,
    // so numbers stay unique even after invoices are deleted.
    let max = 0;
    invoices.forEach(inv=>{
      const match = (inv.number || "").match(/(\d+)$/);
      if(match) max = Math.max(max, parseInt(match[1], 10));
    });
    return "LS-" + String(max + 1).padStart(4,"0");
  }

  function resetEditor(){
    editingInvoiceId = null;
    document.getElementById("editorTitle").textContent = "Create Invoice";
    document.getElementById("invoiceId").value = "";
    document.getElementById("clientName").value = "";
    document.getElementById("clientEmail").value = "";
    document.getElementById("clientAddress").value = "";
    document.getElementById("invoiceNumber").value = nextInvoiceNumber();
    document.getElementById("invoiceStatus").value = "unpaid";
    const today = new Date().toISOString().slice(0,10);
    document.getElementById("issueDate").value = today;
    const due = new Date(); due.setDate(due.getDate()+14);
    document.getElementById("dueDate").value = due.toISOString().slice(0,10);
    document.getElementById("currency").value = "₦";
    document.getElementById("taxPercent").value = 0;
    document.getElementById("discountPercent").value = 0;
    document.getElementById("invoiceNotes").value = "Thank you for your business! Payment is due within 14 days.";
    document.getElementById("lineItems").innerHTML = "";
    document.getElementById("lineItems").appendChild(newLineItemRow({desc:"", qty:1, rate:0}));
    recalc();
  }

  function loadInvoiceIntoEditor(id){
    const inv = invoices.find(i=>i.id === id);
    if(!inv) return;
    editingInvoiceId = id;
    document.getElementById("editorTitle").textContent = "Edit Invoice";
    document.getElementById("invoiceId").value = inv.id;
    document.getElementById("clientName").value = inv.clientName || "";
    document.getElementById("clientEmail").value = inv.clientEmail || "";
    document.getElementById("clientAddress").value = inv.clientAddress || "";
    document.getElementById("invoiceNumber").value = inv.number || "";
    document.getElementById("invoiceStatus").value = inv.status || "unpaid";
    document.getElementById("issueDate").value = inv.issueDate || "";
    document.getElementById("dueDate").value = inv.dueDate || "";
    document.getElementById("currency").value = inv.currency || "₦";
    document.getElementById("taxPercent").value = inv.taxPercent || 0;
    document.getElementById("discountPercent").value = inv.discountPercent || 0;
    document.getElementById("invoiceNotes").value = inv.notes || "";
    document.getElementById("lineItems").innerHTML = "";
    (inv.items && inv.items.length ? inv.items : [{desc:"",qty:1,rate:0}]).forEach(item=>{
      document.getElementById("lineItems").appendChild(newLineItemRow(item));
    });
    recalc();
    showView("editor");
  }

  document.getElementById("saveInvoiceBtn").addEventListener("click", async ()=>{
    const calc = recalc();
    const clientName = document.getElementById("clientName").value.trim();
    if(!clientName){
      toast("Add a client name before saving", "error");
      document.getElementById("clientName").focus();
      return;
    }

    const payload = {
      id: editingInvoiceId,
      number: document.getElementById("invoiceNumber").value.trim() || nextInvoiceNumber(),
      clientName,
      clientEmail: document.getElementById("clientEmail").value.trim(),
      clientAddress: document.getElementById("clientAddress").value.trim(),
      status: document.getElementById("invoiceStatus").value,
      issueDate: document.getElementById("issueDate").value,
      dueDate: document.getElementById("dueDate").value,
      currency: document.getElementById("currency").value,
      taxPercent: Number(document.getElementById("taxPercent").value)||0,
      discountPercent: Number(document.getElementById("discountPercent").value)||0,
      notes: document.getElementById("invoiceNotes").value.trim(),
      items: calc.items,
      subtotal: calc.subtotal,
      discountAmt: calc.discountAmt,
      taxAmt: calc.taxAmt,
      total: calc.total
    };

    const done = setBusy(document.getElementById("saveInvoiceBtn"), "Saving…");
    try{
      if(editingInvoiceId){
        const { data, error } = await supa.from("invoices")
          .update(toDbInvoice(payload, currentUser.id))
          .eq("id", editingInvoiceId).eq("user_id", currentUser.id)
          .select().single();
        if(error){ toast(friendlyError(error), "error"); return; }
        invoices = invoices.map(i => i.id === editingInvoiceId ? fromDbInvoice(data) : i);
        toast("Invoice updated");
      } else {
        const { data, error } = await supa.from("invoices")
          .insert(toDbInvoice(payload, currentUser.id))
          .select().single();
        if(error){ toast(friendlyError(error), "error"); return; }
        const saved = fromDbInvoice(data);
        invoices.push(saved);
        editingInvoiceId = saved.id;
        document.getElementById("invoiceId").value = saved.id;
        document.getElementById("editorTitle").textContent = "Edit Invoice";
        toast("Invoice saved");
      }
      renderInvoiceTable();
    }catch(err){
      console.error(err);
      toast(friendlyError(err), "error");
    }finally{
      done();
    }
  });

  document.getElementById("printBtn").addEventListener("click", ()=> window.print());

  /* ---------------- Download PDF (editor) ---------------- */
  document.getElementById("downloadPdfBtn").addEventListener("click", async ()=>{
    const done = setBusy(document.getElementById("downloadPdfBtn"), "Generating…");
    try{
      const el = document.getElementById("invoicePreview");
      const canvas = await html2canvas(el, {scale:2, backgroundColor:"#ffffff"});
      const imgData = canvas.toDataURL("image/png");
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF("p","mm","a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const imgHeight = (canvas.height * pageWidth) / canvas.width;
      pdf.addImage(imgData, "PNG", 0, 0, pageWidth, imgHeight);
      const number = document.getElementById("invoiceNumber").value.trim() || "invoice";
      pdf.save(number + ".pdf");
      toast("PDF downloaded");
    }catch(err){
      toast("Couldn't generate the PDF — try again", "error");
    }
    done();
  });

  /* ---------------- Share link (editor) ---------------- */
  const shareModal = document.getElementById("shareModal");
  document.getElementById("shareBtn").addEventListener("click", ()=>{
    const calc = recalc();
    const clientName = document.getElementById("clientName").value.trim();
    if(!clientName){ toast("Add a client name first", "error"); return; }

    const payload = {
      number: document.getElementById("invoiceNumber").value.trim(),
      clientName,
      clientAddress: document.getElementById("clientAddress").value.trim(),
      issueDate: document.getElementById("issueDate").value,
      dueDate: document.getElementById("dueDate").value,
      status: document.getElementById("invoiceStatus").value,
      currency: document.getElementById("currency").value,
      items: calc.items.filter(it => it.desc || it.qty || it.rate),
      subtotal: calc.subtotal,
      discountAmt: calc.discountAmt,
      taxAmt: calc.taxAmt,
      total: calc.total,
      notes: document.getElementById("invoiceNotes").value.trim(),
      companyName: company.name,
      companyEmail: company.email,
      companyPhone: company.phone,
      companyAddress: company.address,
      companyLogo: company.logo,
      bank: bank
    };

    const encoded = encodeURIComponent(b64EncodeUnicode(JSON.stringify(payload)));
    const link = new URL("invoice-view.html", window.location.href).toString() + "#d=" + encoded;

    document.getElementById("shareLinkInput").value = link;
    document.getElementById("whatsappShareBtn").href = "https://wa.me/?text=" + encodeURIComponent("Here's your invoice: " + link);
    document.getElementById("emailShareBtn").href = "mailto:" + encodeURIComponent(document.getElementById("clientEmail").value.trim()) +
      "?subject=" + encodeURIComponent("Invoice " + payload.number) + "&body=" + encodeURIComponent("Hi " + clientName + ",\n\nHere is your invoice: " + link);

    shareModal.classList.add("open");
  });
  document.getElementById("closeShareModalBtn").addEventListener("click", ()=> shareModal.classList.remove("open"));
  document.getElementById("copyShareLinkBtn").addEventListener("click", async ()=>{
    const input = document.getElementById("shareLinkInput");
    try{
      await navigator.clipboard.writeText(input.value);
      toast("Link copied to clipboard");
    }catch(e){
      input.select();
      document.execCommand("copy");
      toast("Link copied to clipboard");
    }
  });
  document.getElementById("nativeShareBtn").addEventListener("click", async ()=>{
    const link = document.getElementById("shareLinkInput").value;
    if(navigator.share){
      try{ await navigator.share({title:"Invoice", url: link}); }catch(e){}
    } else {
      toast("Device sharing isn't supported here — link copied instead");
      try{ await navigator.clipboard.writeText(link); }catch(e){}
    }
  });

  /* =========================================================
     COMPANY SETTINGS
  ========================================================= */
  function loadCompanyForm(){
    document.getElementById("companyName").value = company.name || "";
    document.getElementById("companyEmail").value = company.email || "";
    document.getElementById("companyPhone").value = company.phone || "";
    document.getElementById("companyAddress").value = company.address || "";
    updateLogoPreview();
  }
  function updateLogoPreview(){
    const preview = document.getElementById("logoPreview");
    preview.innerHTML = company.logo ? `<img src="${company.logo}" alt="Company logo">` : '<svg class="icon-lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
  }

  const logoUpload = document.getElementById("logoUpload");
  const logoInput = document.getElementById("logoInput");
  logoUpload.addEventListener("click", ()=> logoInput.click());
  logoInput.addEventListener("change", (e)=> handleLogoFile(e.target.files[0]));
  ["dragover","dragenter"].forEach(evt=>{
    logoUpload.addEventListener(evt, (e)=>{ e.preventDefault(); logoUpload.classList.add("dragover"); });
  });
  ["dragleave","drop"].forEach(evt=>{
    logoUpload.addEventListener(evt, (e)=>{ e.preventDefault(); logoUpload.classList.remove("dragover"); });
  });
  logoUpload.addEventListener("drop", (e)=>{
    const file = e.dataTransfer.files[0];
    if(file) handleLogoFile(file);
  });
  function handleLogoFile(file){
    if(!file) return;
    if(!file.type.startsWith("image/")){ toast("Please upload an image file", "error"); return; }
    if(file.size > 2 * 1024 * 1024){ toast("Logo should be under 2MB", "error"); return; }
    const reader = new FileReader();
    reader.onload = (e)=>{
      company.logo = e.target.result;
      updateLogoPreview();
      toast("Logo added — remember to save");
    };
    reader.readAsDataURL(file);
  }
  document.getElementById("removeLogoBtn").addEventListener("click", ()=>{
    company.logo = "";
    updateLogoPreview();
  });

  document.getElementById("saveCompanyBtn").addEventListener("click", async ()=>{
    const done = setBusy(document.getElementById("saveCompanyBtn"), "Saving…");
    const next = {
      user_id: currentUser.id,
      name: document.getElementById("companyName").value.trim(),
      email: document.getElementById("companyEmail").value.trim(),
      phone: document.getElementById("companyPhone").value.trim(),
      address: document.getElementById("companyAddress").value.trim(),
      logo: company.logo || "",
      updated_at: new Date().toISOString()
    };
    try{
      const { error } = await supa.from("companies").upsert(next, { onConflict: "user_id" });
      if(error){ toast(friendlyError(error), "error"); return; }
      company = fromDbCompany(next);
      toast("Company details saved");
    }catch(err){
      console.error(err);
      toast(friendlyError(err), "error");
    }finally{
      done();
    }
  });

  /* =========================================================
     BANK SETTINGS
  ========================================================= */
  function loadBankForm(){
    document.getElementById("bankName").value = bank.bankName || "";
    document.getElementById("accountName").value = bank.accountName || "";
    document.getElementById("accountNumber").value = bank.accountNumber || "";
    document.getElementById("iban").value = bank.iban || "";
    document.getElementById("swift").value = bank.swift || "";
  }

  document.getElementById("saveBankBtn").addEventListener("click", async ()=>{
    const done = setBusy(document.getElementById("saveBankBtn"), "Saving…");
    const next = {
      user_id: currentUser.id,
      bank_name: document.getElementById("bankName").value.trim(),
      account_name: document.getElementById("accountName").value.trim(),
      account_number: document.getElementById("accountNumber").value.trim(),
      iban: document.getElementById("iban").value.trim(),
      swift: document.getElementById("swift").value.trim(),
      updated_at: new Date().toISOString()
    };
    try{
      const { error } = await supa.from("bank_details").upsert(next, { onConflict: "user_id" });
      if(error){ toast(friendlyError(error), "error"); return; }
      bank = fromDbBank(next);
      toast("Bank details saved");
    }catch(err){
      console.error(err);
      toast(friendlyError(err), "error");
    }finally{
      done();
    }
  });

  /* =========================================================
     PROFILE
  ========================================================= */
  function initials(name){
    if(!name) return "U";
    return name.trim().split(/\s+/).slice(0,2).map(s=>s[0].toUpperCase()).join("");
  }
  function updateSidebarUser(){
    document.getElementById("sidebarUserName").textContent = currentUser.name || currentUser.email;
    document.getElementById("sidebarUserEmail").textContent = currentUser.email || "";
    const av = document.getElementById("sidebarAvatar");
    av.innerHTML = currentUser.avatar ? `<img src="${currentUser.avatar}" alt="">` : initials(currentUser.name || currentUser.email);
  }
  function loadProfileForm(){
    document.getElementById("profileName").value = currentUser.name || "";
    document.getElementById("profileEmail").value = currentUser.email || "";
    document.getElementById("profileNameDisplay").textContent = currentUser.name || "";
    document.getElementById("profileEmailDisplay").textContent = currentUser.email || "";
    const av = document.getElementById("profileAvatar");
    av.innerHTML = currentUser.avatar ? `<img src="${currentUser.avatar}" alt="">` : initials(currentUser.name || currentUser.email);
  }

  document.getElementById("profileAvatarUpload").addEventListener("click", ()=>{
    document.getElementById("profileAvatarInput").click();
  });
  document.getElementById("profileAvatarInput").addEventListener("change", async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    if(!file.type.startsWith("image/")){ toast("Please upload an image file", "error"); return; }
    const reader = new FileReader();
    reader.onload = async (ev)=>{
      currentUser.avatar = ev.target.result;
      try{
        const { error } = await supa.from("profiles").upsert(
          { id: currentUser.id, name: currentUser.name, avatar_url: currentUser.avatar }, { onConflict:"id" }
        );
        if(error){ toast(friendlyError(error), "error"); return; }
        loadProfileForm();
        updateSidebarUser();
        toast("Profile photo updated");
      }catch(err){
        console.error(err);
        toast(friendlyError(err), "error");
      }
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("saveProfileBtn").addEventListener("click", async ()=>{
    const name = document.getElementById("profileName").value.trim();
    const email = document.getElementById("profileEmail").value.trim();
    if(!name || !email){ toast("Name and email can't be empty", "error"); return; }

    const done = setBusy(document.getElementById("saveProfileBtn"), "Saving…");
    try{
      const { error: profileError } = await supa.from("profiles").upsert(
        { id: currentUser.id, name, avatar_url: currentUser.avatar || "" }, { onConflict:"id" }
      );
      if(profileError){ toast(friendlyError(profileError), "error"); return; }
      currentUser.name = name;

      if(email !== currentUser.email){
        const { error: emailError } = await supa.auth.updateUser({ email });
        if(emailError){ toast(friendlyError(emailError), "error"); return; }
        toast("Profile saved — check your new email to confirm the change");
      } else {
        toast("Profile saved");
      }
      loadProfileForm();
      updateSidebarUser();
    }catch(err){
      console.error(err);
      toast(friendlyError(err), "error");
    }finally{
      done();
    }
  });

  document.getElementById("changePasswordBtn").addEventListener("click", async ()=>{
    const current = document.getElementById("currentPassword").value;
    const next = document.getElementById("newPassword").value;
    if(next.length < 6){ toast("New password should be at least 6 characters", "error"); return; }

    const done = setBusy(document.getElementById("changePasswordBtn"), "Updating…");
    try{
      const { error: verifyError } = await supa.auth.signInWithPassword({ email: currentUser.email, password: current });
      if(verifyError){ toast("Current password is incorrect", "error"); return; }

      const { error } = await supa.auth.updateUser({ password: next });
      if(error){ toast(friendlyError(error), "error"); return; }
      document.getElementById("currentPassword").value = "";
      document.getElementById("newPassword").value = "";
      toast("Password updated");
    }catch(err){
      console.error(err);
      toast(friendlyError(err), "error");
    }finally{
      done();
    }
  });

  const deleteAccountModal = document.getElementById("deleteAccountModal");
  document.getElementById("deleteAccountBtn").addEventListener("click", ()=> deleteAccountModal.classList.add("open"));
  document.getElementById("cancelDeleteAccountBtn").addEventListener("click", ()=> deleteAccountModal.classList.remove("open"));
  document.getElementById("confirmDeleteAccountBtn").addEventListener("click", async ()=>{
    const done = setBusy(document.getElementById("confirmDeleteAccountBtn"), "Deleting…");
    try{
      const uidVal = currentUser.id;
      const results = await Promise.all([
        supa.from("invoices").delete().eq("user_id", uidVal),
        supa.from("companies").delete().eq("user_id", uidVal),
        supa.from("bank_details").delete().eq("user_id", uidVal)
      ]);
      const failed = results.find(r=>r.error);
      if(failed){ toast(friendlyError(failed.error), "error"); return; }
      deleteAccountModal.classList.remove("open");
      toast("Your data has been deleted");
      await logOut();
    }catch(err){
      console.error(err);
      toast(friendlyError(err), "error");
    }finally{
      done();
    }
  });

  /* =========================================================
     INIT
  ========================================================= */
  /* =========================================================
     INIT
  ========================================================= */
  function init(){
    if(supa.auth.isPasswordRecovery && supa.auth.isPasswordRecovery()){
      authScreen.style.display = "none";
      document.getElementById("recoveryScreen").style.display = "flex";
      return;
    }
    tryResumeSession();
  }
  init();
})();