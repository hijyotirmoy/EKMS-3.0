"use client";

import React, { useState, useMemo } from "react";
import {
  LifeBuoy,
  Users,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Search,
  Building2,
  Stethoscope,
  Lock,
  BookOpen,
  PhoneCall,
  Sparkles,
} from "lucide-react";

export default function ContactPage() {
  React.useEffect(() => {
    document.title = "Contact Us";
  }, []);

  const [searchQuery, setSearchQuery] = useState("");
  const [openFaq, setOpenFaq] = useState<number | null>(0); // First FAQ opened by default

  const toggleFaq = (idx: number) => {
    setOpenFaq(openFaq === idx ? null : idx);
  };

  // Frequently Asked Questions tailored specifically for EKMS & Dispensary Operations
  const faqs = [
    {
      category: "Dispensary OPD",
      icon: Building2,
      q: "How does the on-premise dispensary OPD workflow (Reception, Doctor, Pharmacy) work?",
      a: "Arriving patients check in at the Reception Desk via their Token Number or Insured Person (IP) number. Once checked in, patients appear in the Doctor Desk consultation queue. After consultation and clinical diagnosis, electronic prescriptions move automatically to the Pharmacy Desk for drug dispensation.",
    },
    {
      category: "Doctor Availability",
      icon: Stethoscope,
      q: "How do doctors mark their availability or schedule upcoming leaves?",
      a: "Doctors can open the Doctor Availability modal from their Desk or navigation menu. They can view the next 14 calendar days, click on any date card to toggle 'Available' or 'On Leave', and click 'Done' to register changes across EKMS and the Triage scheduling system.",
    },
    {
      category: "Appointments & Triage",
      icon: PhoneCall,
      q: "What happens if all doctors at a dispensary are on leave on a target date?",
      a: "If all registered doctors for a dispensary are marked on leave on a specific date, the booking system automatically disables appointments for that date in EKMS Triage to prevent beneficiary inconvenience.",
    },
    {
      category: "Knowledge Base",
      icon: BookOpen,
      q: "How do I search and access clinical guidelines in the EKMS Knowledge Base?",
      a: "Use the top global search bar or navigate to Knowledge / Guidance to search clinical SOPs, ESIC policy circulars, benefit schemes, and diagnostic protocols by keywords, tags, or QA reference codes.",
    },
    {
      category: "Training & Quizzes",
      icon: Sparkles,
      q: "How do staff and agents complete mandatory training courses and quizzes?",
      a: "Access interactive learning modules under Explore > Courses & Quizzes. You can study standard operating procedures, take topic assessments, and view your verified scores and certifications on your Profile.",
    },
    {
      category: "Privacy & Security",
      icon: Lock,
      q: "How is beneficiary healthcare data protected within EKMS?",
      a: "All personal identifiers, consultation notes, and IP numbers are protected with AES-256 encryption at rest and TLS 1.3 in transit, in strict compliance with DISHA, ESIC, and national digital healthcare privacy standards.",
    },
    {
      category: "Technical Support",
      icon: LifeBuoy,
      q: "What should I do if I experience system lag, telephony sync issues, or account access problems?",
      a: "Please reach out directly to the IT Support desk listed above via email or direct phone. Official IT Support is available Monday through Friday from 10:00 AM to 05:00 PM.",
    },
  ];

  const filteredFaqs = useMemo(() => {
    if (!searchQuery.trim()) return faqs;
    const q = searchQuery.toLowerCase().trim();
    return faqs.filter(
      (f) =>
        f.q.toLowerCase().includes(q) ||
        f.a.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q)
    );
  }, [searchQuery, faqs]);

  return (
    <div className="w-full space-y-6 pb-12 animate-in fade-in duration-200">
      {/* Simple Clean Header */}
      <div className="border-b border-slate-200/80 pb-3">
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Contact Us</h1>
      </div>

      {/* Two Contact Boxes Only: IT Support & Management */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Box 1: IT Support */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center border border-teal-100 shrink-0">
              <LifeBuoy className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm sm:text-base">IT Support</h3>
              <p className="text-[11px] text-slate-400">Technical assistance & system bugs</p>
            </div>
          </div>
          <div className="space-y-2 pt-2 border-t border-slate-100 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Email:</span>
              <a
                href="mailto:jyotimoy.choudhary@piramalswasthya.org"
                className="font-semibold text-blue-600 hover:underline"
              >
                jyotimoy.choudhary@piramalswasthya.org
              </a>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Phone:</span>
              <a
                href="tel:6002283107"
                className="font-semibold text-slate-800 font-mono hover:text-blue-600"
              >
                6002283107
              </a>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Available Hours (Mon - Fri):</span>
              <span className="text-slate-700 font-medium">10:00 AM to 05:00 PM</span>
            </div>
          </div>
        </div>

        {/* Box 2: Management */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center border border-blue-100 shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm sm:text-base">Management</h3>
              <p className="text-[11px] text-slate-400">Operational escalation & administration</p>
            </div>
          </div>
          <div className="space-y-2 pt-2 border-t border-slate-100 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Email:</span>
              <a
                href="mailto:ritesh.sinha@piramalswasthya.org"
                className="font-semibold text-blue-600 hover:underline"
              >
                ritesh.sinha@piramalswasthya.org
              </a>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Phone:</span>
              <a
                href="tel:9313573026"
                className="font-semibold text-slate-800 font-mono hover:text-blue-600"
              >
                9313573026
              </a>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Available Hours (Mon - Fri):</span>
              <span className="text-slate-700 font-medium">10:00 AM to 05:00 PM</span>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Full-Width FAQ Section */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-7 shadow-2xs space-y-4">
        {/* Header & Search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5 text-slate-900">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold">Frequently Asked Questions</h2>
            </div>
          </div>

          {/* Search FAQs */}
          <div className="relative w-full sm:w-64 shrink-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search questions..."
              className="w-full pl-9 pr-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 outline-none focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition"
            />
          </div>
        </div>

        {/* FAQs Accordion List */}
        <div className="space-y-3 pt-1">
          {filteredFaqs.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              No matching questions found for &quot;{searchQuery}&quot;. Please try a different search term.
            </div>
          ) : (
            filteredFaqs.map((faq, idx) => {
              const isOpen = openFaq === idx;
              const Icon = faq.icon;
              return (
                <div
                  key={idx}
                  className={`border rounded-xl transition-all ${
                    isOpen
                      ? "border-blue-200 bg-blue-50/20 shadow-2xs"
                      : "border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleFaq(idx)}
                    className="w-full px-4 sm:px-5 py-3.5 text-left flex items-center justify-between gap-3 text-xs sm:text-sm font-bold text-slate-800 transition cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="p-1 rounded-md bg-slate-100 text-slate-600 shrink-0">
                        <Icon className="w-4 h-4" />
                      </span>
                      <span className="leading-snug">{faq.q}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="hidden sm:inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                        {faq.category}
                      </span>
                      {isOpen ? (
                        <ChevronUp className="w-4 h-4 text-blue-600" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-4 sm:px-5 pb-4 pt-1 text-xs text-slate-600 leading-relaxed border-t border-slate-100/80">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
