import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface DiscountTemplate {
  id: string;
  name: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
}

export function useDiscountTemplates() {
  const [templates, setTemplates] = useState<DiscountTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('discount_templates')
        .select('*')
        .order('name');

      if (error) throw error;
      setTemplates((data as any || []) as DiscountTemplate[]);
    } catch (err) {
      console.error('Error loading discount templates:', err);
    } finally {
      setLoading(false);
    }
  };

  return { templates, loading, reload: loadTemplates };
}
