export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      addresses: {
        Row: {
          city: string
          created_at: string | null
          customer_id: string | null
          id: string
          lat: number | null
          line1: string
          line2: string | null
          lng: number | null
          state: string
          zip: string
        }
        Insert: {
          city: string
          created_at?: string | null
          customer_id?: string | null
          id?: string
          lat?: number | null
          line1: string
          line2?: string | null
          lng?: number | null
          state: string
          zip: string
        }
        Update: {
          city?: string
          created_at?: string | null
          customer_id?: string | null
          id?: string
          lat?: number | null
          line1?: string
          line2?: string | null
          lng?: number | null
          state?: string
          zip?: string
        }
        Relationships: [
          {
            foreignKeyName: "addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_settings: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      admin_settings_changelog: {
        Row: {
          change_description: string | null
          changed_by: string | null
          created_at: string | null
          id: string
          new_value: string | null
          old_value: string | null
          setting_key: string
        }
        Insert: {
          change_description?: string | null
          changed_by?: string | null
          created_at?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          setting_key: string
        }
        Update: {
          change_description?: string | null
          changed_by?: string | null
          created_at?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          setting_key?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          created_at: string | null
          customer_id: string | null
          email: string
          first_name: string
          id: string
          last_contact_date: string | null
          last_name: string
          opt_in_email: boolean | null
          opt_in_sms: boolean | null
          phone: string | null
          source: string | null
          tags: string[] | null
          total_bookings: number | null
          total_spent_cents: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          customer_id?: string | null
          email: string
          first_name: string
          id?: string
          last_contact_date?: string | null
          last_name: string
          opt_in_email?: boolean | null
          opt_in_sms?: boolean | null
          phone?: string | null
          source?: string | null
          tags?: string[] | null
          total_bookings?: number | null
          total_spent_cents?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string | null
          email?: string
          first_name?: string
          id?: string
          last_contact_date?: string | null
          last_name?: string
          opt_in_email?: boolean | null
          opt_in_sms?: boolean | null
          phone?: string | null
          source?: string | null
          tags?: string[] | null
          total_bookings?: number | null
          total_spent_cents?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string | null
          email: string
          first_name: string
          id: string
          last_name: string
          phone: string
        }
        Insert: {
          created_at?: string | null
          email: string
          first_name: string
          id?: string
          last_name: string
          phone: string
        }
        Update: {
          created_at?: string | null
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          phone?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          created_at: string | null
          id: string
          kind: string
          meta_json: Json | null
          order_id: string | null
          url: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          kind: string
          meta_json?: Json | null
          order_id?: string | null
          url: string
        }
        Update: {
          created_at?: string | null
          id?: string
          kind?: string
          meta_json?: Json | null
          order_id?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string | null
          customer_id: string | null
          due_date: string | null
          id: string
          invoice_date: string | null
          invoice_number: string
          notes: string | null
          order_id: string | null
          paid_amount_cents: number | null
          payment_method: string | null
          pdf_url: string | null
          same_day_pickup_fee_cents: number | null
          status: string | null
          subtotal_cents: number
          surface_fee_cents: number | null
          tax_cents: number | null
          total_cents: number
          travel_fee_cents: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          customer_id?: string | null
          due_date?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number: string
          notes?: string | null
          order_id?: string | null
          paid_amount_cents?: number | null
          payment_method?: string | null
          pdf_url?: string | null
          same_day_pickup_fee_cents?: number | null
          status?: string | null
          subtotal_cents: number
          surface_fee_cents?: number | null
          tax_cents?: number | null
          total_cents: number
          travel_fee_cents?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string | null
          due_date?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string
          notes?: string | null
          order_id?: string | null
          paid_amount_cents?: number | null
          payment_method?: string | null
          pdf_url?: string | null
          same_day_pickup_fee_cents?: number | null
          status?: string | null
          subtotal_cents?: number
          surface_fee_cents?: number | null
          tax_cents?: number | null
          total_cents?: number
          travel_fee_cents?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          channel: string
          created_at: string | null
          id: string
          order_id: string | null
          payload_json: Json
          sent_at: string | null
          status: string | null
          template_key: string
          to_email: string | null
          to_phone: string | null
        }
        Insert: {
          channel: string
          created_at?: string | null
          id?: string
          order_id?: string | null
          payload_json: Json
          sent_at?: string | null
          status?: string | null
          template_key: string
          to_email?: string | null
          to_phone?: string | null
        }
        Update: {
          channel?: string
          created_at?: string | null
          id?: string
          order_id?: string | null
          payload_json?: Json
          sent_at?: string | null
          status?: string | null
          template_key?: string
          to_email?: string | null
          to_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_changelog: {
        Row: {
          change_type: string
          created_at: string | null
          field_changed: string
          id: string
          new_value: string | null
          old_value: string | null
          order_id: string
          user_id: string | null
        }
        Insert: {
          change_type?: string
          created_at?: string | null
          field_changed: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          order_id: string
          user_id?: string | null
        }
        Update: {
          change_type?: string
          created_at?: string | null
          field_changed?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          order_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_changelog_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_discounts: {
        Row: {
          amount_cents: number | null
          created_at: string | null
          created_by: string | null
          id: string
          name: string
          order_id: string
          percentage: number | null
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          name: string
          order_id: string
          percentage?: number | null
        }
        Update: {
          amount_cents?: number | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string
          order_id?: string
          percentage?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_discounts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          notes: string | null
          order_id: string | null
          qty: number | null
          unit_id: string | null
          unit_price_cents: number
          wet_or_dry: string
        }
        Insert: {
          id?: string
          notes?: string | null
          order_id?: string | null
          qty?: number | null
          unit_id?: string | null
          unit_price_cents: number
          wet_or_dry: string
        }
        Update: {
          id?: string
          notes?: string | null
          order_id?: string | null
          qty?: number | null
          unit_id?: string | null
          unit_price_cents?: number
          wet_or_dry?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      order_notes: {
        Row: {
          created_at: string | null
          id: string
          note: string
          order_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          note: string
          order_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          note?: string
          order_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_notes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_refunds: {
        Row: {
          amount_cents: number
          created_at: string | null
          id: string
          order_id: string | null
          reason: string
          refunded_by: string | null
          status: string | null
          stripe_refund_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string | null
          id?: string
          order_id?: string | null
          reason: string
          refunded_by?: string | null
          status?: string | null
          stripe_refund_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string | null
          id?: string
          order_id?: string | null
          reason?: string
          refunded_by?: string | null
          status?: string | null
          stripe_refund_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_workflow_events: {
        Row: {
          created_at: string | null
          eta: string | null
          event_type: string
          id: string
          latitude: number | null
          longitude: number | null
          notes: string | null
          order_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          eta?: string | null
          event_type: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          order_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          eta?: string | null
          event_type?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          order_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_workflow_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          address_id: string | null
          balance_due_cents: number
          balance_paid_cents: number | null
          can_use_stakes: boolean | null
          card_on_file_consent_text: string | null
          card_on_file_consented_at: string | null
          created_at: string | null
          current_eta: string | null
          customer_id: string | null
          damage_charged_cents: number | null
          deposit_due_cents: number
          deposit_paid_cents: number | null
          deposit_required: boolean | null
          end_date: string
          end_window: string
          event_date: string
          generator_selected: boolean | null
          has_pets: boolean | null
          id: string
          location_type: string
          overnight_allowed: boolean | null
          payment_method_id: string | null
          same_day_pickup_fee_cents: number | null
          sms_consent_text: string | null
          sms_consented_at: string | null
          special_details: string | null
          start_date: string
          start_window: string
          status: string | null
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_payment_status: string | null
          subtotal_cents: number
          surface: string
          surface_fee_cents: number | null
          tax_cents: number | null
          tip_cents: number
          total_refunded_cents: number | null
          travel_base_radius_miles: number | null
          travel_chargeable_miles: number | null
          travel_fee_cents: number | null
          travel_is_flat_fee: boolean | null
          travel_per_mile_cents: number | null
          travel_total_miles: number | null
          waiver_signature_data: string | null
          waiver_signed_at: string | null
          workflow_status: string | null
        }
        Insert: {
          address_id?: string | null
          balance_due_cents: number
          balance_paid_cents?: number | null
          can_use_stakes?: boolean | null
          card_on_file_consent_text?: string | null
          card_on_file_consented_at?: string | null
          created_at?: string | null
          current_eta?: string | null
          customer_id?: string | null
          damage_charged_cents?: number | null
          deposit_due_cents: number
          deposit_paid_cents?: number | null
          deposit_required?: boolean | null
          end_date: string
          end_window: string
          event_date: string
          generator_selected?: boolean | null
          has_pets?: boolean | null
          id?: string
          location_type: string
          overnight_allowed?: boolean | null
          payment_method_id?: string | null
          same_day_pickup_fee_cents?: number | null
          sms_consent_text?: string | null
          sms_consented_at?: string | null
          special_details?: string | null
          start_date: string
          start_window: string
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_payment_status?: string | null
          subtotal_cents: number
          surface: string
          surface_fee_cents?: number | null
          tax_cents?: number | null
          tip_cents?: number
          total_refunded_cents?: number | null
          travel_base_radius_miles?: number | null
          travel_chargeable_miles?: number | null
          travel_fee_cents?: number | null
          travel_is_flat_fee?: boolean | null
          travel_per_mile_cents?: number | null
          travel_total_miles?: number | null
          waiver_signature_data?: string | null
          waiver_signed_at?: string | null
          workflow_status?: string | null
        }
        Update: {
          address_id?: string | null
          balance_due_cents?: number
          balance_paid_cents?: number | null
          can_use_stakes?: boolean | null
          card_on_file_consent_text?: string | null
          card_on_file_consented_at?: string | null
          created_at?: string | null
          current_eta?: string | null
          customer_id?: string | null
          damage_charged_cents?: number | null
          deposit_due_cents?: number
          deposit_paid_cents?: number | null
          deposit_required?: boolean | null
          end_date?: string
          end_window?: string
          event_date?: string
          generator_selected?: boolean | null
          has_pets?: boolean | null
          id?: string
          location_type?: string
          overnight_allowed?: boolean | null
          payment_method_id?: string | null
          same_day_pickup_fee_cents?: number | null
          sms_consent_text?: string | null
          sms_consented_at?: string | null
          special_details?: string | null
          start_date?: string
          start_window?: string
          status?: string | null
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_payment_status?: string | null
          subtotal_cents?: number
          surface?: string
          surface_fee_cents?: number | null
          tax_cents?: number | null
          tip_cents?: number
          total_refunded_cents?: number | null
          travel_base_radius_miles?: number | null
          travel_chargeable_miles?: number | null
          travel_fee_cents?: number | null
          travel_is_flat_fee?: boolean | null
          travel_per_mile_cents?: number | null
          travel_total_miles?: number | null
          waiver_signature_data?: string | null
          waiver_signed_at?: string | null
          workflow_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          created_at: string | null
          id: string
          order_id: string | null
          status: string | null
          stripe_payment_intent_id: string | null
          type: string
        }
        Insert: {
          amount_cents: number
          created_at?: string | null
          id?: string
          order_id?: string | null
          status?: string | null
          stripe_payment_intent_id?: string | null
          type: string
        }
        Update: {
          amount_cents?: number
          created_at?: string | null
          id?: string
          order_id?: string | null
          status?: string | null
          stripe_payment_intent_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_rules: {
        Row: {
          base_radius_miles: number | null
          commercial_multiplier: number | null
          extra_day_pct: number | null
          id: string
          included_city_list_json: Json | null
          overnight_holiday_only: boolean | null
          per_mile_after_base_cents: number | null
          residential_multiplier: number | null
          same_day_matrix_json: Json | null
          surface_sandbag_fee_cents: number | null
          updated_at: string | null
          zone_overrides_json: Json | null
        }
        Insert: {
          base_radius_miles?: number | null
          commercial_multiplier?: number | null
          extra_day_pct?: number | null
          id?: string
          included_city_list_json?: Json | null
          overnight_holiday_only?: boolean | null
          per_mile_after_base_cents?: number | null
          residential_multiplier?: number | null
          same_day_matrix_json?: Json | null
          surface_sandbag_fee_cents?: number | null
          updated_at?: string | null
          zone_overrides_json?: Json | null
        }
        Update: {
          base_radius_miles?: number | null
          commercial_multiplier?: number | null
          extra_day_pct?: number | null
          id?: string
          included_city_list_json?: Json | null
          overnight_holiday_only?: boolean | null
          per_mile_after_base_cents?: number | null
          residential_multiplier?: number | null
          same_day_matrix_json?: Json | null
          surface_sandbag_fee_cents?: number | null
          updated_at?: string | null
          zone_overrides_json?: Json | null
        }
        Relationships: []
      }
      route_stops: {
        Row: {
          checkpoint: string | null
          checkpoint_time: string | null
          created_at: string | null
          eta: string | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          notes: string | null
          order_id: string | null
          type: string
        }
        Insert: {
          checkpoint?: string | null
          checkpoint_time?: string | null
          created_at?: string | null
          eta?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          notes?: string | null
          order_id?: string | null
          type: string
        }
        Update: {
          checkpoint?: string | null
          checkpoint_time?: string | null
          created_at?: string | null
          eta?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          notes?: string | null
          order_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_stops_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_conversations: {
        Row: {
          created_at: string | null
          direction: string
          from_phone: string
          id: string
          message_body: string
          order_id: string | null
          status: string | null
          to_phone: string
          twilio_message_sid: string | null
        }
        Insert: {
          created_at?: string | null
          direction: string
          from_phone: string
          id?: string
          message_body: string
          order_id?: string | null
          status?: string | null
          to_phone: string
          twilio_message_sid?: string | null
        }
        Update: {
          created_at?: string | null
          direction?: string
          from_phone?: string
          id?: string
          message_body?: string
          order_id?: string | null
          status?: string | null
          to_phone?: string
          twilio_message_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_conversations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_message_templates: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          message_template: string
          template_key: string
          template_name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          message_template: string
          template_key: string
          template_name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          message_template?: string
          template_key?: string
          template_name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      unit_media: {
        Row: {
          alt: string
          created_at: string | null
          id: string
          mode: string | null
          sort: number | null
          unit_id: string | null
          url: string
        }
        Insert: {
          alt: string
          created_at?: string | null
          id?: string
          mode?: string | null
          sort?: number | null
          unit_id?: string | null
          url: string
        }
        Update: {
          alt?: string
          created_at?: string | null
          id?: string
          mode?: string | null
          sort?: number | null
          unit_id?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_media_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          active: boolean | null
          capacity: number
          created_at: string | null
          dimensions: string
          dimensions_water: string | null
          footprint_sqft: number
          id: string
          indoor_ok: boolean | null
          is_combo: boolean | null
          name: string
          outdoor_ok: boolean | null
          power_circuits: number | null
          price_dry_cents: number
          price_water_cents: number | null
          quantity_available: number
          slug: string
          type: string
        }
        Insert: {
          active?: boolean | null
          capacity: number
          created_at?: string | null
          dimensions: string
          dimensions_water?: string | null
          footprint_sqft: number
          id?: string
          indoor_ok?: boolean | null
          is_combo?: boolean | null
          name: string
          outdoor_ok?: boolean | null
          power_circuits?: number | null
          price_dry_cents: number
          price_water_cents?: number | null
          quantity_available?: number
          slug: string
          type: string
        }
        Update: {
          active?: boolean | null
          capacity?: number
          created_at?: string | null
          dimensions?: string
          dimensions_water?: string | null
          footprint_sqft?: number
          id?: string
          indoor_ok?: boolean | null
          is_combo?: boolean | null
          name?: string
          outdoor_ok?: boolean | null
          power_circuits?: number | null
          price_dry_cents?: number
          price_water_cents?: number | null
          quantity_available?: number
          slug?: string
          type?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_unit_availability: {
        Args: { p_end_date: string; p_start_date: string; p_unit_ids: string[] }
        Returns: {
          available: boolean
          available_qty: number
          requested_qty: number
          unit_id: string
          unit_name: string
        }[]
      }
      generate_invoice_number: { Args: never; Returns: string }
      get_admin_users: {
        Args: never
        Returns: {
          count: number
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
