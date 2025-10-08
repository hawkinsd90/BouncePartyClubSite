import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ArrowLeft, Save } from 'lucide-react';

export function UnitForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;

  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    type: 'Bounce House',
    is_combo: false,
    price_dry_cents: 0,
    price_water_cents: 0,
    dimensions: '',
    footprint_sqft: 0,
    power_circuits: 1,
    capacity: 0,
    indoor_ok: true,
    outdoor_ok: true,
    active: true,
    quantity_available: 1,
  });

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isEdit) {
      loadUnit();
    }
  }, [id]);

  async function loadUnit() {
    const { data, error } = await supabase
      .from('units')
      .select('*')
      .eq('id', id)
      .single();

    if (data) {
      setFormData(data);
    }
  }

  function generateSlug(name: string) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      const dataToSave = {
        ...formData,
        slug: formData.slug || generateSlug(formData.name),
      };

      if (isEdit) {
        const { error } = await supabase
          .from('units')
          .update(dataToSave)
          .eq('id', id);

        if (error) throw error;
        alert('Unit updated successfully!');
      } else {
        const { error } = await supabase
          .from('units')
          .insert([dataToSave]);

        if (error) throw error;
        alert('Unit created successfully!');
      }

      navigate('/admin');
    } catch (error: any) {
      console.error('Error saving unit:', error);
      alert(`Failed to save unit: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <button
        onClick={() => navigate('/admin')}
        className="flex items-center text-blue-600 hover:text-blue-700 mb-6"
      >
        <ArrowLeft className="w-5 h-5 mr-2" />
        Back to Admin
      </button>

      <div className="bg-white rounded-xl shadow-md p-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-8">
          {isEdit ? 'Edit Unit' : 'Add New Unit'}
        </h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Unit Name *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value, slug: generateSlug(e.target.value) })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                URL Slug *
              </label>
              <input
                type="text"
                required
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Type *
              </label>
              <select
                required
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option>Bounce House</option>
                <option>Water Slide</option>
                <option>Combo</option>
                <option>Obstacle Course</option>
                <option>Interactive</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Quantity Available *
              </label>
              <input
                type="number"
                required
                min="1"
                value={formData.quantity_available}
                onChange={(e) => setFormData({ ...formData, quantity_available: parseInt(e.target.value) })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Price (Dry Mode) $ *
              </label>
              <input
                type="number"
                required
                min="0"
                step="0.01"
                value={(formData.price_dry_cents / 100).toFixed(2)}
                onChange={(e) => setFormData({ ...formData, price_dry_cents: Math.round(parseFloat(e.target.value) * 100) })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Price (Water Mode) $
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.price_water_cents ? (formData.price_water_cents / 100).toFixed(2) : ''}
                onChange={(e) => setFormData({ ...formData, price_water_cents: e.target.value ? Math.round(parseFloat(e.target.value) * 100) : 0 })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Dimensions *
              </label>
              <input
                type="text"
                required
                placeholder="e.g., 15' L x 15' W x 15' H"
                value={formData.dimensions}
                onChange={(e) => setFormData({ ...formData, dimensions: e.target.value })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Footprint (sq ft) *
              </label>
              <input
                type="number"
                required
                min="0"
                value={formData.footprint_sqft}
                onChange={(e) => setFormData({ ...formData, footprint_sqft: parseInt(e.target.value) })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Power Circuits *
              </label>
              <input
                type="number"
                required
                min="1"
                value={formData.power_circuits}
                onChange={(e) => setFormData({ ...formData, power_circuits: parseInt(e.target.value) })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Capacity (kids) *
              </label>
              <input
                type="number"
                required
                min="1"
                value={formData.capacity}
                onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex gap-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.is_combo}
                onChange={(e) => setFormData({ ...formData, is_combo: e.target.checked })}
                className="mr-2"
              />
              <span className="text-sm text-slate-700">Is Combo Unit</span>
            </label>

            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.indoor_ok}
                onChange={(e) => setFormData({ ...formData, indoor_ok: e.target.checked })}
                className="mr-2"
              />
              <span className="text-sm text-slate-700">Indoor OK</span>
            </label>

            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.outdoor_ok}
                onChange={(e) => setFormData({ ...formData, outdoor_ok: e.target.checked })}
                className="mr-2"
              />
              <span className="text-sm text-slate-700">Outdoor OK</span>
            </label>

            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.active}
                onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                className="mr-2"
              />
              <span className="text-sm text-slate-700">Active</span>
            </label>
          </div>

          <div className="flex gap-4 pt-6">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 flex items-center justify-center bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              {saving ? (
                <>Saving...</>
              ) : (
                <>
                  <Save className="w-5 h-5 mr-2" />
                  {isEdit ? 'Update Unit' : 'Create Unit'}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => navigate('/admin')}
              className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
