// Glue between htmx (which the CMS owns) and the wcstack islands. A classic script, loaded after htmx in <head>.
(function () {
  "use strict";

  // wcstack walks the page once, when the root <wcs-state> binds it. Markup htmx inserts afterwards into the regions
  // it swaps (the cards the search and もっと見る bring, the booking fragment) is handed to state's binder; what htmx
  // throws away from them — the cards the server rendered first included, which the page walk bound — is let go of,
  // else every set of results ever shown stays bound (state README, "Inserting markup yourself"; docs/islands.md).
  // Before state has loaded there is no binder yet, and its page walk covers the markup. A boosted navigation's new
  // body is not handed over: the new root <wcs-state> in it binds the whole document.
  var REGIONS = "#results, #booking-slot";
  function binder() { return globalThis[Symbol.for("wcstack.binder")]; }
  document.addEventListener("htmx:load", function (evt) {
    var elt = evt.target;
    var b = binder();
    if (b && elt instanceof Element && elt.parentElement && elt.parentElement.closest(REGIONS)) b.bind(elt);
  });
  // (a region's own children: releasing one lets go of everything bound in it, cards appended into it included)
  document.addEventListener("htmx:beforeCleanupElement", function (evt) {
    var elt = evt.target;
    var b = binder();
    if (b && typeof b.release === "function" && elt.parentElement && elt.parentElement.matches(REGIONS)) b.release(elt);
  });

  // ---- Leaving a half-filled booking form asks first ------------------------------------------------------------
  // The island marks its form with data-dirty (a binding); the question's wording is in the template.
  function dirtyForm() { return document.querySelector("form[data-dirty]"); }
  function askLeave() {
    var form = dirtyForm();
    if (!form) return true;
    return window.confirm(form.getAttribute("data-leave-message") || "");
  }
  window.addEventListener("beforeunload", function (evt) {
    if (dirtyForm()) { evt.preventDefault(); evt.returnValue = ""; }
  });
  document.addEventListener("htmx:confirm", function (evt) {
    var d = evt.detail;
    // a boosted link or form: a navigation to another page
    if (d.elt && d.elt.closest && d.elt.closest("[hx-boost]") && (d.elt.tagName === "A" || d.elt.tagName === "FORM") && !d.elt.hasAttribute("hx-get")) {
      if (!askLeave()) evt.preventDefault();
    }
  });
  // workaround: htmx restores pages on popstate, which cannot be cancelled. A capture listener on window runs before
  // htmx's own; if the reader stays, it stops htmx and puts the URL that was left back on the stack.
  var current = location.href;
  document.addEventListener("htmx:pushedIntoHistory", function () { current = location.href; });
  document.addEventListener("htmx:replacedInHistory", function () { current = location.href; });
  window.addEventListener("popstate", function (evt) {
    if (dirtyForm() && !askLeave()) {
      evt.stopImmediatePropagation();
      history.pushState({ htmx: true }, "", current);
      return;
    }
    current = location.href;
  }, true);
  document.addEventListener("htmx:historyRestore", function () { current = location.href; });

  // ---- Requests that fail (htmx does not swap an error response) -----------------------------------------------
  function errorBox(elt) {
    var owner = elt && elt.closest && elt.closest("[data-error-box]");
    return owner ? document.querySelector(owner.getAttribute("data-error-box")) : null;
  }
  function showError(evt) {
    // A boosted navigation that fails (a 404 / 500 page, or no network) would otherwise do nothing at all: htmx does not
    // swap an error response. Load the page the ordinary way, so the visitor sees what a plain link would show.
    if (evt.detail.boosted && evt.detail.pathInfo && evt.type !== "htmx:timeout") {
      location.assign(evt.detail.pathInfo.finalRequestPath || evt.detail.pathInfo.requestPath);
      return;
    }
    var box = errorBox(evt.detail.elt);
    if (box) box.hidden = false;
  }
  document.addEventListener("htmx:responseError", showError);
  document.addEventListener("htmx:sendError", showError);
  document.addEventListener("htmx:timeout", showError);
  document.addEventListener("htmx:afterRequest", function (evt) {
    if (evt.detail.successful) { var box = errorBox(evt.detail.elt); if (box) box.hidden = true; }
  });
  document.addEventListener("click", function (evt) {
    var btn = evt.target.closest && evt.target.closest("[data-retry]");
    if (!btn) return;
    var target = document.querySelector(btn.getAttribute("data-retry"));
    var box = btn.closest("[hidden], .load-error");
    if (box) box.hidden = true;
    if (target) htmx.trigger(target, "retry");
  });

  // ---- 絞り込み: an impossible date range is not sent -------------------------------------------------------------
  // The island shows the message (filterInvalid); htmx's request is decided synchronously in the same change event,
  // before wcstack has applied the binding that marks the form, so the dates are compared here from the inputs.
  document.addEventListener("htmx:confirm", function (evt) {
    var form = evt.detail.elt && evt.detail.elt.closest && evt.detail.elt.closest("form#search");
    if (!form) return;
    var from = form.elements.from && form.elements.from.value;
    var to = form.elements.to && form.elements.to.value;
    if (from && to && from > to) evt.preventDefault();
  });
})();
