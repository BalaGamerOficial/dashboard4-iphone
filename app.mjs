import { decryptSnapshot, importPairingKey } from "./protocol.mjs";
import { allEvents, nextEvents, gradeSummary, effectiveGrade, dayKey, safeURL, escapeHTML as h } from "./model.mjs";

const $ = (selector) => document.querySelector(selector);
const app = $("#app");
const status = $("#sync-status");
const dateFormat = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" });
const fullDate = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" });
const timeFormat = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" });
let db, snapshot, envelope, pairingKey, syncing = false, offlineReady = false, persistent = false;
let tab = "home", selectedDay = dayKey(new Date()), taskFilter = "pending", subjectFilter = "all", query = "", currentDocument;
let pairingCandidate = new URLSearchParams(location.hash.slice(1)).get("k");
let snapshotURL;
// Remove the key from browser history immediately, before links are opened.
if (location.hash) history.replaceState(null, "", location.pathname + location.search);

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("dashboard4-iphone", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("local");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("No se pudo abrir la copia local del iPhone."));
  });
}

function readLocal(key) {
  return new Promise((resolve, reject) => {
    const request = db.transaction("local").objectStore("local").get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function writeLocal(entries) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("local", "readwrite");
    const store = transaction.objectStore("local");
    for (const [key, value] of Object.entries(entries)) store.put(value, key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(new Error("No hay espacio para guardar la copia. Se conserva la anterior."));
    transaction.onabort = () => reject(new Error("No se pudo guardar la copia. Se conserva la anterior."));
  });
}

function setStatus(message, kind = "") { status.textContent = message; status.className = `sync-status ${kind}`; }
function fmtDate(value, full = false) { return Number.isFinite(Date.parse(value)) ? (full ? fullDate : dateFormat).format(new Date(value)) : "Sin fecha"; }
function fmtTime(value) { return /T\d/.test(value || "") && Number.isFinite(Date.parse(value)) ? timeFormat.format(new Date(value)) : "Todo el día"; }
function subjectName(id) { return snapshot.academic.subjects.find((s) => s.id === id)?.name || "Personal"; }
function pageTitle(title, subtitle) { return `<h1>${h(title)}</h1><p class="subtitle">${h(subtitle)}</p>`; }
function empty(title, text) { return `<div class="card empty"><strong>${h(title)}</strong>${h(text)}</div>`; }
function heading(title, extra = "") { return `<div class="section-header"><h2>${h(title)}</h2><span>${h(extra)}</span></div>`; }
function link(url, label) { const safe = safeURL(url); return safe ? `<a class="button secondary" href="${h(safe)}" target="_blank" rel="noopener noreferrer">${h(label)} ↗</a>` : ""; }
function taskBadge(task) {
  const names = { pending: "Pendiente", "in-progress": "En curso", done: "Hecha" };
  return `<span class="badge ${task.status === "done" ? "done" : task.priority === "high" ? "high" : ""}">${h(names[task.status] || task.status)}</span>`;
}
function eventCard(event) {
  return `<div class="card row"><div class="time">${h(fmtTime(event.start))}</div><div class="row-main"><h3>${h(event.title)}</h3><p class="meta">${h(event.location || subjectName(event.subjectId))}${event.end ? ` · ${h(fmtTime(event.end))}` : ""}</p>${event.notes ? `<p class="detail">${h(event.notes)}</p>` : ""}</div>${event.type === "exam" || event.feedKind === "exams" ? '<span class="badge high">Examen</span>' : ""}</div>`;
}
function taskCard(task) {
  return `<details class="card"><summary>${h(task.title)}</summary><p class="meta">${h(subjectName(task.subjectId))} · ${h(fmtDate(task.dueDate))} · ${h(task.estimatedMinutes || 0)} min</p><div class="subject-actions">${taskBadge(task)}${task.priority === "high" ? '<span class="badge high">Prioridad alta</span>' : ""}</div>${task.notes ? `<p class="detail">${h(task.notes)}</p>` : ""}</details>`;
}
function installInstructions() {
  return `<ol><li>Abre el enlace privado de tu Mac en <strong>Safari</strong>.</li><li>Toca <strong>Compartir → Añadir a pantalla de inicio</strong> y activa «Abrir como app» si aparece.</li><li>Abre Dashboard4 desde el nuevo icono. Si pide enlazar, pega aquí el mismo enlace privado.</li><li>Espera a que aparezca <strong>«Lista sin conexión»</strong>. Ya puedes apagar el Mac.</li></ol>`;
}
function pairingForm() {
  return `<label for="pairing-input">Enlace privado o clave de tu Mac</label><input id="pairing-input" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Pega tu enlace de instalación"><button class="button wide" data-action="pair">Enlazar este iPhone</button><p class="note">El enlace abre tu copia cifrada. Consérvalo en un lugar privado.</p>`;
}
function homePage() {
  const events = allEvents(snapshot).filter((e) => dayKey(e.start) === dayKey(new Date()));
  const next = nextEvents(snapshot)[0];
  const pending = snapshot.academic.tasks.filter((t) => t.status !== "done").sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  const nextExam = nextEvents(snapshot).find((e) => e.type === "exam" || e.feedKind === "exams");
  return pageTitle("Tu día, a mano.", fullDate.format(new Date())) +
    (next ? `<div class="card hero"><span class="eyebrow">Lo próximo · ${h(fmtDate(next.start))}</span><h2>${h(next.title)}</h2><p class="meta">${h(fmtTime(next.start))} · ${h(next.location || subjectName(next.subjectId))}</p></div>` : empty("Todo en orden", "No hay eventos próximos en la copia del Mac.")) +
    `<div class="metrics"><div class="metric"><strong>${events.length}</strong><span>Eventos hoy</span></div><div class="metric"><strong>${pending.length}</strong><span>Tareas pendientes</span></div><div class="metric"><strong>${nextExam ? Math.max(0, Math.ceil((new Date(nextExam.start) - new Date()) / 86400000)) : "—"}</strong><span>Días al examen</span></div></div>` +
    heading("Hoy", `${events.length} eventos`) + (events.map(eventCard).join("") || empty("Un día despejado", "Hoy no hay eventos en tu agenda.")) +
    heading("En tu lista", `${pending.length} pendientes`) + (pending.slice(0, 4).map(taskCard).join("") || empty("Sin tareas pendientes", "Tu última copia está al día.")) +
    `<footer>Datos del Mac · ${h(fmtDate(snapshot.sourceSavedAt || snapshot.exportedAt))}<br>Consulta local · Los cambios se hacen en Dashboard4 del Mac</footer>`;
}
function calendarPage() {
  const events = allEvents(snapshot).filter((e) => dayKey(e.start) === selectedDay);
  const future = nextEvents(snapshot).filter((e) => e.type === "exam" || e.feedKind === "exams").slice(0, 5);
  return pageTitle("Tu agenda.", "Horario UPV y eventos del Mac, también sin conexión.") +
    `<div class="day-selector"><button class="button secondary" data-action="previous-day" aria-label="Día anterior">‹</button><input id="calendar-day" type="date" value="${h(selectedDay)}" aria-label="Día de la agenda"><button class="button secondary" data-action="next-day" aria-label="Día siguiente">›</button></div>` +
    heading(fmtDate(`${selectedDay}T12:00:00`, true), `${events.length} eventos`) + (events.map(eventCard).join("") || empty("Sin eventos este día", "Puedes consultar otra fecha.")) +
    heading("Próximos exámenes") + (future.map((e) => `<p class="date-label">${h(fmtDate(e.start, true))}</p>${eventCard(e)}`).join("") || empty("Sin exámenes próximos", "Según la última copia del calendario."));
}
function tasksPage() {
  const tasks = snapshot.academic.tasks.filter((t) => taskFilter === "all" || (taskFilter === "pending" ? t.status !== "done" : t.status === "done"))
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  const plan = snapshot.studyPlan;
  const blocks = Array.isArray(plan?.blocks) ? plan.blocks : [];
  return pageTitle("Una cosa cada vez.", "Tu plan y tus tareas. El Mac mantiene la lista actualizada.") +
    `<div class="toolbar"><select id="task-filter" aria-label="Filtrar tareas">${[["pending", "Pendientes"], ["done", "Hechas"], ["all", "Todas"]].map(([v, l]) => `<option value="${v}"${v === taskFilter ? " selected" : ""}>${l}</option>`).join("")}</select></div>` +
    (tasks.map(taskCard).join("") || empty("Nada por aquí", "No hay tareas con este filtro.")) +
    (blocks.length ? heading("Plan de estudio", plan.weekKey || "") + blocks.map((b) => `<div class="card"><h3>${h(b.title || b.topic || b.subjectName || "Bloque de estudio")}</h3><p class="meta">${h(b.date || b.day || b.start || "")} ${h(b.durationMinutes || b.minutes || "")}</p>${(plan.completedBlockIds || []).includes(b.id) ? '<span class="badge done">Completado</span>' : ""}</div>`).join("") : "") +
    heading("Entregas PoliformaT") + snapshot.assignments.map((a) => `<details class="card"><summary>${h(a.title)}</summary><p class="meta">${h(a.siteName)} · ${h(fmtDate(a.dueAt))}</p><span class="badge ${a.submitted ? "done" : ""}">${a.submitted ? "Entregada" : h(a.submissionStatus || a.status || "Pendiente")}</span><p class="detail">${h(a.instructions || "Sin enunciado descargado.")}</p></details>`).join("");
}
function subjectsPage() {
  return pageTitle("Cada punto cuenta.", "Asignaturas y evaluación real. Las simulaciones del Mac no alteran estas notas.") + snapshot.academic.subjects.map((s) => {
    const assessments = snapshot.academic.assessments.filter((a) => a.subjectId === s.id);
    const grade = gradeSummary(assessments);
    const notebook = snapshot.notebooks.find((n) => n.subjectId === s.id);
    return `<details class="card"><summary>${h(s.name)}</summary><p class="meta">${h(s.code || "")} · ${h(s.ects)} ECTS · ${h(s.classroom || "Aula sin definir")}</p><div class="row"><div class="row-main"><p class="meta">Media evaluada · ${grade.evaluatedWeight}% del curso</p></div><div class="grade">${grade.average === null ? "—" : grade.average.toFixed(2)}<small>sobre 10</small></div></div><progress class="progress" max="100" value="${Math.min(100, Math.max(0, grade.evaluatedWeight))}" aria-label="Porcentaje evaluado"></progress><table><tbody>${assessments.map((a) => `<tr><td>${h(a.name)}<div class="meta">${a.weight}%${a.date ? ` · ${h(fmtDate(a.date))}` : ""}${a.minimumGrade != null ? ` · Mín. ${h(a.minimumGrade)}` : ""}</div>${a.comments ? `<div class="detail">${h(a.comments)}</div>` : ""}</td><td><strong>${effectiveGrade(a) === null ? "—" : effectiveGrade(a).toFixed(2)}</strong></td></tr>`).join("")}</tbody></table><p class="detail">${h(s.professors || "")}${s.schedule ? `\n${h(s.schedule)}` : ""}${s.notes ? `\n${h(s.notes)}` : ""}</p>${notebook ? link(notebook.notebookUrl, notebook.notebookName || "NotebookLM") : ""}</details>`;
  }).join("");
}
function libraryPage() {
  const documents = [...snapshot.materials.map((m) => ({ ...m, kind: "material" })), ...snapshot.library.map((m) => ({ ...m, kind: "library" }))];
  const normalized = query.toLocaleLowerCase("es");
  const filtered = documents.filter((m) => (subjectFilter === "all" || m.subjectId === subjectFilter) &&
    `${m.title} ${m.subjectName} ${m.content}`.toLocaleLowerCase("es").includes(normalized));
  return pageTitle("Tu biblioteca de bolsillo.", "Guías, transcripciones y texto de los documentos descargados en el Mac.") +
    `<div class="toolbar"><input id="library-query" type="search" value="${h(query)}" placeholder="Buscar en tus apuntes" aria-label="Buscar apuntes"><select id="subject-filter" aria-label="Asignatura"><option value="all">Todas</option>${snapshot.academic.subjects.map((s) => `<option value="${h(s.id)}"${subjectFilter === s.id ? " selected" : ""}>${h(s.name)}</option>`).join("")}</select></div>` +
    heading("Guardados en este iPhone", `${filtered.length} documentos`) +
    (filtered.slice(0, 100).map((m) => `<button class="card list-button" data-document="${h(m.id)}" data-kind="${m.kind}"><span class="eyebrow">${h(m.type || m.format || "Apuntes")}</span><h3>${h(m.title)}</h3><p class="meta">${h(m.subjectName || subjectName(m.subjectId))}${m.date ? ` · ${h(fmtDate(m.date))}` : ""}</p>${m.summary ? `<p class="meta">${h(m.summary.slice(0, 140))}</p>` : ""}</button>`).join("") || empty("Sin resultados", "Prueba otra búsqueda. Los documentos se actualizan al abrir el Mac.")) +
    heading("Recursos y enlaces") + snapshot.academic.resources.map((r) => `<div class="card"><h3>${h(r.title)}</h3><p class="meta">${h(subjectName(r.subjectId))} · ${h(r.type)}</p>${r.notes ? `<p class="detail">${h(r.notes)}</p>` : ""}<div class="subject-actions">${link(r.url, "Abrir enlace")}</div>${r.fileName ? `<p class="note">Archivo original en el Mac: ${h(r.fileName)}. El PDF original no está incluido en esta copia.</p>` : ""}</div>`).join("") +
    `<details class="card"><summary>Catálogo PoliformaT · ${snapshot.resources.length} recursos</summary><p class="note">El texto extraído disponible aparece arriba. Los PDF originales y los vídeos se conservan en el Mac.</p>${snapshot.resources.filter((r) => r.type !== "collection").slice(0, 100).map((r) => `<p class="meta">${h(r.title)} · ${h(r.siteName)}</p>`).join("")}</details>`;
}
function settingsPage() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  return pageTitle("Siempre contigo.", "Copia local, instalación y estado de la sincronización.") +
    `<div class="card"><span class="eyebrow">Tu copia</span><h2>${snapshot ? "Guardada en este iPhone" : "Pendiente de enlazar"}</h2><p class="meta status-line">${snapshot ? `Publicada por el Mac: ${h(fmtDate(snapshot.exportedAt))} a las ${h(fmtTime(snapshot.exportedAt))}` : "Enlaza el iPhone con la clave privada de tu Mac."}</p><p class="meta">${offlineReady ? "Lista sin conexión · app y datos descargados" : "Preparando la app para usarla sin conexión…"}</p><p class="meta">${persistent ? "Almacenamiento persistente concedido por Safari" : "Persistencia sujeta al almacenamiento de iOS"}</p><button class="button wide" data-action="sync">Sincronizar ahora</button><button class="button secondary wide" data-action="persist">Proteger almacenamiento local</button><p class="note">El Mac publica al abrir Dashboard4 y mientras está abierto. El iPhone descarga al abrir esta app, al volver a ella y cada minuto mientras está visible. Si no hay red, conserva la última copia buena.</p></div>` +
    `<div class="card"><h2>${standalone ? "Instalada como app" : "Instalar en el iPhone"}</h2>${installInstructions()}<p class="note">No usa certificados de desarrollador ni renovaciones semanales. iOS puede borrar datos si eliminas la app o liberas su almacenamiento: exporta una copia a Archivos como respaldo.</p></div>` +
    `<div class="card"><h2>Respaldo en Archivos</h2><p class="note">La copia exportada está cifrada. Para restaurarla necesitas también tu enlace privado.</p><button class="button secondary wide" data-action="export"${!envelope ? " disabled" : ""}>Exportar copia cifrada</button><button class="button secondary wide" data-action="import">Importar copia cifrada</button></div>` +
    `<details class="card"><summary>Enlazar o cambiar de copia</summary>${pairingForm()}</details>` +
    (snapshot ? heading("Avisos PoliformaT") + snapshot.announcements.slice().reverse().map((a) => `<details class="card"><summary>${h(a.title)}</summary><p class="meta">${h(a.siteName)} · ${h(fmtDate(a.createdAt))}</p><p class="detail">${h(a.body)}</p></details>`).join("") + heading("Trámites") + (snapshot.academic.procedures.map((p) => `<details class="card"><summary>${h(p.name)}</summary><p class="meta">${h(p.status)} · ${h(fmtDate(p.deadline))}</p><p class="detail">${h(p.requiredDocuments)}\n${h(p.notes)}</p>${link(p.url, "Abrir trámite")}</details>`).join("") || empty("Sin trámites", "No hay gestiones registradas en la copia.")) : "");
}

