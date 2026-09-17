(() => {
  "use strict";

  let openCurrentDrawer = () => {};
  let closeCurrentDrawer = () => {};

  function initDrawer() {
    const drawer = document.querySelector("[data-e8-drawer]");
    const scrim = document.querySelector("[data-e8-scrim]");
    const app = document.querySelector(".e8-app");
    const openers = [...document.querySelectorAll("[data-e8-open-drawer]")];
    const closers = [...document.querySelectorAll("[data-e8-close-drawer]")];
    if (!drawer || !scrim) return;

    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])"
    ].join(",");

    let lastOpener = null;

    const setExpanded = (value) => {
      for (const button of openers) button.setAttribute("aria-expanded", value ? "true" : "false");
    };

    const setBackgroundInert = (value) => {
      if (app instanceof HTMLElement) app.inert = value;
    };

    const focusableItems = () => [...drawer.querySelectorAll(focusableSelector)]
      .filter((node) => node instanceof HTMLElement && !node.hidden && node.getAttribute("aria-hidden") !== "true");

    const open = (event) => {
      if (drawer.classList.contains("open")) return;
      lastOpener = event?.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement;
      drawer.classList.add("open");
      scrim.classList.add("show");
      drawer.setAttribute("aria-hidden", "false");
      drawer.setAttribute("aria-modal", "true");
      document.body.classList.add("e8-drawer-open");
      setExpanded(true);
      setBackgroundInert(true);
      const [focusTarget] = focusableItems();
      if (focusTarget) requestAnimationFrame(() => focusTarget.focus());
    };

    const close = ({ restoreFocus = true } = {}) => {
      if (!drawer.classList.contains("open")) return;
      drawer.classList.remove("open");
      scrim.classList.remove("show");
      drawer.setAttribute("aria-hidden", "true");
      drawer.removeAttribute("aria-modal");
      document.body.classList.remove("e8-drawer-open");
      setExpanded(false);
      setBackgroundInert(false);
      if (restoreFocus && lastOpener instanceof HTMLElement && lastOpener.isConnected) lastOpener.focus();
      lastOpener = null;
    };

    const trapFocus = (event) => {
      if (event.key !== "Tab" || !drawer.classList.contains("open")) return;
      const items = focusableItems();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !drawer.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    openCurrentDrawer = open;
    closeCurrentDrawer = close;

    for (const button of openers) {
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("click", open);
    }
    for (const button of closers) button.addEventListener("click", () => close());
    scrim.addEventListener("click", () => close());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
      else trapFocus(event);
    });
  }

  window.E8Shell = Object.freeze({
    initDrawer,
    openDrawer: (event) => openCurrentDrawer(event),
    closeDrawer: (options) => closeCurrentDrawer(options)
  });
  document.addEventListener("DOMContentLoaded", initDrawer, { once: true });
})();
