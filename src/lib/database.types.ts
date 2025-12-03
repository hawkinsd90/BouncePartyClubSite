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
      }
      contacts: {
        Row: {
          id: string
          customer_id: string | null
          first_name: string
          last_name: string
          email: string
          phone: string | null
          business_name: string | null
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
          business_name?: string | null
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
          business_name?: string | null
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
          business_name: string | null
          created_at: string
        }
        Insert: {
          id?: string
          first_name: string
          last_name: string
          email: string
          phone: string
          business_name?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          first_name?: string
          last_name?: string
          email?: string
          phone?: string
          business_name?: string | null
          created_at?: string
        }
      }
      documents: {
        Row: {
          id: string
          order_id: string
          kind: string
          url: string
          meta_json: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          kind: string
          url: string
          meta_json?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          kind?: string
          url?: string
          meta_json?: Json | null
          created_at?: string
        }
      }
      invoice_links: {
        Row: {
          id: string
          order_id: string
          link_token: string
          customer_filled: boolean
          deposit_cents: number
          expires_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          order_id: string
          link_token?: string
          customer_filled?: boolean
          deposit_cents?: number
          expires_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          link_token?: string
          customer_filled?: boolean
          deposit_cents?: number
          expires_at?: string
          created_at?: string
          updated_at?: string
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
      }
      messages: {
        Row: {
          id: string
          order_id: string
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
          order_id: string
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
          order_id?: string
          to_phone?: string | null
          to_email?: string | null
          channel?: string
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
          unit_id: string | null
          wet_or_dry: string
          unit_price_cents: number
          qty: number
          notes: string | null
        }
        Insert: {
          id?: string
          order_id: string
          unit_id?: string | null
          wet_or_dry: string
          unit_price_cents: number
          qty?: number
          notes?: string | null
        }
        Update: {
          id?: string
          order_id?: string
          unit_id?: string | null
          wet_or_dry?: string
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
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          amount_cents: number
          reason: string
          stripe_refund_id?: string | null
          refunded_by?: string | null
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          amount_cents?: number
          reason?: string
          stripe_refund_id?: string | null
          refunded_by?: string | null
          status?: string
          created_at?: string
        }
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
          event_date: string
          event_end_date: string | null
          event_address_line1: string
          event_address_line2: string | null
          event_city: string
          event_state: string
          event_zip: string
          home_address_line1: string | null
          home_address_line2: string | null
          home_city: string | null
          home_state: string | null
          home_zip: string | null
          created_at: string
          updated_at: string
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
          event_date: string
          event_end_date?: string | null
          event_address_line1: string
          event_address_line2?: string | null
          event_city: string
          event_state: string
          event_zip: string
          home_address_line1?: string | null
          home_address_line2?: string | null
          home_city?: string | null
          home_state?: string | null
          home_zip?: string | null
          created_at?: string
          updated_at?: string
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
          event_date?: string
          event_end_date?: string | null
          event_address_line1?: string
          event_address_line2?: string | null
          event_city?: string
          event_state?: string
          event_zip?: string
          home_address_line1?: string | null
          home_address_line2?: string | null
          home_city?: string | null
          home_state?: string | null
          home_zip?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      order_workflow_events: {
        Row: {
          id: string
          order_id: string
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
          order_id: string
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
          order_id?: string
          event_type?: string
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
          generator_fee_cents: number
          generator_qty: number
          tax_cents: number
          tip_cents: number
          deposit_due_cents: number
          deposit_paid_cents: number
          balance_due_cents: number
          payment_method_id: string | null
          card_on_file_consent_text: string | null
          card_on_file_consented_at: string | null
          card_on_file_consent: boolean
          sms_consent: boolean
          e_signature_consent: boolean
          start_date: string
          end_date: string
          overnight_allowed: boolean
          can_use_stakes: boolean
          generator_selected: boolean
          workflow_status: string
          current_eta: string | null
          waiver_signed_at: string | null
          waiver_signature_data: string | null
          signed_waiver_url: string | null
          signature_id: string | null
          admin_message: string | null
          invoice_sent_at: string | null
          invoice_accepted_at: string | null
          custom_deposit_cents: number | null
          until_end_of_day: boolean
          same_day_responsibility_accepted: boolean
          overnight_responsibility_accepted: boolean
          created_at: string
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
          generator_fee_cents?: number
          generator_qty?: number
          tax_cents?: number
          tip_cents?: number
          deposit_due_cents: number
          deposit_paid_cents?: number
          balance_due_cents: number
          payment_method_id?: string | null
          card_on_file_consent_text?: string | null
          card_on_file_consented_at?: string | null
          card_on_file_consent?: boolean
          sms_consent?: boolean
          e_signature_consent?: boolean
          start_date: string
          end_date: string
          overnight_allowed?: boolean
          can_use_stakes?: boolean
          generator_selected?: boolean
          workflow_status?: string
          current_eta?: string | null
          waiver_signed_at?: string | null
          waiver_signature_data?: string | null
          signed_waiver_url?: string | null
          signature_id?: string | null
          admin_message?: string | null
          invoice_sent_at?: string | null
          invoice_accepted_at?: string | null
          custom_deposit_cents?: number | null
          until_end_of_day?: boolean
          same_day_responsibility_accepted?: boolean
          overnight_responsibility_accepted?: boolean
          created_at?: string
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
          generator_fee_cents?: number
          generator_qty?: number
          tax_cents?: number
          tip_cents?: number
          deposit_due_cents?: number
          deposit_paid_cents?: number
          balance_due_cents?: number
          payment_method_id?: string | null
          card_on_file_consent_text?: string | null
          card_on_file_consented_at?: string | null
          card_on_file_consent?: boolean
          sms_consent?: boolean
          e_signature_consent?: boolean
          start_date?: string
          end_date?: string
          overnight_allowed?: boolean
          can_use_stakes?: boolean
          generator_selected?: boolean
          workflow_status?: string
          current_eta?: string | null
          waiver_signed_at?: string | null
          waiver_signature_data?: string | null
          signed_waiver_url?: string | null
          signature_id?: string | null
          admin_message?: string | null
          invoice_sent_at?: string | null
          invoice_accepted_at?: string | null
          custom_deposit_cents?: number | null
          until_end_of_day?: boolean
          same_day_responsibility_accepted?: boolean
          overnight_responsibility_accepted?: boolean
          created_at?: string
        }
      }
      payments: {
        Row: {
          id: string
          order_id: string
          type: string
          amount_cents: number
          stripe_payment_intent_id: string | null
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          type: string
          amount_cents: number
          stripe_payment_intent_id?: string | null
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          type?: string
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
          extra_day_pct: number
          generator_price_cents: number
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
          extra_day_pct?: number
          generator_price_cents?: number
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
          extra_day_pct?: number
          generator_price_cents?: number
          updated_at?: string
        }
      }
      route_stops: {
        Row: {
          id: string
          order_id: string
          type: string
          eta: string | null
          checkpoint: string
          checkpoint_time: string | null
          gps_lat: number | null
          gps_lng: number | null
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          type: string
          eta?: string | null
          checkpoint?: string
          checkpoint_time?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          type?: string
          eta?: string | null
          checkpoint?: string
          checkpoint_time?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          notes?: string | null
          created_at?: string
        }
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
          mode: string
          created_at: string
        }
        Insert: {
          id?: string
          unit_id: string
          url: string
          alt: string
          sort?: number
          mode?: string
          created_at?: string
        }
        Update: {
          id?: string
          unit_id?: string
          url?: string
          alt?: string
          sort?: number
          mode?: string
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
          dimensions_water: string | null
          footprint_sqft: number
          power_circuits: number
          capacity: number
          indoor_ok: boolean
          outdoor_ok: boolean
          active: boolean
          quantity_available: number
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
          dimensions_water?: string | null
          footprint_sqft: number
          power_circuits?: number
          capacity: number
          indoor_ok?: boolean
          outdoor_ok?: boolean
          active?: boolean
          quantity_available?: number
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
          dimensions_water?: string | null
          footprint_sqft?: number
          power_circuits?: number
          capacity?: number
          indoor_ok?: boolean
          outdoor_ok?: boolean
          active?: boolean
          quantity_available?: number
          created_at?: string
        }
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
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_unit_availability: {
        Args: {
          p_unit_id: string
          p_start_date: string
          p_end_date: string
          p_exclude_order_id?: string
        }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
