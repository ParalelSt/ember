/** The marker the Android app appends to the WebView user agent on a car
 *  screen (CarScreen.kt). Keep the string in sync. */
export const CAR_UA_MARKER = 'EmberCar';

export function isCarUserAgent(ua: string | null | undefined): boolean {
  return !!ua && ua.includes(CAR_UA_MARKER);
}

/** Runs in <head> before first paint: tags <html> so the CSS can skip the
 *  phone rotation lock on a car display. Plain ES5, no dependencies. */
export const CAR_CLASS_SCRIPT =
  `try{if(navigator.userAgent.indexOf(${JSON.stringify(CAR_UA_MARKER)})>-1)document.documentElement.classList.add('car')}catch(e){}`;
