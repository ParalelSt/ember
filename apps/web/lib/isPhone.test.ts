import { describe, expect, it } from 'vitest';
import { isPhoneProbe } from './isPhone';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
const CAR = `${ANDROID_TABLET} EmberCar`;

describe('isPhoneProbe', () => {
  it('iPhone is a phone', () => expect(isPhoneProbe({ ua: IPHONE })).toBe(true));
  it('Android phone is a phone', () => expect(isPhoneProbe({ ua: ANDROID_PHONE })).toBe(true));
  it('Android phone with userAgentData.mobile', () =>
    expect(isPhoneProbe({ ua: ANDROID_PHONE, uaDataMobile: true })).toBe(true));
  it('userAgentData.mobile=false wins over a Mobi UA', () =>
    expect(isPhoneProbe({ ua: ANDROID_PHONE, uaDataMobile: false })).toBe(false));
  it('Android tablet is not a phone', () => expect(isPhoneProbe({ ua: ANDROID_TABLET })).toBe(false));
  it('iPad is not a phone', () => expect(isPhoneProbe({ ua: IPAD })).toBe(false));
  it('desktop Chrome is not a phone', () => expect(isPhoneProbe({ ua: CHROME, uaDataMobile: false })).toBe(false));
  it('Edge on Windows is not a phone', () => expect(isPhoneProbe({ ua: EDGE })).toBe(false));
  it('EmberCar car screen counts', () => expect(isPhoneProbe({ ua: CAR })).toBe(true));
  it('Capacitor phone app is a phone', () => expect(isPhoneProbe({ ua: ANDROID_PHONE, capacitor: true })).toBe(true));
  it('Capacitor iOS app on iPhone', () => expect(isPhoneProbe({ ua: IPHONE, capacitor: true })).toBe(true));
  it('Capacitor app on a tablet keeps the QR', () => {
    expect(isPhoneProbe({ ua: ANDROID_TABLET, capacitor: true })).toBe(false);
    expect(isPhoneProbe({ ua: IPAD, capacitor: true })).toBe(false);
  });
});
