# Field-Level Validation Scrolling - Implementation

## Problem Identified

The original iOS native validation fix properly disabled HTML5 validation, but had a critical UX issue:

**Issue:** `validateQuote()` only checked:
- Cart (empty/unavailable)
- Responsibility checkboxes (overnight/same-day/commercial)

**Result:** When users tapped "Continue to Checkout" with missing information, the system ALWAYS scrolled to responsibility checkboxes first (if unchecked), even when critical user input fields (address, event date, etc.) were empty.

**Why this is bad:**
1. Users haven't filled in basic event info yet
2. Responsibility checkbox appears at the bottom
3. Creates confusing UX - why am I being asked to agree when I haven't even entered my address?
4. Violates natural form flow (top to bottom)

## Solution: Comprehensive Validation Order + Field-Level Scrolling

### 1. Validation Order (Top to Bottom)

Updated `validateQuote()` to check in logical order:

1. **Cart** - Must have items
2. **Address** - Street, city, state, ZIP
3. **Event Details** - Dates and times
4. **Responsibility Agreements** - Last (after user inputs)

This ensures users fill out basic information BEFORE being asked to agree to terms.

### 2. Field-Level Error Identification

Added `errorFieldId` to `ValidationResult`:

```typescript
interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
  errorSection?: 'cart' | 'address' | 'event' | 'setup';
  errorFieldId?: string; // NEW: Exact field DOM ID
}
```

### 3. Precise Scrolling

Created `scrollToField()` function that:
- Uses `document.getElementById(errorFieldId)`
- Scrolls to EXACT invalid field
- Optionally focuses the field after scroll
- Falls back to section scroll if no fieldId

## Files Changed

### 1. `src/lib/quoteValidation.ts`

**Added comprehensive validation in proper order:**

```typescript
export function validateQuote(
  cart: CartItem[],
  formData: QuoteFormData
): ValidationResult {
  // 1. Cart validation
  if (cart.length === 0) {
    return {
      isValid: false,
      errorMessage: 'Please add at least one inflatable to your quote.',
      errorSection: 'cart',
    };
  }

  // 2. Address validation (NEW)
  if (!formData.address_line1 || formData.address_line1.trim() === '') {
    return {
      isValid: false,
      errorMessage: 'Please enter a street address for the event location.',
      errorSection: 'address',
      errorFieldId: 'address-input', // Exact field to scroll to
    };
  }

  if (!formData.city || formData.city.trim() === '') {
    return {
      isValid: false,
      errorMessage: 'Please enter a city for the event location.',
      errorSection: 'address',
      errorFieldId: 'city-input',
    };
  }

  if (!formData.state || formData.state.trim() === '') {
    return {
      isValid: false,
      errorMessage: 'Please enter a state for the event location.',
      errorSection: 'address',
      errorFieldId: 'state-input',
    };
  }

  if (!formData.zip || formData.zip.trim() === '') {
    return {
      isValid: false,
      errorMessage: 'Please enter a ZIP code for the event location.',
      errorSection: 'address',
      errorFieldId: 'zip-input',
    };
  }

  // 3. Event details validation (NEW)
  if (!formData.event_date) {
    return {
      isValid: false,
      errorMessage: 'Please select an event start date.',
      errorSection: 'event',
      errorFieldId: 'event-start-date',
    };
  }

  if (!formData.event_end_date) {
    return {
      isValid: false,
      errorMessage: 'Please select an event end date.',
      errorSection: 'event',
      errorFieldId: 'event-end-date',
    };
  }

  if (!formData.start_window) {
    return {
      isValid: false,
      errorMessage: 'Please select an event start time.',
      errorSection: 'event',
      errorFieldId: 'start-time',
    };
  }

  if (!formData.end_window) {
    return {
      isValid: false,
      errorMessage: 'Please select an event end time.',
      errorSection: 'event',
      errorFieldId: 'end-time',
    };
  }

  // 4. Responsibility agreements (LAST, after user inputs)
  if (
    formData.location_type === 'residential' &&
    formData.pickup_preference === 'next_day' &&
    !formData.overnight_responsibility_accepted
  ) {
    return {
      isValid: false,
      errorMessage: 'Please accept the overnight responsibility agreement.',
      errorSection: 'event',
      errorFieldId: 'overnight-responsibility-checkbox',
    };
  }

  if (
    formData.pickup_preference === 'same_day' &&
    !formData.same_day_responsibility_accepted
  ) {
    return {
      isValid: false,
      errorMessage: 'Please accept the responsibility agreement for same-day pickup.',
      errorSection: 'event',
      errorFieldId: 'same-day-responsibility-checkbox',
    };
  }

  if (
    formData.location_type === 'commercial' &&
    !formData.same_day_responsibility_accepted
  ) {
    return {
      isValid: false,
      errorMessage: 'Please accept the responsibility agreement for commercial events.',
      errorSection: 'event',
      errorFieldId: 'commercial-responsibility-checkbox',
    };
  }

  return { isValid: true };
}
```

