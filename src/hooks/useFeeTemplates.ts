import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface FeeTemplate {
  id: string;
  name: string;
  fee_type: 'fixed' | 'percentage';
  fee_value: number;
  description?: string;
}

export function useFeeTemplates() {
  const [templates, setTemplates] = useState<FeeTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('fee_templates')
        .select('*')
        .order('name');

      if (error) throw error;
      setTemplates((data || []) as FeeTemplate[]);
    } catch (err) {
      console.error('Error loading fee templates:', err);
    } finally {
      setLoading(false);
    }
  };

  return { templates, loading, reload: loadTemplates };
}
