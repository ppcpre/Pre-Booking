// Renders the PWA icons in public/icons from the logo (B · Doorway). Run: npm run icons
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const door = (s = 1, dx = 0, dy = 0, color = "#2c6a55", cells = ["#a8dbc5", "#a8dbc5", "#a8dbc5", "#ffffff"]) => `
  <g transform="translate(${dx} ${dy}) scale(${s})">
    <path d="M17 52V30a15 15 0 0 1 30 0v22z" fill="${color}"/>
    <rect x="24" y="31" width="7" height="7" rx="1.8" fill="${cells[0]}"/>
    <rect x="33" y="31" width="7" height="7" rx="1.8" fill="${cells[1]}"/>
    <rect x="24" y="40" width="7" height="7" rx="1.8" fill="${cells[2]}"/>
    <rect x="33" y="40" width="7" height="7" rx="1.8" fill="${cells[3]}"/>
  </g>`;

// Regular icon: white rounded tile with a light mint edge.
const regular = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#ffffff"/>
  <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="13.5" fill="none" stroke="#dcf1e7" stroke-width="1.5"/>${door()}</svg>`;

// Maskable: full-bleed mint background, mark shrunk into the 80% safe zone.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#eef8f3"/>${door(0.72, 8.96, 7.2)}</svg>`;

// Apple touch icon: iOS rounds corners itself, so a square white tile.
const apple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#ffffff"/>${door(0.86, 4.5, 3)}</svg>`;

// Monochrome (notification badge): white door with the calendar cells cut out, on transparent.
const mono = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <mask id="cells"><rect width="64" height="64" fill="#fff"/>
    <g fill="#000"><rect x="24" y="27" width="7" height="7" rx="1.8"/><rect x="33" y="27" width="7" height="7" rx="1.8"/><rect x="24" y="36" width="7" height="7" rx="1.8"/><rect x="33" y="36" width="7" height="7" rx="1.8"/></g>
  </mask>
  <path d="M17 48V26a15 15 0 0 1 30 0v22z" fill="#fff" mask="url(#cells)"/></svg>`;

await mkdir("public/icons", { recursive: true });
const out = [
  [regular, 192, "icon-192.png"],
  [regular, 512, "icon-512.png"],
  [maskable, 512, "maskable-512.png"],
  [apple, 180, "apple-touch-icon.png"],
  [mono, 192, "monochrome-192.png"],
];
for (const [svg, size, name] of out) {
  await sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png().toFile(`public/icons/${name}`);
  console.log("wrote", name);
}
