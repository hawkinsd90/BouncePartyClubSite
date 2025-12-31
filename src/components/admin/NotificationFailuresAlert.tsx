import { useState, useEffect } from 'react';
import { AlertTriangle, Mail, MessageSquare, X, CheckCircle, RefreshCw } from 'lucide-react';
import {
  getSystemStatus,
  getUnresolvedFailures,
  getUnresolvedCount,
  markFailureResolved,
  type NotificationFailure,
  type SystemStatus,
} from '../../lib/notificationReliability';
import { showToast } from '../../lib/notifications';

export function NotificationFailuresAlert() {
  const [emailStatus, setEmailStatus] = useState<SystemStatus | null>(null);
  const [smsStatus, setSmsStatus] = useState<SystemStatus | null>(null);
  const [failures, setFailures] = useState<NotificationFailure[]>([]);
  const [counts, setCounts] = useState({ email: 0, sms: 0, total: 0 });
  const [showDetails, setShowDetails] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    try {
      const [statusData, countsData, failuresData] = await Promise.all([
        getSystemStatus(),
        getUnresolvedCount(),
        getUnresolvedFailures(),
      ]);

      setEmailStatus(statusData.email);
      setSmsStatus(statusData.sms);
      setCounts(countsData);
      setFailures(failuresData);
    } catch (error) {
      console.error('Error loading notification status:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleResolveFailure(failureId: string) {
    const success = await markFailureResolved(failureId);
    if (success) {
      showToast('Failure marked as resolved', 'success');
      loadData();
    } else {
      showToast('Failed to update failure status', 'error');
    }
  }

  const hasActiveIssues =
    (emailStatus && !emailStatus.is_operational) ||
    (smsStatus && !smsStatus.is_operational) ||
    counts.total > 0;

  if (loading) {
    return null;
  }

  if (!hasActiveIssues) {
    return null;
  }

  return (
    <div className="mb-6">
      <div
        className={`border-l-4 p-4 rounded-lg ${
          hasActiveIssues ? 'bg-red-50 border-red-500' : 'bg-yellow-50 border-yellow-500'
        }`}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 flex-1">
            <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-bold text-lg text-red-900 mb-2">
                Notification System Issues Detected
              </h3>

              <div className="space-y-2 mb-4">
                {emailStatus && !emailStatus.is_operational && (
                  <div className="flex items-center gap-2 text-red-800">
                    <Mail className="w-4 h-4" />
                    <span className="font-semibold">Email System: </span>
                    <span className="text-red-600">
                      Not Operational (
                      {emailStatus.consecutive_failures} consecutive failures)
                    </span>
                  </div>
                )}

                {smsStatus && !smsStatus.is_operational && (
                  <div className="flex items-center gap-2 text-red-800">
                    <MessageSquare className="w-4 h-4" />
                    <span className="font-semibold">SMS System: </span>
                    <span className="text-red-600">
                      Not Operational (
                      {smsStatus.consecutive_failures} consecutive failures)
                    </span>
                  </div>
                )}

                {counts.total > 0 && (
                  <div className="text-red-800">
                    <span className="font-semibold">Unresolved Failures: </span>
                    {counts.email > 0 && <span>{counts.email} email(s)</span>}
                    {counts.email > 0 && counts.sms > 0 && <span>, </span>}
                    {counts.sms > 0 && <span>{counts.sms} SMS</span>}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className="text-sm px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors"
                >
                  {showDetails ? 'Hide Details' : 'View Details'}
                </button>
                <button
                  onClick={loadData}
                  className="text-sm px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-semibold transition-colors flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </div>

        {showDetails && failures.length > 0 && (
          <div className="mt-4 pt-4 border-t border-red-200">
            <h4 className="font-semibold text-red-900 mb-3">Recent Failures:</h4>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {failures.map((failure) => (
                <div
                  key={failure.id}
                  className="bg-white border border-red-200 rounded-lg p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {failure.notification_type === 'email' ? (
                          <Mail className="w-4 h-4 text-red-600" />
                        ) : (
                          <MessageSquare className="w-4 h-4 text-red-600" />
                        )}
                        <span className="font-semibold text-gray-900">
                          {failure.notification_type === 'email' ? 'Email' : 'SMS'} Failure
                        </span>
                        <span className="text-sm text-gray-500">
                          {new Date(failure.created_at).toLocaleString()}
                        </span>
                      </div>

                      <div className="text-sm space-y-1">
                        <div>
                          <span className="font-medium text-gray-700">To: </span>
                          <span className="text-gray-600">{failure.intended_recipient}</span>
                        </div>
                        {failure.subject && (
                          <div>
                            <span className="font-medium text-gray-700">Subject: </span>
                            <span className="text-gray-600">{failure.subject}</span>
                          </div>
                        )}
                        {failure.message_preview && (
                          <div>
                            <span className="font-medium text-gray-700">Preview: </span>
                            <span className="text-gray-600 italic">
                              {failure.message_preview}
                            </span>
                          </div>
                        )}
                        <div className="text-red-600 font-medium mt-2">
                          Error: {failure.error_message}
                        </div>
                        {failure.fallback_sent && (
                          <div className="text-green-600 text-xs flex items-center gap-1 mt-1">
                            <CheckCircle className="w-3 h-3" />
                            Fallback notification sent via {failure.fallback_type}
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => handleResolveFailure(failure.id)}
                      className="flex-shrink-0 text-green-600 hover:text-green-700 p-1"
                      title="Mark as resolved"
                    >
                      <CheckCircle className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {showDetails && (
          <div className="mt-4 pt-4 border-t border-red-200">
            <h4 className="font-semibold text-red-900 mb-2">System Status Details:</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {emailStatus && (
                <div className="bg-white border border-red-200 rounded-lg p-3 text-sm">
                  <div className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    Email System
                  </div>
                  <div className="space-y-1 text-xs">
                    <div>
                      <span className="text-gray-600">Status: </span>
                      <span
                        className={
                          emailStatus.is_operational ? 'text-green-600' : 'text-red-600'
                        }
                      >
                        {emailStatus.is_operational ? 'Operational' : 'Down'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Last Success: </span>
                      <span className="text-gray-900">
                        {emailStatus.last_success_at
                          ? new Date(emailStatus.last_success_at).toLocaleString()
                          : 'Never'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Consecutive Failures: </span>
                      <span className="text-red-600">{emailStatus.consecutive_failures}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Failures (24h): </span>
                      <span className="text-red-600">{emailStatus.total_failures_24h}</span>
                    </div>
                  </div>
                </div>
              )}

              {smsStatus && (
                <div className="bg-white border border-red-200 rounded-lg p-3 text-sm">
                  <div className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" />
                    SMS System
                  </div>
                  <div className="space-y-1 text-xs">
                    <div>
                      <span className="text-gray-600">Status: </span>
                      <span
                        className={
                          smsStatus.is_operational ? 'text-green-600' : 'text-red-600'
                        }
                      >
                        {smsStatus.is_operational ? 'Operational' : 'Down'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Last Success: </span>
                      <span className="text-gray-900">
                        {smsStatus.last_success_at
                          ? new Date(smsStatus.last_success_at).toLocaleString()
                          : 'Never'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-600">Consecutive Failures: </span>
                      <span className="text-red-600">{smsStatus.consecutive_failures}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Failures (24h): </span>
                      <span className="text-red-600">{smsStatus.total_failures_24h}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
