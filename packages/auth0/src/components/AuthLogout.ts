import { config } from "../config.js";
import { Auth } from "./Auth.js";

/**
 * <wcs-auth-logout> — declarative logout button.
 * Finds the parent or referenced <wcs-auth> element and calls logout().
 *
 * Usage:
 *   <wcs-auth-logout target="auth-id">ログアウト</wcs-auth-logout>
 *   <wcs-auth-logout return-to="/">ログアウト</wcs-auth-logout>
 */
export class AuthLogout extends HTMLElement {
  connectedCallback(): void {
    this.addEventListener("click", this._handleClick);
    this.style.cursor = "pointer";
  }

  disconnectedCallback(): void {
    this.removeEventListener("click", this._handleClick);
  }

  get target(): string {
    return this.getAttribute("target") || "";
  }

  set target(value: string) {
    this.setAttribute("target", value);
  }

  get returnTo(): string {
    return this.getAttribute("return-to") || "";
  }

  set returnTo(value: string) {
    this.setAttribute("return-to", value);
  }

  private _handleClick = (event: Event): void => {
    event.preventDefault();

    const authElement = this._findAuth();
    if (!authElement) return;

    const options: Record<string, any> = {};
    if (this.returnTo) {
      options.logoutParams = { returnTo: this.returnTo };
    }

    authElement.logout(options);
  };

  private _findAuth(): Auth | null {
    // target属性でIDを指定している場合
    if (this.target) {
      const el = document.getElementById(this.target);
      if (el && el.tagName.toLowerCase() === config.tagNames.auth) {
        return el as unknown as Auth;
      }
      return null;
    }

    // 最寄りの<wcs-auth>を探す
    const closest = this.closest(config.tagNames.auth);
    if (closest) {
      return closest as unknown as Auth;
    }

    // ドキュメント内の最初の<wcs-auth>を探す
    const first = document.querySelector(config.tagNames.auth);
    return first as unknown as Auth | null;
  }
}
