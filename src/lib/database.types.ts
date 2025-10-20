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
      admin_settings: {
        Row: {
          id: string
          key: string
          value: string
          description: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          key: string
          value: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          key?: string
          value?: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      admin_settings_changelog: {
        Row: {
          id: string
          setting_key: string
          old_value: string | null
          new_value: string | null
          changed_by: string | null
          change_description: string | null
          created_at: string
        }
        Insert: {
          id?: string
          setting_key: string
          old_value?: string | null
          new_value?: string | null
          changed_by?: string | null
          change_description?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          setting_key?: string
          old_value?: string | null
          new_value?: string | null
          changed_by?: string | null
          change_description?: string | null
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
      contacts: {
        Row: {
          id: string
          customer_id: string | null
          first_name: string
          last_name: string
          email: string
          phone: string | null
          opt_in_email: boolean
          opt_in_sms: boolean
          source: string
          tags: string[]
          last_contact_date: string | null
          total_bookings: number
          total_spent_cents: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          customer_id?: string | null
          first_name: string
          last_name: string
          email: string
          phone?: string | null
          opt_in_email?: boolean
          opt_in_sms?: boolean
          source?: string
          tags?: string[]
          last_contact_date?: string | null
          total_bookings?: number
          total_spent_cents?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          customer_id?: string | null
          first_name?: string
          last_name?: string
          email?: string
          phone?: string | null
          opt_in_email?: boolean
          opt_in_sms?: boolean
          source?: string
          tags?: string[]
          last_contact_date?: string | null
          total_bookings?: number
          total_spent_cents?: number
          created_at?: string
          updated_at?: string
        }
      }
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
      invoices: {
        Row: {
          id: string
          invoice_number: string
          order_id: string | null
          customer_id: string | null
          invoice_date: string
          due_date: string | null
          status: 'draft' | 'sent' | 'paid' | 'cancelled'
          subtotal_cents: number
          tax_cents: number
          travel_fee_cents: number
          surface_fee_cents: number
          same_day_pickup_fee_cents: number
          total_cents: number
          paid_amount_cents: number
          payment_method: string | null
          notes: string | null
          pdf_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          invoice_number: string
          order_id?: string | null
          customer_id?: string | null
          invoice_date?: string
          due_date?: string | null
          status?: 'draft' | 'sent' | 'paid' | 'cancelled'
          subtotal_cents: number
          tax_cents?: number
          travel_fee_cents?: number
          surface_fee_cents?: number
          same_day_pickup_fee_cents?: number
          total_cents: number
          paid_amount_cents?: number
          payment_method?: string | null
          notes?: string | null
          pdf_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          invoice_number?: string
          order_id?: string | null
          customer_id?: string | null
          invoice_date?: string
          due_date?: string | null
          status?: 'draft' | 'sent' | 'paid' | 'cancelled'
          subtotal_cents?: number
          tax_cents?: number
          travel_fee_cents?: number
          surface_fee_cents?: number
          same_day_pickup_fee_cents?: number
          total_cents?: number
          paid_amount_cents?: number
          payment_method?: string | null
          notes?: string | null
          pdf_url?: string | null
          created_at?: string
          updated_at?: string
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
      order_changelog: {
        Row: {
          id: string
          order_id: string
          user_id: string | null
          field_changed: string
          old_value: string | null
          new_value: string | null
          change_type: string
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          user_id?: string | null
          field_changed: string
          old_value?: string | null
          new_value?: string | null
          change_type?: string
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          user_id?: string | null
          field_changed?: string
          old_value?: string | null
          new_value?: string | null
          change_type?: string
          created_at?: string
        }
      }
      order_discounts: {
        Row: {
          id: string
          order_id: string
          name: string
          amount_cents: number
          percentage: number
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          order_id: string
          name: string
          amount_cents?: number
          percentage?: number
          created_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          order_id?: string
          name?: string
          amount_cents?: number
          percentage?: number
          created_at?: string
          created_by?: string | null
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
      order_notes: {
        Row: {
          id: string
          order_id: string
          user_id: string | null
          note: string
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          user_id?: string | null
          note: string
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          user_id?: string | null
          note?: string
          created_at?: string
        }
      }
      order_refunds: {
        Row: {
          id: string
          order_id: string
          amount_cents: number
          reason: string
          stripe_refund_id: string | null
          refunded_by: string | null
          status: 'pending' | 'succeeded' | 'failed'
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          amount_cents: number
          reason: string
          stripe_refund_id?: string | null
          refunded_by?: string | null
          status?: 'pending' | 'succeeded' | 'failed'
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          amount_cents?: number
          reason?: string
          stripe_refund_id?: string | null
          refunded_by?: string | null
          status?: 'pending' | 'succeeded' | 'failed'
          created_at?: string
        }
      }
      order_workflow_events: {
        Row: {
          id: string
          order_id: string
          event_type: 'on_the_way' | 'arrived' | 'setup_started' | 'setup_completed' | 'pickup_started' | 'pickup_completed'
          user_id: string | null
          eta: string | null
          notes: string | null
          latitude: number | null
          longitude: number | null
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          event_type: 'on_the_way' | 'arrived' | 'setup_started' | 'setup_completed' | 'pickup_started' | 'pickup_completed'
          user_id?: string | null
          eta?: string | null
          notes?: string | null
          latitude?: number | null
          longitude?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          event_type?: 'on_the_way' | 'arrived' | 'setup_started' | 'setup_completed' | 'pickup_started' | 'pickup_completed'
          user_id?: string | null
          eta?: string | null
          notes?: string | null
          latitude?: number | null
          longitude?: number | null
          created_at?: string
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
          start_date: string | null
          end_date: string | null
          overnight_allowed: boolean
          can_use_stakes: boolean
          generator_selected: boolean
          special_details: string | null
          has_pets: boolean
          sms_consent_text: string | null
          sms_consented_at: string | null
          travel_total_miles: number | null
          travel_base_radius_miles: number | null
          travel_chargeable_miles: number | null
          travel_per_mile_cents: number | null
          travel_is_flat_fee: boolean
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          balance_paid_cents: number
          damage_charged_cents: number
          total_refunded_cents: number
          tip_cents: number
          stripe_payment_status: string
          workflow_status: string
          current_eta: string | null
          waiver_signed_at: string | null
          waiver_signature_data: string | null
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
          start_date?: string | null
          end_date?: string | null
          overnight_allowed?: boolean
          can_use_stakes?: boolean
          generator_selected?: boolean
          special_details?: string | null
          has_pets?: boolean
          sms_consent_text?: string | null
          sms_consented_at?: string | null
          travel_total_miles?: number | null
          travel_base_radius_miles?: number | null
          travel_chargeable_miles?: number | null
          travel_per_mile_cents?: number | null
          travel_is_flat_fee?: boolean
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          balance_paid_cents?: number
          damage_charged_cents?: number
          total_refunded_cents?: number
          tip_cents?: number
          stripe_payment_status?: string
          workflow_status?: string
          current_eta?: string | null
          waiver_signed_at?: string | null
          waiver_signature_data?: string | null
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
          start_date?: string | null
          end_date?: string | null
          overnight_allowed?: boolean
          can_use_stakes?: boolean
          generator_selected?: boolean
          special_details?: string | null
          has_pets?: boolean
          sms_consent_text?: string | null
          sms_consented_at?: string | null
          travel_total_miles?: number | null
          travel_base_radius_miles?: number | null
          travel_chargeable_miles?: number | null
          travel_per_mile_cents?: number | null
          travel_is_flat_fee?: boolean
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          balance_paid_cents?: number
          damage_charged_cents?: number
          total_refunded_cents?: number
          tip_cents?: number
          stripe_payment_status?: string
          workflow_status?: string
          current_eta?: string | null
          waiver_signed_at?: string | null
          waiver_signature_data?: string | null
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
          extra_day_pct: number
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
          extra_day_pct?: number
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
          extra_day_pct?: number
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
      sms_conversations: {
        Row: {
          id: string
          order_id: string | null
          from_phone: string
          to_phone: string
          message_body: string
          direction: 'inbound' | 'outbound'
          twilio_message_sid: string | null
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          order_id?: string | null
          from_phone: string
          to_phone: string
          message_body: string
          direction: 'inbound' | 'outbound'
          twilio_message_sid?: string | null
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string | null
          from_phone?: string
          to_phone?: string
          message_body?: string
          direction?: 'inbound' | 'outbound'
          twilio_message_sid?: string | null
          status?: string
          created_at?: string
        }
      }
      sms_message_templates: {
        Row: {
          id: string
          template_key: string
          template_name: string
          message_template: string
          description: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          template_key: string
          template_name: string
          message_template: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          template_key?: string
          template_name?: string
          message_template?: string
          description?: string | null
          created_at?: string
          updated_at?: string
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
          mode: string
        }
        Insert: {
          id?: string
          unit_id: string
          url: string
          alt: string
          sort?: number
          created_at?: string
          mode?: string
        }
        Update: {
          id?: string
          unit_id?: string
          url?: string
          alt?: string
          sort?: number
          created_at?: string
          mode?: string
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
          quantity_available: number
          dimensions_water: string | null
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
          quantity_available?: number
          dimensions_water?: string | null
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
          quantity_available?: number
          dimensions_water?: string | null
        }
      }
      user_roles: {
        Row: {
          user_id: string
          role: string
        }
        Insert: {
          user_id: string
          role: string
        }
        Update: {
          user_id?: string
          role?: string
        }
      }
    }
  }
}
