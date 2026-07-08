/* ============================================================
   LEDGER STUDIO — shared site behavior
   (mobile nav toggle + scroll-reveal, used on every page)
   ============================================================ */
(() => {
  "use strict";

  /* ---------- mobile nav toggle ---------- */
  const nav = document.querySelector(".site-nav");
  const toggle = document.querySelector(".site-nav-toggle");
  const links = document.querySelector(".site-nav-links");

  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      toggle.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    links.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => {
        links.classList.remove("open");
        toggle.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* shrink nav slightly on scroll */
  if (nav) {
    const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 12);
    document.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------- scroll reveal ---------- */
  const revealEls = document.querySelectorAll("[data-reveal]");
  if (revealEls.length) {
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("revealed");
              io.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
      );
      revealEls.forEach((el) => io.observe(el));
    } else {
      revealEls.forEach((el) => el.classList.add("revealed"));
    }
  }
})();