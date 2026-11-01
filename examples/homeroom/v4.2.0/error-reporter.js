// The error banner and POST /api/client-errors — "the way we do in all our apps".
// A classic script loaded first in <head>, independent of wcstack, so it also catches errors that happen
// before state has loaded (or when a CDN module fails).
(function () {
  "use strict";
  var SESSION_KEY = "homeroom.session";
  var QUEUE_KEY = "homeroom.pendingClientErrors";
  var sent = 0;
  var MAX_PER_PAGE = 20;   // never flood the server from a render loop

  function token() {
    try { var s = JSON.parse(localStorage.getItem(SESSION_KEY)); return s && s.token ? s.token : null; }
    catch (e) { return null; }
  }
  function readQueue() {
    try { return JSON.parse(sessionStorage.getItem(QUEUE_KEY)) || []; } catch (e) { return []; }
  }
  function writeQueue(q) {
    try { sessionStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-20))); } catch (e) { /* storage full or blocked */ }
  }
  function post(entry) {
    var t = token();
    // /api/client-errors needs a token like every other /api/*: keep the report until someone logs in
    if (!t) { var q = readQueue(); q.push(entry); writeQueue(q); return; }
    fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + t },
      body: JSON.stringify(entry),
      keepalive: true,
    }).then(function (res) {
      if (res.status === 401) { var q = readQueue(); q.push(entry); writeQueue(q); }
    }).catch(function () { /* the reporter must never report itself */ });
  }
  function flush() {
    var q = readQueue();
    if (q.length === 0 || !token()) return;
    writeQueue([]);
    q.forEach(post);
  }
  function showBanner() {
    var el = document.getElementById("error-banner");
    if (el) el.hidden = false;
    else document.addEventListener("DOMContentLoaded", showBanner, { once: true });
  }
  function report(error, fallbackMessage) {
    showBanner();
    if (sent >= MAX_PER_PAGE) return;
    sent += 1;
    var message = (error && error.message) || fallbackMessage || String(error);
    post({ message: String(message), stack: String((error && error.stack) || ""), url: location.href });
  }

  window.addEventListener("error", function (event) {
    // resource load errors (an <img> 404) are not exceptions
    if (!(event instanceof ErrorEvent)) return;
    report(event.error, event.message);
  });
  window.addEventListener("unhandledrejection", function (event) {
    report(event.reason, "Unhandled promise rejection");
  });

  // workaround: @wcstack/state isolates some failures and only logs them with console.error — a throwing
  // $watch handler, an async $on handler's rejection, $connectedCallback (state README §10–11; $errorCallback
  // covers bindings only). Those never reach window "error", so the reporter also takes console.error calls
  // that carry an Error object.
  var originalError = console.error;
  console.error = function () {
    originalError.apply(console, arguments);
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] instanceof Error) { report(arguments[i]); break; }
    }
  };

  window.addEventListener("storage", function (event) { if (event.key === SESSION_KEY) flush(); });
  setInterval(flush, 5000);
  flush();
})();
