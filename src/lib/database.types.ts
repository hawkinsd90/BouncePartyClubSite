export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
        Insert: {
          id?: string
          customer_id?: string | null
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
          customer_id?: string | null
          line1?: string
          line2?: string | null
          city?: string
          state?: string
          zip?: string
          lat?: number | null
          lng?: number | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          }
        ]
      }
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
        Relationships: []
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
        Relationships: []
      }
      consent_records: {
        Row: {
          id: string
          order_id: string
          customer_id: string | null
          consent_type: string
          consented: boolean
          consent_text: string
          consent_version: string
          consented_at: string
          ip_address: string | null
          user_agent: string | null
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          customer_id?: string | null
          consent_type: string
          consented: boolean
          consent_text: string
          consent_version?: string
          consented_at?: string
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          customer_id?: string | null
          consent_type?: string
          consented?: boolean
          consent_text?: string
          consent_version?: string
          consented_at?: string
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_records_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          }
        ]
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
          business_name: string | null
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
          business_name?: string | null
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
          business_name?: string | null
        }
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
        Insert: {
          id?: string
          order_id?: string | null
          stop_id?: string | null
          latitude: number
          longitude: number
          accuracy?: number | null
          speed?: number | null
          heading?: number | null
          checkpoint?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string | null
          stop_id?: string | null
          latitude?: number
          longitude?: number
          accuracy?: number | null
          speed?: number | null
          heading?: number | null
          checkpoint?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_location_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_location_history_stop_id_fkey"
            columns: ["stop_id"]
            isOneToOne: false
            referencedRelation: "route_stops"
            referencedColumns: ["id"]
          }
        ]
      }
      customers: {
        Row: {
          id: string
          first_name: string
          last_name: string
          email: string
          phone: string
          created_at: string
          business_name: string | null
        }
        Insert: {
          id?: string
          first_name: string
          last_name: string
          email: string
          phone: string
          created_at?: string
          business_name?: string | null
        }
        Update: {
          id?: string
          first_name?: string
          last_name?: string
          email?: string
          phone?: string
          created_at?: string
          business_name?: string | null
        }
        Relationships: []
      }
      documents: {
        Row: {
          id: string
          order_id: string | null
          kind: string
          url: string
          meta_json: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          order_id?: string | null
          kind: string
          url: string
          meta_json?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string | null
          kind?: string
          url?: string
          meta_json?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      invoice_links: {
        Row: {
          id: string
          order_id: string
          link_token: string
          customer_filled: boolean
          deposit_cents: number
          expires_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          order_id: string
          link_token?: string
          customer_filled?: boolean
          deposit_cents?: number
          expires_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          link_token?: string
          customer_filled?: boolean
          deposit_cents?: number
          expires_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          id: string
          invoice_number: string
          order_id: string | null
          customer_id: string | null
          invoice_date: string
          due_date: string | null
          status: string
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
          status?: string
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
          status?: string
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
        Relationships: []
      }
      messages: {
        Row: {
          id: string
          order_id: string | null
          to_phone: string | null
          to_email: string | null
          channel: string
          template_key: string
          payload_json: Json
          sent_at: string | null
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          order_id?: string | null
          to_phone?: string | null
          to_email?: string | null
          channel: string
          template_key: string
          payload_json: Json
          sent_at?: string | null
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string | null
          to_phone?: string | null
          to_email?: string | null
          channel?: string
          template_key?: string
          payload_json?: Json
          sent_at?: string | null
          status?: string
          created_at?: string
        }
        Relationships: []
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
        Insert: {
          id?: string
          order_id: string
          name: string
          amount_cents?: number
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          name?: string
          amount_cents?: number
          created_at?: string
        }
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
        Relationships: []
      }
      order_items: {
        Row: {
          id: string
          order_id: string | null
          unit_id: string | null
          wet_or_dry: string
          unit_price_cents: number
          qty: number
          notes: string | null
        }
        Insert: {
          id?: string
          order_id?: string | null
          unit_id?: string | null
          wet_or_dry: string
          unit_price_cents: number
          qty?: number
          notes?: string | null
        }
        Update: {
          id?: string
          order_id?: string | null
          unit_id?: string | null
          wet_or_dry?: string
          unit_price_cents?: number
          qty?: number
          notes?: string | null
        }
        Relationships: []
      }
      order_notes: {
        Row: {
          id: string
          order_id: string | null
          user_id: string | null
          note: string
          created_at: string
        }
        Insert: {
          id?: string
          order_id?: string | null
          user_id?: string | null
          note: string
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string | null
          user_id?: string | null
          note?: string
          created_at?: string
        }
        Relationships: []
      }
      order_refunds: {
        Row: {
          id: string
          order_id: string | null
          amount_cents: number
          reason: string
          stripe_refund_id: string | null
          refunded_by: string | null
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          order_id?: string | null
          amount_cents: number
          reason: string
          stripe_refund_id?: string | null
          refunded_by?: string | null
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string | null
          amount_cents?: number
          reason?: string
          stripe_refund_id?: string | null
          refunded_by?: string | null
          status?: string
          created_at?: string
        }
        Relationships: []
      }
      order_signatures: {
        Row: {
          id: string
          order_id: string
          customer_id: string | null
          signer_name: string
          signer_email: string
          signer_phone: string
          signature_image_url: string
          initials_data: Json
          typed_name: string
          pdf_url: string | null
          pdf_generated_at: string | null
          signed_at: string
          ip_address: string
          user_agent: string
          device_info: Json
          waiver_version: string
          waiver_text_snapshot: string
          electronic_consent_given: boolean
          electronic_consent_text: string
          created_at: string
          updated_at: string
          event_date: string
          event_end_date: string | null
          event_address_line1: string
          event_address_line2: string
          event_city: string
          event_state: string
          event_zip: string
          home_address_line1: string
          home_address_line2: string
          home_city: string
          home_state: string
          home_zip: string
        }
        Insert: {
          id?: string
          order_id: string
          customer_id?: string | null
          signer_name: string
          signer_email: string
          signer_phone: string
          signature_image_url: string
          initials_data?: Json
          typed_name: string
          pdf_url?: string | null
          pdf_generated_at?: string | null
          signed_at?: string
          ip_address: string
          user_agent: string
          device_info?: Json
          waiver_version?: string
          waiver_text_snapshot: string
          electronic_consent_given?: boolean
          electronic_consent_text: string
          created_at?: string
          updated_at?: string
          event_date: string
          event_end_date?: string | null
          event_address_line1: string
          event_address_line2?: string
          event_city: string
          event_state: string
          event_zip: string
          home_address_line1?: string
          home_address_line2?: string
          home_city?: string
          home_state?: string
          home_zip?: string
        }
        Update: {
          id?: string
          order_id?: string
          customer_id?: string | null
          signer_name?: string
          signer_email?: string
          signer_phone?: string
          signature_image_url?: string
          initials_data?: Json
          typed_name?: string
          pdf_url?: string | null
          pdf_generated_at?: string | null
          signed_at?: string
          ip_address?: string
          user_agent?: string
          device_info?: Json
          waiver_version?: string
          waiver_text_snapshot?: string
          electronic_consent_given?: boolean
          electronic_consent_text?: string
          created_at?: string
          updated_at?: string
          event_date?: string
          event_end_date?: string | null
          event_address_line1?: string
          event_address_line2?: string
          event_city?: string
          event_state?: string
          event_zip?: string
          home_address_line1?: string
          home_address_line2?: string
          home_city?: string
          home_state?: string
          home_zip?: string
        }
        Relationships: []
      }
      order_workflow_events: {
        Row: {
          id: string
          order_id: string | null
          event_type: string
          user_id: string | null
          eta: string | null
          notes: string | null
          latitude: number | null
          longitude: number | null
          created_at: string
        }
        Insert: {
          id?: string
          order_id?: string | null
          event_type: string
          user_id?: string | null
          eta?: string | null
          notes?: string | null
          latitude?: number | null
          longitude?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string | null
          event_type?: string
          user_id?: string | null
          eta?: string | null
          notes?: string | null
          latitude?: number | null
          longitude?: number | null
          created_at?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          id: string
          customer_id: string
          status: string
          location_type: string
          surface: string
          event_date: string
          event_end_date: string
          pickup_preference: string
          start_window: string
          end_window: string
          address_id: string | null
          subtotal_cents: number
          travel_fee_cents: number
          surface_fee_cents: number
          same_day_pickup_fee_cents: number
          tax_cents: number
          deposit_due_cents: number
          deposit_paid_cents: number
          balance_due_cents: number
          balance_paid_cents: number
          damage_charged_cents: number
          total_refunded_cents: number
          payment_method_id: string | null
          card_on_file_consent_text: string | null
          card_on_file_consented_at: string | null
          created_at: string
          start_date: string
          end_date: string
          overnight_allowed: boolean
          can_use_stakes: boolean
          generator_selected: boolean
          generator_qty: number
          generator_fee_cents: number
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
          deposit_required: boolean
          stripe_payment_status: string
          workflow_status: string
          current_eta: string | null
          waiver_signed_at: string | null
          waiver_signature_data: string | null
          tip_cents: number
          awaiting_customer_approval: boolean
          customer_approval_requested_at: string | null
          customer_approved_at: string | null
          edit_summary: string | null
          custom_deposit_cents: number | null
          clear_payment_info: boolean
          admin_message: string | null
          signed_waiver_url: string | null
          signature_id: string | null
          e_signature_consent: boolean
          sms_consent: boolean
          card_on_file_consent: boolean
          invoice_sent_at: string | null
          invoice_accepted_at: string | null
          until_end_of_day: boolean
          same_day_responsibility_accepted: boolean
          overnight_responsibility_accepted: boolean
        }
        Insert: {
          id?: string
          customer_id: string
          status?: string
          location_type: string
          surface: string
          event_date: string
          event_end_date: string
          pickup_preference: string
          start_window: string
          end_window: string
          address_id?: string | null
          subtotal_cents: number
          travel_fee_cents?: number
          surface_fee_cents?: number
          same_day_pickup_fee_cents?: number
          tax_cents?: number
          deposit_due_cents: number
          deposit_paid_cents?: number
          balance_due_cents: number
          balance_paid_cents?: number
          damage_charged_cents?: number
          total_refunded_cents?: number
          payment_method_id?: string | null
          card_on_file_consent_text?: string | null
          card_on_file_consented_at?: string | null
          created_at?: string
          start_date: string
          end_date: string
          overnight_allowed?: boolean
          can_use_stakes?: boolean
          generator_selected?: boolean
          generator_qty?: number
          generator_fee_cents?: number
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
          deposit_required?: boolean
          stripe_payment_status?: string
          workflow_status?: string
          current_eta?: string | null
          waiver_signed_at?: string | null
          waiver_signature_data?: string | null
          tip_cents?: number
          awaiting_customer_approval?: boolean
          customer_approval_requested_at?: string | null
          customer_approved_at?: string | null
          edit_summary?: string | null
          custom_deposit_cents?: number | null
          clear_payment_info?: boolean
          admin_message?: string | null
          signed_waiver_url?: string | null
          signature_id?: string | null
          e_signature_consent?: boolean
          sms_consent?: boolean
          card_on_file_consent?: boolean
          invoice_sent_at?: string | null
          invoice_accepted_at?: string | null
          until_end_of_day?: boolean
          same_day_responsibility_accepted?: boolean
          overnight_responsibility_accepted?: boolean
        }
        Update: {
          id?: string
          customer_id?: string
          status?: string
          location_type?: string
          surface?: string
          event_date?: string
          event_end_date?: string
          pickup_preference?: string
          start_window?: string
          end_window?: string
          address_id?: string | null
          subtotal_cents?: number
          travel_fee_cents?: number
          surface_fee_cents?: number
          same_day_pickup_fee_cents?: number
          tax_cents?: number
          deposit_due_cents?: number
          deposit_paid_cents?: number
          balance_due_cents?: number
          balance_paid_cents?: number
          damage_charged_cents?: number
          total_refunded_cents?: number
          payment_method_id?: string | null
          card_on_file_consent_text?: string | null
          card_on_file_consented_at?: string | null
          created_at?: string
          start_date?: string
          end_date?: string
          overnight_allowed?: boolean
          can_use_stakes?: boolean
          generator_selected?: boolean
          generator_qty?: number
          generator_fee_cents?: number
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
          deposit_required?: boolean
          stripe_payment_status?: string
          workflow_status?: string
          current_eta?: string | null
          waiver_signed_at?: string | null
          waiver_signature_data?: string | null
          tip_cents?: number
          awaiting_customer_approval?: boolean
          customer_approval_requested_at?: string | null
          customer_approved_at?: string | null
          edit_summary?: string | null
          custom_deposit_cents?: number | null
          clear_payment_info?: boolean
          admin_message?: string | null
          signed_waiver_url?: string | null
          signature_id?: string | null
          e_signature_consent?: boolean
          sms_consent?: boolean
          card_on_file_consent?: boolean
          invoice_sent_at?: string | null
          invoice_accepted_at?: string | null
          until_end_of_day?: boolean
          same_day_responsibility_accepted?: boolean
          overnight_responsibility_accepted?: boolean
        }
        Relationships: []
      }
      payments: {
        Row: {
          id: string
          order_id: string | null
          type: string
          amount_cents: number
          stripe_payment_intent_id: string | null
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          order_id?: string | null
          type: string
          amount_cents: number
          stripe_payment_intent_id?: string | null
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string | null
          type?: string
          amount_cents?: number
          stripe_payment_intent_id?: string | null
          status?: string
          created_at?: string
        }
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
          updated_at: string
          extra_day_pct: number
          generator_price_cents: number
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
          generator_price_cents?: number
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
          generator_price_cents?: number
        }
        Relationships: []
      }
      route_stops: {
        Row: {
          id: string
          order_id: string | null
          type: string
          eta: string | null
          checkpoint: string
          checkpoint_time: string | null
          gps_lat: number | null
          gps_lng: number | null
          notes: string | null
          created_at: string
          calculated_eta_minutes: number | null
          calculated_eta_distance_miles: number | null
          eta_calculated_at: string | null
          eta_calculation_error: string | null
        }
        Insert: {
          id?: string
          order_id?: string | null
          type: string
          eta?: string | null
          checkpoint?: string
          checkpoint_time?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          notes?: string | null
          created_at?: string
          calculated_eta_minutes?: number | null
          calculated_eta_distance_miles?: number | null
          eta_calculated_at?: string | null
          eta_calculation_error?: string | null
        }
        Update: {
          id?: string
          order_id?: string | null
          type?: string
          eta?: string | null
          checkpoint?: string
          checkpoint_time?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          notes?: string | null
          created_at?: string
          calculated_eta_minutes?: number | null
          calculated_eta_distance_miles?: number | null
          eta_calculated_at?: string | null
          eta_calculation_error?: string | null
        }
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
        Insert: {
          id?: string
          name: string
          amount_cents?: number
          percentage?: number
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          amount_cents?: number
          percentage?: number
          created_at?: string
        }
        Relationships: []
      }
      saved_fee_templates: {
        Row: {
          id: string
          name: string
          amount_cents: number
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          amount_cents?: number
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          amount_cents?: number
          created_at?: string
        }
        Relationships: []
      }
      sms_conversations: {
        Row: {
          id: string
          order_id: string | null
          from_phone: string
          to_phone: string
          message_body: string
          direction: string
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
          direction: string
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
          direction?: string
          twilio_message_sid?: string | null
          status?: string
          created_at?: string
        }
        Relationships: []
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
        Relationships: []
      }
      task_status: {
        Row: {
          id: string
          order_id: string
          task_type: string
          task_date: string
          status: string
          en_route_time: string | null
          arrived_time: string | null
          completed_time: string | null
          eta_sent: boolean
          waiver_reminder_sent: boolean
          payment_reminder_sent: boolean
          sort_order: number
          delivery_images: Json
          damage_images: Json
          notes: string | null
          created_at: string
          updated_at: string
          calculated_eta_minutes: number | null
          gps_lat: number | null
          gps_lng: number | null
          eta_calculation_error: string | null
        }
        Insert: {
          id?: string
          order_id: string
          task_type: string
          task_date: string
          status?: string
          en_route_time?: string | null
          arrived_time?: string | null
          completed_time?: string | null
          eta_sent?: boolean
          waiver_reminder_sent?: boolean
          payment_reminder_sent?: boolean
          sort_order?: number
          delivery_images?: Json
          damage_images?: Json
          notes?: string | null
          created_at?: string
          updated_at?: string
          calculated_eta_minutes?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          eta_calculation_error?: string | null
        }
        Update: {
          id?: string
          order_id?: string
          task_type?: string
          task_date?: string
          status?: string
          en_route_time?: string | null
          arrived_time?: string | null
          completed_time?: string | null
          eta_sent?: boolean
          waiver_reminder_sent?: boolean
          payment_reminder_sent?: boolean
          sort_order?: number
          delivery_images?: Json
          damage_images?: Json
          notes?: string | null
          created_at?: string
          updated_at?: string
          calculated_eta_minutes?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          eta_calculation_error?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_status_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          }
        ]
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
          dimensions_water: string | null
          footprint_sqft: number
          power_circuits: number
          capacity: number
          indoor_ok: boolean
          outdoor_ok: boolean
          active: boolean
          created_at: string
          quantity_available: number
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
          dimensions_water?: string | null
          footprint_sqft: number
          power_circuits?: number
          capacity: number
          indoor_ok?: boolean
          outdoor_ok?: boolean
          active?: boolean
          created_at?: string
          quantity_available?: number
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
          dimensions_water?: string | null
          footprint_sqft?: number
          power_circuits?: number
          capacity?: number
          indoor_ok?: boolean
          outdoor_ok?: boolean
          active?: boolean
          created_at?: string
          quantity_available?: number
        }
        Relationships: []
      }
      unit_media: {
        Row: {
          id: string
          unit_id: string | null
          url: string
          alt: string
          sort: number
          created_at: string
          mode: string
        }
        Insert: {
          id?: string
          unit_id?: string | null
          url: string
          alt: string
          sort?: number
          created_at?: string
          mode?: string
        }
        Update: {
          id?: string
          unit_id?: string | null
          url?: string
          alt?: string
          sort?: number
          created_at?: string
          mode?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          user_id: string
          role: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          role: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          role?: string
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {}
    Functions: {
      is_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      generate_invoice_number: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      get_admin_users: {
        Args: Record<PropertyKey, never>
        Returns: any[]
      }
      check_unit_availability: {
        Args: {
          p_unit_ids: string[]
          p_start_date: string
          p_end_date: string
        }
        Returns: {
          unit_id: string
          unit_name: string
          requested_qty: number
          available_qty: number
          available: boolean
        }[]
      }
    }
    Enums: {}
    CompositeTypes: {}
  }
}

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (Database["public"]["Tables"] & Database["public"]["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (Database["public"]["Tables"] &
      Database["public"]["Views"])
  ? (Database["public"]["Tables"] &
      Database["public"]["Views"])[PublicTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof Database["public"]["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof Database["public"]["Tables"]
  ? Database["public"]["Tables"][PublicTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof Database["public"]["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof Database["public"]["Tables"]
  ? Database["public"]["Tables"][PublicTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof Database["public"]["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof Database["public"]["Enums"]
  ? Database["public"]["Enums"][PublicEnumNameOrOptions]
  : never
