import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileCheck, FileText, Download, AlertCircle, CheckCircle2, Upload, ExternalLink, Printer } from 'lucide-react';
import { format } from 'date-fns';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface WaiverTabProps {
  orderId: string;
  order: any;
  token?: string;
  onWaiverChange?: () => void;
}

const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp,application/pdf';

export default function WaiverTab({ orderId, token, onWaiverChange }: WaiverTabProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [signatureData, setSignatureData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [downloadingBlank, setDownloadingBlank] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    loadSignatureData();
  }, [orderId]);

  const loadSignatureData = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-waiver-status`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ orderId, ...(token && { token }) }),
      });
      if (!res.ok) throw new Error(`get-waiver-status returned ${res.status}`);
      const { data } = await res.json();
      setSignatureData(data);
    } catch (err) {
      console.error('Error loading signature:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadBlank = async () => {
    setDownloadingBlank(true);
    try {
      const body: Record<string, string> = { orderId };
      if (token) body.token = token;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-blank-waiver`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`PDF generation failed: ${res.status}`);
      const disposition = res.headers.get('content-disposition') ?? '';
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? `waiver-blank-${orderId.slice(0, 8)}.pdf`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Blank waiver download failed:', err);
    } finally {
      setDownloadingBlank(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.heic') || lowerName.endsWith('.heif') ||
        file.type === 'image/heic' || file.type === 'image/heif') {
      setUploadError(
        'HEIC photos are not supported. Please convert to JPEG first. On iPhone: Settings > Camera > Formats > Most Compatible'
      );
      return;
    }

    setUploadError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('orderId', orderId);
      form.append('uploadSource', 'customer_portal');
      if (token) form.append('token', token);

      const res = await fetch(`${SUPABASE_URL}/functions/v1/upload-physical-waiver`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        body: form,
      });
      const json = await res.json();
      if (!res.ok) {
        setUploadError(json.error ?? 'Upload failed');
        return;
      }
      await loadSignatureData();
      onWaiverChange?.();
    } catch (err) {
      setUploadError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadSigned = () => {
    if (signatureData?.pdf_url) {
      const a = document.createElement('a');
      a.href = signatureData.pdf_url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading waiver status...</div>
      </div>
    );
  }

  const waiverType = signatureData?.waiver_type as 'digital' | 'paper_with_photo' | 'paper_no_photo' | undefined;
  const isSigned = !!signatureData;
  const showUploadSection = !isSigned || waiverType === 'paper_no_photo';

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Blank waiver download — always visible */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Printer className="w-5 h-5 text-slate-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-slate-800">Download Blank Waiver</p>
            <p className="text-xs text-slate-500">Print and sign by hand, then upload below</p>
          </div>
        </div>
        <button
          onClick={handleDownloadBlank}
          disabled={downloadingBlank}
          className="flex items-center gap-2 bg-slate-700 hover:bg-slate-800 disabled:bg-slate-400 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
        >
          <Download className="w-4 h-4" />
          {downloadingBlank ? 'Generating...' : 'Download PDF'}
        </button>
      </div>

      {/* Status badge */}
      {isSigned && (
        <div className={`rounded-lg p-4 flex items-start gap-3 ${
          waiverType === 'digital' ? 'bg-green-50 border border-green-200' :
          waiverType === 'paper_with_photo' ? 'bg-green-50 border border-green-200' :
          'bg-amber-50 border border-amber-200'
        }`}>
          {waiverType === 'paper_no_photo' ? (
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <p className={`text-sm font-semibold ${
              waiverType === 'paper_no_photo' ? 'text-amber-800' : 'text-green-800'
            }`}>
              {waiverType === 'digital' && 'Waiver Signed (Digital)'}
              {waiverType === 'paper_with_photo' && 'Paper waiver — photo on file'}
              {waiverType === 'paper_no_photo' && 'Paper waiver marked signed — photo missing'}
            </p>
            {signatureData.signed_at && (
              <p className="text-xs text-slate-500 mt-0.5">
                Signed {format(new Date(signatureData.signed_at), "MMMM d, yyyy 'at' h:mm a")}
              </p>
            )}
            {/* View physical waiver link */}
            {signatureData.physical_waiver?.has_file && signatureData.physical_waiver.signed_url && (
              <a
                href={signatureData.physical_waiver.signed_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium mt-1"
              >
                <ExternalLink className="w-3 h-3" />
                View Physical Waiver
              </a>
            )}
          </div>
        </div>
      )}

      {/* Unsigned state — digital signing CTA */}
      {!isSigned && (
        <div className="bg-yellow-50 border-2 border-yellow-200 rounded-lg p-8 text-center">
          <FileText className="w-16 h-16 text-yellow-600 mx-auto mb-4" />
          <h3 className="text-2xl font-bold text-gray-900 mb-2">Waiver Required</h3>
          <p className="text-gray-700 mb-6">
            Before your rental can be confirmed, you must review and sign our liability waiver and
            rental agreement.
          </p>
          <div className="bg-white rounded-lg p-6 mb-6 text-left">
            <h4 className="font-semibold text-gray-900 mb-3">What you'll need to do:</h4>
            <ul className="space-y-2 text-sm text-gray-700">
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">•</span>
                <span>Read the entire liability waiver and rental agreement</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">•</span>
                <span>Provide your initials on key sections</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">•</span>
                <span>Enter your full legal name and draw your signature</span>
              </li>
            </ul>
          </div>
          <button
            onClick={() => navigate(`/sign/${orderId}`)}
            className="w-full bg-gradient-to-r from-blue-600 to-teal-600 text-white rounded-lg px-8 py-4 font-semibold hover:from-blue-700 hover:to-teal-700 transition-all flex items-center justify-center gap-2"
          >
            <FileCheck className="w-5 h-5" />
            Sign Waiver Now
          </button>
          <p className="text-xs text-gray-500 mt-4">
            Your electronic signature is legally binding under the ESIGN Act and UETA.
          </p>
        </div>
      )}

      {/* Physical waiver upload section */}
      {showUploadSection && (
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h4 className="text-sm font-semibold text-slate-800 mb-1">Upload Signed Waiver Photo</h4>
          <p className="text-xs text-slate-500 mb-4">
            Already signed a paper copy? Upload a photo or scan to attach it to your rental.
            Accepted: JPEG, PNG, WebP, PDF.
          </p>

          {uploadError && (
            <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{uploadError}</p>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
          >
            <Upload className="w-4 h-4" />
            {uploading ? 'Uploading...' : 'Choose File to Upload'}
          </button>
        </div>
      )}

      {/* Digital signed waiver details */}
      {isSigned && waiverType === 'digital' && (
        <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-600 mb-1">Signed By</p>
              <p className="font-semibold text-gray-900">{signatureData.signer_name}</p>
            </div>
            <div>
              <p className="text-gray-600 mb-1">Waiver Version</p>
              <p className="font-semibold text-gray-900">{signatureData.waiver_version}</p>
            </div>
          </div>

          {signatureData.initials_data && Object.keys(signatureData.initials_data).length > 0 && (
            <div className="border-t pt-4">
              <p className="text-gray-600 mb-3 text-sm font-medium">Section Initials</p>
              <div className="space-y-2">
                {Object.entries(signatureData.initials_data).map(([section, initial]) => (
                  <div
                    key={section}
                    className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-4 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                      <span className="text-sm text-gray-800">{section}</span>
                    </div>
                    <span className="font-bold text-green-800 bg-green-100 border border-green-300 rounded px-2 py-0.5 text-sm tracking-widest">
                      {initial as string}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {signatureData.signature_image_url && (
            <div className="border-t pt-4">
              <p className="text-gray-600 mb-2 text-sm">Electronic Signature</p>
              <div className="bg-gray-50 rounded border p-4 inline-block">
                <img src={signatureData.signature_image_url} alt="Signature" className="max-w-xs h-auto" />
              </div>
            </div>
          )}

          {signatureData.pdf_url ? (
            <button
              onClick={handleDownloadSigned}
              className="w-full bg-blue-600 text-white rounded-lg px-6 py-3 font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
            >
              <Download className="w-5 h-5" />
              Download Signed Waiver PDF
            </button>
          ) : (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-semibold mb-1">PDF Generation in Progress</p>
                <p>Your signed waiver PDF is being generated. Refresh in a few moments to download it.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
