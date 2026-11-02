"""Plain-language investigation report for forest officers.

Every sentence in the summary is either built from the data files and the model output, or taken from the AI investigation
(and then screened). Detailed numbers live in the appendix, not in the summary."""
from __future__ import annotations

import re
import time
from typing import Any

from . import compare, config, db, layers
from .core import COMMUNITY_STATEMENT, DATA_GAPS, FEATURE_META, FEATURES, RISK_RULE, UNAVAILABLE, engine

MODE = "HISTORICAL DATA DEMONSTRATION — not a live feed"
AI_NOT_RUN = "The AI investigation has not been run for this incident yet, so this summary uses only the data and the model."
# AI sentences that claim a fire or a legal finding are dropped from the summary (they stay visible in the incident page, flagged).
_OVERCLAIM = re.compile(r"(?<!not )(?<!un)confirmed\s+(fire|burn|blaze|deforest|clearing)|\billegal(ly)?\b|\bunlawful(ly)?\b|\barson\b|\bencroach", re.I)


def _ord(n: int) -> str:
    if n == 1:
        return "the lowest"
    suf = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"the {n}{suf} lowest"


def _flat(v: Any) -> list[str]:
    if v is None or v == "":
        return []
    if isinstance(v, str):
        return [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z])", v) if s.strip()]
    if isinstance(v, list):
        return [t for x in v for t in _flat(x)]
    if isinstance(v, dict):
        return [t for k, x in v.items() for t in _flat(x) if t]
    return [str(v)]


def _ai_items(v: Any, n: int, dropped: list[int], maxlen: int = 240) -> list[str]:
    """Short, screened sentences from an AI field."""
    out = []
    for s in _flat(v):
        if _OVERCLAIM.search(s):
            dropped[0] += 1
            continue
        out.append(s if len(s) <= maxlen else s[: maxlen].rsplit(" ", 1)[0] + "…")
        if len(out) >= n:
            break
    return out


def _sec(key: str, title: str, paragraphs: list[str] | None = None, bullets: list[str] | None = None, numbered: list[str] | None = None, note: str | None = None) -> dict[str, Any]:
    return {"key": key, "title": title, "paragraphs": paragraphs or [], "bullets": bullets or [], "numbered": numbered or [], "note": note}


