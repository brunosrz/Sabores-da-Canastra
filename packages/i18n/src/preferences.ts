const YEAR = 31536000;
export function readSharedPreference(name: string): string | null {
  if (typeof document === "undefined") return null;
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!entry) return null;
  try {
    return decodeURIComponent(entry.slice(name.length + 1));
  } catch {
    return null;
  }
}
export function writeSharedPreference(name: string, value: string) {
  const host = window.location.hostname;
  const domain =
    host === "brunosrz.com" || host.endsWith(".brunosrz.com")
      ? "; Domain=brunosrz.com"
      : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${YEAR}; SameSite=Lax${domain}${window.location.protocol === "https:" ? "; Secure" : ""}`;
}
