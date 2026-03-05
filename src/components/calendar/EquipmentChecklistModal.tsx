import { X, ClipboardList, Package as PackageIcon, Anchor, Zap } from 'lucide-react';
import { Task } from '../../hooks/useCalendarTasks';

interface EquipmentChecklistModalProps {
  isOpen: boolean;
  tasks: Task[];
  onClose: () => void;
}

interface EquipmentSummary {
  bounceHouses: { name: string; wetOrDry: string }[];
  hasStakes: boolean;
  hasSandbags: boolean;
  hasGenerators: boolean;
  generatorCount: number;
}

export function EquipmentChecklistModal({ isOpen, tasks, onClose }: EquipmentChecklistModalProps) {
  if (!isOpen) return null;

  // Calculate equipment needed from all tasks
  const equipment: EquipmentSummary = {
    bounceHouses: [],
    hasStakes: false,
    hasSandbags: false,
    hasGenerators: false,
    generatorCount: 0,
  };

  tasks.forEach(task => {
    task.items.forEach(item => {
      // Extract bounce house name and type
      const match = item.match(/^(.+?)\s*\((Water|Dry)\)$/);
      if (match) {
        equipment.bounceHouses.push({
          name: match[1],
          wetOrDry: match[2],
        });
      }
    });
  });

  // Every delivery needs stakes or sandbags - show both since we don't track surface type
  const needsSecuring = equipment.bounceHouses.length > 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center z-10">
          <div className="flex items-center gap-3">
            <ClipboardList className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold text-slate-900">
              Equipment Checklist
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <p className="text-sm text-slate-600">
            Equipment needed for {tasks.length} delivery{tasks.length !== 1 ? 'ies' : ''}
          </p>

          {/* Bounce Houses */}
          <div>
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-3">
              <PackageIcon className="w-5 h-5 text-blue-600" />
              Bounce Houses ({equipment.bounceHouses.length})
            </h3>
            <div className="space-y-2">
              {equipment.bounceHouses.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-3"
                >
                  <span className="font-medium text-slate-900">{item.name}</span>
                  <span className={`px-2 py-1 rounded text-xs font-semibold ${
                    item.wetOrDry === 'Water'
                      ? 'bg-blue-600 text-white'
                      : 'bg-orange-600 text-white'
                  }`}>
                    {item.wetOrDry}
                  </span>
                </div>
              ))}
              {equipment.bounceHouses.length === 0 && (
                <p className="text-sm text-slate-500">No bounce houses scheduled</p>
              )}
            </div>
          </div>

          {/* Stakes & Sandbags - Show for all deliveries */}
          {needsSecuring && (
            <div>
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-3">
                <Anchor className="w-5 h-5 text-green-600" />
                Stakes & Sandbags
              </h3>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-base font-bold text-amber-900 mb-2">Bring Both:</p>
                <ul className="text-sm text-slate-700 space-y-1">
                  <li><strong>Stakes:</strong> 4 per unit for grass/dirt surfaces</li>
                  <li><strong>Sandbags:</strong> 4 per unit for concrete/indoor setups</li>
                </ul>
                <p className="text-xs text-slate-600 mt-3">
                  Total units: {equipment.bounceHouses.length}
                </p>
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-slate-200">
            <button
              onClick={onClose}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              Close Checklist
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
