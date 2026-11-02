import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const brandDirectory = join(root, "assets", "brand");
const fontsDirectory = join(root, "assets", "fonts");
const fontFiles = [
  join(fontsDirectory, "Lobster-Regular.ttf"),
  join(fontsDirectory, "Oswald-SemiBold.ttf"),
];
const apps = [
  {
    slug: "erp",
    name: "Sabores da Canastra ERP",
    shortName: "Canastra ERP",
    description: "Gestão privada do bar Sabores da Canastra.",
    accent: "#150ab6",
    publicDirectory: join(root, "apps", "erp", "public"),
  },
  {
    slug: "pdv",
    name: "Sabores da Canastra PDV",
    shortName: "Canastra PDV",
    description: "Frente de caixa privada do bar Sabores da Canastra.",
    accent: "#b60a0a",
    publicDirectory: join(root, "apps", "pdv", "public"),
  },
];

async function loadSvg(fileName) {
  return Buffer.from(await readFile(join(brandDirectory, fileName), "utf8"));
}

async function embedLocalFonts(svg) {
  let result = svg;
  for (const fileName of ["Lobster-Regular.ttf", "Oswald-SemiBold.ttf"]) {
    const font = await readFile(join(fontsDirectory, fileName));
    const dataUrl = `data:font/ttf;base64,${font.toString("base64")}`;
    for (const relativePath of [`../fonts/${fileName}`, `fonts/${fileName}`]) {
      for (const quote of ["'", '"', ""]) {
        result = result.replaceAll(
          `url(${quote}${relativePath}${quote})`,
          `url("${dataUrl}")`,
        );
      }
    }
  }
  return result;
}

async function writePng(svg, destination, width) {
  const renderer = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: {
      fontFiles,
      loadSystemFonts: false,
      defaultFontFamily: "Lobster",
    },
  });
  await writeFile(destination, renderer.render().asPng());
}

function icoFromPngs(entries) {
  const headerLength = 6 + entries.length * 16;
  let imageOffset = headerLength;
  const header = Buffer.alloc(headerLength);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const images = [];
  entries.forEach(({ size, png }, index) => {
    const offset = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, offset);
    header.writeUInt8(size === 256 ? 0 : size, offset + 1);
    header.writeUInt8(0, offset + 2);
    header.writeUInt8(0, offset + 3);
    header.writeUInt16LE(1, offset + 4);
    header.writeUInt16LE(32, offset + 6);
    header.writeUInt32LE(png.length, offset + 8);
    header.writeUInt32LE(imageOffset, offset + 12);
    imageOffset += png.length;
    images.push(png);
  });
  return Buffer.concat([header, ...images]);
}

const logo = await loadSvg("logo.svg");
const logoSource = logo.toString("utf8").replace(/^<\?xml[^>]*\?>\s*/, "");
const publicLogo = Buffer.from(await embedLocalFonts(logo.toString("utf8")));
const logoMatch = logoSource.match(
  /<(?:[\w.-]+:)?svg\b[^>]*>([\s\S]*)<\/(?:[\w.-]+:)?svg>\s*$/,
);
if (!logoMatch) throw new Error("SVG da marca inválido");
const logoContent = logoMatch[1]
  .replace(/<([\w.-]+):([\w.-]+)(?=[\s>])/g, "<$2")
  .replace(/<\/([\w.-]+):([\w.-]+)\s*>/g, "</$2>")
  .replace(/<([\w.-]+):style\b[^>]*>[\s\S]*?<\/([\w.-]+):style\s*>/g, "")
  .replace(/<([\w.-]+):style\b[^>]*>[\s\S]*?<\/\1:style\s*>/g, "")
  .replace(/\sdisplay="none"/g, "")
  .trim();
const normalizeNamespace = (markup) =>
  markup
    .replace(/<([\w.-]+):([\w.-]+)(?=[\s>])/g, "<$2")
    .replace(/<\/([\w.-]+):([\w.-]+)\s*>/g, "</$2>");