### 2. `src/components/quote/AddressSection.tsx`

**Added stable IDs to all inputs:**

```typescript
<label htmlFor="address-input" className="...">Street Address *</label>
<AddressAutocomplete
  id="address-input"
  // ...
/>

<label htmlFor="city-input" className="...">City *</label>
<input
  id="city-input"
  // ...
/>

<label htmlFor="state-input" className="...">State *</label>
<input
  id="state-input"
  // ...
/>

<label htmlFor="zip-input" className="...">ZIP Code *</label>
<input
  id="zip-input"
  // ...
/>
```

### 3. `src/components/quote/EventDetailsSection.tsx`

**Added stable IDs to date/time inputs and checkboxes:**

```typescript
// Date/time inputs
<label htmlFor="event-start-date" className="...">Event Start Date *</label>
<DatePickerInput id="event-start-date" {...props} />

<label htmlFor="event-end-date" className="...">Event End Date *</label>
<DatePickerInput id="event-end-date" {...props} />

<label htmlFor="start-time" className="...">Start Time *</label>
<TimePickerInput id="start-time" {...props} />

<label htmlFor="end-time" className="...">End Time *</label>
<TimePickerInput id="end-time" {...props} />

// Responsibility checkboxes
<label htmlFor="overnight-responsibility-checkbox" className="...">
  <input
    id="overnight-responsibility-checkbox"
    type="checkbox"
    // ...
  />
</label>

<label htmlFor="same-day-responsibility-checkbox" className="...">
  <input
    id="same-day-responsibility-checkbox"
    type="checkbox"
    // ...
  />
</label>

<label htmlFor="commercial-responsibility-checkbox" className="...">
  <input
    id="commercial-responsibility-checkbox"
    type="checkbox"
    // ...
  />
</label>
```

### 4. `src/components/order/AddressAutocomplete.tsx`

**Added id prop support:**

```typescript
interface AddressAutocompleteProps {
  id?: string; // NEW
  value: string;
  // ...
}

export function AddressAutocomplete({ id, value, ... }: AddressAutocompleteProps) {
  return (
    <div>
      <input
        id={id} // NEW
        ref={inputRef}
        // ...
      />
    </div>
  );
}
```

### 5. `src/components/ui/DatePickerInput.tsx`

**Added id prop support:**

```typescript
interface DatePickerInputProps {
  id?: string; // NEW
  value: string;
  // ...
}

export function DatePickerInput({ id, ... }: DatePickerInputProps) {
  return (
    <div className="relative">
      {/* Styled display */}
      <div className="...">...</div>

      {/* Native input with ID */}
      <input
        id={id} // NEW
        type="date"
        className="absolute inset-0 ... opacity-0"
        // ...
      />
    </div>
  );
}
```

### 6. `src/components/ui/TimePickerInput.tsx`

**Added id prop support:**

