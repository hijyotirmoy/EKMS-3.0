"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { touchMetadata } from "@/lib/cache";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { Facility } from "@/lib/types";
import { logUserActivity } from "@/lib/activityLogger";
import * as XLSX from "xlsx";
import {
  Building2,
  Plus,
  FileSpreadsheet,
  Download,
  Upload,
  Search,
  Trash2,
  Edit2,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  X,
  MapPin,
  Compass,
} from "lucide-react";

export default function AdminFacilitiesPage() {
  const { user } = useAuth();
  const { toast, showConfirm } = usePopup();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Bulk Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Add / Edit Modal Form State
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [facName, setFacName] = useState("");
  const [facCategory, setFacCategory] = useState("ESIC");
  const [facType, setFacType] = useState("ESIS Dispensary");
  const [facTypeCustom, setFacTypeCustom] = useState("");
  const [facBlock, setFacBlock] = useState("");
  const [facBlockCustom, setFacBlockCustom] = useState("");
  const [facAddress, setFacAddress] = useState("");
  const [facPincode, setFacPincode] = useState("");
  const [facDistrict, setFacDistrict] = useState("Kamrup Metropolitan");
  const [facDistrictCustom, setFacDistrictCustom] = useState("");
  const [facState, setFacState] = useState("Assam");
  const [facStateCustom, setFacStateCustom] = useState("");
  const [facLatitude, setFacLatitude] = useState("");
  const [facLongitude, setFacLongitude] = useState("");
  const [facMapLink, setFacMapLink] = useState("");
  const [modalSaving, setModalSaving] = useState(false);

  // 1. Live Facilities Listener
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "facilities"),
      (snapshot) => {
        const list: Facility[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...(d.data() as Omit<Facility, "id">) });
        });
        list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setFacilities(list);
        setLoading(false);
      },
      (err) => console.error("Facilities sync error:", err)
    );

    return () => unsubscribe();
  }, []);

  // 2. Metrics
  const metrics = useMemo(() => {
    const total = facilities.length;
    const esic = facilities.filter((f) => f.category?.toLowerCase().includes("esic")).length;
    const nhm = facilities.filter((f) => f.category?.toLowerCase().includes("nhm")).length;

    const esicDisp = facilities.filter((f) => f.type?.toLowerCase() === "esis dispensary").length;
    const esicHosp = facilities.filter((f) => f.type?.toLowerCase() === "esic hospital").length;
    const esicTieup = facilities.filter((f) => f.type?.toLowerCase().includes("tie-up")).length;
    const esicBranch = facilities.filter((f) => f.type?.toLowerCase().includes("branch")).length;

    const nhmPhc = facilities.filter((f) => f.type?.toLowerCase() === "nhm phc").length;
    const nhmChc = facilities.filter((f) => f.type?.toLowerCase() === "nhm chc").length;
    const nhmSdh = facilities.filter((f) => f.type?.toLowerCase() === "nhm sdh").length;
    const nhmDh = facilities.filter((f) => f.type?.toLowerCase() === "nhm dh").length;

    return { total, esic, nhm, esicDisp, esicHosp, esicTieup, esicBranch, nhmPhc, nhmChc, nhmSdh, nhmDh };
  }, [facilities]);

  // Distinct Types for filter & dropdown
  const distinctTypes = useMemo(() => {
    const defaultTypes = [
      "ESIS Dispensary",
      "ESIC Hospital",
      "ESIC Tie-up Hospital",
      "Branch Office",
      "NHM PHC",
      "NHM CHC",
      "NHM SDH",
      "NHM DH",
    ];
    const set = new Set<string>(defaultTypes);
    facilities.forEach((f) => {
      if (f.type) set.add(f.type.trim());
    });
    return Array.from(set).sort();
  }, [facilities]);

  // Distinct Blocks
  const distinctBlocks = useMemo(() => {
    const set = new Set<string>();
    facilities.forEach((f) => {
      if (f.block) set.add(f.block.trim());
    });
    return Array.from(set).sort();
  }, [facilities]);

  // Distinct Districts
  const distinctDistricts = useMemo(() => {
    const defaultDistricts = [
      "Kamrup Metropolitan",
      "Kamrup Rural",
      "Dibrugarh",
      "Jorhat",
      "Nagaon",
      "Cachar",
      "Sonitpur",
      "Barpeta",
      "Dhubri",
      "Goalpara",
      "Tinsukia",
      "Sivasagar",
      "Golaghat",
      "Lakhimpur",
      "Darrang",
      "Bongaigaon",
      "Hailakandi",
      "Karimganj",
      "Morigaon",
      "Nalbari",
      "Kokrajhar",
      "Baksa",
      "Udalguri",
      "Chirang",
      "Dima Hasao",
      "Karbi Anglong",
      "West Karbi Anglong",
      "Biswanath",
      "Charaideo",
      "Hojai",
      "Majuli",
      "South Salmara-Mankachar",
      "Bajali",
      "Tamulpur",
    ];
    const set = new Set<string>(defaultDistricts);
    facilities.forEach((f) => {
      if (f.district?.trim()) set.add(f.district.trim());
    });
    return Array.from(set).sort();
  }, [facilities]);

  // Distinct States
  const distinctStates = useMemo(() => {
    const defaultStates = [
      "Assam",
      "Meghalaya",
      "Tripura",
      "Arunachal Pradesh",
      "Nagaland",
      "Manipur",
      "Mizoram",
      "Sikkim",
      "West Bengal",
      "Bihar",
      "Delhi",
      "Maharashtra",
      "Karnataka",
      "Tamil Nadu",
      "Uttar Pradesh",
      "Rajasthan",
      "Gujarat",
      "Odisha",
    ];
    const set = new Set<string>(defaultStates);
    facilities.forEach((f) => {
      if (f.state?.trim()) set.add(f.state.trim());
    });
    return Array.from(set).sort();
  }, [facilities]);

  // Filtered List
  const filteredFacilities = useMemo(() => {
    let list = facilities;

    if (typeFilter !== "all") {
      list = list.filter((f) => f.type?.trim() === typeFilter);
    }

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      list = list.filter(
        (f) =>
          f.name?.toLowerCase().includes(q) ||
          f.district?.toLowerCase().includes(q) ||
          f.address?.toLowerCase().includes(q) ||
          f.pincode?.includes(q)
      );
    }

    return list;
  }, [facilities, typeFilter, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredFacilities.length / itemsPerPage));
  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredFacilities.slice(start, start + itemsPerPage);
  }, [filteredFacilities, currentPage]);

  // Open Modal Helper
  const handleOpenModal = (fac?: Facility) => {
    if (fac) {
      setEditId(fac.id);
      setFacName(fac.name || "");
      setFacCategory(fac.category || "ESIC");
      setFacAddress(fac.address || "");
      setFacPincode(fac.pincode || "");
      setFacMapLink(fac.mapLink || "");
      setFacLatitude(fac.latitude !== undefined && fac.latitude !== null ? String(fac.latitude) : "");
      setFacLongitude(fac.longitude !== undefined && fac.longitude !== null ? String(fac.longitude) : "");

      // Type
      if (distinctTypes.includes(fac.type || "")) {
        setFacType(fac.type || "ESIS Dispensary");
        setFacTypeCustom("");
      } else if (fac.type) {
        setFacType("_custom_");
        setFacTypeCustom(fac.type);
      } else {
        setFacType("ESIS Dispensary");
        setFacTypeCustom("");
      }

      // Block
      if (distinctBlocks.includes(fac.block || "")) {
        setFacBlock(fac.block || "");
        setFacBlockCustom("");
      } else if (fac.block) {
        setFacBlock("_custom_");
        setFacBlockCustom(fac.block);
      } else {
        setFacBlock("");
        setFacBlockCustom("");
      }

      // District
      if (distinctDistricts.includes(fac.district || "")) {
        setFacDistrict(fac.district || "Kamrup Metropolitan");
        setFacDistrictCustom("");
      } else if (fac.district) {
        setFacDistrict("_custom_");
        setFacDistrictCustom(fac.district);
      } else {
        setFacDistrict("Kamrup Metropolitan");
        setFacDistrictCustom("");
      }

      // State
      if (distinctStates.includes(fac.state || "")) {
        setFacState(fac.state || "Assam");
        setFacStateCustom("");
      } else if (fac.state) {
        setFacState("_custom_");
        setFacStateCustom(fac.state);
      } else {
        setFacState("Assam");
        setFacStateCustom("");
      }
    } else {
      setEditId(null);
      setFacName("");
      setFacCategory("ESIC");
      setFacType("ESIS Dispensary");
      setFacTypeCustom("");
      setFacBlock("");
      setFacBlockCustom("");
      setFacAddress("");
      setFacPincode("");
      setFacDistrict("Kamrup Metropolitan");
      setFacDistrictCustom("");
      setFacState("Assam");
      setFacStateCustom("");
      setFacLatitude("");
      setFacLongitude("");
      setFacMapLink("");
    }
    setModalOpen(true);
  };

  // Save Modal
  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalDistrict = facDistrict === "_custom_" ? facDistrictCustom.trim() : facDistrict;
    const finalState = facState === "_custom_" ? facStateCustom.trim() : facState;

    if (!facName.trim() || !facAddress.trim() || !finalDistrict) {
      toast.warning("Facility Name, Full Address, and District are required.");
      return;
    }

    setModalSaving(true);
    const finalType = facType === "_custom_" ? facTypeCustom.trim() : facType;
    const finalBlock = facBlock === "_custom_" ? facBlockCustom.trim() : facBlock;

    const latVal = facLatitude.trim() ? (isNaN(Number(facLatitude.trim())) ? facLatitude.trim() : Number(facLatitude.trim())) : null;
    const lngVal = facLongitude.trim() ? (isNaN(Number(facLongitude.trim())) ? facLongitude.trim() : Number(facLongitude.trim())) : null;

    const payload = {
      name: facName.trim(),
      category: facCategory,
      type: finalType || "ESIS Dispensary",
      block: finalBlock || "",
      address: facAddress.trim(),
      pincode: facPincode.trim(),
      district: finalDistrict || "Kamrup Metropolitan",
      state: finalState || "Assam",
      latitude: latVal,
      longitude: lngVal,
      mapLink: facMapLink.trim(),
      updatedAt: Date.now(),
    };

    try {
      if (editId) {
        await setDoc(doc(db, "facilities", editId), payload, { merge: true });
        logUserActivity(user?.email, {
          desc: `Updated health facility: "${facName.trim()}" (${finalType})`,
          type: "edit",
        });
        toast.success("Facility updated successfully!");
      } else {
        await setDoc(doc(collection(db, "facilities")), { ...payload, createdAt: Date.now() });
        logUserActivity(user?.email, {
          desc: `Added new health facility: "${facName.trim()}" (${finalType})`,
          type: "add",
        });
        toast.success("New facility added successfully!");
      }
      await touchMetadata("facilities");
      setModalOpen(false);
    } catch (err: any) {
      toast.error("Failed to save facility: " + err.message);
    } finally {
      setModalSaving(false);
    }
  };

  // Single Delete
  const handleDeleteSingle = async (id: string) => {
    const target = facilities.find((f) => f.id === id);
    const confirmed = await showConfirm({
      title: "Delete Health Facility?",
      message: "Are you sure you want to permanently delete this facility record?",
      isDestructive: true,
      confirmText: "Delete Facility",
    });
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "facilities", id));
      await touchMetadata("facilities");
      logUserActivity(user?.email, {
        desc: `Deleted health facility: "${target?.name || "Facility"}"`,
        type: "delete",
      });
      toast.success("Facility deleted successfully.");
    } catch (e: any) {
      toast.error("Delete failed: " + e.message);
    }
  };

  // Bulk Delete
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = await showConfirm({
      title: "Delete Selected Facilities?",
      message: `Are you sure you want to delete ${selectedIds.size} selected health facilities?`,
      isDestructive: true,
      confirmText: "Delete Facilities",
    });
    if (!confirmed) return;

    setBulkDeleting(true);
    try {
      const batch = writeBatch(db);
      selectedIds.forEach((id) => {
        batch.delete(doc(db, "facilities", id));
      });
      await batch.commit();
      await touchMetadata("facilities");
      setSelectedIds(new Set());
      toast.success(`${selectedIds.size} facilities deleted successfully.`);
    } catch (e: any) {
      toast.error("Bulk delete failed: " + e.message);
    } finally {
      setBulkDeleting(false);
    }
  };

  // Export Excel
  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(
      facilities.map((f) => ({
        "Facility Name": f.name || "",
        Category: f.category || "",
        "Facility Type": f.type || "",
        Block: f.block || "",
        "Full Address": f.address || "",
        Pincode: f.pincode || "",
        District: f.district || "",
        State: f.state || "",
        Latitude: f.latitude !== undefined && f.latitude !== null ? f.latitude : "",
        Longitude: f.longitude !== undefined && f.longitude !== null ? f.longitude : "",
        "Maps Link": f.mapLink || "",
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Facilities");
    XLSX.writeFile(wb, `ESIC_Facilities_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  // Download Sample Template
  const handleDownloadTemplate = () => {
    const headers = [
      [
        "Facility Name",
        "Category",
        "Facility Type",
        "Block",
        "Full Address",
        "Pincode",
        "District",
        "State",
        "Latitude (Optional)",
        "Longitude (Optional)",
        "Google Maps Link",
      ],
    ];
    const sample = [
      [
        "Dispur ESIS Dispensary",
        "ESIC",
        "ESIS Dispensary",
        "Guwahati",
        "Ganeshguri, Dispur",
        "781005",
        "Kamrup Metropolitan",
        "Assam",
        26.1445,
        91.7362,
        "https://maps.google.com/...",
      ],
      [
        "ESIC Model Hospital Beltola",
        "ESIC",
        "ESIC Hospital",
        "Guwahati",
        "Beltola, Guwahati",
        "781022",
        "Kamrup Metropolitan",
        "Assam",
        26.1287,
        91.7891,
        "",
      ],
      [
        "Sonapur CHC",
        "NHM",
        "NHM CHC",
        "Sonapur",
        "Sonapur Main Road",
        "782402",
        "Kamrup Metropolitan",
        "Assam",
        "",
        "",
        "",
      ],
    ];
    const ws = XLSX.utils.aoa_to_sheet([...headers, ...sample]);
    ws["!cols"] = [
      { wch: 30 },
      { wch: 12 },
      { wch: 22 },
      { wch: 18 },
      { wch: 35 },
      { wch: 12 },
      { wch: 22 },
      { wch: 15 },
      { wch: 18 },
      { wch: 18 },
      { wch: 30 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "ESIC_Facility_Upload_Template.xlsx");
  };

  // Handle Bulk Excel Upload
  const handleBulkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        if (rows.length === 0) {
          toast.warning("The uploaded spreadsheet is empty.");
          return;
        }

        const batch = writeBatch(db);
        let count = 0;

        rows.forEach((row) => {
          const name = row["Facility Name"] || row["Name"] || "";
          const address = row["Full Address"] || row["Address"] || "";
          const district = row["District"] || "";

          if (!name || !address || !district) return;

          const latRaw = row["Latitude (Optional)"] || row["Latitude"] || row["Lat"] || "";
          const lngRaw = row["Longitude (Optional)"] || row["Longitude"] || row["Lng"] || row["Long"] || "";

          const latVal = latRaw !== "" ? (isNaN(Number(latRaw)) ? latRaw : Number(latRaw)) : null;
          const lngVal = lngRaw !== "" ? (isNaN(Number(lngRaw)) ? lngRaw : Number(lngRaw)) : null;

          const docRef = doc(collection(db, "facilities"));
          batch.set(docRef, {
            name: String(name).trim(),
            category: String(row["Category"] || "ESIC").trim(),
            type: String(row["Facility Type"] || "Branch Office").trim(),
            block: String(row["Block"] || "").trim(),
            address: String(address).trim(),
            pincode: String(row["Pincode"] || "").trim(),
            district: String(district).trim(),
            state: String(row["State"] || "Assam").trim(),
            latitude: latVal,
            longitude: lngVal,
            mapLink: String(row["Google Maps Link"] || row["Maps Link"] || "").trim(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          count++;
        });

        if (count > 0) {
          await batch.commit();
          await touchMetadata("facilities");
          toast.success(`Successfully uploaded ${count} health facilities!`);
        }
      } catch (err: any) {
        toast.error("Upload error: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Manage Health Facilities</h1>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="file"
            id="bulkFacInput"
            accept=".xlsx, .xls, .csv"
            className="hidden"
            onChange={handleBulkUpload}
          />

          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold shadow-xs"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Export (.xlsx)</span>
          </button>

          <button
            onClick={handleDownloadTemplate}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-blue-600 rounded-xl text-xs font-semibold shadow-xs"
          >
            <Download className="w-4 h-4" />
            <span>Template</span>
          </button>

          <button
            onClick={() => document.getElementById("bulkFacInput")?.click()}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-800 rounded-xl text-xs font-semibold shadow-xs"
          >
            <Upload className="w-4 h-4" />
            <span>Bulk Upload</span>
          </button>

          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Add Facility</span>
          </button>
        </div>
      </div>

      {/* 11 KPI Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 text-center">
        <div className="bg-white border border-slate-200 p-3.5 rounded-xl">
          <div className="text-xl font-black text-slate-900">{metrics.total}</div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Total</div>
        </div>
        <div className="bg-blue-50 border border-blue-200 p-3.5 rounded-xl">
          <div className="text-xl font-black text-blue-700">{metrics.esic}</div>
          <div className="text-[10px] font-bold text-blue-600 uppercase tracking-wider mt-1">ESIC Total</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 p-3.5 rounded-xl">
          <div className="text-xl font-black text-emerald-700">{metrics.nhm}</div>
          <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mt-1">NHM Total</div>
        </div>
        <div className="bg-white border border-slate-200 p-3.5 rounded-xl">
          <div className="text-xl font-black text-slate-800">{metrics.esicDisp}</div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Dispensaries</div>
        </div>
        <div className="bg-white border border-slate-200 p-3.5 rounded-xl">
          <div className="text-xl font-black text-slate-800">{metrics.esicHosp}</div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">ESIC Hosp</div>
        </div>
        <div className="bg-white border border-slate-200 p-3.5 rounded-xl">
          <div className="text-xl font-black text-slate-800">{metrics.nhmPhc + metrics.nhmChc}</div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">PHC / CHC</div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search facility by name, district, address, pin..."
              className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full sm:w-auto px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-semibold text-slate-700"
            >
              <option value="all">All Facility Types</option>
              {distinctTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Selected count bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center justify-between bg-rose-50 border border-rose-200 px-4 py-2.5 rounded-xl text-xs">
            <span className="font-bold text-rose-800">{selectedIds.size} facilities selected</span>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold flex items-center gap-1 shadow-xs"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{bulkDeleting ? "Deleting..." : "Delete Selected"}</span>
            </button>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto rounded-2xl border border-slate-100">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                <th className="p-4 text-center">
                  <input
                    type="checkbox"
                    checked={
                      filteredFacilities.length > 0 &&
                      filteredFacilities.every((f) => selectedIds.has(f.id))
                    }
                    onChange={(e) => {
                      const next = new Set(selectedIds);
                      if (e.target.checked) filteredFacilities.forEach((f) => next.add(f.id));
                      else next.clear();
                      setSelectedIds(next);
                    }}
                    className="cursor-pointer"
                  />
                </th>
                <th className="p-4">Type</th>
                <th className="p-4">Facility Name</th>
                <th className="p-4">District</th>
                <th className="p-4">State</th>
                <th className="p-4 text-center">Coordinates</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400">
                    Loading health facilities...
                  </td>
                </tr>
              ) : paginatedList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400">
                    No facilities found matching your criteria.
                  </td>
                </tr>
              ) : (
                paginatedList.map((fac) => (
                  <tr key={fac.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="p-4 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(fac.id)}
                        onChange={(e) => {
                          const next = new Set(selectedIds);
                          if (e.target.checked) next.add(fac.id);
                          else next.delete(fac.id);
                          setSelectedIds(next);
                        }}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="p-4 whitespace-nowrap">
                      <span
                        className={`px-2.5 py-1 rounded-md text-[10px] font-bold ${
                          fac.category?.toLowerCase() === "nhm"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-blue-50 text-blue-700 border border-blue-200"
                        }`}
                      >
                        {fac.type || "Dispensary"}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="font-bold text-slate-900">{fac.name}</div>
                      <div className="text-[10px] text-slate-400 truncate max-w-xs">{fac.address}</div>
                    </td>
                    <td className="p-4 font-semibold text-slate-800">{fac.district || "—"}</td>
                    <td className="p-4 text-slate-600">{fac.state || "Assam"}</td>
                    <td className="p-4 text-center text-[11px] text-slate-500 font-mono">
                      {fac.latitude && fac.longitude ? (
                        <span className="text-emerald-700 font-bold">
                          {fac.latitude}, {fac.longitude}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="p-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenModal(fac)}
                          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-50 rounded"
                          title="Edit Facility"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteSingle(fac.id)}
                          className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded"
                          title="Delete Facility"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs text-slate-500">
          <div>
            Showing {paginatedList.length} of {filteredFacilities.length} facilities
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1.5 border rounded-lg hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 font-semibold">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 border rounded-lg hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ====================================================
          ADD / EDIT FACILITY MODAL
          ==================================================== */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white max-w-lg w-full rounded-3xl shadow-2xl p-6 border border-slate-100 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-600" />
                <span>{editId ? "Edit Health Facility" : "Add New Facility"}</span>
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveModal} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Facility Name *
                </label>
                <input
                  type="text"
                  value={facName}
                  onChange={(e) => setFacName(e.target.value)}
                  placeholder="e.g. Dispur ESIS Dispensary"
                  required
                  className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Category
                  </label>
                  <select
                    value={facCategory}
                    onChange={(e) => setFacCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-semibold"
                  >
                    <option value="ESIC">ESIC</option>
                    <option value="NHM">NHM</option>
                    <option value="Private Tie-up">Private Tie-up</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Facility Type
                  </label>
                  <select
                    value={facType}
                    onChange={(e) => setFacType(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-semibold"
                  >
                    {distinctTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                    <option value="_custom_" className="font-bold text-blue-600">
                      + Add New Type
                    </option>
                  </select>
                </div>
              </div>

              {facType === "_custom_" && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Custom Type Name
                  </label>
                  <input
                    type="text"
                    value={facTypeCustom}
                    onChange={(e) => setFacTypeCustom(e.target.value)}
                    placeholder="Enter custom type..."
                    required
                    className="w-full px-3.5 py-2 text-xs border border-blue-500 rounded-xl outline-none"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Full Address *
                </label>
                <input
                  type="text"
                  value={facAddress}
                  onChange={(e) => setFacAddress(e.target.value)}
                  placeholder="Street, locality, landmarks..."
                  required
                  className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Block
                  </label>
                  <select
                    value={facBlock}
                    onChange={(e) => setFacBlock(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-semibold"
                  >
                    <option value="">Select Block</option>
                    {distinctBlocks.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                    <option value="_custom_" className="font-bold text-blue-600">
                      + Add New Block
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Pincode
                  </label>
                  <input
                    type="text"
                    value={facPincode}
                    onChange={(e) => setFacPincode(e.target.value)}
                    placeholder="781005"
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 font-bold"
                  />
                </div>
              </div>

              {facBlock === "_custom_" && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Custom Block Name
                  </label>
                  <input
                    type="text"
                    value={facBlockCustom}
                    onChange={(e) => setFacBlockCustom(e.target.value)}
                    placeholder="Enter custom block..."
                    required
                    className="w-full px-3.5 py-2 text-xs border border-blue-500 rounded-xl outline-none"
                  />
                </div>
              )}

              {/* District & State Dropdowns + Custom Add */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    District *
                  </label>
                  <select
                    value={facDistrict}
                    onChange={(e) => setFacDistrict(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-semibold"
                  >
                    {distinctDistricts.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                    <option value="_custom_" className="font-bold text-blue-600">
                      + Add New District
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    State
                  </label>
                  <select
                    value={facState}
                    onChange={(e) => setFacState(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-semibold"
                  >
                    {distinctStates.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                    <option value="_custom_" className="font-bold text-blue-600">
                      + Add New State
                    </option>
                  </select>
                </div>
              </div>

              {facDistrict === "_custom_" && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Custom District Name
                  </label>
                  <input
                    type="text"
                    value={facDistrictCustom}
                    onChange={(e) => setFacDistrictCustom(e.target.value)}
                    placeholder="Enter new district name..."
                    required
                    className="w-full px-3.5 py-2 text-xs border border-blue-500 rounded-xl outline-none"
                  />
                </div>
              )}

              {facState === "_custom_" && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Custom State Name
                  </label>
                  <input
                    type="text"
                    value={facStateCustom}
                    onChange={(e) => setFacStateCustom(e.target.value)}
                    placeholder="Enter new state name..."
                    required
                    className="w-full px-3.5 py-2 text-xs border border-blue-500 rounded-xl outline-none"
                  />
                </div>
              )}

              {/* Latitude & Longitude Side-by-Side */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Latitude (Optional)
                  </label>
                  <input
                    type="text"
                    value={facLatitude}
                    onChange={(e) => setFacLatitude(e.target.value)}
                    placeholder="e.g. 26.1445"
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Longitude (Optional)
                  </label>
                  <input
                    type="text"
                    value={facLongitude}
                    onChange={(e) => setFacLongitude(e.target.value)}
                    placeholder="e.g. 91.7362"
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Google Maps Link (Optional)
                </label>
                <input
                  type="url"
                  value={facMapLink}
                  onChange={(e) => setFacMapLink(e.target.value)}
                  placeholder="https://maps.google.com/..."
                  className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-xs font-semibold rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalSaving}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs"
                >
                  {modalSaving ? "Saving..." : "Save Facility"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
