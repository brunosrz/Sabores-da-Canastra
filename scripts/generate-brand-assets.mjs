import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
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

function svgParts(svg, name) {
  const source = svg.replace(/^<\?xml[^>]*\?>\s*/, "").trim();
  const opening = source.match(/<(?:[\w.-]+:)?svg\b[^>]*>/)?.[0];
  const closing = source.match(/<\/(?:[\w.-]+:)?svg\s*>\s*$/)?.[0];
  if (!opening || !closing) throw new Error(`SVG inválido: ${name}`);
  const closingIndex = source.length - closing.length;
  return {
    opening,
    content: source.slice(opening.length, closingIndex),
    closing,
  };
}

function silhouetteMarkup(source, name, strokeWidth) {
  const { content } = svgParts(source, name);
  const shapes = content
    .replace(
      /<(?:[\w.-]+:)?title\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?title\s*>/g,
      "",
    )
    .replace(/<(?:[\w.-]+:)?desc\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?desc\s*>/g, "")
    .trim();
  return `<g fill="#fff" stroke="#fff" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${shapes}</g>`;
}

function addBehindSilhouette(svg, silhouette, name) {
  const { opening, content, closing } = svgParts(svg, name);
  return `${opening}${silhouette}${content}${closing}`;
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

function runSvgFormatter(paths) {
  const result = spawnSync(
    "uv",
    ["run", "python", "scripts/optimize_svg_files.py", ...paths],
    {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, SABORES_GENERATING_BRAND_ASSETS: "1" },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `SVGO encerrou com código ${result.status ?? "desconhecido"}`,
    );
  }
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
const logoSilhouette = await loadSvg("logo-silhouette.svg");
const logoSilhouetteLayer = silhouetteMarkup(
  logoSilhouette.toString("utf8"),
  "logo-silhouette.svg",
  12,
);
const publicLogo = Buffer.from(
  await embedLocalFonts(
    addBehindSilhouette(logoSource, logoSilhouetteLayer, "logo.svg"),
  ),
);
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
const logoCompositeContent = `${logoSilhouetteLayer}${logoContent}`;
const faviconSource = (await loadSvg("favicon.svg")).toString("utf8");
const faviconSilhouette = await loadSvg("favicon-silhouette.svg");
const faviconSilhouetteLayer = silhouetteMarkup(
  faviconSilhouette.toString("utf8"),
  "favicon-silhouette.svg",
  12,
);
const socialCards = new Map(
  await Promise.all(
    ["erp", "pdv"].map(async (slug) => {
      const template = await loadSvg(`social-card-${slug}.svg`);
      const card = Buffer.from(
        await embedLocalFonts(
          template
            .toString("utf8")
            .replace("__BRAND_CONTENT__", logoCompositeContent),
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

  const {
    opening: faviconOpening,
    content: faviconContent,
    closing: faviconClosing,
  } = svgParts(faviconSource, "favicon.svg");
  const favicon = Buffer.from(
    `${faviconOpening}<title>${name}</title>${faviconSilhouetteLayer}${faviconContent}<circle id="app-accent" cx="453" cy="78" r="22" fill="${accent}" stroke="#fff" stroke-width="7"/>${faviconClosing}`,
  );
  await writeFile(join(publicDirectory, "favicon.svg"), favicon);
  const socialCard = socialCards.get(slug);
  if (!socialCard) throw new Error(`Cartão social ausente para ${slug}`);
  await writeFile(join(publicDirectory, `social-card-${slug}.svg`), socialCard);
  runSvgFormatter([
    join(brandPublicDirectory, "logo-sabores-canastra.svg"),
    join(publicDirectory, "logo.svg"),
    join(publicDirectory, "favicon.svg"),
    join(publicDirectory, `social-card-${slug}.svg`),
  ]);
  const optimizedSocialCard = await readFile(
    join(publicDirectory, `social-card-${slug}.svg`),
  );
  const optimizedFavicon = await readFile(join(publicDirectory, "favicon.svg"));
  await writePng(
    optimizedSocialCard,
    join(publicDirectory, `social-card-${slug}.png`),
    1200,
  );

  const iconPngs = await Promise.all(
    [16, 32, 48].map(async (size) => {
      const destination = join(publicDirectory, `favicon-${size}x${size}.png`);
      await writePng(optimizedFavicon, destination, size);
      return { size, png: await readFile(destination) };
    }),
  );
  await writePng(
    optimizedFavicon,
    join(publicDirectory, "apple-touch-icon.png"),
    180,
  );
  await writePng(
    optimizedFavicon,
    join(publicDirectory, "android-chrome-192x192.png"),
    192,
  );
  await writePng(
    optimizedFavicon,
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