function render() {
  if (snapshot) $("#course").textContent = `UPV · ${snapshot.academic.settings.academicYear}`;
  if (!snapshot && tab !== "settings") {
    app.innerHTML = pageTitle("Tu Mac, en el bolsillo.", "Una copia de Dashboard4 que abre incluso sin conexión.") +
      `<div class="card"><h2>Enlaza tu iPhone</h2>${pairingForm()}</div><div class="card"><h2>Instalación sin caducidad de firma</h2>${installInstructions()}</div>`;
    return;
  }
  app.innerHTML = ({ home: homePage, calendar: calendarPage, tasks: tasksPage, subjects: subjectsPage, library: libraryPage, settings: settingsPage })[tab]();
}

async function acceptEnvelope(incoming, candidate = pairingKey, allowOlder = false) {
  const next = await decryptSnapshot(incoming, candidate);
  if (!allowOlder && snapshot && Date.parse(next.exportedAt) < Date.parse(snapshot.exportedAt)) {
    throw new Error("El servidor devolvió una copia anterior. Se conserva la del iPhone.");
  }
  if (!db) throw new Error("El almacenamiento local no está disponible.");
  // Commit key, ciphertext and validated data together. A quota failure or a
  // wrong pairing key must never replace a good local snapshot.
  await writeLocal({ previous: snapshot || null, snapshot: next, envelope: incoming, pairingKey: candidate, lastCheckedAt: new Date().toISOString() });
  snapshot = next; envelope = incoming; pairingKey = candidate; pairingCandidate = null;
  render();
}

