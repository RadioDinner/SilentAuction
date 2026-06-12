// Rebuilds docs/Silent-Auction-Import.xlsx from the CSVs in docs/sheet-template/.
// `xlsx` is intentionally not a project dependency; install it first:
//   npm install --no-save xlsx && node scripts/build-import-xlsx.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const docs = join(dirname(fileURLToPath(import.meta.url)), "..", "docs");
const workbook = XLSX.utils.book_new();

for (const name of ["Config", "Items", "Tickets"]) {
  const csv = XLSX.readFile(join(docs, "sheet-template", `${name}.csv`), {
    raw: true,
  });
  const sheet = csv.Sheets[csv.SheetNames[0]];
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

const out = join(docs, "Silent-Auction-Import.xlsx");
XLSX.writeFile(workbook, out);
console.log(`Wrote ${out}`);
