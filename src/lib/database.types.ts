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
          first_name: string | null
          last_name: string | null
          email: string | null
          phone: string | null
          business_name: string | null
          total_bookings: number
          total_spent_cents: number
          completed_bookings_count: number
          is_repeat_customer: boolean
          last_completed_booking_date: string | null
          first_completed_booking_date: string | null
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
          order_id: string | null
          stop_id: string | null
          latitude: number
          longitude: number
          accuracy: number | null
          speed: number | null
          heading: number | null
          checkpoint: string | null
          created_at: string
        }
        Insert: { latitude: number; longitude: number; order_id?: string | null; stop_id?: string | null; accuracy?: number | null; speed?: number | null; heading?: number | null; checkpoint?: string | null }
        Update: Partial<Database['public']['Tables']['crew_location_history']['Insert']>
        Relationships: []
      }
      customer_profiles: {
        Row: {
          id: string
          user_id: string
          contact_id: string | null
          phone: string | null
          email_notifications: boolean | null
          sms_notifications: boolean | null
          first_name: string | null
          last_name: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['customer_profiles']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['customer_profiles']['Insert']>
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
          oauth_provider: string | null
          oauth_profile_data: Json | null
          default_address_id: string | null
          user_id: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['customers']['Row'], 'id' | 'created_at' | 'oauth_provider' | 'oauth_profile_data' | 'default_address_id' | 'user_id'> & { oauth_provider?: string | null; oauth_profile_data?: Json | null; default_address_id?: string | null; user_id?: string | null }
        Update: Partial<Database['public']['Tables']['customers']['Insert']>
        Relationships: []
      }
      daily_mileage_logs: {
        Row: {
          id: string
          user_id: string
          date: string
          start_mileage: number | null
          end_mileage: number | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['daily_mileage_logs']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['daily_mileage_logs']['Insert']>
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
      hero_carousel_images: {
        Row: {
          id: string
          image_url: string
          storage_path: string | null
          media_type: string
          title: string | null
          description: string | null
          display_order: number
          is_active: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['hero_carousel_images']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['hero_carousel_images']['Insert']>
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
          customer_id?: string | null
          status?: string | null
          subtotal_cents?: number | null
          tax_cents?: number | null
          travel_fee_cents?: number | null
          surface_fee_cents?: number | null
          same_day_pickup_fee_cents?: number | null
          total_cents?: number | null
          paid_amount_cents?: number | null
        }
        Insert: Omit<Database['public']['Tables']['invoices']['Row'], 'id' | 'created_at' | 'paid_at'> & { paid_at?: string | null }
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
          lot_pictures_requested: boolean | null
          lot_pictures_requested_at: string | null
          workflow_status: string | null
          waiver_signed_at: string | null
          e_signature_consent: boolean | null
          customer_selected_payment_cents: number | null
          customer_selected_payment_type: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_payment_status: string | null
          balance_paid_cents: number | null
          damage_charged_cents: number | null
          total_refunded_cents: number | null
          deposit_required: boolean | null
          payment_method_id: string | null
          payment_method_last_four: string | null
          payment_method_brand: string | null
          payment_method_exp_month: number | null
          payment_method_exp_year: number | null
          payment_method_validated_at: string | null
          card_on_file_consent_text: string | null
          card_on_file_consented_at: string | null
          special_details: string | null
          has_pets: boolean | null
          overnight_allowed: boolean | null
          can_use_stakes: boolean | null
          generator_selected: boolean | null
          current_eta: string | null
          waiver_signature_data: string | null
          signed_waiver_url: string | null
          signature_id: string | null
          invoice_sent_at: string | null
          invoice_accepted_at: string | null
          awaiting_customer_approval: boolean | null
          customer_approval_requested_at: string | null
          customer_approved_at: string | null
          edit_summary: string | null
          sms_consent_text: string | null
          sms_consented_at: string | null
          surface_fee_waived: boolean | null
          surface_fee_waive_reason: string | null
          generator_fee_waived: boolean | null
          generator_fee_waive_reason: string | null
          event_start_time: string | null
          pickup_time: string | null
          event_end_time: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          clear_payment_info: boolean | null
          require_card_on_file: boolean | null
          archived_at: string | null
          pending_review_admin_alerted: boolean
          confirmed_admin_alerted: boolean
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['orders']['Row'], 'id' | 'order_number' | 'created_at' | 'updated_at' | 'until_end_of_day' | 'location_type' | 'surface' | 'pickup_preference' | 'same_day_responsibility_accepted' | 'overnight_responsibility_accepted' | 'subtotal_cents' | 'travel_fee_cents' | 'travel_total_miles' | 'travel_base_radius_miles' | 'travel_chargeable_miles' | 'travel_per_mile_cents' | 'travel_is_flat_fee' | 'surface_fee_cents' | 'same_day_pickup_fee_cents' | 'generator_fee_cents' | 'generator_qty' | 'tax_cents' | 'tax_waived' | 'travel_fee_waived' | 'same_day_pickup_fee_waived' | 'tip_cents' | 'total_cents' | 'deposit_due_cents' | 'deposit_paid_cents' | 'balance_due_cents' | 'card_on_file_consent' | 'sms_consent' | 'booking_confirmation_sent' | 'pending_review_admin_alerted' | 'confirmed_admin_alerted' | 'awaiting_customer_approval' | 'lot_pictures_requested' | 'lot_pictures_requested_at' | 'workflow_status' | 'waiver_signed_at' | 'e_signature_consent' | 'customer_selected_payment_cents' | 'customer_selected_payment_type' | 'stripe_customer_id' | 'stripe_payment_method_id' | 'stripe_payment_status' | 'balance_paid_cents' | 'damage_charged_cents' | 'total_refunded_cents' | 'deposit_required' | 'payment_method_id' | 'payment_method_last_four' | 'payment_method_brand' | 'payment_method_exp_month' | 'payment_method_exp_year' | 'payment_method_validated_at' | 'card_on_file_consent_text' | 'card_on_file_consented_at' | 'has_pets' | 'overnight_allowed' | 'can_use_stakes' | 'generator_selected' | 'current_eta' | 'waiver_signature_data' | 'signed_waiver_url' | 'signature_id' | 'invoice_sent_at' | 'invoice_accepted_at' | 'customer_approval_requested_at' | 'customer_approved_at' | 'edit_summary' | 'surface_fee_waived' | 'surface_fee_waive_reason' | 'generator_fee_waived' | 'generator_fee_waive_reason' | 'event_start_time' | 'pickup_time' | 'event_end_time' | 'cancelled_at' | 'cancelled_by' | 'clear_payment_info' | 'require_card_on_file' | 'archived_at'> & { until_end_of_day?: boolean; location_type?: string; surface?: string; pickup_preference?: string; same_day_responsibility_accepted?: boolean; overnight_responsibility_accepted?: boolean; subtotal_cents?: number; travel_fee_cents?: number; travel_total_miles?: number; travel_base_radius_miles?: number; travel_chargeable_miles?: number; travel_per_mile_cents?: number; travel_is_flat_fee?: boolean; surface_fee_cents?: number; same_day_pickup_fee_cents?: number; generator_fee_cents?: number; generator_qty?: number; tax_cents?: number; tax_waived?: boolean; travel_fee_waived?: boolean; same_day_pickup_fee_waived?: boolean; tip_cents?: number; total_cents?: number; deposit_due_cents?: number; deposit_paid_cents?: number; balance_due_cents?: number; card_on_file_consent?: boolean; sms_consent?: boolean; booking_confirmation_sent?: boolean; pending_review_admin_alerted?: boolean; confirmed_admin_alerted?: boolean; awaiting_customer_approval?: boolean | null; lot_pictures_requested?: boolean | null; lot_pictures_requested_at?: string | null; workflow_status?: string | null; waiver_signed_at?: string | null; e_signature_consent?: boolean | null; customer_selected_payment_cents?: number | null; customer_selected_payment_type?: string | null; stripe_customer_id?: string | null; stripe_payment_method_id?: string | null; stripe_payment_status?: string | null; balance_paid_cents?: number | null; damage_charged_cents?: number | null; total_refunded_cents?: number | null; deposit_required?: boolean | null; payment_method_id?: string | null; payment_method_last_four?: string | null; payment_method_brand?: string | null; payment_method_exp_month?: number | null; payment_method_exp_year?: number | null; payment_method_validated_at?: string | null; card_on_file_consent_text?: string | null; card_on_file_consented_at?: string | null; has_pets?: boolean | null; overnight_allowed?: boolean | null; can_use_stakes?: boolean | null; generator_selected?: boolean | null; current_eta?: string | null; waiver_signature_data?: string | null; signed_waiver_url?: string | null; signature_id?: string | null; invoice_sent_at?: string | null; invoice_accepted_at?: string | null; customer_approval_requested_at?: string | null; customer_approved_at?: string | null; edit_summary?: string | null; surface_fee_waived?: boolean | null; surface_fee_waive_reason?: string | null; generator_fee_waived?: boolean | null; generator_fee_waive_reason?: string | null; event_start_time?: string | null; pickup_time?: string | null; event_end_time?: string | null; cancelled_at?: string | null; cancelled_by?: string | null; clear_payment_info?: boolean | null; require_card_on_file?: boolean | null; archived_at?: string | null }
        Update: Partial<Database['public']['Tables']['orders']['Insert']>
        Relationships: []
      }
      order_changelog: {
        Row: {
          id: string
          order_id: string
          changed_by: string | null
          user_id: string | null
          change_type: string
          field_name: string | null
          field_changed: string | null
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
      order_lot_pictures: {
        Row: {
          id: string
          order_id: string
          image_url: string
          uploaded_by: string | null
          notes: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['order_lot_pictures']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['order_lot_pictures']['Insert']>
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
          signer_name: string | null
          signer_phone: string | null
          signer_email: string | null
          typed_name: string | null
          ip_address: string | null
          user_agent: string | null
          waiver_version: string | null
          electronic_consent_given: boolean | null
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
          base_radius_miles: number | null
          included_city_list_json: Json | null
          per_mile_after_base_cents: number | null
          zone_overrides_json: Json | null
          surface_sandbag_fee_cents: number | null
          residential_multiplier: number | null
          commercial_multiplier: number | null
          same_day_matrix_json: Json | null
          overnight_holiday_only: boolean | null
          extra_day_pct: number | null
          generator_price_cents: number | null
          deposit_percentage: number | null
          deposit_per_unit_cents: number | null
          free_city_list_json: Json | null
          same_day_pickup_fee_cents: number | null
          tax_rate: number | null
          generator_fee_single_cents: number | null
          generator_fee_multiple_cents: number | null
          apply_taxes_by_default: boolean | null
          included_cities: string[] | null
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
          task_id: string | null
          order_id: string
          status: string
          crew_notes: string | null
          admin_notes: string | null
          notes: string | null
          completed_at: string | null
          completed_time: string | null
          estimated_arrival: string | null
          sort_order: number | null
          task_type: string | null
          task_date: string | null
          en_route_time: string | null
          eta_sent: boolean | null
          waiver_reminder_sent: boolean | null
          payment_reminder_sent: boolean | null
          calculated_eta_minutes: number | null
          gps_lat: number | null
          gps_lng: number | null
          eta_calculation_error: string | null
          delivery_images: string[] | null
          damage_images: string[] | null
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
          is_featured: boolean | null
          visibility_mode: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['unit_media']['Row'], 'id' | 'created_at'> & { is_featured?: boolean | null; visibility_mode?: string | null }
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
      user_permissions_changelog: {
        Row: {
          id: string
          target_user_id: string
          action: string
          old_role: string | null
          new_role: string | null
          changed_by_user_id: string | null
          notes: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['user_permissions_changelog']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['user_permissions_changelog']['Insert']>
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
      saved_fee_templates: {
        Row: {
          id: string
          name: string
          amount_cents: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['saved_fee_templates']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['saved_fee_templates']['Insert']>
        Relationships: []
      }
      site_events: {
        Row: {
          id: string
          event_name: string
          page_path: string | null
          session_id: string | null
          unit_id: string | null
          order_id: string | null
          metadata: Json | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['site_events']['Row'], 'id' | 'created_at'> & { metadata?: Record<string, unknown> | Json | null }
        Update: Partial<Database['public']['Tables']['site_events']['Insert']>
        Relationships: []
      }
      saved_discount_templates: {
        Row: {
          id: string
          name: string
          amount_cents: number
          percentage: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['saved_discount_templates']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['saved_discount_templates']['Insert']>
        Relationships: []
      }
      pending_signups_consent: {
        Row: {
          user_id: string
          batch_id: string
          consents: Json
          source: string
          user_agent_hint: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['pending_signups_consent']['Row'], 'created_at'> & { created_at?: string }
        Update: Partial<Database['public']['Tables']['pending_signups_consent']['Insert']>
        Relationships: []
      }
      google_reviews: {
        Row: {
          id: string
          reviewer_name: string
          reviewer_initial: string
          rating: number
          review_text: string
          review_date: string
          google_review_url: string | null
          display_order: number
          is_active: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['google_reviews']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['google_reviews']['Insert']>
        Relationships: []
      }
      invoice_links: {
        Row: {
          id: string
          order_id: string
          link_token: string
          customer_filled: boolean | null
          deposit_cents: number
          expires_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['invoice_links']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['invoice_links']['Insert']>
        Relationships: []
      }
      transaction_receipts: {
        Row: {
          id: string
          receipt_number: string
          transaction_type: string
          order_id: string
          customer_id: string
          payment_id: string | null
          amount_cents: number
          payment_method: string | null
          payment_method_brand: string | null
          stripe_charge_id: string | null
          stripe_payment_intent_id: string | null
          notes: string | null
          receipt_group_id: string | null
          receipt_sent_to_admin: boolean | null
          admin_notified_at: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['transaction_receipts']['Row'], 'id' | 'receipt_number' | 'created_at' | 'receipt_sent_to_admin' | 'admin_notified_at'> & { receipt_sent_to_admin?: boolean | null; admin_notified_at?: string | null }
        Update: Partial<Database['public']['Tables']['transaction_receipts']['Insert']>
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
      get_all_role_users: {
        Args: Record<string, never>
        Returns: Array<{ user_id: string; user_role: string | null; email: string; created_at: string }>
      }
      assign_role_by_email: {
        Args: { p_email: string; p_role: string }
        Returns: boolean
      }
      archive_old_orders: {
        Args: { threshold_days?: number }
        Returns: number
      }
      get_admin_analytics: {
        Args: { p_start?: string; p_end?: string }
        Returns: Json
      }
      check_date_blackout: {
        Args: { p_start: string; p_end: string }
        Returns: { is_full_blocked: boolean; is_same_day_pickup_blocked: boolean }
      }
      upsert_contact_from_checkout: {
        Args: {
          p_first_name: string
          p_last_name: string
          p_email: string
          p_phone: string
          p_business_name: string | null
          p_opt_in_sms: boolean
        }
        Returns: void
      }
      approve_order: {
        Args: { p_order_id: string; p_user_id: string }
        Returns: boolean
      }
    }
    Enums: {}
    CompositeTypes: {}
  }
}