async function sync(candidate = pairingCandidate || pairingKey) {
  if (syncing) return;
  if (!candidate) { setStatus("Enlaza el iPhone para recibir tu copia del Mac."); return; }
  syncing = true; $("#sync").disabled = true;
  setStatus("Buscando la última copia del Mac…");
  try {
    await importPairingKey(candidate);
    if (!snapshotURL) {
      const source = await fetch("./source.json").then((r) => { if (!r.ok) throw new Error("No se pudo leer el origen de la copia."); return r.json(); });
      const url = new URL(source.snapshotURL, location.href);
      if (url.origin !== location.origin && (url.protocol !== "https:" || url.hostname !== "raw.githubusercontent.com")) throw new Error("El origen de la copia no es válido.");
      snapshotURL = url;
    }
    const url = new URL(snapshotURL); url.searchParams.set("t", String(Date.now()));
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("La copia publicada todavía no está disponible.");
    const incoming = await response.json();
    if (envelope && candidate === pairingKey && incoming.data === envelope.data) {
      await writeLocal({ lastCheckedAt: new Date().toISOString() });
    } else await acceptEnvelope(incoming, candidate);
    localStatus();
  } catch (error) {
    const message = !navigator.onLine || error instanceof TypeError ? "Sin conexión con la copia publicada" :
      error.name === "TimeoutError" ? "La conexión está tardando. Se volverá a intentar." : error.message;
    setStatus(snapshot ? `Copia local conservada · ${message}` : message, "warning");
  } finally { syncing = false; $("#sync").disabled = false; }
}

