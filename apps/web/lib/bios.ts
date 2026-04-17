/**
 * Bio file utilities for reading and parsing instructor markdown bios.
 * Instructor bios live in the filesystem under content/bios/, not the database.
 * Used by the /about page server components.
 *
 * Lead instructor:   content/bios/lead-instructor.md
 * Other instructors: content/bios/instructors/[bio_slug].md
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { remark } from "remark";
import remarkHtml from "remark-html";

/** Structured frontmatter extracted from a bio markdown file. */
export interface BioFrontmatter {
  title?: string;
  photo?: string;
  credentials?: string[];
  years_experience?: number;
  students_trained?: string;
}

/** A parsed bio file — frontmatter + HTML-rendered body. */
export interface ParsedBio {
  frontmatter: BioFrontmatter;
  contentHtml: string;
}

/**
 * Reads and parses the lead instructor bio from content/bios/lead-instructor.md.
 * Returns null if the file does not exist or fails to parse — callers must handle null.
 */
export async function getLeadInstructorBio(): Promise<ParsedBio | null> {
  const filePath = path.join(process.cwd(), "content/bios/lead-instructor.md");
  return parseBioFile(filePath);
}

/**
 * Reads and parses an instructor bio by slug from content/bios/instructors/[slug].md.
 * Returns null if the file does not exist or fails to parse — callers must handle null.
 * @param slug - Matches the profiles.bio_slug column for this instructor.
 */
export async function getInstructorBio(slug: string): Promise<ParsedBio | null> {
  const filePath = path.join(
    process.cwd(),
    "content/bios/instructors",
    `${slug}.md`
  );
  return parseBioFile(filePath);
}

/**
 * Reads a markdown file, parses its frontmatter, and renders the body to HTML.
 * Returns null on any error — missing file, parse error, or remark failure.
 * @param filePath - Absolute filesystem path to the markdown file.
 */
async function parseBioFile(filePath: string): Promise<ParsedBio | null> {
  try {
    if (!fs.existsSync(filePath)) return null;
    const fileContents = fs.readFileSync(filePath, "utf8");
    const { data, content } = matter(fileContents);
    const processed = await remark().use(remarkHtml).process(content);
    return {
      frontmatter: data as BioFrontmatter,
      contentHtml: processed.toString(),
    };
  } catch {
    return null;
  }
}
