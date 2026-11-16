/* =========================================================
   LEDGER STUDIO — Public invoice viewer
   Reads invoice data encoded in the URL hash (#d=...) and
   renders a read-only invoice. No login or storage needed.
========================================================= */

(function(){
  "use strict";

  function b64DecodeUnicode(str){
    return decodeURIComponent(atob(str).split("").map(c=>"%"+("00"+c.charCodeAt(0).toString(16)).slice(-2)).join(""));
  }

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

  function getData(){
    const hash = window.location.hash;
    const match = hash.match(/#d=(.+)/);
    if(!match) return null;
    try{
      const json = b64DecodeUnicode(decodeURIComponent(match[1]));
      return JSON.parse(json);
    }catch(e){ return null; }
  }

  function render(data){
    const container = document.getElementById("invoiceContainer");
    const symbol = data.currency || "₦";
    const colors = {paid:["#E2F5EB","#0B7A44"], unpaid:["#FFF1D9","#8F5600"], draft:["#EEF0F6","#45486A"]};
    const statusColor = colors[data.status] || colors.draft;

    // Images arrive via the URL, so only accept our own compressed data URLs
    // or files from this app's public Supabase Storage bucket.
    const SAFE_DATA_IMG = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;
    const SAFE_STORAGE_IMG = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/invoice-images\/[A-Za-z0-9/_.-]+$/;
    const safeImg = (src)=> (typeof src === "string" && (SAFE_DATA_IMG.test(src) || SAFE_STORAGE_IMG.test(src))) ? src : "";
    const logo = safeImg(data.companyLogo);

    const itemsHtml = (data.items || []).map(item => {
      const img = safeImg(item.image);
      const desc = escapeHtml(item.desc || "Untitled item");
      return `
      <tr>
        <td>${img ? `<div class="item-cell"><img class="item-img" src="${img}" alt="" crossorigin="anonymous"><span>${desc}</span></div>` : desc}</td>
        <td>${item.qty}</td>
        <td>${fmtMoney(item.rate, symbol)}</td>
        <td style="text-align:right;">${fmtMoney(item.qty*item.rate, symbol)}</td>
      </tr>`;
    }).join("");

    const bankHtml = (data.bank && (data.bank.accountNumber || data.bank.bankName)) ? `
      ${data.bank.bankName ? "Bank: " + escapeHtml(data.bank.bankName) + "<br>" : ""}
      ${data.bank.accountName ? "Account name: " + escapeHtml(data.bank.accountName) + "<br>" : ""}
      ${data.bank.accountNumber ? "Account number: " + escapeHtml(data.bank.accountNumber) + "<br>" : ""}
      ${data.bank.iban ? "IBAN: " + escapeHtml(data.bank.iban) + "<br>" : ""}
      ${data.bank.swift ? "SWIFT/BIC: " + escapeHtml(data.bank.swift) : ""}
    ` : "No bank details were provided.";

    container.innerHTML = `
      <div class="invoice-preview" id="invoicePreview">
        <div class="inv-band">
          <div class="inv-brand">
            ${logo ? `<img class="prev-logo" src="${logo}" alt="" crossorigin="anonymous">` : ""}
            <div>
              <h2>${escapeHtml(data.companyName || "Company")}</h2>
              <div class="inv-company-meta">${escapeHtml([data.companyEmail, data.companyPhone].filter(Boolean).join(" · "))}</div>
            </div>
          </div>
          <div class="inv-id">
            <span class="inv-kicker">Invoice</span>
            <b>${escapeHtml(data.number || "")}</b>
            <span class="prev-badge" style="background:${statusColor[0]};color:${statusColor[1]};">${(data.status||"draft").replace(/^./, c=>c.toUpperCase())}</span>
          </div>
        </div>

        <div class="inv-tiles">
          <div class="inv-tile"><span>Issued</span><b>${fmtDate(data.issueDate)}</b></div>
          <div class="inv-tile"><span>Due</span><b>${fmtDate(data.dueDate)}</b></div>
          <div class="inv-tile due"><span>Amount due</span><b>${fmtMoney(data.total, symbol)}</b></div>
        </div>

        <div class="prev-parties">
          <div>
            <h5>From</h5>
            <p>${escapeHtml(data.companyAddress || "")}</p>
          </div>
          <div>
            <h5>Bill to</h5>
            <p><b>${escapeHtml(data.clientName || "")}</b>${data.clientAddress ? "<br>" + escapeHtml(data.clientAddress).replace(/\n/g,"<br>") : ""}</p>
          </div>
        </div>

        <table>
          <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th style="text-align:right;">Amount</th></tr></thead>
          <tbody>${itemsHtml}</tbody>
        </table>

        <div class="prev-totals">
          <div class="row"><span>Subtotal</span><span>${fmtMoney(data.subtotal, symbol)}</span></div>
          <div class="row"><span>Discount</span><span>-${fmtMoney(data.discountAmt, symbol)}</span></div>
          <div class="row"><span>Tax</span><span>+${fmtMoney(data.taxAmt, symbol)}</span></div>
          <div class="row grand"><span>Balance due</span><span>${fmtMoney(data.total, symbol)}</span></div>
        </div>

        <div class="prev-bank">
          <h5>Payment details</h5>
          <div>${bankHtml}</div>
        </div>

        ${data.notes ? `<div class="prev-notes">${escapeHtml(data.notes)}</div>` : ""}
        <div class="inv-foot"><span>Please pay by the due date shown above.</span><span class="mark"><i></i>Made with Ledger Studio</span></div>
      </div>`;

    document.getElementById("publicActions").style.display = "flex";
    document.getElementById("publicFooter").style.display = "block";
    document.title = "Invoice " + (data.number || "") + " — Ledger Studio";
  }

  const data = getData();
  if(data){
    render(data);
    document.getElementById("printBtn").addEventListener("click", ()=> window.print());
    document.getElementById("downloadPdfBtn").addEventListener("click", async ()=>{
      const el = document.getElementById("invoicePreview");
      const canvas = await html2canvas(el, {
        scale:2, backgroundColor:"#ffffff", windowWidth:1200, useCORS:true,
        onclone:(doc)=>{ doc.getElementById("invoicePreview").classList.add("pdf-mode"); }
      });
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF("p","mm","a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgHeight = (canvas.height * pageWidth) / canvas.width;
      // Long invoices continue onto extra A4 pages instead of being cut off
      let offset = 0;
      pdf.addImage(imgData, "JPEG", 0, 0, pageWidth, imgHeight, "invoice", "FAST");
      while(imgHeight - offset > pageHeight + 1){
        offset += pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, -offset, pageWidth, imgHeight, "invoice", "FAST");
      }
      pdf.save((data.number || "invoice") + ".pdf");
    });
  } else {
    document.getElementById("invalidState").style.display = "block";
  }
})();