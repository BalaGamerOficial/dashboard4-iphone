export const RECOVERY_KEY = "dashboard4:device:v2";

export function recoveryStorage(window) {
  try { return window.localStorage; } catch { return null; }
}

export function isPairingKey(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function keyFromLink(value) {
  const text = String(value || "").trim();
  if (isPairingKey(text)) return text;
  try {
    const key = new URLSearchParams(new URL(text).hash.slice(1)).get("k");
    return isPairingKey(key) ? key : null;
  } catch { return null; }
}

export function installationURL(base, key) {
  if (!isPairingKey(key)) throw new Error("La clave de enlace no es válida.");
  const url = new URL("./", base);
  url.search = "";
  url.hash = new URLSearchParams({ k: key, install: "1" }).toString();
  return url.href;
}

// This recovery record stays on the device. It contains ciphertext and never
// sends a cookie (and therefore never sends the decryption key to GitHub).
export function readRecovery(storage) {
  try {
    const value = JSON.parse(storage.getItem(RECOVERY_KEY));
    return value?.version === 2 && isPairingKey(value.pairingKey) && value.envelope?.algorithm === "A256GCM" ? value : null;
  } catch { return null; }
}

export function writeRecovery(storage, pairingKey, envelope) {
  if (!isPairingKey(pairingKey) || !envelope) return false;
  try {
    storage.setItem(RECOVERY_KEY, JSON.stringify({ version: 2, pairingKey, envelope }));
    return readRecovery(storage)?.pairingKey === pairingKey;
  } catch { return false; }
}
