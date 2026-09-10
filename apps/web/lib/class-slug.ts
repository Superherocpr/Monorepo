/**
 * Canonical class-type slug helper.
 *
 * A class type's slug is the join key between every public surface that talks
 * about a class: the /classes anchor IDs, the ?class= filter on /book, and the
 * job-to-class mapping in lib/class-recommendations.ts. All of them must derive
 * it the same way or the handoffs silently stop matching, so this is the single
 * definition. It previously existed as three separate copies in
 * ClassTypeCards.tsx, ClassTypesSection.tsx and BookSessionSelector.tsx.
 */

/**
 * Converts a class type name to a URL-safe slug.
 *
 * Leading and trailing separators are trimmed, so a name ending in punctuation
 * (e.g. "Online Heartsaver® First Aid (Skills Assessment)") does not produce a
 * trailing dash. Every caller uses this function, so the trim stays consistent
 * across the anchor, the filter and the mapping.
 *
 * @param name - The class type name as stored in class_types.name.
 * @returns A lowercase, dash-separated slug with no leading or trailing dashes.
 */
export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