const extractElement = (name) => {
  const match = logoSource.match(
    new RegExp(`<ns0:${name}\\b[^>]*>[\\s\\S]*?<\\/ns0:${name}>`),
  );
  if (!match) throw new Error(`Elemento ${name} ausente no SVG da marca`);
  return normalizeNamespace(match[0]);
};
const extractGroup = (id) => {
  const match = logoSource.match(
    new RegExp(`<ns0:g\\b(?=[^>]*\\bid="${id}")[^>]*>[\\s\\S]*?<\\/ns0:g>`),
  );
  if (!match) throw new Error(`Grupo ${id} ausente no SVG da marca`);
  return normalizeNamespace(match[0]);
};
const gradients = `${extractElement("radialGradient")}${extractElement("linearGradient")}`;
const mountainArt = `${extractGroup("sol")}${extractGroup("montanhas-e-passaros")}`;
const faviconSource = await readFile(
  join(brandDirectory, "favicon.svg"),
  "utf8",
);
const socialCards = new Map(
  await Promise.all(
    ["erp", "pdv"].map(async (slug) => {
      const template = await loadSvg(`social-card-${slug}.svg`);
      const card = Buffer.from(
        await embedLocalFonts(
          template.toString("utf8").replace("__BRAND_CONTENT__", logoContent),
        ),
      );
      if (card.includes(Buffer.from("__BRAND_CONTENT__")))
        throw new Error(`Marca ausente no cartão social de ${slug}`);
      return [slug, card];
    }),
  ),
);

for (const {
  slug,
  name,
  shortName,
  description,
  accent,
  publicDirectory,
} of apps) {
  const brandPublicDirectory = join(publicDirectory, "brand");
  const fontPublicDirectory = join(publicDirectory, "fonts");
  const otherSlug = slug === "erp" ? "pdv" : "erp";
  await Promise.all([
    mkdir(brandPublicDirectory, { recursive: true }),
    mkdir(fontPublicDirectory, { recursive: true }),
    rm(join(publicDirectory, `social-card-${otherSlug}.svg`), { force: true }),
    rm(join(publicDirectory, `social-card-${otherSlug}.png`), { force: true }),
  ]);

  await writeFile(
    join(brandPublicDirectory, "logo-sabores-canastra.svg"),
    publicLogo,
  );
  await writeFile(join(publicDirectory, "logo.svg"), publicLogo);
  await Promise.all(
    [
      "Lobster-Regular.ttf",
      "Oswald-SemiBold.ttf",
      "OFL-Lobster.txt",
      "OFL-Oswald.txt",
    ].map((fileName) =>
      copyFile(
        join(fontsDirectory, fileName),
        join(fontPublicDirectory, fileName),
      ),
    ),
  );

  const favicon = Buffer.from(
    faviconSource
      .replace("__GRADIENTS__", gradients)
      .replace("__MOUNTAIN_ART__", mountainArt)
      .replace("__APP_ACCENT__", accent),
  );
  await writeFile(join(publicDirectory, "favicon.svg"), favicon);
  const socialCard = socialCards.get(slug);
  if (!socialCard) throw new Error(`Cartão social ausente para ${slug}`);
  await writeFile(join(publicDirectory, `social-card-${slug}.svg`), socialCard);
  await writePng(
    socialCard,
    join(publicDirectory, `social-card-${slug}.png`),
    1200,
  );

  const iconPngs = await Promise.all(
    [16, 32, 48].map(async (size) => {
      const destination = join(publicDirectory, `favicon-${size}x${size}.png`);
      await writePng(favicon, destination, size);
      return { size, png: await readFile(destination) };
    }),
  );
  await writePng(favicon, join(publicDirectory, "apple-touch-icon.png"), 180);
  await writePng(
    favicon,
    join(publicDirectory, "android-chrome-192x192.png"),
    192,
  );
  await writePng(
    favicon,
    join(publicDirectory, "android-chrome-512x512.png"),
    512,
  );
  await writeFile(join(publicDirectory, "favicon.ico"), icoFromPngs(iconPngs));
  await writeFile(
    join(publicDirectory, "robots.txt"),
    "User-agent: *\nDisallow: /\n",
  );
  await writeFile(
    join(publicDirectory, "site.webmanifest"),
    `${JSON.stringify(
      {
        name,
        short_name: shortName,
        description,
        lang: "pt-BR",
        start_url: "/",
        display: "standalone",
        background_color: "#fff9f1",
        theme_color: "#fff9f1",
        icons: [
          {
            src: "/android-chrome-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/android-chrome-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(publicDirectory, "_headers"),
    "/*\n  X-Robots-Tag: noindex, nofollow, noarchive, nosnippet\n",
  );
}

console.log(
  "Assets de marca, favicons e cartões sociais gerados para ERP e PDV.",
);
