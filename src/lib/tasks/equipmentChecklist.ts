// WP-15 (B12): what the morning Equipment Checklist adds up.
//
// The checklist is what to load for the day's DELIVERIES. It used to count every task in the morning route, which includes the next-day
// pickups of earlier events (they take equipment away, not out), offered stakes or sandbags for Event Essentials-only orders (tables and
// chairs need neither), and said "1 deliveries".
import { aggregateEquipmentAcrossOrders, type OperationalEquipmentItem } from './operationalEquipment';

export interface ChecklistTask {
  type: 'drop-off' | 'pick-up' | string;
  items: string[];
  surface?: string | null;
  numInflatables: number;
  rawEquipmentItems?: OperationalEquipmentItem[];
}

export interface ChecklistSummary {
  deliveryCount: number;
  bounceHouses: Array<{ name: string; wetOrDry: string }>;
  eventEssentials: Array<{ name: string; qty: number }>;
  // Stakes (grass) and sandbags (cement) are for inflatables only: an order without one never adds to these.
  stakeUnits: number;
  sandbagUnits: number;
}

export function deliveryCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'delivery' : 'deliveries'}`;
}

export function buildChecklist(tasks: ChecklistTask[]): ChecklistSummary {
  const deliveries = tasks.filter((t) => t.type === 'drop-off');
  const bounceHouses: ChecklistSummary['bounceHouses'] = [];
  const lists: { items: OperationalEquipmentItem[] }[] = [];
  let stakeUnits = 0;
  let sandbagUnits = 0;

  for (const task of deliveries) {
    for (const item of task.items) {
      const match = item.match(/^(.+?)\s*\((Water|Dry)\)$/);
      if (match) bounceHouses.push({ name: match[1], wetOrDry: match[2] });
    }
    if (task.numInflatables > 0) {
      if (task.surface === 'grass') stakeUnits += task.numInflatables;
      else if (task.surface === 'cement') sandbagUnits += task.numInflatables;
    }
    if (Array.isArray(task.rawEquipmentItems)) lists.push({ items: task.rawEquipmentItems });
  }

  const eventEssentials = aggregateEquipmentAcrossOrders(lists)
    .filter((e) => e.kind === 'event_essential')
    .map((e) => ({ name: e.name, qty: e.totalQty }));

  return { deliveryCount: deliveries.length, bounceHouses, eventEssentials, stakeUnits, sandbagUnits };
}
