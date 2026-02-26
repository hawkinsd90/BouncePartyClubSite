# iPhone Safari Testing Checklist

## Pre-Test: Clear Cache
1. Open Settings app on iPhone
2. Scroll to Safari
3. Tap "Clear History and Website Data"
4. Confirm

## Test 1: Version Verification
- [ ] Navigate to `bouncepartyclub.com/quote`
- [ ] See `v2.1.0` in top-left corner (small gray badge)
- [ ] If not visible, cache wasn't cleared properly

## Test 2: Empty Cart Validation
- [ ] Ensure cart is empty
- [ ] Tap "Continue to Checkout" button
- [ ] **MUST SEE:** Red error banner appears at top of screen
- [ ] **MUST SEE:** Page smoothly scrolls to cart section
- [ ] Banner stays visible for 8 seconds or until dismissed

## Test 3: Missing Address
- [ ] Add 1+ items to cart
- [ ] Leave address fields empty
- [ ] Tap "Continue to Checkout"
- [ ] **MUST SEE:** Error banner appears
- [ ] **MUST SEE:** Page scrolls to address section

## Test 4: Missing Event Date
- [ ] Fill cart and address
- [ ] Leave event date/time empty
- [ ] Tap "Continue to Checkout"
- [ ] **MUST SEE:** Error banner appears
- [ ] **MUST SEE:** Page scrolls to event details section

## Test 5: Missing Overnight Agreement
- [ ] Fill cart, address, event details
- [ ] Select overnight rental
- [ ] Leave "I agree to overnight terms" unchecked
- [ ] Tap "Continue to Checkout"
- [ ] **MUST SEE:** Error banner appears
- [ ] **MUST SEE:** Page scrolls to setup details section

## Test 6: Debug Mode (Optional)
- [ ] Navigate to `bouncepartyclub.com/quote?debug=1`
- [ ] See yellow debug panel in bottom-left corner
- [ ] Try submitting with empty cart
- [ ] Debug panel updates with:
  - `Validation Failed: ✓ YES`
  - `Error Section: cart`
  - `Scroll Attempted: ✓ YES`
  - `Ref Found: ✓ YES`
  - `Element Top: [some number]px`
  - `Scroll Target: [some number]px`

## Success Criteria
All tests must show:
1. ✅ Error banner appears immediately (red, at top)
2. ✅ Page scrolls smoothly to problem section
3. ✅ Scroll is centered/visible (not hidden under header)
4. ✅ Banner is dismissible via X button
5. ✅ Banner auto-dismisses after 8 seconds

## If Still Broken
Check debug panel (`?debug=1`) output:

**If `Validation Failed: ✗ NO`:**
- Validation logic not running
- Check if form submission is prevented elsewhere

**If `Scroll Attempted: ✗ NO`:**
- scrollToSection not being called
- Check conditional logic in handleSubmit

**If `Ref Found: ✗ NO`:**
- DOM element not rendered
- Check if section is conditionally hidden
- Check React key changes remounting component

**If all checks pass but page doesn't scroll:**
- CSS issue (overflow, position, scroll container)
- Check parent elements for scroll-blocking styles

## Compare to Desktop Chrome
Run same tests on desktop Chrome - should behave identically:
- [ ] Empty cart - banner + scroll
- [ ] Missing address - banner + scroll
- [ ] Missing event - banner + scroll
- [ ] Missing overnight - banner + scroll

If desktop works but iPhone doesn't, and debug shows all checks passed:
- There's a scroll container or CSS issue specific to mobile viewport
- Check for `overflow: hidden` on parent elements
- Check for `position: fixed` interfering with scroll
