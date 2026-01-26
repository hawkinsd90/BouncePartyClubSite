import { useState, useEffect } from 'react';
import { MessageSquare, Send, Phone, Mail, MapPin, Clock } from 'lucide-react';
import { getBusinessAddressText } from '../lib/adminSettingsCache';

export function Contact() {
  const [businessAddress, setBusinessAddress] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    eventDate: '',
    guestCount: '',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    getBusinessAddressText().then(setBusinessAddress);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    console.log('Inquiry submitted:', formData);
    setSubmitted(true);

    setTimeout(() => {
      setSubmitted(false);
      setFormData({
        name: '',
        email: '',
        phone: '',
        eventDate: '',
        guestCount: '',
        message: '',
      });
    }, 5000);
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
          <p className="text-sm text-slate-500">
            For immediate assistance, call us at{' '}
            <a href="tel:+13138893860" className="text-blue-600 hover:underline font-medium">
              (313) 889-3860
            </a>
          </p>
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-2">
                      Your Name *
                    </label>
                    <input
                      id="name"
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                      placeholder="John Smith"
                    />
                  </div>

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
                      className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                      placeholder="(313) 555-0123"
                    />
                  </div>

                  <div>
                    <label htmlFor="eventDate" className="block text-sm font-medium text-slate-700 mb-2">
                      Event Date
                    </label>
                    <input
                      id="eventDate"
                      type="date"
                      value={formData.eventDate}
                      onChange={(e) => setFormData({ ...formData, eventDate: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                    />
                  </div>

                  <div>
                    <label htmlFor="guestCount" className="block text-sm font-medium text-slate-700 mb-2">
                      Expected Guest Count
                    </label>
                    <input
                      id="guestCount"
                      type="text"
                      value={formData.guestCount}
                      onChange={(e) => setFormData({ ...formData, guestCount: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                      placeholder="e.g., 20-30 kids"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="message" className="block text-sm font-medium text-slate-700 mb-2">
                    Tell Us What You're Looking For *
                  </label>
                  <textarea
                    id="message"
                    required
                    rows={8}
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors resize-none"
                    placeholder="Tell us about your event! What's the occasion? Any special requests? Looking for something you didn't see on our website? We're here to help make your party perfect."
                  />
                  <p className="mt-2 text-sm text-slate-500">
                    Be as detailed as you'd like! The more we know, the better we can help.
                  </p>
                </div>

                <button
                  type="submit"
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-8 py-4 rounded-xl font-bold transition-all shadow-xl hover:shadow-2xl transform hover:scale-[1.02] flex items-center justify-center space-x-2"
                >
                  <Send className="w-5 h-5" />
                  <span>Send Inquiry</span>
                </button>
              </form>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 border-2 border-blue-200 rounded-2xl p-6 shadow-lg">
              <h3 className="text-xl font-bold text-slate-900 mb-6 tracking-tight">Quick Contact</h3>

              <div className="space-y-4">
                <a
                  href="tel:+13138893860"
                  className="flex items-start space-x-3 text-slate-700 hover:text-blue-600 transition-colors group"
                >
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md">
                    <Phone className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="font-medium text-sm text-slate-500">Call Us</div>
                    <div className="font-semibold">(313) 889-3860</div>
                  </div>
                </a>

                <a
                  href="mailto:admin@bouncepartyclub.com"
                  className="flex items-start space-x-3 text-slate-700 hover:text-blue-600 transition-colors group"
                >
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md">
                    <Mail className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="font-medium text-sm text-slate-500">Email Us</div>
                    <div className="font-semibold text-sm">admin@bouncepartyclub.com</div>
                  </div>
                </a>

                <div className="flex items-start space-x-3 text-slate-700">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md">
                    <MapPin className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="font-medium text-sm text-slate-500">Location</div>
                    <div className="font-semibold text-sm">
                      {businessAddress}
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
                  <span>Multiple unit discounts</span>
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
