import React from "react";

import type { QueueItem } from "../App";
import { QueueTableRow } from "./QueueTableRow";

interface QueueTableProps {
  items: QueueItem[];
  killSwitchActive: boolean;
}

export function QueueTable({ items, killSwitchActive }: QueueTableProps): React.ReactElement {
  return (
    <section aria-label="Lodgment queues" className="space-y-3">
      <header className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Queues</h2>
        <p className="text-sm text-slate-500">{items.length} active monitoring lanes</p>
      </header>
      <div className="space-y-3">
        {items.map((item) => (
          <QueueTableRow key={item.id} item={item} killSwitchActive={killSwitchActive} />
        ))}
      </div>
    </section>
  );
}
