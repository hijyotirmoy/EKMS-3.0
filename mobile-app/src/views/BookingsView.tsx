import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { collection, onSnapshot, doc, setDoc, arrayUnion } from "firebase/firestore";
import { bookingDb } from "../lib/firebase";
import { BookingRecord } from "../lib/types";
import {
  Calendar,
  Clock,
  Plus,
  User,
  Phone,
  CheckCircle2,
  AlertCircle,
  X,
  Search,
} from "lucide-react";

export default function BookingsView() {
  const { user, userProfile, isAdmin } = useAuth();
  const [bookings, setBookings] = useState<BookingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);

  // New Booking Form State
  const [ipName, setIpName] = useState("");
  const [phone, setPhone] = useState("");
  const [bookingDate, setBookingDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split("T")[0];
  });
  const [submitting, setSubmitting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState("");

  const userEmail = (user?.email || "").toLowerCase().trim();

  useEffect(() => {
    // Listen to all days in bookingDb daily_availability
    const unsub = onSnapshot(
      collection(bookingDb, "daily_availability"),
      (snapshot) => {
        const allList: BookingRecord[] = [];
        snapshot.forEach((docSnap) => {
          const dateKey = docSnap.id;
          const data = docSnap.data();
          if (Array.isArray(data.bookedRecords)) {
            data.bookedRecords.forEach((record: BookingRecord) => {
              allList.push({ ...record, dateKey });
            });
          }
        });

        // Sort by timestamp or date
        allList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        // If not admin, show only user's bookings
        const filtered = isAdmin
          ? allList
          : allList.filter((b) => b.agentEmail?.toLowerCase().trim() === userEmail);

        setBookings(filtered);
        setLoading(false);
      },
      (err) => {
        console.warn("Bookings listener error:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [userEmail, isAdmin]);

  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ipName.trim() || !phone.trim() || !bookingDate) return;

    setSubmitting(true);
    setFeedbackMsg("");

    try {
      const newRecord: BookingRecord = {
        agentEmail: userEmail,
        agentName: userProfile?.displayName || userProfile?.name || "Agent",
        ipName: ipName.trim(),
        phone: phone.trim(),
        timestamp: Date.now(),
        visited: false,
        rescheduled: false,
        originalScheduledDate: bookingDate,
      };

      const dayRef = doc(bookingDb, "daily_availability", bookingDate);
      await setDoc(
        dayRef,
        {
          bookedRecords: arrayUnion(newRecord),
        },
        { merge: true }
      );

      setIpName("");
      setPhone("");
      setFeedbackMsg("Appointment scheduled successfully!");
      setTimeout(() => {
        setIsAddOpen(false);
        setFeedbackMsg("");
      }, 1200);
    } catch (err: any) {
      setFeedbackMsg(`Failed: ${err.message || "Unknown error"}`);
    } finally {
      setSubmitting(false);
    }
  };

  const displayedBookings = bookings.filter((b) => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      b.ipName?.toLowerCase().includes(q) ||
      b.agentEmail?.toLowerCase().includes(q) ||
      b.phone?.includes(q) ||
      b.dateKey?.includes(q)
    );
  });

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* View Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            {isAdmin ? "All Appointments" : "My Appointments"}
          </h2>
          <p className="text-xs text-slate-400">
            {bookings.length} {bookings.length === 1 ? "booking" : "bookings"} in system
          </p>
        </div>

        <button
          onClick={() => setIsAddOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-md shadow-blue-600/30 transition-all active:scale-95"
        >
          <Plus className="w-4 h-4" />
          Book Slot
        </button>
      </div>

      {/* Search Filter */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder="Search by IP name, date, phone..."
          className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-slate-900 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          Loading appointments...
        </div>
      ) : displayedBookings.length === 0 ? (
        <div className="text-center py-16 bg-slate-900/60 rounded-3xl border border-slate-800/60 p-6">
          <Calendar className="w-12 h-12 mx-auto mb-2 text-slate-600" />
          <h4 className="font-semibold text-white text-sm">No Bookings Found</h4>
          <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
            {filterQuery ? "Try clearing the search filter." : "Schedule an IP appointment slot to get started."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayedBookings.map((b, idx) => (
            <div
              key={`${b.timestamp}-${idx}`}
              className="p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm space-y-2.5"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-bold text-white text-sm">{b.ipName}</h4>
                  <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                    <Phone className="w-3.5 h-3.5 text-blue-400" />
                    {b.phone}
                  </p>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                    b.visited
                      ? "bg-emerald-950/60 text-emerald-400 border border-emerald-500/30"
                      : "bg-blue-950/60 text-blue-400 border border-blue-500/30"
                  }`}
                >
                  {b.visited ? "Visited" : "Scheduled"}
                </span>
              </div>

              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  {b.dateKey || b.originalScheduledDate || "Date set"}
                </span>
                {isAdmin && (
                  <span className="flex items-center gap-1 truncate max-w-[130px]">
                    <User className="w-3.5 h-3.5 text-purple-400" />
                    {b.agentName || b.agentEmail}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Add Booking */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl text-white animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-base text-white">Book Appointment</h3>
              <button
                onClick={() => setIsAddOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {feedbackMsg && (
              <div className="p-3 mb-4 rounded-xl text-xs bg-blue-950/60 border border-blue-500/40 text-blue-300">
                {feedbackMsg}
              </div>
            )}

            <form onSubmit={handleCreateBooking} className="space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  IP / Candidate Name
                </label>
                <input
                  type="text"
                  required
                  value={ipName}
                  onChange={(e) => setIpName(e.target.value)}
                  placeholder="e.g. Ramesh Kumar"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Appointment Date
                </label>
                <input
                  type="date"
                  required
                  value={bookingDate}
                  onChange={(e) => setBookingDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm shadow-md transition-all disabled:opacity-50"
                >
                  {submitting ? "Booking..." : "Confirm Booking"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-medium text-sm"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
