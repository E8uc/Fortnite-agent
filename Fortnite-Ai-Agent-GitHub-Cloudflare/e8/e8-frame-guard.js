(() => {
  "use strict";

  const root = document.documentElement;
  if (window.top === window.self) {
    root.classList.remove("e8-frame-guard");
    return;
  }

  // GitHub Pages cannot set X-Frame-Options/CSP response headers per page.
  // Keep sensitive support UI hidden when framed, then try to escape the frame.
  try {
    window.top.location = window.self.location.href;
  } catch {}
})();
