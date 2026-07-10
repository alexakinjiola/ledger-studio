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
    const colors = {paid:["#e6f4e6","#046C04"], unpaid:["#fdf3d9","#9a6b00"], draft:["#eee","#777"]};
    const statusColor = colors[data.status] || colors.draft;

    const itemsHtml = (data.items || []).map(item => `
      <tr>
        <td>${escapeHtml(item.desc || "Untitled item")}</td>
        <td>${item.qty}</td>
        <td>${fmtMoney(item.rate, symbol)}</td>
        <td style="text-align:right;">${fmtMoney(item.qty*item.rate, symbol)}</td>
      </tr>`).join("");

    const bankHtml = (data.bank && (data.bank.accountNumber || data.bank.bankName)) ? `
      ${data.bank.bankName ? "Bank: " + escapeHtml(data.bank.bankName) + "<br>" : ""}
      ${data.bank.accountName ? "Account name: " + escapeHtml(data.bank.accountName) + "<br>" : ""}
      ${data.bank.accountNumber ? "Account number: " + escapeHtml(data.bank.accountNumber) + "<br>" : ""}
      ${data.bank.iban ? "IBAN: " + escapeHtml(data.bank.iban) + "<br>" : ""}
      ${data.bank.swift ? "SWIFT/BIC: " + escapeHtml(data.bank.swift) : ""}
    ` : "No bank details were provided.";

    container.innerHTML = `
      <div class="invoice-preview" id="invoicePreview" style="position:static;">
        <div class="prev-head">
          <div style="display:flex;gap:14px;align-items:center;">
            ${data.companyLogo ? `<img class="prev-logo" src="${data.companyLogo}" alt="">` : ""}
            <div>
              <h2>${escapeHtml(data.companyName || "Company")}</h2>
              <div style="font-size:12.5px;color:#888;">${escapeHtml([data.companyEmail, data.companyPhone].filter(Boolean).join(" · "))}</div>
            </div>
          </div>
          <div class="prev-meta">
            <div><b>${escapeHtml(data.number || "")}</b></div>
            <div>Issued: ${fmtDate(data.issueDate)}</div>
            <div>Due: ${fmtDate(data.dueDate)}</div>
            <span class="prev-badge" style="background:${statusColor[0]};color:${statusColor[1]};">${(data.status||"draft").replace(/^./, c=>c.toUpperCase())}</span>
          </div>
        </div>

        <div class="prev-parties">
          <div>
            <h5>From</h5>
            <p>${escapeHtml(data.companyAddress || "")}</p>
          </div>
          <div style="text-align:right;">
            <h5>Bill to</h5>
            <p>${escapeHtml(data.clientName || "")}${data.clientAddress ? "<br>" + escapeHtml(data.clientAddress).replace(/\n/g,"<br>") : ""}</p>
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
          <div class="row grand"><span>Total</span><span>${fmtMoney(data.total, symbol)}</span></div>
        </div>

        <div class="prev-bank">
          <h5>Payment details</h5>
          <div>${bankHtml}</div>
        </div>

        ${data.notes ? `<div class="prev-notes">${escapeHtml(data.notes)}</div>` : ""}
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
      const canvas = await html2canvas(el, {scale:2, backgroundColor:"#ffffff"});
      const imgData = canvas.toDataURL("image/png");
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF("p","mm","a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const imgHeight = (canvas.height * pageWidth) / canvas.width;
      pdf.addImage(imgData, "PNG", 0, 0, pageWidth, imgHeight);
      pdf.save((data.number || "invoice") + ".pdf");
    });
  } else {
    document.getElementById("invalidState").style.display = "block";
  }
})();