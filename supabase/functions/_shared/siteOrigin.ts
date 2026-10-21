// The one place server-built customer and admin links get their origin (NI-07).
//
// Links in emails and texts used to hard-code the Production site, so a message sent from Development pointed customers' links at
// Production. The origin is now the configured SITE_URL (the site this deployment serves), falling back to Production only when it is not
// set or not usable. Nothing here trusts a request header: a header-derived origin goes through resolveReturnOrigin's allow-list instead.
import { DEFAULT_RETURN_ORIGIN, siteOriginFrom } from "./booking/returnOrigin.ts";

type EnvReader = { get(name: string): string | undefined };

export function getSiteOrigin(env?: EnvReader | null): string {
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reader: EnvReader | undefined = env ?? (globalThis as any).Deno?.env;
  const configured = typeof reader?.get === "function" ? reader.get("SITE_URL") : undefined;
  return siteOriginFrom(configured) ?? DEFAULT_RETURN_ORIGIN;
}

// The origins a Stripe return or a link may use: SITE_URL and RETURN_ORIGINS are passed to resolveReturnOrigin together with the
// request's own claim, which only wins when it is on the allow-list.
export function configuredOrigins(env?: EnvReader | null): unknown[] {
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reader: EnvReader | undefined = env ?? (globalThis as any).Deno?.env;
  const get = (name: string) => (typeof reader?.get === "function" ? reader.get(name) : undefined);
  return [get("SITE_URL"), get("RETURN_ORIGINS")];
}
