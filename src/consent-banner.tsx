'use client';
/**
 * <ConsentBanner privacyHref="/privacy" />
 * <ConsentGate><ThirdPartyTags /></ConsentGate>
 *
 * Asks EU/UK visitors (by time zone, no lookup) — or everyone, with
 * `show="always"` — before anything is stored or any third-party tag loads.
 * The choice updates Google Consent Mode and the kit's own tracking. Accept and
 * Reject are equally easy, as the rules require.
 *
 * Styling: `hg-consent-banner`, `hg-consent-text`, `hg-consent-actions`,
 * `hg-consent-accept`, `hg-consent-reject`.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { getConsent, likelyNeedsBanner, onConsentChange, setConsent, type ConsentChoice } from './consent.js';

export interface ConsentBannerProps {
  /** 'eu' (default): EU/EEA/UK/Swiss visitors only. 'always': every visitor. */
  show?: 'eu' | 'always';
  privacyHref?: string;
  text?: ReactNode;
  acceptLabel?: string;
  rejectLabel?: string;
  className?: string;
}

/** The visitor's choice, live. */
export function useConsent(): ConsentChoice | null {
  const [c, setC] = useState<ConsentChoice | null>(null);
  useEffect(() => { setC(getConsent()); return onConsentChange(setC); }, []);
  return c;
}

export function ConsentBanner(props: ConsentBannerProps) {
  const choice = useConsent();
  const [needed, setNeeded] = useState(false);
  useEffect(() => { setNeeded((props.show ?? 'eu') === 'always' || likelyNeedsBanner()); }, [props.show]);
  if (!needed || choice) return null;
  return (
    <div className={['hg-consent-banner', props.className].filter(Boolean).join(' ')} role="region" aria-label="Cookie and privacy choices">
      <p className="hg-consent-text">
        {props.text ?? 'We’d like to remember how you found us and load tools that help us improve this site. You can say no.'}
        {props.privacyHref ? <> <a href={props.privacyHref}>Privacy policy</a></> : null}
      </p>
      <div className="hg-consent-actions">
        <button type="button" className="hg-consent-reject" onClick={() => setConsent('denied')}>{props.rejectLabel ?? 'Reject'}</button>
        <button type="button" className="hg-consent-accept" onClick={() => setConsent('granted')}>{props.acceptLabel ?? 'Accept'}</button>
      </div>
    </div>
  );
}

/**
 * Renders its children (third-party tags, embeds) only after consent. Visitors
 * outside the EU/UK don't see a banner, so with `show="eu"` they get the children
 * straight away.
 */
export function ConsentGate({ children, show = 'eu' }: { children: ReactNode; show?: 'eu' | 'always' }) {
  const choice = useConsent();
  const [needed, setNeeded] = useState<boolean | null>(null);
  useEffect(() => { setNeeded(show === 'always' || likelyNeedsBanner()); }, [show]);
  if (needed === null) return null;
  return (choice === 'granted' || (!needed && choice !== 'denied')) ? <>{children}</> : null;
}
