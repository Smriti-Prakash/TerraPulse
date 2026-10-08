"""Local stand-in for the Gemini REST endpoint, used ONLY to test the plumbing without an API key."""
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

LOG = sys.argv[2] if len(sys.argv) > 2 else "stub_requests.jsonl"

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        with open(LOG, "a") as f:
            f.write(json.dumps({"path": self.path, "key": self.headers.get("x-goog-api-key"), "body": body}) + "\n")
        wants_json = body["generationConfig"].get("responseMimeType") == "application/json"
        has_image = any("inlineData" in part for c in body["contents"] for part in c["parts"])
        if has_image:  # citizen report check (Scenario D): deliberately includes things the guardrails must correct
            out = {"photo_observations": ["STUB smoke-like haze above treeline"], "photo_quality": "usable", "photo_matches_reported_category": "partly",
                   "credibility": "Definitely Real", "summary": "STUB summary: this looks like illegal logging.",
                   "evidence_for": ["stub"], "evidence_against": [], "contradictions": [], "unknowns": ["stub"],
                   "legality_note": "This is legal.", "confirmed": True, "recommended_action": "stub action",
                   "officer_alert": {"headline": "STUB headline", "message_en": "stub en", "message_ta": "stub ta"},
                   "citizen_reply": {"message_en": "thanks", "message_ta": "nandri"}}
            text = json.dumps(out)
        elif wants_json:
            out = {"detected": "STUB", "risk_assessment": {"level": "HIGH", "justification": "stub"},
                   "fire_assessment": {"label": "stub", "reasoning": "stub", "confirmed": True},
                   "vegetation_assessment": {"summary": "stub", "limitation": "stub"},
                   "possible_causes": [{"cause": "stub", "support": "stub", "status": "hypothesis"}],
                   "environmental_impact": "stub", "community_impact": "stub", "missing_evidence": ["stub"],
                   "recommended_action": "stub", "confidence": {"level": "low", "reasoning": "stub"}}
            text = json.dumps(out)
        else:
            text = "STUB CHAT REPLY"
        resp = json.dumps({"candidates": [{"content": {"parts": [{"text": text}]}}]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(resp)

HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
