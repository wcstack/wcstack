// The volume mounted at `i18n` by e2e/fixtures/mount-volume.html.
// Paths inside are relative to the mount: `this.lang` is `i18n.lang` on the tree (V2),
// and `$connectedCallback` runs in the same chroot (V7).
export default {
  lang: "en",
  dict: {
    en: { title: "Hello", items: "items" },
    ja: { title: "こんにちは", items: "件" },
  },
  connected: false,
  get t() { return this.dict[this.lang]; },
  $connectedCallback() { this.connected = true; },
};
