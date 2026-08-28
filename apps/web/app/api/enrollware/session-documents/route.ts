/**
 * GET /api/enrollware/session-documents
 * Called by: Enrollware bookmarklet when preparing the Documents section.
 * Auth: Bearer API key (validated against api_keys table via enrollware-api-auth)
 *
 * Fetches per-student documents for the given ?sessionId, merges each student's
 * files into a single PDF using pdf-lib, and returns a JSON response:
 *   { documents: [{ studentName: string, fileName: string, pdf: string }] }
 * where `pdf` is a base64-encoded PDF string ready to be reconstructed as a File
 * object in the bookmarklet and injected into Enrollware's Documents upload widget.
 *
 * Files are downloaded from their public S3 URLs. JPEG and PNG images are embedded
 * as full-page letter-size images; existing PDFs are page-merged via copyPages;
 * WebP files are converted to JPEG via sharp before embedding. Sessions with no
 * documents return { documents: [] } with a 200 status.
 *
 * Only succeeds when the session belongs to the authenticated instructor — the
 * same ownership gate as /api/enrollware/student-xlsx.
 * Handles OPTIONS preflight for CORS.
 */

import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/server";
import {
  validateEnrollwareKey,
  enrollwareCorsHeaders,
} from "@/lib/enrollware-api-auth";

export async function OPTIONS(request: NextRequest): Promise<Response> {
  const origin = request.headers.get("Origin");
  return new Response(null, {
    status: 204,
    headers: enrollwareCorsHeaders(origin),
  });
}

// US Letter dimensions in PDF points (72 pt/in × 8.5 in / 11 in)
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 36; // 0.5 inch

type ProfileRow = { first_name: string; last_name: string };

type DocRow = {
  file_url: string;
  file_name: string;
  content_type: string;
  bookings: { profiles: ProfileRow | null } | null;
  roster_records: ProfileRow | null;
};

/**
 * Resolves the student name from either the linked booking's profile or the
 * roster_record, matching the dual-representation used elsewhere in the app.
 */
function getStudentName(doc: DocRow): string {
  const profile = doc.bookings?.profiles;
  if (profile) return `${profile.first_name} ${profile.last_name}`.trim();
  const rr = doc.roster_records;
  if (rr) return `${rr.first_name} ${rr.last_name}`.trim();
  return "Unknown Student";
}

/**
 * Embeds an image buffer (JPEG or PNG) as a full-page image on a new letter-size
 * page in the PDF, scaled to fit within the margins while preserving aspect ratio.
 */
async function embedImagePage(
  pdfDoc: PDFDocument,
  bytes: Buffer,
  format: "jpeg" | "png"
): Promise<void> {
  const img =
    format === "jpeg" ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);
  const { width, height } = img;
  const maxW = PAGE_WIDTH - MARGIN * 2;
  const maxH = PAGE_HEIGHT - MARGIN * 2;
  const scale = Math.min(maxW / width, maxH / height, 1);
  const drawW = width * scale;
  const drawH = height * scale;
  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.drawImage(img, {
    x: (PAGE_WIDTH - drawW) / 2,
    y: (PAGE_HEIGHT - drawH) / 2,
    width: drawW,
    height: drawH,
  });
}

/**
 * Downloads and merges all documents for one student into a single PDF.
 * Images are embedded as full-page images; PDFs are page-merged; WebP is
 * converted to JPEG via sharp. Individual file failures are skipped so a
 * corrupt file does not prevent the other student's documents from merging.
 */
