export type Level = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
export interface Feats { NDVI: number; NBR: number; VV: number; VH: number; Fire_Brightness: number; Temperature: number; Rainfall: number; Forest: number }
export interface Ml { probability: number; predicted_class: number; disturbance_detected: boolean; threshold: number; trees: number }
export interface Risk {
  score: number; max_score: number; level: Level; reasons: string[]; not_triggered: string[]; rule: string;
  signals: { ml_detected: boolean; thermal_signal: boolean; vegetation_anomaly: boolean };
  points: Record<string, number>; z: { NDVI: number | null; NBR: number | null };
}
export interface Incident {
  id: string; title: string; location: string; cluster: string; lat: number; lon: number; csv_row_number: number; system_index: string;
  features: Feats; ml: Ml; csv_disturbance_probability: number; risk: Risk; tags: string[]; status: string; ml_assessment: string; data_mode: string;
  ai_investigated?: boolean;
}
export interface Signal { key: keyof Feats; label: string; value: number; unit: string; unit_note: string; sample_median?: number; sample_min?: number; sample_max?: number; robust_z?: number | null }
export interface Evidence {
  signals: Signal[]; derived: { Temperature_celsius: number };
  vegetation: { reference_value: string; current_value: string; change: string; spatial_context: { NDVI: any; NBR: any; note: string } };
  fire: { thermal_signal_present: boolean; fire_brightness_K: number; threshold_K: number; label: string; confirmed: boolean; confidence_or_frp: string; shared_value_points: number };
  community: { status: string }; data_gaps: string[];
}
export interface Investigation { id: number; scenario: string; result: Record<string, any>; model: string; created: number }
export interface Alert {
  incident_id: string; tier: string; level: Level; headline: string; location: string; lat: number; lon: number;
  supporting_evidence: string[]; potential_concern: string; community: string; recommended_action: string; data_mode: string;
}
export interface IncidentDetail extends Incident {
  evidence: Evidence; investigations: Record<string, Investigation>; chat: { role: string; content: string }[]; alert: Alert | null;
}
export interface Observation {
  row: number; csv_row_number: number; system_index: string; lat: number; lon: number; cluster: string; features: Feats; ml: Ml;
  csv_disturbance_probability: number; risk_level: Level; signals: Risk["signals"]; incident_id: string | null; status: string | null;
}
export interface Dashboard {
  observations: number; ml_detected: number; ml_threshold: number; ml_prob_max: number; ml_prob_min: number; ml_prob_mean: number;
  csv_prob_max: number; csv_vs_model_max_abs_diff: number; incidents: number; by_risk: Record<Level, number>;
  thermal_signal: number; vegetation_anomaly: number; non_forest: number; under_investigation: number; reviewed: number; ai_investigated: number;
  model: { type: string; n_estimators: number; classes: number[]; features: string[]; feature_importances: Record<string, number>; sklearn_version_warning: string | null; class_meaning_note: string };
  data_mode: string; study_area: string; priority: Incident[];
  demo_records: Record<string, { incident_id: string; rule: string }>;
}
export interface ReportSection { n: number; title: string; kind: "data" | "ai"; body: string; note?: string; table?: { name: string; value: string; unit: string }[]; gaps?: string[] }
export interface Report { id: number; incident_id: string; created: number; body: { title: string; generated: string; mode: string; ai_generated: boolean; ai_model: string | null; sections: ReportSection[]; confidence: string } }
