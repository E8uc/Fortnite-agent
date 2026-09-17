(() => {
  "use strict";

  const API_ENDPOINT = "https://fortnite-ai-agent-api.a39328122.workers.dev";
  const E8_ID_RE = /^E8[A-Za-z0-9]{15}uC$/;

  const form = document.getElementById("subscriptionForm");
  const token = document.getElementById("staffToken");
  const id = document.getElementById("e8Id");
  const plan = document.getElementById("planSelect");
  const duration = document.getElementById("durationDays");
  const result = document.getElementById("result");
  const submitButton = document.getElementById("activateSubscription");
  const revokeButton = document.getElementById("revokeSubscription");

  let submitting = false;

  function setResult(message, isError = false) {
    result.textContent = message;
    result.classList.toggle("error", isError);
  }

  function setBusy(value) {
    submitting = value;
    submitButton.disabled = value;
    revokeButton.disabled = value;
    id.disabled = value;
    plan.disabled = value;
    duration.disabled = value;
  }

  function readCredentials() {
    const staffToken = token.value;
    const e8Id = id.value.trim();

    if (staffToken.length < 32) {
      setResult("Staff token is missing or too short.", true);
      return null;
    }
    if (!E8_ID_RE.test(e8Id)) {
      setResult("Invalid E8 ID format.", true);
      return null;
    }
    return { staffToken, e8Id };
  }

  async function adminRequest(path, staffToken, body) {
    const response = await fetch(`${API_ENDPOINT}${path}`, {
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
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting) return;

    const credentials = readCredentials();
    if (!credentials) return;

    const days = Number(duration.value);
    if (plan.value !== "plus" && plan.value !== "premium") return setResult("Invalid subscription plan.", true);
    if (!Number.isInteger(days) || days < 1 || days > 730) return setResult("Duration must be 1–730 days.", true);

    setBusy(true);
    setResult("Updating…");
    try {
      const data = await adminRequest("/e8/admin/subscription", credentials.staffToken, {
        id: credentials.e8Id,
        plan: plan.value,
        durationDays: days
      });
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

  revokeButton.addEventListener("click", async () => {
    if (submitting) return;
    const credentials = readCredentials();
    if (!credentials) return;

    const confirmed = window.confirm(`Revoke paid access for ${credentials.e8Id} and return it to Free?`);
    if (!confirmed) return;

    setBusy(true);
    setResult("Revoking…");
    try {
      const data = await adminRequest("/e8/admin/subscription/revoke", credentials.staffToken, {
        id: credentials.e8Id
      });
      const account = data.account || {};
      setResult(`Subscription revoked. ${credentials.e8Id} is now ${account.plan || "Free"}.`);
      id.value = "";
      id.focus();
    } catch (error) {
      setResult(error?.message || "Couldn't revoke the subscription.", true);
    } finally {
      setBusy(false);
    }
  });

  window.addEventListener("pagehide", () => {
    token.value = "";
  });
})();