def build(rec: dict[str, Any], v: dict[str, Any], ev: dict[str, Any]) -> dict[str, Any]:
    iid, f, ml, risk = rec["incident_id"], rec["features"], rec["ml"], rec["risk"]
    invs = db.latest_investigations(iid)
    a = (invs.get("investigate") or {}).get("result")
    ai_model = (invs.get("investigate") or {}).get("model")
    dropped = [0]
    cmp_ = compare.compare_incident(rec)
    ranks, n_all = cmp_["ranks"], cmp_["ranks"]["of"]
    sig = risk["signals"]
    thermal, veg, ml_on = bool(sig["thermal_signal"]), bool(sig["vegetation_anomaly"]), bool(ml["disturbance_detected"])
    level = risk["level"].lower()
    place = layers.place_name(rec["lat"], rec["lon"])
    where = f"near {place} " if place else ""

    # 1 ------------------------------------------------------------ what was observed
    cluster = re.sub(r"\s*\(.*?\)", "", rec["cluster"])
    obs = [f"A satellite reading {where}at {rec['lat']:.4f}°N, {rec['lon']:.4f}°E ({cluster}) was flagged for review."]
    obs.append(f"Vegetation greenness (NDVI) is {f['NDVI']:.2f}, {_ord(ranks['ndvi_lowest_rank'])} of the {n_all} points in the evidence file. Low greenness can mean sparse or stressed vegetation.")
    if thermal:
        obs.append(f"The heat reading is {f['Fire_Brightness']:.0f} K, above the {config.THERMAL_THRESHOLD_K:.0f} K screening level. This is a satellite heat reading. It is not a confirmed fire.")
    else:
        obs.append(f"The heat reading is {f['Fire_Brightness']:.0f} K, below the {config.THERMAL_THRESHOLD_K:.0f} K screening level.")
    if not int(f["Forest"]):
        obs.append("The file does not mark this point as forest.")
    obs.append("The evidence file has no dates, so we cannot say when this was observed.")

    # 2 ------------------------------------------------------------ why it was flagged
    why = []
    if thermal:
        why.append("The heat reading is above the screening level.")
    if veg:
        why.append("Greenness and moisture are lower than at most other points in the file.")
    why.append(f"The Random Forest model scored this point {ml['probability']:.2f} out of 1. It marks possible disturbance at {config.ML_THRESHOLD} or above, so it {'did' if ml_on else 'did not'} mark this point. The model looks for forest disturbance in general. It is not a fire detector.")
    if not thermal and not veg and not ml_on:
        why.append("None of the three checks was raised. The point may be here for comparison.")
    why_p = [f"Together these give a {level} priority ({risk['score']} of {risk.get('max_score', 4)} checks raised). The priority only ranks places for field checks. It is not a finding."]

    # 3 ------------------------------------------------------------ what the evidence suggests
    k = sum([thermal, veg, ml_on])
    verdict = ["Nothing in the file stands out strongly.", "Only one of the three indicators is raised, so the evidence is weak.",
               "Two of the three indicators are raised. This is worth a field check but it is not conclusive.",
               "All three indicators are raised. A disturbance is more likely, but the data cannot show the cause or whether a fire happened."][k]
    ctx: list[str] = []
    cr = cmp_["citizen_reports_nearby"]
    ctx.append(f"{cr['count']} citizen report{'s' if cr['count'] != 1 else ''} within {cr['radius_km']:g} km (unverified)." if cr["count"] else f"No citizen reports within {cr['radius_km']:g} km.")
    fh = cmp_["fire_history"]
    if fh.get("status") == "ok":
        yrs = ", ".join(f"{y}: {c}" for y, c in fh["by_year"].items())
        ctx.append(f"NASA FIRMS satellite detections within {fh['radius_km']:g} km: {fh['total']} in total ({yrs}). No detection does not prove there was no fire.")
    else:
        ctx.append(f"Satellite fire detections: {fh.get('message') or UNAVAILABLE}.")
    h = layers.hansen_check(rec["lat"], rec["lon"], 1.0)
    if h.get("status") == "ok":
        ctx.append(("Hansen tree-cover loss was recorded within 1 km in " + ", ".join(str(y) for y in h["loss_years"]) + ". This supports a closer look. It does not say what caused it.") if h.get("loss_years") else "Hansen data records no tree-cover loss within 1 km.")
    else:
        ctx.append(f"Tree-cover loss history: {h.get('message') or UNAVAILABLE}.")
    if cmp_["nearest"]:
        nn = cmp_["nearest"][0]
        ctx.append(f"The closest other recorded point is {nn['incident_id']}, {nn['distance_km']} km away ({nn['risk_level'].lower()} risk).")
    if a:
        ctx += ["AI hypothesis, not a finding: " + t for t in _ai_items(a.get("fire_assessment"), 1, dropped) + _ai_items(a.get("vegetation_assessment"), 1, dropped) + _ai_items(a.get("possible_causes"), 2, dropped)]

    # 4 ------------------------------------------------------------ what is uncertain
    unsure = ["When this was observed. The file has no dates.",
              "Whether greenness has changed. The file compares this point with other points, not with its own past, so it does not show vegetation loss over time.",
              "Whether there was a fire. The file has no detection confidence or fire power, and a heat reading alone cannot show a fire.",
              "What caused it. Nothing has been checked on the ground yet."]
    if a:
        unsure += _ai_items(a.get("missing_evidence"), 3, dropped)
    conf = _ai_items(a.get("confidence"), 2, dropped) if a else []

    # 5 ------------------------------------------------------------ impact
    env = ["The data cannot show the effect on the environment. That depends on what is found on the ground."]
    if a:
        env += ["The AI suggests (a hypothesis): " + s for s in _ai_items(a.get("environmental_impact"), 2, dropped)]
    nb = layers.nearby(rec["lat"], rec["lon"], 5.0)
    if nb.get("status") == "ok":
        near = []
        for kind, lab in (("settlement", "settlement"), ("school", "school"), ("water", "water source"), ("road", "road")):
            c = nb[kind]
            if c["count"]:
                nm = c["nearest"][0]
                near.append(f"{c['count']} {lab}{'s' if c['count'] != 1 else ''} (nearest: {nm['name'] or 'unnamed'}, {nm['distance_km']} km)")
        com = [("Within 5 km: " + "; ".join(near) + ".") if near else "No mapped settlements, schools, water sources or roads within 5 km.",
               "This shows what is nearby, not who is at risk. Map coverage in forest areas can be incomplete, so counts are a minimum."]
    else:
        com = [COMMUNITY_STATEMENT, f"Nearby places: {nb.get('message') or UNAVAILABLE}."]

    # 6 ------------------------------------------------------------ next steps
    steps: list[str] = []
    if a:
        steps += _ai_items(a.get("recommended_action"), 1, dropped, 300) + _ai_items(a.get("verification_checklist"), 3, dropped, 200)
    defaults = ["Visit the point. Record ground condition, burn marks or cut stumps, with photos and GPS.",
                "Compare with dated satellite images from earlier dry seasons.",
                "Record who was contacted and what they said."]
    legal = "Check the working plan, permits and felling records for this compartment. The forest department decides whether anything was illegal. This report does not."
    steps += [legal] + (defaults if len(steps) < 3 else [])
    if cr["count"]:
        steps.append("Check the nearby citizen reports against what you find at this point.")
    seen, uniq = set(), []
    for t in steps:
        key = re.sub(r"\W+", " ", t.lower())[:40]
        if key not in seen:
            seen.add(key); uniq.append(t)
    steps = uniq[:6]

    summary = [
        _sec("observed", "What was observed", obs),
        _sec("why", "Why it was flagged", why_p, why),
        _sec("suggests", "What the evidence suggests", [verdict], ctx),
        _sec("uncertain", "What is still uncertain", ["How sure the AI is: " + conf[0]] if conf else ([] if a else [AI_NOT_RUN]), unsure),
        _sec("impact", "Possible environmental and community impact", [], env + com),
        _sec("next", "Recommended next steps", [], numbered=steps),
    ]

    # appendix ------------------------------------------------------------------------------------------------
    app: list[dict[str, Any]] = [
        {"title": "Detection evidence", "paragraphs": ["Values exactly as supplied in the evidence file. Units are inferred where the file does not state them."],
         "table": {"cols": ["Value", "Reading", "Unit"], "rows": [[FEATURE_META[x]["label"], f"{f[x]:g}", FEATURE_META[x]["unit"]] for x in FEATURES]}},
        {"title": "Model output", "paragraphs": [
            f"Random Forest (TerraPulse_RF_200, 200 trees): disturbance probability {ml['probability']:.3f}, threshold {config.ML_THRESHOLD}, disturbance detected: {'yes' if ml_on else 'no'}.",
            f"The evidence file also carries its own probability ({rec['csv_disturbance_probability']:.3f}). It comes from an unverified pipeline and does not match the model, so it is not used."]},
        {"title": "Risk rule", "paragraphs": [f"{risk['level']}, score {risk['score']} of {risk.get('max_score', 4)}. " + " ".join(risk["reasons"] + risk["not_triggered"]), "Rule: " + RISK_RULE["summary"]]},
        {"title": "How this point ranks among all recorded points", "paragraphs": cmp_["summary"],
         "table": {"cols": ["Closest points", "Distance (km)", "Risk", "RF probability", "NDVI", "NBR"],
                   "rows": [[r["incident_id"], str(r["distance_km"]), r["risk_level"], f"{r['ml_probability']:.3f}", f"{r['ndvi']:.3f}", f"{r['nbr']:.3f}"] for r in cmp_["nearest"]]}},
        {"title": "Data not available in this prototype", "bullets": DATA_GAPS},
        {"title": "Sources", "paragraphs": ["TerraPulse_Forest_Disturbance_Evidence.csv (historical, undated); TerraPulse_RF_200.joblib (Random Forest); NASA FIRMS, OpenStreetMap and Hansen files where loaded; "
                                           + (f"Google Gemini ({ai_model}) for the AI wording, grounded on the evidence above." if a else "no AI investigation run yet.")]},
    ]
    if a:
        full = [{"title": t, "body": " ".join(_flat(a.get(k_)))} for k_, t in (("detected", "What was detected"), ("why_flagged", "Why flagged"), ("fire_assessment", "Fire-related assessment"),
                                                                              ("vegetation_assessment", "Vegetation assessment"), ("possible_causes", "Possible causes"), ("environmental_impact", "Environmental impact"),
                                                                              ("community_impact", "Community impact"), ("missing_evidence", "Missing evidence"), ("recommended_action", "Recommended action"),
                                                                              ("confidence", "Confidence")) if a.get(k_)]
        app.append({"title": "Full AI investigation text", "paragraphs": [], "qa": full})
    return {
        "version": 2, "title": f"Investigation summary: {iid}", "generated": time.strftime("%Y-%m-%d %H:%M:%S"), "mode": MODE,
        "ai_generated": a is not None, "ai_model": ai_model,
        "headline": f"{risk['level'].capitalize()} priority for a field check. Not a confirmed fire.",
        "at_a_glance": [{"label": "Incident", "value": f"{iid} · {v['title']}"}, {"label": "Priority", "value": risk["level"].capitalize()},
                        {"label": "Fire confirmed", "value": "No. Needs field verification"}, {"label": "Observed on", "value": "Unknown (the file has no dates)"},
                        {"label": "Model score", "value": f"{ml['probability']:.2f} of 1 (marks disturbance at {config.ML_THRESHOLD})"}],
        "summary": summary,
        "not_say": "This report does not confirm a fire. It does not find illegal deforestation. Both need field verification and the department's own records.",
        "ai_items_removed": dropped[0], "appendix": app,
    }


