import type { TabColor, ThemeId } from "./types";

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  description: string;
  vars: Record<string, string>;
  fonts: { title: string; body: string; serif: string; mono: string };
  tabColors: Record<TabColor, string>;
}

const FONT_HAND_TITLE = `"Caveat", "Segoe Print", "Bradley Hand", cursive`;
const FONT_HAND_BODY = `"Neucha", "Segoe Print", "Bradley Hand", cursive`;
const FONT_SERIF = `"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif`;
const FONT_MONO = `"Courier Prime", "Courier New", Courier, monospace`;

const CLASSIC_TABS: Record<TabColor, string> = {
  cream: "#d8cbab",
  ocean: "#7695a8",
  sage: "#95a078",
  rust: "#a8664c",
  plum: "#85607a",
  gold: "#b79a5b",
  charcoal: "#5e564b",
  rose: "#b1847f",
};

export const THEMES: ThemeDefinition[] = [
  {
    id: "classic",
    name: "Classic Journal",
    description: "Sun-warmed paper, oxblood ink, worn leather.",
    fonts: { title: FONT_HAND_TITLE, body: FONT_HAND_BODY, serif: FONT_SERIF, mono: FONT_MONO },
    tabColors: CLASSIC_TABS,
    vars: {
      "--fb-desk": "#171310",
      "--fb-desk-glow": "rgba(123, 88, 48, 0.28)",
      "--fb-cover": "#2c2018",
      "--fb-cover-2": "#1d150f",
      "--fb-cover-line": "rgba(196, 158, 108, 0.22)",
      "--fb-paper": "#e9dfc4",
      "--fb-paper-2": "#e2d5b4",
      "--fb-paper-3": "#f1e8d1",
      "--fb-paper-edge": "#c9b78f",
      "--fb-ink": "#2b251c",
      "--fb-ink-soft": "#5e5341",
      "--fb-accent": "#8a3b2e",
      "--fb-accent-soft": "rgba(138, 59, 46, 0.14)",
      "--fb-rule": "rgba(88, 115, 126, 0.24)",
      "--fb-spine": "rgba(74, 52, 33, 0.55)",
      "--fb-tab-text": "#3a3124",
      "--fb-grain-opacity": "0.36",
      "--fb-selection": "#8a3b2e",
      "--fb-highlight": "#e7c45a",
      "--fb-page-shadow": "rgba(39, 24, 11, 0.48)",
      "--fb-book-shadow": "rgba(0, 0, 0, 0.72)",
      "--fb-toolbar": "rgba(24, 20, 16, 0.86)",
      "--fb-toolbar-border": "rgba(214, 180, 128, 0.16)",
      "--fb-toolbar-text": "#e8dcc4",
      "--fb-toolbar-muted": "#9e907a",
    },
  },
  {
    id: "manuscript",
    name: "Old Manuscript",
    description: "Foxed parchment, sepia ink, a scholar's desk.",
    fonts: { title: FONT_SERIF, body: FONT_HAND_BODY, serif: FONT_SERIF, mono: FONT_MONO },
    tabColors: {
      cream: "#d6c8a5",
      ocean: "#6c7f86",
      sage: "#7f8260",
      rust: "#966148",
      plum: "#775a63",
      gold: "#ac8e50",
      charcoal: "#574f42",
      rose: "#a98272",
    },
    vars: {
      "--fb-desk": "#12100d",
      "--fb-desk-glow": "rgba(108, 82, 45, 0.3)",
      "--fb-cover": "#332417",
      "--fb-cover-2": "#20160d",
      "--fb-cover-line": "rgba(183, 144, 92, 0.22)",
      "--fb-paper": "#e6d8b6",
      "--fb-paper-2": "#dbc9a2",
      "--fb-paper-3": "#efe3c6",
      "--fb-paper-edge": "#bfa77c",
      "--fb-ink": "#3b2c1c",
      "--fb-ink-soft": "#6b573c",
      "--fb-accent": "#7a4a25",
      "--fb-accent-soft": "rgba(122, 74, 37, 0.14)",
      "--fb-rule": "rgba(120, 88, 51, 0.2)",
      "--fb-spine": "rgba(80, 54, 29, 0.55)",
      "--fb-tab-text": "#40301e",
      "--fb-grain-opacity": "0.44",
      "--fb-selection": "#7a4a25",
      "--fb-highlight": "#d9b757",
      "--fb-page-shadow": "rgba(35, 22, 10, 0.5)",
      "--fb-book-shadow": "rgba(0, 0, 0, 0.76)",
      "--fb-toolbar": "rgba(25, 20, 14, 0.87)",
      "--fb-toolbar-border": "rgba(200, 166, 112, 0.16)",
      "--fb-toolbar-text": "#e9dcc0",
      "--fb-toolbar-muted": "#a39272",
    },
  },
  {
    id: "clean",
    name: "Clean Paper",
    description: "Bright stock, precise type, no distraction.",
    fonts: {
      title: `"Georgia", "Iowan Old Style", "Times New Roman", serif`,
      body: `"Inter", "Segoe UI", system-ui, sans-serif`,
      serif: FONT_SERIF,
      mono: FONT_MONO,
    },
    tabColors: {
      cream: "#e7e3da",
      ocean: "#8fa8b7",
      sage: "#a3ad97",
      rust: "#b1806b",
      plum: "#9c8596",
      gold: "#c3ae7f",
      charcoal: "#7b776f",
      rose: "#c4a09a",
    },
    vars: {
      "--fb-desk": "#22262a",
      "--fb-desk-glow": "rgba(255, 255, 255, 0.08)",
      "--fb-cover": "#393833",
      "--fb-cover-2": "#2a2925",
      "--fb-cover-line": "rgba(255, 255, 255, 0.14)",
      "--fb-paper": "#fbfaf6",
      "--fb-paper-2": "#f4f2ec",
      "--fb-paper-3": "#ffffff",
      "--fb-paper-edge": "#d8d4c9",
      "--fb-ink": "#23272b",
      "--fb-ink-soft": "#6a7076",
      "--fb-accent": "#3f6b62",
      "--fb-accent-soft": "rgba(63, 107, 98, 0.1)",
      "--fb-rule": "rgba(99, 129, 148, 0.2)",
      "--fb-spine": "rgba(46, 49, 45, 0.28)",
      "--fb-tab-text": "#35393c",
      "--fb-grain-opacity": "0.14",
      "--fb-selection": "#3f6b62",
      "--fb-highlight": "#f0d878",
      "--fb-page-shadow": "rgba(20, 22, 21, 0.3)",
      "--fb-book-shadow": "rgba(0, 0, 0, 0.55)",
      "--fb-toolbar": "rgba(28, 31, 32, 0.9)",
      "--fb-toolbar-border": "rgba(255, 255, 255, 0.12)",
      "--fb-toolbar-text": "#f2f1ec",
      "--fb-toolbar-muted": "#9fa4a3",
    },
  },
  {
    id: "dark",
    name: "Dark Journal",
    description: "Charcoal pages, pale ink, lamplight.",
    fonts: { title: FONT_HAND_TITLE, body: FONT_HAND_BODY, serif: FONT_SERIF, mono: FONT_MONO },
    tabColors: {
      cream: "#4a443a",
      ocean: "#3f5662",
      sage: "#4c5642",
      rust: "#68483b",
      plum: "#574352",
      gold: "#6b5b3c",
      charcoal: "#383531",
      rose: "#644f4b",
    },
    vars: {
      "--fb-desk": "#0a0908",
      "--fb-desk-glow": "rgba(184, 134, 72, 0.16)",
      "--fb-cover": "#191512",
      "--fb-cover-2": "#0e0c0a",
      "--fb-cover-line": "rgba(214, 169, 104, 0.18)",
      "--fb-paper": "#2d2a25",
      "--fb-paper-2": "#272420",
      "--fb-paper-3": "#34302a",
      "--fb-paper-edge": "#1b1916",
      "--fb-ink": "#e7dcc7",
      "--fb-ink-soft": "#b3a58c",
      "--fb-accent": "#c89551",
      "--fb-accent-soft": "rgba(200, 149, 81, 0.16)",
      "--fb-rule": "rgba(198, 173, 128, 0.14)",
      "--fb-spine": "rgba(0, 0, 0, 0.6)",
      "--fb-tab-text": "#d8ccb4",
      "--fb-grain-opacity": "0.26",
      "--fb-selection": "#cf9a50",
      "--fb-highlight": "#a8873e",
      "--fb-page-shadow": "rgba(0, 0, 0, 0.6)",
      "--fb-book-shadow": "rgba(0, 0, 0, 0.85)",
      "--fb-toolbar": "rgba(16, 14, 12, 0.9)",
      "--fb-toolbar-border": "rgba(216, 174, 111, 0.16)",
      "--fb-toolbar-text": "#eadfc8",
      "--fb-toolbar-muted": "#92846d",
    },
  },
  {
    id: "field",
    name: "Field Research",
    description: "Olive canvas, survey grid, graphite annotations.",
    fonts: {
      title: `"Courier New", "Courier Prime", Courier, monospace`,
      body: FONT_HAND_BODY,
      serif: FONT_SERIF,
      mono: FONT_MONO,
    },
    tabColors: {
      cream: "#cfc6a2",
      ocean: "#6e8385",
      sage: "#82906b",
      rust: "#9a684c",
      plum: "#74616a",
      gold: "#ab9255",
      charcoal: "#565343",
      rose: "#a88674",
    },
    vars: {
      "--fb-desk": "#141712",
      "--fb-desk-glow": "rgba(122, 133, 82, 0.2)",
      "--fb-cover": "#303225",
      "--fb-cover-2": "#1e2018",
      "--fb-cover-line": "rgba(196, 196, 154, 0.2)",
      "--fb-paper": "#e3ddc2",
      "--fb-paper-2": "#d9d2b3",
      "--fb-paper-3": "#ede8d1",
      "--fb-paper-edge": "#bdb58f",
      "--fb-ink": "#2e3328",
      "--fb-ink-soft": "#5e6450",
      "--fb-accent": "#55613f",
      "--fb-accent-soft": "rgba(85, 97, 63, 0.14)",
      "--fb-rule": "rgba(86, 109, 118, 0.24)",
      "--fb-spine": "rgba(60, 62, 40, 0.5)",
      "--fb-tab-text": "#343827",
      "--fb-grain-opacity": "0.32",
      "--fb-selection": "#55613f",
      "--fb-highlight": "#d8c05c",
      "--fb-page-shadow": "rgba(27, 29, 17, 0.46)",
      "--fb-book-shadow": "rgba(0, 0, 0, 0.74)",
      "--fb-toolbar": "rgba(22, 25, 19, 0.9)",
      "--fb-toolbar-border": "rgba(203, 204, 166, 0.16)",
      "--fb-toolbar-text": "#e8e2c9",
      "--fb-toolbar-muted": "#9b9c83",
    },
  },
];

