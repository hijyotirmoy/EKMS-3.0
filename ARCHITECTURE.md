# EKMS 3.0 System Architecture & Engineering Reference

This document provides a comprehensive technical reference for the EKMS 3.0 platform: architecture, multi-database failover, token generation, slot conflict management, dispensary clinical progression, and cross-client synchronization.

---

## 1. High-Level Architecture & Tech Stack

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
|  Module (Agent) |                     | (3-Step OPD)    |                     | (Audit & Access)|
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

- **Frontend Framework**: Next.js 14+ (App Router, Client & Server Components).
- **Language**: TypeScript (Strict type safety, ES2017+ target).
- **Styling**: Tailwind CSS, PostCSS, Lucide React icons.
- **State Management & Caching**: Multi-tier 0ms memory client cache (`clientCache.js`), persistent `localStorage`, and real-time Firebase snapshot listeners (`onSnapshot`).
- **Real-time Inter-tab Sync**: `BroadcastChannel` (`ekms_triage_sync_v1`) and Firestore system sync markers.

---

## 2. Multi-Database Layer & Failover Strategy

EKMS connects to four distinct Firestore and Realtime Database instances:

1. **`bookingDb` (`ekmsbooking-29d77`)**:
   - Primary operational store for all appointments (`dispensary_appointments`), dispensary queues, and doctor availability rosters (`doctor_availability`, `dispensary_doctors`).
2. **`casesSettingsDb` (`ekms-cases-settings`)**:
   - Dedicated store for helpline triage cases (`cases`), clinical assessments, and user feedbacks.
3. **`coreDb` (`ekms-app-default-rtdb` / main Firestore)**:
   - User authentication profiles (`users`), facility records (`facilities`), knowledge base articles, and application settings.
4. **`oldBookingDb` (`ekmsbooking`)**:
   - Read-only legacy fallback database ensuring historical records remain searchable during migration windows.

### Automatic Failover & Circuit Breaker
If network or quota issues affect `bookingDb`, `getActiveBookingDb()` automatically switches to `getSecondaryBookingDb()` via an in-memory circuit breaker (`setBookingFailoverActive(true)`), logging a warning and maintaining service availability.

---

## 3. Appointment Booking Engine & Concurrency Guarantees

### A. Simultaneous Token Mutex Queue (`sequenceMutex`)
To prevent token collisions when multiple agents confirm bookings at the exact same millisecond:
- The next-token generator endpoint (`/api/appointments/next-token`) serializes incoming requests using a promised-based concurrency mutex (`sequenceMutex`).
- It executes a two-phase check:
  1. Scans Firestore `bookingDb` for active sequence counters.
  2. Inspects local records to determine the true historical maximum sequence.
- Monotonically increments the counter and writes back to disk/database before unlocking for the next request.

### B. Strictly Normalized 6-Digit Token Format
All tokens follow the canonical schema:
$$\text{ESI-}[0-9]{6}\text{-DISP}$$
- Zero padding (`padStart(6, "0")`) eliminates legacy 5-digit variations (e.g., `ESI-38108-DISP` $\rightarrow$ `ESI-038108-DISP`).
- Ensures clean chronological and lexical sorting across all admin and agent tables.

### C. Live Slot Conflict Detection & Auto-Bump (`findNextAvailableSlot`)
- Before committing any appointment, the client checks whether the chosen 3-minute slot has already been taken by another transaction.
- If a collision occurs at the exact millisecond of submission:
  - Rather than failing the booking, the engine calls `findNextAvailableSlot(...)`.
  - It locates the very next available working slot (respecting operating hours 09:00 AM – 01:00 PM and 02:00 PM – 05:00 PM on weekdays, and 09:00 AM – 01:00 PM on Saturdays, excluding Sundays).
  - Automatically updates the booking and notifies the agent with the assigned slot time.

### D. Google Sheets Master Register
- All confirmed bookings and status transitions are mirrored to the external Google Sheets master audit register via asynchronous server webhooks (`/api/google-sheets/record`).
- New bookings are prepended as brand new audit entries at the top; existing rows are only updated when an explicit status transition (Reception $\rightarrow$ Doctor $\rightarrow$ Pharmacy) is submitted for that exact token number.

---

## 4. Dispensary 3-Step Clinical Progression

Dispensaries follow a strict 3-stage clinical progression model:

```
+-----------------------------------------------------------------------------------+
| Stage 1: Reception Desk                                                           |
| Patient check-in, token slip generation, vitals recording (BP, Pulse, Temp).     |
| Status: "scheduled" -> "with_doctor"                                              |
+----------------------------------------+------------------------------------------+
                                         |
+----------------------------------------v------------------------------------------+
| Stage 2: Doctor OPD Desk                                                          |
| Medical examination, diagnosis, consultation type selection                       |
| (Medical Consultation, Sickness Certificate, Maternity Certificate, Referral),    |
| e-prescriptions, clinical notes.                                                  |
| Status: "with_doctor" -> "pharmacy_queue"                                         |
+----------------------------------------+------------------------------------------+
                                         |
+----------------------------------------v------------------------------------------+
| Stage 3: Pharmacy Desk                                                            |
| Medicine dispensation, batch verification, pharmacist dispensation notes.         |
| Status: "pharmacy_queue" -> "completed"                                           |
+-----------------------------------------------------------------------------------+
```

---

## 5. Deletion & Tombstone Synchronization

- **Role-Based Access Control**: Only authenticated Administrators have permission to permanently delete appointments.
- **Isolated Token Deletion**: Deletion targets only the explicit appointment token ID or doc ID. It never cascades to broad Case IDs (`CAxxxxxx`), ensuring sibling or historical consultations remain intact.
- **Tombstone Sync**: Deletions write a tombstone record to `system_sync/deletions` in Firestore and broadcast an `APPOINTMENT_DELETED` event via `BroadcastChannel`. Connected agent screens automatically purge the deleted record from active views without requiring a page reload.

---

## 6. Auto-Update & Versioning Mechanism

- Handled by `components/common/AppUpdateBanner.tsx` and `/api/version`.
- Uses strict Semantic Versioning (`isVersionNewer`).
- Compares remote version with `APP_BUILD_VERSION`.
- When an update is applied or dismissed, the version is saved to `localStorage.getItem("ekms_applied_version")`, permanently suppressing repeated update popups.
