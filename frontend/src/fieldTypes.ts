import type { Level } from "./types";

export type ReportStatus = "NEW" | "UNDER REVIEW" | "NEEDS FIELD VISIT" | "VERIFIED" | "FALSE REPORT";
export const REPORT_STATUSES: ReportStatus[] = ["NEW", "UNDER REVIEW", "NEEDS FIELD VISIT", "VERIFIED", "FALSE REPORT"];
export type Category = "fire" | "deforestation" | "other";
export const CATEGORY_LABEL: Record<Category, string> = { fire: "Fire", deforestation: "Deforestation / tree felling", other: "Other" };

export interface Bbox { south: number; north: number; west: number; east: number }

export interface CitizenReport { id: number; category: Category; note: string; lat: number; lon: number; created: number; status: string; photo_url: string }

export interface FieldSummary { id: number; category: Category; lat: number; lon: number; created: number; status: ReportStatus; reporter_name: string; username: string;
  priority_level: Level; priority_score: number; ai_status: "PENDING" | "DONE" | "FAILED"; credibility: string | null; note_preview: string }

export interface AiCheck {
  photo_observations: string[]; photo_quality: string; photo_matches_reported_category: string; credibility: string; summary: string;
  evidence_for: string[]; evidence_against: string[]; contradictions: string[]; unknowns: string[]; legality_note: string; confirmed: false;
  recommended_action: string; officer_alert: { headline: string; message_en: string; message_ta: string };
  citizen_reply: { message_en: string; message_ta: string }; guard_flags: string[];
}

interface Layer { status: "ok" | "unavailable" | "not_covered" | "error"; message?: string }
export interface FieldDetail extends FieldSummary {
  note: string; accuracy_m: number | null; client_time: string | null; updated: number; officer_notes: string; reviewed_by: string | null;
  photo_url: string; legality: string; label: string; ai: AiCheck | null; ai_error: string | null; ai_model: string | null;
  priority_reasons: { reasons: string[]; not_triggered: string[]; rule: string };
  checks: {
    nearest_observations: { incident_id: string; distance_km: number; risk_level: Level; ml_probability: number; thermal_signal: boolean; vegetation_anomaly: boolean }[];
    elevated_observation_within_3km: { incident_id: string; risk_level: Level; distance_km: number } | null;
    fire_detections: Layer & { coverage?: string[]; detections_within_10km?: number; recent_within_5km_72h?: boolean;
      nearest?: { distance_km: number; detected_utc: string; hours_before_report: number; confidence: string } | null };
    reserve_boundary: Layer & { inside?: boolean; name?: string | null };
    tree_cover_loss: Layer; weather: Layer; base_imagery: Layer;
    other_reports_nearby: { distinct_other_reporters: number; radius_m: number; window_hours: number };
    photo: { has_exif: boolean; exif_time: string | null; exif_geotag_vs_reported: { distance_km: number; consistent: boolean } | null; reported_accuracy_m: number | null; note: string };
  };
}
