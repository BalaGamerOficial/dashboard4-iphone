// Shared by the Mac publisher and the offline iPhone app. No credentials travel
// with a snapshot; the 256-bit pairing key is sent only in the URL fragment.
const AAD = new TextEncoder().encode("dashboard4-iphone:v1");
const MAX_BYTES = 24 * 1024 * 1024;

export function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

export function fromBase64(value) {
  if (typeof value !== "string" || value.length > MAX_BYTES * 2) throw new Error("Copia demasiado grande.");
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

export async function importPairingKey(value) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error("La clave de enlace no es válida.");
  const bytes = fromBase64(value);
  if (bytes.byteLength !== 32) throw new Error("La clave de enlace no es válida.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== 1 || !Number.isFinite(Date.parse(snapshot.exportedAt)) ||
      !snapshot.academic || snapshot.academic.schemaVersion !== 1 || !snapshot.academic.settings ||
      !Array.isArray(snapshot.academic.subjects) || !Array.isArray(snapshot.academic.tasks) ||
      !Array.isArray(snapshot.academic.events) || !Array.isArray(snapshot.academic.assessments) ||
      !Array.isArray(snapshot.calendar?.events) || !Array.isArray(snapshot.materials)) {
    throw new Error("La copia de Dashboard4 no tiene un formato compatible.");
  }
  return snapshot;
}

async function streamBytes(stream, limit = MAX_BYTES) {
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new Error("Copia demasiado grande.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

export async function encryptSnapshot(snapshot, keyString) {
  validateSnapshot(snapshot);
  const plain = new TextEncoder().encode(JSON.stringify(snapshot));
  if (plain.byteLength > MAX_BYTES) throw new Error("Copia demasiado grande.");
  const compressed = await streamBytes(new Blob([plain]).stream().pipeThrough(new CompressionStream("gzip")));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importPairingKey(keyString);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, compressed);
  return { version: 1, algorithm: "A256GCM", encoding: "gzip", iv: toBase64(iv), data: toBase64(new Uint8Array(encrypted)) };
}

export async function decryptSnapshot(envelope, keyString) {
  if (!envelope || envelope.version !== 1 || envelope.algorithm !== "A256GCM" || envelope.encoding !== "gzip") {
    throw new Error("La copia cifrada no es compatible.");
  }
  const iv = fromBase64(envelope.iv);
  if (iv.length !== 12) throw new Error("La copia cifrada está dañada.");
  const key = await importPairingKey(keyString);
  let compressed;
  try {
    compressed = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, fromBase64(envelope.data));
  } catch { throw new Error("No se pudo verificar la copia. Comprueba la clave de enlace."); }
  const plain = await streamBytes(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip")));
  return validateSnapshot(JSON.parse(new TextDecoder().decode(plain)));
}
