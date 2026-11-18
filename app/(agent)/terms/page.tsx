"use client";

import React, { useEffect } from "react";
import {
  AlertTriangle,
  Printer,
  Stethoscope,
  Building2,
  Lock,
} from "lucide-react";

export default function TermsPage() {
  useEffect(() => {
    document.title = "Terms & Conditions";
  }, []);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="w-full space-y-6 pb-12 animate-in fade-in duration-200">
      {/* Simple Clean Header without subtitle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Terms &amp; Conditions</h1>
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

      {/* Clinical Guidance Advisory Notice */}
      <div className="bg-amber-50/80 border border-amber-200/90 rounded-2xl p-4 sm:p-5 text-amber-950 space-y-2 shadow-2xs">
        <div className="flex items-center gap-2 font-bold text-amber-800 text-sm">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <span>Clinical &amp; Operational Guidance Advisory Notice</span>
        </div>
        <p className="text-xs sm:text-[13px] text-amber-900/90 leading-relaxed">
          The ESIC Employee Knowledge Management System (EKMS) serves as an <strong>institutional clinical decision support and operational knowledge repository</strong> for certified healthcare providers, dispensary personnel, and administrative staff. Guidance notes, standard operating procedures (SOPs), clinical red flags, and diagnostic protocols provided within EKMS are designed to aid clinical workflow and do not supersede the professional medical judgment of registered medical practitioners or attending dispensary doctors.
        </p>
      </div>

      {/* 3 Operational Highlights Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs space-y-1.5">
          <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center">
            <Stethoscope className="w-4 h-4" />
          </div>
          <h3 className="font-bold text-slate-900 text-xs">Clinical Guidance Support</h3>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Diagnostic trees, medication guides, and red-flag protocols support clinical evaluation; attending doctors retain complete prescriptive autonomy.
          </p>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs space-y-1.5">
          <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center">
            <Building2 className="w-4 h-4" />
          </div>
          <h3 className="font-bold text-slate-900 text-xs">Dispensary Queue Protocol</h3>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Tokens, patient check-ins at Reception, Doctor consultations, and Pharmacy dispensations follow real-time synchronized queue management.
          </p>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs space-y-1.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center">
            <Lock className="w-4 h-4" />
          </div>
          <h3 className="font-bold text-slate-900 text-xs">RBAC &amp; Training Integrity</h3>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Course modules, assessment scores, and administrative credentials are role-gated, encrypted, and governed by strict professional accountability.
          </p>
        </div>
      </div>

      {/* Main Clean Terms Content Card */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-2xs space-y-8 text-xs sm:text-sm text-slate-700 leading-relaxed">
        {/* Section 1 */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <span>1. Scope &amp; Institutional Purpose</span>
          </h2>
          <p>
            The Employee Knowledge Management System (EKMS) is the unified clinical guidance, training evaluation, and on-premise dispensary workflow system deployed across ESIS dispensaries and ESIC regional administrative offices.
          </p>
          <p>
            By accessing or operating EKMS—whether as an attending medical officer, pharmacist, dispensary receptionist, helpline agent, or administrator—you agree to comply with and be bound by these Terms and Conditions.
          </p>
        </section>

        {/* Section 2 */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <span>2. Clinical Decision Support &amp; Knowledge Base Disclaimer</span>
          </h2>
          <p>
            The EKMS Knowledge Base provides evidence-based standard treatment guidelines, clinical triage decision trees, drug formulary lookups, and statutory ESIC scheme circulars:
          </p>
          <ul className="list-disc list-inside space-y-1.5 pl-2 text-slate-600">
            <li>Guidance materials, diagnostic differential checklists, and clinical red flags serve solely as assistive decision-support tools.</li>
            <li>Registered Medical Practitioners (Doctors) retain complete and independent clinical authority over physical patient examinations, formal diagnoses, and medicinal prescriptions.</li>
            <li>In cases involving acute, life-threatening emergencies, clinical staff must initiate immediate emergency resuscitation and coordinate emergency ambulance (108) transfer protocols.</li>
          </ul>
        </section>

        {/* Section 3 */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <span>3. On-Premise Dispensary Queue &amp; OPD Management</span>
          </h2>
          <p>
            Dispensary operations conducted via EKMS adhere to sequential queue progression:
          </p>
          <div className="space-y-2 pt-1 text-slate-600">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <strong>Reception Desk Check-in:</strong> Arriving beneficiaries present appointment tokens (e.g., <code>ESIC-XXXXX-DISP</code>) or registered phone numbers for queue confirmation and initial vital signs entry.
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <strong>Doctor Desk Consultation:</strong> Medical officers review visit histories, document clinical diagnoses, record consultation notes, and generate pharmacological prescription instructions.
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <strong>Pharmacy Dispensation:</strong> Pharmacists verify doctor prescriptions, dispense allocated medications, record dispensation remarks, and mark encounters completed.
            </div>
          </div>
        </section>

        {/* Section 4 */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <span>4. Training Modules, Quizzes &amp; Staff Evaluation</span>
          </h2>
          <p>
            EKMS provides continuous professional education and standard operating procedure (SOP) modules for institutional personnel:
          </p>
          <ul className="list-disc list-inside space-y-1.5 pl-2 text-slate-600">
            <li>Staff are expected to independently review assigned course modules and complete required assessments within stipulated timelines.</li>
            <li>Quiz results, completion badges, and evaluation scores are tracked on institutional profiles for training compliance and skill accreditation.</li>
            <li>Attempting to bypass assessments, manipulate scoring mechanisms, or share assessment answer keys is strictly prohibited.</li>
          </ul>
        </section>

        {/* Section 5 */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <span>5. User Authentication, Credentials &amp; Audit Accountability</span>
          </h2>
          <p>
            All staff granted access to EKMS must adhere to rigorous security obligations:
          </p>
          <ul className="list-disc list-inside space-y-1 pl-2 text-slate-600">
            <li>User credentials, passwords, and multi-factor tokens must remain strictly confidential and never be shared.</li>
            <li>All patient interactions, prescription submissions, and report filings are permanently logged with agent/doctor identifiers for audit and quality assurance.</li>
            <li>Users must immediately report any suspected credential compromise or unauthorized access to system administrators.</li>
          </ul>
        </section>

        {/* Section 6 */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <span>6. Reporting, Doubts Resolution &amp; Knowledge Base Updates</span>
          </h2>
          <p>
            EKMS incorporates continuous quality improvement channels:
          </p>
          <p className="text-slate-600">
            Staff and users may raise clinical doubts, report missing guideline content, suggest facility directory updates, or submit system feedback via the Reports and Contact desks. Submitted tickets are tracked under official reference identifiers until resolution by designated coordinators.
          </p>
        </section>

        {/* Section 7 */}
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <span>7. Data Protection, Statutory Compliance &amp; Jurisdiction</span>
          </h2>
          <p>
            All beneficiary health information, IP records, and clinical files are encrypted and processed in conformity with the <strong>Employees’ State Insurance Act, 1948</strong>, the Digital Personal Data Protection Act, and applicable national health data management directives.
          </p>
          <p>
            These Terms and Conditions are governed by the laws of India, and any legal proceedings shall be subject to the exclusive jurisdiction of the competent courts in Guwahati, Assam.
          </p>
        </section>
      </div>
    </div>
  );
}
