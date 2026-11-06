export function waNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export function whatsappUrl(phone: string, text: string): string | null {
  const num = waNumber(phone);
  if (num.length < 10) return null;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

export function mailtoUrl(to: string, subject: string, body: string): string {
  const address = to.trim();
  const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return address ? `mailto:${address}?${query}` : `mailto:?${query}`;
}

export function sharePath(token: string): string {
  return `/share/${token}`;
}

export function screenPath(token: string): string {
  return `/screen/${token}`;
}

export function ensureAbsoluteUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return pathOrUrl;
  if (
    /^https?:\/\//i.test(pathOrUrl) ||
    pathOrUrl.startsWith("mailto:") ||
    pathOrUrl.startsWith("https://wa.me/")
  ) {
    return pathOrUrl;
  }
  if (typeof window === "undefined") return pathOrUrl;
  if (pathOrUrl.startsWith("/")) return `${window.location.origin}${pathOrUrl}`;
  return `${window.location.origin}/${pathOrUrl}`;
}

export function downloadBase64(filename: string, mime: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function copyText(text: string): Promise<boolean> {
  const value = ensureAbsoluteUrl(text);
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
