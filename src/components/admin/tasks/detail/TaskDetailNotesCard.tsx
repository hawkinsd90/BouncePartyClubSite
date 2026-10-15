interface Props {
  notes: string;
}

// The parent decides when to render this card (task.notes is truthy).
export function TaskDetailNotesCard({ notes }: Props) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
      <h3 className="font-bold text-amber-900 mb-2">Special Notes</h3>
      <p className="text-sm text-amber-900 whitespace-pre-wrap">{notes}</p>
    </div>
  );
}
