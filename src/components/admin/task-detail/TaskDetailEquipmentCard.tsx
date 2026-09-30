interface Props {
  items: string[];
  isDropOff: boolean;
}

export function TaskDetailEquipmentCard({ items, isDropOff }: Props) {
  return (
    <div className="bg-slate-50 rounded-lg p-4">
      <h3 className="font-bold text-slate-900 mb-3">Equipment</h3>
      <ul className="space-y-1 text-sm">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start gap-2">
            <span className={isDropOff ? 'text-green-600' : 'text-orange-600'}>•</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
