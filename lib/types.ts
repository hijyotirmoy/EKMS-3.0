export type UserRole = "Agent" | "Dispensary Staff" | "Dispensary" | "Admin" | "Master Admin";

export interface DispensaryAccount {
  id?: string;
  dispensaryId: string;
  dispensaryName: string;
  email: string;
  location?: string;
  district?: string;
  state?: string;
  phone?: string;
  status: "active" | "inactive";
  role: "Dispensary";
  createdAt?: number;
  updatedAt?: number;
  restrictedPages?: string[];
  isLocked?: boolean;
  lastLoginAt?: number;
}

export interface UserProfile {
  id?: string;
  email: string;
  displayName: string;
  name?: string;
  role: UserRole;
  agentId?: string;
  dispensaryId?: string;
  dispensaryName?: string;
  dispensaryRole?: "Doctor" | "Pharmacist" | "Receptionist";
  location?: string;
  district?: string;
  state?: string;
  phone?: string;
  status?: "active" | "inactive";
  dob?: string;
  birthday?: string;
  photoURL?: string | null;
  createdAt?: number;
  updatedAt?: number;
  lastLoginAt?: number;
  streak?: number;
  lastActiveDate?: any;
  orgTier?: string;
  orgBranch?: string;
  orgRoleTitle?: string;
  quizCompleted?: string[];
  quizScores?: Record<string, number>;
  totalQuizzesTaken?: number;
  quizzesPassed?: number;
  avgScore?: number;
  courseProgress?: Record<string, CourseUserProgress>;
  isLocked?: boolean;
  lockedAt?: number;
  lockedUntil?: number;
  failedAttempts?: number;
  lastFailedAttempt?: number;
  lockReason?: string;
  restrictedPages?: string[];
  mustChangePassword?: boolean;
}

export interface BookingRecord {
  agentEmail: string;
  agentName?: string;
  ipName: string;
  phone: string;
  timestamp: number;
  visited?: boolean;
  rescheduled?: boolean;
  isRescheduled?: boolean;
  rescheduledDate?: string;
  originalScheduledDate?: string;
  dateKey?: string;
}

export interface DayAvailability {
  seats: number;
  text?: string;
  bookedRecords?: BookingRecord[];
}

export interface RescheduleLog {
  id?: string;
  ipName: string;
  seatOwner: string;
  agentName?: string;
  phone?: string;
  originalDate: string;
  newDate: string;
  actionBy: string;
  actionByName?: string;
  timestamp: number;
}

export interface Facility {
  id: string;
  name: string;
  category: string; // 'ESIC' | 'NHM' | etc.
  type: string;     // 'ESIS Dispensary' | 'ESIC Hospital' | 'NHM CHC' | etc.
  address: string;
  district: string;
  state: string;
  city?: string;
  location?: string;
  block?: string;
  pincode?: string;
  lat?: number | null;
  lng?: number | null;
  latitude?: number | string;
  longitude?: number | string;
  mapLink?: string;
  createdAt?: number;
  updatedAt?: number;
  calculatedDistance?: number;
  facNumber?: number;
}