```typescript
interface TimePickerInputProps {
  id?: string; // NEW
  value: string;
  // ...
}

export function TimePickerInput({ id, ... }: TimePickerInputProps) {
  return (
    <div className="relative">
      {/* Styled display */}
      <div className="...">...</div>

      {/* Native input with ID */}
      <input
        id={id} // NEW
        type="time"
        className="absolute inset-0 ... opacity-0"
        // ...
      />
    </div>
  );
}
```

### 7. `src/pages/Quote.tsx`

**Added scrollToField function and updated handleSubmit:**

```typescript
// NEW: Scroll to specific field by ID
const scrollToField = (fieldId: string) => {
  const element = document.getElementById(fieldId);

  if (!element) return;

  try {
    const elementRect = element.getBoundingClientRect();
    const absoluteTop = elementRect.top + window.scrollY;
    const headerOffset = 100; // Account for sticky header
    const targetScrollTop = absoluteTop - headerOffset;

    // Scroll to field
    window.scrollTo({
      top: targetScrollTop,
      behavior: 'smooth',
    });

    // Focus the field after scroll completes
    setTimeout(() => {
      element.focus({ preventScroll: true });
    }, 500);

  } catch (error) {
    // Fallback scroll
    const rect = element.getBoundingClientRect();
    window.scrollTo({
      top: rect.top + window.scrollY - 100,
      behavior: 'auto',
    });
  }
};

// UPDATED: handleSubmit now uses errorFieldId
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  e.stopPropagation();

  const validation = validateQuote(cart, formData);
  if (!validation.isValid) {
    const errorMessage = validation.errorMessage || 'Please fix the errors below';

    flushSync(() => {
      setValidationError(errorMessage);
    });

    // NEW: Scroll to exact field if errorFieldId exists
    if (validation.errorFieldId) {
      scrollToField(validation.errorFieldId);
    } else if (validation.errorSection) {
      scrollToSection(validation.errorSection);
    }

    // Auto-dismiss banner after 8 seconds
    setTimeout(() => {
      setValidationError(null);
    }, 8000);

    return;
  }

  // Continue with checkout...
};
```

## Validation Flow Now Works Like This

### User Scenario 1: Empty Form
1. User adds items to cart
2. Taps "Continue to Checkout" without filling anything
3. **Result:** Scrolls to address field, shows "Please enter a street address"

### User Scenario 2: Partial Address
1. User enters street address
2. Leaves city, state, ZIP empty
3. Taps "Continue to Checkout"
4. **Result:** Scrolls to city field, shows "Please enter a city"

### User Scenario 3: Address Complete, No Event Details
1. User fills out complete address
2. Leaves event date/time empty
3. Taps "Continue to Checkout"
4. **Result:** Scrolls to event start date, shows "Please select an event start date"

### User Scenario 4: Everything Except Responsibility Checkbox
1. User fills out address and event details
2. Leaves overnight responsibility checkbox unchecked
3. Taps "Continue to Checkout"
4. **Result:** Scrolls DIRECTLY to checkbox, shows "Please accept the overnight responsibility agreement"

## Benefits

### 1. Natural Form Flow
Users are guided top-to-bottom through the form, matching natural reading/completion order.

### 2. Precise Error Location
Instead of scrolling to a broad "section," we scroll to the EXACT field that needs attention.

### 3. Better UX on Mobile
On iPhone, the field is scrolled into view AND focused, triggering the keyboard for immediate input.

### 4. Accessibility
- Proper label associations with `htmlFor` attributes
- Focus management for screen readers
- Clear error messages tied to specific fields

### 5. Maintainability
- Each validation returns a specific fieldId
- Easy to add new validations
- Clear mapping between validation logic and UI elements

## Testing on iPhone Safari

### Test 1: Empty Form (Except Cart)
1. Add items to cart
2. Tap "Continue to Checkout"
3. ✅ **Expected:** Scrolls to address input, banner shows "Please enter a street address"
4. ✅ **Expected:** Address input is focused and keyboard opens

