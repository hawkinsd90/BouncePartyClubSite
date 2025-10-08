import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ArrowLeft, Save, Upload, X, Image as ImageIcon } from 'lucide-react';

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
  const [priceInput, setPriceInput] = useState('0.00');
  const [priceWaterInput, setPriceWaterInput] = useState('');
  const [images, setImages] = useState<Array<{ id?: string; url: string; alt: string; file?: File }>>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isEdit) {
      loadUnit();
    }
  }, [id]);

  async function loadUnit() {
    const [unitRes, mediaRes] = await Promise.all([
      supabase.from('units').select('*').eq('id', id).single(),
      supabase.from('unit_media').select('*').eq('unit_id', id).order('sort'),
    ]);

    if (unitRes.data) {
      setFormData(unitRes.data);
      setPriceInput((unitRes.data.price_dry_cents / 100).toFixed(2));
      if (unitRes.data.price_water_cents) {
        setPriceWaterInput((unitRes.data.price_water_cents / 100).toFixed(2));
      }
    }

    if (mediaRes.data) {
      setImages(mediaRes.data.map((img: any) => ({
        id: img.id,
        url: img.url,
        alt: img.alt,
      })));
    }
  }

  function generateSlug(name: string) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newImages = Array.from(files).map(file => ({
      url: URL.createObjectURL(file),
      alt: formData.name || 'Unit image',
      file,
    }));

    setImages([...images, ...newImages]);
  }

  function removeImage(index: number) {
    const newImages = [...images];
    if (newImages[index].url.startsWith('blob:')) {
      URL.revokeObjectURL(newImages[index].url);
    }
    newImages.splice(index, 1);
    setImages(newImages);
  }

  async function uploadImages(unitId: string) {
    const imagesToUpload = images.filter(img => img.file);
    const uploadedUrls: Array<{ url: string; alt: string }> = [];

    for (const img of imagesToUpload) {
      if (!img.file) continue;

      const fileExt = img.file.name.split('.').pop();
      const fileName = `${unitId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('unit-images')
        .upload(fileName, img.file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('unit-images').getPublicUrl(fileName);
      uploadedUrls.push({ url: data.publicUrl, alt: img.alt });
    }

    return uploadedUrls;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (images.length === 0) {
      alert('Please add at least one image for this unit');
      return;
    }

    setSaving(true);
    setUploadingImages(true);

    try {
      const dataToSave = {
        ...formData,
        slug: formData.slug || generateSlug(formData.name),
      };

      let unitId = id;

      if (isEdit) {
        const { error } = await supabase
          .from('units')
          .update(dataToSave)
          .eq('id', id);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('units')
          .insert([dataToSave])
          .select()
          .single();

        if (error) throw error;
        unitId = data.id;
      }

      const uploadedUrls = await uploadImages(unitId!);

      if (uploadedUrls.length > 0) {
        const mediaRecords = uploadedUrls.map((img, index) => ({
          unit_id: unitId,
          url: img.url,
          alt: img.alt,
          sort: images.length + index,
        }));

        const { error: mediaError } = await supabase
          .from('unit_media')
          .insert(mediaRecords);

        if (mediaError) throw mediaError;
      }

      alert(isEdit ? 'Unit updated successfully!' : 'Unit created successfully!');
      navigate('/admin');
    } catch (error: any) {
      console.error('Error saving unit:', error);
      alert(`Failed to save unit: ${error.message}`);
    } finally {
      setSaving(false);
      setUploadingImages(false);
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
                Type *
              </label>
              <select
                required
                value={formData.type}
                onChange={(e) => {
                  const newType = e.target.value;
                  setFormData({ ...formData, type: newType, is_combo: newType === 'Combo' });
                  if (newType !== 'Combo' && newType !== 'Water Slide') {
                    setPriceWaterInput('');
                    setFormData(prev => ({ ...prev, price_water_cents: 0 }));
                  }
                }}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option>Bounce House</option>
                <option>Water Slide</option>
                <option>Combo</option>
                <option>Obstacle Course</option>
                <option>Interactive</option>
                <option>Games</option>
                <option>Tent</option>
                <option>Table & Chairs</option>
                <option>Concession</option>
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
                Rental Price $ *
              </label>
              <input
                type="text"
                required
                value={priceInput}
                onChange={(e) => {
                  const value = e.target.value;
                  if (/^\d*\.?\d{0,2}$/.test(value)) {
                    setPriceInput(value);
                    setFormData({ ...formData, price_dry_cents: Math.round(parseFloat(value || '0') * 100) });
                  }
                }}
                placeholder="0.00"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {(formData.type === 'Combo' || formData.type === 'Water Slide') && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Water Mode Price $ (optional)
                </label>
                <input
                  type="text"
                  value={priceWaterInput}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (/^\d*\.?\d{0,2}$/.test(value) || value === '') {
                      setPriceWaterInput(value);
                      setFormData({ ...formData, price_water_cents: value ? Math.round(parseFloat(value) * 100) : 0 });
                    }
                  }}
                  placeholder="Leave empty if same as regular price"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-600 mt-1">Only fill this if water mode has a different price</p>
              </div>
            )}

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
                Footprint (sq ft)
              </label>
              <input
                type="number"
                min="0"
                value={formData.footprint_sqft || ''}
                onChange={(e) => setFormData({ ...formData, footprint_sqft: parseInt(e.target.value) || 0 })}
                placeholder="Optional - leave empty if unknown"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Blower HP (Horsepower) *
              </label>
              <input
                type="number"
                required
                min="1"
                step="0.5"
                value={formData.power_circuits}
                onChange={(e) => setFormData({ ...formData, power_circuits: parseFloat(e.target.value) || 1 })}
                placeholder="e.g., 1.5"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-slate-600 mt-1">Blower motor horsepower needed to inflate</p>
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
                checked={formData.indoor_ok}
                onChange={(e) => setFormData({ ...formData, indoor_ok: e.target.checked })}
                className="mr-2"
              />
              <span className="text-sm text-slate-700">Can be used indoors</span>
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

          <div className="border-t pt-6">
            <label className="block text-sm font-medium text-slate-700 mb-4">
              Unit Images * (Required - Add at least one image)
            </label>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              {images.map((img, index) => (
                <div key={index} className="relative group">
                  <img
                    src={img.url}
                    alt={img.alt}
                    className="w-full h-32 object-cover rounded-lg border-2 border-slate-300"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute top-2 right-2 bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center w-full">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-300 border-dashed rounded-lg cursor-pointer bg-slate-50 hover:bg-slate-100">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-10 h-10 mb-3 text-slate-400" />
                  <p className="mb-2 text-sm text-slate-600">
                    <span className="font-semibold">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-xs text-slate-500">PNG, JPG, GIF up to 10MB</p>
                </div>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="hidden"
                />
              </label>
            </div>
            {images.length === 0 && (
              <p className="text-sm text-red-600 mt-2">At least one image is required</p>
            )}
          </div>

          <div className="flex gap-4 pt-6">
            <button
              type="submit"
              disabled={saving || images.length === 0}
              className="flex-1 flex items-center justify-center bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            >
              {saving ? (
                <>{uploadingImages ? 'Uploading images...' : 'Saving...'}</>
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
