// happy-dom does not implement the Picture-in-Picture API (no
// HTMLVideoElement.prototype.requestPictureInPicture, no
// document.exitPictureInPicture/pictureInPictureElement, and it never fires
// enterpictureinpicture/leavepictureinpicture). These helpers install a
// controllable fake on top of a real <video> element / the real `document` so
// tests can drive the Core/Shell through every branch.

/** A real <video> element with a requestPictureInPicture stub attached. */
export interface FakeVideoElement extends HTMLVideoElement {
  __pipResolve?: () => void;
  __pipReject?: (e: any) => void;
}

/**
 * Create a `<video>` element (tagName === "VIDEO" is satisfied by using the
 * real DOM factory) and stub `requestPictureInPicture` on it so tests can
 * control resolve/reject timing.
 */
export function makeVideo(): FakeVideoElement {
  const video = document.createElement("video") as FakeVideoElement;
  (video as any).requestPictureInPicture = () => new Promise<PictureInPictureWindow>((resolve, reject) => {
    video.__pipResolve = () => resolve({} as PictureInPictureWindow);
    video.__pipReject = (e: any) => reject(e);
  });
  return video;
}

/** Remove the requestPictureInPicture stub to simulate an unsupported browser. */
export function removeRequestPictureInPicture(video: HTMLVideoElement): void {
  delete (video as any).requestPictureInPicture;
}

/** Install a controllable `document.pictureInPictureElement`. */
export function installPictureInPictureElement(initial: Element | null = null): void {
  Object.defineProperty(document, "pictureInPictureElement", {
    value: initial,
    configurable: true,
    writable: true,
  });
}

/** Update the installed `document.pictureInPictureElement` value. */
export function setPictureInPictureElement(el: Element | null): void {
  Object.defineProperty(document, "pictureInPictureElement", {
    value: el,
    configurable: true,
    writable: true,
  });
}

/** Remove `document.pictureInPictureElement` entirely (never installed / reset). */
export function removePictureInPictureElement(): void {
  delete (document as any).pictureInPictureElement;
}

/** Install a controllable `document.exitPictureInPicture`. */
export function installExitPictureInPicture(impl?: () => Promise<void>): {
  resolve: () => void;
  reject: (e: any) => void;
} {
  let resolveFn: () => void = () => {};
  let rejectFn: (e: any) => void = () => {};
  const fn = impl ?? (() => new Promise<void>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  }));
  Object.defineProperty(document, "exitPictureInPicture", {
    value: fn,
    configurable: true,
    writable: true,
  });
  return {
    resolve: () => resolveFn(),
    reject: (e: any) => rejectFn(e),
  };
}

/** Remove `document.exitPictureInPicture` to simulate an unsupported browser. */
export function removeExitPictureInPicture(): void {
  delete (document as any).exitPictureInPicture;
}

/** Manually dispatch `enterpictureinpicture` on `video` (as the platform would). */
export function emitEnter(video: HTMLVideoElement): void {
  video.dispatchEvent(new Event("enterpictureinpicture"));
}

/** Manually dispatch `leavepictureinpicture` on `video` (as the platform would). */
export function emitLeave(video: HTMLVideoElement): void {
  video.dispatchEvent(new Event("leavepictureinpicture"));
}
