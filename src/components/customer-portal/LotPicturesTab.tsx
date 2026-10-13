import { useState, useRef } from 'react';
import { Upload, Image as ImageIcon, CheckCircle, X, Maximize, Trash2 } from 'lucide-react';
import { notifyError, notifySuccess } from '../../lib/toasts';
import { portalAction } from '../../lib/customerPortalApi';
import { uploadPortalPictures, discardPortalPictures } from '../../lib/portalPictureUpload';
import { SimpleConfirmModal } from '../common/SimpleConfirmModal';
import { ORDER_STATUS } from '../../lib/constants/statuses';

interface LotPicturesTabProps {
  orderId: string;
  orderNumber: string;
  orderStatus?: string;
  // Current lot pictures from the secure portal payload (customer-portal-data).
  pictures: LotPicture[];
  // Portal/invoice token (the server also accepts the signed-in owner).
  invoiceLinkToken?: string | null;
  // Refetch the portal payload after a change.
  onChanged: () => Promise<void> | void;
  onUploadComplete?: () => void;
  suppressRefreshRef?: React.MutableRefObject<boolean>;
}

interface LotPicture {
  id: string;
  file_path: string;
  file_name: string;
  notes: string | null;
  uploaded_at: string;
  // Short-lived signed read URL from the portal payload (the bucket is private); null when it could not be signed.
  url?: string | null;
}

export function LotPicturesTab({ orderId, orderStatus, pictures, invoiceLinkToken, onChanged, onUploadComplete, suppressRefreshRef }: LotPicturesTabProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedPicture, setSelectedPicture] = useState<LotPicture | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pictureToDelete, setPictureToDelete] = useState<LotPicture | null>(null);
  const uploadingRef = useRef(false);

  // Can only delete if order is in pending_review or awaiting_customer_approval
  const canDelete = [ORDER_STATUS.PENDING, ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL].includes(orderStatus as any || '');

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
    uploadingRef.current = true;
    if (suppressRefreshRef) suppressRefreshRef.current = true;
    setUploadError(null);

    try {
      let uploaded: Array<{ path: string; name: string }> = [];
      try {
        for (const file of Array.from(files)) {
          // Validate file type
          if (!file.type.startsWith('image/')) {
            throw new Error(`${file.name} is not an image file`);
          }

          // Validate file size (10MB max)
          if (file.size > 10 * 1024 * 1024) {
            throw new Error(`${file.name} is too large (max 10MB)`);
          }
        }

        // The server issues an upload authorization for this order (it chooses the bucket and the file path); the files go
        // only to those objects.
        const sent = await uploadPortalPictures(orderId, invoiceLinkToken, 'lot_picture', Array.from(files));
        uploaded = sent.map((s) => ({ path: s.path, name: s.name }));

        // The server records the pictures for this order and tells the admin when they were requested.
        await portalAction(orderId, invoiceLinkToken, 'register_lot_pictures', { files: uploaded });
      } catch (uploadError) {
        // Do not leave orphaned files behind if the record could not be saved (the server removes unregistered objects).
        if (uploaded.length > 0) {
          await discardPortalPictures(orderId, invoiceLinkToken, 'lot_picture', uploaded.map((u) => u.path));
        }
        throw uploadError;
      }

      notifySuccess(`Successfully uploaded ${files.length} picture${files.length > 1 ? 's' : ''}`);

      // Release the upload guard, then refetch the portal payload
      // the local list and update the parent completion indicator before
      // releasing the realtime-suppression ref.
      uploadingRef.current = false;
      await onChanged();

      // Notify parent to refresh status indicator
      if (onUploadComplete) {
        onUploadComplete();
      }

      // Release suppression last so the realtime event (if any arrives)
      // does not trigger a full Portal reload before the local list is updated.
      if (suppressRefreshRef) suppressRefreshRef.current = false;
    } catch (error: any) {
      const msg = error.message || 'Failed to upload pictures';
      console.error('[LotPicturesTab] Upload failed:', msg, error);
      setUploadError(msg);
      notifyError(msg);
    } finally {
      setUploading(false);
      uploadingRef.current = false;
      if (suppressRefreshRef) suppressRefreshRef.current = false;
      // Reset input so the same file can be selected again
      event.target.value = '';
    }
  };

  // The pictures arrive with signed read URLs from the portal payload; the bucket is private.
  const getPictureUrl = (picture: LotPicture) => picture.url ?? '';

  const handleDeleteClick = (picture: LotPicture) => {
    if (!canDelete) {
      notifyError('Pictures can only be deleted before order approval');
      return;
    }
    setPictureToDelete(picture);
  };

  const handleConfirmDelete = async () => {
    if (!pictureToDelete) return;

    setDeleting(pictureToDelete.id);
    try {
      await portalAction(orderId, invoiceLinkToken, 'delete_lot_picture', { pictureId: pictureToDelete.id });

      notifySuccess('Picture deleted successfully');
      await onChanged();

      // Close modal if this was the selected picture
      if (selectedPicture?.id === pictureToDelete.id) {
        setSelectedPicture(null);
      }
    } catch (error: any) {
      console.error('Delete error:', error);
      notifyError(error.message || 'Failed to delete picture');
    } finally {
      setDeleting(null);
      setPictureToDelete(null);
    }
  };

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

      {uploadError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-800 font-medium">{uploadError}</p>
        </div>
      )}

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
                    src={getPictureUrl(picture)}
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
              src={getPictureUrl(selectedPicture)}
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
                    handleDeleteClick(selectedPicture);
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

      {/* Delete Confirmation Modal */}
      <SimpleConfirmModal
        isOpen={!!pictureToDelete}
        onClose={() => setPictureToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Picture"
        message={`Are you sure you want to delete ${pictureToDelete?.file_name}? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
}
