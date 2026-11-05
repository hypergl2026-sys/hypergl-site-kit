'use client';
/**
 * @hyperglllc/site-kit — connects a static Next.js website to HyperGL.
 *
 * Browser pieces (this entry): tracking, forms, booking, consent.
 * Build-time pieces: `@hyperglllc/site-kit/build` (getPosts, getReviews).
 */
export { KIT_VERSION, DEFAULT_ENDPOINT, configure, getEndpoint } from './config.js';
export { HyperGLTracking, type HyperGLTrackingProps } from './tracking.js';
export { HyperGLForm, type HyperGLFormProps, type FormConfig, type FormField } from './form.js';
export { HyperGLBooking, type HyperGLBookingProps } from './booking.js';
export { ConsentBanner, ConsentGate, useConsent, type ConsentBannerProps } from './consent-banner.js';
export { getConsent, setConsent, type ConsentChoice } from './consent.js';
export { flushQueue, sendEntry, type FormEntry, type SendOutcome } from './form-sender.js';
