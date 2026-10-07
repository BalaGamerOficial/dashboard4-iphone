export const dayKey = (value) => {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function effectiveGrade(assessment) {
  if (Array.isArray(assessment.subcategories) && assessment.subcategories.length) {
    if (!assessment.subcategories.every((sub) => typeof sub.grade === "number" && Number.isFinite(sub.grade))) return null;
    let weight = 0, points = 0;
    for (const sub of assessment.subcategories) {
      if (typeof sub.grade === "number" && Number.isFinite(sub.grade)) {
        weight += Number(sub.weight || 0);
        points += sub.grade * Number(sub.weight || 0);
      }
    }
    return weight > 0 ? points / weight : null;
  }
  return typeof assessment.grade === "number" && Number.isFinite(assessment.grade) ? assessment.grade : null;
}

export function gradeSummary(assessments) {
  let evaluatedWeight = 0, achieved = 0;
  for (const assessment of assessments) {
    const grade = effectiveGrade(assessment);
    if (grade === null) continue;
    evaluatedWeight += Number(assessment.weight || 0);
    achieved += grade * Number(assessment.weight || 0) / 100;
  }
  return { evaluatedWeight, achieved, average: evaluatedWeight > 0 ? achieved * 100 / evaluatedWeight : null };
}

export function allEvents(snapshot) {
  const seen = new Set();
  return [...snapshot.academic.events, ...snapshot.calendar.events.map((event) => ({ ...event, feedKind: event.kind || event.feedKind }))].filter((event) => {
    const key = `${event.title}|${event.start}|${event.end ?? ""}`;
    if (seen.has(key) || !Number.isFinite(Date.parse(event.start))) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.start.localeCompare(b.start));
}

export function nextEvents(snapshot, now = new Date()) {
  return allEvents(snapshot).filter((event) => new Date(event.end || event.start) >= now);
}

export function safeURL(value) {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

export function escapeHTML(value = "") {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
