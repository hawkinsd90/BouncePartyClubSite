// WP-10 (B9): when a data load may show the full-screen spinner.
//
// A spinner that replaces the page also unmounts everything on it, including a modal holding unsaved work (the route order in the
// calendar, an order being edited). So the spinner is for the first load, and for a change of what is shown (another month). A
// refresh of what is already on screen - realtime change, save, manual reload - runs quietly.
export interface LoadingPolicyInput {
  // A refresh of the same view (realtime, manual reload, role resolved). Never shows the spinner.
  background?: boolean;
  // The screen opted in to keep showing its data while it reloads.
  keepDataWhileRefetching?: boolean;
  // Something is already on screen.
  hasData: boolean;
}

export function shouldRaiseLoading({ background = false, keepDataWhileRefetching = false, hasData }: LoadingPolicyInput): boolean {
  if (background) return false;
  if (keepDataWhileRefetching && hasData) return false;
  return true;
}