### Test 2: Missing City
1. Fill street address
2. Leave city empty
3. Tap "Continue to Checkout"
4. ✅ **Expected:** Scrolls to city input, banner shows "Please enter a city"
5. ✅ **Expected:** City input is focused

### Test 3: Missing Event Date
1. Fill complete address
2. Leave event date empty
3. Tap "Continue to Checkout"
4. ✅ **Expected:** Scrolls to event start date picker, banner shows "Please select an event start date"
5. ✅ **Expected:** Date picker is focused (iOS date picker opens)

### Test 4: Missing Responsibility Checkbox (Overnight)
1. Fill address and event details
2. Select "Residential" + "Next Morning" pickup
3. Leave overnight checkbox unchecked
4. Tap "Continue to Checkout"
5. ✅ **Expected:** Scrolls DIRECTLY to overnight checkbox, banner shows "Please accept the overnight responsibility agreement"
6. ✅ **Expected:** Checkbox is focused (blue outline)

### Test 5: Same-Day Responsibility
1. Fill address and event details
2. Select "Residential" + "Same Day" pickup
3. Leave same-day checkbox unchecked
4. Tap "Continue to Checkout"
5. ✅ **Expected:** Scrolls to same-day checkbox, banner shows responsibility message

### Test 6: Commercial Responsibility
1. Fill address and event details
2. Select "Commercial" location type
3. Leave commercial checkbox unchecked
4. Tap "Continue to Checkout"
5. ✅ **Expected:** Scrolls to commercial checkbox, banner shows responsibility message

### Debug Mode Test
1. Navigate to `/quote?debug=1`
2. Yellow panel appears bottom-left
3. Submit with missing field
4. Panel shows:
   - `Validation Failed: ✓ YES`
   - `Error Section: [section]`
   - `Scroll Attempted: ✓ YES`
   - `Ref Found: ✓ YES`
   - `Element Top: [number]px`
   - `Scroll Target: [number]px`

## Field ID Reference

### Address Section
- `address-input` - Street address
- `city-input` - City
- `state-input` - State
- `zip-input` - ZIP code

### Event Details Section
- `event-start-date` - Event start date
- `event-end-date` - Event end date
- `start-time` - Event start time
- `end-time` - Event end time
- `overnight-responsibility-checkbox` - Overnight agreement (residential + next-day)
- `same-day-responsibility-checkbox` - Same-day agreement (residential + same-day)
- `commercial-responsibility-checkbox` - Commercial agreement

### Cart Section
- No specific field IDs (scrolls to section-cart)

### Setup Section
- No validation for setup fields currently

## Success Criteria

✅ Validation checks fields in logical order (top to bottom)
✅ Each validation error includes specific fieldId
✅ Scroll targets exact field, not just section
✅ Field is focused after scroll on mobile
✅ Banner message is clear and field-specific
✅ Works identically on iPhone and desktop
✅ No native HTML5 validation interferes
✅ Keyboard opens automatically for text inputs
✅ Date/time pickers open when focused
✅ Checkboxes show focus outline

## Prevention Guidelines

### DO:
- ✅ Add validations in top-to-bottom order
- ✅ Return errorFieldId for all field-specific errors
- ✅ Use stable, descriptive IDs (kebab-case)
- ✅ Associate labels with inputs using htmlFor
- ✅ Test field focus behavior on real iPhone
- ✅ Provide clear, actionable error messages

### DON'T:
- ❌ Validate checkboxes before user input fields
- ❌ Use generic section scrolling when field is known
- ❌ Skip ID attributes on form controls
- ❌ Use auto-generated or unstable IDs
- ❌ Focus fields without preventScroll (causes double-scroll)
- ❌ Rely only on section refs (use IDs as primary)

## Related Documentation

- See `IOS_NATIVE_VALIDATION_FIX.md` for the native validation bypass fix
- See `IOS_VALIDATION_FIX_V2.md` for flushSync implementation
- See `IPHONE_TEST_CHECKLIST.md` for comprehensive testing
