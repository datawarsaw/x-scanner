// Portable zip of a built extension directory. Archive entries are rooted at the
// extension root (manifest.json at zip top level) so the zip can be unpacked and loaded.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const target = process.argv[2];
if (target !== "chromium" && target !== "firefox") {
  console.error("usage: node scripts/package.mjs chromium|firefox");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const srcDir = target === "firefox" ? "dist-firefox" : "dist-chromium";
const zipName = target === "firefox" ? `x-scanner-${pkg.version}-firefox.zip` : `x-scanner-${pkg.version}.zip`;

function collect(dir, prefix = "") {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === ".DS_Store") continue;
    const rel = prefix ? `${prefix}/${name}` : name;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collect(full, rel));
    else out.push({ name: rel.replaceAll("\\", "/"), data: readFileSync(full) });
  }
  return out;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}

function dosDateTime(d = new Date()) {
  const time = (d.getSeconds() >> 1) | (d.getMinutes() << 5) | (d.getHours() << 11);
  const date = d.getDate() | ((d.getMonth() + 1) << 5) | ((d.getFullYear() - 1980) << 9);
  return { time, date };
}

function zip(files) {
  const { time, date } = dosDateTime();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const uncompressed = file.data;
    const compressed = deflateRawSync(uncompressed);
    const crc = crc32(uncompressed);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(8),
      u16(time),
      u16(date),
      u32(crc),
      u32(compressed.length),
      u32(uncompressed.length),
      u16(name.length),
      u16(0),
      name,
      compressed,
    ]);
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(8),
      u16(time),
      u16(date),
      u32(crc),
      u32(compressed.length),
      u32(uncompressed.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralDir, end]);
}

const files = collect(srcDir);
if (!files.some((f) => f.name === "manifest.json")) {
  console.error(`${srcDir}/manifest.json missing; run npm run build:${target} first`);
  process.exit(1);
}
writeFileSync(zipName, zip(files));
console.log(`${zipName} (${files.length} files, ${statSync(zipName).size} bytes)`);