function localStatus() {
  setStatus(snapshot ? `${offlineReady ? "Lista sin conexión" : "Copia local guardada"} · Mac: ${fmtDate(snapshot.exportedAt)}, ${fmtTime(snapshot.exportedAt)}` : "Enlaza el iPhone con tu Mac.", snapshot ? "good" : "");
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function candidateFromInput() {
  const value = $("#pairing-input")?.value.trim();
  try { return new URLSearchParams(new URL(value).hash.slice(1)).get("k") || value; }
  catch { return value; }
}
async function action(name) {
  if (name === "sync") return sync();
  if (name === "pair") return sync(candidateFromInput());
  if (name === "export" && envelope) return download(new Blob([JSON.stringify(envelope)], { type: "application/json" }), `dashboard4-cifrado-${dayKey(new Date())}.json`);
  if (name === "import") return $("#import-backup").click();
  if (name === "persist") {
    persistent = await navigator.storage?.persist?.().catch(() => false) || false;
    render(); setStatus(persistent ? "Almacenamiento persistente activado." : "iOS no ha concedido persistencia. Conserva un respaldo en Archivos.", persistent ? "good" : "warning");
  }
  if (name === "previous-day" || name === "next-day") {
    const date = new Date(`${selectedDay}T12:00:00`); date.setDate(date.getDate() + (name === "next-day" ? 1 : -1));
    selectedDay = dayKey(date); render();
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.tab) {
    tab = button.dataset.tab;
    document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-current", b === button ? "page" : "false"));
    render(); window.scrollTo(0, 0);
  }
  if (button.dataset.action) void action(button.dataset.action).catch((e) => setStatus(e.message, "warning"));
  if (button.dataset.document) {
    const list = button.dataset.kind === "material" ? snapshot.materials : snapshot.library;
    currentDocument = list.find((m) => m.id === button.dataset.document);
    if (!currentDocument) return;
    $("#reader-title").textContent = currentDocument.title;
    $("#reader-content").textContent = currentDocument.content || "No hay texto extraído de este documento.";
    $("#reader").showModal(); $("#reader").scrollTop = 0;
  }
});
document.addEventListener("change", (event) => {
  if (event.target.id === "calendar-day") selectedDay = event.target.value || dayKey(new Date());
  else if (event.target.id === "task-filter") taskFilter = event.target.value;
  else if (event.target.id === "subject-filter") subjectFilter = event.target.value;
  else return;
  render();
});
let searchTimer;
document.addEventListener("input", (event) => {
  if (event.target.id !== "library-query") return;
  query = event.target.value; clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { render(); const input = $("#library-query"); input.focus(); }, 200);
});
$("#sync").addEventListener("click", () => void sync());
$("#close-reader").addEventListener("click", () => $("#reader").close());
$("#save-document").addEventListener("click", () => {
  if (currentDocument) download(new Blob([currentDocument.content], { type: "text/plain;charset=utf-8" }), `${currentDocument.title.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 80)}.txt`);
});
$("#import-backup").addEventListener("change", async (event) => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 32 * 1024 * 1024) throw new Error("El archivo es demasiado grande.");
    const candidate = candidateFromInput() || pairingCandidate || pairingKey;
    if (!candidate) throw new Error("Pega primero tu enlace privado en «Enlazar o cambiar de copia».");
    const incoming = JSON.parse(await file.text());
    if (snapshot && !confirm("¿Restaurar esta copia cifrada? Se conservará la copia actual como anterior.")) return;
    await acceptEnvelope(incoming, candidate, true); localStatus();
  } catch (error) { setStatus(error.message, "warning"); }
  finally { event.target.value = ""; }
});

async function boot() {
  try {
    db = await openDB();
    [snapshot, envelope, pairingKey] = await Promise.all([readLocal("snapshot"), readLocal("envelope"), readLocal("pairingKey")]);
    persistent = await navigator.storage?.persisted?.().catch(() => false) || false;
    render(); localStatus();
    if ("serviceWorker" in navigator && isSecureContext) {
      const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" });
      // ready resolves only once the entire shell has been cached successfully.
      navigator.serviceWorker.ready.then(() => { offlineReady = true; localStatus(); if (tab === "settings") render(); });
      void registration.update().catch(() => {});
    } else setStatus("La app necesita HTTPS para abrir sin conexión. Usa el enlace de instalación.", "warning");
    await sync();
  } catch (error) { render(); setStatus(error.message, "warning"); }
}
window.addEventListener("online", () => void sync());
window.addEventListener("offline", () => setStatus(snapshot ? "Sin conexión · copia local disponible" : "Sin conexión · enlaza cuando tengas red.", "warning"));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void sync(); });
setInterval(() => { if (document.visibilityState === "visible" && navigator.onLine) void sync(); }, 60000);
void boot();
