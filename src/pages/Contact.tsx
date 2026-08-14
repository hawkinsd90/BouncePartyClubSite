import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Send, Phone, Mail, MapPin, Clock, Loader2, Home } from 'lucide-react';
import { DatePickerInput } from '../components/ui/DatePickerInput';
import { TimePickerInput } from '../components/ui/TimePickerInput';
import { useBusinessSettings } from '../contexts/BusinessContext';

export function Contact() {
  const business = useBusinessSettings();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    name: '',
    email: '',
    phone: '',
    eventDate: '',
    eventStartTime: '',
    eventEndTime: '',
    guestCount: '',
    eventAddress: '',
    eventCity: '',
    eventState: '',
    eventZip: '',
    surfaceType: '',
    referralSource: '',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-contact-inquiry`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(formData),
        }
      );

      if (response.status === 429) {
        setSubmitError(
          "You've submitted several inquiries recently. Please wait a few minutes and try again, or call us for assistance."
        );
        setIsSubmitting(false);
        return;
      }

      if (!response.ok) {
        let errorMessage = 'Something went wrong submitting your inquiry. Please try again or call us for assistance.';
        try {
          const errorData = await response.json();
          if (errorData?.error) {
            errorMessage = errorData.error;
          }
        } catch {
          // use default error message
        }
        setSubmitError(errorMessage);
        setIsSubmitting(false);
        return;
      }

      setSubmitted(true);
    } catch {
      setSubmitError(
        'Something went wrong submitting your inquiry. Please try again or call us for assistance.'
      );
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-green-400 to-green-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
            <MessageSquare className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-3xl font-bold text-slate-900 mb-3 tracking-tight">Message Received!</h2>
          <p className="text-slate-600 mb-4">
            Thank you for reaching out. We'll get back to you within 24 hours to discuss your event details.
          </p>
          <p className="text-sm text-slate-500 mb-8">
            For immediate assistance, call us at{' '}
            {business.business_phone ? (
              <a href={`tel:${business.business_phone.replace(/\D/g, '')}`} className="text-blue-600 hover:underline font-medium">
                {business.business_phone}
              </a>
            ) : null}
          </p>
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center space-x-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-6 py-3 rounded-xl font-semibold transition-all shadow-lg hover:shadow-xl transform hover:scale-[1.02]"
          >
            <Home className="w-5 h-5" />
            <span>Back to Home</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-5xl md:text-6xl font-bold text-slate-900 mb-6 tracking-tight">
            Get in Touch
          </h1>
          <p className="text-xl md:text-2xl text-slate-600 max-w-3xl mx-auto leading-relaxed">
            Have something specific in mind? Not sure what you need? Let us know and we'll help create the perfect party experience.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl shadow-xl border-2 border-slate-200 p-8">
              <h2 className="text-3xl font-bold text-slate-900 mb-8 tracking-tight">
                Tell Us About Your Event
              </h2>

              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Name */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label htmlFor="firstName" className="block text-sm font-medium text-slate-700 mb-2">
                      First Name *
                    </label>
                    <input
                      id="firstName"
                      type="text"
                      required
                      value={formData.firstName}
                      onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                      style={{ fontSize: '16px' }}
                      className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                      placeholder="John"
                    />
                  </div>
                  <div>
                    <label htmlFor="lastName" className="block text-sm font-medium text-slate-700 mb-2">
                      Last Name *
                    </label>
                    <input
                      id="lastName"
                      type="text"
                      required
                      value={formData.lastName}
                      onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                      style={{ fontSize: '16px' }}
                      className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                      placeholder="Smith"
                    />
                  </div>
                </div>

                {/* Contact info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-2">
                      Email Address *
                    </label>
                    <input
                      id="email"
                      type="email"
                      required
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      style={{ fontSize: '16px' }}
                      className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                      placeholder="john@example.com"
                    />
                  </div>
                  <div>
                    <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-2">
                      Phone Number *
                    </label>
                    <input
                      id="phone"
                      type="tel"
                      required
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      style={{ fontSize: '16px' }}
                      className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                      placeholder="(313) 555-0123"
                    />
                  </div>
                </div>

                {/* Event date and times */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label htmlFor="eventDate" className="block text-sm font-medium text-slate-700 mb-2">
                      Event Date
                    </label>
                    <DatePickerInput
                      id="eventDate"
                      value={formData.eventDate}
                      onChange={(value) => setFormData({ ...formData, eventDate: value })}
                      showIcon={false}
                    />
                  </div>
                  <div>
                    <label htmlFor="eventStartTime" className="block text-sm font-medium text-slate-700 mb-2">
                      Start Time
                    </label>
                    <TimePickerInput
                      id="eventStartTime"
                      value={formData.eventStartTime}
                      onChange={(value) => setFormData({ ...formData, eventStartTime: value })}
                      showIcon={false}
                      placeholder="Select time"
                    />
                  </div>
                  <div>
                    <label htmlFor="eventEndTime" className="block text-sm font-medium text-slate-700 mb-2">
                      End Time
                    </label>
                    <TimePickerInput
                      id="eventEndTime"
                      value={formData.eventEndTime}
                      onChange={(value) => setFormData({ ...formData, eventEndTime: value })}
                      showIcon={false}
                      placeholder="Select time"
                    />
                  </div>
                </div>

                {/* Guest count and surface type */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label htmlFor="guestCount" className="block text-sm font-medium text-slate-700 mb-2">
                      Expected Guest Count
                    </label>
                    <input
                      id="guestCount"
                      type="text"
                      value={formData.guestCount}
                      onChange={(e) => setFormData({ ...formData, guestCount: e.target.value })}
                      style={{ fontSize: '16px' }}
                      className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                      placeholder="e.g., 20-30 kids"
                    />
                  </div>
                  <div>
                    <label htmlFor="surfaceType" className="block text-sm font-medium text-slate-700 mb-2">
                      Setup Surface Type
                    </label>
                    <select
                      id="surfaceType"
                      value={formData.surfaceType}
                      onChange={(e) => setFormData({ ...formData, surfaceType: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all bg-white"
                      style={{ fontSize: '16px', minHeight: '48px' }}
                    >
                      <option value="">Select surface type</option>
                      <option value="grass">Grass</option>
                      <option value="concrete">Concrete / Asphalt</option>
                      <option value="dirt">Dirt / Sand</option>
                      <option value="mixed">Mixed</option>
                      <option value="indoor">Indoor</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>

                {/* Event address */}
                <div className="border-2 border-slate-200 rounded-xl p-6 bg-slate-50">
                  <h3 className="text-lg font-bold text-slate-900 mb-4">Event Address</h3>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="eventAddress" className="block text-sm font-medium text-slate-700 mb-2">
                        Street Address
                      </label>
                      <input
                        id="eventAddress"
                        type="text"
                        value={formData.eventAddress}
                        onChange={(e) => setFormData({ ...formData, eventAddress: e.target.value })}
                        style={{ fontSize: '16px' }}
                        className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                        placeholder="123 Main Street"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label htmlFor="eventCity" className="block text-sm font-medium text-slate-700 mb-2">
                          City
                        </label>
                        <input
                          id="eventCity"
                          type="text"
                          value={formData.eventCity}
                          onChange={(e) => setFormData({ ...formData, eventCity: e.target.value })}
                          style={{ fontSize: '16px' }}
                          className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                          placeholder="Detroit"
                        />
                      </div>
                      <div>
                        <label htmlFor="eventState" className="block text-sm font-medium text-slate-700 mb-2">
                          State
                        </label>
                        <input
                          id="eventState"
                          type="text"
                          value={formData.eventState}
                          onChange={(e) => setFormData({ ...formData, eventState: e.target.value })}
                          style={{ fontSize: '16px' }}
                          className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                          placeholder="MI"
                        />
                      </div>
                      <div>
                        <label htmlFor="eventZip" className="block text-sm font-medium text-slate-700 mb-2">
                          ZIP Code
                        </label>
                        <input
                          id="eventZip"
                          type="text"
                          value={formData.eventZip}
                          onChange={(e) => setFormData({ ...formData, eventZip: e.target.value })}
                          style={{ fontSize: '16px' }}
                          className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                          placeholder="48201"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Referral source */}
                <div>
                  <label htmlFor="referralSource" className="block text-sm font-medium text-slate-700 mb-2">
                    How did you hear about us?
                  </label>
                  <select
                    id="referralSource"
                    value={formData.referralSource}
                    onChange={(e) => setFormData({ ...formData, referralSource: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all bg-white"
                    style={{ fontSize: '16px', minHeight: '48px' }}
                  >
                    <option value="">Select an option</option>
                    <option value="google">Google Search</option>
                    <option value="facebook">Facebook</option>
                    <option value="instagram">Instagram</option>
                    <option value="friend">Friend or Family</option>
                    <option value="repeat">Previous Customer</option>
                    <option value="event">Event or Festival</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                {/* Message */}
                <div>
                  <label htmlFor="message" className="block text-sm font-medium text-slate-700 mb-2">
                    Tell Us What You're Looking For *
                  </label>
                  <textarea
                    id="message"
                    required
                    rows={6}
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors resize-none"
                    placeholder="Tell us about your event! What's the occasion? Any special requests? Looking for something you didn't see on our website? We're here to help make your party perfect."
                  />
                  <p className="mt-2 text-sm text-slate-500">
                    Be as detailed as you'd like! The more we know, the better we can help.
                  </p>
                </div>

                {submitError && (
                  <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4">
                    <p className="text-red-700 text-sm font-medium">{submitError}</p>
                    {business.business_phone && (
                      <p className="text-red-600 text-sm mt-1">
                        Call us at{' '}
                        <a
                          href={`tel:${business.business_phone.replace(/\D/g, '')}`}
                          className="font-semibold underline"
                        >
                          {business.business_phone}
                        </a>
                      </p>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-8 py-4 rounded-xl font-bold transition-all shadow-xl hover:shadow-2xl transform hover:scale-[1.02] flex items-center justify-center space-x-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Sending...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-5 h-5" />
                      <span>Send Inquiry</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 border-2 border-blue-200 rounded-2xl p-6 shadow-lg">
              <h3 className="text-xl font-bold text-slate-900 mb-6 tracking-tight">Quick Contact</h3>

              <div className="space-y-4">
                {business.business_phone ? (
                  <a
                    href={`tel:${business.business_phone.replace(/\D/g, '')}`}
                    className="flex items-start space-x-3 text-slate-700 hover:text-blue-600 transition-colors group"
                  >
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md">
                      <Phone className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <div className="font-medium text-sm text-slate-500">Call Us</div>
                      <div className="font-semibold">{business.business_phone}</div>
                    </div>
                  </a>
                ) : (
                  <div className="flex items-start space-x-3 text-slate-700">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md">
                      <Phone className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <div className="font-medium text-sm text-slate-500">Call Us</div>
                      <div className="font-semibold text-slate-400">—</div>
                    </div>
                  </div>
                )}

                {business.business_email ? (
                  <a
                    href={`mailto:${business.business_email}`}
                    className="flex items-start space-x-3 text-slate-700 hover:text-blue-600 transition-colors group"
                  >
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md">
                      <Mail className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <div className="font-medium text-sm text-slate-500">Email Us</div>
                      <div className="font-semibold text-sm">{business.business_email}</div>
                    </div>
                  </a>
                ) : (
                  <div className="flex items-start space-x-3 text-slate-700">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md">
                      <Mail className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <div className="font-medium text-sm text-slate-500">Email Us</div>
                      <div className="font-semibold text-sm text-slate-400">—</div>
                    </div>
                  </div>
                )}

                <div className="flex items-start space-x-3 text-slate-700">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md">
                    <MapPin className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="font-medium text-sm text-slate-500">Location</div>
                    <div className="font-semibold text-sm">
                      {business.business_address}
                    </div>
                  </div>
                </div>

                <div className="flex items-start space-x-3 text-slate-700">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md">
                    <Clock className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="font-medium text-sm text-slate-500">Response Time</div>
                    <div className="font-semibold text-sm">Within 24 hours</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-slate-50 to-slate-100 border-2 border-slate-200 rounded-2xl p-6 shadow-lg">
              <h3 className="text-xl font-bold text-slate-900 mb-4 tracking-tight">Common Requests</h3>
              <ul className="space-y-2 text-sm text-slate-600">
                <li className="flex items-start">
                  <span className="text-blue-600 mr-2">•</span>
                  <span>Custom themed party packages</span>
                </li>
                <li className="flex items-start">
                  <span className="text-blue-600 mr-2">•</span>
                  <span>Special event planning assistance</span>
                </li>
                <li className="flex items-start">
                  <span className="text-blue-600 mr-2">•</span>
                  <span>Corporate event packages</span>
                </li>
                <li className="flex items-start">
                  <span className="text-blue-600 mr-2">•</span>
                  <span>Last-minute availability</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
