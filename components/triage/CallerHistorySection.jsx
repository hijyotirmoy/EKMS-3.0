"use client";

import { useState, useMemo } from "react";
import {
  History,
  CalendarClock,
  Navigation,
  ChevronLeft,
  ChevronRight,
  Phone,
  PhoneCall,
} from "lucide-react";
import { UrgencyBadge } from "./UrgencyBadge";

import { getCallerIdForPhone } from "@/lib/callerId";
export { getCallerIdForPhone };

export const CallerHistorySection = ({
  form = {},
  callerHistory = [],
  currentAgent,
  activeCallerId,
  activeCaseRef,
}) => {
  // Pagination for Call History
  const [historyPage, setHistoryPage] = useState(1);
  const HISTORY_PER_PAGE = 5;

  const effectiveHistory = useMemo(() => {
    const seenRefs = new Set();
    return (callerHistory || []).filter((item) => {
      if (!item) return false;
      const itemRef = String(item.case_ref || item.caseId || item.case_id || item.id || "").trim().toUpperCase();
      if (itemRef) {
        if (seenRefs.has(itemRef)) return false;
        seenRefs.add(itemRef);
      }
      if (activeCaseRef) {
        const activeRef = String(activeCaseRef).trim().toUpperCase();
        if (itemRef && activeRef && itemRef === activeRef) return false;
        const matchNum = (s) => {
          const m = String(s || "").match(/(\d{3,5})/);
          return m ? parseInt(m[1], 10) : null;
        };
        const itemNum = matchNum(itemRef);
        const activeNum = matchNum(activeRef);
        if (itemNum && activeNum && itemNum === activeNum) return false;
      }
      return true;
    });
  }, [callerHistory, activeCaseRef]);

  const phoneDigits = useMemo(() => {
    return (form.phone || "").replace(/\D/g, "");
  }, [form.phone]);

  const totalPages = Math.ceil(effectiveHistory.length / HISTORY_PER_PAGE) || 1;
  const currentPage = Math.min(Math.max(1, historyPage), totalPages);
  const paginated = effectiveHistory.slice(
    (currentPage - 1) * HISTORY_PER_PAGE,
    currentPage * HISTORY_PER_PAGE
  );

  return (
    <div className="w-full rounded-xl border border-border/80 bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 bg-muted/30 px-3.5 py-3 sm:px-4">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-primary shrink-0" />
          <h3 className="text-xs sm:text-sm font-bold text-foreground">
            Caller Call History
          </h3>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-extrabold text-primary">
            {effectiveHistory.length} {effectiveHistory.length === 1 ? "call" : "calls"}
          </span>
        </div>

        {phoneDigits && (
          <div className="flex items-center gap-1.5 mono text-[11px] text-muted-foreground font-semibold bg-background/80 px-2.5 py-1 rounded-md border border-border/60">
            <Phone className="h-3 w-3 text-primary shrink-0" />
            +91 {phoneDigits}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3.5 sm:p-5">
        {!effectiveHistory || effectiveHistory.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 bg-card/60 p-8 text-center">
            <History className="mx-auto h-8 w-8 text-muted-foreground/60 mb-2" />
            <h4 className="text-sm font-bold text-foreground">No Call History Found</h4>
            <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
              {phoneDigits
                ? `No prior triage calls recorded under +91 ${phoneDigits}. Connected calls and submitted triages will appear here automatically.`
                : "Enter a phone number in the caller intake form to view previous call logs."}
            </p>
          </div>
        ) : (
          <div className="space-y-3.5">
            <div className="space-y-3">
              {paginated.map((item, idx) => {
                const isItemNonClin = Boolean(
                  item.isNonClinical ||
                  item.call_type === "non_clinical" ||
                  item.callType === "non_clinical" ||
                  item.enquiry_type ||
                  item.enquiryType ||
                  String(item.reason || item.chief_complaint || "").startsWith("[Enquiry:") ||
                  String(item.reason || item.chief_complaint || "").startsWith("[") ||
                  String(item.summary || "").toLowerCase().includes("non-clinical")
                );

                const isExplicitCallOnly =
                  item.status === "call_only" ||
                  item.booking_status === "call_only" ||
                  item.booked_appointment === null;

                let bookedAppt = isExplicitCallOnly ? null : (item.booked_appointment || null);
                if (!bookedAppt && !isExplicitCallOnly && typeof window !== "undefined" && item.case_ref) {
                  try {
                    const localStored = localStorage.getItem(`ekms_appt_${item.case_ref}`);
                    if (localStored) bookedAppt = JSON.parse(localStored);
                  } catch (_) {}
                }

                const rawNav = String(item.navigation || item.recommended_action || item.category || "").trim();
                const hasExplicitBookingText = !isExplicitCallOnly && rawNav.toLowerCase().includes("appointment booked at");
                const hasBookedAppointmentObj = Boolean(
                  !isExplicitCallOnly &&
                  ((bookedAppt && (bookedAppt.tokenNo || bookedAppt.token || bookedAppt.timeSlot || bookedAppt.slot || bookedAppt.dispensaryName || bookedAppt.facilityName)) ||
                  (item.booked_appointment && (item.booked_appointment.tokenNo || item.booked_appointment.token || item.booked_appointment.timeSlot || item.booked_appointment.facilityName)) ||
                  item.booking_token ||
                  item.hasAppointment === true)
                );
                const isBooked = Boolean(!isExplicitCallOnly && (hasExplicitBookingText || hasBookedAppointmentObj));

                // Clean single-line navigation
                let navTextDisplay = "";
                if (isBooked) {
                  const facName =
                    bookedAppt?.facilityName ||
                    bookedAppt?.dispensaryName ||
                    item.booked_appointment?.facilityName ||
                    item.booked_appointment?.dispensaryName ||
                    rawNav.match(/Appointment booked at ([^(\.]+)/i)?.[1]?.trim() ||
                    item.forwarded_facility_name ||
                    "Dispensary";

                  const dateMatch = rawNav.match(/on\s+(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})/i);
                  const dateVal = bookedAppt?.date || item.booked_appointment?.date || (dateMatch ? dateMatch[1] : "");

                  const slotMatch = rawNav.match(/\((\d{1,2}:\d{2}\s*(?:AM|PM)\s*-\s*\d{1,2}:\d{2}\s*(?:AM|PM))\)/i);
                  const slotVal = bookedAppt?.timeSlot || item.booked_appointment?.timeSlot || (slotMatch ? slotMatch[1] : "");

                  const datePart = dateVal ? ` on ${dateVal}` : "";
                  const slotPart = slotVal ? ` (${slotVal})` : "";

                  navTextDisplay = `Appointment booked at ${facName}${datePart}${slotPart}.`;
                } else {
                  navTextDisplay = rawNav
                    .replace(/\s*Advise patient to visit.*?hours\.?/gi, "")
                    .replace(/\s*Routed Facility:.*?$/gi, "")
                    .replace(/\s*\([^)]*·[^)]*\)/gi, "")
                    .replace(/\s*\([^)]*Dispensary\)/gi, "")
                    .trim();
                  if (!navTextDisplay) {
                    navTextDisplay = "Standard consultation / triage guidance";
                  }
                }

                return (
                  <div
                    key={item.id ? `hist_${item.id}_${idx}` : `${item.case_ref || "hist"}_${idx}`}
                    className="rounded-lg border border-border/70 bg-card p-3 sm:p-4 shadow-2xs transition-colors hover:border-primary/50"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                          <CalendarClock className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span>
                            {(item.created_at || item.createdAt || item.timestamp)
                              ? new Date(item.created_at || item.createdAt || item.timestamp).toLocaleString("en-IN", {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "Recent call"}
                          </span>
                        </div>
                        <span className="mono text-[11px] text-primary/80 font-bold">
                          {item.case_ref ||
                            item.caseId ||
                            item.case_id ||
                            (item.caller_id && !item.caller_id.match(/^\d{6}-\d{5}$/) ? item.caller_id : "") ||
                            (item.id && String(item.id).startsWith("CA") ? item.id : "") ||
                            (activeCallerId && !activeCallerId.match(/^\d{6}-\d{5}$/) ? activeCallerId : "") ||
                            "Case"}
                        </span>
                      </div>

                      {/* In place of Mild / Moderate, write CLINICAL and NON-CLINICAL, and if not booked, write CALL ONLY near it */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {isItemNonClin ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-orange-100 text-orange-800 border border-orange-300">
                            NON-CLINICAL
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-blue-100 text-blue-800 border border-blue-300">
                            CLINICAL
                          </span>
                        )}

                        {!isBooked && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-purple-50 text-purple-800 border border-purple-300 shadow-2xs">
                            <PhoneCall className="w-3 h-3 text-purple-600" />
                            <span>CALL ONLY</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {isItemNonClin ? "Reason for Call / Enquiry" : "Reason for Call / Symptoms"}
                      </p>
                      <p className="mt-0.5 text-xs text-foreground/90 leading-relaxed font-medium">
                        {item.reason || item.summary || item.notes || item.campaign || "Inbound consultation"}
                      </p>
                    </div>

                    {/* Single-line Navigation Provided by Agent (No separate redundant Routed Facility line) */}
                    <div className="mt-2.5 rounded-md bg-emerald-50/80 dark:bg-emerald-950/20 border border-emerald-300/80 dark:border-emerald-800 p-2.5 text-xs shadow-2xs">
                      <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-emerald-900 dark:text-emerald-400">
                        <Navigation className="h-3 w-3 shrink-0 text-emerald-700 dark:text-emerald-400" />
                        <span>Navigation Provided by Agent</span>
                      </div>
                      <p className="mt-0.5 text-xs font-semibold text-emerald-950 dark:text-emerald-200 leading-relaxed">
                        {navTextDisplay}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border/60 pt-2.5 text-xs">
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                  className="flex items-center gap-1 rounded-md border border-border/70 bg-secondary/40 px-2.5 py-1 text-xs font-semibold hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Previous
                </button>
                <span className="text-muted-foreground">
                  Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
                </span>
                <button
                  type="button"
                  disabled={currentPage === totalPages}
                  onClick={() => setHistoryPage((p) => Math.min(totalPages, p + 1))}
                  className="flex items-center gap-1 rounded-md border border-border/70 bg-secondary/40 px-2.5 py-1 text-xs font-semibold hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CallerHistorySection;
