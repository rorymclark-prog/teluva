// Parse a free-text money string into a number, handling BOTH European
// ("1.200,50", "89,99") and English ("1,200.50") formats. Vienna/de-AT users
// type comma-decimals; a naive `replace(/[^0-9.]/g,'')` silently 100x's a claim
// total — on the exact document meant to substantiate an insurance payout.
export function parseAmount(raw?: string | null): number {
  if (raw == null) return 0;
  let s = String(raw).replace(/[^0-9.,]/g, '').trim();
  if (!s) return 0;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let decimal = '';
  if (lastComma > -1 && lastDot > -1) {
    decimal = lastComma > lastDot ? ',' : '.';          // the later separator is the decimal point
  } else if (lastComma > -1) {
    const after = s.length - lastComma - 1;
    decimal = (s.indexOf(',') === lastComma && after >= 1 && after <= 2) ? ',' : '';
  } else if (lastDot > -1) {
    const after = s.length - lastDot - 1;
    decimal = (s.indexOf('.') === lastDot && after >= 1 && after <= 2) ? '.' : '';
  }

  if (decimal) {
    const thousands = decimal === ',' ? '.' : ',';
    s = s.split(thousands).join('').replace(decimal, '.');
  } else {
    s = s.replace(/[.,]/g, '');                          // every separator is a thousands grouping
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
