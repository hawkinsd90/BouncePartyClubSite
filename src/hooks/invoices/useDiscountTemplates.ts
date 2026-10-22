import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

// The table's real columns (see lib/orders/discountTemplates.ts).
interface DiscountTemplate {
  id: string;
  name: string;
  amount_cents: number | null;
  percentage: number | null;
}

export function useDiscountTemplates() {
  const [templates, setTemplates] = useState<DiscountTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      setError(false);
      const { data, error } = await supabase
        .from('saved_discount_templates')
        .select('*')
        .order('name');

      if (error) throw error;
      setTemplates((data as any || []) as DiscountTemplate[]);
    } catch (err) {
      console.error('Error loading discount templates:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return { templates, loading, error, reload: loadTemplates };
}
