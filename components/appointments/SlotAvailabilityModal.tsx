"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  CalendarClock,
  Calendar,
  Clock,
  Building2,
  X,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";
import {
  ALL_OPD_TIME_SLOTS,
  OPERATING_HOURS_LABEL,
  getTodayDateString,
  getTomorrowDateString,
  getYesterdayDateString,
  getNextWorkingDateString,
  findSlotBooking,
  isSlotInPast,
  areAllSlotsPastToday,
  isWeekendOrHoliday,
  getSaturdayInfo,
} from "@/lib/slotTiming";

interface SlotAvailabilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  appointments: any[];
  facilities?: any[];
  initialFacility?: string;
  initialDate?: string;
}

export function SlotAvailabilityModal({
  isOpen,
  onClose,
  appointments = [],
  facilities = [],
  initialFacility = "All Facilities",
  initialDate,
}: SlotAvailabilityModalProps) {
  const [slotDate, setSlotDate] = useState<string>(() => initialDate || getTodayDateString());
  const [selectedFacility, setSelectedFacility] = useState<string>(() => initialFacility || "All Facilities");
  const [selectedSlotDetail, setSelectedSlotDetail] = useState<any | null>(null);

  useEffect(() => {
    if (initialFacility) setSelectedFacility(initialFacility);
  }, [initialFacility]);

  useEffect(() => {
    if (initialDate) setSlotDate(initialDate);
  }, [initialDate]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  // Compute stats for current date and facility
  const stats = useMemo(() => {
    const isWeekend = isWeekendOrHoliday(slotDate);
    const satInfo = getSaturdayInfo(slotDate);

    let booked = 0;
    let past = 0;
    let available = 0;

    ALL_OPD_TIME_SLOTS.forEach((slot) => {
      const booking = findSlotBooking(slot, slotDate, selectedFacility, appointments);
      if (booking) {
        booked++;
      } else if (isWeekend) {
        // closed
      } else if (isSlotInPast(slot, slotDate)) {
        past++;
      } else {
        available++;
      }
    });

    return {
      total: ALL_OPD_TIME_SLOTS.length,
      booked,
      past,
      available,
      isWeekend,
      satInfo,
    };
  }, [slotDate, selectedFacility, appointments]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-5 bg-slate-950/75 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={() => {
        onClose();
        setSelectedSlotDetail(null);
      }}
    >
      <div
        className="w-full max-w-4xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-slate-200 bg-slate-50/70 px-5 sm:px-6 py-3.5 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-xs shrink-0">
              <CalendarClock className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-900">
                  OPD Slot Availability Overview
                </h2>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {OPERATING_HOURS_LABEL}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              onClose();
              setSelectedSlotDetail(null);
            }}
            className="h-8 w-8 rounded-lg hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition cursor-pointer"
            title="Close (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
          {/* Controls Row: Facility Selector & Date Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            {/* Facility Selector */}
            <div className="sm:col-span-7 space-y-1">
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Select Dispensary / Facility</span>
              </label>
              <div className="relative">
                <select
                  value={selectedFacility}
                  onChange={(e) => {
                    setSelectedFacility(e.target.value);
                    setSelectedSlotDetail(null);
                  }}
                  className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 pr-8 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition cursor-pointer appearance-none shadow-2xs"
                >
                  <option value="All Facilities">All Facilities (Combined)</option>
                  {facilities.map((f: any) => (
                    <option key={f.name || f.id} value={f.name}>
                      {f.name} {f.district ? `(${f.district})` : ""}
                    </option>
                  ))}
                  {facilities.length === 0 && (
                    <option value="ESIS Dispensary, Amingaon">ESIS Dispensary, Amingaon</option>
                  )}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* Date Selector & Quick Pills */}
            <div className="sm:col-span-5 space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Date</span>
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSlotDate(getYesterdayDateString());
                      setSelectedSlotDetail(null);
                    }}
                    className={`text-[10px] px-2 py-0.5 rounded font-bold transition cursor-pointer border ${
                      slotDate === getYesterdayDateString()
                        ? "bg-purple-600 text-white border-purple-600 shadow-2xs"
                        : "bg-white hover:bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                    title="View yesterday's bookings and slots"
                  >
                    Yesterday
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSlotDate(getTodayDateString());
                      setSelectedSlotDetail(null);
                    }}
                    className={`text-[10px] px-2 py-0.5 rounded font-bold transition cursor-pointer border ${
                      slotDate === getTodayDateString()
                        ? "bg-emerald-600 text-white border-emerald-600 shadow-2xs"
                        : "bg-white hover:bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSlotDate(getTomorrowDateString());
                      setSelectedSlotDetail(null);
                    }}
                    className={`text-[10px] px-2 py-0.5 rounded font-bold transition cursor-pointer border ${
                      slotDate === getTomorrowDateString()
                        ? "bg-emerald-600 text-white border-emerald-600 shadow-2xs"
                        : "bg-white hover:bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    Tomorrow
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSlotDate(getNextWorkingDateString(slotDate));
                      setSelectedSlotDetail(null);
                    }}
                    className="text-[10px] px-2 py-0.5 rounded font-bold transition cursor-pointer border bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200"
                    title="Skip weekend/holidays to next working day"
                  >
                    Next Day
                  </button>
                </div>
              </div>
              <input
                type="date"
                value={slotDate}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val) setSlotDate(val);
                  setSelectedSlotDetail(null);
                }}
                className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition cursor-pointer shadow-2xs"
              />
            </div>
          </div>

          {/* Status Summary Count Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                  Total Slots
                </span>
                <span className="text-base font-extrabold text-slate-900">
                  {stats.total}
                </span>
              </div>
              <Clock className="w-4 h-4 text-slate-400" />
            </div>

            <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 block">
                  Available
                </span>
                <span className="text-base font-extrabold text-emerald-700">
                  {stats.available}
                </span>
              </div>
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-2xs" />
            </div>

            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-800 block">
                  Booked
                </span>
                <span className="text-base font-extrabold text-rose-700">
                  {stats.booked}
                </span>
              </div>
              <div className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-2xs" />
            </div>

            <div className="p-2.5 rounded-xl bg-slate-100/70 border border-slate-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                  Past / Closed
                </span>
                <span className="text-base font-extrabold text-slate-600">
                  {stats.past}
                </span>
              </div>
              <div className="w-2.5 h-2.5 rounded-full bg-slate-400 shadow-2xs" />
            </div>
          </div>

          {/* Conditional Notices */}
          {slotDate < getTodayDateString() ? (
            <div className="p-3 rounded-xl bg-purple-50 border border-purple-200 text-purple-900 text-xs flex items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-purple-600 shrink-0" />
                <span>
                  <strong>Past Date Record ({slotDate}):</strong> Showing completed and booked slots history. Total <strong>{stats.booked}</strong> booking{stats.booked === 1 ? "" : "s"} were registered for this day.
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSlotDate(getTodayDateString());
                  setSelectedSlotDetail(null);
                }}
                className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-bold rounded-lg cursor-pointer shrink-0 transition"
              >
                Return to Today
              </button>
            </div>
          ) : stats.satInfo?.isSaturday && stats.satInfo?.isOpen ? (
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs flex items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-600 shrink-0" />
                <span>
                  <strong>Saturday:</strong> Dispensary operates from 10:00 AM to 04:00 PM today.
                </span>
              </div>
            </div>
          ) : stats.isWeekend ? (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                <span>Dispensaries are closed on Sunday. Working days (Mon–Sat): 10:00 AM – 04:00 PM.</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSlotDate(getNextWorkingDateString(slotDate));
                  setSelectedSlotDetail(null);
                }}
                className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold rounded-lg cursor-pointer shrink-0 transition"
              >
                View Next Working Day
              </button>
            </div>
          ) : slotDate === getTodayDateString() && areAllSlotsPastToday() ? (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>All consultation hours for today have closed. You can inspect tomorrow or next working day.</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSlotDate(getNextWorkingDateString(getTodayDateString()));
                  setSelectedSlotDetail(null);
                }}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold rounded-lg cursor-pointer shrink-0 transition"
              >
                View Next Working Day
              </button>
            </div>
          ) : null}

          {/* Slot Schedule Grid Header */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Day Schedule ({ALL_OPD_TIME_SLOTS.length} Slots · 3-Min Intervals)
            </span>
            <span className="text-[10.5px] text-slate-500">
              Click any booked slot to inspect patient and token details
            </span>
          </div>

          {/* All Slots Grid */}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5 border border-slate-200 rounded-2xl p-2.5 bg-slate-50/50 max-h-[380px] overflow-y-auto">
            {ALL_OPD_TIME_SLOTS.map((slot) => {
              const isWeekend = stats.isWeekend;
              const booking = findSlotBooking(slot, slotDate, selectedFacility, appointments);
              const isReserved = Boolean(booking);
              const isPast = !isReserved && isSlotInPast(slot, slotDate);
              const isDetailActive =
                selectedSlotDetail &&
                booking &&
                (selectedSlotDetail.id === booking.id || selectedSlotDetail.tokenNo === booking.tokenNo);

              return (
                <div
                  key={slot}
                  onClick={() => {
                    if (booking) {
                      setSelectedSlotDetail(isDetailActive ? null : booking);
                    }
                  }}
                  className={`rounded-lg p-1.5 text-center border flex flex-col items-center justify-center gap-0.5 transition shadow-2xs ${
                    isReserved
                      ? `bg-rose-50 border-rose-300 text-rose-800 cursor-pointer hover:bg-rose-100 shadow-2xs ${
                          isDetailActive ? "ring-2 ring-rose-500 border-rose-500 scale-[1.02]" : ""
                        }`
                      : isWeekend
                      ? "bg-slate-100 border-slate-200 text-slate-400 select-none opacity-60"
                      : isPast
                      ? "bg-slate-100/70 border-slate-200/80 text-slate-400 line-through select-none"
                      : "bg-emerald-50 border-emerald-300 text-emerald-800 font-semibold shadow-2xs"
                  }`}
                >
                  <span
                    className={`text-[10px] font-mono font-bold leading-tight ${
                      isPast ? "line-through text-slate-400" : "text-slate-800"
                    }`}
                  >
                    {slot}
                  </span>
                  {isReserved ? (
                    <div className="w-full flex flex-col items-center gap-0.5">
                      <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-rose-200/80 text-rose-900">
                        Booked
                      </span>
                      {booking && (
                        <div className="w-full truncate px-0.5 pt-0.5 border-t border-rose-200/80">
                          <p className="text-[9.5px] font-mono font-bold text-rose-800 truncate">
                            {booking.tokenNo || booking.referenceNo}
                          </p>
                          <p className="text-[9px] font-medium text-slate-800 truncate">
                            {booking.patientName || booking.ipName || "Beneficiary"}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : isWeekend ? (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">
                      Closed
                    </span>
                  ) : isPast ? (
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      Past
                    </span>
                  ) : (
                    <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-200 text-emerald-900">
                      Available
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Selected Slot Booking Details Drawer */}
          {selectedSlotDetail && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 animate-in fade-in slide-in-from-bottom-2 duration-150">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-extrabold px-2 py-0.5 rounded-md bg-rose-600 text-white">
                      {selectedSlotDetail.tokenNo || selectedSlotDetail.referenceNo}
                    </span>
                    <span className="text-xs font-bold text-slate-900">
                      {selectedSlotDetail.patientName || selectedSlotDetail.ipName}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      ({selectedSlotDetail.age || "—"} yrs, {selectedSlotDetail.gender || "—"})
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 uppercase">
                      {selectedSlotDetail.status || "Scheduled"}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs pt-1 text-slate-700">
                    <div>
                      <span className="font-semibold text-slate-500">Time Slot:</span>{" "}
                      <span className="font-mono font-bold text-slate-900">
                        {selectedSlotDetail.timeSlot || selectedSlotDetail.slot}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-500">Phone:</span>{" "}
                      <span className="font-mono text-slate-900">{selectedSlotDetail.phone || "—"}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-slate-500">Booked By:</span>{" "}
                      <span className="font-bold text-slate-900">
                        {selectedSlotDetail.bookedByName || selectedSlotDetail.bookedBy || selectedSlotDetail.agentName || (selectedSlotDetail.bookedByEmail ? selectedSlotDetail.bookedByEmail.split('@')[0] : "Agent")}
                      </span>
                    </div>
                  </div>
                  {selectedSlotDetail.chiefComplaint && (
                    <p className="text-xs text-slate-800 pt-0.5">
                      <span className="font-semibold text-slate-500">Chief Complaint:</span>{" "}
                      {selectedSlotDetail.chiefComplaint}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSlotDetail(null)}
                  className="p-1 rounded-lg hover:bg-rose-200/60 text-rose-700 transition cursor-pointer"
                  title="Close slot details"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="border-t border-slate-200 bg-slate-50/70 px-5 sm:px-6 py-3 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span>Available</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              <span>Booked</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
              <span>Past / Closed</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              onClose();
              setSelectedSlotDetail(null);
            }}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-xl transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
