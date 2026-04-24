/**
 * QuickActionsWidget — dashboard card with three shortcut links.
 * Always rendered — has no empty state / hide condition.
 * Used by: app/(public)/dashboard/page.tsx
 */

import Link from "next/link";
import { CalendarPlus, ShoppingBag } from "lucide-react";

const actions = [
  { icon: CalendarPlus, label: "Book a Class", href: "/book" },
  { icon: ShoppingBag, label: "Shop Merch", href: "/merch" },
];

/** Renders three full-width shortcut links for common customer actions. Always visible. */
export default function QuickActionsWidget() {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Quick Actions
      </h2>
      <div className="flex flex-col gap-2">
        {actions.map(({ icon: Icon, label, href }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 w-full px-4 py-3 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-red-600 hover:text-white hover:border-red-600 transition-colors duration-150"
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