def markdown(b: dict[str, Any]) -> str:
    L = [f"# {b['title']}", f"*{b['mode']}* · generated {b['generated']}", "", f"**{b['headline']}**", ""]
    L += [f"- {g['label']}: {g['value']}" for g in b["at_a_glance"]] + [""]
    for s in b["summary"]:
        L += [f"## {s['title']}", ""]
        L += [p + "\n" for p in s["paragraphs"]]
        L += [f"- {x}" for x in s["bullets"]] + ([""] if s["bullets"] else [])
        L += [f"{i}. {x}" for i, x in enumerate(s["numbered"], 1)] + ([""] if s["numbered"] else [])
        if s.get("note"):
            L += [f"> {s['note']}", ""]
    L += [f"> {b['not_say']}", "", "---", "", "## Technical appendix", ""]
    for s in b["appendix"]:
        L += [f"### {s['title']}", ""] + [p + "\n" for p in s.get("paragraphs", [])]
        L += [f"- {x}" for x in s.get("bullets", [])] + ([""] if s.get("bullets") else [])
        t = s.get("table")
        if t:
            L += ["| " + " | ".join(t["cols"]) + " |", "|" + "---|" * len(t["cols"])] + ["| " + " | ".join(r) + " |" for r in t["rows"]] + [""]
        for q in s.get("qa", []):
            L += [f"**{q['title']}.** {q['body']}", ""]
    return "\n".join(L)
