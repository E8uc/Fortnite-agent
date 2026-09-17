(() => {
  "use strict";

  function initDrawer() {
    const drawer = document.querySelector("[data-e8-drawer]");
    const scrim = document.querySelector("[data-e8-scrim]");
    const openers = [...document.querySelectorAll("[data-e8-open-drawer]")];
    const closers = [...document.querySelectorAll("[data-e8-close-drawer]")];
    if (!drawer || !scrim) return;

    let lastOpener = null;

    const setExpanded = (value) => {
      for (const button of openers) button.setAttribute("aria-expanded", value ? "true" : "false");
    };

    const open = (event) => {
      lastOpener = event?.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement;
      drawer.classList.add("open");
      scrim.classList.add("show");
      drawer.setAttribute("aria-hidden", "false");
      document.body.classList.add("e8-drawer-open");
      setExpanded(true);
      const focusTarget = drawer.querySelector("[data-e8-close-drawer], a, button");
      if (focusTarget instanceof HTMLElement) requestAnimationFrame(() => focusTarget.focus());
    };

    const close = () => {
      if (!drawer.classList.contains("open")) return;
      drawer.classList.remove("open");
      scrim.classList.remove("show");
      drawer.setAttribute("aria-hidden", "true");
      document.body.classList.remove("e8-drawer-open");
      setExpanded(false);
      if (lastOpener instanceof HTMLElement && lastOpener.isConnected) lastOpener.focus();
      lastOpener = null;
    };

    for (const button of openers) {
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("click", open);
    }
    for (const button of closers) button.addEventListener("click", close);
    scrim.addEventListener("click", close);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
  }

  window.E8Shell = Object.freeze({ initDrawer });
  document.addEventListener("DOMContentLoaded", initDrawer, { once: true });
})();
