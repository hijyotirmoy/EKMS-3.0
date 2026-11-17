export type UserRole = "Agent" | "Admin" | "Master Admin";

export interface UserProfile {
  id?: string;
  email: string;
  displayName: string;
  name?: string;
  role: UserRole;
  agentId?: string;
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
  isLocked?: boolean;
  lockReason?: string;
  restrictedPages?: string[];
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
  resolvedAt?: number;
  createdAt: number;
  category?: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation?: string;
}

export interface Quiz {
  id: string;
  title: string;
  description?: string;
  timeLimit?: number; // in minutes
  passingScore?: number; // percentage
  questions: QuizQuestion[];
  category?: string;
  createdAt?: number;
}

export type NotificationType = "system" | "birthday" | "announcement" | "booking" | "doubt" | "quiz" | "lock";

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  targetEmail: string | "all";
  targetRole: "all" | "admin" | "agent";
  celebrantEmail?: string;
  link?: string;
  readBy?: string[];
  closedBy?: string[];
  createdAt: number;
}

export interface Announcement {
  id: string;
  title?: string;
  message: string;
  type?: string;
  targetEmail?: string;
  targetRole?: string;
  readBy?: string[];
  closedBy?: string[];
  createdAt?: number;
  isVisible?: boolean;
}
