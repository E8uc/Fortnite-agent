(() => {
  "use strict";

  const E8_ID_RE = /^E8[A-Za-z0-9]{15}uC$/;
  const MAX_DAYS = 730;
  const MAX_USES = 10000;
  const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

  const plansTab = document.getElementById("plansTab");
  const redeemTab = document.getElementById("redeemTab");
  const plansPanel = document.getElementById("plansPanel");
  const redeemPanel = document.getElementById("redeemPanel");

  const planForm = document.getElementById("planForm");
  const planE8Id = document.getElementById("planE8Id");
  const planSelect = document.getElementById("planSelect");
  const planDuration = document.getElementById("planDuration");
  const planCustomWrap = document.getElementById("planCustomWrap");
  const planCustomDays = document.getElementById("planCustomDays");
  const planMessage = document.getElementById("planMessage");
  const planPreview = document.getElementById("planPreview");
  const previewE8Id = document.getElementById("previewE8Id");
  const previewPlan = document.getElementById("previewPlan");
  const previewDuration = document.getElementById("previewDuration");
  const previewConfirm = document.getElementById("previewConfirm");
  const closePlanPreview = document.getElementById("closePlanPreview");

  const redeemForm = document.getElementById("redeemForm");
  const redeemPlan = document.getElementById("redeemPlan");
  const redeemDuration = document.getElementById("redeemDuration");
  const redeemCustomWrap = document.getElementById("redeemCustomWrap");
  const redeemCustomDays = document.getElementById("redeemCustomDays");
  const redeemUses = document.getElementById("redeemUses");
  const redeemCustomUsesWrap = document.getElementById("redeemCustomUsesWrap");
  const redeemCustomUses = document.getElementById("redeemCustomUses");
  const redeemMessage = document.getElementById("redeemMessage");
  const redeemPreview = document.getElementById("redeemPreview");
  const redeemCode = document.getElementById("redeemCode");
  const redeemMeta = document.getElementById("redeemMeta");
  const regenerateCode = document.getElementById("regenerateCode");
  const createRedeem = document.getElementById("createRedeem");

  let lastRedeemConfig = null;

  function setMessage(target, message, isError = false) {
    target.textContent = message;
    target.classList.toggle("error", isError);
  }

  function setTab(name) {
    const showPlans = name === "plans";
    plansTab.classList.toggle("active", showPlans);
    redeemTab.classList.toggle("active", !showPlans);
    plansTab.setAttribute("aria-selected", showPlans ? "true" : "false");
    redeemTab.setAttribute("aria-selected", showPlans ? "false" : "true");
    plansPanel.hidden = !showPlans;
    redeemPanel.hidden = showPlans;
  }

  function durationOptions(plan) {
    return plan === "premium"
      ? [
          { value: "30", label: "1 Month" },
          { value: "custom", label: "Custom" }
        ]
      : [
          { value: "3", label: "3 Days" },
          { value: "7", label: "7 Days" },
          { value: "30", label: "30 Days" },
          { value: "custom", label: "Custom" }
        ];
  }

  function fillDurationSelect(select, plan) {
    const previous = select.value;
    select.replaceChildren();
    for (const option of durationOptions(plan)) {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    }
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  }

  function syncCustomDuration(select, wrap, input) {
    const custom = select.value === "custom";
    wrap.hidden = !custom;
    input.required = custom;
    if (!custom) input.value = "";
  }

  function readDays(select, customInput, messageTarget) {
    const days = select.value === "custom" ? Number(customInput.value) : Number(select.value);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      setMessage(messageTarget, `Duration must be between 1 and ${MAX_DAYS} days.`, true);
      return null;
    }
    return days;
  }

  function readUses() {
    const uses = redeemUses.value === "custom" ? Number(redeemCustomUses.value) : Number(redeemUses.value);
    if (!Number.isInteger(uses) || uses < 1 || uses > MAX_USES) {
      setMessage(redeemMessage, `Uses must be between 1 and ${MAX_USES}.`, true);
      return null;
    }
    return uses;
  }

  function randomChunk(length = 4) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    let output = "";
    for (const byte of bytes) {
      if (byte >= 248) continue;
      output += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (output.length === length) break;
    }
    while (output.length < length) output += CODE_ALPHABET[crypto.getRandomValues(new Uint8Array(1))[0] % CODE_ALPHABET.length];
    return output;
  }

  function newRedeemCode() {
    return `${randomChunk()}-${randomChunk()}-${randomChunk()}`;
  }

  function renderRedeemPreview(config) {
    lastRedeemConfig = config;
    redeemCode.textContent = newRedeemCode();
    redeemMeta.textContent = `${config.plan} · ${config.days} day${config.days === 1 ? "" : "s"} · ${config.uses} use${config.uses === 1 ? "" : "s"}`;
    redeemPreview.hidden = false;
    redeemPreview.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  plansTab.addEventListener("click", () => setTab("plans"));
  redeemTab.addEventListener("click", () => setTab("redeem"));

  planSelect.addEventListener("change", () => {
    fillDurationSelect(planDuration, planSelect.value);
    syncCustomDuration(planDuration, planCustomWrap, planCustomDays);
    planPreview.hidden = true;
    setMessage(planMessage, "");
  });

  planDuration.addEventListener("change", () => {
    syncCustomDuration(planDuration, planCustomWrap, planCustomDays);
    planPreview.hidden = true;
  });

  planForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const e8Id = planE8Id.value.trim();
    if (!E8_ID_RE.test(e8Id)) {
      setMessage(planMessage, "Enter a valid E8ID before continuing.", true);
      planPreview.hidden = true;
      return;
    }

    const days = readDays(planDuration, planCustomDays, planMessage);
    if (!days) {
      planPreview.hidden = true;
      return;
    }

    setMessage(planMessage, "");
    previewE8Id.textContent = e8Id;
    previewPlan.textContent = planSelect.value === "premium" ? "Premium" : "Plus";
    previewDuration.textContent = `${days} day${days === 1 ? "" : "s"}`;
    planPreview.hidden = false;
    planPreview.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  closePlanPreview.addEventListener("click", () => {
    planPreview.hidden = true;
    planE8Id.focus();
  });

  previewConfirm.addEventListener("click", () => {
    setMessage(planMessage, "Frontend preview only — account verification and activation are not connected yet.");
    planPreview.hidden = true;
  });

  redeemPlan.addEventListener("change", () => {
    fillDurationSelect(redeemDuration, redeemPlan.value);
    syncCustomDuration(redeemDuration, redeemCustomWrap, redeemCustomDays);
    redeemPreview.hidden = true;
    lastRedeemConfig = null;
    setMessage(redeemMessage, "");
  });

  redeemDuration.addEventListener("change", () => {
    syncCustomDuration(redeemDuration, redeemCustomWrap, redeemCustomDays);
    redeemPreview.hidden = true;
    lastRedeemConfig = null;
  });

  redeemUses.addEventListener("change", () => {
    const custom = redeemUses.value === "custom";
    redeemCustomUsesWrap.hidden = !custom;
    redeemCustomUses.required = custom;
    if (!custom) redeemCustomUses.value = "";
    redeemPreview.hidden = true;
    lastRedeemConfig = null;
  });

  redeemForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const days = readDays(redeemDuration, redeemCustomDays, redeemMessage);
    if (!days) return;
    const uses = readUses();
    if (!uses) return;

    setMessage(redeemMessage, "");
    renderRedeemPreview({
      plan: redeemPlan.value === "premium" ? "Premium" : "Plus",
      days,
      uses
    });
  });

  regenerateCode.addEventListener("click", () => {
    if (!lastRedeemConfig) return;
    redeemCode.textContent = newRedeemCode();
  });

  redeemCode.addEventListener("click", async () => {
    const value = String(redeemCode.textContent || "").trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setMessage(redeemMessage, "Code copied.");
    } catch {
      setMessage(redeemMessage, "Couldn't copy the code on this device.", true);
    }
  });

  createRedeem.addEventListener("click", () => {
    if (!lastRedeemConfig) return;
    setMessage(redeemMessage, "Frontend preview only — this code has not been saved or activated.");
    redeemPreview.hidden = true;
  });

  fillDurationSelect(planDuration, planSelect.value);
  fillDurationSelect(redeemDuration, redeemPlan.value);
  syncCustomDuration(planDuration, planCustomWrap, planCustomDays);
  syncCustomDuration(redeemDuration, redeemCustomWrap, redeemCustomDays);
  setTab("plans");
})();
