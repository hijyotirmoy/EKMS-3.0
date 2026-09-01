"use client";

import React, { useState, useRef, useMemo, useCallback } from "react";
import { usePopup } from "@/context/PopupContext";
import { UserProfile, OrganogramConfig, OrganogramBranch, OrganogramLeader, OrganogramTier } from "@/lib/types";
import {
  Crown,
  Shield,
  Headphones,
  Laptop,
  MapPin,
  Users,
  Zap,
  Sparkles,
  Plus,
  Edit2,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Move,
  GripVertical,
  X,
  UserPlus,
  Layers,
  FolderPlus,
  GitBranch,
  ArrowDown,
} from "lucide-react";

interface OrganogramCanvasProps {
  config: OrganogramConfig;
  users: UserProfile[];
  isAdminMode?: boolean;
  onSaveConfig?: (newConfig: OrganogramConfig) => Promise<void>;
  onEditUser?: (user: UserProfile) => void;
  onAssignUserBranch?: (userEmail: string, branchId: string) => Promise<void>;
  onRemoveUserFromBranch?: (userEmail: string) => Promise<void>;
}

// Icon Mapping
const ICON_MAP: Record<string, React.ElementType> = {
  Laptop,
  Headphones,
  MapPin,
  Users,
  Shield,
  Zap,
  Crown,
  Sparkles,
  Layers,
  GitBranch,
};

// Color Theme Palettes for Branches
const COLOR_THEMES: Record<
  string,
  {
    pillBg: string;
    pillBorder: string;
    pillText: string;
    iconBg: string;
    iconColor: string;
    cardBorderHover: string;
    badgeBg: string;
    badgeText: string;
  }
> = {
  blue: {
    pillBg: "bg-blue-50/95",
    pillBorder: "border-blue-200",
    pillText: "text-blue-900",
    iconBg: "bg-blue-600",
    iconColor: "text-white",
    cardBorderHover: "hover:border-blue-300",
    badgeBg: "bg-blue-100",
    badgeText: "text-blue-700",
  },
  purple: {
    pillBg: "bg-purple-50/95",
    pillBorder: "border-purple-200",
    pillText: "text-purple-900",
    iconBg: "bg-purple-600",
    iconColor: "text-white",
    cardBorderHover: "hover:border-purple-300",
    badgeBg: "bg-purple-100",
    badgeText: "text-purple-700",
  },
  emerald: {
    pillBg: "bg-emerald-50/95",
    pillBorder: "border-emerald-200",
    pillText: "text-emerald-900",
    iconBg: "bg-emerald-600",
    iconColor: "text-white",
    cardBorderHover: "hover:border-emerald-300",
    badgeBg: "bg-emerald-100",
    badgeText: "text-emerald-700",
  },
  amber: {
    pillBg: "bg-amber-50/95",
    pillBorder: "border-amber-200",
    pillText: "text-amber-900",
    iconBg: "bg-amber-500",
    iconColor: "text-white",
    cardBorderHover: "hover:border-amber-300",
    badgeBg: "bg-amber-100",
    badgeText: "text-amber-800",
  },
  rose: {
    pillBg: "bg-rose-50/95",
    pillBorder: "border-rose-200",
    pillText: "text-rose-900",
    iconBg: "bg-rose-600",
    iconColor: "text-white",
    cardBorderHover: "hover:border-rose-300",
    badgeBg: "bg-rose-100",
    badgeText: "text-rose-700",
  },
  teal: {
    pillBg: "bg-teal-50/95",
    pillBorder: "border-teal-200",
    pillText: "text-teal-900",
    iconBg: "bg-teal-600",
    iconColor: "text-white",
    cardBorderHover: "hover:border-teal-300",
    badgeBg: "bg-teal-100",
    badgeText: "text-teal-700",
  },
  indigo: {
    pillBg: "bg-indigo-50/95",
    pillBorder: "border-indigo-200",
    pillText: "text-indigo-900",
    iconBg: "bg-indigo-600",
    iconColor: "text-white",
    cardBorderHover: "hover:border-indigo-300",
    badgeBg: "bg-indigo-100",
    badgeText: "text-indigo-700",
  },
  slate: {
    pillBg: "bg-slate-100/95",
    pillBorder: "border-slate-300",
    pillText: "text-slate-900",
    iconBg: "bg-slate-700",
    iconColor: "text-white",
    cardBorderHover: "hover:border-slate-400",
    badgeBg: "bg-slate-200",
    badgeText: "text-slate-800",
  },
};

