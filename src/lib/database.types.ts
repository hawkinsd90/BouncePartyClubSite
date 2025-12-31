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
      addresses: {
        Row: {
          id: string
          customer_id: string | null
          line1: string
          line2: string | null
          city: string
          state: string
          zip: string
          lat: number | null
          lng: number | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['addresses']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['addresses']['Insert']>
        Relationships: []
      }
      admin_settings: {
        Row: {
          id: string
          key: string
          value: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['admin_settings']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['admin_settings']['Insert']>
        Relationships: []
      }
      admin_settings_changelog: {
        Row: {
          id: string
          setting_key: string
          old_value: string | null
          new_value: string | null
          changed_by: string
          changed_at: string
          change_reason: string | null
        }
        Insert: Omit<Database['public']['Tables']['admin_settings_changelog']['Row'], 'id' | 'changed_at'>
        Update: Partial<Database['public']['Tables']['admin_settings_changelog']['Insert']>
        Relationships: []
      }
      consent_records: {
        Row: {
          id: string
          customer_id: string
          sms_consent: boolean
          card_on_file_consent: boolean
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['consent_records']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['consent_records']['Insert']>
        Relationships: []
      }
      contacts: {
        Row: {
          id: string
          name: string
          email: string | null
          phone: string | null
          business_name: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['contacts']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['contacts']['Insert']>
        Relationships: []
      }
      contact_stats: {
        Row: {
          contact_id: string
          bookings_count: number
          total_spent_cents: number
        }
        Insert: Database['public']['Tables']['contact_stats']['Row']
        Update: Partial<Database['public']['Tables']['contact_stats']['Insert']>
        Relationships: []
      }
      crew_location_history: {
        Row: {
          id: string
          user_id: string
          lat: number
          lng: number
          accuracy: number | null
          recorded_at: string
        }
        Insert: Omit<Database['public']['Tables']['crew_location_history']['Row'], 'id' | 'recorded_at'>
        Update: Partial<Database['public']['Tables']['crew_location_history']['Insert']>
        Relationships: []
      }
      customers: {
        Row: {
          id: string
          first_name: string
          last_name: string
          email: string
          phone: string
          business_name: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['customers']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['customers']['Insert']>
        Relationships: []
      }
      documents: {
        Row: {
          id: string
          order_id: string
          document_type: string
          file_url: string
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['documents']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['documents']['Insert']>
        Relationships: []
      }
      hero_carousel_slides: {
        Row: {
          id: string
          media_url: string
          media_type: string
          title: string | null
          subtitle: string | null
          button_text: string | null
          button_link: string | null
          sort_order: number
          is_active: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['hero_carousel_slides']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['hero_carousel_slides']['Insert']>
        Relationships: []
      }
      invoices: {
        Row: {
          id: string
          order_id: string
          invoice_number: string
          due_date: string | null
          paid_at: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['invoices']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['invoices']['Insert']>
        Relationships: []
      }
      notification_failures: {
        Row: {
          id: string
          order_id: string | null
          notification_type: string
          intended_recipient: string
          subject: string | null
          message_preview: string | null
          error_message: string
          retry_count: number
          last_retry_at: string | null
          resolved_at: string | null
          resolved_by: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['notification_failures']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['notification_failures']['Insert']>
        Relationships: []
      }
      notification_system_status: {
        Row: {
          id: string
          system_type: string
          is_operational: boolean
          last_success_at: string | null
          last_failure_at: string | null
          consecutive_failures: number
          error_message: string | null
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['notification_system_status']['Row'], 'id' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['notification_system_status']['Insert']>
        Relationships: []
      }
      orders: {
        Row: {
          id: string
          order_number: string
          customer_id: string | null
          address_id: string
          status: string
          event_date: string
          event_end_date: string | null
          start_window: string | null
          end_window: string | null
          until_end_of_day: boolean
          location_type: string
          surface: string
          pickup_preference: string
          same_day_responsibility_accepted: boolean
          overnight_responsibility_accepted: boolean
          subtotal_cents: number
          travel_fee_cents: number
          travel_total_miles: number
          travel_base_radius_miles: number
          travel_chargeable_miles: number
          travel_per_mile_cents: number
          travel_is_flat_fee: boolean
          surface_fee_cents: number
          same_day_pickup_fee_cents: number
          generator_fee_cents: number
          generator_qty: number
          tax_cents: number
          tax_waived: boolean
          tax_waive_reason: string | null
          travel_fee_waived: boolean
          travel_fee_waive_reason: string | null
          same_day_pickup_fee_waived: boolean
          same_day_pickup_fee_waive_reason: string | null
          tip_cents: number
          total_cents: number
          deposit_due_cents: number
          deposit_paid_cents: number
          balance_due_cents: number
          custom_deposit_cents: number | null
          card_on_file_consent: boolean
          sms_consent: boolean
          admin_message: string | null
          booking_confirmation_sent: boolean
          cancellation_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['orders']['Row'], 'id' | 'order_number' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['orders']['Insert']>
        Relationships: []
      }
      order_changelog: {
        Row: {
          id: string
          order_id: string
          changed_by: string | null
          change_type: string
          field_name: string | null
          old_value: string | null
          new_value: string | null
          notes: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['order_changelog']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['order_changelog']['Insert']>
        Relationships: []
      }
      order_custom_fees: {
        Row: {
          id: string
          order_id: string
          name: string
          amount_cents: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['order_custom_fees']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['order_custom_fees']['Insert']>
        Relationships: []
      }
      order_discounts: {
        Row: {
          id: string
          order_id: string
          name: string
          amount_cents: number
          percentage: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['order_discounts']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['order_discounts']['Insert']>
        Relationships: []
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          unit_id: string
          qty: number
          wet_or_dry: string
          unit_price_cents: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['order_items']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['order_items']['Insert']>
        Relationships: []
      }
      order_pictures: {
        Row: {
          id: string
          order_id: string
          picture_type: string
          image_url: string
          uploaded_by: string | null
          notes: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['order_pictures']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['order_pictures']['Insert']>
        Relationships: []
      }
      order_signatures: {
        Row: {
          id: string
          order_id: string
          signature_data_url: string
          renter_name: string
          renter_phone: string
          renter_email: string | null
          ip_address: string | null
          user_agent: string | null
          signed_at: string
        }
        Insert: Omit<Database['public']['Tables']['order_signatures']['Row'], 'id' | 'signed_at'>
        Update: Partial<Database['public']['Tables']['order_signatures']['Insert']>
        Relationships: []
      }
      payments: {
        Row: {
          id: string
          order_id: string
          stripe_payment_intent_id: string | null
          stripe_charge_id: string | null
          amount_cents: number
          tip_cents: number
          status: string
          payment_method: string | null
          error_message: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['payments']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['payments']['Insert']>
        Relationships: []
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
          extra_day_pct: number
          generator_price_cents: number
          deposit_percentage: number
          free_city_list_json: Json
          same_day_pickup_fee_cents: number
          tax_rate: number
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['pricing_rules']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['pricing_rules']['Insert']>
        Relationships: []
      }
      route_stops: {
        Row: {
          id: string
          task_id: string
          order_id: string
          sequence_order: number
          estimated_arrival_time: string | null
          actual_arrival_time: string | null
          estimated_duration_minutes: number | null
          actual_duration_minutes: number | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['route_stops']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['route_stops']['Insert']>
        Relationships: []
      }
      sms_conversations: {
        Row: {
          id: string
          order_id: string | null
          contact_id: string | null
          from_number: string
          to_number: string
          message_body: string
          direction: string
          twilio_message_sid: string | null
          status: string | null
          error_message: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['sms_conversations']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['sms_conversations']['Insert']>
        Relationships: []
      }
      sms_message_templates: {
        Row: {
          id: string
          template_key: string
          template_name: string
          message_body: string
          description: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['sms_message_templates']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['sms_message_templates']['Insert']>
        Relationships: []
      }
      tasks: {
        Row: {
          id: string
          task_type: string
          task_date: string
          assigned_to: string | null
          notes: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['tasks']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['tasks']['Insert']>
        Relationships: []
      }
      task_status: {
        Row: {
          id: string
          task_id: string
          order_id: string
          status: string
          crew_notes: string | null
          admin_notes: string | null
          completed_at: string | null
          estimated_arrival: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['task_status']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['task_status']['Insert']>
        Relationships: []
      }
      units: {
        Row: {
          id: string
          slug: string
          name: string
          type: string
          description: string | null
          price_dry_cents: number
          price_water_cents: number | null
          quantity_available: number
          active: boolean
          is_combo: boolean
          features_json: Json | null
          dimensions_dry: string | null
          dimensions_wet: string | null
          dimensions: string | null
          capacity: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['units']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['units']['Insert']>
        Relationships: []
      }
      unit_media: {
        Row: {
          id: string
          unit_id: string
          url: string
          mode: string
          sort: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['unit_media']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['unit_media']['Insert']>
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          user_id: string
          role: string
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['user_roles']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['user_roles']['Insert']>
        Relationships: []
      }
      auth_trigger_logs: {
        Row: {
          id: string
          event_type: string
          user_id: string | null
          user_email: string | null
          metadata: Json | null
          error: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['auth_trigger_logs']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['auth_trigger_logs']['Insert']>
        Relationships: []
      }
      blackout_dates: {
        Row: {
          id: string
          start_date: string
          end_date: string
          reason: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['blackout_dates']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['blackout_dates']['Insert']>
        Relationships: []
      }
      blackout_addresses: {
        Row: {
          id: string
          address_pattern: string
          reason: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['blackout_addresses']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['blackout_addresses']['Insert']>
        Relationships: []
      }
      blackout_contacts: {
        Row: {
          id: string
          contact_id: string
          reason: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['blackout_contacts']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['blackout_contacts']['Insert']>
        Relationships: []
      }
      discount_templates: {
        Row: {
          id: string
          name: string
          amount_cents: number
          percentage: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['discount_templates']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['discount_templates']['Insert']>
        Relationships: []
      }
      fee_templates: {
        Row: {
          id: string
          name: string
          amount_cents: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['fee_templates']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['fee_templates']['Insert']>
        Relationships: []
      }
    }
    Views: {}
    Functions: {
      is_admin: {
        Args: { user_id: string }
        Returns: boolean
      }
      generate_invoice_number: {
        Args: Record<string, never>
        Returns: string
      }
      get_admin_users: {
        Args: Record<string, never>
        Returns: Array<{ id: string; email: string; role: string }>
      }
      check_unit_availability: {
        Args: {
          unit_id: string
          start_date: string
          end_date: string
        }
        Returns: boolean
      }
      get_user_order_prefill: {
        Args: { user_id: string }
        Returns: Json
      }
      record_notification_failure: {
        Args: {
          p_order_id: string | null
          p_notification_type: string
          p_intended_recipient: string
          p_subject: string | null
          p_message_preview: string | null
          p_error_message: string
        }
        Returns: void
      }
      record_notification_success: {
        Args: {
          p_notification_type: string
        }
        Returns: void
      }
      get_unresolved_failures_count: {
        Args: Record<string, never>
        Returns: number
      }
    }
    Enums: {}
    CompositeTypes: {}
  }
}