export const THEME_MAP: Record<ThemeId, ThemeDefinition> = Object.fromEntries(
  THEMES.map((t) => [t.id, t]),
) as Record<ThemeId, ThemeDefinition>;

const NOISE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="240" height="240" filter="url(#n)" opacity="0.7"/></svg>`;

export const PAPER_NOISE_URL = `url("data:image/svg+xml,${encodeURIComponent(NOISE_SVG)}")`;

export type PaperTone = "light" | "dark";

const INK_VARS = [
  "--fb-ink",
  "--fb-ink-soft",
  "--fb-accent",
  "--fb-accent-soft",
  "--fb-rule",
  "--fb-selection",
  "--fb-highlight",
] as const;

function inkOf(themeId: ThemeId): Record<string, string> {
  const theme = THEME_MAP[themeId] ?? THEME_MAP.classic;
  return Object.fromEntries(INK_VARS.map((name) => [name, theme.vars[name]]));
}

export function applyTheme(
  host: HTMLElement,
  themeId: ThemeId,
  options: {
    titleFont?: string;
    bodyFont?: string;
    paperTextureUrl?: string;
    paperTone?: PaperTone | null;
  } = {},
): void {
  const theme = THEME_MAP[themeId] ?? THEME_MAP.classic;
  host.setAttribute("data-fb-theme", theme.id);
  for (const [name, value] of Object.entries(theme.vars)) {
    host.style.setProperty(name, value);
  }
  if (options.paperTone) {
    const ink = inkOf(options.paperTone === "light" ? "classic" : "dark");
    for (const [name, value] of Object.entries(ink)) host.style.setProperty(name, value);
    host.dataset.paperTone = options.paperTone;
  } else {
    delete host.dataset.paperTone;
  }
  host.style.setProperty("--fb-font-title", options.titleFont?.trim() || theme.fonts.title);
  host.style.setProperty("--fb-font-body", options.bodyFont?.trim() || theme.fonts.body);
  host.style.setProperty("--fb-font-serif", theme.fonts.serif);
  host.style.setProperty("--fb-font-mono", theme.fonts.mono);
  host.style.setProperty("--fb-noise", PAPER_NOISE_URL);
  if (options.paperTextureUrl) {
    host.style.setProperty("--fb-custom-paper", `url("${options.paperTextureUrl}")`);
    host.classList.add("is-custom-paper");
  } else {
    host.style.removeProperty("--fb-custom-paper");
    host.classList.remove("is-custom-paper");
  }
}

export function tabColorValue(themeId: ThemeId, color: TabColor): string {
  return (THEME_MAP[themeId] ?? THEME_MAP.classic).tabColors[color] ?? CLASSIC_TABS.cream;
}
