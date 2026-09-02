import { UserProfile } from "@/lib/types";

export interface AppPageDef {
  path: string;
  label: string;
  category: "Agent" | "Admin";
  description: string;
  iconName: string;
}

export const ALL_AGENT_PAGES: AppPageDef[] = [
  {
    path: "/",
    label: "Home / Guidance Portal",
    category: "Agent",
    description: "Main knowledge base, guidance database, and search",
    iconName: "Home",
  },
  {
    path: "/files",
    label: "Files & Documents Library",
    category: "Agent",
    description: "Resource library for downloadable documents and SOPs",
    iconName: "Folder",
  },
  {
    path: "/doubts",
    label: "Doubts & Community Forum",
    category: "Agent",
    description: "Q&A and knowledge exchange forum for field agents",
    iconName: "HelpCircle",
  },
  {
    path: "/facility",
    label: "Facility Locator",
    category: "Agent",
    description: "Map and directory of empaneled healthcare facilities",
    iconName: "Building2",
  },
  {
    path: "/onboarding",
    label: "Learning & Onboarding",
    category: "Agent",
    description: "Training courses and onboarding modules",
    iconName: "GraduationCap",
  },
  {
    path: "/quiz",
    label: "Quizzes & Assessments",
    category: "Agent",
    description: "Knowledge tests, quizzes, and performance scoring",
    iconName: "Gamepad2",
  },
  {
    path: "/team",
    label: "Team & Organogram",
    category: "Agent",
    description: "Interactive hierarchy and team structure",
    iconName: "Users",
  },
  {
    path: "/booking",
    label: "Health Visit Booking",
    category: "Agent",
    description: "Insured Person verification appointment booking portal",
    iconName: "CalendarCheck",
  },
  {
    path: "/data",
    label: "Core Data Search",
    category: "Agent",
    description: "Searchable reference database and operational records",
    iconName: "Database",
  },
  {
    path: "/reports",
    label: "Issue & Bug Reports",
    category: "Agent",
    description: "Submit feedback and report portal issues to admins",
    iconName: "Flag",
  },
  {
    path: "/profile",
    label: "User Profile",
    category: "Agent",
    description: "Personal account, streak, and quiz achievements",
    iconName: "User",
  },
];

export const ALL_ADMIN_PAGES: AppPageDef[] = [
  {
    path: "/admin/overview",
    label: "Admin Overview",
    category: "Admin",
    description: "Key metrics, summary charts, and pending actions",
    iconName: "PieChart",
  },
  {
    path: "/admin/qa",
    label: "Manage Q&A Guidance",
    category: "Admin",
    description: "Create, edit, and publish knowledge articles",
    iconName: "Edit",
  },
  {
    path: "/admin/files",
    label: "Manage Files & Docs",
    category: "Admin",
    description: "Upload and manage repository files and assets",
    iconName: "Folder",
  },
  {
    path: "/admin/facilities",
    label: "Manage Facilities",
    category: "Admin",
    description: "Update empaneled hospital and dispensary network listings",
    iconName: "Building2",
  },
  {
    path: "/admin/missing-content",
    label: "Missing Content Tracker",
    category: "Admin",
    description: "Audit unfulfilled search queries and content requests",
    iconName: "FileSpreadsheet",
  },
  {
    path: "/admin/teams",
    label: "Manage Teams & Staff",
    category: "Admin",
    description: "Manage organizational hierarchy and branch members",
    iconName: "Users2",
  },
  {
    path: "/admin/notifications",
    label: "Notification Center",
    category: "Admin",
    description: "Broadcast announcements and view dispatch logs",
    iconName: "Bell",
  },
  {
    path: "/admin/doubts",
    label: "Manage Doubts",
    category: "Admin",
    description: "Review, respond, and resolve agent queries",
    iconName: "HelpCircle",
  },
  {
    path: "/admin/quiz",
    label: "Quiz Manager",
    category: "Admin",
    description: "Create and publish evaluation assessments",
    iconName: "ClipboardCheck",
  },
  {
    path: "/admin/onboarding",
    label: "Onboarding Manager",
    category: "Admin",
    description: "Manage structured onboarding modules and certificates",
    iconName: "GraduationCap",
  },
  {
    path: "/admin/bookings",
    label: "Manage Bookings",
    category: "Admin",
    description: "Manage hospital visit schedules, capacity, and analytics",
    iconName: "CalendarCheck",
  },
  {
    path: "/admin/settings",
    label: "System Settings",
    category: "Admin",
    description: "System security, IP masking, timeout, and access control",
    iconName: "Settings",
  },
];

/**
 * Normalizes a path for comparison
 */
export const normalizePath = (path: string): string => {
  if (!path) return "/";
  const trimmed = path.trim().toLowerCase();
  if (trimmed === "/admin" || trimmed === "/admin/") return "/admin/overview";
  return trimmed.endsWith("/") && trimmed.length > 1 ? trimmed.slice(0, -1) : trimmed;
};

/**
 * Checks if a specific path is restricted for a given user profile.
 * Master Admins are NEVER restricted on any page.
 */
export const isPageRestricted = (
  pathname: string,
  userProfile: UserProfile | null | undefined
): boolean => {
  if (!userProfile) return false;

  // Master Admin has permanent, inviolable access to every page
  const roleStr = (userProfile.role || "").toLowerCase().trim();
  if (roleStr.includes("master")) {
    return false;
  }

  const restrictedPages = userProfile.restrictedPages || [];
  if (!Array.isArray(restrictedPages) || restrictedPages.length === 0) {
    return false;
  }

  const normalizedCurrent = normalizePath(pathname);

  return restrictedPages.some((restricted) => {
    const normRestricted = normalizePath(restricted);
    if (normRestricted === normalizedCurrent) return true;
    // Prefix match for nested sub-routes (except root "/")
    if (normRestricted !== "/" && normalizedCurrent.startsWith(normRestricted + "/")) {
      return true;
    }
    return false;
  });
};
