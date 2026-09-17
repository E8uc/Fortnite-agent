(() => {
  "use strict";

  const API_ENDPOINT = "https://fortnite-ai-agent-api.a39328122.workers.dev";
  const form = document.getElementById("subscriptionForm");
  const token = document.getElementById("staffToken");
  const id = document.getElementById("e8Id");
  const plan = document.getElementById("planSelect");
  const duration = document.getElementById("durationDays");
  const result = document.getElementById("result");
  const submitButton = form.querySelector('button[type="submit"]');

  let submitting = false;

  function setResult(message, isError = false) {
    result.textContent = message;
    result.classList.toggle("error", isError);
  }

  function setBusy(value) {
    submitting = value;
    submitButton.disabled = value;
    id.disabled = value;
    plan.disabled = value;
    duration.disabled = value;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting) return;

    const staffToken = token.value;
    const e8Id = id.value.trim();
    const days = Number(duration.value);

    if (staffToken.length < 32) return setResult("Staff token is missing or too short.", true);
    if (!/^E8[A-Za-z0-9]{15}uC$/.test(e8Id)) return setResult("Invalid E8 ID format.", true);
    if (plan.value !== "plus" && plan.value !== "premium") return setResult("Invalid subscription plan.", true);
    if (!Number.isInteger(days) || days < 1 || days > 730) return setResult("Duration must be 1–730 days.", true);

    setBusy(true);
    setResult("Updating…");
    try {
      const response = await fetch(`${API_ENDPOINT}/e8/admin/subscription`, {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: {
          Authorization: `Bearer ${staffToken}`,
          "Content-Type": "application/json",
          "X-FNAA-Client": "e8-support-v1"
        },
        body: JSON.stringify({ id: e8Id, plan: plan.value, durationDays: days })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
      const account = data.account || {};
      setResult(`${account.plan || plan.value} active until ${account.expiresAt || "the selected expiry"}.`);
      id.value = "";
      id.focus();
    } catch (error) {
      setResult(error?.message || "Couldn't update the subscription.", true);
    } finally {
      setBusy(false);
    }
  });

  window.addEventListener("pagehide", () => {
    token.value = "";
  });
})();
