"use client";

import React, { useState } from "react";
import { Trash2, X } from "lucide-react";

interface CancelAppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
  tokenNo: string;
  patientName: string;
  loading?: boolean;
}

export function CancelAppointmentModal({
  isOpen,
  onClose,
  onConfirm,
  tokenNo,
  patientName,
  loading = false,
}: CancelAppointmentModalProps) {
  const [reason, setReason] = useState("");

  if (!isOpen) return null;

  const handleConfirm = async () => {
    await onConfirm(reason);
    setReason("");
  };

  const handleClose = () => {
    if (loading) return;
    setReason("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white max-w-md w-full rounded-3xl shadow-2xl p-6 border border-slate-100 text-center animate-in zoom-in-95 duration-150">
        {/* Trash Icon */}
        <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-500 mx-auto mb-3">
          <Trash2 className="w-6 h-6" />
        </div>

        {/* Title & Patient Info */}
        <h3 className="text-base font-extrabold text-slate-900">
          Cancel Appointment {tokenNo}?
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          Are you sure you want to cancel the scheduled appointment for{" "}
          <strong className="text-slate-700 font-bold">{patientName}</strong>?
        </p>

        {/* Optional Cancellation Reason Textarea */}
        <div className="mt-4 text-left">
          <label className="block text-[11px] font-bold text-slate-700 mb-1">
            Reason for cancellation <span className="text-slate-400 font-normal">(Optional)</span>
          </label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Enter reason for cancellation (e.g. Beneficiary requested, patient unwell, incorrect booking)..."
            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-rose-500/20 focus:border-rose-400 text-slate-800 transition resize-none placeholder:text-slate-400 font-medium"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 mt-5">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition cursor-pointer shadow-xs disabled:opacity-50"
          >
            {loading ? "Cancelling..." : "Yes, Cancel Appointment"}
          </button>
        </div>
      </div>
    </div>
  );
}
