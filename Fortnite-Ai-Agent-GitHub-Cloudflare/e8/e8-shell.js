(() => {
  "use strict";

  function initDrawer() {
    const drawer = document.querySelector("[data-e8-drawer]");
    const scrim = document.querySelector("[data-e8-scrim]");
    if (!drawer || !scrim) return;

    const open = () => {
      drawer.classList.add("open");
      scrim.classList.add("show");
      drawer.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
    };
    const close = () => {
      drawer.classList.remove("open");
      scrim.classList.remove("show");
      drawer.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    };

    document.querySelectorAll("[data-e8-open-drawer]").forEach((button) => button.addEventListener("click", open));
    document.querySelectorAll("[data-e8-close-drawer]").forEach((button) => button.addEventListener("click", close));
    scrim.addEventListener("click", close);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  }

  window.E8Shell = Object.freeze({ initDrawer });
  document.addEventListener("DOMContentLoaded", initDrawer, { once: true });
})();
