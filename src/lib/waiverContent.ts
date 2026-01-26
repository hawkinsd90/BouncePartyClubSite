import type { BusinessSettings } from '../contexts/BusinessContext';

export const WAIVER_VERSION = '1.0';

export function generateWaiverText(business: BusinessSettings): string {
  const businessName = business.business_name_short;
  const businessLegalEntity = business.business_legal_entity;
  const businessAddress = business.business_address;
  const businessPhone = business.business_phone;
  const businessEmail = business.business_email;

  return `${businessLegalEntity}
${businessAddress} | ${businessPhone} | ${businessEmail}

IMPORTANT: THIS IS A LEGAL DOCUMENT. PLEASE READ CAREFULLY BEFORE SIGNING.

This Waiver and Release of Liability Agreement ("Agreement") is entered into by the undersigned Renter ("Renter") in favor of ${businessLegalEntity}, and its owners, employees, agents, affiliates, and contractors ("${businessName}").

1. ACKNOWLEDGMENT AND ASSUMPTION OF RISK

I understand that the use of inflatable bounce houses and related equipment carries inherent risks of injury or damage. I voluntarily assume all such risks for myself and all participants under my supervision.

I agree to inform all participants of the risks and safety rules and accept responsibility for their compliance during the rental period.

This waiver applies for the entire rental duration, including setup, idle time, and breakdown, regardless of whether the equipment is actively in use.

2. WAIVER AND RELEASE OF LIABILITY

I fully and forever release and discharge ${businessName} from any and all claims or liabilities arising out of injury or damage during the rental period, whether from negligence or otherwise.

This waiver does not apply to claims arising from gross negligence or willful misconduct by ${businessName}.

Gross negligence is defined as conduct so reckless as to demonstrate a substantial lack of concern for whether injury results.

3. INDEMNIFICATION

I agree to indemnify and hold harmless ${businessName} from any claims or liabilities arising out of the use of its equipment.

4. RENTER'S RESPONSIBILITY

I accept full responsibility for supervising all participants using the equipment and for communicating all safety rules.

5. EQUIPMENT CONDITION

I acknowledge that I have inspected the equipment and found it in good working condition at the start of the rental period. I understand I may take photos or videos of any visible damage or concerns before ${businessName} leaves the setup location and agree to share such documentation immediately.

6. CANCELLATIONS AND REFUNDS

I understand and agree that any deposit or initial payment made toward my reservation is refundable only if I cancel seventy-two (72) hours or more before the scheduled event time.

If I cancel less than seventy-two (72) hours before the event, I understand that my deposit or initial payment is non-refundable, but may be applied one (1) time toward a rescheduled date within twelve (12) months, subject to availability and the discretion of ${businessName}.

If ${businessName} determines that weather or safety conditions make delivery or setup unsafe, my reservation will be eligible for one (1) free reschedule within twelve (12) months. No monetary refunds will be issued for weather-related cancellations.

If ${businessName} must cancel my reservation for operational reasons unrelated to weather or safety, I may be offered a refund or a rescheduled date at the sole discretion of ${businessName}.

Once delivery has begun or setup has started at the event location, I understand that no refunds or credits of any kind will be provided.

7. PHOTO AND VIDEO RELEASE (Optional)

I consent to the use of any photos or videos taken during the event for promotional purposes by ${businessName}, unless I notify the company in writing prior to the rental date.

8. DAMAGE RESPONSIBILITY AND FEE

I understand and agree that I am responsible for any intentional, negligent, or reckless damage to ${businessName} equipment.

I may be charged a minimum of $150.00, or more depending on the extent of the damage, subject to ${businessName}'s reasonable assessment and documentation.

I agree to remit payment within 10 business days upon receiving a written notice and invoice.

9. RULES AND SAFETY COMPLIANCE

I agree to follow all instructions and safety rules provided by ${businessName}. I further acknowledge the following safety guidelines apply during the rental period and must be enforced by me as the responsible renter:

• Adult supervision is required at all times.
• No shoes inside the inflatable.
• No sharp objects, including keys, jewelry, or glasses.
• No food, drinks, or gum inside the inflatable.
• No rough play, wrestling, or climbing on the unit.
• Do not hang on netting, walls, or roofs.
• Limit occupancy by age group and size.
• No silly string, face paint, glitter, or confetti.
• Keep the unit dry unless authorized for water use.
• Exit immediately during rain, lightning, or winds over 15 MPH.
• Do not unplug or move blowers or extension cords.
• Do not exceed posted weight or occupancy limits.

In the event of injury or emergency, I agree to call 911 immediately and notify ${businessName} as soon as reasonably possible.

I agree to monitor weather conditions and cease use of the equipment in unsafe weather including, but not limited to, rain, high winds, or lightning.

I acknowledge that I have received and reviewed the safety instructions provided by ${businessName} and had the opportunity to ask questions.

10. GOVERNING LAW

This Agreement shall be governed by and construed in accordance with the laws of the State of Michigan. Any legal action or proceeding arising out of this Agreement shall be brought exclusively in the courts of Wayne County, Michigan, and the parties hereby consent to the jurisdiction of such courts.

11. SEVERABILITY

If any provision is found invalid, the rest remains enforceable.

12. ENTIRE AGREEMENT

This Agreement reflects the complete understanding between ${businessName} and the Renter.

13. MINORS

If participants under the age of 18 will be present, I acknowledge that I am their parent/legal guardian or have secured the consent of their parent/legal guardian and accept all terms of this Agreement on their behalf.

If I am not the parent or legal guardian of participating minors, I affirm I have obtained written consent from the responsible parties agreeing to the terms of this waiver.

14. INSURANCE DISCLAIMER

${businessName} does not provide medical or liability insurance for injuries sustained while using the equipment.`;
}

// Default waiver text with fallback address
// For custom address, regenerate using generateWaiverText()
export const WAIVER_TEXT = generateWaiverText({
  business_name: 'Bounce Party Club',
  business_name_short: 'Bounce Party Club',
  business_legal_entity: 'Bounce Party Club LLC',
  business_address: '4426 Woodward St, Wayne, MI 48184',
  business_phone: '(313) 889-3860',
  business_email: 'BouncePartyClub@gmail.com',
  business_website: 'https://bouncepartyclub.com',
  business_license_number: '',
});

export const INITIALS_REQUIRED = [
  'Cancellations and Refunds',
  'Damage Responsibility and Fee',
  'Rules and Safety Compliance',
];

export const ELECTRONIC_CONSENT_TEXT =
  'I consent to the use of electronic records and electronic signatures for this rental agreement and liability waiver. I understand that my electronic signature will have the same legal effect as a handwritten signature and that I am providing this signature voluntarily. I certify that I am at least 18 years old and agree to the terms of this Agreement.';
