export function isBlocked(html) {
  const blockers = [
    /verificación de seguridad/i,
    /access denied/i,
    /robot check/i,
    /temporarily unavailable/i,
    /please enable cookies/i
  ];
  return blockers.some(rx => rx.test(html));
}