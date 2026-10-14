// Whether the booking confirmation for the payment-complete page is settled, so the page may remember (in this browser) that
// it has been handled. The server is the authority on whether a confirmation was sent; this only decides whether the browser
// should skip asking again on the next visit. A recoverable failure (the email did not go out, or another request is still
// sending it) is NOT settled, so a refresh can retry it.
export function confirmationSettled(alreadySentOnOrder: boolean, result: { emailSent: boolean } | null | undefined): boolean {
  if (alreadySentOnOrder) return true;
  return result?.emailSent === true;
}
