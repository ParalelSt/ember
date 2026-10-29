/** The marker the Android app appends to the WebView user agent on a car
 *  screen (CarScreen.kt). Keep the string in sync. */
export const CAR_UA_MARKER = 'EmberCar';

export function isCarUserAgent(ua: string | null | undefined): boolean {
  return !!ua && ua.includes(CAR_UA_MARKER);
}

/** Runs in <head> before first paint: tags <html> so the CSS can skip the
 *  phone rotation lock on a car display. `car` for the Android app's car
 *  screens (the marker above); `landscape-screen` for any screen that is
 *  landscape the right way up (rotation angle 0), which a phone on its side
 *  never is (90 or 270): an aftermarket car head unit, whose WebView is
 *  landscape and often under 500px tall but carries no car marker, and a
 *  short desktop window. Plain ES5, no dependencies. */
export const CAR_CLASS_SCRIPT =
  `try{var h=document.documentElement;if(navigator.userAgent.indexOf(${JSON.stringify(CAR_UA_MARKER)})>-1)h.classList.add('car');` +
  `var o=screen.orientation;if(o&&o.angle===0&&/^landscape/.test(o.type))h.classList.add('landscape-screen')}catch(e){}`;
