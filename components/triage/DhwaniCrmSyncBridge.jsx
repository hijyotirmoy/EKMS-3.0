"use client";

import React, { useState, useEffect } from "react";
import {
  Link2,
  Check,
  X,
  Send,
  Share2,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { getOrCreateClientSyncId } from "@/lib/clientCache";

export function DhwaniCrmSyncBridge({ open, onClose, currentAgent, onManualSync }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [targetOrigin, setTargetOrigin] = useState("http://localhost:3001");
  const [syncClientId, setSyncClientId] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setTargetOrigin(window.location.origin);
      setSyncClientId(getOrCreateClientSyncId());
    }
  }, []);

  const agentIdentifier = (currentAgent?.email || currentAgent?.agentId || "").toLowerCase().trim();
  const agentDisplayName = currentAgent?.name || currentAgent?.displayName || currentAgent?.email || "This Browser Tab";

  // Close modal when pressing Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && open) {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  // ROBUST 1-CLICK BOOKMARKLET: Captures Phone (+91-9957168541), Name, Age, Sex, District, and IP Number
  // STRICTLY only executes on Dhwani CRM Beneficiary pages (/app/beneficiary/*); rejects any other page.
  // Dynamically points to the deployed domain or current origin, and is strictly paired to THIS browser/agent.
  const bookmarkletCode = `javascript:(function(){try{if(!window.location.href.includes("/beneficiary/")){var w=document.createElement("div");w.style.cssText="position:fixed;bottom:24px;right:24px;z-index:9999999;background:#b91c1c;color:#fff;padding:14px 20px;border-radius:16px;box-shadow:0 12px 30px rgba(0,0,0,0.35);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:13px;font-weight:700;display:flex;align-items:center;gap:10px;border:1px solid rgba(255,255,255,0.25);";w.innerHTML='<span style="font-size:16px;">⚠️</span><span>Please open a Beneficiary form in Dhwani CRM to sync</span>';document.body.appendChild(w);setTimeout(function(){w.remove();},3200);return;}function cl(s){return String(s||"").trim();}function dig(s){return String(s||"").replace(/\\D/g,"");}var cf=(typeof cur_frm!=="undefined"&&cur_frm&&cur_frm.doc)?cur_frm.doc:{};function getDomVal(k){var el=document.querySelector('[data-fieldname="'+k+'"] input,[data-fieldname="'+k+'"] select,[data-fieldname="'+k+'"] textarea');if(el&&typeof el.value!=="undefined"&&el.value!==null)return cl(el.value);var w=document.querySelector('[data-fieldname="'+k+'"] .control-value,[data-fieldname="'+k+'"] .like-disabled-input');if(w&&w.innerText)return cl(w.innerText);return "";}var fn="";var fnKeys=["first_name","beneficiary_name","full_name","patient_name"];for(var i=0;i<fnKeys.length;i++){if(cf[fnKeys[i]]){fn=cl(cf[fnKeys[i]]);break;}var dv=getDomVal(fnKeys[i]);if(dv){fn=dv;break;}}if(!fn&&cf.name&&!/^\\d{4,}/.test(cf.name)&&/[a-zA-Z]/.test(cf.name)){fn=cl(cf.name);}var ln="";if(cf.last_name&&cl(cf.last_name)&&!/^(enter last name|last name|last_name|none|null|n\\/?a|\\.)$/i.test(cl(cf.last_name))){ln=cl(cf.last_name);}else{var domLn=getDomVal("last_name");if(domLn&&!/^(enter last name|last name|last_name|none|null|n\\/?a|\\.)$/i.test(domLn)){ln=domLn;}}var name=(ln?(fn+" "+ln):fn)||"Beneficiary";name=name.replace(/\\s+Last\\s+Nam(?:e)?$/i,"").replace(/\\s+Enter\\s+last\\s+name$/i,"").trim();var rawPhone="";var phoneKeys=["phone_number","contact_no","mobile_no","phone","custom_phone_number","cell_number"];for(var j=0;j<phoneKeys.length;j++){if(cf[phoneKeys[j]]){rawPhone=cl(cf[phoneKeys[j]]);break;}var dp=getDomVal(phoneKeys[j]);if(dp){rawPhone=dp;break;}}var pMatch=rawPhone.match(/[6-9]\\d{9}/);var phone=pMatch?pMatch[0]:(dig(rawPhone).length>=10?dig(rawPhone).slice(-10):"");var age="";var ageKeys=["age","custom_age","beneficiary_age","age_years","caller_age"];for(var k=0;k<ageKeys.length;k++){var ak=ageKeys[k];if(typeof cf[ak]!=="undefined"&&cf[ak]!==null&&String(cf[ak]).trim()!==""){var num=parseInt(dig(cf[ak]),10);if(!isNaN(num)&&num>=1&&num<=120){age=String(num);break;}}var da=getDomVal(ak);if(da){var dNum=parseInt(dig(da),10);if(!isNaN(dNum)&&dNum>=1&&dNum<=120){age=String(dNum);break;}}}var rawGender="";var sexKeys=["gender","sex","custom_gender"];for(var s=0;s<sexKeys.length;s++){if(cf[sexKeys[s]]){rawGender=cl(cf[sexKeys[s]]);break;}var dg=getDomVal(sexKeys[s]);if(dg){rawGender=dg;break;}}var sex=rawGender.toLowerCase().startsWith("m")?"Male":(rawGender.toLowerCase().startsWith("f")?"Female":"");var rawDist="";var distKeys=["district","custom_district"];for(var d=0;d<distKeys.length;d++){if(cf[distKeys[d]]){rawDist=cl(cf[distKeys[d]]);break;}var dd=getDomVal(distKeys[d]);if(dd){rawDist=dd;break;}}var district=rawDist.replace(/^(select|null|none|n\\/?a)$/i,"").trim();var rawIp="";var ipKeys=["ip_number","custom_ip_number","ip_no","esic_no","esic_ip_number"];for(var p=0;p<ipKeys.length;p++){if(cf[ipKeys[p]]){rawIp=cl(cf[ipKeys[p]]);break;}var dip=getDomVal(ipKeys[p]);if(dip){rawIp=dip;break;}}var cleanIpDigits=dig(rawIp);var ip=(cleanIpDigits.length>=6&&parseInt(cleanIpDigits,10)>0)?cleanIpDigits:"";var uMatch=window.location.href.match(/beneficiary\\/([A-Za-z0-9_-]+)/);var bid=uMatch?uMatch[1]:"";var crmUser=(function(){try{if(typeof frappe!=="undefined"&&frappe.session&&frappe.session.user&&frappe.session.user!=="Guest")return String(frappe.session.user).toLowerCase().trim();}catch(e){}try{var u=document.querySelector("[data-user]")?.getAttribute("data-user");if(u)return String(u).toLowerCase().trim();}catch(e){}return "";})();var payload={caller_name:name,phone:phone,age:age,sex:sex,district:district,ip_number:ip,beneficiary_id:bid,source:"dhwani_crm_bookmarklet",client_id:"${syncClientId}",agent_id:"${agentIdentifier}",crm_user:crmUser};var targetUrl="${targetOrigin}/api/crm/live-sync";function showSuccessToast(){var t=document.createElement("div");t.style.cssText="position:fixed;bottom:24px;right:24px;z-index:9999999;background:linear-gradient(135deg,#059669,#047857);color:#fff;padding:14px 22px;border-radius:18px;box-shadow:0 12px 30px rgba(0,0,0,0.3);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:13px;display:flex;align-items:center;gap:12px;border:1px solid rgba(255,255,255,0.25);animation:fadeIn 0.3s ease;";t.innerHTML='<div style="width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:16px;">✓</div><div><div style="font-weight:800;font-size:13.5px;">✓ Sent to EKMS Triage</div><div style="font-size:11.5px;opacity:0.95;margin-top:2px;">'+(payload.caller_name||"Beneficiary")+(payload.phone?" · +91 "+payload.phone:"")+(payload.age?" · "+payload.age+"y":"")+(payload.district?" · "+payload.district:"")+(payload.ip_number?" · IP: "+payload.ip_number:"")+'</div></div>';document.body.appendChild(t);setTimeout(function(){t.remove();},2600);}function showErrorToast(){var t=document.createElement("div");t.style.cssText="position:fixed;bottom:24px;right:24px;z-index:9999999;background:#dc2626;color:#fff;padding:14px 20px;border-radius:16px;box-shadow:0 10px 25px rgba(0,0,0,0.3);font-family:sans-serif;font-size:13px;";t.innerHTML="<div>✕ Could not reach EKMS Triage</div>";document.body.appendChild(t);setTimeout(function(){t.remove();},3000);}fetch(targetUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),mode:"cors"}).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}).then(function(d){showSuccessToast();}).catch(function(e){fetch(targetUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),mode:"cors"}).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}).then(function(d){showSuccessToast();}).catch(function(){showErrorToast();});});}catch(err){console.error(err);}})();`;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/20 rounded-xl backdrop-blur-xs">
              <Link2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-extrabold tracking-tight">Dhwani CRM ↔ EKMS Triage Sync</h3>
              <p className="text-xs text-emerald-100 font-medium">
                Auto-syncs Beneficiary Name, Phone (+91), Age, Sex, District &amp; IP Number
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/20 transition text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto text-xs text-slate-700 dark:text-slate-300">
          <div className="space-y-4">
            {/* Private 1-to-1 Pairing Notification */}
            <div className="flex items-start gap-2.5 p-3.5 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200 dark:border-emerald-800/60 text-xs text-emerald-900 dark:text-emerald-200">
              <Lock className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-extrabold block text-emerald-950 dark:text-emerald-100">
                  Private Browser Session Locked
                </span>
                <span className="text-[11px] text-emerald-800 dark:text-emerald-300 mt-0.5 block leading-relaxed">
                  Paired to: <strong>{agentDisplayName}</strong>. Data sent from Dhwani CRM will <u>ONLY</u> appear on your screen, never on another agent&apos;s computer.
                </span>
              </div>
            </div>

            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/20 space-y-3">
              <span className="font-extrabold text-slate-900 dark:text-slate-100 text-sm block">
                Drag this button to your Chrome Bookmarks Bar:
              </span>

              {/* THE BEAUTIFUL BOOKMARKLET BUTTON WITH SEND ICON & HOVER TOOLTIP */}
              <div className="pt-3 flex flex-col sm:flex-row items-start sm:items-center gap-4 relative">
                <div
                  className="relative inline-block"
                  onMouseEnter={() => setShowTooltip(true)}
                  onMouseLeave={() => setShowTooltip(false)}
                >
                  <a
                    href={bookmarkletCode}
                    onClick={(e) => {
                      e.preventDefault();
                      toast.info("Drag this button up onto your Chrome Bookmarks Bar!");
                    }}
                    className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white font-extrabold text-sm tracking-tight shadow-lg hover:shadow-emerald-500/30 hover:scale-[1.02] transition-all duration-200 cursor-grab active:cursor-grabbing border border-white/25 select-none"
                    title="Send details from Dhwani CRM to EKMS Triage"
                  >
                    <Send className="w-4 h-4 text-white" />
                    <span>send to triage</span>
                  </a>

                  {/* Interactive Hover Message Display */}
                  {showTooltip && (
                    <div className="absolute left-0 -top-9 z-50 bg-slate-900 text-white text-[11px] font-semibold px-3 py-1.5 rounded-xl shadow-xl whitespace-nowrap border border-slate-700 animate-in fade-in slide-in-from-bottom-1 duration-150 pointer-events-none">
                      Send details from Dhwani CRM to EKMS Triage
                      <div className="absolute left-6 top-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-slate-900" />
                    </div>
                  )}
                </div>

                <span className="text-[11.5px] text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-1.5">
                  <span>← Drag this button to Bookmarks Bar</span>
                </span>
              </div>
            </div>

            {/* How it works card */}
            <div className="p-4 rounded-2xl bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 text-[11.5px] text-teal-950 dark:text-teal-200 space-y-2">
              <div className="font-extrabold text-teal-900 dark:text-teal-300 flex items-center gap-1.5 text-xs">
                <Check className="w-4 h-4 text-emerald-600" />
                <span>How to use on any Dhwani CRM Beneficiary page:</span>
              </div>
              <ol className="list-decimal list-inside space-y-1 text-slate-700 dark:text-slate-300 leading-relaxed">
                <li>In Dhwani CRM, open or fill any beneficiary call (e.g. <code>/app/beneficiary/261117-21810</code>).</li>
                <li>Click <strong>&quot;send to triage&quot;</strong> on your Chrome Bookmarks Bar.</li>
                <li>
                  A floating green checkmark badge appears on Dhwani CRM, and details (<strong>Phone Number</strong>, Name, Age, Sex, District, and IP Number) instantly populate into EKMS Triage — <strong>with zero popups, zero alerts, and zero permission prompts!</strong>
                </li>
              </ol>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-bold rounded-xl transition cursor-pointer text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
