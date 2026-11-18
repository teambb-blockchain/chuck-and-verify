"use strict";

// A one-page PDF with a title and lines of text, for the demo's mock
// documents. Standard Helvetica only, so no fonts are embedded, and the
// output is deterministic: the same text always gives the same bytes, which
// keeps the on-chain report and notice fingerprints stable across reruns.

// PDF strings escape \, ( and ). Keep to printable ASCII.
function pdfText(text) {
  return String(text)
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/[\\()]/g, (c) => "\\" + c);
}

// lines: [{ text, size?, bold?, gap? }]. Long lines wrap at ~90 characters.
function makePdf(title, lines) {
  const wrapped = [];
  for (const line of lines) {
    const words = String(line.text || "").split(" ");
    const max = line.size && line.size > 12 ? 60 : 90;
    let current = "";
    for (const word of words) {
      if ((current + " " + word).trim().length > max) {
        wrapped.push({ ...line, text: current.trim() });
        current = word;
      } else {
        current += " " + word;
      }
    }
    wrapped.push({ ...line, text: current.trim() });
  }

  let y = 760;
  const ops = [];
  ops.push("BT /F2 18 Tf 56 " + y + " Td (" + pdfText(title) + ") Tj ET");
  y -= 34;
  for (const line of wrapped) {
    const size = line.size || 11;
    y -= line.gap || 0;
    ops.push("BT /" + (line.bold ? "F2" : "F1") + " " + size + " Tf 56 " + y + " Td (" + pdfText(line.text) + ") Tj ET");
    y -= Math.round(size * 1.5);
  }
  ops.push("0.6 G 56 60 m 556 60 l S");
  ops.push("BT /F1 8 Tf 56 48 Td (" + pdfText("Sample document generated for the Chuck and Verify demo. Not a real record.") + ") Tj ET");
  const content = ops.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    "<< /Length " + Buffer.byteLength(content) + " >>\nstream\n" + content + "\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += i + 1 + " 0 obj\n" + body + "\nendobj\n";
  });
  const xref = Buffer.byteLength(out);
  out += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  for (const offset of offsets) out += String(offset).padStart(10, "0") + " 00000 n \n";
  out += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return Buffer.from(out, "latin1");
}

module.exports = { makePdf };
