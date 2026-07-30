/* German deck suit icons — option C coloré (validated 2026-07-30) */
window.SCHAENPZLI_SUITS = (() => {
  const RED = "#C41E3A";
  const GOLD = "#D4A017";
  const GREEN = "#2F6B3A";

  const LEGACY = {
    hearts: "coeur",
    diamonds: "grelot",
    clubs: "feuille",
    spades: "gland",
  };

  function normalize(id) {
    return LEGACY[id] || id;
  }

  function svgCoeur() {
    return `<svg class="suit-ico" viewBox="0 0 64 64" aria-hidden="true">
      <path fill="${RED}" fill-opacity="0.18" stroke="${RED}" stroke-width="3" stroke-linejoin="round"
        d="M32 52 C32 52 10 36 10 22 C10 14 16 10 22 10 C27 10 31 14 32 18 C33 14 37 10 42 10 C48 10 54 14 54 22 C54 36 32 52 32 52 Z"/>
    </svg>`;
  }

  function svgGrelot() {
    const uid = `g${Math.random().toString(36).slice(2, 7)}`;
    return `<svg class="suit-ico" viewBox="0 0 64 64" aria-hidden="true">
      <defs><clipPath id="${uid}"><ellipse cx="32" cy="28" rx="15" ry="17"/></clipPath></defs>
      <ellipse cx="32" cy="28" rx="15" ry="17" fill="${GOLD}" fill-opacity="0.35" stroke="${GOLD}" stroke-width="3"/>
      <g clip-path="url(#${uid})">
        <rect x="14" y="25" width="36" height="3.5" fill="${GREEN}"/>
        <rect x="14" y="30" width="36" height="3.5" fill="${RED}"/>
      </g>
      <circle cx="32" cy="48" r="4" fill="none" stroke="${GOLD}" stroke-width="3"/>
      <path d="M22 18 Q32 10 42 18" fill="none" stroke="${GOLD}" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`;
  }

  function svgFeuille() {
    const u = Math.random().toString(36).slice(2, 7);
    return `<svg class="suit-ico" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <clipPath id="fl${u}"><rect x="0" y="0" width="32" height="64"/></clipPath>
        <clipPath id="fr${u}"><rect x="32" y="0" width="32" height="64"/></clipPath>
        <path id="ls${u}" d="M32 10 C46 14 50 30 44 44 C38 52 32 54 32 54 C32 54 26 52 20 44 C14 30 18 14 32 10 Z"/>
      </defs>
      <use href="#ls${u}" fill="${GOLD}" fill-opacity="0.9" clip-path="url(#fl${u})"/>
      <use href="#ls${u}" fill="${GREEN}" fill-opacity="0.9" clip-path="url(#fr${u})"/>
      <use href="#ls${u}" fill="none" stroke="${GREEN}" stroke-width="2.5" stroke-opacity="0.85"/>
      <path d="M32 18 L32 50" stroke="${GOLD}" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  }

  function svgGland() {
    return `<svg class="suit-ico" viewBox="0 0 64 64" aria-hidden="true">
      <line x1="32" y1="6" x2="32" y2="11" stroke="${GREEN}" stroke-width="3" stroke-linecap="round"/>
      <path fill="${GREEN}" stroke="${GREEN}" stroke-width="2"
        d="M20 22 C20 14 25 11 32 11 C39 11 44 14 44 22 V27 H20 Z"/>
      <rect x="18" y="26.5" width="28" height="3.5" rx="1" fill="${RED}"/>
      <path fill="${GOLD}" stroke="${GOLD}" stroke-width="2"
        d="M22 30 H42 C45 30 47 33 47 36 V40 C47 50 40 56 32 56 C24 56 17 50 17 40 V36 C17 33 19 30 22 30 Z"/>
    </svg>`;
  }

  const LIST = [
    { id: "coeur", label: "Cœur", svg: svgCoeur },
    { id: "grelot", label: "Grelot", svg: svgGrelot },
    { id: "feuille", label: "Feuille", svg: svgFeuille },
    { id: "gland", label: "Gland", svg: svgGland },
  ];

  function icon(id) {
    const n = normalize(id);
    const s = LIST.find((x) => x.id === n);
    return s ? s.svg() : "?";
  }

  function label(id) {
    const n = normalize(id);
    return LIST.find((x) => x.id === n)?.label || n || "?";
  }

  return { LIST, normalize, icon, label, RED, GOLD, GREEN };
})();
