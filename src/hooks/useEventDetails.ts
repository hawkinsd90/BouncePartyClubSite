import { useState, useEffect } from 'react';

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

export function useEventDetails() {
  const [eventDetails, setEventDetails] = useState<EventDetails>(initialEventDetails);

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
    const isSameDayRestricted =
      (eventDetails.location_type === 'residential' && eventDetails.pickup_preference === 'same_day') ||
      eventDetails.location_type === 'commercial';

    if (isSameDayRestricted) {
      const cappedEndWindow = eventDetails.end_window > '19:00' ? '19:00' : eventDetails.end_window;
      setEventDetails(prev => {
        if (
          prev.event_end_date === prev.event_date &&
          prev.until_end_of_day === false &&
          prev.end_window === cappedEndWindow
        ) {
          return prev;
        }
        return {
          ...prev,
          event_end_date: prev.event_date,
          until_end_of_day: false,
          end_window: cappedEndWindow,
        };
      });
    }
  }, [eventDetails.pickup_preference, eventDetails.location_type, eventDetails.event_date]);

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
