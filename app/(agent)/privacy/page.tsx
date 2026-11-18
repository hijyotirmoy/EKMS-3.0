"use client";

import React, { useEffect } from "react";
import {
  Lock,
  UserCheck,
  Server,
  HeartPulse,
  Printer,
} from "lucide-react";

export default function PrivacyPage() {
  useEffect(() => {
    document.title = "Privacy Policy";
  }, []);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="w-full space-y-6 pb-12 animate-in fade-in duration-200">
      {/* Simple Clean Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Privacy Policy</h1>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>Effective Date: <strong>November 18, 2026</strong></span>
          <button
            type="button"
            onClick={handlePrint}
            className="px-3.5 py-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print</span>
          </button>
        </div>
      </div>

      {/* 4 Pillars Highlights Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs space-y-1.5">
          <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center">
            <Lock className="w-4 h-4" />
          </div>
          <h3 className="font-bold text-slate-900 text-xs">AES-256 Encryption</h3>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            All database storage, symptom logs, and patient records are encrypted at rest and in transit (TLS 1.3).
          </p>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs space-y-1.5">
          <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
            <UserCheck className="w-4 h-4" />
          </div>
          <h3 className="font-bold text-slate-900 text-xs">Strict Role Separation</h3>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Only authorized triage agents, certified doctors, and dispensary personnel have role-gated access.
          </p>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs space-y-1.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <HeartPulse className="w-4 h-4" />
          </div>
          <h3 className="font-bold text-slate-900 text-xs">Zero Commercial Monetization</h3>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Beneficiary healthcare data is never rented, profiled for advertisements, or shared with commercial entities.
          </p>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs space-y-1.5">
          <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
            <Server className="w-4 h-4" />
          </div>
          <h3 className="font-bold text-slate-900 text-xs">Immutable Audit Logs</h3>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Every patient lookup, appointment booking, rescheduling, and cancellation leaves a traceable audit event.
          </p>
        </div>
      </div>

      {/* Main Clean Policy Content Card */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-2xs space-y-8 text-xs sm:text-sm text-slate-700 leading-relaxed">
        {/* Section 1 */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <span>1. Overview &amp; Statutory Scope</span>
          </h2>
          <p>
            The Employee Knowledge Management System (EKMS) platform provides algorithmic clinical decision support, telephone intake classification, and real-time appointment synchronization for beneficiaries registered under the <strong>Employees’ State Insurance Act, 1948</strong>.
          </p>
          <p>
            This Privacy Policy describes our commitment to safeguarding Protected Health Information (PHI) and Personally Identifiable Information (PII) in compliance with the Digital Information Security in Healthcare Act (DISHA), the Information Technology (IT) Act, 2000, and National Digital Health Mission (NDHM) frameworks.
          </p>
        </section>

        {/* Section 2 */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <span>2. Information We Collect</span>
          </h2>
          <p>
            During telephone triage, automated CRM sync, or manual appointment scheduling, the system records only the minimal necessary health and administrative data:
          </p>
          <ul className="list-disc list-inside space-y-1.5 pl-2 text-slate-600">
            <li><strong>Beneficiary Demographics:</strong> Name, Age, Sex, Contact Phone Number, Residential District, and PIN Code.</li>
            <li><strong>Insured Person (IP) Identification:</strong> Official 10-digit ESIC Insured Person (IP) number (if available and valid).</li>
            <li><strong>Clinical Tele-Assessment:</strong> Chief complaint description, symptom onset and duration, comorbidity factors, and red-flag hemodynamic indicators (e.g. chest tightness, syncope, acute trauma).</li>
            <li><strong>Operational Audit Telemetry:</strong> Anonymized C-Zentrix/Dhwani call session IDs, booking timestamps, duty agent identifier, and selected referral dispensaries.</li>
          </ul>
        </section>

        {/* Section 3 */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <span>3. Clinical &amp; Operational Use of Data</span>
          </h2>
          <p>
            All captured data is strictly utilized for primary healthcare delivery and clinical guidance:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
              <strong className="text-slate-800 text-xs block">AI Clinical Urgency Scoring</strong>
              <p className="text-[11px] text-slate-500">
                Calculates urgency stratification (Emergent, Urgent, Moderate, Non-Urgent) to guide safe triage routing.
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
              <strong className="text-slate-800 text-xs block">Dispensary Slot Synchronization</strong>
              <p className="text-[11px] text-slate-500">
                Generates an immutable token for dispensary queue registration and doctor consultation desks.
              </p>
            </div>
          </div>
        </section>

        {/* Section 4 */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <span>4. Non-Clinical Call Segregation</span>
          </h2>
          <p>
            To ensure clinical data integrity, the EKMS platform strictly segregates non-clinical inquiries (such as e-Pehchan card downloads, medical reimbursements, dispensary timings, and cash benefits).
          </p>
          <p className="bg-amber-50/70 border border-amber-200 text-amber-900 p-3 rounded-xl text-xs leading-relaxed">
            <strong>Data Isolation Rule:</strong> Non-clinical calls do not contain medical diagnostic summaries, red-flag scores, or clinical prescriptions. They are stored under dedicated non-clinical administrative audit tags to avoid cluttering medical histories.
          </p>
        </section>

        {/* Section 5 */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <span>5. Cryptographic Security &amp; Role-Based Access Control</span>
          </h2>
          <p>
            Security measures implemented across the EKMS infrastructure include:
          </p>
          <ul className="list-disc list-inside space-y-1.5 pl-2 text-slate-600">
            <li><strong>Transport Security:</strong> All endpoints communicate exclusively over TLS 1.3 with HTTPS enforcement.</li>
            <li><strong>Storage Encryption:</strong> Google Cloud &amp; Firebase databases utilize AES-256 server-side encryption.</li>
            <li><strong>Session Compartmentalization:</strong> Session timeouts are enforced. Concurrent session hijacking prevention ensures agent workstation integrity.</li>
            <li><strong>IP Masking Options:</strong> Sensitive identification details can be masked in non-administrative views.</li>
          </ul>
        </section>

        {/* Section 6 */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <span>6. Inter-System Sync &amp; Telephony Bridges</span>
          </h2>
          <p>
            Real-time synchronization occurs between the Triage Helpline Application, the On-Premise Dispensary EKMS 3.0 Portal, and the C-Zentrix/Dhwani Telephony CTI Bridge.
          </p>
          <p>
            Status progression ranking ensures that once an appointment has progressed to <em>Visited</em>, <em>Consulted</em>, or <em>Dispensed</em> at an on-premise clinic, backward status downgrades are cryptographically rejected by synchronization engines.
          </p>
        </section>

        {/* Section 7 */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <span>7. Data Retention &amp; Beneficiary Rights</span>
          </h2>
          <p>
            In accordance with statutory healthcare preservation policies, clinical tele-triage encounters are retained for clinical continuity. Beneficiaries and authorized representatives have the right to:
          </p>
          <ul className="list-disc list-inside space-y-1 pl-2 text-slate-600">
            <li>Review scheduled or past appointment tokens.</li>
            <li>Request correction of demographic details (Name, Contact Number, Address).</li>
            <li>Request cancellation of upcoming appointments prior to clinic check-in.</li>
          </ul>
        </section>


      </div>
    </div>
  );
}
