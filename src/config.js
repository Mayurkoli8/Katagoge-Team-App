/**
 * COMPANY CONFIGURATION
 *
 * To deploy this app for a different company:
 *   1. Edit the values below.
 *   2. Replace public/favicon.svg with the company's icon.
 *   3. Run `npm run build` and deploy.
 *
 * Everything user-facing (page title, logo, login screen, emails) reads from here.
 * No multi-tenancy in the database — each deployment is one company, fully isolated.
 *
 * Future-proofing note: when we eventually go multi-tenant, every Supabase query
 * gets a `where company_id = ${COMPANY.id}` filter. Until then, COMPANY.id is
 * a label; the database doesn't know about it.
 */

export const COMPANY = {
  id: 'katagoge',                       // internal slug, used in storage paths and exports
  name: 'Katagoge',                     // display name
  shortName: 'KGG',                     // 3-letter abbreviation for tight spots
  tagline: 'Weekly accountability · Internal comms',

  /**
   * Square ICON ONLY (not a wordmark). Sits to the left of the brand name.
   * - Place file in /public, then reference with leading slash: '/icon.png'
   * - Recommended: a square SVG or PNG, 64x64 or larger
   * - Set to null to show only text (no icon)
   * - The brand NAME is rendered as text and always picks up the theme color
   */
  iconUrl: '/katagoge_logo.png',

  /** Brand name — always shown, in theme ink color */
  textLogo: 'KATAGOGE',

  /** affects sender name on auth emails (configure in Supabase too) */
  emailFromName: 'Katagoge',

  /** copyright/footer line shown on login */
  footerText: 'KATAGOGE INTERNAL · ALL ACCESS LOGGED · UNAUTHORIZED USE PROHIBITED',
};

/**
 * APP-WIDE FEATURE FLAGS
 * Toggle these to disable features cleanly without removing code.
 */
export const FEATURES = {
  attachments: true,
  chat: true,
  analytics: true,
};

/**
 * THEMES
 * Each theme is a flat map of CSS variables. The `theme` attribute on <html>
 * picks which one is active; CSS reads from var(--name).
 *
 * All themes follow the "operations terminal" aesthetic — paper or muted
 * background, sharp 1px borders, mono headers. No gradients.
 */
export const THEMES = {
  light: {
    label: 'Light',
    desc: 'Default warm paper',
    vars: {
      bg:        '#F4F2E9',
      bgAlt:     '#EBE8DB',
      ink:       '#141414',
      inkSoft:   '#3A3A35',
      muted:     '#7A7972',
      ruleSoft:  '#C8C4B5',
      red:       '#A8321B',
      redSoft:   '#F2D9CF',
      green:     '#2F5D3A',
      greenSoft: '#D4DCC9',
      amber:     '#9C6A14',
      amberSoft: '#EFE0B8',
      blue:      '#1F4368',
      blueSoft:  '#D2DCE6',
      shadow:    'rgba(0,0,0,0.06)',
    },
  },
  dark: {
    label: 'Dark',
    desc: 'Low-light terminal',
    vars: {
      bg:        '#15151A',
      bgAlt:     '#1E1E25',
      ink:       '#E8E6DD',
      inkSoft:   '#B5B2A8',
      muted:     '#7C7A72',
      ruleSoft:  '#34333C',
      red:       '#E07B5F',
      redSoft:   '#3A2520',
      green:     '#7FA98A',
      greenSoft: '#1E2C22',
      amber:     '#D4A24A',
      amberSoft: '#332910',
      blue:      '#7AA1C7',
      blueSoft:  '#1A2530',
      shadow:    'rgba(0,0,0,0.5)',
    },
  },
  gray: {
    label: 'Soft gray',
    desc: 'Muted, professional',
    vars: {
      bg:        '#F0F0EE',
      bgAlt:     '#E5E5E2',
      ink:       '#1F1F1F',
      inkSoft:   '#3A3A3A',
      muted:     '#7A7A7A',
      ruleSoft:  '#C8C8C5',
      red:       '#8C2C20',
      redSoft:   '#E8D4D0',
      green:     '#3A5840',
      greenSoft: '#D6DCD0',
      amber:     '#8A6020',
      amberSoft: '#E8DCC0',
      blue:      '#2A4660',
      blueSoft:  '#D4DCE4',
      shadow:    'rgba(0,0,0,0.05)',
    },
  },
  ink: {
    label: 'Ink on parchment',
    desc: 'Subtle accent',
    vars: {
      bg:        '#FAF7EE',
      bgAlt:     '#F0EBDC',
      ink:       '#0E2238',
      inkSoft:   '#33425A',
      muted:     '#8A8478',
      ruleSoft:  '#D3CBB5',
      red:       '#9B2C1F',
      redSoft:   '#F2D5CC',
      green:     '#2A4F30',
      greenSoft: '#D4DAB8',
      amber:     '#8C5510',
      amberSoft: '#EAD4A8',
      blue:      '#1F3D5C',
      blueSoft:  '#CCD8E2',
      shadow:    'rgba(14,34,56,0.08)',
    },
  },
};

export const DEFAULT_THEME = 'light';

/**
 * UPLOAD LIMITS — keep modest to stay on Supabase free tier (1GB total).
 * Adjust per company config if needed.
 */
export const UPLOAD = {
  maxBytes: 25 * 1024 * 1024,  // 25 MB per file
  // What we accept. We don't enforce strictly — these are for UX hints.
  imageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  videoTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
  // Documents: anything else under the size limit
};