export interface Doubt {
  id: string;
  question: string;
  description?: string;
  author: string;
  authorEmail: string;
  authorPhoto?: string | null;
  status: "pending" | "waiting" | "resolved";
  answer?: string;
  resolvedBy?: string;
  resolvedByEmail?: string | null;
  resolvedByPhoto?: string | null;
  resolvedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface AppFile {
  id: string;
  name: string;
  category: string;
  fileType: string;
  driveUrl?: string;
  dataUrl?: string;
  url?: string;
  sizeBytes?: number;
  size?: number;
  downloadCount?: number;
  downloads?: number;
  uploadedBy?: string;
  uploadedAt?: number;
}

export interface QnAItem {
  id: string;
  qaCode?: string;
  qaSequence?: number;
  question: string;
  answer: string;
  category: string;
  tags?: string[];
  isAiOptimized?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface MCQQuestion {
  text: string;
  options: string[];
  correct: number; // 1-indexed (1, 2, 3, 4)
}

export interface Chapter {
  title: string;
  content: string;
  videoUrl?: string;
  imageUrl?: string;
  questions?: MCQQuestion[];
  attachedFiles?: Array<{
    id: string;
    name: string;
    url: string;
    fileType?: string;
  }>;
}

export interface CourseRating {
  email: string;
  name: string;
  rating: number;
  feedback?: string;
  date: number;
}

export interface Course {
  id: string;
  title: string;
  slug?: string;
  category: string;
  phase: number;
  coverImage?: string;
  chapters: Chapter[];
  finalQuiz?: MCQQuestion[];
  ratings?: CourseRating[];
  date?: string;
  active: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface CourseUserProgress {
  unlockedIndex: number;
  chapterScores?: Record<number | string, number>;
  chapterAnswers?: Record<number | string, Record<number, number>>;
  finalScore?: number | null;
  status: "new" | "in-progress" | "completed";
}

export interface Quiz {
  id: string;
  title: string;
  time: number; // in minutes
  questions: number;
  questionData: MCQQuestion[];
  date: string;
  active: boolean;
  mobileAllowed?: boolean;
  attempts?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface AppReport {
  id: string;
  type: string; // 'Files' | 'Q&A' | 'Quiz' | 'Course' | 'Facility' | 'Others'
  message: string;
  targetCode?: string;
  targetSourceTitle?: string;
  targetId?: string;
  reporterName: string;
  reporterEmail: string;
  status: "pending" | "solved";
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  adminRemarks?: string;
}

export interface Announcement {
  id: string;
  message: string;
  isVisible: boolean;
  createdAt: number;
  updatedAt?: number;
}

export type NotificationTargetRole = "all" | "admin" | "agent";

export type NotificationType =
  | "booking"
  | "birthday"
  | "announcement"
  | "system"
  | "quiz"
  | "course"
  | "doubt"
  | "report"
  | "qna"
  | "facility"
  | "dispensary_opd";

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  targetEmail: string | "all"; // Specific user email or "all"
  targetRole?: NotificationTargetRole; // Role filter: "all" (default), "admin", or "agent"
  targetDispensary?: string;   // For dispensary OPD alerts
  targetDispensaryRole?: "Doctor" | "Pharmacist" | "Receptionist" | "all";
  celebrantEmail?: string;     // For birthday notifications
  readBy?: string[];           // Emails of users who marked as read
  closedBy?: string[];         // Emails of users who dismissed/closed
  createdAt: number;
  updatedAt?: number;
  link?: string;
  metadata?: Record<string, any>;
}

export interface DailyActivityLog {
  id?: string;
  email: string;
  name: string;
  date: string; // YYYY-MM-DD
  loginTime?: number;
  firstLogin?: number;
  logoutTime?: number;
  loginCount?: number;
  lastActive?: number;
  totalSeconds?: number;
  filesDownloaded?: number;
  quizzesCompletedCount?: number;
  searches?: string[];
  pageVisits?: Record<string, number>; // page -> seconds
  timelineEvents?: Array<{
    time: number;
    desc: string;
    type?: string;
    icon?: string;
    color?: string;
  }>;
}

export interface MissingSearchLog {
  id?: string;
  term: string;
  count: number;
  lastAttempt: number;
}

export interface SystemStatus {
  maintenanceMode?: boolean;
  maintenanceMessage?: string;
  sessionTimeoutEnabled?: boolean;
  sessionTimeoutDuration?: number; // in minutes
  qaLastUpdated?: number;
  updatedAt?: number;
}

export interface OrganogramTier {
  id: string;
  name: string;
  order?: number;
  description?: string;
}

export interface OrganogramBranch {
  id: string;
  name: string;
  tierId?: string; // which tier this branch belongs to
  parentBranchId?: string | null; // nested sub-branch support (e.g. sub-branches within a branch)
  parentId?: string | null; // backwards compatibility
  color?: string; // "blue" | "purple" | "emerald" | "amber" | "rose" | "teal" | "indigo" | "slate"
  icon?: string; // icon name e.g. "Laptop", "Headphones", "MapPin", "Users", "Shield", "Zap", "Layers"
  order?: number;
  description?: string;
}

export interface OrganogramLeader {
  email: string;
  name?: string;
  title?: string;
  photoURL?: string | null;
  agentId?: string;
}

export interface OrganogramConfig {
  leader?: OrganogramLeader | null;
  tiers?: OrganogramTier[];
  branches: OrganogramBranch[];
  updatedAt?: number;
}

