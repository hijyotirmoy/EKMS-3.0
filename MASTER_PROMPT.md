# EKMS 3.0 — Master System Architecture & Operational Prompt

> **System Authority**: ESIC / ESIS Assam Knowledge & Dispensary Healthcare Management System (EKMS 3.0)  
> **Target Audience**: AI Agents, System Engineers, Technical Architects, DevOps, and Platform Administrators  
> **Revision**: 3.2.0 (November 2026)

---

## 1. Executive Summary & Mission

EKMS 3.0 is a mission-critical, high-availability healthcare consultation, dispensary workflow, and clinical triage management platform built for ESIS (Employees' State Insurance Scheme) dispensaries and empanelled facilities in Assam.

It serves 10,000+ field call center agents, medical officers, dispensary staff (receptionists, doctors, pharmacists), and administrative supervisors across 33+ ESIS dispensaries and 98+ empanelled healthcare facilities.

---

## 2. Enterprise Database Topology & Segregation

To prevent Firestore quota exhaustion (`RESOURCE_EXHAUSTED` / 50,000 free read limit), data corruption, or single-point-of-failure contention, EKMS 3.0 operates with a **strict database segregation topology**:

```
+--------------------------------------------------------------------------------------------------+
|                                    EKMS CLIENT & API LAYER                                       |
+--------------------------------------------------------------------------------------------------+
          |                              |                                |                       |
+---------v---------+          +---------v---------+            +---------v---------+   +---------v---------+
| 1. CORE EKMS DB   |          | 2. DISPENSARY     |            | 3. LOGS &         |   | 4. TRIAGE CASES & |
| (ekms-app)        |          |    BOOKING DB     |            |    NOTIFICATIONS  |   |    DHWANI CRM     |
|                   |          | (triage-booking)  |            | (ekms-logs)       |   | (triage-cases-    |
| Primary Auth,     |          |                   |            |                   |   |  settings)        |
| User Directory,   |          | Primary OPD Book- |            | Activity Logs,    |   |                   |
| 98 Facilities,    |          | ings & Schedules. |            | System Audit,     |   | Clinical Triage,  |
| Q&A, Protocols,   |          | Dual-mirrored to  |            | Notifications,    |   | Diagnostic Intake,|
| System Config.    |          | oldBookingDb for  |            | Broadcast Alerts. |   | Dhwani CRM Bridge.|
|                   |          | safety.           |            |                   |   |                   |
+-------------------+          +-------------------+            +-------------------+   +-------------------+
                                         |
                               +---------v---------+
                               | 5. REAL-TIME      |
                               |    GOOGLE SHEETS  |
                               | (Master Register) |
                               +-------------------+
```

### Database Responsibilities:
1. **Core EKMS DB (`ekms-app`)**:
   - Authentication & Session State (`auth`).
   - System settings, role permissions, and facility master directory (`facilities`, `users`, `knowledge_base`).
   - Client accessor: `getFirestoreDb()`, `getEkmsFirestoreDb()`.

2. **Primary Dispensary Booking DB (`triage-booking`)**:
   - All dispensary OPD appointments (`dispensary_appointments`, `appointments`).
   - Token sequence generator: `ESI-000001-DISP` to `ESI-999999-DISP`.
   - Dual-written to `ekmsbooking` (Secondary Safety Backup) on every create/update.
   - Client accessor: `getBookingDb()`, `getActiveBookingDb()`.

3. **System Logs & Notifications DB (`ekms-logs`)**:
   - `activity_logs`: User actions, logins, check-ins, prescriptions, dispensations.
   - `notifications`: User-targeted alerts and action reminders.
   - `announcements`: Official administrative broadcasts.
   - Client accessor: `logsDb`.

4. **Triage Cases, Settings & Dhwani CRM DB (`triage-cases-settings`)**:
   - Clinical intake records, audio logs, triage sessions, and case history.
   - External Dhwani CRM two-way bridge.
   - Client accessor: `casesSettingsDb`, `getCrmFirestoreDb()`.

5. **Auxiliary / Legacy Databases**:
   - `ekms-triage-main`: **Decommissioned & Eliminated**. All session and case functions are centralized in `triage-cases-settings` and `ekms-app`.

---

## 3. OPD Appointment Rules & Slot Scheduling

Dispensary OPD slots must strictly adhere to the following operational parameters:

- **Slot Interval**: Exactly **3 minutes** per consultation slot.
- **Slot Count**: Exactly **120 slots per day** (from `10:00 AM - 10:03 AM` to `03:57 PM - 04:00 PM`).
- **Operating Hours**:
  - **Monday to Saturday**: **10:00 AM to 04:00 PM** (Full operational day, all Saturdays 1st–5th open).
  - **Sunday**: **CLOSED** (`day === 0`). No bookings allowed.
  - **Lunch Break**: Continuous OPD operation without disruption.
- **Concurrency & Locking Rule**:
  - **Single Booking per Slot per Dispensary per Day**: Once booked, a slot is **Locked & Reserved**.
  - Subsequent booking attempts for the same slot on the same dispensary and date are blocked both client-side and server-side.
- **Sequential Token Format**:
  - `ESI-000001-DISP`, `ESI-000002-DISP`, ... `ESI-999999-DISP`.
  - Sequential tokens are tracked in `data/booking_sequence.json` and Firestore.
  - UI badges must display the raw token string (e.g., `ESI-000097-DISP`) without prepending redundant labels like `"Token: "`.

---

## 4. Dispensary 4-Stage Operational Lifecycle

Every appointment progresses through four distinct clinical stages:

```
+----------------------------------------------------------------------------------------------------+
|                                    APPOINTMENT STAGE PIPELINE                                      |
+----------------------------------------------------------------------------------------------------+
  [ 1. SCHEDULED ]
         |
         v (Patient arrives at dispensary)
  [ 2. CHECKED_IN ] --------> Checked in by Reception Desk (`receptionCheckInBy`, `receptionCheckInTime`)
         |
         v (Patient sent to OPD doctor)
  [ 3. WITH_DOCTOR ] -------> Doctor consults, writes clinical notes & Rx (`prescribedBy`, `prescribedTime`)
         |
         v (Patient moves to pharmacy)
  [ 4. MEDICINE_DISPENSED / VISITED ] -> Pharmacist dispenses medicines (`dispensedBy`, `dispensedTime`)
```

### Stage Resolution Protocol (`getEffectiveAppointmentStage`):
To prevent data race conditions or inconsistent UI badges:
- If `dispensedBy` or `dispensedTime` is present -> Stage is **`medicine_dispensed` / `visited`** (`VISIT COMPLETED`).
- Else if `prescribedBy` or `doctorNotes` is present -> Stage is **`with_doctor`**.
- Else if `receptionCheckInBy` or `receptionCheckInTime` is present -> Stage is **`checked_in`**.
- Else -> Stage is **`scheduled`** (`UPCOMING`).

---

## 5. Google Sheets Master Register Integration

- **Spreadsheet ID**: `1be-yMMFGcXJToYbQI3KJnadURgjWeGncGmxGbJzFLso`
- **Synchronization Policy**:
  - **Newest First**: Rows are sorted with the latest booking at the top.
  - **Non-Destructive Overwrites**: An existing appointment row is updated in-place (updating stage, reception staff, doctor notes, pharmacy dispensation) without duplicating or clearing records.
  - **Local Mirror**: Stored persistently at `data/google_sheets_records.json`.

---

## 6. Coding Standards & Error Handling Directives

1. **Path Standardization**:
   - Reference local persistent data from `data/` (e.g. `data/booking_sequence.json`, `data/facilities_cache.json`). Never re-create `src/data`.
2. **Safe API Handlers**:
   - All Next.js route handlers (`app/api/**/route.ts`) must wrap logic in `try/catch` and return uniform JSON:
     ```ts
     return NextResponse.json({ success: true, data: ... }, { status: 200, headers: corsHeaders() });
     // On error:
     return NextResponse.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders() });
     ```
3. **CORS Headers**:
   - Always supply standard CORS headers (`Access-Control-Allow-Origin: *`, methods: `GET, POST, PUT, DELETE, OPTIONS`) on API routes to support cross-origin dispensary requests.
4. **Git Push Rule**:
   - **STRICT PROHIBITION**: Never execute `git push` or trigger remote CI/CD deployment without explicit instruction from the project owner.
