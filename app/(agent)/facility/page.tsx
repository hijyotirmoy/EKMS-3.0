"use client";

import React, { useState, useEffect, useMemo } from "react";
import { collection } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getOrFetchCollection } from "@/lib/cache";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { Facility } from "@/lib/types";
import { calculateDistance } from "@/lib/utils";
import { logUserActivity } from "@/lib/activityLogger";
import { getCachedFacilities } from "@/lib/clientCache";
import { isFacilityAccepting, getFacilityAvailabilityMap } from "@/lib/facilityAvailability";
import {
  Building2,
  Search,
  MapPin,
  Compass,
  RotateCcw,
  Flag,
  Navigation,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MapPinned,
} from "lucide-react";
import ReportIssueModal from "@/components/common/ReportIssueModal";

export default function FacilityPage() {
  const { user } = useAuth();
  const { toast } = usePopup();
  const [facilities, setFacilities] = useState<Facility[]>(() => (getCachedFacilities() as Facility[]) || []);
  const [availabilityMap, setAvailabilityMap] = useState<Record<string, boolean>>(() => getFacilityAvailabilityMap());
  const [loading, setLoading] = useState(false);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedType, setSelectedType] = useState("all");
  const [selectedDistrict, setSelectedDistrict] = useState("all");
  const [selectedBlock, setSelectedBlock] = useState("all");

  // Geolocation
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<string | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Report Modal
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string }>({ id: "", name: "" });

  // 1. Fetch Facilities with session caching & offline fallback
  useEffect(() => {
    fetch("/api/facilities/availability")
      .then((res) => res.json())
      .then((data) => {
        if (data?.availability) {
          setAvailabilityMap(data.availability);
        }
      })
      .catch(() => {});

    const handleAvailChange = (e: any) => {
      if (e.detail) setAvailabilityMap(e.detail);
    };
    window.addEventListener("facility_availability_change", handleAvailChange);

    let isMounted = true;

    const loadFacilities = async () => {
      try {
        const cached = (getCachedFacilities() as Facility[]) || [];
        const fetched = await getOrFetchCollection<Facility>("facilities");
        const mergedMap = new Map<string, Facility>();
        cached.forEach((f) => {
          const key = (f.id || f.name || "").toLowerCase().trim();
          mergedMap.set(key, f);
        });
        (fetched || []).forEach((f) => {
          const key = (f.id || f.name || "").toLowerCase().trim();
          mergedMap.set(key, { ...(mergedMap.get(key) || {}), ...f });
        });
        const list = Array.from(mergedMap.values());

        if (isMounted) {
          // Sort chronologically ascending to establish facility numbers, then newest first
          list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
          list.forEach((f, idx) => {
            f.facNumber = idx + 1;
          });

          list.sort((a, b) => (b.facNumber || 0) - (a.facNumber || 0));
          setFacilities(list);
          setLoading(false);
        }
      } catch (err) {
        console.error("Facilities load error:", err);
        if (isMounted) setLoading(false);
      }
    };

    loadFacilities();

    return () => {
      isMounted = false;
      window.removeEventListener("facility_availability_change", handleAvailChange);
    };
  }, []);

  // 2. Cascading Filter Dropdown Options
  const { categories, types, districts, blocks } = useMemo(() => {
    const catSet = new Set<string>();
    const typeSet = new Set<string>();
    const distSet = new Set<string>();
    const blockSet = new Set<string>();

    facilities.forEach((f) => {
      const fCat = f.category?.trim() || "";
      const fType = f.type?.trim() || "";
      const fDist = f.district?.trim() || "";
      const fBlock = f.block?.trim() || "";

      const matchCat = selectedCategory === "all" || fCat === selectedCategory;
      const matchType = selectedType === "all" || fType === selectedType;
      const matchDist = selectedDistrict === "all" || fDist === selectedDistrict;
      const matchBlock = selectedBlock === "all" || fBlock === selectedBlock;

      if (matchType && matchDist && matchBlock && fCat) catSet.add(fCat);
      if (matchCat && matchDist && matchBlock && fType) typeSet.add(fType);
      if (matchCat && matchType && matchBlock && fDist) distSet.add(fDist);
      if (matchCat && matchType && matchDist && fBlock) blockSet.add(fBlock);
    });

    return {
      categories: Array.from(catSet).sort(),
      types: Array.from(typeSet).sort(),
      districts: Array.from(distSet).sort(),
      blocks: Array.from(blockSet).sort(),
    };
  }, [facilities, selectedCategory, selectedType, selectedDistrict, selectedBlock]);

  // 3. Geolocation Handler
  const handleFindNearest = () => {
    if (!navigator.geolocation) {
      toast.warning("Geolocation is not supported by your browser.");
      return;
    }

    setGeoStatus("Locating nearest facilities...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoStatus("Sorted by nearest distance from current location.");
      },
      (err) => {
        console.error(err);
        setGeoStatus("Could not retrieve GPS location. Showing standard view.");
      }
    );
  };

  // 4. Filter and Search Execution
  const filteredFacilities = useMemo(() => {
    let list = facilities;

    // Dropdown filters
    if (selectedCategory !== "all") {
      list = list.filter((f) => f.category?.trim() === selectedCategory);
    }
    if (selectedType !== "all") {
      list = list.filter((f) => f.type?.trim() === selectedType);
    }
    if (selectedDistrict !== "all") {
      list = list.filter((f) => f.district?.trim() === selectedDistrict);
    }
    if (selectedBlock !== "all") {
      list = list.filter((f) => f.block?.trim() === selectedBlock);
    }

    // Text Search
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      list = list.filter(
        (f) =>
          f.name?.toLowerCase().includes(q) ||
          f.district?.toLowerCase().includes(q) ||
          f.state?.toLowerCase().includes(q) ||
          f.address?.toLowerCase().includes(q) ||
          f.pincode?.includes(q)
      );
    }

    // If user coords available, calculate distance & sort by nearest
    if (userCoords) {
      list = list.map((f) => {
        if (f.lat && f.lng) {
          return {
            ...f,
            calculatedDistance: calculateDistance(
              userCoords.lat,
              userCoords.lng,
              Number(f.lat),
              Number(f.lng)
            ),
          };
        }
        return { ...f, calculatedDistance: 99999 };
      });

      list.sort((a, b) => (a.calculatedDistance || 99999) - (b.calculatedDistance || 99999));
    }

    return list;
  }, [facilities, selectedCategory, selectedType, selectedDistrict, selectedBlock, searchTerm, userCoords]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredFacilities.length / itemsPerPage));
  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredFacilities.slice(start, start + itemsPerPage);
  }, [filteredFacilities, currentPage]);

  const handleResetFilters = () => {
    setSelectedCategory("all");
    setSelectedType("all");
    setSelectedDistrict("all");
    setSelectedBlock("all");
    setSearchTerm("");
    setUserCoords(null);
    setGeoStatus(null);
    setCurrentPage(1);
  };

  const getCategoryBadgeClass = (category?: string) => {
    const c = category?.toLowerCase() || "";
    if (c.includes("esic") || c.includes("esi")) return "bg-blue-50 text-blue-700 border-blue-200";
    if (c.includes("nhm")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
    return "bg-slate-100 text-slate-700 border-slate-200";
  };

  const getTypeBadgeClass = (type?: string) => {
    const t = type?.toLowerCase() || "";
    if (t.includes("branch")) return "bg-purple-50 text-purple-700 border-purple-200";
    if (t.includes("dispensary")) return "bg-teal-50 text-teal-700 border-teal-200";
    if (t.includes("tie-up") || t.includes("tie up")) return "bg-indigo-50 text-indigo-700 border-indigo-200";
    if (t.includes("hospital")) return "bg-rose-50 text-rose-700 border-rose-200";
    return "bg-slate-50 text-slate-700 border-slate-200";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Health Facilities Directory</h1>
        </div>

        {/* Action button & Live Search */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleFindNearest}
            className="flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl shadow-xs transition-colors"
          >
            <Compass className="w-4 h-4 text-blue-600" />
            <span className="hidden sm:inline">Nearest to Me</span>
          </button>

          <a
            href="https://map.ekms.in/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-sm transition-colors"
          >
            <MapPinned className="w-4 h-4" />
            <span>EKMS Map</span>
            <ExternalLink className="w-3 h-3 opacity-80" />
          </a>
        </div>
      </div>

      {geoStatus && (
        <div className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-xl flex items-center gap-2">
          <Navigation className="w-4 h-4 text-emerald-600" />
          <span>{geoStatus}</span>
        </div>
      )}

      {/* Cascading Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-4">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Search by facility name, district, address, or pincode..."
            className="w-full pl-10 pr-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              ×
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 items-end">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Category
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-[38px] px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none"
            >
              <option value="all">ALL CATEGORIES</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Facility Type
            </label>
            <select
              value={selectedType}
              onChange={(e) => {
                setSelectedType(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-[38px] px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none"
            >
              <option value="all">ALL TYPES</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              District
            </label>
            <select
              value={selectedDistrict}
              onChange={(e) => {
                setSelectedDistrict(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-[38px] px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none"
            >
              <option value="all">ALL DISTRICTS</option>
              {districts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
              Block
            </label>
            <select
              value={selectedBlock}
              onChange={(e) => {
                setSelectedBlock(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-[38px] px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none"
            >
              <option value="all">ALL BLOCKS</option>
              {blocks.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-2 sm:col-span-4 lg:col-span-1">
            <button
              onClick={handleResetFilters}
              className="w-full h-[38px] px-3 border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 shadow-2xs transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>
        </div>
      </div>

      {/* Facilities 3-Column Responsive Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full text-center py-16 text-slate-400">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">Loading health facilities...</p>
          </div>
        ) : filteredFacilities.length === 0 ? (
          <div className="col-span-full bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-xs">
            <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-800 mb-1">No Facilities Found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
              Try adjusting your district, block, or type filters.
            </p>
            <button
              onClick={handleResetFilters}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          paginatedList.map((fac) => {
            const distanceText =
              fac.calculatedDistance && fac.calculatedDistance < 9999
                ? `${fac.calculatedDistance} km away`
                : null;

            return (
              <div
                key={fac.id}
                className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs hover:shadow-md transition-all flex flex-col justify-between space-y-3 relative group"
              >
                {/* Top Badges & Map Link */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider ${getCategoryBadgeClass(
                        fac.category
                      )}`}
                    >
                      {fac.category || "Facility"}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider ${getTypeBadgeClass(
                        fac.type
                      )}`}
                    >
                      {fac.type || "General"}
                    </span>
                    {isFacilityAccepting(fac, availabilityMap) ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold border border-emerald-200 bg-emerald-50 text-emerald-700 uppercase tracking-wider">
                        Accepting
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold border border-rose-200 bg-rose-50 text-rose-700 uppercase tracking-wider">
                        Suspended / Offline
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {fac.mapLink && (
                      <a
                        href={fac.mapLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => {
                          logUserActivity(user?.email, {
                            desc: `Opened Google Maps directions for: "${fac.name}" (${fac.district || "Assam"})`,
                            type: "facility",
                          });
                        }}
                        className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors text-xs font-semibold flex items-center gap-1"
                        title="View on Google Maps"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        <span className="text-[10px]">Map</span>
                      </a>
                    )}
                    <button
                      onClick={() => {
                        setReportTarget({ id: fac.id, name: fac.name });
                        setReportModalOpen(true);
                      }}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                      title="Report issue with facility"
                    >
                      <Flag className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Name & Address */}
                <div className="space-y-1.5 flex-1">
                  <h3 className="text-sm font-bold text-slate-900 leading-snug">{fac.name}</h3>
                  <p className="text-xs text-slate-500 leading-relaxed flex items-start gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-rose-500 flex-shrink-0 mt-0.5" />
                    <span className="line-clamp-2">{fac.address}</span>
                  </p>
                </div>

                {/* Footer Metadata */}
                <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                  <div className="flex items-center gap-2 flex-wrap">
                    {fac.district && <span>{fac.district}</span>}
                    {fac.block && (
                      <>
                        <span>•</span>
                        <span>{fac.block}</span>
                      </>
                    )}
                    {fac.pincode && (
                      <>
                        <span>•</span>
                        <span>{fac.pincode}</span>
                      </>
                    )}
                    {distanceText && (
                      <span className="text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.2 rounded">
                        {distanceText}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                    #{fac.facNumber}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-4 pb-12 select-none">
          <button
            onClick={() => {
              setCurrentPage((p) => Math.max(1, p - 1));
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            disabled={currentPage === 1}
            className="flex items-center gap-1 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 text-xs font-semibold text-slate-700 rounded-full shadow-xs transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-blue-600" />
            <span>Previous</span>
          </button>

          <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-full">
            Page {currentPage} of {totalPages}
          </span>

          <button
            onClick={() => {
              setCurrentPage((p) => Math.min(totalPages, p + 1));
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            disabled={currentPage === totalPages}
            className="flex items-center gap-1 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 text-xs font-semibold text-slate-700 rounded-full shadow-xs transition-colors"
          >
            <span>Next</span>
            <ChevronRight className="w-4 h-4 text-blue-600" />
          </button>
        </div>
      )}

      {/* Report Modal */}
      <ReportIssueModal
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        targetId={reportTarget.id}
        reportType="Facility"
        targetCodeOrName={reportTarget.name}
      />
    </div>
  );
}
