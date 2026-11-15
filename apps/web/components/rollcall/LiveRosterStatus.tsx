/**
 * LiveRosterStatus: connection indicator plus an obvious Refresh button for
 * live rollcall rosters. Used by the check-in display and the session detail page.
 *
 * Check-ins arrive by push and normally need no action. This is the
 * instructor's way out when the roster looks wrong: one press resubscribes the
 * live channel and re-reads the roster from the database.
 */

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { RollcallConnectionState } from "@/lib/rollcall-realtime";

interface Props {
  /** Health of the live channel. */
  connection: RollcallConnectionState;
  /** True while the roster re-read is in flight. */
  refreshing: boolean;
  /** Resubscribes and refreshes. */
  onRefresh: () => void;
  /** Button label. Defaults to "Refresh check-ins". */
  label?: string;
}

/** Indicator copy and colors per connection state (no em dashes: rule 11). */
const INDICATOR: Record<
  RollcallConnectionState,
  { text: string; dot: string; textColor: string }
> = {
  connected: { text: "Live", dot: "bg-green-500", textColor: "text-green-700" },
  connecting: { text: "Connecting…", dot: "bg-amber-500", textColor: "text-amber-700" },
  disconnected: {
    text: "Not live. Press Refresh.",
    dot: "bg-red-600",
    textColor: "text-red-700",
  },
};

/**
 * Renders the status dot, a one-line hint, and the Refresh button. When the
 * channel is down the button turns solid and pulses so it cannot be missed.
 */
export default function LiveRosterStatus({
  connection,
  refreshing,
  onRefresh,
  label = "Refresh check-ins",
}: Props): React.ReactElement {
  const indicator = INDICATOR[connection];
  const down = connection === "disconnected";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p
        role="status"
        className={`flex items-center gap-2 text-sm font-semibold ${indicator.textColor}`}
      >
        <span
          aria-hidden="true"
          className={`inline-block w-2.5 h-2.5 rounded-full ${indicator.dot}`}
        />
        {indicator.text}
      </p>

      <Button
        type="button"
        size="sm"
        variant={down ? "primary" : "secondary"}
        onClick={onRefresh}
        disabled={refreshing}
        className={down && !refreshing ? "animate-pulse" : ""}
      >
        <RefreshCw
          aria-hidden="true"
          className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
        />
        {refreshing ? "Refreshing…" : label}
      </Button>
    </div>
  );
}
