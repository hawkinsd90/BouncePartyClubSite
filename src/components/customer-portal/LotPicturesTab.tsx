import { useState, useEffect } from 'react';
import { Upload, Image as ImageIcon, CheckCircle, X, Maximize, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { notifyError, notifySuccess } from '../../lib/notifications';
import { formatOrderId } from '../../lib/utils';

interface LotPicturesTabProps {
  orderId: string;
  orderNumber: string;
  orderStatus?: string;
  onUploadComplete?: () => void;
}

async function notifyAdminOfPictureUpload(orderId: string, pictureCount: number) {
  try {
    // Get order details
    const { data: order } = await supabase
      .from('orders')
      .select('*, customers(first_name, last_name, email), addresses(line1, city, state)')
      .eq('id', orderId)
      .single();

    if (!order) return;

    // Only notify if admin requested lot pictures
    if (!order.lot_pictures_requested) {
      console.log('Lot pictures uploaded but not requested by admin, skipping notification');
      return;
    }

    const customerName = `${order.customers?.first_name || ''} ${order.customers?.last_name || ''}`.trim();
    const formattedOrderId = formatOrderId(orderId);
    const portalLink = `${window.location.origin}/admin?tab=pending`;

    // Send SMS notification
    try {
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms-notification`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderId,
          templateKey: 'lot_pictures_uploaded_admin',
        }),
      });
    } catch (smsError) {
      console.error('Failed to send SMS notification:', smsError);
    }

    // Send email notification
    try {
      const emailSubject = `Lot Pictures Uploaded - Order ${formattedOrderId}`;
      const emailBody = `
        <h2>Lot Pictures Uploaded</h2>
        <p><strong>${customerName}</strong> has uploaded <strong>${pictureCount}</strong> picture${pictureCount > 1 ? 's' : ''} of the event location.</p>

        <p><strong>Order Details:</strong></p>
        <ul>
          <li>Order ID: ${formattedOrderId}</li>
          <li>Customer: ${customerName}</li>
          <li>Event Date: ${order.event_date}</li>
          <li>Location: ${order.addresses?.line1}, ${order.addresses?.city}, ${order.addresses?.state}</li>
        </ul>

        <p><a href="${portalLink}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin-top: 16px;">View Order</a></p>
      `;

      // Get admin email
      const { data: adminEmailSetting } = await supabase
        .from('admin_settings')
        .select('value')
        .eq('key', 'admin_notification_email')
        .maybeSingle();

      const adminEmail = adminEmailSetting?.value;

      if (adminEmail) {
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: adminEmail,
            subject: emailSubject,
            html: emailBody,
          }),
        });
      }
    } catch (emailError) {
      console.error('Failed to send email notification:', emailError);
    }
  } catch (error) {
    console.error('Error notifying admin:', error);
  }
}

interface LotPicture {
  id: string;
  file_path: string;
  file_name: string;
  notes: string | null;
  uploaded_at: string;
}

export function LotPicturesTab({ orderId, orderStatus, onUploadComplete }: LotPicturesTabProps) {
  const [pictures, setPictures] = useState<LotPicture[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedPicture, setSelectedPicture] = useState<LotPicture | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Can only delete if order is in pending_review or awaiting_customer_approval
  const canDelete = ['pending_review', 'awaiting_customer_approval'].includes(orderStatus || '');

  useEffect(() => {
    loadPictures();
  }, [orderId]);

  const loadPictures = async () => {
    try {
      const { data, error } = await supabase
        .from('order_lot_pictures' as any)
        .select('*')
        .eq('order_id', orderId)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;
      setPictures((data as any) || []);
    } catch (error: any) {
      console.error('Error loading lot pictures:', error);
      notifyError('Failed to load pictures');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Check if adding these files would exceed the 4-picture limit
    const totalPictures = pictures.length + files.length;
    if (totalPictures > 4) {
      notifyError(`You can upload a maximum of 4 pictures. You currently have ${pictures.length} picture${pictures.length !== 1 ? 's' : ''}.`);
      event.target.value = '';
      return;
    }

    setUploading(true);

    try {
      const uploadPromises = Array.from(files).map(async (file) => {
        // Validate file type
        if (!file.type.startsWith('image/')) {
          throw new Error(`${file.name} is not an image file`);
        }

        // Validate file size (10MB max)
        if (file.size > 10 * 1024 * 1024) {
          throw new Error(`${file.name} is too large (max 10MB)`);
        }

        // Create unique file name
        const fileExt = file.name.split('.').pop();
        const fileName = `${orderId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('lot-pictures')
          .upload(fileName, file, {
            cacheControl: '3600',
            upsert: false,
          });

        if (uploadError) throw uploadError;

        // Save record to database
        const { error: dbError } = await supabase
          .from('order_lot_pictures' as any)
          .insert({
            order_id: orderId,
            file_path: fileName,
            file_name: file.name,
          });

        if (dbError) {
          // Clean up uploaded file if database insert fails
          await supabase.storage.from('lot-pictures').remove([fileName]);
          throw dbError;
        }
      });

      await Promise.all(uploadPromises);
      notifySuccess(`Successfully uploaded ${files.length} picture${files.length > 1 ? 's' : ''}`);
      await loadPictures();

      // Notify admin about the upload
      await notifyAdminOfPictureUpload(orderId, files.length);

      // Notify parent to refresh status
      if (onUploadComplete) {
        onUploadComplete();
      }
    } catch (error: any) {
      notifyError(error.message || 'Failed to upload pictures');
    } finally {
      setUploading(false);
      // Reset input
      event.target.value = '';
    }
  };

  const getPictureUrl = (filePath: string) => {
    const { data } = supabase.storage.from('lot-pictures').getPublicUrl(filePath);
    return data.publicUrl;
  };

  const handleDeletePicture = async (picture: LotPicture) => {
    if (!canDelete) {
      notifyError('Pictures can only be deleted before order approval');
      return;
    }

    if (!confirm(`Are you sure you want to delete ${picture.file_name}?`)) {
      return;
    }

    setDeleting(picture.id);
    try {
      // Delete from database first
      const { error: dbError } = await supabase
        .from('order_lot_pictures' as any)
        .delete()
        .eq('id', picture.id);

      if (dbError) throw dbError;

      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from('lot-pictures')
        .remove([picture.file_path]);

      if (storageError) {
        console.error('Failed to delete file from storage:', storageError);
      }

      notifySuccess('Picture deleted successfully');
      await loadPictures();

      // Close modal if this was the selected picture
      if (selectedPicture?.id === picture.id) {
        setSelectedPicture(null);
      }
    } catch (error: any) {
      notifyError(error.message || 'Failed to delete picture');
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="flex items-start gap-3">
          <ImageIcon className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-blue-900 mb-2">Upload Pictures of Your Event Location</h3>
            <p className="text-sm text-blue-800 mb-3">
              Help us prepare for your event! Please upload pictures of the area where you'd like the inflatables set up. This helps us:
            </p>
            <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
              <li>Assess the setup area and plan accordingly</li>
              <li>Identify any potential obstacles or special requirements</li>
              <li>Ensure we bring the right equipment</li>
              <li>Make your event setup as smooth as possible</li>
            </ul>
            <p className="text-sm text-blue-800 mt-3">
              <strong>Tip:</strong> Take photos from different angles showing the full area, any slopes, nearby obstacles, and access points.
            </p>
          </div>
        </div>
      </div>

      {/* Upload Section */}
      <div className="bg-white border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
        <input
          type="file"
          id="lot-pictures-upload"
          multiple
          accept="image/*"
          onChange={handleFileSelect}
          disabled={uploading || pictures.length >= 4}
          className="hidden"
        />
        <label
          htmlFor="lot-pictures-upload"
          className={`flex flex-col items-center gap-3 ${pictures.length >= 4 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        >
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
            <Upload className="w-8 h-8 text-blue-600" />
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-900 mb-1">
              {uploading ? 'Uploading...' : pictures.length >= 4 ? 'Maximum pictures reached' : 'Click to upload pictures'}
            </p>
            <p className="text-sm text-slate-600">
              {pictures.length >= 4 ? `You've uploaded all 4 pictures` : 'or drag and drop images here'}
            </p>
            <p className="text-xs text-slate-500 mt-2">
              {pictures.length >= 4 ? `${pictures.length} of 4 pictures uploaded` : `PNG, JPG, WEBP, HEIC up to 10MB each (max 4 pictures)`}
            </p>
          </div>
        </label>
      </div>

      {/* Uploaded Pictures */}
      {pictures.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <h3 className="font-semibold text-slate-900">
              Uploaded Pictures ({pictures.length})
            </h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {pictures.map((picture) => (
              <div key={picture.id} className="group relative">
                <div className="aspect-square bg-slate-100 rounded-lg overflow-hidden border-2 border-slate-200 hover:border-blue-400 transition-colors relative">
                  <img
                    src={getPictureUrl(picture.file_path)}
                    alt={picture.file_name}
                    className="w-full h-full object-cover cursor-pointer"
                    loading="lazy"
                    onClick={() => setSelectedPicture(picture)}
                  />
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={() => setSelectedPicture(picture)}
                      className="p-2 bg-white rounded-full hover:bg-slate-100 transition-colors"
                      title="View full size"
                    >
                      <Maximize className="w-4 h-4 text-slate-700" />
                    </button>
                    {canDelete && (
                      <button
                        onClick={() => handleDeletePicture(picture)}
                        disabled={deleting === picture.id}
                        className="p-2 bg-white rounded-full hover:bg-red-50 transition-colors disabled:opacity-50"
                        title="Delete picture"
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-600 mt-1 truncate" title={picture.file_name}>
                  {picture.file_name}
                </p>
                <p className="text-xs text-slate-500">
                  {new Date(picture.uploaded_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {pictures.length === 0 && !uploading && (
        <div className="text-center py-8">
          <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <ImageIcon className="w-10 h-10 text-slate-400" />
          </div>
          <p className="text-slate-600 mb-2">No pictures uploaded yet</p>
          <p className="text-sm text-slate-500">
            Upload pictures of your event location to help us prepare
          </p>
        </div>
      )}

      {/* Success Message for uploads */}
      {pictures.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-sm text-green-800">
            <strong>Thank you!</strong> Your pictures have been received. Our team will review them as we prepare for your event.
          </p>
        </div>
      )}

      {/* Image Preview Modal */}
      {selectedPicture && (
        <div
          className="fixed inset-0 z-50 bg-black bg-opacity-90 flex items-center justify-center p-4"
          onClick={() => setSelectedPicture(null)}
        >
          <div className="relative max-w-6xl max-h-full">
            {/* Close button */}
            <button
              onClick={() => setSelectedPicture(null)}
              className="absolute -top-12 right-0 p-2 text-white hover:bg-white hover:bg-opacity-20 rounded-full transition-colors"
            >
              <X className="w-6 h-6" />
            </button>

            {/* Image */}
            <img
              src={getPictureUrl(selectedPicture.file_path)}
              alt={selectedPicture.file_name}
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />

            {/* Picture info and actions */}
            <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-75 text-white p-4 rounded-b-lg flex items-center justify-between">
              <div>
                <p className="font-medium">{selectedPicture.file_name}</p>
                <p className="text-sm text-slate-300">
                  Uploaded {new Date(selectedPicture.uploaded_at).toLocaleDateString()}
                </p>
              </div>
              {canDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeletePicture(selectedPicture);
                  }}
                  disabled={deleting === selectedPicture.id}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  {deleting === selectedPicture.id ? 'Deleting...' : 'Delete'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
