/**
 * Badge — status pill used across both the public site and admin panel.
 * Semantic color variants match the status color system in DESIGN-SYSTEM.md §2.
 * Every badge must include a text label — color alone never conveys meaning.
 */

type BadgeVariant =
  | "success"   // green — active, paid, completed
  | "warning"   // amber — expiring, pending, awaiting approval
  | "danger"    // red   — expired, rejected, cancelled
  | "info"      // blue  — upcoming, sent, scheduled
  | "neutral";  // gray  — inactive, archived, deactivated

interface BadgeProps {
  /** Semantic color variant. Required. */
  variant: BadgeVariant;
  /** The text label displayed inside the badge. */
  children: React.ReactNode;
  /** Additional Tailwind classes to merge in. */
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  success: "bg-green-100 text-green-800",
  warning: "bg-amber-100 text-amber-800",
  danger:  "bg-red-100 text-red-700",
  info:    "bg-blue-100 text-blue-800",
  neutral: "bg-gray-100 text-gray-600",
};

/**
 * Renders a status pill badge.
 * @param variant - Semantic color: "success" | "warning" | "danger" | "info" | "neutral".
 * @param children - Label text displayed inside the badge.
 * @param className - Additional Tailwind classes.
 */
export function Badge({ variant, children, className = "" }: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
        variantClasses[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}
