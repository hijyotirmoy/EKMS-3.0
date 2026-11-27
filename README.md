# EKMS — Enterprise Knowledge & Healthcare Management System

EKMS is a mission-critical healthcare consultation, dispensary workflow, and clinical triage management platform designed for ESIC/ESIS health networks. It serves 10,000+ concurrent field agents, medical officers, dispensary staff, and administrative supervisors.

---

## 🏛 System Architecture Overview

```
                                  +-----------------------------+
                                  |         EKMS Client         |
                                  |    (Next.js App Router)     |
                                  +--------------+--------------+
                                                 |
         +---------------------------------------+---------------------------------------+
         |                                       |                                       |
+--------v--------+                     +--------v--------+                     +--------v--------+
|   Field Agent   |                     | Dispensary Desk |                     |   Admin Portal  |
|  Module (Agent) |                     | (4-Step Workflow|                     | (Audit & Access)|
+--------+--------+                     +--------+--------+                     +--------+--------+
         |                                       |                                       |
         +---------------------------------------+---------------------------------------+
                                                 |
                         +-----------------------v-----------------------+
                         |      Enterprise Multi-Database Layer          |
                         +-----------------------+-----------------------+
                                                 |
         +-------------------+-------------------+-------------------+
         |                   |                   |                   |
+--------v--------+ +--------v--------+ +--------v--------+ +--------v--------+
| 1. Core EKMS DB | | 2. Booking DB   | | 3. System Logs  | | 4. Cases DB     |
| Knowledge/Users | | Appointments    | | Audit Trail     | | Clinical Triage |
| (ekms-app)      | | (triage-booking)| | (ekms-logs)     | | (triage-cases)  |
+-----------------+ +-----------------+ +-----------------+ +-----------------+
                                       |
                     +-----------------+-----------------+
                     |                                   |
           +---------v---------+               +---------v---------+
           | 7-Day Vault Disk  |               | Realtime Google   |
           | Recently Deleted  |               | Sheets Master DB  |
           +-------------------+               +-------------------+
```

---

## 📂 Clean Directory Structure

```
EKMS 3.0/
├── app/
│   ├── (agent)/                    # Field Agent & Clinical Triage Portal
│   │   ├── appointment/            # Agent Appointments List & Verification
│   │   ├── booking/                # Health Visit & IP Booking Desk
│   │   ├── contact/                # Contact Support Directory
│   │   ├── data/                   # Searchable Operational Records
│   │   ├── dispensary/             # 4-Step Clinical Dispensary OPD Desks
│   │   │   ├── appointment/        # Dispensary OPD Queue
│   │   │   ├── doctor/             # Doctor Consultation & Sickness Certification
│   │   │   ├── pharmacy/           # Pharmacy Medicine Dispensation
│   │   │   └── reception/          # Reception Patient Check-in
│   │   ├── doubts/                 # Field Agent Q&A Community Forum
│   │   ├── facility/               # Empaneled 98 Healthcare Facility Locator
│   │   ├── files/                  # Document & Resource Library
│   │   ├── onboarding/             # Clinical Training Modules
│   │   ├── profile/                # User Profile & Activity Tracking
│   │   ├── quiz/                   # Knowledge Evaluations & Scoring
│   │   ├── reports/                # Feedback & Bug Reporting
│   │   ├── team/                   # Organizational Hierarchy & Organogram
│   │   └── triage/                 # Native Clinical Probing & Diagnostic Intake
│   ├── admin/                      # Enterprise Administration & Governance
│   │   ├── announcements/          # Broadcast Announcements
│   │   ├── appointment/            # Master Appointment Management & Excel Extract
│   │   ├── bookings/               # Hospital Visit Schedules & Analytics
│   │   ├── cases/                  # Triage Case Logs & Patient Records
│   │   ├── doubts/                 # Doubts Moderation Desk
│   │   ├── facilities/             # Master 98 Facility Directory & CRUD
│   │   ├── files/                  # Resource File Uploads & Management
│   │   ├── missing-content/        # Content Audit & Search Gap Analytics
│   │   ├── notifications/          # Push & Broadcast Notification Engine
│   │   ├── onboarding/             # Training Courses & Module Builder
│   │   ├── overview/               # High-Level Metrics & Operational KPIs
│   │   ├── qa/                     # Knowledge Articles & Clinical SOPs
│   │   ├── quiz/                   # Quiz & Assessment Configuration
│   │   ├── reports/                # Issue Resolution Desk
│   │   ├── settings/               # System Settings (Facility Availability, 7-Day Vault, RBAC)
│   │   └── teams/                  # Staff & Role Management
│   └── api/                        # Next.js Serverless Route Handlers
│       ├── caller/lookup/          # Instant Caller History & CID Resolution
│       ├── cases/                  # Clinical Triage Case Forwarding
│       ├── crm/live-sync/          # External Dhwani CRM Two-Way Bridge
│       ├── ekms-ai/chat/           # AI Symptom Diagnostic & Adaptive Engine
│       ├── facilities/availability/# Live Facility Status API (Accepting vs Offline)
│       ├── google-sheets/          # Google Sheets Master Register Sync
│       ├── recently-deleted/       # 7-Day Holding Vault Archive & Restore API
│       ├── triage/                 # Native Triage Intake Endpoints
│       └── v1/appointments/        # Enterprise Authenticated REST API
├── components/                     # Reusable Modular React Components
│   ├── appointments/               # Clinical Summary, Reschedule, Doctor & Slot Modals
│   ├── auth/                       # Authentication & Login Modals
│   ├── common/                     # Notification Drawer, Issue Reports, Confirm Popups
│   ├── layout/                     # Persistent Navigation (EkmsNavbar, EkmsSidebar)
│   ├── team/                       # Hierarchy Views & Organogram
│   └── triage/                     # TriageConsole, CaseHandoverForwarding, CaseLogs
├── context/                        # Global React Contexts (AuthContext, PopupContext)
├── data/                           # Master Reference JSONs (98 Facilities, Pincodes, Cache)
├── lib/                            # Core Logic, Database SDKs, and Clinical Algorithms
│   ├── activityLogger.ts           # Enterprise Audit Trail & Realtime Loggers
│   ├── callerId.js                 # Deterministic Caller ID Generator (`CID0005A810`)
│   ├── caseId.js                   # Case Reference ID Generator (`CA0118AB01`)
│   ├── clientCache.js              # High-Speed Offline Caching (0 Firestore Reads)
│   ├── clinicalAdaptiveEngine.js   # Symptom Adaptive Probing & Comorbidity Scoring
│   ├── facilityAvailability.js     # Live Facility Booking Acceptance Controller
│   ├── firebase.ts                 # Multi-Account Firebase SDK Client Instances
│   ├── googleSheetsSync.js         # Master Google Sheets Two-Way Synchronizer
│   ├── maskUtils.ts                # HIPAA/DPDP Compliant Data Masking (`KES*** ***IKA`)
│   ├── pageAccess.ts               # Role-Based Access Control (RBAC) Guard
│   ├── rateLimit.ts                # In-Memory Sliding Window Rate Limiter
│   ├── recentlyDeleted.js          # 7-Day Auto-Purge & Restore Vault Logic
│   └── types.ts                    # Global TypeScript Interface Definitions
└── scripts/                        # Maintenance, Migration, and Audit Scripts
```

