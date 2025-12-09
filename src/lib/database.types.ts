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
        Relationships: []
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
          oauth_provider: string | null
          oauth_profile_data: Json
          default_address_id: string | null
        }
        Insert: {
          id?: string
          first_name: string
          last_name: string
          email: string
          phone: string
          created_at?: string
          business_name?: string | null
          oauth_provider?: string | null
          oauth_profile_data?: Json
          default_address_id?: string | null
        }
        Update: {
          id?: string
          first_name?: string
          last_name?: string
          email?: string
          phone?: string
          created_at?: string
          business_name?: string | null
          oauth_provider?: string | null
          oauth_profile_data?: Json
          default_address_id?: string | null
        }
        Relationships: []
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
        Relationships: []
      }
      orders: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
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
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      route_stops: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      documents: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      invoices: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      invoice_links: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      messages: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      order_changelog: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      order_custom_fees: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      order_discounts: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      order_items: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      order_notes: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      order_refunds: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      order_signatures: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      order_workflow_events: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      payments: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      pricing_rules: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      saved_discount_templates: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      saved_fee_templates: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      sms_conversations: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      sms_message_templates: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      task_status: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      units: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
      unit_media: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
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
      hero_carousel_images: {
        Row: {
          id: string
          image_url: string
          title: string | null
          description: string | null
          display_order: number
          is_active: boolean
          created_at: string
          updated_at: string
          media_type: string
          storage_path: string | null
        }
        Insert: {
          id?: string
          image_url: string
          title?: string | null
          description?: string | null
          display_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
          media_type?: string
          storage_path?: string | null
        }
        Update: {
          id?: string
          image_url?: string
          title?: string | null
          description?: string | null
          display_order?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
          media_type?: string
          storage_path?: string | null
        }
        Relationships: []
      }
      customer_profiles: {
        Row: {
          id: string
          user_id: string
          contact_id: string | null
          display_name: string | null
          phone: string | null
          email_notifications: boolean
          sms_notifications: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          contact_id?: string | null
          display_name?: string | null
          phone?: string | null
          email_notifications?: boolean
          sms_notifications?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          contact_id?: string | null
          display_name?: string | null
          phone?: string | null
          email_notifications?: boolean
          sms_notifications?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      auth_trigger_logs: {
        Row: {
          [key: string]: any
        }
        Insert: {
          [key: string]: any
        }
        Update: {
          [key: string]: any
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
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
        Returns: {
          id: string
          email: string
          role: string
        }[]
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
      get_user_order_prefill: {
        Args: {
          p_user_id: string
        }
        Returns: any
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
