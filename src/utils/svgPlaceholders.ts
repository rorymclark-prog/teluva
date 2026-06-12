// Escape user-supplied text before interpolating into SVG markup.
// Covers XML entities plus '#' and '%', which terminate/garble utf8 data: URLs.
function esc(value: string): string {
  return value
    .replace(/%/g, '%25')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/#/g, '%23');
}

export function getDocumentPlaceholderSvg(name: string, category: string, memberName: string, date: string): string {
  const primaryColor = category === 'ID' ? '#5E7B9B' : category === 'Health' ? '#C16A75' : category === 'Travel' ? '#C9A227' : '#7A6F63';
  const accentColor = category === 'ID' ? '#DEE6EF' : category === 'Health' ? '#F4DDE0' : category === 'Travel' ? '#F6E9C9' : '#F3ECE0';

  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 560" width="100%" height="100%">
    <rect width="400" height="560" rx="16" fill="%23FDFBF7" stroke="${encodeURIComponent(primaryColor)}" stroke-width="3" />
    <path d="M 0 16 A 16 16 0 0 1 16 0 L 384 0 A 16 16 0 0 1 400 16 L 400 80 L 0 80 Z" fill="${encodeURIComponent(primaryColor)}" />

    <!-- Title and Icon -->
    <text x="24" y="48" font-family="'Plus Jakarta Sans', sans-serif" font-weight="bold" font-size="20" fill="%23ffffff">${esc(name.toUpperCase())}</text>
    <rect x="330" y="24" width="46" height="32" rx="6" fill="${encodeURIComponent(accentColor)}" fill-opacity="0.3" />
    <circle cx="353" cy="40" r="8" fill="%23ffffff" />

    <g transform="translate(24, 110)">
      <!-- Owner Info -->
      <rect width="352" height="60" rx="8" fill="%23F3ECE0" />
      <text x="16" y="24" font-family="'Plus Jakarta Sans', sans-serif" font-weight="normal" font-size="12" fill="%237A6F63">Document for</text>
      <text x="16" y="44" font-family="'Plus Jakarta Sans', sans-serif" font-weight="bold" font-size="16" fill="%2325211C">${esc(memberName)}</text>

      <!-- Metadata Grid -->
      <text x="0" y="100" font-family="'Plus Jakarta Sans', sans-serif" font-weight="600" font-size="11" fill="%235C534A">Category: ${esc(category)}</text>
      <text x="0" y="120" font-family="'Plus Jakarta Sans', sans-serif" font-weight="normal" font-size="11" fill="%237A6F63">Added on: ${esc(date)}</text>
      <text x="0" y="140" font-family="'Plus Jakarta Sans', sans-serif" font-weight="normal" font-size="11" fill="%237A6F63">Kept in your family vault</text>

      <!-- Watermark Badge -->
      <circle cx="280" cy="115" r="35" fill="${encodeURIComponent(accentColor)}" fill-opacity="0.2" />
      <circle cx="280" cy="115" r="28" fill="none" stroke="${encodeURIComponent(primaryColor)}" stroke-width="1.5" stroke-dasharray="3 3" />
      <text x="280" y="119" font-family="'Plus Jakarta Sans', sans-serif" font-weight="bold" font-size="10" fill="${encodeURIComponent(primaryColor)}" text-anchor="middle">COPY</text>

      <!-- Document lines representation (simulating structured data fields) -->
      <line x1="0" y1="180" x2="352" y2="180" stroke="%23E9DFCE" stroke-width="2" />

      <!-- Field Blocks -->
      <rect x="0" y="200" width="165" height="40" rx="4" fill="%23FDFBF7" stroke="%23E9DFCE" stroke-width="1" />
      <text x="8" y="16" font-family="'Plus Jakarta Sans', sans-serif" font-size="9" fill="%239A8F82">Record</text>
      <text x="8" y="31" font-family="'JetBrains Mono', monospace" font-size="11" fill="%23453E37">%23FH-REC-99419</text>

      <rect x="187" y="200" width="165" height="40" rx="4" fill="%23FDFBF7" stroke="%23E9DFCE" stroke-width="1" />
      <text x="8" y="16" font-family="'Plus Jakarta Sans', sans-serif" font-size="9" fill="%239A8F82">Access</text>
      <text x="8" y="31" font-family="'Plus Jakarta Sans', sans-serif" font-weight="bold" font-size="11" fill="%23678754">Family only</text>

      <!-- Body Text Lines to look like scan -->
      <rect x="0" y="260" width="352" height="130" rx="6" fill="%23ffffff" stroke="%23E9DFCE" stroke-width="1" />
      <text x="16" y="28" font-family="'Plus Jakarta Sans', sans-serif" font-weight="600" font-size="11" fill="%2325211C">Reference copy</text>

      <line x1="16" y1="46" x2="336" y2="46" stroke="%23F3ECE0" stroke-width="4" />
      <line x1="16" y1="58" x2="310" y2="58" stroke="%23F3ECE0" stroke-width="4" />
      <line x1="16" y1="70" x2="326" y2="70" stroke="%23F3ECE0" stroke-width="4" />
      <line x1="16" y1="82" x2="280" y2="82" stroke="%23F3ECE0" stroke-width="4" />
      <line x1="16" y1="94" x2="250" y2="94" stroke="%23F3ECE0" stroke-width="4" />

      <!-- Checkbox / Signatures -->
      <rect x="16" y="105" width="10" height="10" rx="2" fill="none" stroke="${encodeURIComponent(primaryColor)}" stroke-width="1.5" />
      <path d="M 18 110 L 21 113 L 25 107" fill="none" stroke="${encodeURIComponent(primaryColor)}" stroke-width="1.5" />
      <text x="32" y="114" font-family="'Plus Jakarta Sans', sans-serif" font-size="10" fill="%237A6F63">Original kept safely at home</text>
    </g>

    <!-- Shield Logo Footer -->
    <path d="M 175 510 L 200 495 L 225 510 L 225 525 Q 225 535 200 545 Q 175 535 175 525 Z" fill="${encodeURIComponent(primaryColor)}" fill-opacity="0.8" />
    <path d="M 190 520 L 197 527 L 212 512" fill="none" stroke="%23ffffff" stroke-width="2" />
  </svg>`;
}

export function getFavoritePlaceholderSvg(title: string, category: string): string {
  let mainColor = '#5E7B9B'; // Dusk
  let accentColor = '#DEE6EF';
  let iconSvg = '';

  switch (category) {
    case 'Toy':
      mainColor = '#D28259'; // Clay
      accentColor = '#F6E0D5';
      iconSvg = `
        <!-- Toy Robot / Teddy Bear head representation -->
        <rect x="120" y="100" width="160" height="120" rx="24" fill="${encodeURIComponent(mainColor)}" />
        <circle cx="160" cy="150" r="14" fill="%23ffffff" />
        <circle cx="160" cy="150" r="6" fill="%2325211C" />
        <circle cx="240" cy="150" r="14" fill="%23ffffff" />
        <circle cx="240" cy="150" r="6" fill="%2325211C" />
        <rect x="180" y="180" width="40" height="12" rx="6" fill="%2325211C" />
        <circle cx="110" cy="160" r="12" fill="%23A85432" />
        <circle cx="290" cy="160" r="12" fill="%23A85432" />
        <!-- Antenna -->
        <line x1="200" y1="100" x2="200" y2="70" stroke="${encodeURIComponent(mainColor)}" stroke-width="8" stroke-linecap="round" />
        <circle cx="200" cy="65" r="14" fill="%23D28259" />
      `;
      break;
    case 'Clothing & Style':
      mainColor = '#C16A75'; // Rosa
      accentColor = '#F4DDE0';
      iconSvg = `
        <!-- Clothes hanger and jacket outline -->
        <path d="M 150 110 Q 200 70 250 110" fill="none" stroke="${encodeURIComponent(mainColor)}" stroke-width="12" stroke-linecap="round" />
        <path d="M 200 75 Q 185 55 200 45 Q 215 55 200 75" fill="none" stroke="${encodeURIComponent(mainColor)}" stroke-width="8" stroke-linecap="round" />
        <path d="M 120 130 L 280 130 L 260 250 L 140 250 Z" fill="${encodeURIComponent(mainColor)}" opacity="0.85" />
        <line x1="200" y1="130" x2="200" y2="250" stroke="%23ffffff" stroke-width="4" stroke-dasharray="4 4" />
        <circle cx="200" cy="160" r="7" fill="%23ffffff" />
        <circle cx="200" cy="190" r="7" fill="%23ffffff" />
      `;
      break;
    case 'Hobbies & Sports':
      mainColor = '#678754'; // Sage
      accentColor = '#E2EADC';
      iconSvg = `
        <!-- Soccer ball / Basketball stylized and bicycle outline -->
        <circle cx="200" cy="150" r="70" fill="${encodeURIComponent(mainColor)}" />
        <circle cx="200" cy="150" r="50" fill="none" stroke="%23ffffff" stroke-width="4" stroke-dasharray="8 6" />
        <line x1="130" y1="150" x2="270" y2="150" stroke="%23ffffff" stroke-width="4" />
        <line x1="200" y1="80" x2="200" y2="220" stroke="%23ffffff" stroke-width="4" />
        <path d="M 152 102 Q 200 150 248 102" fill="none" stroke="%23ffffff" stroke-width="4" />
        <path d="M 152 198 Q 200 150 248 198" fill="none" stroke="%23ffffff" stroke-width="4" />
      `;
      break;
    case 'Books & Media':
      mainColor = '#435970'; // Dusk deep
      accentColor = '#F0F3F7';
      iconSvg = `
        <!-- Open book vector representation -->
        <path d="M 200 230 Q 150 190 90 200 L 90 80 Q 150 70 200 110 Z" fill="${encodeURIComponent(mainColor)}" />
        <path d="M 200 230 Q 250 190 310 200 L 310 80 Q 250 70 200 110 Z" fill="%235E7B9B" />
        <line x1="200" y1="110" x2="200" y2="230" stroke="%23ffffff" stroke-width="6" stroke-linecap="round" />
        <!-- Soft book page lines -->
        <line x1="110" y1="110" x2="175" y2="110" stroke="%23ffffff" stroke-width="3" opacity="0.6" />
        <line x1="110" y1="140" x2="175" y2="140" stroke="%23ffffff" stroke-width="3" opacity="0.6" />
        <line x1="110" y1="170" x2="160" y2="170" stroke="%23ffffff" stroke-width="3" opacity="0.6" />
        <line x1="225" y1="110" x2="290" y2="110" stroke="%23ffffff" stroke-width="3" opacity="0.6" />
        <line x1="225" y1="140" x2="290" y2="140" stroke="%23ffffff" stroke-width="3" opacity="0.6" />
        <line x1="225" y1="170" x2="275" y2="170" stroke="%23ffffff" stroke-width="3" opacity="0.6" />
      `;
      break;
    case 'Food & Treats':
      mainColor = '#C9A227'; // Honey
      accentColor = '#F6E9C9';
      iconSvg = `
        <!-- Hot cookie or cupcake cup outline and steaming waves -->
        <path d="M 140 160 C 140 100, 260 100, 260 160 Z" fill="%238F7119" />
        <rect x="150" y="160" width="100" height="70" fill="${encodeURIComponent(mainColor)}" rx="12" />
        <line x1="175" y1="160" x2="175" y2="230" stroke="%235C490F" stroke-width="3" />
        <line x1="200" y1="160" x2="200" y2="230" stroke="%235C490F" stroke-width="3" />
        <line x1="225" y1="160" x2="225" y2="230" stroke="%235C490F" stroke-width="3" />
        <!-- Steaming aroma waves -->
        <path d="M 175 80 Q 185 65 175 50" fill="none" stroke="%238F7119" stroke-width="4" stroke-linecap="round" />
        <path d="M 200 80 Q 210 65 200 50" fill="none" stroke="%238F7119" stroke-width="4" stroke-linecap="round" />
        <path d="M 225 80 Q 235 65 225 50" fill="none" stroke="%238F7119" stroke-width="4" stroke-linecap="round" />
      `;
      break;
    default:
      mainColor = '#7A6F63'; // Ink
      accentColor = '#F3ECE0';
      iconSvg = `
        <!-- Large visual Star representation -->
        <path d="M 200 40 L 240 130 L 333 130 L 258 190 L 288 280 L 200 220 L 112 280 L 142 190 L 67 130 L 160 130 Z" fill="${encodeURIComponent(mainColor)}" stroke="%23ffffff" stroke-width="4" stroke-linejoin="round" />
      `;
      break;
  }

  // Create highly stylized vector greeting background pattern
  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="100%" height="100%">
    <rect width="400" height="300" rx="16" fill="${encodeURIComponent(accentColor)}" />
    <!-- Ambient mesh background grid -->
    <circle cx="0" cy="0" r="230" fill="${encodeURIComponent(mainColor)}" fill-opacity="0.08" />
    <circle cx="400" cy="300" r="180" fill="${encodeURIComponent(mainColor)}" fill-opacity="0.08" />

    ${iconSvg}

    <!-- Title banner overlay -->
    <rect x="0" y="240" width="400" height="60" fill="%2325211C" fill-opacity="0.9" rx="0" />
    <path d=" M 0 240 A 0 0 0 0 1 0 240 L 400 240 A 0 0 0 0 1 400 240 L 400 284 A 16 16 0 0 1 384 300 L 16 300 A 16 16 0 0 1 0 284 Z" fill="%2325211C" />

    <text x="20" y="275" font-family="'Plus Jakarta Sans', sans-serif" font-weight="bold" font-size="16" fill="%23ffffff">${esc(title.toUpperCase())}</text>
  </svg>`;
}