---

## 🔒 Security & Role-Based Access Control (RBAC)

1. **Master Administrator**:
   - Permanent, global, unrestricted access to all modules, settings, and database configurations.
2. **Administrative Supervisor**:
   - Operational access to manage appointments, facilities, system settings, user permissions, audit logs, and 7-day deleted items.
3. **Dispensary Staff (Reception, Doctor, Pharmacist)**:
   - Strictly isolated to their assigned dispensary desk workflows:
     - `/dispensary/appointment` (Dispensary OPD list)
     - `/dispensary/reception` (Check-in)
     - `/dispensary/doctor` (Consultation & Prescription)
     - `/dispensary/pharmacy` (Dispensation)
     - `/profile` and `/reports`
   - All external modules, CRM pages, and general agent appointments are blocked by default.
4. **Field / Call Center Agent**:
   - Intake, triage, facility lookup, knowledge search, and Insured Person appointment booking.

---

## ⚡ Ultra-Low Database Reads & Caching Strategy

- **98 Empaneled Facilities**: Stored in client-side memory and `@/data/facilities_cache.json`. Initial page loads and facility lookups consume **zero Firestore reads**.
- **Sliding Window Rate Limiter**: 60 requests/minute in-memory sliding window protects APIs against scraping and automated spam without requiring Redis or external state stores.
- **7-Day Recently Deleted Holding Vault**: Any appointment, case, user, or audit log deleted across EKMS is safely retained in the holding vault for 7 days with 1-click restore before automatic permanent purge.
- **Google Sheets Live Master Register**: High-durability external sync ensures appointment records are perpetually preserved even if local database entries are altered or reset.

---

## 🚀 Running Locally

```bash
# Install dependencies
npm install

# Start development server on port 3000
npm run dev -- -p 3000

# Build production bundle
npm run build
```

---

## 📜 Master System Prompt & Operational Directives

For full system rules, operational constraints, 4-stage appointment lifecycle logic, error handling standards, and AI instructions, refer to [MASTER_PROMPT.md](file:///c:/Users/chjyo/OneDrive/Desktop/Piramal%20web/EKMS%203.0/MASTER_PROMPT.md).
