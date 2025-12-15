import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileCheck, FileText, Download, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';

interface WaiverTabProps {
  orderId: string;
  order: any;
  onWaiverChange?: () => void;
}

export default function WaiverTab({ orderId }: WaiverTabProps) {
  const navigate = useNavigate();
  const [signatureData, setSignatureData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSignatureData();
  }, [orderId]);

  const loadSignatureData = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('order_signatures')
        .select('*')
        .eq('order_id', orderId)
        .maybeSingle();

      if (error) throw error;
      setSignatureData(data);
    } catch (err) {
      console.error('Error loading signature:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSignWaiver = () => {
    navigate(`/sign/${orderId}`);
  };

  const handleDownloadPdf = () => {
    if (signatureData?.pdf_url) {
      window.open(signatureData.pdf_url, '_blank');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading waiver status...</div>
      </div>
    );
  }

  if (!signatureData) {
    return (
      <div className="max-w-2xl mx-auto">
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
                <span>Enter your full legal name</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">•</span>
                <span>Draw your electronic signature</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-600 mt-1">•</span>
                <span>Consent to electronic signature</span>
              </li>
            </ul>
          </div>

          <button
            onClick={handleSignWaiver}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg px-8 py-4 font-semibold hover:from-blue-700 hover:to-indigo-700 transition-all flex items-center justify-center gap-2"
          >
            <FileCheck className="w-5 h-5" />
            Sign Waiver Now
          </button>

          <p className="text-xs text-gray-500 mt-4">
            This process typically takes 3-5 minutes. Your electronic signature is legally binding
            under the ESIGN Act and UETA.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-green-50 border-2 border-green-200 rounded-lg p-8">
        <div className="flex items-start gap-4 mb-6">
          <CheckCircle2 className="w-12 h-12 text-green-600 flex-shrink-0" />
          <div className="flex-1">
            <h3 className="text-2xl font-bold text-gray-900 mb-2">Waiver Signed</h3>
            <p className="text-gray-700">
              You successfully signed the liability waiver on{' '}
              {format(new Date(signatureData.signed_at), 'MMMM d, yyyy \'at\' h:mm a')}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-600 mb-1">Signed By</p>
              <p className="font-semibold text-gray-900">{signatureData.signer_name}</p>
            </div>
            <div>
              <p className="text-gray-600 mb-1">Email</p>
              <p className="font-semibold text-gray-900">{signatureData.signer_email}</p>
            </div>
            <div>
              <p className="text-gray-600 mb-1">Waiver Version</p>
              <p className="font-semibold text-gray-900">{signatureData.waiver_version}</p>
            </div>
            <div>
              <p className="text-gray-600 mb-1">IP Address</p>
              <p className="font-semibold text-gray-900 font-mono text-xs">
                {signatureData.ip_address}
              </p>
            </div>
          </div>

          {signatureData.initials_data &&
            Object.keys(signatureData.initials_data).length > 0 && (
              <div className="border-t pt-4">
                <p className="text-gray-600 mb-2 text-sm">Initials Provided</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(signatureData.initials_data).map(([section, initial]) => (
                    <span
                      key={section}
                      className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-medium"
                    >
                      {section}: {initial as string}
                    </span>
                  ))}
                </div>
              </div>
            )}

          {signatureData.signature_image_url && (
            <div className="border-t pt-4">
              <p className="text-gray-600 mb-2 text-sm">Electronic Signature</p>
              <div className="bg-gray-50 rounded border p-4 inline-block">
                <img
                  src={signatureData.signature_image_url}
                  alt="Signature"
                  className="max-w-xs h-auto"
                />
              </div>
            </div>
          )}
        </div>

        {signatureData.pdf_url ? (
          <button
            onClick={handleDownloadPdf}
            className="w-full mt-6 bg-blue-600 text-white rounded-lg px-6 py-3 font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
          >
            <Download className="w-5 h-5" />
            Download Signed Waiver PDF
          </button>
        ) : (
          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-semibold mb-1">PDF Generation in Progress</p>
              <p>
                Your signed waiver PDF is being generated. Please refresh the page in a few moments
                to download it.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
