import { useState, useEffect, useRef } from 'react';
import { showConfirm } from '../../lib/toasts';
import { endWindowAfterDecline, endWindowExceptionMessage, isEndWindowRestricted, needsEndWindowConfirmation } from '../../lib/core/endWindowExceptions';

interface EventDetails {
  event_date: string;
  event_end_date: string;
  start_window: string;
  end_window: string;
  until_end_of_day: boolean;
  location_type: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  surface: string;
  can_stake: boolean;
  generator_qty: number;
  pickup_preference: string;
  same_day_responsibility_accepted: boolean;
  overnight_responsibility_accepted: boolean;
}

const initialEventDetails: EventDetails = {
  event_date: '',
  event_end_date: '',
  start_window: '09:00',
  end_window: '17:00',
  until_end_of_day: false,
  location_type: 'residential',
  address_line1: '',
  address_line2: '',
  city: '',
  state: 'MI',
  zip: '',
  lat: 0,
  lng: 0,
  surface: 'grass',
  can_stake: true,
  generator_qty: 0,
  pickup_preference: 'next_day',
  same_day_responsibility_accepted: false,
  overnight_responsibility_accepted: false,
};

interface UseInvoiceEventDetailsOptions {
  // Asks staff to confirm an end time outside the normal customer window; resolves true to keep it. Defaults to the app's confirm dialog.
  confirmEndWindowException?: (message: string) => Promise<boolean>;
}

const askStaff = (message: string) => showConfirm(message, { confirmText: 'Keep this end time', cancelText: 'Go back', type: 'warning' });

export function useInvoiceEventDetails(options: UseInvoiceEventDetailsOptions = {}) {
  const confirmEndWindowException = options.confirmEndWindowException ?? askStaff;
  const [eventDetails, setEventDetails] = useState<EventDetails>(initialEventDetails);
  // The one end time staff have confirmed as an exception (session state only; nothing is stored). A different end time asks again.
  const [confirmedEndWindow, setConfirmedEndWindow] = useState<string | null>(null);
  const lastAcceptedEndWindow = useRef(initialEventDetails.end_window);
  const askedEndWindow = useRef<string | null>(null);

  useEffect(() => {
    if (eventDetails.location_type === 'commercial') {
      setEventDetails(prev => {
        if (
          prev.pickup_preference === 'same_day' &&
          prev.until_end_of_day === false &&
          prev.same_day_responsibility_accepted === false &&
          prev.overnight_responsibility_accepted === false
        ) {
          return prev;
        }
        return {
          ...prev,
          pickup_preference: 'same_day',
          until_end_of_day: false,
          same_day_responsibility_accepted: false,
          overnight_responsibility_accepted: false,
        };
      });
    }
  }, [eventDetails.location_type]);

  useEffect(() => {
    // A same-day or commercial rental ends on its start date. (The end TIME is handled by the exception check below: it is no longer
    // silently cut to 19:00, because staff may have entered a later time on purpose.)
    if (isEndWindowRestricted({ location_type: eventDetails.location_type, pickup_preference: eventDetails.pickup_preference })) {
      setEventDetails(prev => {
        if (prev.event_end_date === prev.event_date && prev.until_end_of_day === false) {
          return prev;
        }
        return {
          ...prev,
          event_end_date: prev.event_date,
          until_end_of_day: false,
        };
      });
    }
  }, [eventDetails.pickup_preference, eventDetails.location_type, eventDetails.event_date]);

  // An end time after 19:00 on a same-day or commercial rental is allowed for staff, but only after an explicit confirmation of that exact time.
  // Asked when the time is entered or when the rental type changes underneath an existing time; not asked again for the same confirmed time;
  // declining goes back to the last accepted time (or to 19:00 when that is no longer allowed).
  useEffect(() => {
    const ctx = { location_type: eventDetails.location_type, pickup_preference: eventDetails.pickup_preference };
    const endWindow = eventDetails.end_window;
    if (!needsEndWindowConfirmation({ ...ctx, end_window: endWindow, confirmedEndWindow })) {
      lastAcceptedEndWindow.current = endWindow;
      // A confirmed exception covers only that exact time: once the time is edited to something else, going back to it asks again.
      if (confirmedEndWindow !== null && confirmedEndWindow !== endWindow) setConfirmedEndWindow(null);
      return;
    }
    if (askedEndWindow.current === endWindow) return;
    askedEndWindow.current = endWindow;
    void confirmEndWindowException(endWindowExceptionMessage(endWindow)).then(keep => {
      askedEndWindow.current = null;
      if (keep) {
        setConfirmedEndWindow(endWindow);
        return;
      }
      setEventDetails(prev =>
        prev.end_window !== endWindow
          ? prev
          : { ...prev, end_window: endWindowAfterDecline({ location_type: prev.location_type, pickup_preference: prev.pickup_preference, lastAcceptedEndWindow: lastAcceptedEndWindow.current, confirmedEndWindow }) }
      );
    });
  }, [eventDetails.end_window, eventDetails.location_type, eventDetails.pickup_preference, confirmedEndWindow, confirmEndWindowException]);

  function updateEventDetails(updates: Partial<EventDetails>) {
    setEventDetails(prev => ({ ...prev, ...updates }));
  }

  function resetEventDetails() {
    setEventDetails(initialEventDetails);
  }

  return {
    eventDetails,
    setEventDetails,
    updateEventDetails,
    resetEventDetails,
  };
}
