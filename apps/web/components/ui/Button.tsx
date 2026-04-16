/**
 * Button — shared primitive used across both the public site and admin panel.
 * Supports primary (red), secondary (outline red), and destructive variants.
 * All variant styles are sourced from DESIGN-SYSTEM.md §4 and §5.
 */
import { type ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. Defaults to "primary". */
  variant?: ButtonVariant;
  /** Size preset. Defaults to "md". */
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-red-600 hover:bg-red-700 text-white",
  secondary:
    "border-2 border-red-600 text-red-600 hover:bg-red-50 bg-transparent dark:hover:bg-red-950",
  destructive:
    "bg-red-100 hover:bg-red-200 text-red-700",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-4 py-2 text-sm",
  md: "px-6 py-3 text-sm",
  lg: "px-8 py-4 text-base",
};

/**
 * Renders a styled button element.
 * Forwards all native button props (onClick, disabled, type, etc.).
 * @param variant - Visual style: "primary" | "secondary" | "destructive". Default: "primary".
 * @param size - Size preset: "sm" | "md" | "lg". Default: "md".
 * @param className - Additional Tailwind classes to merge in.
 * @param children - Button label content.
 */
export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled}
      className={[
        "font-semibold rounded-lg transition-colors duration-150 inline-flex items-center justify-center gap-2",
        variantClasses[variant],
        sizeClasses[size],
        disabled ? "opacity-50 cursor-not-allowed pointer-events-none" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );
}
