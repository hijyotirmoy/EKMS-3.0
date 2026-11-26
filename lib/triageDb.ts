import facilitiesCacheData from "@/data/facilities_cache.json";
import { db } from "@/lib/firebase";
import { collection, getDocs } from "firebase/firestore";

let memoryFacilities: any[] = Array.isArray(facilitiesCacheData) && facilitiesCacheData.length > 0 ? facilitiesCacheData : [];
let isFetchedFromFirestore = memoryFacilities.length > 0;

export function getCachedFacilities(): any[] {
  return memoryFacilities;
}

export async function getFacilities(): Promise<any[]> {
  if (isFetchedFromFirestore && memoryFacilities.length > 0) {
    return memoryFacilities;
  }

  try {
    const snap = await getDocs(collection(db, "facilities"));
    if (!snap.empty) {
      const list = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          facility_type: data.type || data.facility_type || "Facility",
          latitude: typeof data.lat === "number" ? data.lat : (typeof data.latitude === "number" ? data.latitude : null),
          longitude: typeof data.lng === "number" ? data.lng : (typeof data.longitude === "number" ? data.longitude : null),
        };
      });
      if (list.length > 0) {
        memoryFacilities = list;
        isFetchedFromFirestore = true;
        return memoryFacilities;
      }
    }
  } catch (err: any) {
    console.warn("Firestore facilities load notice, using local seed:", err?.message);
  }

  return memoryFacilities;
}
