import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ArrowLeft, Save, Upload, X } from 'lucide-react';
import { notifyError, notifySuccess, showConfirm } from '../lib/notifications';

export function UnitForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = !!id;

  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    types: ['Bounce House'] as string[],
    is_combo: false,
    price_dry_cents: 0,
    price_water_cents: 0,
    dimensions: '',
    dimensions_water: '',
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
  const [dryImages, setDryImages] = useState<Array<{ id?: string; url: string; alt: string; file?: File; mode?: string; is_featured?: boolean }>>([]);
  const [wetImages, setWetImages] = useState<Array<{ id?: string; url: string; alt: string; file?: File; mode?: string; is_featured?: boolean }>>([]);
  const [deletedImageIds, setDeletedImageIds] = useState<string[]>([]);
  const [useWetSameAsDry, setUseWetSameAsDry] = useState(true);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [saving, setSaving] = useState(false);
  const [originalActive, setOriginalActive] = useState(true);

  useEffect(() => {
    if (isEdit) {
      loadUnit();
    }
  }, [id]);

  async function loadUnit() {
    if (!id) return;

    const [unitRes, mediaRes] = await Promise.all([
      supabase.from('units').select('*').eq('id', id).single(),
      supabase.from('unit_media').select('*').eq('unit_id', id).order('sort'),
    ]);

    if (unitRes.data) {
      const unit = unitRes.data as any;
      setFormData({
        name: unit.name,
        slug: unit.slug,
        types: unit.types ?? (unit.type ? [unit.type] : ['Bounce House']),
        is_combo: unit.is_combo ?? false,
        price_dry_cents: unit.price_dry_cents,
        price_water_cents: unit.price_water_cents ?? 0,
        dimensions: unit.dimensions ?? '',
        dimensions_water: unit.dimensions_water ?? unit.dimensions_wet ?? '',
        footprint_sqft: unit.footprint_sqft ?? 0,
        power_circuits: unit.power_circuits ?? 1,
        capacity: unit.capacity ?? 0,
        indoor_ok: unit.indoor_ok ?? true,
        outdoor_ok: unit.outdoor_ok ?? true,
        active: unit.active,
        quantity_available: unit.quantity_available,
      });
      setOriginalActive(unit.active);
      setPriceInput((unit.price_dry_cents / 100).toFixed(2));
      if (unit.price_water_cents) {
        setPriceWaterInput((unit.price_water_cents / 100).toFixed(2));
      }
      if (unit.dimensions_water || unit.dimensions_wet) {
        setUseWetSameAsDry(false);
      }
    }

    if (mediaRes.data) {
      const dryMedia = mediaRes.data.filter((img: any) => img.mode === 'dry').map((img: any) => ({
        id: img.id,
        url: img.url,
        alt: img.alt,
        mode: img.mode,
        is_featured: img.is_featured || false,
      }));
      const wetMedia = mediaRes.data.filter((img: any) => img.mode === 'water').map((img: any) => ({
        id: img.id,
        url: img.url,
        alt: img.alt,
        mode: img.mode,
        is_featured: img.is_featured || false,
      }));
      setDryImages(dryMedia);
      setWetImages(wetMedia);
      if (wetMedia.length > 0) {
        setUseWetSameAsDry(false);
      }
    }
  }

  function generateSlug(name: string) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  async function checkFutureBookings(unitId: string) {
    const today = new Date().toISOString().split('T')[0];

    const { data: bookings, error } = await supabase
      .from('order_items')
      .select(`
        order_id,
        orders!inner(
          id,
          order_number,
          event_date,
          event_end_date,
          status,
          customer_name
        )
      `)
      .eq('unit_id', unitId)
      .not('orders.status', 'in', '("voided","canceled")')
      .or(`event_date.gte.${today},event_end_date.gte.${today}`, { referencedTable: 'orders' });

    if (error) {
      console.error('Error checking bookings:', error);
      return [];
    }

    return bookings || [];
  }

  async function handleActiveChange(checked: boolean) {
    if (originalActive && !checked && isEdit && id) {
      const futureBookings = await checkFutureBookings(id);

      if (futureBookings.length > 0) {
        const bookingDetails = futureBookings
          .slice(0, 5)
          .map((b: any) => {
            const order = b.orders;
            return `• Order #${order.order_number} - ${order.customer_name} on ${order.event_date}`;
          })
          .join('\n');

        const moreText = futureBookings.length > 5 ? `\n...and ${futureBookings.length - 5} more` : '';

        const confirmMessage = `WARNING: "${formData.name}" has ${futureBookings.length} future booking(s)!\n\n${bookingDetails}${moreText}\n\nMarking this unit as inactive may cause issues with these orders. Are you sure you want to continue?`;

        if (!await showConfirm(confirmMessage)) {
          return;
        }
      }
    }

    setFormData({ ...formData, active: checked });
  }

  async function handleDryImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Check if ANY image (dry or wet) is already featured
    const hasFeatured = dryImages.some(img => img.is_featured) || wetImages.some(img => img.is_featured);
    const newImages = Array.from(files).map((file, index) => ({
      url: URL.createObjectURL(file),
      alt: formData.name || 'Unit image',
      file,
      mode: 'dry',
      is_featured: !hasFeatured && index === 0, // First image is featured if no other image in the unit is featured
    }));

    setDryImages([...dryImages, ...newImages]);
  }

  async function handleWetImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Check if ANY image (dry or wet) is already featured
    const hasFeatured = dryImages.some(img => img.is_featured) || wetImages.some(img => img.is_featured);
    const newImages = Array.from(files).map((file, index) => ({
      url: URL.createObjectURL(file),
      alt: formData.name || 'Unit image',
      file,
      mode: 'water',
      is_featured: !hasFeatured && index === 0, // First image is featured if no other image in the unit is featured
    }));

    setWetImages([...wetImages, ...newImages]);
  }

  function removeDryImage(index: number) {
    const newImages = [...dryImages];
    const imageToRemove = newImages[index];

    // If this is an existing image from the database, track it for deletion
    if (imageToRemove.id) {
      setDeletedImageIds(prev => [...prev, imageToRemove.id!]);
    }

    // If this is a newly uploaded image (blob URL), revoke it
    if (imageToRemove.url.startsWith('blob:')) {
      URL.revokeObjectURL(imageToRemove.url);
    }

    newImages.splice(index, 1);
    setDryImages(newImages);
  }

  function removeWetImage(index: number) {
    const newImages = [...wetImages];
    const imageToRemove = newImages[index];

    // If this is an existing image from the database, track it for deletion
    if (imageToRemove.id) {
      setDeletedImageIds(prev => [...prev, imageToRemove.id!]);
    }

    // If this is a newly uploaded image (blob URL), revoke it
    if (imageToRemove.url.startsWith('blob:')) {
      URL.revokeObjectURL(imageToRemove.url);
    }

    newImages.splice(index, 1);
    setWetImages(newImages);
  }

  async function uploadImages(unitId: string) {
    const allImages = [...dryImages, ...(useWetSameAsDry ? [] : wetImages)];
    const imagesToUpload = allImages.filter(img => img.file);
    const uploadedUrls: Array<{ url: string; alt: string; mode: string; is_featured: boolean }> = [];

    for (const img of imagesToUpload) {
      if (!img.file) continue;

      const fileExt = img.file.name.split('.').pop();
      const fileName = `${unitId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('unit-images')
        .upload(fileName, img.file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('unit-images').getPublicUrl(fileName);
      uploadedUrls.push({ url: data.publicUrl, alt: img.alt, mode: img.mode || 'dry', is_featured: img.is_featured || false });
    }

    return uploadedUrls;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();

    const hasWetMode = formData.types.includes('Water Slide') || formData.types.includes('Combo');

    if (dryImages.length === 0) {
      notifyError('Please add at least one image for dry mode');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (hasWetMode && !useWetSameAsDry && wetImages.length === 0) {
      notifyError('Please add at least one image for wet mode, or check "Same as dry"');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setSaving(true);
    setUploadingImages(true);

    try {
      const dataToSave = {
        ...formData,
        slug: formData.slug || generateSlug(formData.name),
        dimensions_water: useWetSameAsDry ? null : (formData.dimensions_water || null),
      } as any;

      let unitId = id;

      if (isEdit) {
        const { error } = await supabase
          .from('units')
          .update(dataToSave)
          .eq('id', id);

        if (error) throw error;

        // Delete removed images from the database
        if (deletedImageIds.length > 0) {
          const { error: deleteError } = await supabase
            .from('unit_media')
            .delete()
            .in('id', deletedImageIds);

          if (deleteError) {
            console.error('Error deleting images:', deleteError);
            throw deleteError;
          }
        }
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

      if (uploadedUrls.length > 0 && unitId) {
        const existingCount = dryImages.filter(img => img.id).length + wetImages.filter(img => img.id).length;
        const mediaRecords = uploadedUrls.map((img, index) => ({
          unit_id: unitId as string,
          url: img.url,
          alt: img.alt,
          mode: img.mode || 'dry',
          sort: existingCount + index,
          is_featured: img.is_featured || false,
        }));

        const { error: mediaError } = await supabase
          .from('unit_media')
          .insert(mediaRecords);

        if (mediaError) throw mediaError;
      }

      // Update is_featured flags for existing images if changed
      if (isEdit && unitId) {
        const existingDryImages = dryImages.filter(img => img.id);
        const existingWetImages = wetImages.filter(img => img.id);
        const allExisting = [...existingDryImages, ...existingWetImages];

        for (const img of allExisting) {
          if (img.id) {
            await supabase
              .from('unit_media')
              .update({ is_featured: img.is_featured || false })
              .eq('id', img.id);
          }
        }
      }

      notifySuccess(isEdit ? 'Unit updated successfully!' : 'Unit created successfully!');
      navigate('/admin?tab=inventory');
    } catch (error: any) {
      console.error('Error saving unit:', error);
      notifyError(`Failed to save unit: ${error.message}`);
    } finally {
      setSaving(false);
      setUploadingImages(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 lg:px-8 py-6 sm:py-8 md:py-12 pb-8 sm:pb-12">
      <button
        onClick={() => navigate('/admin')}
        className="flex items-center text-blue-600 hover:text-blue-700 font-semibold mb-4 sm:mb-6 transition-colors min-h-[44px]"
      >
        <ArrowLeft className="w-5 h-5 mr-2" />
        Back to Admin
      </button>

      <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-6 md:p-10 border-2 border-slate-100">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900 mb-6 md:mb-8 tracking-tight">
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
                className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>


            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-3">
                Types * (Select all that apply)
              </label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {['Bounce House', 'Water Slide', 'Combo', 'Obstacle Course', 'Interactive', 'Games', 'Tent', 'Table & Chairs', 'Concession'].map(type => (
                  <label
                    key={type}
                    className={`flex items-center p-3 border-2 rounded-xl cursor-pointer transition-all ${
                      formData.types.includes(type)
                        ? 'bg-blue-50 border-blue-600'
                        : 'bg-white border-slate-300 hover:border-blue-400'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={formData.types.includes(type)}
                      onChange={(e) => {
                        const newTypes = e.target.checked
                          ? [...formData.types, type]
                          : formData.types.filter(t => t !== type);

                        if (newTypes.length === 0) {
                          notifyError('At least one type must be selected');
                          return;
                        }

                        setFormData({ ...formData, types: newTypes });

                        // If unchecking Combo or Water Slide and no water types remain, clear water mode data
                        const hasWaterType = newTypes.includes('Combo') || newTypes.includes('Water Slide');
                        if (!hasWaterType && (type === 'Combo' || type === 'Water Slide')) {
                          setPriceWaterInput('');
                          setFormData(prev => ({ ...prev, types: newTypes, price_water_cents: 0, dimensions_water: '' }));
                          setUseWetSameAsDry(true);
                          setWetImages([]);
                        }
                      }}
                      className="mr-2 h-4 w-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-slate-700">{type}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-600 mt-2">
                Tip: Select "Combo" or "Water Slide" for units with wet mode capabilities
              </p>
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
                className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
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
                className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>

            {(formData.types.includes('Water Slide') || formData.types.includes('Combo')) && (
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
                  className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                />
                <p className="text-xs text-slate-600 mt-1">Only fill this if water mode has a different price</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Dimensions (Dry Mode) *
              </label>
              <input
                type="text"
                required
                placeholder="e.g., 15' L x 15' W x 15' H"
                value={formData.dimensions}
                onChange={(e) => setFormData({ ...formData, dimensions: e.target.value })}
                className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>

            {(formData.types.includes('Water Slide') || formData.types.includes('Combo')) && !useWetSameAsDry && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Dimensions (Wet Mode)
                </label>
                <input
                  type="text"
                  placeholder="e.g., 20' L x 15' W x 15' H"
                  value={formData.dimensions_water || ''}
                  onChange={(e) => setFormData({ ...formData, dimensions_water: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                />
              </div>
            )}

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
                className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Blower HP (Horsepower) *
              </label>
              <input
                type="number"
                required
                min="0.5"
                step="0.5"
                value={formData.power_circuits}
                onChange={(e) => setFormData({ ...formData, power_circuits: parseFloat(e.target.value) || 1 })}
                placeholder="e.g., 1.5"
                className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
              <p className="text-xs text-slate-600 mt-1">Blower motor horsepower needed to inflate (supports half values like 0.5, 1.5, etc.)</p>
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
                className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
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
                onChange={(e) => handleActiveChange(e.target.checked)}
                className="mr-2"
              />
              <span className="text-sm text-slate-700">Active</span>
            </label>
          </div>

          <div className="border-t pt-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Dry Mode Images * (Required)
            </label>
            <p className="text-xs text-slate-600 mb-4">Click the star to set as main display picture for catalog and PDF menu (only one per unit)</p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              {dryImages.map((img, index) => (
                <div key={index} className="relative group">
                  <img
                    src={img.url}
                    alt={img.alt}
                    className={`w-full h-32 object-cover rounded-lg transition-all ${
                      img.is_featured
                        ? 'border-4 border-yellow-400 shadow-lg'
                        : 'border-2 border-slate-300'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // Set this dry image as featured
                      const newDryImages = dryImages.map((im, i) => ({
                        ...im,
                        is_featured: i === index
                      }));
                      setDryImages(newDryImages);

                      // Remove featured flag from all wet images (only one display picture allowed per unit)
                      const newWetImages = wetImages.map(im => ({
                        ...im,
                        is_featured: false
                      }));
                      setWetImages(newWetImages);
                    }}
                    className={`absolute top-1 left-1 rounded-full p-2 shadow-lg transition-all z-10 ${
                      img.is_featured
                        ? 'bg-yellow-400 text-white'
                        : 'bg-white text-slate-400 hover:bg-yellow-400 hover:text-white'
                    }`}
                    aria-label="Set as featured image"
                    title="Set as main display picture"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      removeDryImage(index);
                    }}
                    className="absolute top-1 right-1 bg-red-600 hover:bg-red-700 text-white rounded-full p-2.5 shadow-lg transition-all touch-manipulation active:scale-95 z-10 min-w-[44px] min-h-[44px] flex items-center justify-center"
                    aria-label="Remove image"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center w-full">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-300 border-dashed rounded-lg cursor-pointer bg-slate-50 hover:bg-slate-100">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-10 h-10 mb-3 text-slate-400" />
                  <p className="mb-2 text-sm text-slate-600">
                    <span className="font-semibold">Click to upload</span> dry mode images
                  </p>
                  <p className="text-xs text-slate-500">PNG, JPG, GIF up to 10MB</p>
                </div>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleDryImageSelect}
                  className="hidden"
                />
              </label>
            </div>
            {dryImages.length === 0 && (
              <p className="text-sm text-red-600 mt-2">At least one dry mode image is required</p>
            )}
          </div>

          {(formData.types.includes('Water Slide') || formData.types.includes('Combo')) && (
            <div className="border-t pt-6">
              <div className="flex items-center justify-between mb-4">
                <label className="block text-sm font-medium text-slate-700">
                  Wet Mode Images & Dimensions
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={useWetSameAsDry}
                    onChange={(e) => setUseWetSameAsDry(e.target.checked)}
                    className="mr-2"
                  />
                  <span className="text-sm text-slate-700">Same as dry mode</span>
                </label>
              </div>

              {!useWetSameAsDry && (
                <>
                  <p className="text-xs text-slate-600 mb-4">Click the star to set as main display picture (only one per unit)</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    {wetImages.map((img, index) => (
                      <div key={index} className="relative group">
                        <img
                          src={img.url}
                          alt={img.alt}
                          className={`w-full h-32 object-cover rounded-lg transition-all ${
                            img.is_featured
                              ? 'border-4 border-yellow-400 shadow-lg'
                              : 'border-2 border-blue-300'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            // Set this wet image as featured
                            const newWetImages = wetImages.map((im, i) => ({
                              ...im,
                              is_featured: i === index
                            }));
                            setWetImages(newWetImages);

                            // Remove featured flag from all dry images (only one display picture allowed per unit)
                            const newDryImages = dryImages.map(im => ({
                              ...im,
                              is_featured: false
                            }));
                            setDryImages(newDryImages);
                          }}
                          className={`absolute top-1 left-1 rounded-full p-2 shadow-lg transition-all z-10 ${
                            img.is_featured
                              ? 'bg-yellow-400 text-white'
                              : 'bg-white text-slate-400 hover:bg-yellow-400 hover:text-white'
                          }`}
                          aria-label="Set as featured image"
                          title="Set as main display picture"
                        >
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            removeWetImage(index);
                          }}
                          className="absolute top-1 right-1 bg-red-600 hover:bg-red-700 text-white rounded-full p-2.5 shadow-lg transition-all touch-manipulation active:scale-95 z-10 min-w-[44px] min-h-[44px] flex items-center justify-center"
                          aria-label="Remove image"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-center w-full">
                    <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-blue-300 border-dashed rounded-lg cursor-pointer bg-blue-50 hover:bg-blue-100">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <Upload className="w-10 h-10 mb-3 text-blue-400" />
                        <p className="mb-2 text-sm text-blue-600">
                          <span className="font-semibold">Click to upload</span> wet mode images
                        </p>
                        <p className="text-xs text-blue-500">PNG, JPG, GIF up to 10MB</p>
                      </div>
                      <input
                        type="file"
                        multiple
                        accept="image/*"
                        onChange={handleWetImageSelect}
                        className="hidden"
                      />
                    </label>
                  </div>
                  {wetImages.length === 0 && (
                    <p className="text-sm text-red-600 mt-2">At least one wet mode image is required</p>
                  )}
                </>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 pt-6 pb-2">
            <button
              type="submit"
              disabled={saving || dryImages.length === 0}
              onClick={(e) => {
                if (saving || dryImages.length === 0) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              className="w-full sm:flex-1 flex items-center justify-center bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-slate-400 disabled:to-slate-500 text-white font-bold py-3 sm:py-4 px-4 sm:px-6 rounded-xl transition-all shadow-lg hover:shadow-xl text-sm sm:text-base min-h-[48px] touch-manipulation active:scale-95"
            >
              {saving ? (
                <>{uploadingImages ? 'Uploading images...' : 'Saving...'}</>
              ) : (
                <>
                  <Save className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                  {isEdit ? 'Update Unit' : 'Create Unit'}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => navigate('/admin')}
              className="w-full sm:flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-3 sm:py-4 px-4 sm:px-6 rounded-xl transition-all shadow-md text-sm sm:text-base min-h-[48px] touch-manipulation active:scale-95"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
