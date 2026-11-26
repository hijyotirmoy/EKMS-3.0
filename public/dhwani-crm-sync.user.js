// ==UserScript==
// @name         EKMS Triage ↔ Dhwani CRM Live Bridge
// @namespace    https://piramalswasthya.org/
// @version      1.2.0
// @description  Instantly syncs caller name, phone, age, sex, district, and IP number from Piramal Dhwani CRM to EKMS Triage without alerts or popups.
// @author       EKMS AI Triage Team
// @match        https://xurakhya.piramalswasthya.org/app/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// ==/UserScript==

(function () {
  "use strict";

  const ASSAM_DISTRICTS = [
    "Baksa", "Barpeta", "Bongaigaon", "Cachar", "Charaideo", "Chirang", "Darrang",
    "Dhemaji", "Dhubri", "Dibrugarh", "Dima Hasao", "Goalpara", "Golaghat", "Hailakandi",
    "Hojai", "Jorhat", "Kamrup Metro", "Kamrup Rural", "Karbi Anglong", "Karimganj",
    "Kokrajhar", "Lakhimpur", "Majuli", "Marigaon", "Nagaon", "Nalbari", "Sivasagar",
    "Sonitpur", "Tinsukia", "Udalguri"
  ];

  function resolveDistrict(raw) {
    if (!raw) return "";
    const s = String(raw).trim();
    if (!s || /select/i.test(s) || /^n\/?a$/i.test(s)) return "";

    const exact = ASSAM_DISTRICTS.find(d => d.toLowerCase() === s.toLowerCase());
    if (exact) return exact;

    const lower = s.toLowerCase();
    if (lower.includes("metro") || lower.includes("guwahati") || lower === "kamrup m") {
      return "Kamrup Metro";
    }
    if (lower.includes("rural") || lower === "kamrup r") {
      return "Kamrup Rural";
    }

    const prefix4 = lower.slice(0, 4);
    const prefix3 = lower.slice(0, 3);
    if (prefix4.length >= 4) {
      const match4 = ASSAM_DISTRICTS.find(d => d.toLowerCase().startsWith(prefix4));
      if (match4) return match4;
    }
    if (prefix3.length >= 3) {
      const match3 = ASSAM_DISTRICTS.find(d => d.toLowerCase().startsWith(prefix3));
      if (match3) return match3;
    }
    return s;
  }

  function getFieldValue(fields, labels) {
    for (const f of fields) {
      const el = document.querySelector(`[data-fieldname="${f}"] input, [data-fieldname="${f}"] select, [data-fieldname="${f}"] textarea`);
      if (el && el.value) return el.value.trim();
      const w = document.querySelector(`[data-fieldname="${f}"] .control-value, [data-fieldname="${f}"] .like-disabled-input, [data-fieldname="${f}"]`);
      if (w && w.innerText && !w.querySelector("input, select")) return w.innerText.trim();
    }
    for (const lbl of labels) {
      const matched = Array.from(document.querySelectorAll("label, .control-label, span.text-muted")).find(
        l => l.textContent && l.textContent.toLowerCase().includes(lbl.toLowerCase())
      );
      if (matched) {
        const container = matched.closest(".form-group, .frappe-control, div") || matched.parentElement;
        if (container) {
          const input = container.querySelector("input, select, textarea");
          if (input && input.value) return input.value.trim();
          if (container.innerText) return container.innerText.trim();
        }
      }
    }
    return "";
  }

  function extractBeneficiary() {
    const fn = getFieldValue(["first_name", "name", "beneficiary_name"], ["First Name", "Beneficiary Name"]);
    const lnEl = document.querySelector('[data-fieldname="last_name"] input, input[name="last_name"]');
    const rawLn = lnEl && lnEl.value ? lnEl.value.trim() : "";
    const cleanLn = rawLn && !/^(enter last name|last name|last_name|none|null|n\/?a|\.)$/i.test(rawLn) ? rawLn : "";
    let name = [fn, cleanLn].filter(Boolean).join(" ") || fn;
    name = name.replace(/\s+Last\s+Nam(?:e)?$/i, "").replace(/\s+Enter\s+last\s+name$/i, "").trim();

    const rawPhone = getFieldValue(
      ["phone_number", "contact_no", "mobile_no", "phone", "cell_number", "custom_phone_number"],
      ["Phone Number", "Phone", "Mobile", "Contact"]
    );
    const pMatch = (rawPhone || (document.body ? document.body.innerText : "")).match(/(?:(?:\+|0{0,2})91[\s-]*)?([6-9]\d{9})/);
    const phone = pMatch ? pMatch[1] : (rawPhone.replace(/\D/g, "").slice(-10) || "");

    const rawAge = (getFieldValue(["age"], ["Age"]) || "").replace(/\D/g, "");
    const ageNum = parseInt(rawAge, 10);
    const age = (!isNaN(ageNum) && ageNum > 0) ? String(ageNum) : "";
    const rawGender = getFieldValue(["gender", "sex"], ["Gender", "Sex"]);
    const gender = rawGender ? (rawGender.toLowerCase().startsWith("m") ? "Male" : rawGender.toLowerCase().startsWith("f") ? "Female" : "Other") : "";
    const district = resolveDistrict(getFieldValue(["district"], ["District"]));

    const rawIp = (getFieldValue(["ip_number", "custom_ip_number", "ip_no", "esic_no", "ip"], ["Ip Number", "IP Number"]) || "").replace(/\D/g, "");
    const ip_number = rawIp || "";

    const uMatch = window.location.href.match(/beneficiary\/([A-Za-z0-9_-]+)/);
    const bid = uMatch ? uMatch[1] : "";

    return {
      caller_name: name,
      phone: phone,
      age: age,
      sex: gender,
      district: district,
      ip_number: ip_number,
      beneficiary_id: bid,
      source: "dhwani_crm_userscript"
    };
  }

  function showModernToast(data, success = true) {
    const existing = document.getElementById("ekms-triage-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "ekms-triage-toast";
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999999;
      background: ${success ? "linear-gradient(135deg, rgba(6, 78, 59, 0.96), rgba(4, 120, 87, 0.96))" : "#dc2626"};
      backdrop-filter: blur(14px);
      color: #ffffff;
      padding: 13px 18px;
      border-radius: 18px;
      box-shadow: 0 15px 30px rgba(0, 0, 0, 0.35);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 12px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      animation: ekmsSlideIn 0.3s ease;
      pointer-events: none;
    `;

    toast.innerHTML = `
      <div style="width: 32px; height: 32px; border-radius: 10px; background: rgba(255, 255, 255, 0.2); display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: bold;">
        ${success ? "✓" : "✕"}
      </div>
      <div>
        <div style="font-weight: 800; font-size: 13px;">${success ? "✓ Sent to EKMS Triage" : "Could not reach Triage"}</div>
        <div style="font-size: 11.5px; opacity: 0.95; margin-top: 1px;">
          ${data.caller_name || "Beneficiary"} · +91 ${data.phone || "No phone"}${data.district ? " · " + data.district : ""}${data.ip_number ? " · IP: " + data.ip_number : ""}
        </div>
      </div>
    `;

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  window.sendToEkmsTriage = function (silent = false) {
    const data = extractBeneficiary();
    if (!data.phone && !data.caller_name) return;

    fetch("http://localhost:3001/api/crm/live-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      mode: "cors"
    })
      .then(r => r.json())
      .then(res => {
        if (res.success && !silent) showModernToast(data, true);
      })
      .catch(() => {});
  };

  function injectButton() {
    if (document.getElementById("ekms-send-btn")) return;
    const saveBtn = Array.from(document.querySelectorAll("button, .btn")).find(
      b => b.textContent && b.textContent.includes("Save") && !b.classList.contains("dropdown-item")
    );

    if (saveBtn && saveBtn.parentElement) {
      const btn = document.createElement("button");
      btn.id = "ekms-send-btn";
      btn.type = "button";
      btn.innerHTML = `⚡ <span>Send to Triage</span>`;
      btn.style.cssText = `
        background: linear-gradient(135deg, #059669 0%, #0d9488 100%);
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.25);
        padding: 5px 14px;
        border-radius: 8px;
        font-weight: 700;
        font-size: 12px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-right: 8px;
        box-shadow: 0 2px 8px rgba(5, 150, 105, 0.3);
      `;
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.sendToEkmsTriage(false);
      };
      saveBtn.parentElement.insertBefore(btn, saveBtn);
    }
  }

  document.addEventListener("click", function (e) {
    const btn = e.target.closest("button, .btn");
    if (btn && (btn.textContent.includes("Save") || btn.classList.contains("btn-primary"))) {
      setTimeout(() => window.sendToEkmsTriage(false), 250);
    }
  }, true);

  setInterval(injectButton, 1000);
})();
