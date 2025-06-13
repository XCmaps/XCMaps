import * as Sentry from "@sentry/browser";

// Ensure to call this before importing any other modules!
Sentry.init({
  dsn: "https://bbc65726280e9b5ab3981736c1254daf@o4509490070421504.ingest.de.sentry.io/4509490072911952",

  // Add Tracing by setting tracesSampleRate
  // We recommend adjusting this value in production
  tracesSampleRate: 1.0,
});
