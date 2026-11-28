# EKMS Maintenance & Validation Scripts

This directory contains utility, validation, and database maintenance scripts for the EKMS 3.0 platform.

## Structure

- **`maintenance/`**: Historical and operational diagnostic scripts used by administrators for Firestore sync audits and data restoration.
  - `audit_and_fix_appointments.js`: Audits discrepancies across Firestore appointment collections.
  - `check_all_dbs_appts.js`: Queries across `bookingDb`, `casesSettingsDb`, and `coreDb` to identify orphaned records.
  - `inspect_pending_docs.js`: Inspects pending queue records.
  - `list_users.js`: Lists registered admin and staff platform accounts.
  - `restore_appointments.js`: Safety restoration tool from local snapshots and logs.
  - `sync_old_visited_appointments.js`: Synchronizes historical visit timestamps into dispensary collections.

- **Root `scripts/`**: Shell and PowerShell automated test/validation pipelines for repo integrity, agent definitions, encoding, and workflows.
