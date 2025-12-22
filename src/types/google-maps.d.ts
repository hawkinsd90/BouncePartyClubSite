declare global {
  interface Window {
    google: typeof google;
  }

  namespace google.maps {
    namespace places {
      class PlaceAutocompleteElement extends HTMLElement {
        constructor(options?: {
          componentRestrictions?: { country: string | string[] };
        });
        addEventListener(type: 'gmp-placeselect', listener: (event: any) => void): void;
        style: CSSStyleDeclaration;
      }

      interface PlacesLibrary {
        PlaceAutocompleteElement: typeof PlaceAutocompleteElement;
      }
    }
  }
}

export {};
