import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
const base = "http://localhost:5173";
const login = await fetch(base + "/signin-with-chatgpt?return_to=/", {
  redirect: "manual",
});
const cookie = login.headers
  .getSetCookie()
  .map((x) => x.split(";")[0])
  .join("; ");
async function upload(name, bytes, type) {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type }));
  const r = await fetch(base + "/api/upload", {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  assert.equal(r.status, 200, await r.clone().text());
  return r.json();
}
for (const [name, path, xml, type] of [
  [
    "qa-office.docx",
    "word/document.xml",
    "<w:document><w:p><w:r><w:t>Zephyr office document extraction</w:t></w:r></w:p></w:document>",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  [
    "qa-slides.pptx",
    "ppt/slides/slide1.xml",
    "<p:sld><a:t>Zephyr presentation extraction</a:t></p:sld>",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  [
    "qa-sheet.xlsx",
    "xl/sharedStrings.xml",
    "<sst><si><t>Zephyr spreadsheet extraction</t></si></sst>",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
]) {
  const d = await upload(name, zipSync({ [path]: strToU8(xml) }), type);
  assert(d.content.includes("Zephyr"));
}
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
];
const stream = "BT /F1 12 Tf 72 720 Td (Zephyr PDF extraction test) Tj ET";
objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
let pdf = "%PDF-1.4\n";
const offsets = [0];
for (let i = 0; i < objects.length; i++) {
  offsets.push(pdf.length);
  pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}
const start = pdf.length;
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((n) => String(n).padStart(10, "0") + " 00000 n ")
  .join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
const d = await upload("qa-pdf.pdf", strToU8(pdf), "application/pdf");
assert(d.content.includes("Zephyr"));
console.log(
  "PASS: PDF, DOCX, PPTX and XLSX text extraction through the upload API.",
);
