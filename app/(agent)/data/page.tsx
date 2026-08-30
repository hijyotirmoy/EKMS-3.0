"use client";

import React, { useState } from "react";

export default function EkmsDataPage() {
  const [loading, setLoading] = useState(true);

  return (
    <div
      className="-mx-3.5 sm:-mx-6 lg:-mx-8 -my-2.5 sm:-my-6 h-[calc(100vh-3.5rem)] relative overflow-hidden bg-[#f8fafc] shadow-none border-0 isolate transform-gpu will-change-transform"
      style={{
        contain: "paint layout",
      }}
    >
      {/* Loading Indicator */}
      {loading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#f8fafc]">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mb-2" />
          <p className="text-xs font-semibold text-slate-500">Loading Data Hub...</p>
        </div>
      )}

      {/* 
        Full viewport-height iframe with GPU layer promotion and layout containment:
        - `contain: paint layout` isolates the iframe rendering so sidebar animations run at 60fps with zero lag.
        - `-mt-[64px]` clips the top header of data.ekms.in.
      */}
      <iframe
        src="https://data.ekms.in/"
        title="EKMS Data"
        onLoad={() => setLoading(false)}
        className="w-full h-[calc(100%+64px)] -mt-[64px] border-0 bg-transparent block shadow-none outline-none transform-gpu"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
