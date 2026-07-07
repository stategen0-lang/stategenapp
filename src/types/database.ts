export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Database {
  public: {
    Tables: {
      Companies: {
        Row: {
          id: number
          Name: string
          domain: string | null
          Plan: string | null
          'is active': boolean | null
          created_at: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          stripe_status: string | null
        }
        Insert: {
          Name: string
          domain?: string | null
          Plan?: string | null
          'is active'?: boolean | null
          created_at?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          stripe_status?: string | null
        }
        Update: {
          Name?: string
          domain?: string | null
          Plan?: string | null
          'is active'?: boolean | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          stripe_status?: string | null
        }
      }
      Profiles: {
        Row: {
          id: string
          created_at: string
          company_id: number
          Full_name: string | null
          role: string | null
          pone: string | null
          agent_code: string | null
          approved: boolean | null
        }
        Insert: {
          id: string
          company_id: number
          Full_name?: string | null
          role?: string | null
          pone?: string | null
          agent_code?: string | null
          approved?: boolean | null
        }
        Update: {
          company_id?: number
          Full_name?: string | null
          role?: string | null
          pone?: string | null
          agent_code?: string | null
          approved?: boolean | null
        }
      }
      Properties: {
        Row: {
          id: number
          created_at: string
          company_id: number
          Title: string
          Location: string | null
          Neighborhood: string | null
          Price: number | null
          Currency: string | null
          Bedrooms: number | null
          bathrooms: number | null
          size: number | null
          Floor_num: number | null
          'Floor Type': string | null
          Payment_terms: string | null
          Amenities: string | null   // JSON array string: ["Pool","Gym"]
          Photos: string | null      // JSON array string: ["url1","url2"]
          Status: string | null
        }
        Insert: {
          company_id: number
          Title: string
          Location?: string | null
          Neighborhood?: string | null
          Price?: number | null
          Currency?: string | null
          Bedrooms?: number | null
          bathrooms?: number | null
          size?: number | null
          Floor_num?: number | null
          'Floor Type'?: string | null
          Payment_terms?: string | null
          Amenities?: string | null
          Photos?: string | null
          Status?: string | null
        }
        Update: {
          Title?: string
          Location?: string | null
          Neighborhood?: string | null
          Price?: number | null
          Currency?: string | null
          Bedrooms?: number | null
          bathrooms?: number | null
          size?: number | null
          Floor_num?: number | null
          'Floor Type'?: string | null
          Payment_terms?: string | null
          Amenities?: string | null
          Photos?: string | null
          Status?: string | null
        }
      }
      client_requests: {
        Row: {
          id: number
          created_at: string
          company_id: number
          Agent_id: string | null
          'Client Name': string
          'client phone': string | null
          budget_min: number | null
          budget_max: number | null
          'prefered-location': string | null
          bedrooms: number | null
          payment_terms: string | null
          notes: string | null
          status: string | null
          match_results: MatchResult[] | null
        }
        Insert: {
          company_id: number
          Agent_id?: string | null
          'Client Name': string
          'client phone'?: string | null
          budget_min?: number | null
          budget_max?: number | null
          'prefered-location'?: string | null
          bedrooms?: number | null
          payment_terms?: string | null
          notes?: string | null
          status?: string | null
          match_results?: MatchResult[] | null
        }
        Update: {
          Agent_id?: string | null
          'Client Name'?: string
          'client phone'?: string | null
          budget_min?: number | null
          budget_max?: number | null
          'prefered-location'?: string | null
          bedrooms?: number | null
          payment_terms?: string | null
          notes?: string | null
          status?: string | null
          match_results?: MatchResult[] | null
        }
      }
      notifications: {
        Row: {
          id: number
          created_at: string
          company_id: number
          client_request_id: number
          property_id: number
          whatsapp_number: string | null
          status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
          sent_at: string | null
          delivered_at: string | null
          read_at: string | null
          error_message: string | null
        }
        Insert: {
          company_id: number
          client_request_id: number
          property_id: number
          whatsapp_number?: string | null
          status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
          sent_at?: string | null
          delivered_at?: string | null
          read_at?: string | null
          error_message?: string | null
        }
        Update: {
          status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
          sent_at?: string | null
          delivered_at?: string | null
          read_at?: string | null
          error_message?: string | null
        }
      }
    }
  }
}

export interface MatchResult {
  property_id: number
  score: number
  reasons: string[]
  notified: boolean
  notified_at?: string
}

// Convenience types
export type Company = Database['public']['Tables']['Companies']['Row']
export type Profile = Database['public']['Tables']['Profiles']['Row']
export type Property = Database['public']['Tables']['Properties']['Row']
export type ClientRequest = Database['public']['Tables']['client_requests']['Row']
export type Notification = Database['public']['Tables']['notifications']['Row']

export type PropertyStatus = 'available' | 'reserved' | 'sold'
export type ClientStatus = 'active' | 'closed' | 'on-hold'
export type UserRole = 'owner' | 'agent' | 'admin'
