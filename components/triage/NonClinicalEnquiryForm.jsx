"use client";

import React from "react";
import { FileText, HelpCircle, CheckCircle2, AlertCircle, Info, Sparkles } from "lucide-react";

export const ENQUIRY_TYPES = [
  "NA",
  "Reimbursement",
  "ESIC Scheme",
  "e-Pehchan support",
  "Facility Navigation",
  "Others",
];

export function NonClinicalEnquiryForm({ value = {}, onChange }) {
  const enquiryType = value.enquiryType || "NA";
  const chiefIssue = value.chiefIssue || "";
  const remarks = value.remarks || "";

  const update = (patch) => {
    if (onChange) {
      onChange({
        enquiryType,
        chiefIssue,
        remarks,
        ...patch,
      });
    }
  };

  return (
    <div className="rounded-xl border border-indigo-400/30 bg-card overflow-hidden shadow-sm w-full max-w-full min-w-0 transition-all duration-200">
      {/* 1. Header Bar matching EKMS AI Chat Area container */}
      <div className="border-b border-border/50 bg-indigo-50/40 dark:bg-indigo-950/20 px-3.5 py-2.5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-800 border border-indigo-300 dark:bg-indigo-900/50 dark:text-indigo-200">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <span className="text-sm font-bold tracking-tight text-foreground">
                Non-Clinical Call / Information Desk
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Form Body */}
      <div className="p-4 sm:p-5 space-y-4">
        {/* Field 1: Enquiry Type */}
        <div className="space-y-1.5">
          <label className="field-label flex items-center justify-between">
            <span className="flex items-center gap-1 font-bold text-slate-800 dark:text-slate-200">
              Enquiry Type <span className="text-red-500 font-bold">*</span>
            </span>
            <span className="text-[10px] text-muted-foreground font-normal">Select service category</span>
          </label>
          <select
            value={enquiryType}
            onChange={(e) => update({ enquiryType: e.target.value })}
            className="w-full rounded-xl border border-border/80 bg-background px-3 py-2.5 text-xs sm:text-sm font-semibold text-foreground outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 shadow-2xs cursor-pointer"
          >
            {ENQUIRY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type === "NA" ? "Select Enquiry Type (NA)" : type}
              </option>
            ))}
          </select>
        </div>

        {/* Field 2: Chief Complaint / Issue */}
        <div className="space-y-1.5">
          <label className="field-label flex items-center justify-between">
            <span className="flex items-center gap-1 font-bold text-slate-800 dark:text-slate-200">
              Chief Complaint / Issue <span className="text-red-500 font-bold">*</span>
            </span>
            <span className="text-[10px] text-muted-foreground font-normal">Main beneficiary question</span>
          </label>
          <input
            type="text"
            value={chiefIssue}
            onChange={(e) => update({ chiefIssue: e.target.value })}
            placeholder="e.g. e-Pehchan card download error, reimbursement claim query, ESIS clinic timing..."
            className="w-full rounded-xl border border-border/80 bg-background px-3 py-2.5 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 shadow-2xs"
          />
        </div>

        {/* Field 3: Remarks */}
        <div className="space-y-1.5">
          <label className="field-label flex items-center justify-between">
            <span className="font-bold text-slate-800 dark:text-slate-200">Remarks</span>
            <span className="text-[10px] text-muted-foreground font-normal">Action taken / guidance given</span>
          </label>
          <textarea
            rows={4}
            value={remarks}
            onChange={(e) => update({ remarks: e.target.value })}
            placeholder="Enter caller remarks, action taken, guidance provided to beneficiary, or next steps..."
            className="w-full rounded-xl border border-border/80 bg-background px-3 py-2 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 shadow-2xs resize-y"
          />
        </div>

        {/* Non-Clinical Help Info Box */}
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 dark:bg-indigo-950/30 p-3 flex items-start gap-2.5 text-xs text-indigo-950 dark:text-indigo-200">
          <Info className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            This non-clinical call will be recorded in the system audit trail. If the caller starts describing acute physical or medical symptoms, toggle back to <strong>Clinical</strong> mode for AI-guided clinical triage.
          </p>
        </div>
      </div>
    </div>
  );
}
