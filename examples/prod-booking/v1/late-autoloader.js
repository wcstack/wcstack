// 4.6.2: the split auto entry defines <wcs-state> only after it has loaded the root's features, and that
// release's autoloader stopped at the first tag outside its namespaces. Add <wcs-autoloader> once <wcs-state>
// is defined. (4.7: the autoloader leaves such tags alone; v2 writes <wcs-autoloader> in the markup.)
customElements.whenDefined("wcs-state").then(function () {
  document.body.insertBefore(document.createElement("wcs-autoloader"), document.body.firstChild);
});
