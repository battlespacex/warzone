/* EXAMPLE ONLY, for the stratops.space marketing distribution's viewer-request
   CloudFront Function. Merge into existing function; do not replace unrelated
   distribution behavior or functions serving app.stratops.space / battlespacex.com. */
function handler(event) {
  var request = event.request;
  var path = request.uri;
  var paths = {
    '/': '/pages/index.html',
    '/index.html': '/pages/index.html',
    '/advantage': '/pages/advantage.html',
    '/advantage/': '/pages/advantage.html',
    '/capabilities': '/pages/capabilities.html',
    '/capabilities/': '/pages/capabilities.html',
    '/intelligence': '/pages/intelligence.html',
    '/intelligence/': '/pages/intelligence.html',
    '/about': '/pages/about.html',
    '/about/': '/pages/about.html',
    '/partners': '/pages/partners.html',
    '/partners/': '/pages/partners.html',
    '/contact': '/pages/contact.html',
    '/contact/': '/pages/contact.html'
  };
  if (Object.prototype.hasOwnProperty.call(paths, path)) {
    request.uri = paths[path];
  }
  return request;
}
