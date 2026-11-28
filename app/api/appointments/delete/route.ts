import { NextResponse } from "next/server";
import { doc, deleteDoc, getDocs, getDoc, setDoc, query, collection, where } from "firebase/firestore";
import { getFirestoreDb, getBookingDb, getOldBookingDb, getCrmFirestoreDb } from "@/lib/firebase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

async function handleDelete(request) {
  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const { searchParams } = new URL(request.url);
    const queryId = searchParams.get("id");
    const queryToken = searchParams.get("tokenNo") || searchParams.get("token") || searchParams.get("referenceNo");

    const rawIdentifiers = [
      body.id,
      body.tokenNo,
      body.referenceNo,
      queryId,
      queryToken,
      ...(Array.isArray(body.tokens) ? body.tokens : []),
      ...(Array.isArray(body.ids) ? body.ids : []),
    ].filter(Boolean);

    const allIdentifiers = Array.from(new Set(rawIdentifiers.map((v) => String(v).trim()).filter(Boolean)));

    if (allIdentifiers.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "No appointment identifier provided. Please pass id, tokenNo, referenceNo, tokens, or ids.",
        },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Collect all database instances
    const databases = [];
    try {
      const bDb = getBookingDb();
      if (bDb) databases.push({ name: "bookingDb", db: bDb });
    } catch (e) {
      console.warn("bDb init notice:", e.message);
    }

    try {
      const oldBDb = getOldBookingDb();
      if (oldBDb) databases.push({ name: "oldBookingDb", db: oldBDb });
    } catch (e) {
      console.warn("oldBDb init notice:", e.message);
    }

    try {
      const crmDb = getCrmFirestoreDb();
      if (crmDb) databases.push({ name: "crmDb", db: crmDb });
    } catch (e) {
      console.warn("crmDb init notice:", e.message);
    }

    try {
      const coreDb = getFirestoreDb();
      if (coreDb) databases.push({ name: "coreDb", db: coreDb });
    } catch (e) {
      console.warn("coreDb init notice:", e.message);
    }

    const targetCollections = ["dispensary_appointments", "appointments"];
    let deletedCount = 0;

    for (const ident of allIdentifiers) {
      const sanitized = ident.replace(/[^a-zA-Z0-9_-]/g, "_");
      const docIds = Array.from(new Set([ident, sanitized]));

      for (const { db } of databases) {
        for (const col of targetCollections) {
          // 1. Direct doc deletion
          for (const dId of docIds) {
            try {
              await deleteDoc(doc(db, col, dId));
              deletedCount++;
            } catch (err) {
              // Ignore non-existent document errors
            }
          }

          // 2. Query by tokenNo
          try {
            const qToken = query(collection(db, col), where("tokenNo", "==", ident));
            const snapToken = await getDocs(qToken);
            for (const d of snapToken.docs) {
              try {
                await deleteDoc(d.ref);
                deletedCount++;
              } catch (e) {}
            }
          } catch (e) {}

          // 3. Query by referenceNo
          try {
            const qRef = query(collection(db, col), where("referenceNo", "==", ident));
            const snapRef = await getDocs(qRef);
            for (const d of snapRef.docs) {
              try {
                await deleteDoc(d.ref);
                deletedCount++;
              } catch (e) {}
            }
          } catch (e) {}

          // 4. Query by id property if stored inside doc
          try {
            const qId = query(collection(db, col), where("id", "==", ident));
            const snapId = await getDocs(qId);
            for (const d of snapId.docs) {
              try {
                await deleteDoc(d.ref);
                deletedCount++;
              } catch (e) {}
            }
          } catch (e) {}
        }
      }
    }

    // 5. Update system_sync/deletions and tombstone collection across all databases
    // This instantly notifies all connected agent clients in real-time across devices!
    for (const { db } of databases) {
      try {
        const syncDocRef = doc(db, "system_sync", "deletions");
        const currentSnap = await getDoc(syncDocRef).catch(() => null);
        let existingKeys = [];
        if (currentSnap && currentSnap.exists()) {
          const d = currentSnap.data();
          existingKeys = Array.isArray(d.keys) ? d.keys : [];
        }
        const combinedKeys = Array.from(new Set([...existingKeys, ...allIdentifiers])).slice(-1000);
        await setDoc(
          syncDocRef,
          {
            keys: combinedKeys,
            latestDeleted: allIdentifiers,
            updatedAt: Date.now(),
          },
          { merge: true }
        );

        // Also record individual tombstone records
        for (const ident of allIdentifiers) {
          const sanitized = ident.replace(/[^a-zA-Z0-9_-]/g, "_");
          await setDoc(
            doc(db, "deleted_appointments", sanitized),
            {
              identifier: ident,
              deletedAt: Date.now(),
            },
            { merge: true }
          ).catch(() => {});
        }
      } catch (syncErr) {
        console.warn("Notice updating system_sync/deletions:", syncErr?.message || syncErr);
      }
    }

    return NextResponse.json(
      {
        success: true,
        message: `Successfully deleted appointment(s) and broadcast tombstone to all agent systems.`,
        identifiers: allIdentifiers,
        deletedOperations: deletedCount,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("Error deleting appointment from Triage database:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to delete appointment from Triage database" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function POST(request) {
  return handleDelete(request);
}

export async function DELETE(request) {
  return handleDelete(request);
}
