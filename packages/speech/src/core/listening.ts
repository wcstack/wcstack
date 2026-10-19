/**
 * Which recognizers on this page are listening right now. A `<wcs-speak>` that starts
 * speaking while one listens is heard through the microphone, and what is heard can be
 * spoken again (the echo loop the README warns about), so it asks here first
 * (`[wcs/speech-echo]`).
 */
const listening = new Set<object>();

export function setListening(owner: object, on: boolean): void {
  if (on) listening.add(owner);
  else listening.delete(owner);
}

export function anyListening(): boolean {
  return listening.size > 0;
}
