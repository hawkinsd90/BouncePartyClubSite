export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      customers: {
        Row: {
          id: string
          first_name: string
          last_name: string
          email: string
          phone: string
          created_at: string
        }
        Insert: {
          id?: string
          first_name: string
          last_name: string
          email: string
          phone: string
          created_at?: string
        }
        Update: {
          id?: string
          first_name?: string
          last_name?: string
          email?: string
          phone?: string
          created_at?: string
        }
      }
      addresses: {
        Row: {
          id: string
          customer_id: string
          line1: string
          line2: string | null
          city: string
          state: string
          zip: string
          lat: number | null
          lng: number | null
          created_at: string
        }
        Insert: {
          id?: string
          customer_id: string
          line1: string
          line2?: string | null
          city: string
          state: string
          zip: string
          lat?: number | null
          lng?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          customer_id?: string
          line1?: string
          line2?: string | null
          city?: string
          state?: string
          zip?: string
          lat?: number | null
          lng?: number | null
          created_at?: string
        }
      }
      units: {
        Row: {
          id: string
          slug: string
          name: string
          type: string
          is_combo: boolean
          price_dry_cents: number
          price_water_cents: number | null
          dimensions: string
          footprint_sqft: number
          power_circuits: number
          capacity: number
          indoor_ok: boolean
          outdoor_ok: boolean
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          slug: string
          name: string
          type: string
          is_combo?: boolean
          price_dry_cents: number
          price_water_cents?: number | null
          dimensions: string
          footprint_sqft: number
          power_circuits?: number
          capacity: number
          indoor_ok?: boolean
          outdoor_ok?: boolean
          active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          slug?: string
          name?: string
          type?: string
          is_combo?: boolean
          price_dry_cents?: number
          price_water_cents?: number | null
          dimensions?: string
          footprint_sqft?: number
          power_circuits?: number
          capacity?: number
          indoor_ok?: boolean
          outdoor_ok?: boolean
          active?: boolean
          created_at?: string
        }
      }
      unit_media: {
        Row: {
          id: string
          unit_id: string
          url: string
          alt: string
          sort: number
          created_at: string
        }
        Insert: {
          id?: string
          unit_id: string
          url: string
          alt: string
          sort?: number
          created_at?: string
        }
        Update: {
          id?: string
          unit_id?: string
          url?: string
          alt?: string
          sort?: number
          created_at?: string
        }
      }
      pricing_rules: {
        Row: {
          id: string
          base_radius_miles: number
          included_city_list_json: Json
          per_mile_after_base_cents: number
          zone_overrides_json: Json
          surface_sandbag_fee_cents: number
          residential_multiplier: number
          commercial_multiplier: number
          same_day_matrix_json: Json
          overnight_holiday_only: boolean
          updated_at: string
        }
        Insert: {
          id?: string
          base_radius_miles?: number
          included_city_list_json?: Json
          per_mile_after_base_cents?: number
          zone_overrides_json?: Json
          surface_sandbag_fee_cents?: number
          residential_multiplier?: number
          commercial_multiplier?: number
          same_day_matrix_json?: Json
          overnight_holiday_only?: boolean
          updated_at?: string
        }
        Update: {
          id?: string
          base_radius_miles?: number
          included_city_list_json?: Json
          per_mile_after_base_cents?: number
          zone_overrides_json?: Json
          surface_sandbag_fee_cents?: number
          residential_multiplier?: number
          commercial_multiplier?: number
          same_day_matrix_json?: Json
          overnight_holiday_only?: boolean
          updated_at?: string
        }
      }
      orders: {
        Row: {
          id: string
          customer_id: string
          status: string
          location_type: 'residential' | 'commercial'
          surface: 'grass' | 'cement'
          event_date: string
          start_window: string
          end_window: string
          address_id: string
          subtotal_cents: number
          travel_fee_cents: number
          surface_fee_cents: number
          same_day_pickup_fee_cents: number
          tax_cents: number
          deposit_due_cents: number
          deposit_paid_cents: number
          balance_due_cents: number
          payment_method_id: string | null
          card_on_file_consent_text: string | null
          card_on_file_consented_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          customer_id: string
          status?: string
          location_type: 'residential' | 'commercial'
          surface: 'grass' | 'cement'
          event_date: string
          start_window: string
          end_window: string
          address_id: string
          subtotal_cents: number
          travel_fee_cents?: number
          surface_fee_cents?: number
          same_day_pickup_fee_cents?: number
          tax_cents?: number
          deposit_due_cents: number
          deposit_paid_cents?: number
          balance_due_cents: number
          payment_method_id?: string | null
          card_on_file_consent_text?: string | null
          card_on_file_consented_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          customer_id?: string
          status?: string
          location_type?: 'residential' | 'commercial'
          surface?: 'grass' | 'cement'
          event_date?: string
          start_window?: string
          end_window?: string
          address_id?: string
          subtotal_cents?: number
          travel_fee_cents?: number
          surface_fee_cents?: number
          same_day_pickup_fee_cents?: number
          tax_cents?: number
          deposit_due_cents?: number
          deposit_paid_cents?: number
          balance_due_cents?: number
          payment_method_id?: string | null
          card_on_file_consent_text?: string | null
          card_on_file_consented_at?: string | null
          created_at?: string
        }
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          unit_id: string
          wet_or_dry: 'dry' | 'water'
          unit_price_cents: number
          qty: number
          notes: string | null
        }
        Insert: {
          id?: string
          order_id: string
          unit_id: string
          wet_or_dry: 'dry' | 'water'
          unit_price_cents: number
          qty?: number
          notes?: string | null
        }
        Update: {
          id?: string
          order_id?: string
          unit_id?: string
          wet_or_dry?: 'dry' | 'water'
          unit_price_cents?: number
          qty?: number
          notes?: string | null
        }
      }
      payments: {
        Row: {
          id: string
          order_id: string
          type: 'deposit' | 'balance' | 'incidental'
          amount_cents: number
          stripe_payment_intent_id: string | null
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          type: 'deposit' | 'balance' | 'incidental'
          amount_cents: number
          stripe_payment_intent_id?: string | null
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          type?: 'deposit' | 'balance' | 'incidental'
          amount_cents?: number
          stripe_payment_intent_id?: string | null
          status?: string
          created_at?: string
        }
      }
      documents: {
        Row: {
          id: string
          order_id: string
          kind: 'invoice' | 'waiver_photo' | 'delivery_photos' | 'pickup_photos'
          url: string
          meta_json: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          kind: 'invoice' | 'waiver_photo' | 'delivery_photos' | 'pickup_photos'
          url: string
          meta_json?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          kind?: 'invoice' | 'waiver_photo' | 'delivery_photos' | 'pickup_photos'
          url?: string
          meta_json?: Json | null
          created_at?: string
        }
      }
      messages: {
        Row: {
          id: string
          order_id: string
          to_phone: string | null
          to_email: string | null
          channel: 'sms' | 'email'
          template_key: string
          payload_json: Json
          sent_at: string | null
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          to_phone?: string | null
          to_email?: string | null
          channel: 'sms' | 'email'
          template_key: string
          payload_json: Json
          sent_at?: string | null
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          to_phone?: string | null
          to_email?: string | null
          channel?: 'sms' | 'email'
          template_key?: string
          payload_json?: Json
          sent_at?: string | null
          status?: string
          created_at?: string
        }
      }
      route_stops: {
        Row: {
          id: string
          order_id: string
          type: 'dropoff' | 'pickup'
          eta: string | null
          checkpoint: 'none' | 'start_day' | 'arrived' | 'leave_dropoff' | 'leave_pickup'
          checkpoint_time: string | null
          gps_lat: number | null
          gps_lng: number | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          type: 'dropoff' | 'pickup'
          eta?: string | null
          checkpoint?: 'none' | 'start_day' | 'arrived' | 'leave_dropoff' | 'leave_pickup'
          checkpoint_time?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          type?: 'dropoff' | 'pickup'
          eta?: string | null
          checkpoint?: 'none' | 'start_day' | 'arrived' | 'leave_dropoff' | 'leave_pickup'
          checkpoint_time?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          notes?: string | null
          created_at?: string
        }
      }
    }
  }
}
