/* ============================================================
   LEDGER — INVOICE STUDIO
   App logic
   ============================================================ */
(() => {
  "use strict";

  const STORAGE_KEY = "ledger_invoice_v1";

  /* ---------- element refs ---------- */
  const el = (id) => document.getElementById(id);

  const fields = {
    fromName: el("fromName"), fromEmail: el("fromEmail"),
    fromPhone: el("fromPhone"), fromAddress: el("fromAddress"),
    toName: el("toName"), toEmail: el("toEmail"), toAddress: el("toAddress"),
    invNumber: el("invNumber"), currency: el("currency"),
    invDate: el("invDate"), dueDate: el("dueDate"),
    taxRate: el("taxRate"), discountRate: el("discountRate"),
    notes: el("notes"),
  };

  const itemsList = el("itemsList");
  const rowTemplate = el("rowTemplate");
  const addItemBtn = el("addItemBtn");
  const generateBtn = el("generateBtn");
  const downloadBtn = el("downloadBtn");
  const resetBtn = el("resetBtn");
  const seal = el("seal");

  const preview = {
    fromName: el("pFromName"), fromEmail: el("pFromEmail"),
    fromPhone: el("pFromPhone"), fromAddress: el("pFromAddress"),
    toName: el("pToName"), toEmail: el("pToEmail"), toAddress: el("pToAddress"),
    invNumber: el("pInvNumber"), invDate: el("pInvDate"), dueDate: el("pDueDate"),
    itemsBody: el("pItemsBody"),
    subtotal: el("pSubtotal"), discount: el("pDiscount"), tax: el("pTax"), total: el("pTotal"),
    discountRow: el("pDiscountRow"), taxRow: el("pTaxRow"),
    notes: el("pNotes"),
  };

  /* ---------- state ---------- */
  let items = []; // {id, desc, qty, rate}
  let itemUid = 0;

  const money = (n, symbol) => {
    const val = isFinite(n) ? n : 0;
    return `${symbol}${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const fmtDate = (isoStr) => {
    if (!isoStr) return "—";
    const d = new Date(isoStr + "T00:00:00");
    if (isNaN(d)) return "—";
    return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
  };

  /* ---------- line item rows (form side) ---------- */
  function addItem(data = {}) {
    const id = ++itemUid;
    items.push({
      id,
      desc: data.desc ?? "",
      qty: data.qty ?? 1,
      rate: data.rate ?? 0,
    });
    renderFormRow(id);
    syncAndSave();
  }

  function renderFormRow(id) {
    const node = rowTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = id;
    const item = items.find((i) => i.id === id);

    const descInput = node.querySelector(".item-desc");
    const qtyInput = node.querySelector(".item-qty");
    const rateInput = node.querySelector(".item-rate");
    const amountSpan = node.querySelector(".item-amount");
    const removeBtn = node.querySelector(".item-remove");

    descInput.value = item.desc;
    qtyInput.value = item.qty;
    rateInput.value = item.rate;

    const updateAmount = () => {
      const amt = (parseFloat(qtyInput.value) || 0) * (parseFloat(rateInput.value) || 0);
      amountSpan.textContent = money(amt, fields.currency.value);
    };
    updateAmount();

    descInput.addEventListener("input", () => { item.desc = descInput.value; syncAndSave(); });
    qtyInput.addEventListener("input", () => { item.qty = parseFloat(qtyInput.value) || 0; updateAmount(); syncAndSave(); });
    rateInput.addEventListener("input", () => { item.rate = parseFloat(rateInput.value) || 0; updateAmount(); syncAndSave(); });

    removeBtn.addEventListener("click", () => {
      node.style.transition = "opacity .25s ease, transform .25s ease";
      node.style.opacity = "0";
      node.style.transform = "translateX(-8px)";
      setTimeout(() => {
        items = items.filter((i) => i.id !== id);
        node.remove();
        syncAndSave();
      }, 200);
    });

    itemsList.appendChild(node);
  }

  function clearAllItemRows() {
    itemsList.innerHTML = "";
    items = [];
  }

  /* ---------- preview rendering ---------- */
  function renderPreview() {
    const symbol = fields.currency.value;

    preview.fromName.textContent = fields.fromName.value || "Your Business Name";
    preview.fromEmail.textContent = fields.fromEmail.value || "";
    preview.fromPhone.textContent = fields.fromPhone.value || "";
    preview.fromAddress.textContent = fields.fromAddress.value || "";

    preview.toName.textContent = fields.toName.value || "Client name";
    preview.toEmail.textContent = fields.toEmail.value || "";
    preview.toAddress.textContent = fields.toAddress.value || "";

    preview.invNumber.textContent = fields.invNumber.value || "—";
    preview.invDate.textContent = fmtDate(fields.invDate.value);
    preview.dueDate.textContent = fmtDate(fields.dueDate.value);

    preview.notes.textContent = fields.notes.value || "";

    /* items table */
    preview.itemsBody.innerHTML = "";
    if (items.length === 0) {
      const tr = document.createElement("tr");
      tr.className = "empty-row";
      tr.innerHTML = `<td colspan="4">Add a line item to see it appear here</td>`;
      preview.itemsBody.appendChild(tr);
    } else {
      items.forEach((item, i) => {
        const amt = (item.qty || 0) * (item.rate || 0);
        const tr = document.createElement("tr");
        tr.style.animationDelay = `${i * 40}ms`;
        tr.innerHTML = `
          <td class="row-desc">${escapeHtml(item.desc) || "Untitled item"}</td>
          <td class="row-qty">${item.qty || 0}</td>
          <td class="row-rate">${money(item.rate || 0, symbol)}</td>
          <td class="row-amount">${money(amt, symbol)}</td>
        `;
        preview.itemsBody.appendChild(tr);
      });
    }

    /* totals */
    const subtotal = items.reduce((sum, i) => sum + (i.qty || 0) * (i.rate || 0), 0);
    const discountRate = parseFloat(fields.discountRate.value) || 0;
    const taxRate = parseFloat(fields.taxRate.value) || 0;
    const discountAmt = subtotal * (discountRate / 100);
    const taxable = subtotal - discountAmt;
    const taxAmt = taxable * (taxRate / 100);
    const total = taxable + taxAmt;

    preview.subtotal.textContent = money(subtotal, symbol);
    preview.discount.textContent = `− ${money(discountAmt, symbol)}`;
    preview.tax.textContent = money(taxAmt, symbol);
    preview.total.textContent = money(total, symbol);

    preview.discountRow.style.display = discountRate > 0 ? "flex" : "none";
    preview.taxRow.style.display = taxRate > 0 ? "flex" : "none";
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function syncAndSave() {
    renderPreview();
    saveState();
  }

  /* ---------- persistence (localStorage) ---------- */
  function saveState() {
    const state = {
      values: Object.fromEntries(Object.entries(fields).map(([k, node]) => [k, node.value])),
      items,
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function loadState() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) {}

    if (saved && saved.values) {
      Object.entries(saved.values).forEach(([k, v]) => {
        if (fields[k]) fields[k].value = v;
      });
    } else {
      fields.invDate.value = new Date().toISOString().slice(0, 10);
      const due = new Date();
      due.setDate(due.getDate() + 14);
      fields.dueDate.value = due.toISOString().slice(0, 10);
      fields.invNumber.value = generateInvoiceNumber();
    }

    clearAllItemRows();
    if (saved && Array.isArray(saved.items) && saved.items.length) {
      saved.items.forEach((it) => addItem(it));
    } else {
      addItem({ desc: "", qty: 1, rate: 0 });
    }
  }

  function generateInvoiceNumber() {
    const now = new Date();
    const y = now.getFullYear();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `INV-${y}-${rand}`;
  }

  /* ---------- events ---------- */
  Object.values(fields).forEach((node) => {
    node.addEventListener("input", syncAndSave);
    node.addEventListener("change", syncAndSave);
  });

  addItemBtn.addEventListener("click", () => addItem({ desc: "", qty: 1, rate: 0 }));

  resetBtn.addEventListener("click", () => {
    if (!confirm("Clear this invoice and start fresh?")) return;
    localStorage.removeItem(STORAGE_KEY);
    Object.values(fields).forEach((node) => (node.value = ""));
    fields.currency.value = "₦";
    fields.notes.value = "Payment due within 14 days. Thank you for your business.";
    loadState();
    syncAndSave();
  });

  generateBtn.addEventListener("click", () => {
    seal.classList.remove("stamped");
    void seal.offsetWidth; // restart animation
    seal.classList.add("stamped");
    document.querySelector(".paper").scrollIntoView({ behavior: "smooth", block: "start" });
    generateBtn.querySelector("span").textContent = "Generated ✓";
    setTimeout(() => { generateBtn.querySelector("span").textContent = "Generate invoice"; }, 1800);
  });

  downloadBtn.addEventListener("click", () => {
    window.print();
  });

  /* ---------- init ---------- */
  loadState();
  renderPreview();

  /* remove intro curtain from tab order / interaction once it lifts */
  setTimeout(() => {
    const curtain = el("curtain");
    if (curtain) curtain.style.pointerEvents = "none";
  }, 2900);
})();