import { NextResponse } from "next/server";
import { processDoctorConsultationTurn, buildLocalDoctorConsultationFallback } from "@/lib/doctorChatEngine";
import { getFacilities, getCachedFacilities } from "@/lib/triageDb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  let inputPrompt = "";
  let history: any[] = [];
  let state: any = {};

  try {
    const body = await request.json();
    inputPrompt = body.prompt || body.message || body.text;

    if (!inputPrompt || typeof inputPrompt !== "string" || inputPrompt.trim().length === 0) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    history = body.history || [];
    const currentClinicalState = body.currentClinicalState || body.clinicalState || {};
    const currentTriage = body.currentTriage || {};

    let facilities = getCachedFacilities();
    if (!facilities || facilities.length === 0) {
      try {
        facilities = await getFacilities();
      } catch (e) {
        facilities = [];
      }
    }

    state = {
      ...currentTriage,
      ...currentClinicalState,
      facilities,
    };

    const doctorResult: any = await (processDoctorConsultationTurn as any)({
      message: inputPrompt,
      history,
      currentClinicalState: state,
      facilities,
    });

    return NextResponse.json({
      probingQuestion: doctorResult.probingQuestion,
      agentScript: doctorResult.probingQuestion,
      answer: doctorResult.probingQuestion,
      options: doctorResult.suggestedAnswers,
      suggestedAnswers: doctorResult.suggestedAnswers,
      isSystemInbuiltFallback: Boolean(doctorResult.isSystemInbuiltFallback),
      apiLimitReached: Boolean(doctorResult.isSystemInbuiltFallback),
      suspectedCondition: doctorResult.suspectedCondition,
      differentialDiagnosis: doctorResult.differentialDiagnosis,
      severity: doctorResult.severity,
      severityScore: doctorResult.severityScore,
      duration: doctorResult.duration,
      comorbidity: doctorResult.comorbidity || doctorResult.comorbidities || "None reported",
      comorbidities: doctorResult.comorbidities || doctorResult.comorbidity || "None reported",
      allergies: doctorResult.allergies,
      medication: doctorResult.medication,
      medications: doctorResult.medications,
      redFlagsDetected: doctorResult.redFlagsDetected,
      referralDestination: doctorResult.referralDestination,
      referralReason: doctorResult.referralReason,
      isPsychiatric: doctorResult.isPsychiatric,
      is_dual_protocol: doctorResult.is_dual_protocol || false,
      call_referral_secondary: doctorResult.call_referral_secondary || null,
      clinicalSummary: doctorResult.clinicalSummary,
      isReadyForSummary: doctorResult.isReadyForSummary,
      isReferralReady: doctorResult.isReferralReady || doctorResult.isReadyForSummary,
      initialChiefComplaint: doctorResult.initialChiefComplaint || state.initialChiefComplaint || null,
      detectedLocation: doctorResult.detectedLocation || null,
      nearestFacility: doctorResult.nearestFacility || null,
      triageSummary: {
        symptom: state.symptom || doctorResult.suspectedCondition,
        condition: doctorResult.suspectedCondition,
        initialChiefComplaint: doctorResult.initialChiefComplaint || state.initialChiefComplaint || null,
        severity: doctorResult.severity,
        duration: doctorResult.duration,
        comorbidity: doctorResult.comorbidity || doctorResult.comorbidities || "None reported",
        allergies: doctorResult.allergies,
        medication: doctorResult.medication || doctorResult.medications,
        associated: doctorResult.redFlagsDetected,
        referralDestination: doctorResult.referralDestination,
        isPsychiatric: doctorResult.isPsychiatric,
        detectedLocation: doctorResult.detectedLocation || null,
        facility: doctorResult.nearestFacility || null,
      },
      decision: { condition: doctorResult.suspectedCondition },
    });
  } catch (err: any) {
    console.error("Doctor Chat API error:", err);
    const isRateLimit = Boolean(
      err?.status === 429 ||
      err?.message?.includes("429") ||
      err?.message?.includes("rate limit") ||
      err?.message?.includes("exhausted")
    );

    try {
      const fallback: any = buildLocalDoctorConsultationFallback(inputPrompt, history, state);
      return NextResponse.json({
        probingQuestion: fallback.probingQuestion,
        agentScript: fallback.probingQuestion,
        answer: fallback.probingQuestion,
        options: fallback.suggestedAnswers,
        suggestedAnswers: fallback.suggestedAnswers,
        isSystemInbuiltFallback: isRateLimit,
        apiLimitReached: isRateLimit,
        suspectedCondition: fallback.suspectedCondition,
        severity: fallback.severity,
        severityScore: fallback.severity === "High" ? 9 : 5,
        duration: fallback.duration || "Reported today",
        comorbidity: fallback.comorbidity || fallback.comorbidities || "None reported",
        comorbidities: fallback.comorbidities || fallback.comorbidity || "None reported",
        allergies: fallback.allergies || "None",
        medication: fallback.medication || fallback.medications || "None",
        medications: fallback.medications || fallback.medication || "None",
        redFlagsDetected: fallback.redFlagsDetected || [],
        referralDestination: fallback.referralDestination,
        referralReason: fallback.referralReason,
        isPsychiatric: fallback.isPsychiatric,
        is_dual_protocol: fallback.is_dual_protocol || false,
        call_referral_secondary: fallback.call_referral_secondary || null,
        clinicalSummary: fallback.clinicalSummary || "Clinical consultation in progress.",
        isReadyForSummary: fallback.isReadyForSummary || false,
        isReferralReady: fallback.isReferralReady || fallback.isReadyForSummary || false,
        initialChiefComplaint: fallback.initialChiefComplaint || state.initialChiefComplaint || null,
        detectedLocation: fallback.detectedLocation || null,
        nearestFacility: fallback.nearestFacility || null,
        triageSummary: {
          symptom: state.symptom || fallback.suspectedCondition,
          condition: fallback.suspectedCondition,
          initialChiefComplaint: fallback.initialChiefComplaint || state.initialChiefComplaint || null,
          severity: fallback.severity,
          duration: fallback.duration || "Reported today",
          comorbidity: fallback.comorbidity || fallback.comorbidities || "None reported",
          allergies: fallback.allergies || "None",
          medication: fallback.medication || fallback.medications || "None",
          associated: fallback.redFlagsDetected || [],
          referralDestination: fallback.referralDestination,
          isPsychiatric: fallback.isPsychiatric,
          detectedLocation: fallback.detectedLocation || null,
          facility: fallback.nearestFacility || null,
        },
        decision: { condition: fallback.suspectedCondition },
      }, { status: 200 });
    } catch (fallbackErr: any) {
      console.error("Local fallback fatal error:", fallbackErr);
      return NextResponse.json({
        probingQuestion: 'Ask the IP: "Could you please describe where you are feeling pain or discomfort and what symptoms you are experiencing?" (Hinglish: "Kripya batayein aapko kahan dard ya takleef mehsoos ho rahi hai aur kya lakshan hain?")',
        agentScript: 'Ask the IP: "Could you please describe where you are feeling pain or discomfort and what symptoms you are experiencing?" (Hinglish: "Kripya batayein aapko kahan dard ya takleef mehsoos ho rahi hai aur kya lakshan hain?")',
        answer: 'Ask the IP: "Could you please describe where you are feeling pain or discomfort and what symptoms you are experiencing?" (Hinglish: "Kripya batayein aapko kahan dard ya takleef mehsoos ho rahi hai aur kya lakshan hain?")',
        options: ["Pain in chest / breathing trouble", "Injury / wound / severe pain", "Stomach ache / nausea / fever", "Dizziness / general weakness"],
        suggestedAnswers: ["Pain in chest / breathing trouble", "Injury / wound / severe pain", "Stomach ache / nausea / fever", "Dizziness / general weakness"],
        isSystemInbuiltFallback: false,
        apiLimitReached: false,
      }, { status: 200 });
    }
  }
}
