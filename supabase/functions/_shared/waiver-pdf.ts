// Shared PDF layout utilities for waiver documents.
// Used by both generate-blank-waiver and generate-signed-waiver so that
// header/footer/section parsing stay visually identical across both PDFs.

export const MARGIN = 20;
export const LOGO_W = 36;
export const LOGO_H = 18;
export const FOOTER_RESERVE = 12; // mm reserved at page bottom for footer

// Section numbers that require an initials field after their body text
export const INLINE_INITIALS_SECTIONS = new Set([6, 8, 9]);

// Maps section number → initials_data key (as stored by the signing flow)
export const SECTION_INITIALS_KEYS: Record<number, string> = {
  6: "Cancellations and Refunds",
  8: "Damage Responsibility and Fee",
  9: "Rules and Safety Compliance",
};

export interface WaiverBlock {
  sectionNumber: number | null;
  header: string | null;
  paragraphs: string[];
}

// Fetch and convert a logo URL to a base64 data-URL.
// Uses a 1 KB chunked loop to avoid stack overflow on larger images.
export async function fetchLogoDataUrl(
  logoUrl: string
): Promise<{ dataUrl: string; ext: "JPEG" | "PNG" } | null> {
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1024) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 1024));
    }
    const ct = res.headers.get("content-type") || "image/png";
    const ext: "JPEG" | "PNG" = ct.includes("jpeg") ? "JPEG" : "PNG";
    return { dataUrl: `data:${ct};base64,${btoa(binary)}`, ext };
  } catch {
    return null;
  }
}

// Parse waiver text (as produced by generateWaiverText) into labeled blocks.
// Skips the first 2 paragraphs (business info header + "IMPORTANT" intro) which
// are already shown in the PDF header.
export function parseWaiverSections(waiverText: string): WaiverBlock[] {
  const paragraphs = waiverText.split("\n\n").slice(2);
  const blocks: WaiverBlock[] = [];
  let current: WaiverBlock = { sectionNumber: null, header: null, paragraphs: [] };

  for (const para of paragraphs) {
    const match = para.match(/^(\d+)\. /);
    if (match) {
      if (current.header !== null || current.paragraphs.length > 0) blocks.push(current);
      current = { sectionNumber: parseInt(match[1]), header: para, paragraphs: [] };
    } else {
      current.paragraphs.push(para);
    }
  }
  if (current.header !== null || current.paragraphs.length > 0) blocks.push(current);
  return blocks;
}

// Render the standard page header (title → logo → business info → separator).
// Returns the y position after the separator line (= where content should start).
// Caller must call doc.setPage(p) before calling this for pages > 1.
export function renderPageHeader(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  startY: number,
  logoDataUrl: string | null,
  logoExt: "JPEG" | "PNG",
  businessInfoLine: string
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = startY;

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text("LIABILITY WAIVER AND RENTAL AGREEMENT", pageWidth / 2, y, { align: "center" });
  y += 8;

  if (logoDataUrl) {
    doc.addImage(logoDataUrl, logoExt, (pageWidth - LOGO_W) / 2, y, LOGO_W, LOGO_H);
    y += LOGO_H + 4;
  }

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0, 0, 0);
  doc.text(businessInfoLine, pageWidth / 2, y, { align: "center" });
  y += 5;

  y += 2;
  doc.setDrawColor(180, 180, 180);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  y += 7;

  return y;
}

// Stamp per-page footer on every page (call after all content is rendered).
// leftText = e.g. "Page 1 / 3"
// rightText = e.g. "Signed by: Devon Hawkins · June 30, 2026"
export function stampAllPageFooters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  rightText: string
): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerY = pageHeight - 5;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalPages = (doc.internal as any).getNumberOfPages();

  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(200, 200, 200);
    doc.line(MARGIN, footerY - 5, pageWidth - MARGIN, footerY - 5);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120, 120, 120);
    doc.text(`Page ${p} / ${totalPages}`, MARGIN, footerY);
    if (rightText) {
      doc.text(rightText, pageWidth - MARGIN, footerY, { align: "right" });
    }
    doc.setTextColor(0, 0, 0);
  }
}

// Stamp the per-page header on pages 2+ (page 1 is rendered during initial layout).
export function stampAllPageHeaders(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any,
  contentStartY: number,
  logoDataUrl: string | null,
  logoExt: "JPEG" | "PNG",
  businessInfoLine: string
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalPages = (doc.internal as any).getNumberOfPages();
  for (let p = 2; p <= totalPages; p++) {
    doc.setPage(p);
    renderPageHeader(doc, MARGIN, logoDataUrl, logoExt, businessInfoLine);
  }
  // Return to last page so any further edits go in the right place
  doc.setPage(totalPages);
}
