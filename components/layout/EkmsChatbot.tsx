"use client";

import React, { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { X, Bot } from "lucide-react";

const esicMessages = [
  "Hi, do you want to know about ESIC?",
  "Hi, want to know about ESIC benefits?",
  "Need help checking your ESIC claim status?",
  "Ask me about Maternity Benefits under ESIC.",
  "Wondering how Dependants' Benefit works?",
  "I can help you understand the Unemployment Allowance (ABVKY).",
  "Got questions about ESI dispensaries? Ask away!",
  "Hi! I'm EKMS AI. How can I make your day easier?",
  "Need to register an employee? I can guide you.",
  "Learn about Cashless Medical Care right here.",
  "Confused about Permanent Disablement Benefit? Let's chat.",
  "Looking for the nearest ESI hospital or dispensary?",
  "Want to know what medical treatments are covered?",
  "Ask me about Super Speciality treatment under ESIC.",
  "Falling sick? Learn about the Sickness Benefit.",
  "How do you download your e-Pehchan card? Let me guide you.",
  "What is the current ESIC employee contribution rate?",
  "What is the current wage limit for ESIC coverage?",
];

export default function EkmsChatbot() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [tooltipText, setTooltipText] = useState<string | null>(null);
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Random prompt tooltip logic (only active on home page)
  useEffect(() => {
    if (pathname !== "/") return;

    let timeoutId: NodeJS.Timeout;

    const scheduleNext = () => {
      const delay = Math.floor(Math.random() * 12000) + 8000; // 8s to 20s
      timeoutId = setTimeout(() => {
        if (!isOpen) {
          const randomIndex = Math.floor(Math.random() * esicMessages.length);
          setTooltipText(esicMessages[randomIndex]);
          setIsTooltipVisible(true);

          setTimeout(() => {
            setIsTooltipVisible(false);
            scheduleNext();
          }, 5000);
        } else {
          scheduleNext();
        }
      }, delay);
    };

    const initialTimeout = setTimeout(scheduleNext, 3000);

    return () => {
      clearTimeout(initialTimeout);
      clearTimeout(timeoutId);
    };
  }, [isOpen, pathname]);

  // Close when clicking outside
  useEffect(() => {
    if (pathname !== "/") return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        isOpen
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, pathname]);

  if (pathname !== "/") {
    return null;
  }

  return (
    <div ref={containerRef} className="fixed bottom-6 right-6 z-50 select-none">
      {/* Speech Bubble Tooltip Positioned to the Top-Left of the Bot */}
      {isTooltipVisible && tooltipText && !isOpen && (
        <div
          onClick={() => {
            setIsOpen(true);
            setIsTooltipVisible(false);
          }}
          className="absolute bottom-2 right-16 mr-2 w-64 p-3.5 bg-white/95 backdrop-blur-md text-slate-800 text-xs rounded-2xl rounded-br-xs shadow-2xl border border-slate-200/90 animate-in fade-in slide-in-from-right-3 duration-300 zoom-in-95 cursor-pointer hover:border-blue-300 hover:shadow-blue-500/10 transition-all group"
        >
          {/* Header with mini AI tag & prompt */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-blue-600 uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
              <span>EKMS AI</span>
            </div>
            <span className="text-[9px] text-slate-400 font-medium group-hover:text-blue-500 transition-colors">
              Click to chat →
            </span>
          </div>

          <p className="font-medium text-slate-800 leading-relaxed text-xs">
            {tooltipText}
          </p>

          {/* Speech bubble arrow pointer facing the bot on the right */}
          <div className="absolute -right-2 bottom-3.5 w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-l-[8px] border-l-white drop-shadow-xs" />
        </div>
      )}

      {/* Chatbot Window */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 w-[380px] sm:w-[420px] h-[580px] max-h-[80vh] max-w-[90vw] bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-700 animate-in fade-in slide-in-from-bottom-4 duration-200 flex flex-col z-50">
          <div className="px-4 py-3 bg-slate-800/90 backdrop-blur-sm border-b border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center bg-white p-0.5 border border-slate-700 shadow-xs shrink-0">
                <img
                  src="/animation-gif.gif"
                  alt="EKMS AI"
                  className="w-full h-full object-contain"
                />
              </div>
              <div>
                <div className="text-sm font-bold text-white leading-tight">EKMS AI Assistant</div>
                <div className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Online
                </div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-700/60 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <iframe
            src="https://ai.ekms.in/"
            title="EKMS AI Chatbot"
            className="w-full flex-1 border-0 bg-white"
          />
        </div>
      )}

      {/* Floating Action Button with Animated GIF */}
      <div className="relative group">
        <button
          onClick={() => {
            setIsOpen(!isOpen);
            setIsTooltipVisible(false);
          }}
          className={`w-14 h-14 rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.22)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.3)] flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95 focus:outline-none ring-4 ring-black/5 ${
            isOpen ? "bg-slate-900 text-white border-2 border-white" : "bg-white p-1 border-2 border-slate-200"
          }`}
          title={isOpen ? "Close Assistant" : "Ask EKMS AI"}
        >
          {isOpen ? (
            <X className="w-6 h-6 animate-in spin-in-90 duration-200" />
          ) : (
            <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center bg-white">
              <img
                src="/animation-gif.gif"
                alt="EKMS AI"
                className="w-full h-full object-contain"
              />
            </div>
          )}
        </button>

        {/* Green Online Indicator placed over circle without getting cut off */}
        {!isOpen && (
          <span className="absolute bottom-0 right-0 w-4 h-4 bg-emerald-500 rounded-full border-2 border-white shadow-sm flex items-center justify-center pointer-events-none z-10">
            <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping opacity-75" />
          </span>
        )}
      </div>
    </div>
  );
}
