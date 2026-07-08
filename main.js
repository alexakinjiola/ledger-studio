/* =========================================================
   LEDGER STUDIO — App logic (app.html only)
   Handles: views, invoices (CRUD), dashboard, company & bank
   settings, logo upload, live invoice preview, printing.
   Data persists in localStorage — everything stays on this device.
========================================================= */

(function(){
  "use strict";

  /* ---------------- Storage keys ---------------- */
  const K_COMPANY   = "ls_company";
  const K_BANK      = "ls_bank";
  const K_INVOICES  = "ls_invoices";

  /* ---------------- Storage helpers ---------------- */
  const store = {
    get(key, fallback){
      try{
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      }catch(e){ return fallback; }
    },
    set(key, value){
      localStorage.setItem(key, JSON.stringify(value));
    }
  };

  let company  = store.get(K_COMPANY, {name:"", email:"", phone:"", address:"", logo:""});
  let bank     = store.get(K_BANK, {bankName:"", accountName:"", accountNumber:"", iban:"", swift:""});
  let invoices = store.get(K_INVOICES, []);

  let currentDurationRange = "all";
  let currentStatusFilter  = "all";
  let currentSearch        = "";
  let editingInvoiceId     = null;
  let pendingDeleteId      = null;

  const uid = ()=> "inv_" + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  const fmtMoney = (num, symbol)=> (symbol||"₦") + Number(num||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtDate = (d)=>{
    if(!d) return "—";
    const dt = new Date(d + "T00:00:00");
    if(isNaN(dt)) return d;
    return dt.toLocaleDateString(undefined,{month:"short", day:"numeric", year:"numeric"});
  };

  /* ---------------- Toast ---------------- */
  function toast(msg, type){
    const wrap = document.getElementById("toastWrap");
    if(!wrap) return;
    const el = document.createElement("div");
    el.className = "toast " + (type || "success");
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(()=>{ el.style.opacity="0"; el.style.transform="translateY(10px)"; setTimeout(()=>el.remove(), 300); }, 2600);
  }

  /* ---------------- View switching ---------------- */
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
    window.scrollTo({top:0, behavior:"smooth"});
  }

  document.querySelectorAll("[data-view]").forEach(el=>{
    el.addEventListener("click", (e)=>{
      e.preventDefault();
      const view = el.getAttribute("data-view");
      if(view === "editor" && el.id === "newInvoiceLink" || (view === "editor" && el.textContent.includes("New"))){
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
            <button class="icon-btn" title="Edit" data-edit="${inv.id}">✎</button>
            <button class="icon-btn del" title="Delete" data-del="${inv.id}">🗑</button>
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

  /* Delete modal */
  document.getElementById("cancelDeleteBtn").addEventListener("click", ()=>{
    pendingDeleteId = null;
    document.getElementById("deleteModal").classList.remove("open");
  });
  document.getElementById("confirmDeleteBtn").addEventListener("click", ()=>{
    if(pendingDeleteId){
      invoices = invoices.filter(i=>i.id !== pendingDeleteId);
      store.set(K_INVOICES, invoices);
      toast("Invoice deleted");
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
      <input type="text" class="li-desc" placeholder="Description of work" value="${escapeAttr(item?.desc || "")}">
      <input type="number" class="li-qty" placeholder="Qty" min="0" value="${item?.qty ?? 1}">
      <input type="number" class="li-rate" placeholder="Rate" min="0" value="${item?.rate ?? 0}">
      <div class="amt">$0.00</div>
      <button class="icon-btn del li-remove" title="Remove">✕</button>`;
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
      const qty = Number(row.querySelector(".li-qty").value) || 0;
      const rate = Number(row.querySelector(".li-rate").value) || 0;
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

    const discountPct = Number(document.getElementById("discountPercent").value) || 0;
    const taxPct = Number(document.getElementById("taxPercent").value) || 0;
    const discountAmt = subtotal * (discountPct/100);
    const taxAmt = (subtotal - discountAmt) * (taxPct/100);
    const total = subtotal - discountAmt + taxAmt;

    document.getElementById("calcSubtotal").textContent = fmtMoney(subtotal, symbol);
    document.getElementById("calcDiscount").textContent = "-" + fmtMoney(discountAmt, symbol);
    document.getElementById("calcTax").textContent = "+" + fmtMoney(taxAmt, symbol);
    document.getElementById("calcTotal").textContent = fmtMoney(total, symbol);

    updatePreview({subtotal, discountAmt, taxAmt, total, items, symbol});
    return {subtotal, discountAmt, taxAmt, total};
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

  function nextInvoiceNumber(){
    const n = invoices.length + 1;
    return "LS-" + String(n).padStart(4,"0");
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

  document.getElementById("saveInvoiceBtn").addEventListener("click", ()=>{
    const calc = recalc();
    const clientName = document.getElementById("clientName").value.trim();
    if(!clientName){
      toast("Add a client name before saving", "error");
      document.getElementById("clientName").focus();
      return;
    }
    const data = {
      id: editingInvoiceId || uid(),
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
      items: getLineItems(),
      subtotal: calc.subtotal,
      total: calc.total,
      createdAt: editingInvoiceId ? (invoices.find(i=>i.id===editingInvoiceId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if(editingInvoiceId){
      invoices = invoices.map(i => i.id === editingInvoiceId ? data : i);
      toast("Invoice updated");
    } else {
      invoices.push(data);
      toast("Invoice saved");
    }
    store.set(K_INVOICES, invoices);
    editingInvoiceId = data.id;
    document.getElementById("invoiceId").value = data.id;
    document.getElementById("editorTitle").textContent = "Edit Invoice";
    renderInvoiceTable();
  });

  document.getElementById("printBtn").addEventListener("click", ()=> window.print());

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
    if(company.logo){
      preview.innerHTML = `<img src="${company.logo}" alt="Company logo">`;
    } else {
      preview.innerHTML = "🏢";
    }
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

  document.getElementById("saveCompanyBtn").addEventListener("click", ()=>{
    company = {
      name: document.getElementById("companyName").value.trim(),
      email: document.getElementById("companyEmail").value.trim(),
      phone: document.getElementById("companyPhone").value.trim(),
      address: document.getElementById("companyAddress").value.trim(),
      logo: company.logo || ""
    };
    store.set(K_COMPANY, company);
    toast("Company details saved");
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

  document.getElementById("saveBankBtn").addEventListener("click", ()=>{
    bank = {
      bankName: document.getElementById("bankName").value.trim(),
      accountName: document.getElementById("accountName").value.trim(),
      accountNumber: document.getElementById("accountNumber").value.trim(),
      iban: document.getElementById("iban").value.trim(),
      swift: document.getElementById("swift").value.trim()
    };
    store.set(K_BANK, bank);
    toast("Bank details saved");
  });

  /* ---------------- utils ---------------- */
  function escapeHtml(str){
    return String(str||"").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  }
  function escapeAttr(str){ return escapeHtml(str); }

  /* ---------------- init ---------------- */
  resetEditor();
  renderDashboard();
})();