/** Last 10 digits, so +91 and a local mobile compare equal. */
export function phoneKey(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length <= 10 ? digits : digits.slice(-10);
}

export function phonesMatch(a: string, b: string): boolean {
  const ka = phoneKey(a);
  const kb = phoneKey(b);
  return ka.length >= 10 && ka === kb;
}
