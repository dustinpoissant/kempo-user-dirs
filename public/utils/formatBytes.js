const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/*
  1000-based (KB, not KiB), matching kempo-files' own size formatting.

  That match is the whole point. A member's screen shows file sizes from the library next to the
  usage figure for their space; if the two used different bases, a folder of files adding up to
  "1 GB" would sit under a meter reading 0.93 GB and every support question would start there.
  Cloud storage is sold in these units anyway.

  This file is also imported by the server (`server/utils/formatBytes.js` re-exports it), so the
  number in a "that would put you over your limit" message is produced by exactly this code.
*/
export default (bytes, decimals) => {
  if(bytes === null || bytes === undefined) return 'Unlimited';

  const value = Number(bytes);
  if(!Number.isFinite(value) || value < 0) return '—';
  if(value === 0) return '0 B';

  const exponent = Math.min(Math.floor(Math.log10(value) / 3), UNITS.length - 1);
  const scaled = value / 1000 ** exponent;
  const places = decimals ?? (exponent === 0 ? 0 : scaled < 10 ? 2 : scaled < 100 ? 1 : 0);

  // parseFloat drops the trailing zeros toFixed would otherwise pad in ("4.20" -> 4.2)
  return `${parseFloat(scaled.toFixed(places))} ${UNITS[exponent]}`;
};

/*
  The inverse, for the admin's limit field — somebody setting a plan types "10" and picks GB rather
  than working out 10000000000.
*/
export const toBytes = (amount, unit = 'GB') => {
  const value = Number(amount);
  if(!Number.isFinite(value) || value < 0) return null;

  const exponent = UNITS.indexOf(String(unit).toUpperCase());
  if(exponent === -1) return null;

  return Math.round(value * 1000 ** exponent);
};

/*
  The largest unit that expresses `bytes` without a fraction below 1 — so a 10 GB plan comes back
  into the admin form as "10 GB" rather than "10000 MB".
*/
export const splitBytes = bytes => {
  if(bytes === null || bytes === undefined) return { amount: '', unit: 'GB' };

  const value = Number(bytes);
  if(!Number.isFinite(value) || value <= 0) return { amount: value === 0 ? 0 : '', unit: 'GB' };

  const exponent = Math.min(Math.floor(Math.log10(value) / 3), UNITS.length - 1);
  return { amount: parseFloat((value / 1000 ** exponent).toFixed(3)), unit: UNITS[exponent] };
};

export { UNITS };