async function mergeDocsToPdf(docs: DocRow[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();

  for (const doc of docs) {
    let res: globalThis.Response;
    try {
      res = await fetch(doc.file_url);
      if (!res.ok) continue;
    } catch {
      continue;
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    const ct = doc.content_type;

    try {
      if (ct === "application/pdf") {
        const srcPdf = await PDFDocument.load(bytes);
        const indices = srcPdf.getPageIndices();
        const pages = await pdfDoc.copyPages(srcPdf, indices);
        pages.forEach((p) => pdfDoc.addPage(p));
      } else if (ct === "image/jpeg" || ct === "image/jpg") {
        await embedImagePage(pdfDoc, bytes, "jpeg");
      } else if (ct === "image/png") {
        await embedImagePage(pdfDoc, bytes, "png");
      } else if (ct === "image/webp") {
        const jpeg = await sharp(bytes).jpeg({ quality: 90 }).toBuffer();
        await embedImagePage(pdfDoc, jpeg, "jpeg");
      }
      // HEIC/HEIF: converted to JPEG at upload time; skip silently if somehow present
    } catch {
      console.error(`[session-documents] Failed to embed "${doc.file_name}" — skipping`);
    }
  }

  return pdfDoc.save();
}

export async function GET(request: NextRequest): Promise<Response> {
  const origin = request.headers.get("Origin");
  const cors = enrollwareCorsHeaders(origin);

  const auth = await validateEnrollwareKey(request);
  if (!auth.ok) {
    const body = await auth.response.text();
    return new Response(body, {
      status: auth.response.status,
      headers: {
        "Content-Type": auth.response.headers.get("Content-Type") ?? "application/json",
        ...cors,
      },
    });
  }

  const { profileId } = auth;

  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json(
      { error: "sessionId is required." },
      { status: 400, headers: cors }
    );
  }

  const admin = await createAdminClient();

  // Ownership gate: confirm this session belongs to the authenticated instructor.
  // Same pattern as student-xlsx — no information leakage on 404 vs 403.
  const { data: session, error: sessionError } = await admin
    .from("class_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("instructor_id", profileId)
    .single();

  if (sessionError || !session) {
    return Response.json(
      { error: "Session not found or not authorized." },
      { status: 404, headers: cors }
    );
  }

  // Fetch all documents for this session with enough join data to resolve student
  // names. booking_id → bookings → profiles covers students with accounts;
  // roster_record_id → roster_records covers rollcall/walk-in students.
  const { data: docs, error: docsError } = await admin
    .from("student_documents")
    .select(`
      file_url, file_name, content_type,
      bookings (
        profiles!bookings_customer_id_fkey ( first_name, last_name )
      ),
      roster_records ( first_name, last_name )
    `)
    .eq("session_id", sessionId)
    .order("created_at");

  if (docsError) {
    console.error("[session-documents] Query error:", docsError.message);
    return Response.json(
      { error: "Failed to fetch documents." },
      { status: 500, headers: cors }
    );
  }

  if (!docs || docs.length === 0) {
    return Response.json({ documents: [] }, { headers: cors });
  }

  // Group documents by student name, preserving upload order within each group.
  // One PDF per student keeps the file count at max one-per-student, well under
  // Enrollware's 20-file batch limit even for a full 15-student BLS class.
  const byStudent = new Map<string, DocRow[]>();
  for (const doc of docs) {
    const name = getStudentName(doc as unknown as DocRow);
    if (!byStudent.has(name)) byStudent.set(name, []);
    byStudent.get(name)!.push(doc as unknown as DocRow);
  }

  // Merge each student's documents into one PDF, then base64-encode for JSON transport.
  // Students whose files all fail to embed are omitted rather than producing an empty PDF.
  const result: { studentName: string; fileName: string; pdf: string }[] = [];

  for (const [name, studentDocs] of byStudent) {
    try {
      const pdfBytes = await mergeDocsToPdf(studentDocs);
      if (pdfBytes.length <= 0) continue;
      result.push({
        studentName: name,
        fileName: `${name} - Documents.pdf`,
        pdf: Buffer.from(pdfBytes).toString("base64"),
      });
    } catch {
      console.error(`[session-documents] PDF merge failed for "${name}" — skipping`);
    }
  }

  return Response.json({ documents: result }, { headers: cors });
}
