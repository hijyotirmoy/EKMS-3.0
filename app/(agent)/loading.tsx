import React from "react";

export default function Loading() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Skeleton Header Search Row */}
      <div className="flex items-center gap-2 overflow-hidden pb-1">
        {[110, 85, 130, 95, 120, 90, 105].map((w, i) => (
          <div
            key={i}
            className="h-8 bg-slate-200 rounded-full animate-pulse shrink-0"
            style={{ width: `${w}px` }}
          />
        ))}
      </div>

      {/* 6 Shimmering Skeleton Q&A Cards */}
      <div className="space-y-4">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <div
            key={n}
            className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3.5 animate-pulse"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-5 w-16 bg-slate-200 rounded-md" />
                <div className="h-5 w-28 bg-blue-100 rounded-md" />
              </div>
              <div className="h-4 w-20 bg-slate-100 rounded" />
            </div>

            <div className="space-y-2 pt-1">
              <div className="h-5 w-4/5 bg-slate-200 rounded-md" />
              <div className="h-4 w-3/5 bg-slate-100 rounded-md" />
            </div>

            <div className="space-y-1.5 pt-1">
              <div className="h-3.5 w-full bg-slate-100 rounded" />
              <div className="h-3.5 w-11/12 bg-slate-100 rounded" />
              <div className="h-3.5 w-4/6 bg-slate-100 rounded" />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <div className="h-4 w-20 bg-blue-100 rounded" />
              <div className="h-4 w-16 bg-slate-100 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