export default function OrganogramCanvas({
  config,
  users,
  isAdminMode = false,
  onSaveConfig,
  onEditUser,
  onAssignUserBranch,
  onRemoveUserFromBranch,
}: OrganogramCanvasProps) {
  const { showConfirm } = usePopup();

  // Pan & Zoom State
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const chartContentRef = useRef<HTMLDivElement>(null);

  // Modals State
  // 1. Branch Modal
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<OrganogramBranch | null>(null);
  const [branchFormName, setBranchFormName] = useState("");
  const [branchFormTierId, setBranchFormTierId] = useState("tier-2");
  const [branchFormParentId, setBranchFormParentId] = useState<string>("");
  const [branchFormColor, setBranchFormColor] = useState("blue");
  const [branchFormIcon, setBranchFormIcon] = useState("Laptop");

  // 2. Tier Modal
  const [tierModalOpen, setTierModalOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<OrganogramTier | null>(null);
  const [tierFormName, setTierFormName] = useState("");

  // 3. Leader Modal
  const [leaderModalOpen, setLeaderModalOpen] = useState(false);
  const [leaderFormName, setLeaderFormName] = useState("");
  const [leaderFormTitle, setLeaderFormTitle] = useState("");
  const [leaderFormEmail, setLeaderFormEmail] = useState("");
  const [leaderFormPhotoURL, setLeaderFormPhotoURL] = useState("");

  // Drag-and-drop state
  const [draggedUserEmail, setDraggedUserEmail] = useState<string | null>(null);
  const [dragOverTargetId, setDragOverTargetId] = useState<string | null>(null);
  const [showUnassignedDrawer, setShowUnassignedDrawer] = useState(false);

  // ---------------------------------------------------------
  // 1. COMPUTE TIERS (Only those on the board)
  // ---------------------------------------------------------
  const tiers: OrganogramTier[] = useMemo(() => {
    if (config?.tiers) {
      return [...config.tiers].sort((a, b) => (a.order || 0) - (b.order || 0));
    }
    return [{ id: "tier-1", name: "Senior Program Leadership", order: 1 }];
  }, [config]);

  // ---------------------------------------------------------
  // 2. COMPUTE LEADER
  // ---------------------------------------------------------
  const leader: OrganogramLeader = useMemo(() => {
    if (config?.leader?.name || config?.leader?.email) {
      return config.leader;
    }
    const master = users.find((u) => u.role === "Master Admin");
    if (master) {
      return {
        email: master.email,
        name: master.displayName || master.name || "Senior Program Leader",
        title: "Senior Program Leader",
        photoURL: master.photoURL || null,
        agentId: master.agentId || "#LEAD-01",
      };
    }
    return {
      email: "ritesh.sinha@piramalswasthya.org",
      name: "Rk Sinha",
      title: "Senior Program Leader",
      photoURL: null,
      agentId: "#LEAD-01",
    };
  }, [config, users]);

  // ---------------------------------------------------------
  // 3. COMPUTE ALL BRANCHES (Only those on the board)
  // ---------------------------------------------------------
  const branches: OrganogramBranch[] = useMemo(() => {
    if (config?.branches) {
      return [...config.branches].sort((a, b) => (a.order || 0) - (b.order || 0));
    }
    return [];
  }, [config]);

  // Map users to target containers (branches or tiers)
  const branchUsersMap = useMemo(() => {
    const map: Record<string, UserProfile[]> = {};
    branches.forEach((b) => {
      map[b.id] = [];
    });
    tiers.forEach((t) => {
      map[t.id] = [];
    });

    users.forEach((u) => {
      const branchId = u.orgBranch || u.orgTier;
      if (branchId && map[branchId]) {
        map[branchId].push(u);
      }
    });

    return map;
  }, [users, branches, tiers]);

  // Unassigned users: ANY user not currently rendered in the active chart
  const unassignedUsers = useMemo(() => {
    const assignedEmails = new Set<string>();
    Object.values(branchUsersMap).forEach((uList) => {
      uList.forEach((u) => {
        if (u.email) assignedEmails.add(u.email.toLowerCase().trim());
      });
    });

    return users.filter((u) => {
      const email = (u.email || "").toLowerCase().trim();
      return !email || !assignedEmails.has(email);
    });
  }, [users, branchUsersMap]);

  // Mouse & Touch Pan Handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest("button") ||
      target.closest("a") ||
      target.closest("input") ||
      target.closest("select") ||
      target.closest("[data-no-pan]")
    ) {
      return;
    }
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: panStartRef.current.x + dx,
      y: panStartRef.current.y + dy,
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest("button") ||
      target.closest("a") ||
      target.closest("input") ||
      target.closest("select") ||
      target.closest("[data-no-pan]")
    ) {
      return;
    }
    if (e.touches.length === 1) {
      setIsDragging(true);
      dragStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      panStartRef.current = { ...pan };
    }
  }, [pan]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - dragStartRef.current.x;
    const dy = e.touches[0].clientY - dragStartRef.current.y;
    setPan({
      x: panStartRef.current.x + dx,
      y: panStartRef.current.y + dy,
    });
  }, [isDragging]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      setZoom((prev) => Math.min(Math.max(prev * zoomFactor, 0.35), 2.0));
    } else {
      setPan((prev) => ({
        x: prev.x - e.deltaX * 0.8,
        y: prev.y - e.deltaY * 0.8,
      }));
    }
  }, []);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.15, 2.0));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.15, 0.35));
  const handleResetView = () => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  };

  // ---------------------------------------------------------
  // TIER CRUD HANDLERS
  // ---------------------------------------------------------
  const handleOpenAddTier = () => {
    setEditingTier(null);
    setTierFormName("");
    setTierModalOpen(true);
  };

  const handleOpenEditTier = (tier: OrganogramTier) => {
    setEditingTier(tier);
    setTierFormName(tier.name);
    setTierModalOpen(true);
  };

  const handleSaveTier = async () => {
    if (!tierFormName.trim() || !onSaveConfig) return;

    let updatedTiers: OrganogramTier[];
    if (editingTier) {
      updatedTiers = tiers.map((t) => (t.id === editingTier.id ? { ...t, name: tierFormName.trim() } : t));
    } else {
      const newId = `tier-${Date.now()}`;
      const newTier: OrganogramTier = {
        id: newId,
        name: tierFormName.trim(),
        order: tiers.length + 1,
      };
      updatedTiers = [...tiers, newTier];
    }

    await onSaveConfig({
      ...config,
      leader,
      tiers: updatedTiers,
      branches,
      updatedAt: Date.now(),
    });

    setTierModalOpen(false);
  };

  const handleDeleteTier = async (tierId: string) => {
    if (!onSaveConfig) return;
    const tierToDelete = tiers.find((t) => t.id === tierId);
    const tierName = tierToDelete?.name || "this tier";

    const confirmed = await showConfirm({
      title: "Delete Tier?",
      message: `Are you sure you want to delete "${tierName}"? Branches in it will be moved to another tier.`,
      isDestructive: true,
      confirmText: "Delete Tier",
      cancelText: "Cancel",
    });
    if (!confirmed) return;

    const updatedTiers = tiers.filter((t) => t.id !== tierId);
    const fallbackTierId = updatedTiers[0]?.id || "tier-1";
    const updatedBranches = branches.map((b) => (b.tierId === tierId ? { ...b, tierId: fallbackTierId } : b));

    await onSaveConfig({
      ...config,
      leader,
      tiers: updatedTiers,
      branches: updatedBranches,
      updatedAt: Date.now(),
    });
  };

  // ---------------------------------------------------------
  // BRANCH CRUD HANDLERS
  // ---------------------------------------------------------
  const handleOpenAddBranch = (targetTierId?: string, parentBranchId?: string) => {
    setEditingBranch(null);
    setBranchFormName("");
    setBranchFormTierId(targetTierId || tiers[1]?.id || tiers[0]?.id || "tier-2");
    setBranchFormParentId(parentBranchId || "");
    setBranchFormColor("blue");
    setBranchFormIcon("Laptop");
    setBranchModalOpen(true);
  };

  const handleOpenEditBranch = (branch: OrganogramBranch) => {
    setEditingBranch(branch);
    setBranchFormName(branch.name);
    setBranchFormTierId(branch.tierId || "tier-2");
    setBranchFormParentId(branch.parentBranchId || "");
    setBranchFormColor(branch.color || "blue");
    setBranchFormIcon(branch.icon || "Laptop");
    setBranchModalOpen(true);
  };

  const handleSaveBranch = async () => {
    if (!branchFormName.trim() || !onSaveConfig) return;

    let updatedBranches: OrganogramBranch[];
    if (editingBranch) {
      updatedBranches = branches.map((b) =>
        b.id === editingBranch.id
          ? {
              ...b,
              name: branchFormName.trim(),
              tierId: branchFormTierId,
              parentBranchId: branchFormParentId || null,
              color: branchFormColor,
              icon: branchFormIcon,
            }
          : b
      );
    } else {
      const newId = `branch-${Date.now()}`;
      const newBranch: OrganogramBranch = {
        id: newId,
        name: branchFormName.trim(),
        tierId: branchFormTierId,
        parentBranchId: branchFormParentId || null,
        color: branchFormColor,
        icon: branchFormIcon,
        order: branches.length + 1,
      };
      updatedBranches = [...branches, newBranch];
    }

    await onSaveConfig({
      ...config,
      leader,
      tiers,
      branches: updatedBranches,
      updatedAt: Date.now(),
    });

    setBranchModalOpen(false);
  };

  const handleDeleteBranch = async (branchId: string) => {
    if (!onSaveConfig) return;
    const branchToDelete = branches.find((b) => b.id === branchId);
    const branchName = branchToDelete?.name || "this branch";

    const confirmed = await showConfirm({
      title: "Delete Branch?",
      message: `Are you sure you want to delete "${branchName}"? Sub-branches and assigned members will be unlinked.`,
      isDestructive: true,
      confirmText: "Delete Branch",
      cancelText: "Cancel",
    });
    if (!confirmed) return;

    const updatedBranches = branches.filter((b) => b.id !== branchId && b.parentBranchId !== branchId);
    await onSaveConfig({
      ...config,
      leader,
      tiers,
      branches: updatedBranches,
      updatedAt: Date.now(),
    });
  };

  // ---------------------------------------------------------
  // LEADER EDIT & SWAP HANDLERS
  // ---------------------------------------------------------
  const handleOpenEditLeader = () => {
    setLeaderFormName(leader.name || "");
    setLeaderFormTitle(leader.title || "Senior Program Leader");
    setLeaderFormEmail(leader.email || "");
    setLeaderFormPhotoURL(leader.photoURL || "");
    setLeaderModalOpen(true);
  };

  const handleSaveLeader = async () => {
    if (!leaderFormName.trim() || !onSaveConfig) return;
    const updatedLeader: OrganogramLeader = {
      name: leaderFormName.trim(),
      title: leaderFormTitle.trim(),
      email: leaderFormEmail.trim(),
      photoURL: leaderFormPhotoURL.trim() || null,
      agentId: leader.agentId || "#LEAD-01",
    };

    await onSaveConfig({
      ...config,
      leader: updatedLeader,
      tiers,
      branches,
      updatedAt: Date.now(),
    });

    setLeaderModalOpen(false);
  };

  // Auto-pan canvas when dragging a card near edges (up, down, left, right)
  const handleCanvasDragOver = (e: React.DragEvent) => {
    if (!isAdminMode || !draggedUserEmail || !containerRef.current) return;
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const topDist = e.clientY - rect.top;
    const bottomDist = rect.bottom - e.clientY;
    const leftDist = e.clientX - rect.left;
    const rightDist = rect.right - e.clientX;

    // If dragging near top edge (within 85px), pan down to reveal upper content
    if (topDist < 85) {
      setPan((prev) => ({ ...prev, y: prev.y + Math.max(6, (85 - topDist) * 0.3) }));
    }
    // If dragging near bottom edge (within 85px), pan up to reveal lower content
    else if (bottomDist < 85) {
      setPan((prev) => ({ ...prev, y: prev.y - Math.max(6, (85 - bottomDist) * 0.3) }));
    }

    // Horizontal edge auto-pan
    if (leftDist < 85) {
      setPan((prev) => ({ ...prev, x: prev.x + Math.max(6, (85 - leftDist) * 0.3) }));
    } else if (rightDist < 85) {
      setPan((prev) => ({ ...prev, x: prev.x - Math.max(6, (85 - rightDist) * 0.3) }));
    }
  };

  // Drag and Drop Member Reassignment (Anywhere to Any Branch or Tier)
  const handleUserDragStart = (e: React.DragEvent, userEmail: string) => {
    if (!isAdminMode) return;
    e.dataTransfer.setData("text/plain", userEmail);
    setDraggedUserEmail(userEmail);
  };

  const handleDropOnTarget = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverTargetId(null);
    if (!isAdminMode) return;

    const userEmail = e.dataTransfer.getData("text/plain") || draggedUserEmail;
    if (!userEmail) return;

    try {
      if (onAssignUserBranch) {
        await onAssignUserBranch(userEmail, targetId);
      }
    } catch (err) {
      console.error("Drop assign error:", err);
    }
    setDraggedUserEmail(null);
  };

  // ---------------------------------------------------------
  // HELPER COMPONENT: SIMPLIFIED CLEAN MEMBER CARD
  // ---------------------------------------------------------
  const renderMemberCard = (member: UserProfile, branchThemeColor: string = "blue") => {
    const isBeingDragged = draggedUserEmail === member.email;
    const isMaster = member.role === "Master Admin";
    const isAdmin = member.role === "Admin";
    const theme = COLOR_THEMES[branchThemeColor] || COLOR_THEMES.blue;

    return (
      <div
        key={member.email}
        draggable={isAdminMode}
        onDragStart={(e) => handleUserDragStart(e, member.email)}
        className={`bg-white border border-slate-200/90 ${theme.cardBorderHover} rounded-xl p-2.5 shadow-2xs hover:shadow-md transition-all flex items-center justify-between gap-2.5 relative group/card ${
          isAdminMode ? "cursor-grab active:cursor-grabbing" : ""
        } ${isBeingDragged ? "opacity-40 scale-95 border-dashed" : ""}`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {isAdminMode && (
            <GripVertical className="w-3.5 h-3.5 text-slate-300 group-hover/card:text-slate-500 shrink-0" />
          )}

          {/* Profile Photo / Avatar */}
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-xs flex items-center justify-center overflow-hidden shrink-0 shadow-xs border border-white">
            {member.photoURL ? (
              <img
                src={member.photoURL}
                alt={member.displayName || member.name}
                className="w-full h-full object-cover"
              />
            ) : (
              (member.displayName || member.name || member.email).charAt(0).toUpperCase()
            )}
          </div>

          {/* Full Name */}
          <div className="min-w-0 flex-1">
            <h4 className="font-bold text-xs text-slate-900 truncate leading-tight">
              {member.displayName || member.name || "Agent"}
            </h4>
          </div>
        </div>

        {/* System Designation Badge ONLY */}
        <div className="flex items-center gap-1 shrink-0">
          <span
            className={`inline-flex items-center gap-1 font-extrabold px-2 py-0.5 rounded-full text-[9px] uppercase tracking-wider ${
              isMaster
                ? "bg-rose-50 text-rose-700 border border-rose-200"
                : isAdmin
                ? "bg-purple-50 text-purple-700 border border-purple-200"
                : "bg-blue-50 text-blue-700 border border-blue-200"
            }`}
          >
            {isMaster ? (
              <Crown className="w-2.5 h-2.5 text-rose-600" />
            ) : isAdmin ? (
              <Shield className="w-2.5 h-2.5 text-purple-600" />
            ) : (
              <Headphones className="w-2.5 h-2.5 text-blue-600" />
            )}
            <span>{member.role || "Agent"}</span>
          </span>

          {isAdminMode && onRemoveUserFromBranch && (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                const name = member.displayName || member.name || "this member";
                const confirmed = await showConfirm({
                  title: "Unassign Member?",
                  message: `Are you sure you want to remove ${name} from this position?`,
                  isDestructive: false,
                  confirmText: "Unassign",
                  cancelText: "Cancel",
                });
                if (confirmed) {
                  await onRemoveUserFromBranch(member.email);
                }
              }}
              data-no-pan
              className="p-1 text-slate-300 hover:text-rose-600 rounded-md transition-colors opacity-0 group-hover/card:opacity-100"
              title="Remove from branch"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------
  // HELPER COMPONENT: RECURSIVE BRANCH CONTAINER
  // ---------------------------------------------------------
  const renderBranchNode = (branch: OrganogramBranch) => {
    const theme = COLOR_THEMES[branch.color || "blue"] || COLOR_THEMES.blue;
    const IconComponent = ICON_MAP[branch.icon || "Laptop"] || Laptop;
    const members = branchUsersMap[branch.id] || [];
    const isDragOver = dragOverTargetId === branch.id;

    // Sub-branches nested under this branch
    const subBranches = branches.filter((b) => b.parentBranchId === branch.id);

    return (
      <div
        key={branch.id}
        onDragOver={(e) => {
          if (!isAdminMode) return;
          e.preventDefault();
          setDragOverTargetId(branch.id);
        }}
        onDragLeave={() => setDragOverTargetId(null)}
        onDrop={(e) => handleDropOnTarget(e, branch.id)}
        className="relative flex flex-col items-center min-w-[270px] sm:min-w-[300px] max-w-[340px]"
      >
        {/* Branch Drop Stem */}
        <div className="w-0.5 h-7 bg-slate-300" />

        {/* Branch Header Pill */}
        <div
          className={`w-full ${theme.pillBg} border-2 ${theme.pillBorder} ${
            isDragOver ? "ring-4 ring-blue-500 scale-102 border-blue-500" : ""
          } rounded-2xl p-3 shadow-md flex items-center justify-between transition-all duration-200 group/branch`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-7 h-7 rounded-xl ${theme.iconBg} ${theme.iconColor} flex items-center justify-center shadow-xs shrink-0`}
            >
              <IconComponent className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <h3 className={`font-black text-xs sm:text-sm ${theme.pillText} truncate leading-tight`}>
                {branch.name}
              </h3>
              <span
                className={`inline-block ${theme.badgeBg} ${theme.badgeText} text-[9px] font-bold px-1.5 py-0.2 rounded-full`}
              >
                {members.length} {members.length === 1 ? "person" : "persons"}
              </span>
            </div>
          </div>

          {/* Admin Branch Action Controls */}
          {isAdminMode && (
            <div className="flex items-center gap-1 shrink-0" data-no-pan>
              <button
                onClick={() => handleOpenAddBranch(branch.tierId, branch.id)}
                className="p-1 text-slate-500 hover:text-blue-600 hover:bg-white rounded-lg transition-colors"
                title="Add Sub-Branch under this branch"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleOpenEditBranch(branch)}
                className="p-1 text-slate-500 hover:text-blue-600 hover:bg-white rounded-lg transition-colors"
                title="Edit Branch"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleDeleteBranch(branch.id)}
                className="p-1 text-slate-500 hover:text-rose-600 hover:bg-white rounded-lg transition-colors"
                title="Delete Branch"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Vertical stem from pill into members list */}
        <div className="w-0.5 h-5 bg-slate-300" />

        {/* Branch Members Stack */}
        <div
          className={`w-full bg-white/80 backdrop-blur-xs border border-slate-200/90 rounded-2xl p-2.5 space-y-2 shadow-xs min-h-[110px] transition-colors ${
            isDragOver ? "bg-blue-50/60 border-blue-400 border-dashed" : ""
          }`}
        >
          {members.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400 italic">
              No members here yet.
              {isAdminMode && <p className="text-[10px] text-blue-600 mt-0.5">Drag & drop members here</p>}
            </div>
          ) : (
            members.map((m) => renderMemberCard(m, branch.color || "blue"))
          )}
        </div>

        {/* ---------------------------------------------------
            SUB-BRANCHES RECURSIVE RENDER (IF ANY)
            --------------------------------------------------- */}
        {subBranches.length > 0 && (
          <div className="relative flex flex-col items-center w-full mt-4">
            <div className="w-0.5 h-6 bg-slate-300" />
            <div className="text-[9px] font-extrabold uppercase text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
              Sub-Branches ({subBranches.length})
            </div>
            <div className="w-0.5 h-4 bg-slate-300" />

            {/* Sub-Branch Bar */}
            {subBranches.length > 1 && (
              <div className="relative w-full flex justify-center items-center">
                <div
                  style={{
                    width: `calc(100% - ${Math.max(200, 100 / subBranches.length)}px)`,
                  }}
                  className="h-0.5 bg-slate-300 absolute top-0"
                />
              </div>
            )}

            <div className="flex items-start justify-center gap-4 pt-0 flex-nowrap">
              {subBranches.map((subB) => renderBranchNode(subB))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="relative w-full h-[78vh] sm:h-[82vh] min-h-[580px] bg-slate-900/5 rounded-3xl border border-slate-200/80 overflow-hidden select-none flex flex-col">
      {/* ----------------------------------------------------
          CANVAS FLOATING TOOLBAR CONTROLS
          ---------------------------------------------------- */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-3.5 py-1.5 bg-white/90 backdrop-blur-md border border-slate-200/80 rounded-full text-xs font-bold text-slate-700 shadow-sm">
          <Move className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
          <span className="hidden sm:inline">Click & drag canvas to explore</span>
          <span className="sm:hidden">Drag to pan</span>
        </div>

        {isAdminMode && (
          <>
            <button
              onClick={handleOpenAddTier}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-white/90 backdrop-blur-md border border-slate-200/80 text-blue-700 hover:bg-blue-50 shadow-sm transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Add Tier</span>
            </button>

            <button
              onClick={() => handleOpenAddBranch()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-white/90 backdrop-blur-md border border-slate-200/80 text-emerald-700 hover:bg-emerald-50 shadow-sm transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Add Branch</span>
            </button>

            <button
              onClick={() => setShowUnassignedDrawer(!showUnassignedDrawer)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all shadow-sm ${
                showUnassignedDrawer
                  ? "bg-amber-600 text-white"
                  : "bg-white/90 backdrop-blur-md border border-slate-200/80 text-amber-700 hover:bg-amber-50"
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Unassigned ({unassignedUsers.length})</span>
            </button>
          </>
        )}
      </div>

      {/* Floating Zoom Controls (Bottom Right) */}
      <div className="absolute bottom-5 right-5 z-20 flex items-center gap-1 bg-white/95 backdrop-blur-md border border-slate-200/80 p-1.5 rounded-2xl shadow-xl">
        <button
          onClick={handleZoomIn}
          className="p-2 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-xl transition-colors"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <div className="text-[11px] font-bold text-slate-600 px-2 min-w-[44px] text-center">
          {Math.round(zoom * 100)}%
        </div>
        <button
          onClick={handleZoomOut}
          className="p-2 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-xl transition-colors"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-slate-200 mx-1" />
        <button
          onClick={handleResetView}
          className="p-2 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded-xl transition-colors"
          title="Reset to Center"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {/* ----------------------------------------------------
          INFINITE PAN / ZOOM CANVAS CONTAINER
          ---------------------------------------------------- */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
        onDragOver={handleCanvasDragOver}
        className={`flex-1 w-full h-full relative overflow-hidden bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:24px_24px] ${
          isDragging ? "cursor-grabbing" : "cursor-grab"
        }`}
      >
        <div
          ref={chartContentRef}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center top",
            transition: isDragging ? "none" : "transform 0.15s ease-out",
          }}
          className="w-max min-w-full min-h-full p-12 sm:p-20 flex flex-col items-center justify-start pointer-events-auto space-y-10"
        >
          {/* ====================================================
              DYNAMIC TIERS & BRANCHES HIERARCHY
              ==================================================== */}
          {tiers.map((tier, tierIdx) => {
            // Root branches in this tier (branches that have no parent branch)
            const tierBranches = branches.filter(
              (b) => (b.tierId === tier.id || (!b.tierId && tierIdx === 1)) && !b.parentBranchId
            );

            return (
              <div key={tier.id} className="relative flex flex-col items-center w-full space-y-4">
                {/* Tier Header Badge */}
                <div
                  onDragOver={(e) => {
                    if (!isAdminMode) return;
                    e.preventDefault();
                    setDragOverTargetId(tier.id);
                  }}
                  onDragLeave={() => setDragOverTargetId(null)}
                  onDrop={(e) => handleDropOnTarget(e, tier.id)}
                  className={`flex items-center gap-2 px-4 py-1.5 bg-white/95 backdrop-blur-md border border-slate-300 rounded-full shadow-sm text-xs font-extrabold text-slate-800 uppercase tracking-wider transition-all ${
                    dragOverTargetId === tier.id ? "ring-4 ring-blue-500 scale-105" : ""
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 text-blue-600" />
                  <span>{tier.name}</span>

                  {isAdminMode && (
                    <div className="flex items-center gap-1 ml-2" data-no-pan>
                      <button
                        onClick={() => handleOpenAddBranch(tier.id)}
                        className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                        title="Add Branch to this Tier"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleOpenEditTier(tier)}
                        className="p-1 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded"
                        title="Edit Tier Name"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      {tiers.length > 1 && (
                        <button
                          onClick={() => handleDeleteTier(tier.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded"
                          title="Delete Tier"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Direct Tier Members (if any assigned directly to this tier) */}
                {branchUsersMap[tier.id] && branchUsersMap[tier.id].length > 0 && (
                  <div className="flex items-center justify-center gap-3 flex-wrap max-w-2xl pt-2">
                    {branchUsersMap[tier.id].map((m) => renderMemberCard(m, "blue"))}
                  </div>
                )}

                {/* Connecting stem and branches - ONLY IF tierBranches.length > 0 */}
                {tierBranches.length > 0 && (
                  <div className="relative flex flex-col items-center w-full">
                    {/* Connecting stem from tier badge to branches */}
                    <div className="w-0.5 h-6 bg-slate-300" />

                    {/* Horizontal Distribution Junction Bar */}
                    {tierBranches.length > 1 && (
                      <div className="relative w-full flex justify-center items-center">
                        <div
                          style={{
                            width: `calc(100% - ${Math.max(260, 100 / tierBranches.length)}px)`,
                          }}
                          className="h-0.5 bg-slate-300 absolute top-0"
                        />
                      </div>
                    )}

                    {/* Branches Row in this Tier */}
                    <div className="flex items-start justify-center gap-6 sm:gap-10 pt-0 flex-nowrap">
                      {tierBranches.map((branch) => renderBranchNode(branch))}
                    </div>
                  </div>
                )}

                {/* Connecting stem to next tier if exists */}
                {tierIdx < tiers.length - 1 && <div className="w-0.5 h-10 bg-slate-300 mt-6" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* ----------------------------------------------------
          ADMIN: UNASSIGNED MEMBERS BOTTOM DRAWER
          ---------------------------------------------------- */}
      {isAdminMode && showUnassignedDrawer && (
        <div className="absolute bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t-2 border-slate-200 shadow-2xl p-4 max-h-[45vh] overflow-y-auto animate-in slide-in-from-bottom duration-200">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                Unassigned Members ({unassignedUsers.length})
              </h3>
              <span className="text-[10px] text-slate-400">
                Drag a member into any tier or branch above, or select from the dropdown
              </span>
            </div>
            <button
              onClick={() => setShowUnassignedDrawer(false)}
              className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 pt-3">
            {unassignedUsers.length === 0 ? (
              <div className="col-span-full py-6 text-center text-xs text-slate-400 italic">
                All members are currently assigned to branches or tiers.
              </div>
            ) : (
              unassignedUsers.map((m) => {
                const avatar = m.photoURL || (m as any).avatarUrl || (m as any).profilePhoto;
                const isMaster = m.role === "Master Admin";
                const isAdmin = m.role === "Admin";

                return (
                  <div
                    key={m.email}
                    draggable
                    onDragStart={(e) => handleUserDragStart(e, m.email)}
                    className="flex items-center justify-between p-2.5 bg-slate-50 hover:bg-blue-50/50 border border-slate-200 hover:border-blue-300 rounded-2xl text-xs cursor-grab active:cursor-grabbing transition-all shadow-2xs"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <GripVertical className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-[11px] flex items-center justify-center shrink-0 overflow-hidden border border-slate-200">
                        {avatar ? (
                          <img src={avatar} alt={m.displayName || "Avatar"} className="w-full h-full object-cover" />
                        ) : (
                          (m.displayName || m.name || m.email).charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-slate-800 text-xs truncate">
                          {m.displayName || m.name || m.email.split("@")[0]}
                        </p>
                        <span
                          className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 text-[9px] font-extrabold rounded-full uppercase ${
                            isMaster
                              ? "bg-rose-100 text-rose-700"
                              : isAdmin
                              ? "bg-purple-100 text-purple-700"
                              : "bg-blue-100 text-blue-700"
                          }`}
                        >
                          {m.role || "Agent"}
                        </span>
                      </div>
                    </div>

                    <select
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value && onAssignUserBranch) {
                          onAssignUserBranch(m.email, e.target.value);
                        }
                      }}
                      className="text-[10px] bg-white border border-slate-200 hover:border-blue-500 rounded-xl px-2 py-1 font-bold text-blue-600 outline-none hover:bg-slate-50 shrink-0 ml-2"
                    >
                      <option value="" disabled>
                        Assign to...
                      </option>
                      <optgroup label="Tiers">
                        {tiers.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </optgroup>
                      {branches.length > 0 && (
                        <optgroup label="Branches">
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------
          MODAL: ADD / EDIT BRANCH (ADMIN)
          ---------------------------------------------------- */}
      {branchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white max-w-md w-full rounded-3xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingBranch ? "Edit Branch" : "Add New Branch / Sub-Branch"}
              </h3>
              <button
                onClick={() => setBranchModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Branch Name</label>
                <input
                  type="text"
                  placeholder="e.g. IT Team, ESIC Agents, Field Team"
                  value={branchFormName}
                  onChange={(e) => setBranchFormName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 outline-none focus:border-blue-600 focus:bg-white transition-all"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Assign to Tier</label>
                <select
                  value={branchFormTierId}
                  onChange={(e) => setBranchFormTierId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 outline-none focus:border-blue-600"
                >
                  {tiers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Parent Branch (Optional for Sub-Branch)</label>
                <select
                  value={branchFormParentId}
                  onChange={(e) => setBranchFormParentId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 outline-none focus:border-blue-600"
                >
                  <option value="">None (Top-Level in Tier)</option>
                  {branches
                    .filter((b) => !editingBranch || b.id !== editingBranch.id)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Theme Color</label>
                <div className="grid grid-cols-4 gap-2">
                  {Object.keys(COLOR_THEMES).map((c) => {
                    const theme = COLOR_THEMES[c];
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setBranchFormColor(c)}
                        className={`px-3 py-2 rounded-xl text-xs font-bold capitalize flex items-center justify-center gap-1.5 border transition-all ${
                          branchFormColor === c
                            ? `${theme.pillBg} ${theme.pillBorder} ${theme.pillText} ring-2 ring-blue-500`
                            : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-full ${theme.iconBg}`} />
                        <span>{c}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Icon</label>
                <div className="grid grid-cols-5 gap-2">
                  {Object.keys(ICON_MAP).map((iKey) => {
                    const IconComp = ICON_MAP[iKey];
                    return (
                      <button
                        key={iKey}
                        type="button"
                        onClick={() => setBranchFormIcon(iKey)}
                        className={`p-2.5 rounded-xl text-xs font-bold flex items-center justify-center border transition-all ${
                          branchFormIcon === iKey
                            ? "bg-blue-50 border-blue-500 text-blue-700 ring-2 ring-blue-500"
                            : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        <IconComp className="w-4 h-4" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setBranchModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveBranch}
                disabled={!branchFormName.trim()}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs shadow-md transition-all"
              >
                {editingBranch ? "Update Branch" : "Create Branch"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------
          MODAL: ADD / EDIT TIER (ADMIN)
          ---------------------------------------------------- */}
      {tierModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white max-w-md w-full rounded-3xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingTier ? "Edit Tier" : "Add New Tier"}
              </h3>
              <button
                onClick={() => setTierModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Tier Name</label>
                <input
                  type="text"
                  placeholder="e.g. Tier 1: Senior Leadership, Tier 2: Operations..."
                  value={tierFormName}
                  onChange={(e) => setTierFormName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 outline-none focus:border-blue-600 focus:bg-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setTierModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTier}
                disabled={!tierFormName.trim()}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs shadow-md transition-all"
              >
                {editingTier ? "Update Tier" : "Create Tier"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------
          MODAL: EDIT ROOT LEADER (ADMIN)
          ---------------------------------------------------- */}
      {leaderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white max-w-md w-full rounded-3xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Edit Program Leader</h3>
              <button
                onClick={() => setLeaderModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Select from Existing Members</label>
                <select
                  onChange={(e) => {
                    const selected = users.find((u) => u.email === e.target.value);
                    if (selected) {
                      setLeaderFormName(selected.displayName || selected.name || "");
                      setLeaderFormEmail(selected.email);
                      setLeaderFormPhotoURL(selected.photoURL || "");
                    }
                  }}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 outline-none focus:border-blue-600"
                >
                  <option value="">-- Choose Member or Enter Below --</option>
                  {users.map((u) => (
                    <option key={u.email} value={u.email}>
                      {u.displayName || u.name} ({u.email})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Leader Name</label>
                <input
                  type="text"
                  placeholder="e.g. Rk Sinha"
                  value={leaderFormName}
                  onChange={(e) => setLeaderFormName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 outline-none focus:border-blue-600 focus:bg-white"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Designation / Title</label>
                <input
                  type="text"
                  placeholder="e.g. Senior Program Leader"
                  value={leaderFormTitle}
                  onChange={(e) => setLeaderFormTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 outline-none focus:border-blue-600 focus:bg-white"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Email</label>
                <input
                  type="email"
                  placeholder="ritesh.sinha@piramalswasthya.org"
                  value={leaderFormEmail}
                  onChange={(e) => setLeaderFormEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 outline-none focus:border-blue-600 focus:bg-white"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Photo URL (Optional)</label>
                <input
                  type="text"
                  placeholder="https://... or base64 image"
                  value={leaderFormPhotoURL}
                  onChange={(e) => setLeaderFormPhotoURL(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-900 outline-none focus:border-blue-600 focus:bg-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setLeaderModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveLeader}
                disabled={!leaderFormName.trim()}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs shadow-md transition-all"
              >
                Save Leader
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}