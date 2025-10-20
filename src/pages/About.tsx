import { MapPin, Phone, Mail, Clock, Users, Award, Heart } from 'lucide-react';

export function About() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-slate-900 mb-8 text-center">About Bounce Party Club</h1>

        <div className="bg-white rounded-xl shadow-md p-8 mb-8">
          <div className="flex items-center justify-center mb-6">
            <Heart className="w-12 h-12 text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-4 text-center">
            Bringing Energy and Excitement to Your Events
          </h2>
          <p className="text-lg text-slate-700 leading-relaxed mb-4">
            Welcome to Bounce Party Club! We're honored to be your trusted partner in creating unforgettable celebrations throughout the Detroit Metro area and surrounding communities.
          </p>
          <p className="text-slate-700 leading-relaxed">
            Our mission is simple: deliver premium inflatable entertainment with exceptional service, safety, and professionalism. Whether it's a backyard birthday party, school event, church gathering, or community festival, we bring the fun directly to you.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-md p-6 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
              <Award className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="font-semibold text-slate-900 mb-2">Quality Equipment</h3>
            <p className="text-sm text-slate-600">
              Premium, well-maintained inflatables that are cleaned and inspected after every rental
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
              <Users className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-slate-900 mb-2">Professional Service</h3>
            <p className="text-sm text-slate-600">
              Experienced crew members who arrive on time, set up safely, and provide clear instructions
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-100 rounded-full mb-4">
              <Clock className="w-8 h-8 text-amber-600" />
            </div>
            <h3 className="font-semibold text-slate-900 mb-2">Reliable Delivery</h3>
            <p className="text-sm text-slate-600">
              Guaranteed delivery before noon on event day with flexible pickup options
            </p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-md p-8 mb-8">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">Our Story</h2>
          <p className="text-slate-700 leading-relaxed mb-4">
            Founded in Wayne, Michigan, Bounce Party Club was built on a simple belief: every celebration deserves to be special. What started as a passion for bringing joy to local families has grown into a trusted service across the Detroit Metro area.
          </p>
          <p className="text-slate-700 leading-relaxed mb-4">
            We understand that planning an event can be stressful, which is why we've streamlined everything from booking to setup. Our online quote system gives you instant pricing, our professional crew handles all the heavy lifting, and our flexible policies give you peace of mind.
          </p>
          <p className="text-slate-700 leading-relaxed">
            Every bounce house, water slide, and combo inflatable in our fleet is chosen with safety and fun in mind. We invest in premium equipment, maintain it meticulously, and deliver it with care.
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-md p-8 mb-8">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">Service Area</h2>
          <p className="text-slate-700 leading-relaxed mb-4">
            We proudly serve the Detroit Metro area and surrounding communities, including Wayne, Westland, Canton, Garden City, Dearborn Heights, Inkster, Romulus, and beyond. If you're unsure whether we deliver to your location, just enter your address in our quote tool and we'll calculate pricing automatically.
          </p>
          <p className="text-slate-700 leading-relaxed">
            Travel fees are calculated based on distance from our Wayne location, with many local cities included in our free delivery zone.
          </p>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-8">
          <h2 className="text-2xl font-bold text-slate-900 mb-6 text-center">Contact Us</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex flex-col items-center text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-600 rounded-full mb-3">
                <MapPin className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-semibold text-slate-900 mb-1">Address</h3>
              <p className="text-sm text-slate-600">
                4426 Woodward St<br />
                Wayne, MI 48184
              </p>
            </div>

            <div className="flex flex-col items-center text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-600 rounded-full mb-3">
                <Phone className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-semibold text-slate-900 mb-1">Phone</h3>
              <p className="text-sm text-slate-600">
                <a href="tel:+13138893860" className="text-blue-600 hover:text-blue-700 font-medium">
                  (313) 889-3860
                </a>
              </p>
            </div>

            <div className="flex flex-col items-center text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-600 rounded-full mb-3">
                <Mail className="w-6 h-6 text-white" />
              </div>
              <h3 className="font-semibold text-slate-900 mb-1">Email</h3>
              <p className="text-sm text-slate-600">
                <a href="mailto:info@bouncepartyclub.com" className="text-blue-600 hover:text-blue-700 font-medium">
                  info@bouncepartyclub.com
                </a>
              </p>
            </div>
          </div>
        </div>

        <div className="text-center mt-8">
          <p className="text-lg font-semibold text-slate-900 mb-2">
            Ready to book your next event?
          </p>
          <a
            href="/catalog"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-8 rounded-lg transition-colors"
          >
            Browse Inflatables
          </a>
        </div>
      </div>
    </div>
  );
}
