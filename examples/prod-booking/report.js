// Client error reporting, as a production app has it: whatever reaches the window's "error" event or an
// unhandled rejection is posted to /booking/api/client-errors. Loaded first, as a classic script.
// Since 4.7, @wcstack/state reports through reportError(): a <wcs-state> that fails to initialize and a binding
// that fails to apply arrive here too, with the original error as `cause`.
(function () {
  var endpoint = "/booking/api/client-errors";
  function post(report) {
    report.url = location.pathname;
    report.app = document.documentElement.dataset.app || "";
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report), keepalive: true })
      .catch(function () { /* offline: drop it */ });
  }
  window.addEventListener("error", function (e) {
    if (e.target && e.target !== window) {   // a <script> / <link> that failed to load
      post({ kind: "resource", tag: e.target.tagName, src: e.target.src || e.target.href || "" });
      return;
    }
    var err = e.error;
    post({ kind: "error", message: (err && err.message) || e.message, cause: err && err.cause ? String(err.cause.message || err.cause) : null });
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    post({ kind: "unhandledrejection", message: r && r.message ? r.message : String(r) });
  });
})();
