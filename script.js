/* =========================================================
   LEDGER STUDIO — Shared script (theme, nav, reveal animations)
   Loaded on: index.html, about.html, app.html
========================================================= */

(function(){
  "use strict";

  /* ---------- Theme (Light / Dark) ---------- */
  const THEME_KEY = "ls_theme";

  function applyTheme(theme){
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelectorAll("#themeSwitch, #themeSwitchDesktop").forEach(btn=>{
      btn.setAttribute("aria-pressed", theme === "dark");
    });
  }

  function getSavedTheme(){
    const saved = localStorage.getItem(THEME_KEY);
    if(saved) return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function toggleTheme(){
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  }

  applyTheme(getSavedTheme());
  document.querySelectorAll("#themeSwitch, #themeSwitchDesktop").forEach(btn=>{
    btn.addEventListener("click", toggleTheme);
  });

  /* ---------- Sticky nav shadow on scroll ---------- */
  const nav = document.getElementById("nav");
  if(nav){
    const onScroll = ()=>{
      if(window.scrollY > 12) nav.classList.add("scrolled");
      else nav.classList.remove("scrolled");
    };
    window.addEventListener("scroll", onScroll, {passive:true});
    onScroll();
  }

  /* ---------- Mobile nav menu (marketing pages) ---------- */
  const mobileBtn = document.getElementById("mobileMenuBtn");
  const navLinks = document.getElementById("navLinks");
  if(mobileBtn && navLinks){
    mobileBtn.addEventListener("click", ()=>{
      const isOpen = navLinks.classList.toggle("open");
      mobileBtn.classList.toggle("open", isOpen);
      mobileBtn.setAttribute("aria-expanded", isOpen);
      mobileBtn.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
    });
    navLinks.querySelectorAll("a").forEach(a=>{
      a.addEventListener("click", ()=>{
        mobileBtn.classList.remove("open");
        navLinks.classList.remove("open");
      });
    });
  }

  /* ---------- Mobile sidebar (app.html) ---------- */
  const sidebar = document.getElementById("sidebar");
  const sidebarBtn = document.getElementById("sidebarBtn");
  const sidebarOverlay = document.getElementById("sidebarOverlay");
  if(sidebar && sidebarBtn){
    const closeSidebar = ()=>{sidebar.classList.remove("open"); sidebarOverlay.classList.remove("open");};
    sidebarBtn.addEventListener("click", ()=>{
      sidebar.classList.add("open");
      sidebarOverlay.classList.add("open");
    });
    sidebarOverlay && sidebarOverlay.addEventListener("click", closeSidebar);
    sidebar.querySelectorAll(".side-link").forEach(link=>{
      link.addEventListener("click", closeSidebar);
    });
  }

  /* ---------- Show / hide password toggles ---------- */
  const EYE_ICON = '<span class="ms" aria-hidden="true">visibility</span>';
  const EYE_OFF_ICON = '<span class="ms" aria-hidden="true">visibility_off</span>';
  document.querySelectorAll(".pw-toggle").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const input = document.getElementById(btn.getAttribute("data-target"));
      if(!input) return;
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.innerHTML = showing ? EYE_ICON : EYE_OFF_ICON;
      btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    });
  });

  /* ---------- Keyboard support for non-button clickables ---------- */
  document.querySelectorAll('[role="button"][tabindex]').forEach(el=>{
    el.addEventListener("keydown", (e)=>{
      if(e.key === "Enter" || e.key === " "){ e.preventDefault(); el.click(); }
    });
  });

  /* ---------- Footer year ---------- */
  document.querySelectorAll("#year").forEach(el=>{ el.textContent = new Date().getFullYear(); });

  /* ---------- Scroll reveal animations ---------- */
  const revealEls = document.querySelectorAll(".reveal, .reveal-stagger");
  if("IntersectionObserver" in window && revealEls.length){
    const io = new IntersectionObserver((entries)=>{
      entries.forEach(entry=>{
        if(entry.isIntersecting){
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    }, {threshold:.15, rootMargin:"0px 0px -60px 0px"});
    revealEls.forEach(el=>io.observe(el));
  } else {
    revealEls.forEach(el=>el.classList.add("in"));
  }

})();