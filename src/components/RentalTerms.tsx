import { FileText } from 'lucide-react';

export function RentalTerms() {
  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <h2 className="text-2xl font-bold text-slate-900 mb-4 flex items-center">
        <FileText className="w-6 h-6 mr-2 text-slate-600" />
        Rental Terms & Policies
      </h2>

      <div className="space-y-6 text-sm">
        <div>
          <h3 className="font-semibold text-slate-900 mb-2">Deposit Information</h3>
          <p className="text-slate-700 leading-relaxed mb-2">
            This booking requires a minimum $50 deposit per inflatable to reserve your event date with Bounce Party Club. The remaining balance is due on or before the day of your event. You may choose to pay the full amount at booking.
          </p>
          <p className="font-medium text-slate-900 mb-1">Cancellation Policy:</p>
          <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Full refund if cancelled more than 48 hours in advance</li>
            <li>One-time reschedule option available with 24-48 hours' notice</li>
            <li>No refund or rescheduling available if cancelled with less than 24 hours' notice</li>
          </ul>
        </div>

        <div className="border-t border-slate-200 pt-4">
          <h3 className="font-semibold text-slate-900 mb-2">Setup & Pickup Expectations</h3>
          <p className="font-medium text-slate-900 mb-1">Before Setup:</p>
          <ul className="list-disc pl-5 space-y-1 text-slate-600 mb-3">
            <li>The event yard should be reasonably maintained, including clear grass, no trash, and no pet waste in the setup area</li>
            <li>We require access to a standard electrical outlet within 50 feet. If unavailable, a $35 generator rental fee applies</li>
            <li>We guarantee all deliveries will occur before 12:00 PM (noon) on the day of the event</li>
            <li>An adult must be present between 7:00 AM and 12:00 PM to receive the inflatable and review safety information with our team</li>
          </ul>
          <p className="font-medium text-slate-900 mb-1">During Pickup:</p>
          <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Please ensure the inflatable remains plugged in and fully inflated for the duration of the rental period until Bounce Party Club staff arrives for pickup, unless specified otherwise</li>
            <li><strong>Residential Areas:</strong> The following morning between 6:00 AM and 1:30 PM</li>
            <li><strong>Commercial / High-Risk Areas</strong> (parks, churches, schools, etc.): Same-day pickup by 7:00 PM</li>
          </ul>
        </div>

        <div className="border-t border-slate-200 pt-4">
          <h3 className="font-semibold text-slate-900 mb-2">Waiver Requirement</h3>
          <p className="text-slate-600 leading-relaxed">
            All renters must sign the Bounce Party Club waiver before setup begins. This protects both the renter and the business by outlining terms of safe and responsible use.
          </p>
        </div>

        <div className="border-t border-slate-200 pt-4">
          <h3 className="font-semibold text-slate-900 mb-2">Damage and Loss Responsibility</h3>
          <p className="text-slate-600 leading-relaxed">
            Renter is responsible for damages beyond normal wear and tear. Refer to the signed waiver for full terms and conditions regarding liability.
          </p>
        </div>
      </div>
    </div>
  );
}
