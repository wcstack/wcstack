// 設定 (/settings) — kept on this computer (a volume mounted at `settings`). Owner: the settings feature.
// <wcs-storage key="midori.settings" data-wcs="value#init=element: settings.stored"> saves `stored`; another tab's save
// arrives through its setter. Applying the theme to <html> is a $watch, which a volume may not declare: app.js.

const THEMES = ["light", "dark", "contrast"];
const DENSITIES = ["normal", "compact"];

export default {
  theme: "light",
  density: "normal",
  notifySaved: true,   // 保存・操作の結果を知らせる
  notifyLive: true,    // 他の職員の変更を知らせる
  stickyErrors: false, // エラーのお知らせを自動で消さない
  tab: "display",
  tabs: [{ id: "display", label: "表示" }, { id: "notify", label: "通知" }],
  themeOptions: [
    { value: "light", label: "ライト" },
    { value: "dark", label: "ダーク" },
    { value: "contrast", label: "高コントラスト" },
  ],
  densityOptions: [
    { value: "normal", label: "ふつう" },
    { value: "compact", label: "つめる" },
  ],

  // What is saved. Read by path, so each change re-runs the getter (and <wcs-storage> saves it).
  get stored() {
    return {
      v: 1,
      theme: this.theme,
      density: this.density,
      notifySaved: this.notifySaved,
      notifyLive: this.notifyLive,
      stickyErrors: this.stickyErrors,
    };
  },
  set stored(v) {
    if (!v || typeof v !== "object") return; // nothing saved yet (null): keep the defaults
    if (THEMES.includes(v.theme)) this.theme = v.theme;
    if (DENSITIES.includes(v.density)) this.density = v.density;
    if (typeof v.notifySaved === "boolean") this.notifySaved = v.notifySaved;
    if (typeof v.notifyLive === "boolean") this.notifyLive = v.notifyLive;
    if (typeof v.stickyErrors === "boolean") this.stickyErrors = v.stickyErrors;
  },
};
