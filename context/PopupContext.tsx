"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  X,
  Trash2,
} from "lucide-react";

export type PopupType = "success" | "error" | "warning" | "info" | "danger";

export interface ToastItem {
  id: string;
  type: PopupType;
  title?: string;
  message: string;
  duration?: number;
}

export interface AlertOptions {
  title?: string;
  message: string;
  type?: PopupType;
  confirmText?: string;
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  type?: PopupType;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
}

interface PopupContextValue {
  showToast: (message: string, type?: PopupType, title?: string, duration?: number) => void;
  showAlert: (options: AlertOptions | string) => Promise<void>;
  showConfirm: (options: ConfirmOptions | string) => Promise<boolean>;
  toast: {
    success: (message: string, title?: string) => void;
    error: (message: string, title?: string) => void;
    info: (message: string, title?: string) => void;
    warning: (message: string, title?: string) => void;
  };
}

const PopupContext = createContext<PopupContextValue | null>(null);

export function PopupProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Alert Modal State
  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: PopupType;
    confirmText: string;
    resolve?: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    type: "info",
    confirmText: "Okay",
  });

  // Confirm Modal State
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: PopupType;
    confirmText: string;
    cancelText: string;
    isDestructive: boolean;
    resolve?: (value: boolean) => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    type: "warning",
    confirmText: "Confirm",
    cancelText: "Cancel",
    isDestructive: false,
  });

  // --- 1. TOAST METHODS ---
  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: PopupType = "info", title?: string, duration: number = 3500) => {
      const id = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const newToast: ToastItem = { id, type, title, message, duration };
      setToasts((prev) => [...prev, newToast]);

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }
    },
    [removeToast]
  );

  const toast = {
    success: (msg: string, title?: string) => showToast(msg, "success", title),
    error: (msg: string, title?: string) => showToast(msg, "error", title),
    info: (msg: string, title?: string) => showToast(msg, "info", title),
    warning: (msg: string, title?: string) => showToast(msg, "warning", title),
  };

  // --- 2. ALERT MODAL METHOD ---
  const showAlert = useCallback((options: AlertOptions | string): Promise<void> => {
    return new Promise((resolve) => {
      if (typeof options === "string") {
        setAlertState({
          isOpen: true,
          title: "Notification",
          message: options,
          type: "info",
          confirmText: "Okay",
          resolve,
        });
      } else {
        setAlertState({
          isOpen: true,
          title: options.title || "Notification",
          message: options.message,
          type: options.type || "info",
          confirmText: options.confirmText || "Okay",
          resolve,
        });
      }
    });
  }, []);

  const handleAlertClose = () => {
    if (alertState.resolve) alertState.resolve();
    setAlertState((prev) => ({ ...prev, isOpen: false }));
  };

  // --- 3. CONFIRM MODAL METHOD ---
  const showConfirm = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (typeof options === "string") {
        setConfirmState({
          isOpen: true,
          title: "Confirmation",
          message: options,
          type: "warning",
          confirmText: "Confirm",
          cancelText: "Cancel",
          isDestructive: false,
          resolve,
        });
      } else {
        setConfirmState({
          isOpen: true,
          title: options.title || "Confirmation",
          message: options.message,
          type: options.type || (options.isDestructive ? "danger" : "warning"),
          confirmText: options.confirmText || "Confirm",
          cancelText: options.cancelText || "Cancel",
          isDestructive: !!options.isDestructive,
          resolve,
        });
      }
    });
  }, []);

  const handleConfirmAction = (result: boolean) => {
    if (confirmState.resolve) confirmState.resolve(result);
    setConfirmState((prev) => ({ ...prev, isOpen: false }));
  };

  return (
    <PopupContext.Provider value={{ showToast, showAlert, showConfirm, toast }}>
      {children}

      {/* ----------------------------------------------------
          1. FLOATING TOASTS CONTAINER (Top Right)
          ---------------------------------------------------- */}
      <div className="fixed top-16 right-4 z-[9999] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-2 sm:px-0">
        {toasts.map((t) => {
          const isSuccess = t.type === "success";
          const isError = t.type === "error" || t.type === "danger";
          const isWarning = t.type === "warning";

          return (
            <div
              key={t.id}
              className={`pointer-events-auto p-4 rounded-2xl shadow-2xl border backdrop-blur-md transition-all duration-300 transform translate-y-0 animate-in slide-in-from-top-4 flex items-start gap-3 select-none ${
                isSuccess
                  ? "bg-emerald-50/95 border-emerald-200 text-emerald-950"
                  : isError
                  ? "bg-rose-50/95 border-rose-200 text-rose-950"
                  : isWarning
                  ? "bg-amber-50/95 border-amber-200 text-amber-950"
                  : "bg-white/95 border-slate-200 text-slate-900"
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {isSuccess && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
                {isError && <AlertCircle className="w-5 h-5 text-rose-600" />}
                {isWarning && <AlertTriangle className="w-5 h-5 text-amber-600" />}
                {!isSuccess && !isError && !isWarning && <Info className="w-5 h-5 text-blue-600" />}
              </div>

              <div className="flex-1 min-w-0">
                {t.title && <div className="font-bold text-xs leading-tight mb-0.5">{t.title}</div>}
                <div className="text-xs leading-snug font-medium opacity-90">{t.message}</div>
              </div>

              <button
                onClick={() => removeToast(t.id)}
                className="text-slate-400 hover:text-slate-700 p-0.5 rounded-lg transition-colors shrink-0 -mr-1 -mt-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      {/* ----------------------------------------------------
          2. BEAUTIFUL ALERT MODAL
          ---------------------------------------------------- */}
      {alertState.isOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white max-w-sm w-full rounded-3xl shadow-2xl p-6 border border-slate-100 text-center space-y-4 animate-in zoom-in-95 duration-200">
            <div
              className={`w-14 h-14 rounded-2xl mx-auto flex items-center justify-center shadow-inner ${
                alertState.type === "success"
                  ? "bg-emerald-100 text-emerald-600"
                  : alertState.type === "error" || alertState.type === "danger"
                  ? "bg-rose-100 text-rose-600"
                  : alertState.type === "warning"
                  ? "bg-amber-100 text-amber-600"
                  : "bg-blue-100 text-blue-600"
              }`}
            >
              {alertState.type === "success" && <CheckCircle2 className="w-7 h-7" />}
              {(alertState.type === "error" || alertState.type === "danger") && (
                <AlertCircle className="w-7 h-7" />
              )}
              {alertState.type === "warning" && <AlertTriangle className="w-7 h-7" />}
              {alertState.type === "info" && <Info className="w-7 h-7" />}
            </div>

            <div>
              <h3 className="text-lg font-extrabold text-slate-900 leading-tight">
                {alertState.title}
              </h3>
              <p className="text-xs text-slate-600 font-medium mt-2 leading-relaxed whitespace-pre-line">
                {alertState.message}
              </p>
            </div>

            <div className="pt-2">
              <button
                onClick={handleAlertClose}
                className={`w-full py-2.5 px-4 text-white text-xs font-bold rounded-xl shadow-md transition-all duration-200 active:scale-95 ${
                  alertState.type === "success"
                    ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20"
                    : alertState.type === "error" || alertState.type === "danger"
                    ? "bg-rose-600 hover:bg-rose-700 shadow-rose-500/20"
                    : alertState.type === "warning"
                    ? "bg-amber-500 hover:bg-amber-600 shadow-amber-500/20"
                    : "bg-blue-600 hover:bg-blue-700 shadow-blue-500/20"
                }`}
              >
                {alertState.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------
          3. BEAUTIFUL CONFIRMATION MODAL
          ---------------------------------------------------- */}
      {confirmState.isOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white max-w-sm w-full rounded-3xl shadow-2xl p-6 border border-slate-100 text-center space-y-4 animate-in zoom-in-95 duration-200">
            <div
              className={`w-14 h-14 rounded-2xl mx-auto flex items-center justify-center shadow-inner ${
                confirmState.isDestructive || confirmState.type === "danger"
                  ? "bg-rose-100 text-rose-600"
                  : confirmState.type === "warning"
                  ? "bg-amber-100 text-amber-600"
                  : "bg-blue-100 text-blue-600"
              }`}
            >
              {confirmState.isDestructive || confirmState.type === "danger" ? (
                <Trash2 className="w-7 h-7" />
              ) : confirmState.type === "warning" ? (
                <AlertTriangle className="w-7 h-7" />
              ) : (
                <Info className="w-7 h-7" />
              )}
            </div>

            <div>
              <h3 className="text-lg font-extrabold text-slate-900 leading-tight">
                {confirmState.title}
              </h3>
              <p className="text-xs text-slate-600 font-medium mt-2 leading-relaxed">
                {confirmState.message}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => handleConfirmAction(false)}
                className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all duration-200 active:scale-95"
              >
                {confirmState.cancelText}
              </button>
              <button
                type="button"
                onClick={() => handleConfirmAction(true)}
                className={`w-full py-2.5 px-4 text-white text-xs font-bold rounded-xl shadow-md transition-all duration-200 active:scale-95 ${
                  confirmState.isDestructive || confirmState.type === "danger"
                    ? "bg-rose-600 hover:bg-rose-700 shadow-rose-500/20"
                    : confirmState.type === "warning"
                    ? "bg-amber-500 hover:bg-amber-600 shadow-amber-500/20"
                    : "bg-blue-600 hover:bg-blue-700 shadow-blue-500/20"
                }`}
              >
                {confirmState.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </PopupContext.Provider>
  );
}

export function usePopup() {
  const context = useContext(PopupContext);
  if (!context) {
    throw new Error("usePopup must be used within a PopupProvider");
  }
  return context;
}
