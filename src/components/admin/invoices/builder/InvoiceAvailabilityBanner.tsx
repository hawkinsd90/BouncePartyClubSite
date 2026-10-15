import { AlertCircle } from 'lucide-react';

interface AvailabilityIssue {
  unitName: string;
  conflicts: unknown[];
}

interface Props {
  checkingAvailability: boolean;
  availabilityIssues: AvailabilityIssue[];
}

// Display only. InvoiceBuilder owns the availability state, effect and checks.
export function InvoiceAvailabilityBanner({ checkingAvailability, availabilityIssues }: Props) {
  return (
    <>
      {checkingAvailability && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-900">Checking availability...</p>
        </div>
      )}

      {availabilityIssues.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-semibold text-red-900 mb-2">Availability Conflicts</h4>
              <p className="text-sm text-red-800 mb-3">
                The following units are not available for the selected dates:
              </p>
              <ul className="space-y-2">
                {availabilityIssues.map((issue, index) => (
                  <li key={index} className="text-sm">
                    <span className="font-medium text-red-900">{issue.unitName}</span>
                    <span className="text-red-700"> - Conflicts with {issue.conflicts.length} order(s)</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-red-700 mt-3">
                Please remove these items or select different dates to proceed.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
