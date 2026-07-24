/** Flesch-Kincaid readability score (higher = easier to read, target 60-70) */
export function fleschKincaid(text: string): number {
  const sentences = countSentences(text);
  const words = countWords(text);
  const syllables = countSyllables(text);
  if (sentences === 0 || words === 0) return 0;
  return 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words);
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function countSentences(text: string): number {
  const matches = text.match(/[.!?]+/g);
  return matches ? matches.length : 1;
}

export function countSyllables(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  return words.reduce((total, word) => total + syllablesInWord(word), 0);
}

function syllablesInWord(word: string): number {
  word = word.replace(/[^a-z]/g, "");
  if (!word) return 0;
  const vowelGroups = word.match(/[aeiouy]+/g);
  let count = vowelGroups ? vowelGroups.length : 1;
  if (word.endsWith("e") && count > 1) count--;
  return Math.max(1, count);
}

export interface KeywordDensityResult {
  count: number;
  density: number; // percentage
}

export function keywordDensity(
  text: string,
  keyword: string
): KeywordDensityResult {
  const words = countWords(text);
  const keywordWords = keyword.toLowerCase().split(/\s+/);
  const textLower = text.toLowerCase();

  // Count non-overlapping occurrences
  let count = 0;
  let pos = 0;
  const phrase = keywordWords.join(" ");
  while ((pos = textLower.indexOf(phrase, pos)) !== -1) {
    count++;
    pos += phrase.length;
  }

  const density = words > 0 ? (count * keywordWords.length * 100) / words : 0;
  return { count, density: Math.round(density * 100) / 100 };
}

export interface HeadingStructure {
  tag: string;
  text: string;
}

export function extractHeadings(markdown: string): HeadingStructure[] {
  const lines = markdown.split("\n");
  const headings: HeadingStructure[] = [];
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headings.push({ tag: `h${match[1].length}`, text: match[2].trim() });
    }
  }
  return headings;
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/!\[.+?\]\(.+?\)/g, "")
    .replace(/^\s*[-*+]\s/gm, "")
    .replace(/^\s*\d+\.\s/gm, "");
}
